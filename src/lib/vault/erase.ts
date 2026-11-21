import type { Result } from '../types';
import type { OAuthTokenRecord, StoreError, Vault } from './schema';

async function revokeSingleTokenWithTimeout(
  rec: OAuthTokenRecord,
  revokeToken: (rec: OAuthTokenRecord, signal: AbortSignal) => Promise<void>,
  timeoutMs: number
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Token revocation timed out'));
    }, timeoutMs);
  });

  try {
    await Promise.race([revokeToken(rec, controller.signal), timeoutPromise]);
    return !controller.signal.aborted;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function eraseAllDataAndTokens(
  vault: Vault,
  deps?: {
    revokeToken?: (
      rec: OAuthTokenRecord,
      signal: AbortSignal
    ) => Promise<void>;
    timeoutMs?: number;
  }
): Promise<
  Result<
    {
      allRevoked: boolean;
      failedAccounts: string[];
      message: string;
      instructions?: string;
    },
    StoreError
  >
> {
  const timeoutMs = deps?.timeoutMs ?? 10000;
  const tokensRes = await vault.listOAuthTokens();
  const tokens = tokensRes.ok ? tokensRes.value : [];

  const failedAccounts: string[] = [];

  if (deps?.revokeToken) {
    for (const rec of tokens) {
      const ok = await revokeSingleTokenWithTimeout(
        rec,
        deps.revokeToken,
        timeoutMs
      );
      if (!ok) {
        failedAccounts.push(rec.account);
      }
    }
  }

  // Always erase all local Vault data and local OAuth tokens even if revocations fail
  const eraseRes = await vault.eraseAll();
  if (!eraseRes.ok) {
    return eraseRes;
  }

  if (failedAccounts.length === 0) {
    return {
      ok: true,
      value: {
        allRevoked: true,
        failedAccounts: [],
        message:
          'All your data and connected accounts have been erased from this device.',
      },
    };
  }

  const accountList = failedAccounts.join(', ');
  return {
    ok: true,
    value: {
      allRevoked: false,
      failedAccounts,
      message: `Your data on this device was erased, but we could not disconnect: ${accountList}.`,
      instructions: `Please open your email provider account settings and remove access for ${accountList}.`,
    },
  };
}
