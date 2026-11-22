import { describe, expect, it, vi } from 'vitest';
import type { PreviewServer, ResolvedConfig, ViteDevServer } from 'vite';

const mockLoadEnv = vi.fn<
  (mode: string, envDir: string, prefixes?: string | string[]) => Record<string, string>
>(() => ({}));

vi.mock('vite', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite')>();
  return {
    ...actual,
    loadEnv: (mode: string, envDir: string, prefixes?: string | string[]) =>
      mockLoadEnv(mode, envDir, prefixes),
  };
});

function getProcessEnv(): Record<string, string | undefined> {
  return (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env ?? {};
}
import { TokenRegistry } from '@/lib/server/auth';
import { createRateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { createSafeLogger } from '@/lib/server/safeLog';
import type { ServerRuntime } from '@/lib/server/runtime';
import {
  dispatchApiRequest,
  seniorCompanionApiPlugin,
} from '@/lib/server/viteApiPlugin';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function createTestRuntime(): ServerRuntime {
  return {
    tokenRegistry: new TokenRegistry(),
    rateLimiter: createRateLimiter(),
    relay: new EncryptedRelayStore(),
    logger: createSafeLogger(),
    now: () => 1_750_000_000_000,
  };
}

type MockRequest = {
  url: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
};

type MockResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: Uint8Array | string) => void;
};

type MockMiddleware = (
  req: MockRequest,
  res: MockResponse,
  next: (err?: unknown) => void
) => void;

function createMockRequest(init: {
  url: string;
  method: string;
  headers?: Record<string, string>;
}): MockRequest {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    url: init.url,
    method: init.method,
    headers: init.headers ?? {},
    on(event: string, listener: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
  };
}

async function runMiddleware(
  middleware: MockMiddleware,
  init: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{
  calledNext: boolean;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  const req = createMockRequest(init);
  const headers: Record<string, string> = {};
  let calledNext = false;
  let statusCode = 0;
  let body = '';

  await new Promise<void>((resolve, reject) => {
    const res: MockResponse = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk?: Uint8Array | string) {
        statusCode = res.statusCode;
        if (chunk !== undefined) {
          body += typeof chunk === 'string' ? chunk : textDecoder.decode(chunk);
        }
        resolve();
      },
    };

    middleware(req, res, (err) => {
      if (err !== undefined) {
        reject(err);
        return;
      }
      calledNext = true;
      resolve();
    });

    queueMicrotask(() => {
      if (init.body !== undefined) {
        req.emit('data', textEncoder.encode(init.body));
      }
      req.emit('end');
    });
  });

  return { calledNext, statusCode, headers, body };
}

