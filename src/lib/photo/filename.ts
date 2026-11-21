/**
 * Computes a non-colliding saved copy filename by inserting `-edited` before
 * the file extension (or at the end when there is no extension), incrementing
 * `-edited-2`, `-edited-3`, etc. until the name is not in `taken`.
 */
export function editedName(
  original: string,
  taken: ReadonlySet<string>
): string {
  const lastDot = original.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < original.length - 1;

  const base = hasExtension ? original.slice(0, lastDot) : original;
  const ext = hasExtension ? original.slice(lastDot) : '';

  const firstCandidate = `${base}-edited${ext}`;
  if (!taken.has(firstCandidate)) {
    return firstCandidate;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${base}-edited-${suffix}${ext}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
    suffix += 1;
  }
}
