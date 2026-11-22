import type {
  Channel,
  ClaritySummary,
  DetectedEvent,
  GroupCategory,
  PriorityType,
  Result,
  Verdict,
} from '@/lib/types';

export type DecideProxyRequest = {
  item: {
    channel: Channel;
    text: string;
  };
};

export type DecideProxyResponse = {
  summary?: Partial<ClaritySummary>;
  group?: GroupCategory;
  priority?: PriorityType;
  confidence?: number;
  scamWarning?: Verdict;
  detectedEvent?: DetectedEvent;
};

export type DecideProxyError = {
  reason: 'timeout' | 'network' | 'bad-status';
  message: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ENDPOINT = '/api/decide';
const DEFAULT_PROXY_TOKEN = 'dev-senior-token-1';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function buildDecideProxyRequest(item: {
  source: Channel;
  text: string;
}): DecideProxyRequest {
  return {
    item: {
      channel: item.source,
      text: item.text,
    },
  };
}

export async function callDecideProxy(
  item: { source: Channel; text: string },
  deps?: {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
    endpoint?: string;
    token?: string;
    allowedCategories?: readonly string[];
  }
): Promise<Result<DecideProxyResponse, DecideProxyError>> {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = deps?.endpoint ?? DEFAULT_ENDPOINT;
  const token = deps?.token ?? DEFAULT_PROXY_TOKEN;

  if (typeof fetchFn !== 'function') {
    return {
      ok: false,
      error: {
        reason: 'network',
        message: 'Could not reach the check service right now.',
      },
    };
  }

  const payload = buildDecideProxyRequest(item);
  const controller = new AbortController();
  let timedOut = false;
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      const timeoutErr = new Error('Request timed out');
      timeoutErr.name = 'AbortError';
      reject(timeoutErr);
    }, timeoutMs);
  });

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token.trim().length > 0) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    if (Array.isArray(deps?.allowedCategories) && deps.allowedCategories.length > 0) {
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const rawCat of deps.allowedCategories) {
        if (typeof rawCat !== 'string') continue;
        const trimmed = rawCat.trim().replace(/\s+/g, ' ');
        const lower = trimmed.toLowerCase();
        if (
          trimmed.length === 0 ||
          lower === 'all' ||
          lower === 'promotion' ||
          seen.has(lower)
        ) {
          continue;
        }
        seen.add(lower);
        cleaned.push(trimmed);
        if (cleaned.length >= 20) break;
      }
      if (cleaned.length > 0) {
        headers['x-inbox-categories'] = cleaned
          .map((c) => encodeURIComponent(c))
          .join(',');
      }
    }

    const fetchPromise = Promise.resolve().then(() =>
      fetchFn(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    );
    // Avoid unhandled rejection if the timeout wins the race before fetch settles
    fetchPromise.catch(() => {});

    const response = await Promise.race([fetchPromise, timeoutPromise]);

    if (!response.ok) {
      return {
        ok: false,
        error: {
          reason: 'bad-status',
          message: 'The check service could not answer right now.',
        },
      };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        ok: false,
        error: {
          reason: 'bad-status',
          message: 'The check service sent an unreadable answer.',
        },
      };
    }

    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        error: {
          reason: 'bad-status',
          message: 'The check service sent an unreadable answer.',
        },
      };
    }

    return {
      ok: true,
      value: parsed as DecideProxyResponse,
    };
  } catch (err) {
    const isAbort =
      timedOut ||
      controller.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError');

    if (isAbort) {
      return {
        ok: false,
        error: {
          reason: 'timeout',
          message: 'The check took too long.',
        },
      };
    }

    return {
      ok: false,
      error: {
        reason: 'network',
        message: 'Could not reach the check service right now.',
      },
    };
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}
