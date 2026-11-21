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

    // Also verify inspectProvenance binary scanner detects markers and honors precedence
    const encoder = new TextEncoder();
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.constantFrom(...AI_C2PA_MARKERS), { nil: undefined }),
        fc.option(fc.constantFrom(...AI_GEN_SIGNATURES), { nil: undefined }),
        fc.option(fc.constantFrom(...CAMERA_EXIF_VALUES), { nil: undefined }),
        async (c2pa, gen, exif) => {
          const header = new Uint8Array([0xff, 0xd8, 0xff, 0xe1]);
          const bodyText = [c2pa, gen, exif].filter(Boolean).join(' | ');
          const bodyBytes = encoder.encode(bodyText);
          const payload = new Uint8Array(header.length + bodyBytes.length);
          payload.set(header, 0);
          payload.set(bodyBytes, header.length);
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
});
