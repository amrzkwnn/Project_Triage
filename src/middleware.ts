export const HSTS_HEADER = 'max-age=63072000; includeSubDomains; preload';

export function enforceHttpsAndHsts(req: Request): Response | null {
  const rawProto = req.headers.get('x-forwarded-proto');
  if (rawProto === null) {
    return null;
  }

  const proto = rawProto.split(',')[0]?.trim().toLowerCase();
  if (proto !== 'http') {
    return null;
  }

  const targetUrl = new URL(req.url);
  targetUrl.protocol = 'https:';

  return new Response(null, {
    status: 308,
    headers: {
      Location: targetUrl.toString(),
      'Strict-Transport-Security': HSTS_HEADER,
    },
  });
}

export function middleware(req: Request): Response | undefined {
  return enforceHttpsAndHsts(req) ?? undefined;
}
