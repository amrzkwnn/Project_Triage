export type SenderDisplay = { displayName: string; emailAddress?: string };

const ANGLE_EMAIL_PATTERN = /<\s*([^<>\s]+@[^<>\s]+)\s*>/;
const BARE_EMAIL_PATTERN = /[^\s<>"',;()]+@[^\s<>"',;()]+\.[^\s<>"',;()]+/;

export function extractEmailAddress(raw?: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const angle = ANGLE_EMAIL_PATTERN.exec(raw);
  if (angle) return angle[1].trim();
  const bare = BARE_EMAIL_PATTERN.exec(raw);
  return bare ? bare[0].trim() : undefined;
}

function clean(value?: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/^["']+|["']+$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseSenderDisplay(
  sender?: string,
  whoSent?: string,
  senderEmail?: string
): SenderDisplay {
  const email = extractEmailAddress(sender) ?? clean(senderEmail);

  let headerName: string | undefined;
  if (typeof sender === 'string') {
    const withoutEmail = ANGLE_EMAIL_PATTERN.test(sender)
      ? sender.replace(ANGLE_EMAIL_PATTERN, '')
      : sender;
    const candidate = clean(withoutEmail);
    headerName =
      candidate && !(email && candidate.toLowerCase() === email.toLowerCase())
        ? candidate
        : undefined;
  }

  const displayName =
    headerName ?? clean(whoSent) ?? email ?? 'Unknown sender';

  const emailAddress =
    email && email.toLowerCase() !== displayName.toLowerCase()
      ? email
      : undefined;

  return { displayName, emailAddress };
}