describe('Task 2: Vite API Middleware Dispatcher (/api/*)', () => {
  it('viteApiPlugin dispatches POST /api/ingest/email, GET /api/ingest/pull, and POST /api/ingest/ack end-to-end', async () => {
    const rt = createTestRuntime();
    const authHeader = {
      Authorization: 'Bearer dev-senior-token-1',
      'Content-Type': 'application/json',
    };

    const emailRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/email', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          sender: 'City Clinic <appointments@cityclinic.org>',
          subject: 'Eye Checkup Reminder',
          body: 'Your appointment is on 2026-07-20 at 09:30.',
          receivedAt: '2026-07-15T08:00:00.000Z',
        }),
      }),
      rt
    );
    expect(emailRes).not.toBeNull();
    expect(emailRes!.status).toBe(200);
    const emailJson = (await emailRes!.json()) as { ok: boolean; id: string };
    expect(emailJson.ok).toBe(true);

    const pullRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/pull', {
        method: 'GET',
        headers: { Authorization: 'Bearer dev-senior-token-1' },
      }),
      rt
    );
    expect(pullRes).not.toBeNull();
    expect(pullRes!.status).toBe(200);
    const pullJson = (await pullRes!.json()) as {
      items: Array<{ id: string; draft: { source: string; text: string } }>;
    };
    expect(pullJson.items).toHaveLength(1);
    expect(pullJson.items[0].draft.source).toBe('email');
    expect(pullJson.items[0].draft.text).toContain('Eye Checkup Reminder');
    expect(pullJson.items[0].draft.text).toContain('2026-07-20');

    const ackRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/ack', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({ ids: [pullJson.items[0].id] }),
      }),
      rt
    );
    expect(ackRes).not.toBeNull();
    expect(ackRes!.status).toBe(204);

    const pullAfterAck = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest/pull', {
        method: 'GET',
        headers: { Authorization: 'Bearer dev-senior-token-1' },
      }),
      rt
    );
    const pullAfterJson = (await pullAfterAck!.json()) as { items: unknown[] };
    expect(pullAfterJson.items).toHaveLength(0);
  });

  it('dispatches POST /api/ingest and POST /api/decide cleanly', async () => {
    const rt = createTestRuntime();
    const authHeader = {
      Authorization: 'Bearer dev-senior-token-1',
      'Content-Type': 'application/json',
    };

    const ingestRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/ingest', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          source: 'sms',
          sender: 'Clinic Desk',
          text: 'Reminder: dental visit on 2026-08-01 at 11:00.',
        }),
      }),
      rt
    );
    expect(ingestRes).not.toBeNull();
    expect(ingestRes!.status).toBe(200);
    const ingestJson = (await ingestRes!.json()) as { ok: boolean; id: string };
    expect(ingestJson.ok).toBe(true);

    const decideRes = await dispatchApiRequest(
      new Request('http://localhost:5173/api/decide', {
        method: 'POST',
        headers: authHeader,
        body: JSON.stringify({
          item: {
            channel: 'email',
            text: 'City Clinic appointment reminder on 2026-07-20 at 09:30.',
          },
        }),
      }),
      rt
    );
    expect(decideRes).not.toBeNull();
    expect(decideRes!.status).toBe(200);
    const decideJson = (await decideRes!.json()) as {
      group: string;
      priority: string;
      confidence: number;
    };
    expect(decideJson.group).toBe('Personal');
    expect(decideJson.priority).toBe('Important');
    expect(decideJson.confidence).toBeGreaterThan(0);
  });

  it('returns null for non-API routes and 405 for unsupported HTTP methods on API routes', async () => {
    const rt = createTestRuntime();
    const nonApi = await dispatchApiRequest(
      new Request('http://localhost:5173/inbox', { method: 'GET' }),
      rt
    );
    expect(nonApi).toBeNull();

    const unknownApi = await dispatchApiRequest(
      new Request('http://localhost:5173/api/unknown', { method: 'GET' }),
      rt
    );
    expect(unknownApi).toBeNull();

    for (const [path, wrongMethod] of [
      ['/api/ingest', 'GET'],
      ['/api/ingest/email', 'GET'],
      ['/api/ingest/pull', 'POST'],
      ['/api/ingest/ack', 'GET'],
      ['/api/decide', 'GET'],
      ['/api/scam-check', 'GET'],
      ['/api/calendar-plan', 'GET'],
    ] as const) {
      const res = await dispatchApiRequest(
        new Request(`http://localhost:5173${path}`, { method: wrongMethod }),
        rt
      );
      expect(res).not.toBeNull();
      expect(res!.status).toBe(405);
    }
  });

  it('seniorCompanionApiPlugin mounts Connect middleware on configureServer and configurePreviewServer', async () => {
    const rt = createTestRuntime();
    const plugin = seniorCompanionApiPlugin(rt);
    expect(plugin.name).toBe('senior-companion-api');

    const devMiddlewares: MockMiddleware[] = [];
    const previewMiddlewares: MockMiddleware[] = [];

    if (typeof plugin.configureServer === 'function') {
      plugin.configureServer({
        middlewares: {
          use: (mw: MockMiddleware) => {
            devMiddlewares.push(mw);
          },
        },
      } as unknown as ViteDevServer);
    }

    if (typeof plugin.configurePreviewServer === 'function') {
      plugin.configurePreviewServer({
        middlewares: {
          use: (mw: MockMiddleware) => {
            previewMiddlewares.push(mw);
          },
        },
      } as unknown as PreviewServer);
    }

    expect(devMiddlewares).toHaveLength(1);
    expect(previewMiddlewares).toHaveLength(1);

    const nonApi = await runMiddleware(devMiddlewares[0], {
      url: '/inbox',
      method: 'GET',
    });
    expect(nonApi.calledNext).toBe(true);

    const postRes = await runMiddleware(devMiddlewares[0], {
      url: '/api/ingest/email',
      method: 'POST',
      headers: {
        host: 'localhost:5173',
        authorization: 'Bearer dev-senior-token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'clinic@example.org',
        subject: 'Middleware Check',
        body: 'Appointment confirmed for 2026-08-05 at 10:00.',
      }),
    });

    expect(postRes.calledNext).toBe(false);
    expect(postRes.statusCode).toBe(200);
    expect(postRes.headers['content-type']).toContain('application/json');
    const parsed = JSON.parse(postRes.body) as { ok: boolean; id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.id.length).toBeGreaterThan(0);

    const pullRes = await runMiddleware(previewMiddlewares[0], {
      url: '/api/ingest/pull',
      method: 'GET',
      headers: {
        host: 'localhost:4173',
        authorization: 'Bearer dev-senior-token-1',
      },
    });

    expect(pullRes.calledNext).toBe(false);
    expect(pullRes.statusCode).toBe(200);
    const pulled = JSON.parse(pullRes.body) as {
      items: Array<{ id: string; draft: { text: string } }>;
    };
    expect(pulled.items).toHaveLength(1);
    expect(pulled.items[0].draft.text).toContain('Middleware Check');

    const ackRes = await runMiddleware(previewMiddlewares[0], {
      url: '/api/ingest/ack',
      method: 'POST',
      headers: {
        host: 'localhost:4173',
        authorization: 'Bearer dev-senior-token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ids: [pulled.items[0].id] }),
    });
    expect(ackRes.calledNext).toBe(false);
    expect(ackRes.statusCode).toBe(204);
  });

  it('forwards rt.env to createDecidePostHandler and invokes rt.aiProvider with GEMINI_API_KEY on POST /api/decide', async () => {
    const receivedCalls: Array<{
      item: { channel: string; text: string };
      apiKey: string;
    }> = [];
    const rt: ServerRuntime = {
      ...createTestRuntime(),
      env: { GEMINI_API_KEY: 'live-test-key' },
      aiProvider: async (item, apiKey) => {
        receivedCalls.push({ item, apiKey });
        return {
          summary: {
            fromApp: 'Email',
            whoSent: 'Neighborhood Pharmacy',
            actionNeeded: 'Pick up prescription before 5 PM',
            text: 'Your prescription is ready for pickup at Neighborhood Pharmacy today.',
          },
          group: 'Personal',
          priority: 'Important',
          confidence: 0.96,
        };
      },
    };

    const res = await dispatchApiRequest(
      new Request('http://localhost:5173/api/decide', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer dev-senior-token-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: {
            channel: 'email',
            text: 'Your prescription is ready at Neighborhood Pharmacy.',
          },
        }),
      }),
      rt
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    expect(receivedCalls).toHaveLength(1);
    expect(receivedCalls[0].apiKey).toBe('live-test-key');
    expect(receivedCalls[0].item.channel).toBe('email');

    const bodyText = await res!.text();
    expect(bodyText).not.toContain('live-test-key');
    const parsed = JSON.parse(bodyText) as {
      summary: { whoSent: string; actionNeeded: string };
      group: string;
      priority: string;
      confidence: number;
    };
    expect(parsed.summary.whoSent).toBe('Neighborhood Pharmacy');
    expect(parsed.summary.actionNeeded).toBe('Pick up prescription before 5 PM');
    expect(parsed.group).toBe('Personal');
    expect(parsed.priority).toBe('Important');
    expect(parsed.confidence).toBe(0.96);
  });

  it('seniorCompanionApiPlugin loads .env.local via configResolved and passes GEMINI_API_KEY server-side to /api/decide', async () => {
    const env = getProcessEnv();
    const origGeminiKey = env.GEMINI_API_KEY;
    const origAiKey = env.AI_API_KEY;
    delete env.GEMINI_API_KEY;
    delete env.AI_API_KEY;

    mockLoadEnv.mockReset();
    mockLoadEnv.mockReturnValue({
      GEMINI_API_KEY: 'dotenv-local-secret-key',
    });

    try {
      let receivedKey = '';
      const rt: ServerRuntime = {
        ...createTestRuntime(),
        aiProvider: async (_item, apiKey) => {
          receivedKey = apiKey;
          return {
            summary: {
              fromApp: 'Email',
              whoSent: 'Family Doctor',
              actionNeeded: 'Bring medication list',
              text: 'Your doctor asked you to bring your medication list tomorrow.',
            },
            group: 'Personal',
            priority: 'Important',
            confidence: 0.91,
          };
        },
      };

      const plugin = seniorCompanionApiPlugin(rt);
      if (typeof plugin.configResolved === 'function') {
        plugin.configResolved({
          mode: 'development',
          root: '/fake/project-root',
          envDir: '/fake/env-dir',
        } as unknown as ResolvedConfig);
      }

      expect(mockLoadEnv).toHaveBeenCalledWith(
        'development',
        '/fake/env-dir',
        ''
      );

      const devMiddlewares: MockMiddleware[] = [];
      if (typeof plugin.configureServer === 'function') {
        plugin.configureServer({
          middlewares: {
            use: (mw: MockMiddleware) => {
              devMiddlewares.push(mw);
            },
          },
        } as unknown as ViteDevServer);
      }

      const res = await runMiddleware(devMiddlewares[0], {
        url: '/api/decide',
        method: 'POST',
        headers: {
          host: 'localhost:5173',
          authorization: 'Bearer dev-senior-token-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          item: {
            channel: 'email',
            text: 'Please bring your medication list tomorrow.',
          },
        }),
      });

      expect(res.statusCode).toBe(200);
      expect(receivedKey).toBe('dotenv-local-secret-key');
      expect(res.body).not.toContain('dotenv-local-secret-key');

      // Shell process.env takes precedence over .env.local
      env.GEMINI_API_KEY = 'shell-override-key';
      const res2 = await runMiddleware(devMiddlewares[0], {
        url: '/api/decide',
        method: 'POST',
        headers: {
          host: 'localhost:5173',
          authorization: 'Bearer dev-senior-token-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          item: {
            channel: 'email',
            text: 'Please bring your medication list tomorrow.',
          },
        }),
      });

      expect(res2.statusCode).toBe(200);
      expect(receivedKey).toBe('shell-override-key');
      expect(res2.body).not.toContain('shell-override-key');
    } finally {
      if (origGeminiKey === undefined) {
        delete env.GEMINI_API_KEY;
      } else {
        env.GEMINI_API_KEY = origGeminiKey;
      }
      if (origAiKey === undefined) {
        delete env.AI_API_KEY;
      } else {
        env.AI_API_KEY = origAiKey;
      }
      mockLoadEnv.mockReset();
    }
  });

  it('seniorCompanionApiPlugin dispatches POST /api/calendar-plan with server-side .env.local GEMINI_API_KEY without leaking key', async () => {
    const env = getProcessEnv();
    const origGeminiKey = env.GEMINI_API_KEY;
    const origAiKey = env.AI_API_KEY;
    delete env.GEMINI_API_KEY;
    delete env.AI_API_KEY;

    mockLoadEnv.mockReset();
    mockLoadEnv.mockReturnValue({
      GEMINI_API_KEY: 'dotenv-calendar-secret-key',
    });

    try {
      let receivedKey = '';
      let receivedToday = '';
      const rt: ServerRuntime = {
        ...createTestRuntime(),
        calendarPlanner: async (params, apiKey) => {
          receivedKey = apiKey;
          receivedToday = params.todayIso;
          return [
            {
              id: 'cal-ai-1',
              title: 'Dentist Visit',
              date: '2026-11-24',
              time: '14:30',
              location: 'Smile Clinic',
              category: 'Medical',
              confidence: 0.92,
            },
          ];
        },
      };

      const plugin = seniorCompanionApiPlugin(rt);
      if (typeof plugin.configResolved === 'function') {
        plugin.configResolved({
          mode: 'development',
          root: '/fake/project-root',
          envDir: '/fake/env-dir',
        } as unknown as ResolvedConfig);
      }

      const devMiddlewares: MockMiddleware[] = [];
      if (typeof plugin.configureServer === 'function') {
        plugin.configureServer({
          middlewares: {
            use: (mw: MockMiddleware) => {
              devMiddlewares.push(mw);
            },
          },
        } as unknown as ViteDevServer);
      }

      const res = await runMiddleware(devMiddlewares[0], {
        url: '/api/calendar-plan',
        method: 'POST',
        headers: {
          host: 'localhost:5173',
          authorization: 'Bearer dev-senior-token-1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              id: 'msg-1',
              text: 'Dentist next Tuesday at 2:30 PM at Smile Clinic',
            },
          ],
          todayIso: '2026-11-22',
        }),
      });

      expect(res.calledNext).toBe(false);
      expect(res.statusCode).toBe(200);
      expect(receivedKey).toBe('dotenv-calendar-secret-key');
      expect(receivedToday).toBe('2026-11-22');
      expect(res.body).not.toContain('dotenv-calendar-secret-key');

      const parsed = JSON.parse(res.body) as {
        source: 'ai' | 'device';
        candidates: Array<{
          title: string;
          date: string;
          time?: string;
          location?: string;
        }>;
      };
      expect(parsed.source).toBe('ai');
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]).toMatchObject({
        title: 'Dentist Visit',
        date: '2026-11-24',
        time: '14:30',
        location: 'Smile Clinic',
      });
    } finally {
      if (origGeminiKey === undefined) {
        delete env.GEMINI_API_KEY;
      } else {
        env.GEMINI_API_KEY = origGeminiKey;
      }
      if (origAiKey === undefined) {
        delete env.AI_API_KEY;
      } else {
        env.AI_API_KEY = origAiKey;
      }
      mockLoadEnv.mockReset();
    }
  });
});
