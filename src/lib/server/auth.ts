import { createHash } from 'node:crypto';

export const DEFAULT_DEV_TOKEN = 'dev-senior-token-1';
export const DEFAULT_DEV_SENIOR_ID = 'senior-1';

export type AuthSuccess = {
  ok: true;
  seniorId: string;
  tokenHash: string;
};

export type AuthFailure = {
  ok: false;
  status: 401;
  body: { error: string };
};

export type AuthResult = AuthSuccess | AuthFailure;

const UNAUTHORIZED_RESULT: AuthFailure = Object.freeze({
  ok: false,
  status: 401,
  body: Object.freeze({ error: 'Authentication required.' }),
});

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function extractRawToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== null) {
    const trimmed = authHeader.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const match = /^Bearer[ \t]+(\S+)$/i.exec(trimmed);
    return match ? match[1] : null;
  }

  const ingestHeader = req.headers.get('x-ingest-token');
  if (ingestHeader !== null) {
    const trimmed = ingestHeader.trim();
    if (trimmed.length === 0 || /\s/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  return null;
}

export type TokenRegistryOptions = {
  includeDefaultDevToken?: boolean;
  env?: Record<string, string | undefined>;
};

function getProcessEnv(): Record<string, string | undefined> {
  const g = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };
  return g.process?.env ?? {};
}

export class TokenRegistry {
  private readonly tokens = new Map<string, string>();

  constructor(opts?: TokenRegistryOptions) {
    const env = opts?.env ?? getProcessEnv();
    const shouldIncludeDefaultDevToken =
      opts?.includeDefaultDevToken ?? env.NODE_ENV !== 'production';

    if (shouldIncludeDefaultDevToken) {
      this.registerToken(DEFAULT_DEV_TOKEN, DEFAULT_DEV_SENIOR_ID);
    }

    const envToken = env.INGEST_API_TOKEN?.trim();
    if (envToken && envToken.length > 0) {
      const envSeniorId =
        env.INGEST_SENIOR_ID?.trim() || DEFAULT_DEV_SENIOR_ID;
      this.registerToken(envToken, envSeniorId);
    }
  }

  registerToken(rawToken: string, seniorId: string): string {
    if (typeof rawToken !== 'string' || rawToken.trim().length === 0) {
      throw new Error('Token must be a non-empty string.');
    }
    if (typeof seniorId !== 'string' || seniorId.trim().length === 0) {
      throw new Error('Senior ID must be a non-empty string.');
    }
    const tokenHash = hashToken(rawToken);
    this.tokens.set(tokenHash, seniorId.trim());
    return tokenHash;
  }

  revokeToken(rawToken: string): boolean {
    if (typeof rawToken !== 'string' || rawToken.length === 0) {
      return false;
    }
    return this.tokens.delete(hashToken(rawToken));
  }

  verifyToken(req: Request): AuthResult {
    const rawToken = extractRawToken(req);
    if (rawToken === null) {
      return UNAUTHORIZED_RESULT;
    }
    const tokenHash = hashToken(rawToken);
    const seniorId = this.tokens.get(tokenHash);
    if (seniorId === undefined) {
      return UNAUTHORIZED_RESULT;
    }
    return {
      ok: true,
      seniorId,
      tokenHash,
    };
  }
}

export function createTokenRegistry(
  opts?: TokenRegistryOptions
): TokenRegistry {
  return new TokenRegistry(opts);
}
