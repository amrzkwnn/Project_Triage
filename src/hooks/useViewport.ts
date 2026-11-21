'use client';

import { useEffect, useState } from 'react';

export interface ViewportSize {
  w: number;
  h: number;
}

/**
 * Tracks the browser viewport size. Returns { w: 0, h: 0 } before first
 * measurement (and during SSR) so components can avoid rendering a
 * wrong-sized layout.
 */
export function useViewport(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () =>
      setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return size;
}
