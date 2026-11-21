export type Provenance = {
  c2paAiGenerator?: string;
  generatorSignature?: string;
  cameraExif?: string;
};

const C2PA_MARKERS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /c2pa\.ai_generated/i, label: 'c2pa.ai_generated' },
  { pattern: /urn:c2pa/i, label: 'urn:c2pa' },
  { pattern: /\bc2pa\b/i, label: 'C2PA' },
];

const GENERATOR_SIGNATURES: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /midjourney/i, label: 'Midjourney' },
  { pattern: /dall[\s-·•]?e/i, label: 'DALL-E' },
  { pattern: /stable\s*diffusion/i, label: 'Stable Diffusion' },
  { pattern: /synthid/i, label: 'SynthID' },
  { pattern: /adobe\s*firefly/i, label: 'Adobe Firefly' },
  { pattern: /\bimagine\b/i, label: 'Imagine' },
];

const CAMERA_EXIF_MARKERS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /apple\s*iphone/i, label: 'Apple iPhone' },
  { pattern: /\bcanon\b/i, label: 'Canon' },
  { pattern: /\bnikon\b/i, label: 'Nikon' },
  { pattern: /\bsamsung\b/i, label: 'Samsung' },
  { pattern: /exif/i, label: 'Exif' },
  { pattern: /\bmake\b/i, label: 'Make' },
];

const MAX_SCAN_WINDOW = 262_144; // 256 KB head/tail window for large files

function decodeLatin1(bytes: Uint8Array): string {
  const decoder = new TextDecoder('latin1');
  if (bytes.length <= MAX_SCAN_WINDOW * 2) {
    return decoder.decode(bytes);
  }
  const head = decoder.decode(bytes.subarray(0, MAX_SCAN_WINDOW));
  const tail = decoder.decode(bytes.subarray(bytes.length - MAX_SCAN_WINDOW));
  return `${head}\n${tail}`;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function extractPngMetadataText(bytes: Uint8Array): string {
  const decoder = new TextDecoder('latin1');
  const parts: string[] = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) >>> 0) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) {
      break;
    }

    if (
      type === 'tEXt' ||
      type === 'iTXt' ||
      type === 'zTXt' ||
      type === 'eXIf' ||
      type === 'caBX'
    ) {
      parts.push(type);
      parts.push(decoder.decode(bytes.subarray(dataStart, dataEnd)));
    }

    offset = dataEnd + 4;
    if (type === 'IEND') {
      break;
    }
  }

  return parts.join('\n');
}

function extractJpegMetadataText(bytes: Uint8Array): string {
  const decoder = new TextDecoder('latin1');
  const parts: string[] = [];
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      break;
    }
    const marker = bytes[offset + 1];
    // SOS or EOI terminates header metadata segments
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    // Standalone markers without length
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) {
      break;
    }

    // APP0..APP15 (0xE0..0xEF) and COM (0xFE)
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      parts.push(
        decoder.decode(bytes.subarray(offset + 4, offset + 2 + segmentLength))
      );
    }

    offset += 2 + segmentLength;
  }

  return parts.join('\n');
}

function matchFirst(
  text: string,
  entries: readonly { pattern: RegExp; label: string }[]
): string | undefined {
  for (const entry of entries) {
    if (entry.pattern.test(text)) {
      return entry.label;
    }
  }
  return undefined;
}

/**
 * Lightweight browser-safe binary scanner over image bytes.
 * Scans JPEG/PNG metadata chunks and ASCII/UTF-8 windows without mutating `bytes`.
 */
export async function inspectProvenance(bytes: Uint8Array): Promise<Provenance> {
  if (bytes.length === 0) {
    return {};
  }

  const segments: string[] = [];
  if (isPng(bytes)) {
    segments.push(extractPngMetadataText(bytes));
  } else if (isJpeg(bytes)) {
    segments.push(extractJpegMetadataText(bytes));
  }
  segments.push(decodeLatin1(bytes));

  const corpus = segments.join('\n');
  const provenance: Provenance = {};

  const c2pa = matchFirst(corpus, C2PA_MARKERS);
  if (c2pa !== undefined) {
    provenance.c2paAiGenerator = c2pa;
  }

  const generator = matchFirst(corpus, GENERATOR_SIGNATURES);
  if (generator !== undefined) {
    provenance.generatorSignature = generator;
  }

  const camera = matchFirst(corpus, CAMERA_EXIF_MARKERS);
  if (camera !== undefined) {
    provenance.cameraExif = camera;
  }

  return provenance;
}
