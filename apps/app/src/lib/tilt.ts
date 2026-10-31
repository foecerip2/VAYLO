/** 3D-наклон карточек с классом .tilt за курсором + блик. Один делегированный обработчик на документ, только для мыши. */
const MAX = 7; // градусов

export function installTilt(): () => void {
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return () => {};
  let current: HTMLElement | null = null;
  let raf = 0;
  const reset = (el: HTMLElement) => {
    el.classList.remove('tilting');
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
    el.style.setProperty('--glare', '0');
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.('.tilt') as HTMLElement | null;
    if (current && current !== el) reset(current);
    current = el;
    if (!el) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      // большие карточки наклоняем слабее
      const k = Math.min(1, 420 / Math.max(r.width, r.height));
      el.classList.add('tilting');
      el.style.setProperty('--ry', `${((px - 0.5) * 2 * MAX * k).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${(-(py - 0.5) * 2 * MAX * k).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
      el.style.setProperty('--glare', '1');
    });
  };
  const onLeave = () => { if (current) reset(current); current = null; };
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  return () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
  };
}
