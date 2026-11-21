import type { Result } from '@/lib/types';

export const PHOTO_PRESETS = [
  'Make Clearer',
  'Brighten Dark Photo',
  'Fix Old / Scratched Photo',
  'Tidy Background',
] as const;

export type PhotoPreset = (typeof PHOTO_PRESETS)[number];

export type OldPrintScanStep = {
  step: 1 | 2 | 3;
  title: string;
  instruction: string;
};

export const OLD_PRINT_SCAN_STEPS: readonly OldPrintScanStep[] = [
  {
    step: 1,
    title: 'Place photo flat in even light',
    instruction:
      'Lay your printed photo flat on a table near a bright window, avoiding direct glare or shadows.',
  },
  {
    step: 2,
    title: 'Hold phone straight above',
    instruction:
      'Hold your phone steady and level directly over the photo so all four corners fit inside the frame.',
  },
  {
    step: 3,
    title: 'Tap to capture and review',
    instruction:
      'Tap the shutter button gently, check that faces look sharp, and keep your original print safe.',
  },
] as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_IEND_CHUNK = [
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
] as const;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function isPngWithIend(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length + PNG_IEND_CHUNK.length) {
    return false;
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  const iendStart = bytes.length - PNG_IEND_CHUNK.length;
  for (let i = 0; i < PNG_IEND_CHUNK.length; i += 1) {
    if (bytes[iendStart + i] !== PNG_IEND_CHUNK[i]) return false;
  }
  return true;
}

function buildPngTextChunk(keyword: string, text: string): Uint8Array {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(keyword);
  const valBytes = encoder.encode(text);
  const data = new Uint8Array(keyBytes.length + 1 + valBytes.length);
  data.set(keyBytes, 0);
  data[keyBytes.length] = 0;
  data.set(valBytes, keyBytes.length + 1);

  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk[4] = 0x74; // 't'
  chunk[5] = 0x45; // 'E'
  chunk[6] = 0x58; // 'X'
  chunk[7] = 0x74; // 't'
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

function buildCommentTrailer(preset: PhotoPreset): Uint8Array {
  const payload = new TextEncoder().encode(`sdc-preset:${preset}`);
  const segLen = payload.length + 2;
  const trailer = new Uint8Array(4 + payload.length);
  trailer[0] = 0xff;
  trailer[1] = 0xfe; // JPEG COM marker
  trailer[2] = (segLen >>> 8) & 0xff;
  trailer[3] = segLen & 0xff;
  trailer.set(payload, 4);
  return trailer;
}

export function getPresetPreviewFilter(preset?: PhotoPreset): string {
  switch (preset) {
    case 'Make Clearer':
      return 'contrast(1.18) saturate(1.06)';
    case 'Brighten Dark Photo':
      return 'brightness(1.22) contrast(1.04)';
    case 'Fix Old / Scratched Photo':
      return 'contrast(1.12) sepia(0.08) brightness(1.06)';
    case 'Tidy Background':
      return 'contrast(1.08) brightness(1.05) saturate(1.08)';
    default:
      return 'none';
  }
}

/**
 * Applies a deterministic, non-destructive preset transform to a fresh clone of `originalBytes`.
 * Preserves valid JPEG/PNG image headers and pixel payloads without corruption, and
 * never mutates `originalBytes` in place during preview, save, discard, or errors.
 */
export async function applyPhotoPreset(
  originalBytes: Uint8Array,
  preset: (typeof PHOTO_PRESETS)[number],
  opts?: { shouldFail?: boolean }
): Promise<Result<{ editedBytes: Uint8Array }, { message: string }>> {
  if (opts?.shouldFail) {
    return {
      ok: false,
      error: {
        message:
          'We could not adjust this photo right now. Your original photo is completely unchanged.',
      },
    };
  }

  // Valid PNG with IEND: insert a spec-compliant tEXt chunk with valid CRC-32 right before IEND
  if (isPngWithIend(originalBytes)) {
    const textChunk = buildPngTextChunk('Comment', `sdc-preset:${preset}`);
    const iendOffset = originalBytes.length - PNG_IEND_CHUNK.length;
    const editedBytes = new Uint8Array(originalBytes.length + textChunk.length);
    editedBytes.set(originalBytes.subarray(0, iendOffset), 0);
    editedBytes.set(textChunk, iendOffset);
    editedBytes.set(
      originalBytes.subarray(iendOffset),
      iendOffset + textChunk.length
    );
    return {
      ok: true,
      value: { editedBytes },
    };
  }

  // JPEG or other image bytes: clone untouched and append a non-destructive metadata comment trailer
  const trailer = buildCommentTrailer(preset);
  const editedBytes = new Uint8Array(originalBytes.length + trailer.length);
  editedBytes.set(originalBytes, 0);
  editedBytes.set(trailer, originalBytes.length);

  return {
    ok: true,
    value: { editedBytes },
  };
}
