import { avatarStyles, personById } from '../data/seed';

const initialsOf = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/**
 * Small person identity chip: colored initials avatar + short name.
 */
export default function PersonChip({ personId, size = 'md', showName = true }) {
  const person = personById(personId);
  if (!person) return null;

  const avatar =
    size === 'sm' ? 'h-6 w-6 text-[9px]' : 'h-7 w-7 text-[10px]';
  const name =
    size === 'sm'
      ? 'text-[12px] font-medium text-muted'
      : 'text-[13px] font-semibold text-ink';

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${avatarStyles[person.avatar]} ${avatar}`}
      >
        {initialsOf(person.name)}
      </span>
      {showName && <span className={`truncate ${name}`}>{person.short}</span>}
    </span>
  );
}
