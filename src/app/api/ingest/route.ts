import { createIngestPostHandler } from '@/lib/server/handlers';
import { getServerRuntime } from '@/lib/server/runtime';

export async function POST(req: Request): Promise<Response> {
  const handler = createIngestPostHandler(getServerRuntime());
  return handler(req);
}
