import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { inspectProvenance, type Provenance } from '@/lib/media/provenance';
import {
  EYE_CHECK_SPOTS,
  mediaResult,
  VOICE_CLONE_SAFETY_NOTE,
} from '@/lib/media/result';
import { editedName } from '@/lib/photo/filename';
import {
  applyPhotoPreset,
  OLD_PRINT_SCAN_STEPS,
  PHOTO_PRESETS,
} from '@/lib/photo/presets';
import { createVault } from '@/lib/vault/store';

const AI_C2PA_MARKERS = [
  'c2pa.ai_generated',
  'urn:c2pa:ai',
  'C2PA AI Manifest',
] as const;

const AI_GEN_SIGNATURES = [
  'Midjourney',
  'DALL-E',
  'Stable Diffusion',
  'SynthID',
  'Adobe Firefly',
  'Imagine',
] as const;

const CAMERA_EXIF_VALUES = [
  'Apple iPhone',
  'Canon',
  'Nikon',
  'Samsung',
  'Exif',
] as const;

function buildPngWithChunk(chunkType: string, payloadText: string, padBeforeMiddle = 0): Uint8Array {
  const encoder = new TextEncoder();
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const makeChunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    out.set(encoder.encode(type).subarray(0, 4), 4);
    out.set(data, 8);
    // 4-byte dummy CRC
    return out;
  };

  const chunks: Uint8Array[] = [sig];
  if (padBeforeMiddle > 0) {
    chunks.push(makeChunk('IDAT', new Uint8Array(padBeforeMiddle)));
  }
  chunks.push(makeChunk(chunkType, encoder.encode(payloadText)));
  if (padBeforeMiddle > 0) {
    chunks.push(makeChunk('IDAT', new Uint8Array(padBeforeMiddle)));
  }
  chunks.push(makeChunk('IEND', new Uint8Array(0)));

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}

function buildJpegWithApp1(
  payloadText: string,
  opts?: { extraFillBytes?: number; padAround?: number }
): Uint8Array {
  const encoder = new TextEncoder();
  const payload = encoder.encode(payloadText);
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];

  if (opts?.padAround && opts.padAround > 0) {
    // APP2 padding segment (max 65533 bytes per segment)
    let remaining = opts.padAround;
    while (remaining > 0) {
      const segDataLen = Math.min(remaining, 60000);
      const seg = new Uint8Array(4 + segDataLen);
      seg[0] = 0xff;
      seg[1] = 0xe2;
      const view = new DataView(seg.buffer);
      view.setUint16(2, segDataLen + 2, false);
      parts.push(seg);
      remaining -= segDataLen;
    }
  }

  const fillCount = opts?.extraFillBytes ?? 0;
  const app1 = new Uint8Array(fillCount + 4 + payload.length);
  for (let i = 0; i < fillCount + 1; i += 1) {
    app1[i] = 0xff;
  }
  app1[fillCount + 1] = 0xe1;
  const app1View = new DataView(app1.buffer, fillCount + 2, 2);
  app1View.setUint16(0, payload.length + 2, false);
  app1.set(payload, fillCount + 4);
  parts.push(app1);

  if (opts?.padAround && opts.padAround > 0) {
    let remaining = opts.padAround;
    while (remaining > 0) {
      const segDataLen = Math.min(remaining, 60000);
      const seg = new Uint8Array(4 + segDataLen);
      seg[0] = 0xff;
      seg[1] = 0xe2;
      const view = new DataView(seg.buffer);
      view.setUint16(2, segDataLen + 2, false);
      parts.push(seg);
      remaining -= segDataLen;
    }
  }

  parts.push(new Uint8Array([0xff, 0xd9]));

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

