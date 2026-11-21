export const HSTS_HEADER = 'max-age=63072000; includeSubDomains; preload';

export function getSecurityHeaders(_req: Request): Record<string, string> {
  return {
    'Strict-Transport-Security': HSTS_HEADER,
  };
}

export function applyHstsHeader(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('Strict-Transport-Security', HSTS_HEADER);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export function enforceHttpsAndHsts(
  req: Request,
  nextResponse?: Response
): Response | null {
  const rawProto = req.headers.get('x-forwarded-proto');
  const proto = rawProto?.split(',')[0]?.trim().toLowerCase();

  if (proto === 'http') {
    const targetUrl = new URL(req.url);
    targetUrl.protocol = 'https:';

    return new Response(null, {
      status: 308,
      headers: {
        Location: targetUrl.toString(),
        ...getSecurityHeaders(req),
      },
    });
  }

  if (nextResponse) {
    return applyHstsHeader(nextResponse);
  }

  return null;
}

export function middleware(req: Request): Response | undefined {
  return enforceHttpsAndHsts(req) ?? undefined;
}
