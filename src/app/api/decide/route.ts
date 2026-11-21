import { createDecidePostHandler } from '@/lib/server/handlers';
import { getServerRuntime } from '@/lib/server/runtime';

export async function POST(req: Request): Promise<Response> {
  const rt = getServerRuntime();
  const handler = createDecidePostHandler({
    logger: rt.logger,
    now: rt.now,
    aiProvider: rt.aiProvider,
  });
  return handler(req);
}
