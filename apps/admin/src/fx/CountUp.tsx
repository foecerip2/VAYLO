import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Число «набегает» от предыдущего значения к новому (ease-out), формат — через format */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString('ru-RU'), duration = 1100 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced()) return setShown(value);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      const v = a + (value - a) * e;
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="tabular">{format(shown)}</span>;
}
