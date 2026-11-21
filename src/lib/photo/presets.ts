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

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value | 0;
}

function detectHeaderOffset(bytes: Uint8Array): number {
  // Preserve PNG 8-byte signature if present
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 8;
  }
  // Preserve JPEG 2-byte SOI marker if present
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return 2;
  }
  return 0;
}

/**
 * Applies a deterministic preset transform to a fresh clone of `originalBytes`.
 * Never mutates `originalBytes` in place during preview, save, discard, or errors.
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

  // Always allocate an independent Uint8Array copy so originalBytes is never mutated
  const editedBytes = new Uint8Array(originalBytes.length);
  editedBytes.set(originalBytes);

  const start = detectHeaderOffset(editedBytes);
  for (let i = start; i < editedBytes.length; i += 1) {
    const v = editedBytes[i];
    switch (preset) {
      case 'Make Clearer':
        editedBytes[i] = clampByte(Math.round((v - 128) * 1.15 + 128));
        break;
      case 'Brighten Dark Photo':
        editedBytes[i] = clampByte(v + 24);
        break;
      case 'Fix Old / Scratched Photo': {
        const prev = i > start ? originalBytes[i - 1] : v;
        const next = i + 1 < originalBytes.length ? originalBytes[i + 1] : v;
        editedBytes[i] = clampByte(Math.round((prev + v * 2 + next) / 4));
        break;
      }
      case 'Tidy Background':
        editedBytes[i] = clampByte(Math.round(v * 0.92 + 12));
        break;
    }
  }

  return {
    ok: true,
    value: { editedBytes },
  };
}
