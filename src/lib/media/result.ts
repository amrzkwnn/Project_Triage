import type { Provenance } from './provenance';

export type MediaCheckOutcome = {
  result: 'AI signal found' | 'Camera signal found' | 'Cannot tell';
  signalName?: string;
  note: string;
};

const FORBIDDEN_CERTAINTY_PATTERN =
  /100%\s*real|certainly\s+authentic|guaranteed\s+real|proven\s+real/gi;

function cleanNonEmpty(value: string | undefined, fallback: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value.trim().length === 0) {
    return undefined;
  }
  const sanitized = value.replace(FORBIDDEN_CERTAINTY_PATTERN, '').trim();
  return sanitized.length > 0 ? sanitized : fallback;
}

export function mediaResult(p: Provenance): MediaCheckOutcome {
  const c2pa = cleanNonEmpty(p.c2paAiGenerator, 'AI metadata');
  const generator = cleanNonEmpty(p.generatorSignature, 'AI metadata');

  // Precedence 1: AI signal always takes priority over Camera EXIF
  if (c2pa !== undefined || generator !== undefined) {
    return {
      result: 'AI signal found',
      signalName: c2pa ?? generator,
      note: 'This image carries an AI generation marker.',
    };
  }

  // Precedence 2: Camera EXIF without AI signal
  const cameraExif = cleanNonEmpty(p.cameraExif, 'Camera metadata');
  if (cameraExif !== undefined) {
    return {
      result: 'Camera signal found',
      signalName: cameraExif,
      note: 'Camera details were found, but this does not prove the photo is authentic.',
    };
  }

  // Precedence 3: No signals found
  return {
    result: 'Cannot tell',
    note: 'Messaging apps like WhatsApp often remove photo details, so we cannot tell from the file alone.',
  };
}

export type EyeCheckSpot = {
  id: string;
  title: string;
  tip: string;
};

export const EYE_CHECK_SPOTS: readonly EyeCheckSpot[] = [
  {
    id: 'hands-and-fingers',
    title: 'Hands & Fingers',
    tip: 'Count fingers and check if hands blend strangely into clothes or objects.',
  },
  {
    id: 'background-words-and-signs',
    title: 'Background Words & Signs',
    tip: 'Look at shop signs, labels, or clocks in the background for scrambled or unreadable letters.',
  },
  {
    id: 'eyes-teeth-glasses',
    title: 'Eyes, Teeth & Glasses',
    tip: 'Check if glasses frames disappear halfway or if eyes and teeth look uneven or blurred.',
  },
  {
    id: 'smooth-plastic-face-edges',
    title: 'Smooth Plastic Face Edges',
    tip: 'Notice overly smooth, waxy skin or hair edges that melt awkwardly into the background.',
  },
] as const;

export const VOICE_CLONE_SAFETY_NOTE =
  'AI can copy a loved one’s voice from a short video. If a voice message or call asks for urgent money or secrecy, hang up and call them back on a saved number or ask for your family code word.';
