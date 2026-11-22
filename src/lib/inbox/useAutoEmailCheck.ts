import React from 'react';
import type { Settings } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';

export const MAX_DISMISSED_ITEM_IDS = 500;
export const DEFAULT_AUTO_EMAIL_CHECK_INTERVAL_MS = 60_000;

const vaultWriteQueues = new WeakMap<object, Promise<unknown>>();

function serializeVaultOp<T>(
  vault: object | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!vault) {
    return fn();
  }
  const previous = vaultWriteQueues.get(vault);
  const run = previous ? previous.catch(() => undefined).then(fn) : fn();
  const tracked = run.finally(() => {
    if (vaultWriteQueues.get(vault) === tracked) {
      vaultWriteQueues.delete(vault);
    }
  });
  vaultWriteQueues.set(vault, tracked);
  return run;
}

function mergeDismissedIds(
  baseIds: readonly string[] | undefined,
  latestIds: readonly string[] | undefined,
  appendId?: string
): string[] {
  const combined: string[] = [];
  const appendUnique = (id: string) => {
    const existingIdx = combined.indexOf(id);
    if (existingIdx >= 0) {
      combined.splice(existingIdx, 1);
    }
    combined.push(id);
  };

  if (Array.isArray(baseIds)) {
    for (const id of baseIds) {
      appendUnique(id);
    }
  }
  if (Array.isArray(latestIds)) {
    for (const id of latestIds) {
      appendUnique(id);
    }
  }
  if (appendId !== undefined) {
    appendUnique(appendId);
  }
  return combined.slice(-MAX_DISMISSED_ITEM_IDS);
}

function mergePersistedSettings(
  fallback: Settings,
  latest: Settings | undefined
): Settings {
  if (!latest) {
    return fallback;
  }
  const mergedDismissed = mergeDismissedIds(
    fallback.dismissedItemIds,
    latest.dismissedItemIds
  );
  return {
    ...fallback,
    ...(latest.shortcutSetupCompleted || fallback.shortcutSetupCompleted
      ? { shortcutSetupCompleted: true }
      : {}),
    ...(Array.isArray(latest.inboxCategories)
      ? { inboxCategories: latest.inboxCategories }
      : {}),
    ...(mergedDismissed.length > 0
      ? { dismissedItemIds: mergedDismissed }
      : {}),
  };
}

export async function dismissItemLocally(params: {
  itemId: string;
  settings: Settings;
  vault?: Pick<Vault, 'deleteItem' | 'saveSettings'> &
    Partial<Pick<Vault, 'getSettings'>>;
}): Promise<
  { ok: true; settings: Settings } | { ok: false; errorMessage: string }
> {
  const { itemId, settings, vault } = params;

  return serializeVaultOp(vault, async () => {
    let latestFromVault: Settings | undefined;
    if (vault && typeof vault.getSettings === 'function') {
      const latestRes = await vault.getSettings();
      if (latestRes.ok) {
        latestFromVault = latestRes.value;
      }
    }

    const baseSettings = mergePersistedSettings(settings, latestFromVault);
    const nextDismissedIds = mergeDismissedIds(
      baseSettings.dismissedItemIds,
      undefined,
      itemId
    );

    const nextSettings: Settings = {
      ...baseSettings,
      dismissedItemIds: nextDismissedIds,
    };

    if (vault) {
      if (typeof vault.deleteItem === 'function') {
        const deleteRes = await vault.deleteItem(itemId);
        if (!deleteRes.ok) {
          return { ok: false, errorMessage: deleteRes.error.message };
        }
      }
      const saveRes = await vault.saveSettings(nextSettings);
      if (!saveRes.ok) {
        return { ok: false, errorMessage: saveRes.error.message };
      }
    }

    return { ok: true, settings: nextSettings };
  });
}

export async function completeShortcutSetupLocally(params: {
  settings: Settings;
  vault?: Pick<Vault, 'saveSettings'> & Partial<Pick<Vault, 'getSettings'>>;
}): Promise<
  { ok: true; settings: Settings } | { ok: false; errorMessage: string }
> {
  const { settings, vault } = params;

  return serializeVaultOp(vault, async () => {
    let latestFromVault: Settings | undefined;
    if (vault && typeof vault.getSettings === 'function') {
      const latestRes = await vault.getSettings();
      if (latestRes.ok) {
        latestFromVault = latestRes.value;
      }
    }

    const baseSettings = mergePersistedSettings(settings, latestFromVault);
    const nextSettings: Settings = {
      ...baseSettings,
      shortcutSetupCompleted: true,
    };

    if (vault) {
      const saveRes = await vault.saveSettings(nextSettings);
      if (!saveRes.ok) {
        return { ok: false, errorMessage: saveRes.error.message };
      }
    }

    return { ok: true, settings: nextSettings };
  });
}

export function useAutoEmailCheck(params: {
  enabled: boolean;
  intervalMs?: number;
  onCheck: () => Promise<void> | void;
}): void {
  const {
    enabled,
    intervalMs = DEFAULT_AUTO_EMAIL_CHECK_INTERVAL_MS,
    onCheck,
  } = params;

  const onCheckRef = React.useRef(onCheck);
  onCheckRef.current = onCheck;

  const inFlightRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const triggerCheck = () => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        const result = onCheckRef.current();
        Promise.resolve(result)
          .catch(() => undefined)
          .finally(() => {
            inFlightRef.current = false;
          });
      } catch {
        inFlightRef.current = false;
      }
    };

    const handleFocus = () => {
      triggerCheck();
    };

    const handleVisibilityChange = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        triggerCheck();
      }
    };

    const timerId = globalThis.setInterval(triggerCheck, intervalMs);

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('focus', handleFocus);
    }
    if (
      typeof document !== 'undefined' &&
      typeof document.addEventListener === 'function'
    ) {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      globalThis.clearInterval(timerId);
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('focus', handleFocus);
      }
      if (
        typeof document !== 'undefined' &&
        typeof document.removeEventListener === 'function'
      ) {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange
        );
      }
    };
  }, [enabled, intervalMs]);
}
