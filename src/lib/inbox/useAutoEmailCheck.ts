import React from 'react';
import type { Settings } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';

export const MAX_DISMISSED_ITEM_IDS = 500;
export const DEFAULT_AUTO_EMAIL_CHECK_INTERVAL_MS = 60_000;

export async function dismissItemLocally(params: {
  itemId: string;
  settings: Settings;
  vault?: Pick<Vault, 'deleteItem' | 'saveSettings'>;
}): Promise<
  { ok: true; settings: Settings } | { ok: false; errorMessage: string }
> {
  const { itemId, settings, vault } = params;
  const previousIds = Array.isArray(settings.dismissedItemIds)
    ? settings.dismissedItemIds
    : [];
  const deduped = previousIds.filter((id) => id !== itemId);
  const nextDismissedIds = [...deduped, itemId].slice(-MAX_DISMISSED_ITEM_IDS);

  const nextSettings: Settings = {
    ...settings,
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
