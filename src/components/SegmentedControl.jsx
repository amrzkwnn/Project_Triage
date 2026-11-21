/**
 * Segmented control with a sliding indicator. Options are evenly sized;
 * the indicator animates between them (200ms ease-out).
 */
export default function SegmentedControl({ options, value, onChange, className = '' }) {
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value)
  );
  const pct = 100 / options.length;

  return (
    <div
      className={`chrome relative flex rounded-full border border-line bg-white p-1 shadow-pill ${className}`}
    >
      <div
        className="absolute inset-y-1 rounded-full bg-brand transition-all duration-200 ease-out"
        style={{
          width: `calc(${pct}% - 4px)`,
          left: `calc(${activeIndex * pct}% + 2px)`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`pressable relative z-10 flex h-11 flex-1 items-center justify-center rounded-full text-[13px] font-semibold transition-colors duration-200 ${
            o.id === value ? 'text-white' : 'text-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
