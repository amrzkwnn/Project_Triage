'use client';

import React from 'react';
import {
  CalendarDays,
  Inbox,
  Lock,
  ShieldCheck,
  Sun,
  type LucideIcon,
} from 'lucide-react';

interface TabItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

const TABS: ReadonlyArray<TabItem> = [
  { href: '/', label: 'My Day', icon: Sun, exact: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/scam-shield', label: 'Safety', icon: ShieldCheck },
  { href: '/my-data', label: 'My Data', icon: Lock },
];

export interface TabBarProps {
  activePath?: string;
  onNavigate?: (href: string) => void;
}

function isTabActive(tab: TabItem, activePath: string): boolean {
  if (tab.exact) {
    return activePath === '/' || activePath === '';
  }
  return activePath === tab.href || activePath.startsWith(`${tab.href}/`);
}

export function TabBar({ activePath = '/', onNavigate }: TabBarProps) {
  const handleClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string
  ) => {
    if (onNavigate) {
      event.preventDefault();
      onNavigate(href);
    }
  };

  return (
    <nav
      aria-label="App navigation"
      className="chrome relative z-20 shrink-0 border-t border-line bg-white/80 backdrop-blur-xl"
      style={{ paddingBottom: 18 }}
    >
      <div className="flex items-end justify-around px-1.5 pt-1.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = isTabActive(tab, activePath);
          return (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              onClick={(event) => handleClick(event, tab.href)}
              className={`pressable flex min-h-[56px] min-w-[56px] flex-1 cursor-pointer flex-col items-center justify-center gap-[3px] no-underline ${
                isActive ? 'text-brand' : 'text-muted'
              }`}
            >
              <Icon
                aria-hidden="true"
                size={22}
                strokeWidth={isActive ? 2.25 : 1.75}
              />
              <span className="text-[11px] font-semibold tracking-tight">
                {tab.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

export default TabBar;
