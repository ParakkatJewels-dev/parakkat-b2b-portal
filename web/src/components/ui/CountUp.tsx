import { useEffect, useRef, useState } from 'react';

/**
 * Animates a number from 0 → `to` on mount (easeOutCubic). Honours
 * prefers-reduced-motion by rendering the final value immediately. Pass a
 * `format` fn for currency/units (defaults to en-IN integer grouping).
 */
export function CountUp({
  to,
  duration = 900,
  format,
}: {
  to: number;
  duration?: number;
  format?: (n: number) => string;
}) {
  const [val, setVal] = useState(0);
  const raf = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setVal(to);
      return;
    }
    let start: number | null = null;
    const step = (t: number) => {
      if (start === null) start = t;
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else setVal(to);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [to, duration]);

  const fmt = format ?? ((n: number) => Math.round(n).toLocaleString('en-IN'));
  return <>{fmt(val)}</>;
}
