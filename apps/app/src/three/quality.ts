export type Quality = 'off' | 'low' | 'high';
let cached: Quality | null = null;
export const isIOS = (): boolean => typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
/** Отключить 3D до закрытия приложения — только если система реально убила WebGL-контекст; при следующем открытии снова полный дизайн */
export function disable3D(): void {
  cached = 'off';
}
/** Оценка возможностей устройства: на слабых телефонах 3D упрощается, без WebGL или при «уменьшении движения» — выключается. */
export function detectQuality(): Quality {
  if (cached) return cached;
  let q: Quality = 'high';
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl || reduced || new URLSearchParams(location.search).get('3d') === 'off') q = 'off';
    else if ((nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 4)) q = 'low';
    if (new URLSearchParams(location.search).get('3d') === 'low' && q !== 'off') q = 'low';
  } catch {
    q = 'off';
  }
  cached = q;
  return q;
}
