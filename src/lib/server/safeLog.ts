export type SafeLogRecord = {
  route: string;
  status: number;
  durationMs: number;
};

export type SafeLogger = {
  log: (record: SafeLogRecord) => string;
};

export const ALLOWED_LOG_ROUTES: ReadonlySet<string> = new Set([
  '/api/ingest',
  '/api/ingest/email',
  '/api/ingest/pull',
  '/api/ingest/ack',
  '/api/decide',
  'middleware',
]);

export function formatSafeLog(record: SafeLogRecord): string {
  const safeRoute =
    typeof record.route === 'string' && ALLOWED_LOG_ROUTES.has(record.route)
      ? record.route
      : 'unknown';

  const safeStatus =
    typeof record.status === 'number' &&
    Number.isInteger(record.status) &&
    record.status >= 100 &&
    record.status <= 599
      ? record.status
      : 0;

  const safeDurationMs =
    typeof record.durationMs === 'number' &&
    Number.isFinite(record.durationMs) &&
    record.durationMs >= 0
      ? Math.round(record.durationMs)
      : 0;

  return `route=${safeRoute} status=${safeStatus} durationMs=${safeDurationMs}`;
}

export function createSafeLogger(
  sink: (line: string) => void = (line) => {
    console.info(line);
  }
): SafeLogger {
  return {
    log(record: SafeLogRecord): string {
      const line = formatSafeLog({
        route: record.route,
        status: record.status,
        durationMs: record.durationMs,
      });
      sink(line);
      return line;
    },
  };
}
