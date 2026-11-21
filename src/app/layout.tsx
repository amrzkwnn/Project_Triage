'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import type { Vault } from '@/lib/vault/schema';
import { createVault } from '@/lib/vault/store';
import './globals.css';

export type StoreProbe =
  | Pick<Vault, 'getSettings'>
  | (() => Promise<boolean> | boolean);

export async function probeStoreUnavailable(
  vaultOrProbe?: StoreProbe
): Promise<boolean> {
  try {
    if (typeof vaultOrProbe === 'function') {
      return Boolean(await vaultOrProbe());
    }
    if (vaultOrProbe) {
      const res = await vaultOrProbe.getSettings();
      return !res.ok;
    }
    if (
      typeof window !== 'undefined' &&
      typeof globalThis.indexedDB === 'undefined'
    ) {
      return true;
    }
    const vault = createVault();
    const res = await vault.getSettings();
    return !res.ok;
  } catch {
    return true;
  }
}

export type AppShellProps = {
  children: React.ReactNode;
  isOffline?: boolean;
  storeUnavailable?: boolean;
  storeErrorMessage?: string;
  storeProbe?: StoreProbe;
  onNavigate?: (href: string) => void;
};

export function AppShell({
  children,
  isOffline,
  storeUnavailable,
  storeErrorMessage,
  storeProbe,
  onNavigate,
}: AppShellProps) {
  const [browserOffline, setBrowserOffline] = useState(false);
  const [detectedStoreUnavailable, setDetectedStoreUnavailable] =
    useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }
    setBrowserOffline(navigator.onLine === false);

    const handleOffline = () => setBrowserOffline(true);
    const handleOnline = () => setBrowserOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Offline helper registration is optional when unavailable
      });
    }

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  useEffect(() => {
    if (storeUnavailable !== undefined) {
      return;
    }
    let cancelled = false;
    void probeStoreUnavailable(storeProbe).then((unavailable) => {
      if (!cancelled) {
        setDetectedStoreUnavailable(unavailable);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [storeUnavailable, storeProbe]);

  const offline = isOffline !== undefined ? isOffline : browserOffline;
  const isStoreUnavailable =
    storeUnavailable !== undefined
      ? storeUnavailable
      : detectedStoreUnavailable;
  const fallbackMessage =
    storeErrorMessage ??
    'We could not load your saved data on this device right now. Your saved items stay safe, and you can still use the helper tools below.';

  const handleNavClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate(href);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#111827]">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="border-b-2 border-[#111827] bg-white">
        <div className="app-container flex flex-wrap items-center justify-between gap-4 py-4">
          <a
            href="/"
            onClick={(e) => handleNavClick(e, '/')}
            className="inline-flex min-h-[56px] items-center text-[22px] font-bold text-[#111827] no-underline"
          >
            My Daily Helper
          </a>

          <nav aria-label="Primary" className="flex flex-wrap items-center gap-3">
            <a
              href="/"
              onClick={(e) => handleNavClick(e, '/')}
              className="inline-flex min-h-[56px] min-w-[56px] items-center justify-center rounded-xl border-2 border-[#111827] bg-white px-4 py-2 text-[18px] font-semibold text-[#111827] no-underline hover:bg-[#F3F4F6]"
            >
              Home
            </a>
            <a
              href="/my-data"
              onClick={(e) => handleNavClick(e, '/my-data')}
              className="inline-flex min-h-[56px] min-w-[56px] items-center justify-center rounded-xl border-2 border-[#0F766E] bg-[#F0FDFA] px-4 py-2 text-[18px] font-semibold text-[#115E59] no-underline hover:bg-[#CCFBF1]"
            >
              My Data
            </a>
          </nav>
        </div>
      </header>

      <div className="app-container space-y-4 pt-4">
        {offline ? (
          <div
            role="status"
            aria-live="polite"
            data-badge="true"
            className="flex items-start gap-3 rounded-xl border-2 border-[#D97706] bg-[#FFFBEB] p-4 text-[18px] font-semibold text-[#92400E]"
          >
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <WifiOff size={22} />
            </span>
            <span>
              You are offline. You can still view everything saved on this device.
            </span>
          </div>
        ) : null}

        {isStoreUnavailable ? (
          <div
            role="alert"
            data-badge="true"
            className="flex items-start gap-3 rounded-xl border-2 border-[#BE123C] bg-[#FFF1F2] p-4 text-[18px] font-semibold text-[#881337]"
          >
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0">
              <AlertTriangle size={22} />
            </span>
            <span>{fallbackMessage}</span>
          </div>
        ) : null}
      </div>

      <main id="main-content" className="app-container py-6">
        {children}
      </main>
    </div>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0F766E" />
        <title>My Daily Helper</title>
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
