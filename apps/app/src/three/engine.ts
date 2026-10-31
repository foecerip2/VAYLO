import * as THREE from 'three';
import { detectQuality, disable3D, isIOS, type Quality } from './quality';
export { detectQuality, isIOS };
export type { Quality };


let dotTex: THREE.CanvasTexture | null = null;
/** Мягкая круглая точка для частиц (без неё PointsMaterial рисует квадраты). Текстура общая — не освобождается при dispose сцены. */
export function dotTexture(): THREE.CanvasTexture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.userData.shared = true;
  return dotTex;
}

export const NEON = {
  blue: 0xa855f7,
  blue2: 0xe9b8ff,
  violet: 0xd946ef,
  red: 0xec4899,
  green: 0x22d3a0,
  deep: 0x0a0710,
};

export interface Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** вызывается каждый кадр: dt в секундах, t — время со старта */
  onFrame(fn: (dt: number, t: number) => void): void;
  /** принудительно нарисовать кадр (при изменении данных) */
  invalidate(): void;
  dispose(): void;
}

/**
 * Общая обёртка: рендерер, адаптивный размер (ResizeObserver), потолок DPR, пауза при скрытой вкладке и вне экрана,
 * ограничение FPS на слабых устройствах, полная очистка GPU-ресурсов при размонтировании.
 */
export function createStage(canvas: HTMLCanvasElement, opts: { fov?: number; z?: number; alpha?: boolean; quality: Quality; transparent?: boolean }): Stage {
  const q = opts.quality;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q === 'high', alpha: opts.alpha ?? true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  // Система отобрала WebGL (нехватка памяти): прячем холст, запоминаем это устройство и дальше обходимся без 3D — страница остаётся рабочей
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); disable3D(); canvas.style.display = 'none'; }, { once: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 40, 1, 0.1, 100);
  camera.position.set(0, 0, opts.z ?? 8);
  const maxDpr = q === 'high' ? 2 : 1.25;
  const frameFns: Array<(dt: number, t: number) => void> = [];
  let raf = 0;
  let last = performance.now();
  let t0 = last;
  let visible = true;
  let alive = true;
  const minDelta = q === 'low' ? 1000 / 30 : 0;

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();
  const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; }, { threshold: 0 });
  io.observe(canvas);

  const tick = (now: number) => {
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    if (!visible || document.hidden) { last = now; return; }
    const delta = now - last;
    if (delta < minDelta) return;
    const dt = Math.min(0.05, delta / 1000);
    last = now;
    const t = (now - t0) / 1000;
    for (const f of frameFns) f(dt, t);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    scene, camera, renderer,
    onFrame: (fn) => void frameFns.push(fn),
    invalidate: () => renderer.render(scene, camera),
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
          for (const v of Object.values(x)) if (v instanceof THREE.Texture && !v.userData.shared) v.dispose();
          x.dispose();
        });
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeOutBack = (x: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
