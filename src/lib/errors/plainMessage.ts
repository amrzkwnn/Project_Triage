const BANNED_ACTION_TOKENS =
  /\b(sync|token|api|cache|error\s+code|exception|stack|json|indexeddb|TypeError|RangeError|QuotaExceededError|SyntaxError|ReferenceError|URIError|ECONNREFUSED|ENOENT|ERR_[A-Z0-9_]+|404|500|502|503|504)\b/gi;

const MAX_ACTION_WORDS = 10;

function sanitizeAction(action: string): string {
  if (typeof action !== 'string') {
    return 'that step';
  }

  const stripped = action
    .replace(BANNED_ACTION_TOKENS, '')
    .replace(/Error:/gi, '')
    .replace(/\.(ts|js):\d+/gi, '')
    .replace(/[.;!?]+$/g, '')
    .trim();

  if (!stripped) {
    return 'that step';
  }

  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return 'that step';
  }

  return words.slice(0, MAX_ACTION_WORDS).join(' ');
}

function isConnectionIssue(err: unknown): boolean {
  if (!err) return false;

  const inspectText = (value: unknown): boolean =>
    typeof value === 'string' &&
    /econnrefused|network|offline|timeout|fetch failed/i.test(value);

  if (typeof err === 'string') {
    return inspectText(err);
  }

  if (typeof err === 'object') {
    const record = err as Record<string, unknown>;
    return (
      inspectText(record.code) ||
      inspectText(record.name) ||
      inspectText(record.message)
    );
  }

  return false;
}

export function toPlainMessage(err: unknown, action: string): string {
  const safeAction = sanitizeAction(action);
  const nextStep = isConnectionIssue(err)
    ? 'Please check your connection and try again.'
    : 'Please try again.';

  return `We could not ${safeAction}. ${nextStep}`;
}
