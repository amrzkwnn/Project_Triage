import { useState } from 'react';

// Shared filter presets + matching logic, used by My Day and Calendar.

export const CATEGORY_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'work', label: 'Work', dot: 'bg-teal-500' },
  { id: 'personal', label: 'Personal', dot: 'bg-violet-500' },
];

export const PERSON_CHIPS = [
  { id: 'all', label: 'Everyone' },
  { id: 'me', label: 'Me' },
  { id: 'wife', label: 'Wife' },
  { id: 'child1', label: 'Child 1' },
  { id: 'child2', label: 'Child 2' },
];

export const personLabel = (person) =>
  person === 'all' ? 'everyone' : PERSON_CHIPS.find((p) => p.id === person)?.label ?? '';

/**
 * Category + person filter state.
 * The person chips only exist in Personal mode: switching away from
 * Personal resets the person filter so a hidden filter can never silently
 * empty the screen.
 */
export function useFilters() {
  const [category, setCategoryRaw] = useState('all');
  const [person, setPerson] = useState('all');

  const setCategory = (c) => {
    setCategoryRaw(c);
    if (c !== 'personal') setPerson('all');
  };

  const matches = (item) =>
    (category === 'all' || item.category === category) &&
    (category !== 'personal' ||
      person === 'all' ||
      item.personId === person ||
      (person === 'me' && item.category === 'work'));

  return { category, setCategory, person, setPerson, matches };
}
