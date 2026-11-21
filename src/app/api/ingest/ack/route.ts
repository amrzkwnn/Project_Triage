import { createIngestAckPostHandler } from '@/lib/server/handlers';
import { getServerRuntime } from '@/lib/server/runtime';

export async function POST(req: Request): Promise<Response> {
  const handler = createIngestAckPostHandler(getServerRuntime());
  return handler(req);
}
