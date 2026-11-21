import { categoryMeta } from '../data/seed';

/**
 * Work / Personal badge. WORK = teal tint, PERSONAL = violet tint.
 */
export default function Badge({ category, className = '' }) {
  const meta = categoryMeta[category] ?? categoryMeta.work;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em] ${meta.classes} ${className}`}
    >
      {meta.label}
    </span>
  );
}
