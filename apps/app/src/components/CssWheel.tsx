import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { WheelHandle } from '../three/lazy';

const COLORS = ['#7c3aed', '#c026d3', '#6d28d9', '#db2777', '#9333ea', '#a21caf', '#8b5cf6', '#be185d'];

/** Резервное колесо без WebGL: тот же интерфейс spinTo, CSS-вращение с плавной остановкой. */
const CssWheel = forwardRef<WheelHandle, { labels: string[] }>(function CssWheel({ labels }, handle) {
  const el = useRef<HTMLDivElement>(null);
  const turns = useRef(0);
  const n = labels.length;
  const step = 360 / n;
  useImperativeHandle(handle, () => ({
    spinTo(index, onTick) {
      return new Promise<void>((resolve) => {
        turns.current += 1;
        const deg = -(index * step) - 360 * (5 * turns.current);
        if (el.current) el.current.style.transform = `rotate(${deg}deg)`;
        let ticks = 0;
        const iv = setInterval(() => { onTick?.(); if (++ticks > 18) clearInterval(iv); }, 220);
        setTimeout(() => { clearInterval(iv); resolve(); }, 4700);
      });
    },
  }), [n, step]);
  const grad = labels.map((_, i) => `${COLORS[i % COLORS.length]} ${i * step - step / 2}deg ${(i + 1) * step - step / 2}deg`).join(', ');
  return (
    <div className="relative mx-auto w-fit">
      <div className="absolute left-1/2 top-[-6px] z-10 h-0 w-0 -translate-x-1/2 border-x-[14px] border-t-[26px] border-x-transparent border-t-[#ec4899] drop-shadow-[0_0_10px_#ec4899]" />
      <div ref={el} className="css-wheel" style={{ background: `conic-gradient(from 0deg, ${grad})` }}>
        {labels.map((l, i) => (
          <span key={i} className="lbl" style={{ transform: `rotate(${i * step - 90}deg) translate(46px, -8px)` }}>{l}</span>
        ))}
      </div>
    </div>
  );
});
export default CssWheel;
