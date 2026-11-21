/**
 * Animated chip row used for filters and toggles.
 * items: [{ id, label, dot?, avatar? }] — 44px tap targets, smooth color
 * transitions on the selected state.
 */
export default function FilterChips({ items, value, onChange, compact = false, className = '' }) {
  return (
    <div className={`no-scrollbar chrome flex gap-2 overflow-x-auto ${className}`}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`pressable flex h-11 shrink-0 items-center gap-2 rounded-chip border ${
              compact ? 'px-3' : 'px-3.5'
            } text-[13px] font-semibold transition-all duration-150 ease-out ${
              active
                ? 'border-brand bg-brand text-white shadow-pill'
                : 'border-line bg-white text-muted'
            }`}
          >
            {item.dot && !active && (
              <span className={`h-2 w-2 rounded-full ${item.dot}`} />
            )}
            {item.avatar && (
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold ${
                  active ? 'bg-white/20 text-white' : item.avatar
                }`}
              >
                {item.initials}
              </span>
            )}
            <span className={active ? '' : 'hover:text-ink'}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
