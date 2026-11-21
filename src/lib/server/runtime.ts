import { TokenRegistry } from '@/lib/server/auth';
import { createGeminiAiProvider } from '@/lib/server/geminiProvider';
import { createRateLimiter, type RateLimiter } from '@/lib/server/rateLimit';
import { EncryptedRelayStore } from '@/lib/server/relay';
import { createSafeLogger, type SafeLogger } from '@/lib/server/safeLog';
import type { DecideAiProvider } from '@/lib/server/handlers';

export type ServerRuntime = {
  tokenRegistry: TokenRegistry;
  rateLimiter: RateLimiter;
  relay: EncryptedRelayStore;
  logger: SafeLogger;
  now: () => number;
  aiProvider?: DecideAiProvider;
  env?: Record<string, string | undefined>;
};

function createDefaultRuntime(): ServerRuntime {
  return {
    tokenRegistry: new TokenRegistry(),
    rateLimiter: createRateLimiter(),
    relay: new EncryptedRelayStore(),
    logger: createSafeLogger(),
    now: () => Date.now(),
    aiProvider: createGeminiAiProvider(),
  };
}

let currentRuntime: ServerRuntime = createDefaultRuntime();

export function getServerRuntime(): ServerRuntime {
  return currentRuntime;
}

export function setServerRuntime(runtime: ServerRuntime): void {
  currentRuntime = runtime;
}

export function resetServerRuntime(): void {
  currentRuntime = createDefaultRuntime();
}
