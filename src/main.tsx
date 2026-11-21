import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '@/app/layout';
import { HomeHub } from '@/app/page';
import { MyDataPage } from '@/app/my-data/page';
import { ScamShieldPage } from '@/app/scam-shield/page';
import { PhotoHelperPage } from '@/app/photo-helper/page';
import { UnifiedInboxPage } from '@/app/inbox/page';
import { AiMediaCheckPage } from '@/app/media-check/page';
import { CalendarPage } from '@/app/calendar/page';

function normalizePath(raw: string): { pathname: string; search: string } {
  try {
    const parsed = new URL(raw, 'https://helper.local');
    return { pathname: parsed.pathname, search: parsed.search };
  } catch {
    return { pathname: '/', search: '' };
  }
}

export function CompanionApp() {
  const [locationState, setLocationState] = useState<{
    pathname: string;
    search: string;
  }>(() => {
    if (typeof window === 'undefined') {
      return { pathname: '/', search: '' };
    }
    return {
      pathname: window.location.pathname,
      search: window.location.search,
    };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      setLocationState({
        pathname: window.location.pathname,
        search: window.location.search,
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((href: string) => {
    const next = normalizePath(href);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `${next.pathname}${next.search}`);
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    setLocationState(next);
  }, []);

  let screen: React.ReactNode;
  switch (locationState.pathname) {
    case '/my-data':
      screen = <MyDataPage onNavigate={navigate} />;
      break;
    case '/scam-shield':
      screen = <ScamShieldPage onNavigate={navigate} />;
      break;
    case '/photo-helper':
      screen = <PhotoHelperPage onNavigate={navigate} />;
      break;
    case '/inbox':
      screen = (
        <UnifiedInboxPage
          initialQuery={locationState.search || undefined}
          onNavigate={navigate}
        />
      );
      break;
    case '/media-check':
      screen = <AiMediaCheckPage onNavigate={navigate} />;
      break;
    case '/calendar':
      screen = <CalendarPage onNavigate={navigate} />;
      break;
    default:
      screen = <HomeHub onNavigate={navigate} />;
      break;
  }

  return <AppShell onNavigate={navigate}>{screen}</AppShell>;
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(
      <React.StrictMode>
        <CompanionApp />
      </React.StrictMode>
    );
  }
}
