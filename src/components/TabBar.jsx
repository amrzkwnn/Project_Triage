import { NavLink } from 'react-router-dom';
import { CalendarDays, FileText, Plus, Sun } from 'lucide-react';

const TABS = [
  { to: '/', label: 'My Day', icon: Sun, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/records', label: 'Records', icon: FileText },
];

export default function TabBar() {
  return (
    <nav
      className="chrome relative z-20 shrink-0 border-t border-line bg-white/80 backdrop-blur-xl"
      style={{ paddingBottom: 18 }}
    >
      <div className="flex items-end justify-around px-2 pt-2">
        {TABS.map(({ to, label, icon: Icon, center, end }) => {
          if (center) {
            return (
              <NavLink
                key={to}
                to={to}
                aria-label="Add a record"
                className="pressable -mt-1 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lift"
              >
                <Plus size={26} strokeWidth={2.2} />
              </NavLink>
            );
          }
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex h-12 min-w-[72px] cursor-pointer flex-col items-center justify-center gap-[3px] ${
                  isActive ? 'text-brand' : 'text-muted'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} />
                  <span className="text-[11px] font-semibold tracking-tight">{label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
