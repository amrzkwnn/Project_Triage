import { useEffect, useState } from 'react';

/**
 * Tracks the browser viewport size. Returns { w: 0, h: 0 } before first
 * measurement so components can avoid rendering a wrong-sized layout.
 */
export function useViewport() {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return size;
}
