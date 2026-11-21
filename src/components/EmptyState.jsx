/**
 * Designed empty state — never plain text.
 */
export default function EmptyState({ icon: Icon, title, message, className = '' }) {
  return (
    <div
      className={`anim-fade-up flex flex-col items-center rounded-card border border-dashed border-line bg-white px-6 py-8 text-center ${className}`}
    >
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-wash text-brand">
        {Icon && <Icon size={22} strokeWidth={1.75} />}
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {message && (
        <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed text-muted">{message}</p>
      )}
    </div>
  );
}
