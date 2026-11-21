import type { RedFlagCategory, Verdict } from '@/lib/types';
import { extractLinks } from './links';

export type ScamCheckOutput = Verdict & {
  instruction?: string;
  showAskFamily: boolean;
};

const SAFE_REASON =
  'No urgency, secrecy, payment demands, or mismatched link addresses were found.';

const DANGER_INSTRUCTION = 'Do not click or pay';
const CAUTION_INSTRUCTION =
  'Hang up and call back using a number saved in your contacts';

const URGENCY_PATTERNS: readonly RegExp[] = [
  /\burgent\b/i,
  /\bimmediately\b/i,
  /\bright\s+now\b/i,
  /\bact\s+now\b/i,
  /\bwithin\s+24\s+hours\b/i,
  /\baccount\s+suspended\b/i,
  /\bcard\s+blocked\b/i,
  /\bemergency\b/i,
  /\bhurry\b/i,
  /\blast\s+warning\b/i,
];

const SECRECY_PATTERNS: readonly RegExp[] = [
  /\bdon['’]?t\s+tell\b/i,
  /\bdo\s+not\s+tell\b/i,
  /\bkeep\s+this\s+secret\b/i,
  /\btell\s+no\s+one\b/i,
  /\bbetween\s+us\b/i,
  /\bdon['’]?t\s+mention\s+to\s+family\b/i,
  /\bdo\s+not\s+mention\s+to\s+family\b/i,
];

const PAYMENT_PATTERNS: readonly RegExp[] = [
  /\bgift\s+cards?\b/i,
  /\bwire\s+transfers?\b/i,
  /\bpay\s+now\b/i,
  /\bsend\s+money\b/i,
  /\bbank\s+transfers?\b/i,
  /\bcrypto\b/i,
  /\bbitcoin\b/i,
  /\bpin\b/i,
  /\botp\b/i,
  /\bverification\s+codes?\b/i,
  /\brm\b|\brm\d+/i,
  /\bfees?\b/i,
  /\bbail\b/i,
];

const KNOWN_ORGS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\bmaybank\b/i, name: 'Maybank' },
  { pattern: /\bcimb\b/i, name: 'CIMB' },
  { pattern: /\blhdn\b/i, name: 'LHDN' },
  { pattern: /\bpos\s*laju\b|\bposlaju\b/i, name: 'PosLaju' },
  { pattern: /\btnb\b/i, name: 'TNB' },
  { pattern: /\bkwsp\b/i, name: 'KWSP' },
  { pattern: /\bepf\b/i, name: 'EPF' },
  { pattern: /\bclinic\b/i, name: 'Clinic' },
];

