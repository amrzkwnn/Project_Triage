export type ExtractedLink = {
  raw: string;
  domain: string;
};

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:)\]}'"]+$/;

function parseHostFromUrl(rawUrl: string): string | null {
  const schemeEnd = rawUrl.indexOf('://');
  if (schemeEnd === -1) {
    return null;
  }

  let remainder = rawUrl.slice(schemeEnd + 3);
  const pathStart = remainder.search(/[/?#]/);
  if (pathStart !== -1) {
    remainder = remainder.slice(0, pathStart);
  }

  // Strip optional userinfo (user:pass@host)
  const atIdx = remainder.lastIndexOf('@');
  if (atIdx !== -1) {
    remainder = remainder.slice(atIdx + 1);
  }

  // Handle bracketed IPv6 literal or strip optional :port
  let host = remainder;
  if (host.startsWith('[')) {
    const closeIdx = host.indexOf(']');
    if (closeIdx === -1) {
      return null;
    }
    host = host.slice(1, closeIdx);
  } else {
    const colonIdx = host.indexOf(':');
    if (colonIdx !== -1) {
      host = host.slice(0, colonIdx);
    }
  }

  const normalized = host.trim().toLowerCase().replace(/^www\./, '');
  if (normalized.length === 0 || !/[a-z0-9]/.test(normalized)) {
    return null;
  }

  return normalized;
}

/**
 * Pure string parser extracting http:// and https:// URLs and normalizing their host/domain.
 * Never makes any network requests or opens any URL.
 */
export function extractLinks(text: string): Array<{ raw: string; domain: string }> {
  const results: ExtractedLink[] = [];
  if (!text) {
    return results;
  }

  const matches = text.matchAll(URL_PATTERN);
  for (const match of matches) {
    const raw = match[0].replace(TRAILING_PUNCTUATION, '');
    const domain = parseHostFromUrl(raw);
    if (domain !== null) {
      results.push({ raw, domain });
    }
  }

  return results;
}
