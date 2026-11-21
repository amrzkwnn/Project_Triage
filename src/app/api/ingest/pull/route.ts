import { createIngestPullGetHandler } from '@/lib/server/handlers';
import { getServerRuntime } from '@/lib/server/runtime';

export async function GET(req: Request): Promise<Response> {
  const handler = createIngestPullGetHandler(getServerRuntime());
  return handler(req);
}