const MULTI_PART_TLDS = new Set([
  'com.my',
  'gov.my',
  'org.my',
  'net.my',
  'edu.my',
  'co.uk',
  'org.uk',
  'gov.uk',
  'com.sg',
  'gov.sg',
  'org.sg',
  'com.au',
  'co.nz',
  'co.jp',
]);

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function detectClaimedOrg(text: string, ctx?: { claimedOrg?: string }): string | undefined {
  const explicit = ctx?.claimedOrg?.trim();
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const fromMatch = /\bfrom\s+([A-Za-z][A-Za-z0-9 &'-]{1,40}?)\s*:/i.exec(text);
  if (fromMatch && fromMatch[1].trim().length > 0) {
    return fromMatch[1].trim();
  }

  for (const org of KNOWN_ORGS) {
    if (org.pattern.test(text)) {
      return org.name;
    }
  }

  return undefined;
}

function getRegistrablePrimarySlug(domain: string): string {
  const parts = domain
    .toLowerCase()
    .split('.')
    .filter((p) => p.length > 0);
  if (parts.length === 0) {
    return '';
  }

  let primaryLabel: string;
  if (parts.length >= 3) {
    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (MULTI_PART_TLDS.has(lastTwo)) {
      primaryLabel = parts[parts.length - 3];
    } else {
      primaryLabel = parts[parts.length - 2];
    }
  } else if (parts.length === 2) {
    primaryLabel = parts[0];
  } else {
    primaryLabel = parts[0];
  }

  return primaryLabel.replace(/[^a-z0-9]/g, '');
}

const OFFICIAL_ORG_DOMAIN_ALIASES = new Map<string, readonly string[]>([
  ['maybank', ['maybank2u']],
  ['cimb', ['cimbclicks']],
  ['lhdn', ['hasil']],
  ['poslaju', ['pos']],
  ['tnb', ['mytnb']],
  ['kwsp', ['epf']],
  ['epf', ['kwsp']],
]);

const LEGITIMATE_ORG_TLDS = new Set([
  'com',
  'com.my',
  'gov.my',
  'org.my',
  'my',
  'net',
]);

function getDomainSuffix(domain: string): string {
  const parts = domain
    .toLowerCase()
    .split('.')
    .filter((p) => p.length > 0);
  if (parts.length < 2) {
    return '';
  }
  if (parts.length >= 3) {
    const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (MULTI_PART_TLDS.has(lastTwo)) {
      return lastTwo;
    }
  }
  return parts[parts.length - 1];
}

function domainMatchesOrg(domain: string, claimedOrg: string): boolean {
  const orgSlug = claimedOrg.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (orgSlug.length === 0) {
    return true;
  }

  const primarySlug = getRegistrablePrimarySlug(domain);
  const aliases = OFFICIAL_ORG_DOMAIN_ALIASES.get(orgSlug);
  const slugMatches =
    primarySlug === orgSlug ||
    Boolean(aliases && aliases.includes(primarySlug));

  if (!slugMatches) {
    return false;
  }

  if (aliases !== undefined) {
    return LEGITIMATE_ORG_TLDS.has(getDomainSuffix(domain));
  }

  return true;
}

function truncateForReason(value: string, maxLen: number): string {
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxLen - 3))}...`;
}

function buildDomainMismatchReason(domain: string, claimedOrg: string): string {
  const cleanDomain = truncateForReason(domain.trim(), 52);
  const cleanOrg = truncateForReason(claimedOrg.trim(), 52);
  const reason = `Domain mismatch: "${cleanDomain}" does not match ${cleanOrg}.`;
  return reason.length <= 150 ? reason : reason.slice(0, 150);
}

/**
 * Deterministic, zero-network scam risk checker.
 */
export function checkText(
  text: string,
  ctx?: { claimedOrg?: string }
): ScamCheckOutput {
  const hasUrgency = matchesAny(text, URGENCY_PATTERNS);
  const hasSecrecy = matchesAny(text, SECRECY_PATTERNS);
  const hasPayment = matchesAny(text, PAYMENT_PATTERNS);

  const claimedOrg = detectClaimedOrg(text, ctx);
  const links = extractLinks(text);
  let mismatchedDomain: string | undefined;

  if (claimedOrg !== undefined && links.length > 0) {
    const mismatch = links.find((link) => !domainMatchesOrg(link.domain, claimedOrg));
    if (mismatch) {
      mismatchedDomain = mismatch.domain;
    }
  }

  const hasDomainMismatch = mismatchedDomain !== undefined && claimedOrg !== undefined;

  const flags: RedFlagCategory[] = [];
  if (hasUrgency) flags.push('urgency');
  if (hasSecrecy) flags.push('secrecy');
  if (hasPayment) flags.push('payment');
  if (hasDomainMismatch) flags.push('domain-mismatch');

  if (flags.length === 0) {
    return {
      value: 'safe',
      flags: [],
      reasons: [SAFE_REASON],
      showAskFamily: false,
    };
  }

  const reasons: string[] = [];
  if (flags.length === 4 && mismatchedDomain !== undefined && claimedOrg !== undefined) {
    reasons.push(
      'This message uses urgency and secrecy to rush you and keep it from family.'
    );
    reasons.push(
      'This message asks for payment, money, or secret verification codes.'
    );
    reasons.push(buildDomainMismatchReason(mismatchedDomain, claimedOrg));
  } else {
    if (hasUrgency) {
      reasons.push('This message uses urgency to rush you into acting quickly.');
    }
    if (hasSecrecy) {
      reasons.push(
        'This message asks for secrecy and tells you not to tell family.'
      );
    }
    if (hasPayment) {
      reasons.push(
        'This message asks for payment, money, or secret verification codes.'
      );
    }
    if (hasDomainMismatch && mismatchedDomain !== undefined && claimedOrg !== undefined) {
      reasons.push(buildDomainMismatchReason(mismatchedDomain, claimedOrg));
    }
  }

  const isDanger =
    (hasPayment && hasUrgency) ||
    (hasSecrecy && (hasPayment || hasUrgency)) ||
    (hasDomainMismatch && (hasPayment || hasUrgency));

  if (isDanger) {
    return {
      value: 'danger',
      flags,
      reasons,
      instruction: DANGER_INSTRUCTION,
      showAskFamily: true,
    };
  }

  return {
    value: 'caution',
    flags,
    reasons,
    instruction: CAUTION_INSTRUCTION,
    showAskFamily: false,
  };
}