describe('Media Provenance Check and Photo Helper property tests', () => {
  // Feature: senior-digital-companion, Property 33: Media check result precedence
  it('Property 33: enforces AI > Camera EXIF > Cannot tell precedence and never claims 100% Real', async () => {
    // Verify static educational guidance constants
    expect(EYE_CHECK_SPOTS).toHaveLength(4);
    expect(VOICE_CLONE_SAFETY_NOTE.trim().length).toBeGreaterThan(0);

    const optC2pa = fc.option(fc.constantFrom(...AI_C2PA_MARKERS, '', '   '), {
      nil: undefined,
    });
    const optGen = fc.option(fc.constantFrom(...AI_GEN_SIGNATURES, '', '  '), {
      nil: undefined,
    });
    const optExif = fc.option(
      fc.constantFrom(...CAMERA_EXIF_VALUES, '', ' ', '100% Real Camera'),
      { nil: undefined }
    );

    fc.assert(
      fc.property(optC2pa, optGen, optExif, (c2paAiGenerator, generatorSignature, cameraExif) => {
        const prov: Provenance = {};
        if (c2paAiGenerator !== undefined) prov.c2paAiGenerator = c2paAiGenerator;
        if (generatorSignature !== undefined) {
          prov.generatorSignature = generatorSignature;
        }
        if (cameraExif !== undefined) prov.cameraExif = cameraExif;

        const outcome = mediaResult(prov);

        const hasC2pa = Boolean(c2paAiGenerator && c2paAiGenerator.trim().length > 0);
        const hasGen = Boolean(
          generatorSignature && generatorSignature.trim().length > 0
        );
        const hasExif = Boolean(cameraExif && cameraExif.trim().length > 0);

        if (hasC2pa || hasGen) {
          // Precedence 1: AI signal always wins over EXIF
          expect(outcome.result).toBe('AI signal found');
          expect(outcome.signalName).toBe(
            hasC2pa ? c2paAiGenerator : generatorSignature
          );
          expect(outcome.note).toBe('This image carries an AI generation marker.');
        } else if (hasExif) {
          // Precedence 2: Camera EXIF without AI signal
          expect(outcome.result).toBe('Camera signal found');
          expect(outcome.signalName).toBeDefined();
          expect(outcome.note).toBe(
            'Camera details were found, but this does not prove the photo is authentic.'
          );
        } else {
          // Precedence 3: No signals
          expect(outcome.result).toBe('Cannot tell');
          expect(outcome.signalName).toBeUndefined();
          expect(outcome.note).toBe(
            'Messaging apps like WhatsApp often remove photo details, so we cannot tell from the file alone.'
          );
        }

        // Honesty invariant (Req 18.6)
        const serialized = JSON.stringify(outcome).toLowerCase();
        expect(serialized).not.toContain('100% real');
        expect(serialized).not.toContain('certainly authentic');
        expect(serialized).not.toContain('guaranteed real');
      }),
      { numRuns: 100 }
    );

    // Also verify inspectProvenance binary scanner detects markers across valid JPEG APP1 and PNG chunks
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('jpeg', 'png'),
        fc.option(fc.constantFrom(...AI_C2PA_MARKERS), { nil: undefined }),
        fc.option(fc.constantFrom(...AI_GEN_SIGNATURES), { nil: undefined }),
        fc.option(fc.constantFrom(...CAMERA_EXIF_VALUES), { nil: undefined }),
        async (format, c2pa, gen, exif) => {
          const bodyText = [c2pa, gen, exif].filter(Boolean).join(' | ');
          const payload =
            format === 'png'
              ? buildPngWithChunk('tEXt', bodyText)
              : buildJpegWithApp1(bodyText);
          const snapshot = new Uint8Array(payload);

          const parsed = await inspectProvenance(payload);
          // Scanner must not mutate input bytes
          expect(Array.from(payload)).toEqual(Array.from(snapshot));

          const outcome = mediaResult(parsed);
          if (c2pa || gen) {
            expect(outcome.result).toBe('AI signal found');
          } else if (exif) {
            expect(outcome.result).toBe('Camera signal found');
          } else {
            expect(outcome.result).toBe('Cannot tell');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 33 regression: parses PNG iTXt/tEXt chunks, JPEG APP1 with fill bytes, AI fallback label, and malformed high-bit PNG chunk lengths safely', async () => {
    // Valid PNG iTXt chunk placed in the middle beyond head/tail 256KB scan window
    const largePng = buildPngWithChunk('iTXt', 'c2pa.ai_generated Midjourney', 270_000);
    const largePngProv = await inspectProvenance(largePng);
    expect(largePngProv.c2paAiGenerator).toBe('c2pa.ai_generated');
    expect(largePngProv.generatorSignature).toBe('Midjourney');
    expect(mediaResult(largePngProv).result).toBe('AI signal found');

    // Valid JPEG APP1 segment preceded by 0xff fill bytes placed beyond 256KB scan window
    const largeJpeg = buildJpegWithApp1('Exif Apple iPhone', {
      extraFillBytes: 2,
      padAround: 270_000,
    });
    const largeJpegProv = await inspectProvenance(largeJpeg);
    expect(largeJpegProv.cameraExif).toBe('Apple iPhone');
    expect(mediaResult(largeJpegProv).result).toBe('Camera signal found');

    // AI fallback label when forbidden certainty text is stripped from AI field
    const sanitizedAi = mediaResult({ c2paAiGenerator: '100% Real' });
    expect(sanitizedAi.result).toBe('AI signal found');
    expect(sanitizedAi.signalName).toBe('AI metadata');

    // Malformed PNG with high-bit chunk length 0xfffffff4 (-12 signed int32) must terminate cleanly
    const malformedNegativeTwelve = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0xff, 0xff, 0xff, 0xf4,
      0x74, 0x45, 0x58, 0x74,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const malformedRes1 = await inspectProvenance(malformedNegativeTwelve);
    expect(mediaResult(malformedRes1).result).toBe('Cannot tell');

    // Malformed PNG with high-bit chunk length 0x80000000
    const malformedHighBit = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x80, 0x00, 0x00, 0x00,
      0x74, 0x45, 0x58, 0x74,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const malformedRes2 = await inspectProvenance(malformedHighBit);
    expect(mediaResult(malformedRes2).result).toBe('Cannot tell');
  });

  // Feature: senior-digital-companion, Property 34: Saved copy naming
  it('Property 34: always inserts -edited before extension and never collides with any name in taken', () => {
    const baseArb = fc.stringMatching(/^[A-Za-z0-9 _-]{1,20}$/);
    const extArb = fc.constantFrom('', '.jpg', '.jpeg', '.png', '.webp', '.heic');

    fc.assert(
      fc.property(
        baseArb,
        extArb,
        fc.integer({ min: 0, max: 12 }),
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
          minLength: 0,
          maxLength: 10,
        }),
        (base, ext, collisionCount, extraTaken) => {
          const original = `${base}${ext}`;
          const taken = new Set<string>(extraTaken);
          taken.add(original);

          // Pre-populate sequential collisions
          if (collisionCount >= 1) {
            taken.add(`${base}-edited${ext}`);
          }
          for (let n = 2; n <= collisionCount; n += 1) {
            taken.add(`${base}-edited-${n}${ext}`);
          }

          const result = editedName(original, taken);

          // Never in taken
          expect(taken.has(result)).toBe(false);

          // Preserves extension and includes -edited before extension
          if (ext.length > 0) {
            expect(result.endsWith(ext)).toBe(true);
            const withoutExt = result.slice(0, result.length - ext.length);
            expect(withoutExt.startsWith(`${base}-edited`)).toBe(true);
          } else {
            expect(result.startsWith(`${base}-edited`)).toBe(true);
          }

          // Exact expected suffix given sequential collisions when no extraTaken collided further
          const expectedCandidate =
            collisionCount === 0
              ? `${base}-edited${ext}`
              : `${base}-edited-${collisionCount + 1}${ext}`;
          if (!extraTaken.includes(expectedCandidate)) {
            expect(result).toBe(expectedCandidate);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: senior-digital-companion, Property 35: Originals are byte-identical
  it('Property 35: preserves original bytes untouched across all presets, save/discard, and errors', async () => {
    expect(PHOTO_PRESETS).toEqual([
      'Make Clearer',
      'Brighten Dark Photo',
      'Fix Old / Scratched Photo',
      'Tidy Background',
    ]);
    expect(OLD_PRINT_SCAN_STEPS).toHaveLength(3);

    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 0, maxLength: 256 }),
        fc.constantFrom(...PHOTO_PRESETS),
        fc.boolean(),
        async (originalBytes, preset, shouldFail) => {
          const beforeSnapshot = new Uint8Array(originalBytes);
          const dbName = `photo-test-${Math.random().toString(36).slice(2)}`;
          const vault = createVault({ dbName });
          await vault.putBlob('original.jpg', originalBytes);

          const res = await applyPhotoPreset(originalBytes, preset, {
            shouldFail,
          });

          // Original bytes must be byte-identical immediately after applyPhotoPreset
          expect(Array.from(originalBytes)).toEqual(Array.from(beforeSnapshot));

          if (shouldFail) {
            expect(res.ok).toBe(false);
            if (!res.ok) {
              expect(res.error.message.trim().length).toBeGreaterThan(0);
            }
          } else {
            expect(res.ok).toBe(true);
            if (res.ok) {
              const { editedBytes } = res.value;
              // Distinct buffer reference
              expect(editedBytes).not.toBe(originalBytes);
              expect(editedBytes.buffer).not.toBe(originalBytes.buffer);

              // Deterministic for identical input + preset
              const second = await applyPhotoPreset(originalBytes, preset);
              expect(second.ok).toBe(true);
              if (second.ok) {
                expect(Array.from(second.value.editedBytes)).toEqual(
                  Array.from(editedBytes)
                );
              }

              // Save edited copy under a new key & verify original in vault is byte-identical
              const saveName = editedName(
                'original.jpg',
                new Set(['original.jpg'])
              );
              await vault.putBlob(saveName, editedBytes);

              // Mutating editedBytes after return must never mutate originalBytes
              if (editedBytes.length > 0) {
                editedBytes[0] = (editedBytes[0] + 1) & 0xff;
              }
              expect(Array.from(originalBytes)).toEqual(
                Array.from(beforeSnapshot)
              );

              const storedOriginal = await vault.getBlob('original.jpg');
              expect(storedOriginal.ok).toBe(true);
              if (storedOriginal.ok) {
                expect(Array.from(storedOriginal.value ?? [])).toEqual(
                  Array.from(beforeSnapshot)
                );
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('applyPhotoPreset preserves JPEG and PNG headers/payloads without corruption while producing distinct deterministic outputs', async () => {
    const validJpeg = buildJpegWithApp1('Exif Apple iPhone');
    const validPng = buildPngWithChunk('IDAT', 'pixel-payload');

    const jpegOutputs = new Set<string>();
    for (const preset of PHOTO_PRESETS) {
      const res = await applyPhotoPreset(validJpeg, preset);
      expect(res.ok).toBe(true);
      if (res.ok) {
        const out = res.value.editedBytes;
        // Original JPEG header, APP1 segment, and EOI marker are 100% preserved intact
        expect(Array.from(out.subarray(0, validJpeg.length))).toEqual(
          Array.from(validJpeg)
        );
        expect(out[0]).toBe(0xff);
        expect(out[1]).toBe(0xd8);
        jpegOutputs.add(Array.from(out).join(','));
      }
    }
    expect(jpegOutputs.size).toBe(PHOTO_PRESETS.length);

    const pngOutputs = new Set<string>();
    const iendBytes = [
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ];
    // Give validPng the canonical PNG IEND CRC so isPngWithIend matches
    const canonicalPng = new Uint8Array(validPng.length);
    canonicalPng.set(validPng);
    canonicalPng.set(iendBytes, canonicalPng.length - iendBytes.length);

    for (const preset of PHOTO_PRESETS) {
      const res = await applyPhotoPreset(canonicalPng, preset);
      expect(res.ok).toBe(true);
      if (res.ok) {
        const out = res.value.editedBytes;
        // PNG signature and all chunks before IEND are preserved intact, and IEND stays at the end
        expect(Array.from(out.subarray(0, canonicalPng.length - 12))).toEqual(
          Array.from(canonicalPng.subarray(0, canonicalPng.length - 12))
        );
        expect(Array.from(out.subarray(out.length - 12))).toEqual(iendBytes);
        pngOutputs.add(Array.from(out).join(','));
      }
    }
    expect(pngOutputs.size).toBe(PHOTO_PRESETS.length);
  });
});
