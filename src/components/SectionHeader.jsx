/**
 * Uppercase 13/600 section label with optional count pill.
 */
export default function SectionHeader({ title, count, countTone = 'default', children, className = '' }) {
  const toneClass =
    countTone === 'red'
      ? 'bg-red-100 text-red-700'
      : countTone === 'brand'
        ? 'bg-brand-soft text-brand-deep'
        : 'bg-line text-muted';
  return (
    <div className={`mb-3 flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
          {title}
        </h2>
        {count != null && count !== 0 && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tnum ${toneClass}`}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
