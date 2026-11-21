'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff } from 'lucide-react';
import { PhoneFrame } from '@/components/PhoneFrame';
import { TabBar } from '@/components/TabBar';
import { ToastProvider } from '@/components/Toast';
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
  activePath?: string;
};

export function AppShell({
  children,
  isOffline,
  storeUnavailable,
  storeErrorMessage,
  storeProbe,
  onNavigate,
  activePath,
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

    if ('caches' in window) {
      window.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k !== 'daily-helper-shell-v3')
              .map((k) => window.caches.delete(k))
          )
        )
        .catch(() => undefined);
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => reg.update())
        .catch(() => {
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
    <PhoneFrame>
      <ToastProvider>
        <div className="relative flex h-full min-h-0 flex-1 flex-col bg-canvas text-ink">
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>

          <header className="chrome shrink-0 border-b border-line bg-white/90 px-4 py-2.5 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <a
                href="/"
                onClick={(e) => handleNavClick(e, '/')}
                className="inline-flex min-h-[56px] items-center text-[18px] font-bold tracking-tight text-ink no-underline"
              >
                My Daily Helper
              </a>

              <nav aria-label="Primary" className="flex items-center gap-2">
                <a
                  href="/"
                  onClick={(e) => handleNavClick(e, '/')}
                  className="pressable inline-flex min-h-[56px] min-w-[56px] items-center justify-center rounded-chip border border-line bg-white px-3 py-1.5 text-[14px] font-semibold text-ink no-underline shadow-card hover:bg-canvas"
                >
                  Home
                </a>
                <a
                  href="/my-data"
                  onClick={(e) => handleNavClick(e, '/my-data')}
                  className="pressable inline-flex min-h-[56px] min-w-[56px] items-center justify-center rounded-chip border border-brand-soft bg-brand-wash px-3 py-1.5 text-[14px] font-semibold text-brand-deep no-underline shadow-card hover:bg-brand-soft"
                >
                  My Data
                </a>
              </nav>
            </div>
          </header>

          <div className="app-scroll min-h-0 flex-1 bg-canvas px-5 pb-6 pt-3">
            {(offline || isStoreUnavailable) && (
              <div className="mb-4 space-y-3">
                {offline ? (
                  <div
                    role="status"
                    aria-live="polite"
                    data-badge="true"
                    className="flex items-start gap-3 rounded-card border-2 border-[#D97706] bg-[#FFFBEB] p-3.5 text-[15px] font-semibold text-[#92400E] shadow-card"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex shrink-0"
                    >
                      <WifiOff size={20} />
                    </span>
                    <span>
                      You are offline. You can still view everything saved on
                      this device.
                    </span>
                  </div>
                ) : null}

                {isStoreUnavailable ? (
                  <div
                    role="alert"
                    data-badge="true"
                    className="flex items-start gap-3 rounded-card border-2 border-[#BE123C] bg-[#FFF1F2] p-3.5 text-[15px] font-semibold text-[#881337] shadow-card"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex shrink-0"
                    >
                      <AlertTriangle size={20} />
                    </span>
                    <span>{fallbackMessage}</span>
                  </div>
                ) : null}
              </div>
            )}

            <main id="main-content" className="space-y-4">
              {children}
            </main>
          </div>

          <TabBar activePath={activePath} onNavigate={onNavigate} />
        </div>
      </ToastProvider>
    </PhoneFrame>
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
