import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';
import type { ServerRuntime } from '@/lib/server/runtime';

type RawHeaderMap = Record<string, string | readonly string[] | undefined>;

type MiddlewareRequest = {
  url?: string;
  method?: string;
  headers: RawHeaderMap;
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: unknown) => void): unknown;
};

type MiddlewareResponse = {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(chunk?: Uint8Array | string): unknown;
};

type ApiDispatcher = (
  req: Request,
  runtime?: ServerRuntime
) => Promise<Response | null>;

type ServerDeps = {
  handlers: typeof import('@/lib/server/handlers');
  runtime: typeof import('@/lib/server/runtime');
};

const textEncoder = new TextEncoder();

let cachedServerDeps: Promise<ServerDeps> | null = null;

function loadServerDeps(): Promise<ServerDeps> {
  if (!cachedServerDeps) {
    cachedServerDeps = Promise.all([
      import('@/lib/server/handlers'),
      import('@/lib/server/runtime'),
    ]).then(([handlers, runtime]) => ({ handlers, runtime }));
  }
  return cachedServerDeps;
}

function methodNotAllowedResponse(allowedMethod: 'GET' | 'POST'): Response {
  return new Response(
    JSON.stringify({
      error: `Method not allowed. Use ${allowedMethod}.`,
    }),
    {
      status: 405,
      headers: {
        Allow: allowedMethod,
        'Content-Type': 'application/json; charset=utf-8',
      },
    }
  );
}

export async function dispatchApiRequest(
  req: Request,
  runtime?: ServerRuntime
): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  const method = req.method.toUpperCase();

  switch (pathname) {
    case '/api/ingest':
      if (method !== 'POST') return methodNotAllowedResponse('POST');
      break;
    case '/api/ingest/email':
      if (method !== 'POST') return methodNotAllowedResponse('POST');
      break;
    case '/api/ingest/pull':
      if (method !== 'GET') return methodNotAllowedResponse('GET');
      break;
    case '/api/ingest/ack':
      if (method !== 'POST') return methodNotAllowedResponse('POST');
      break;
    case '/api/decide':
      if (method !== 'POST') return methodNotAllowedResponse('POST');
      break;
    default:
      return null;
  }

  const { handlers, runtime: runtimeMod } = await loadServerDeps();
  const rt = runtime ?? runtimeMod.getServerRuntime();

  switch (pathname) {
    case '/api/ingest':
      return handlers.createIngestPostHandler(rt)(req);
    case '/api/ingest/email':
      return handlers.createIngestEmailPostHandler(rt)(req);
    case '/api/ingest/pull':
      return handlers.createIngestPullGetHandler(rt)(req);
    case '/api/ingest/ack':
      return handlers.createIngestAckPostHandler(rt)(req);
    case '/api/decide':
      return handlers.createDecidePostHandler({
        tokenRegistry: rt.tokenRegistry,
        rateLimiter: rt.rateLimiter,
        logger: rt.logger,
        now: rt.now,
        aiProvider: rt.aiProvider,
      })(req);
    default:
      return null;
  }
}

function concatUint8Arrays(chunks: readonly Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.byteLength;
  }
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function readRequestBody(req: MiddlewareRequest): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        chunks.push(textEncoder.encode(chunk));
      } else if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(concatUint8Arrays(chunks)));
    req.on('error', reject);
  });
}

function toWebHeaders(rawHeaders: RawHeaderMap): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    } else if (typeof value === 'string') {
      headers.set(key, value);
    }
  }
  return headers;
}

function createApiMiddleware(
  resolveDispatcher: () => Promise<ApiDispatcher>,
  runtime?: ServerRuntime
): Connect.NextHandleFunction {
  return (rawReq, rawRes, next) => {
    const req = rawReq as unknown as MiddlewareRequest;
    const res = rawRes as unknown as MiddlewareResponse;

    const urlPath = req.url ?? '';
    if (!urlPath.startsWith('/api/')) {
      next();
      return;
    }

    void (async () => {
      const hostHeader = req.headers.host;
      const host =
        typeof hostHeader === 'string' && hostHeader.length > 0
          ? hostHeader
          : 'localhost';
      const fullUrl = new URL(urlPath, `http://${host}`).toString();
      const method = (req.method ?? 'GET').toUpperCase();
      const headers = toWebHeaders(req.headers);

      let webReq: Request;
      if (method === 'GET' || method === 'HEAD') {
        webReq = new Request(fullUrl, { method, headers });
      } else {
        const bodyBytes = await readRequestBody(req);
        webReq = new Request(fullUrl, {
          method,
          headers,
          body: bodyBytes.buffer.slice(
            bodyBytes.byteOffset,
            bodyBytes.byteOffset + bodyBytes.byteLength
          ) as ArrayBuffer,
        });
      }

      const dispatch = await resolveDispatcher();
      const response = await dispatch(webReq, runtime);
      if (response === null) {
        next();
        return;
      }

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (response.status === 204 || response.status === 304) {
        res.end();
        return;
      }

      const responseBytes = new Uint8Array(await response.arrayBuffer());
      res.end(responseBytes);
    })().catch((err) => {
      next(err);
    });
  };
}

function createDevDispatcherLoader(
  server: ViteDevServer
): () => Promise<ApiDispatcher> {
  let cached: Promise<ApiDispatcher> | null = null;
  return () => {
    if (typeof server.ssrLoadModule !== 'function') {
      return Promise.resolve(dispatchApiRequest);
    }
    if (!cached) {
      cached = server
        .ssrLoadModule('/src/lib/server/viteApiPlugin.ts')
        .then((mod) => (mod as { dispatchApiRequest: ApiDispatcher }).dispatchApiRequest);
    }
    return cached;
  };
}

function createPreviewDispatcherLoader(
  server: PreviewServer
): () => Promise<ApiDispatcher> {
  let cached: Promise<ApiDispatcher> | null = null;
  return () => {
    if (!cached) {
      cached = (async (): Promise<ApiDispatcher> => {
        try {
          await loadServerDeps();
          return dispatchApiRequest;
        } catch {
          const { createServer } = await import('vite');
          const ssrServer = await createServer({
            server: { middlewareMode: true },
            appType: 'custom',
          });
          const httpServer = server.httpServer as
            | { once?: (event: string, listener: () => void) => void }
            | undefined;
          httpServer?.once?.('close', () => {
            void ssrServer.close();
          });
          const mod = await ssrServer.ssrLoadModule(
            '/src/lib/server/viteApiPlugin.ts'
          );
          return (mod as { dispatchApiRequest: ApiDispatcher }).dispatchApiRequest;
        }
      })();
    }
    return cached;
  };
}

export function seniorCompanionApiPlugin(runtime?: ServerRuntime): Plugin {
  return {
    name: 'senior-companion-api',
    configureServer(server) {
      server.middlewares.use(
        createApiMiddleware(createDevDispatcherLoader(server), runtime)
      );
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        createApiMiddleware(createPreviewDispatcherLoader(server), runtime)
      );
    },
  };
}
