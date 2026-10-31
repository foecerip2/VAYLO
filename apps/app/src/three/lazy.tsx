import { lazy, Suspense, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { detectQuality } from './quality';

const Background = lazy(() => import('./Background3D'));
const Shield = lazy(() => import('./ShieldScene'));
const Globe = lazy(() => import('./GlobeScene'));
const Reward = lazy(() => import('./RewardScene'));
export const WheelLazy = lazy(() => import('./WheelScene'));

export { burst } from './burst';
export type { WheelHandle } from './WheelScene';
export type { ShieldTone } from './ShieldScene';
export type { GlobeNode } from './GlobeScene';
export { detectQuality };

/** 3D доступно (WebGL есть, пользователь не просил «уменьшить движение», устройство не слишком слабое) */
export const has3D = () => detectQuality() !== 'off';

/** Медленная сеть или экономия трафика: тяжёлый three.js (~500 КБ) не грузим вовсе */
const slowNet = (): boolean => {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } }).connection;
  return !!c && (!!c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType ?? '') || (c.downlink !== undefined && c.downlink > 0 && c.downlink < 1.5));
};
export function Background3D() {
  const [go, setGo] = useState(false);
  // фон подключаем после того, как страница уже нарисована и браузер освободился — интерфейс не ждёт 3D
  useEffect(() => {
    if (!has3D() || slowNet()) return;
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
    const t = w.requestIdleCallback ? w.requestIdleCallback(() => setGo(true), { timeout: 2500 }) : window.setTimeout(() => setGo(true), 1200);
    return () => { (window as unknown as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(t); clearTimeout(t); };
  }, []);
  if (!go) return null;
  return <Suspense fallback={null}><Background /></Suspense>;
}
export function Shield3D(p: ComponentProps<typeof Shield> & { fallback: ReactNode }) {
  const { fallback, ...rest } = p;
  if (!has3D()) return <>{fallback}</>;
  return <Suspense fallback={fallback}><Shield {...rest} /></Suspense>;
}
/** Глобус на Canvas 2D: не требует WebGL, поэтому показывается на любом устройстве */
export function Globe3D(p: ComponentProps<typeof Globe>) {
  return <Suspense fallback={<div className="grid h-[340px] place-items-center text-sm text-muted md:h-[420px]">Загружаем глобус…</div>}><Globe {...p} /></Suspense>;
}
export function Reward3D(p: ComponentProps<typeof Reward> & { fallback: ReactNode }) {
  const { fallback, ...rest } = p;
  if (!has3D()) return <>{fallback}</>;
  return <Suspense fallback={fallback}><Reward {...rest} /></Suspense>;
}
