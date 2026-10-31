import { useEffect, useRef } from 'react';
import * as THREE from 'three';

function dotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.7)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PALETTE = [new THREE.Color('#a855f7'), new THREE.Color('#ec4899'), new THREE.Color('#7c3aed'), new THREE.Color('#d946ef'), new THREE.Color('#f0abfc')];

/** Спиральная галактика из частиц в фиолетово-розовой гамме */
function galaxy(count: number, radius: number, tex: THREE.Texture) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const arms = 3;
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = Math.pow(Math.random(), 1.6) * radius;
    const arm = ((i % arms) / arms) * Math.PI * 2;
    const spin = r * 0.55;
    const rnd = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * (0.25 + r * 0.18);
    pos[i * 3] = Math.cos(arm + spin) * r + rnd();
    pos[i * 3 + 1] = rnd() * 0.6;
    pos[i * 3 + 2] = Math.sin(arm + spin) * r + rnd();
    tmp.copy(PALETTE[Math.floor(Math.random() * PALETTE.length)]!).lerp(new THREE.Color('#ffffff'), r < 0.6 ? 0.6 : 0);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.075, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 });
  return new THREE.Points(geo, mat);
}

/** Звёздная пыль вокруг */
function dust(count: number, spread: number, tex: THREE.Texture) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos.set([(Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.6, (Math.random() - 0.5) * spread], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.05, map: tex, color: '#c4b5fd', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
}

function ring(r: number, color: string, opacity: number) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 8, 220), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  return m;
}

/** Кристалл для страницы входа: каркасный икосаэдр + светящееся ядро + вершины-искры */
function crystal(tex: THREE.Texture) {
  const g = new THREE.Group();
  const ico = new THREE.IcosahedronGeometry(1.55, 1);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(ico), new THREE.LineBasicMaterial({ color: '#d8b4fe', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })));
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 1), new THREE.MeshBasicMaterial({ color: '#7c3aed', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false })));
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.62, 0), new THREE.MeshBasicMaterial({ color: '#ec4899', wireframe: true, transparent: true, opacity: 0.9 }));
  core.name = 'core';
  g.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: '#c026d3', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(4.5, 4.5, 1);
  g.add(glow);
  const vg = ico.clone();
  vg.deleteAttribute('uv'); // иначе текстура точки берётся по UV и искры выходят квадратными
  const verts = new THREE.Points(vg, new THREE.PointsMaterial({ size: 0.16, map: tex, color: '#f5d0fe', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(verts);
  return g;
}

/**
 * Живой 3D-фон админки (three.js). mode="ambient" — галактика и кольца за контентом,
 * mode="hero" — то же плюс вращающийся кристалл по центру (страница входа).
 * Отключается при «уменьшении движения», без WebGL и переключателем в профиле.
 */
export default function Backdrop3D({ mode = 'ambient' }: { mode?: 'ambient' | 'hero' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'low-power' });
    } catch {
      canvas.style.display = 'none';
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hero = mode === 'hero';
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    camera.position.set(0, 0, hero ? 8 : 10);
    if (hero) scene.position.y = 0.3;
    const tex = dotTexture();

    const mobile = window.innerWidth < 768;
    const gal = galaxy(mobile ? 1600 : hero ? 4200 : 3200, hero ? 6.5 : 7, tex);
    gal.rotation.x = hero ? 1.15 : 1.05;
    gal.position.set(hero ? 0 : 4.2, hero ? -0.6 : 0.4, hero ? -1 : -2);
    scene.add(gal);
    const d = dust(mobile ? 300 : 700, 30, tex);
    scene.add(d);
    const r1 = ring(hero ? 2.6 : 4.4, '#a855f7', 0.45);
    const r2 = ring(hero ? 3.3 : 5.6, '#ec4899', 0.28);
    const rings = new THREE.Group();
    rings.add(r1, r2);
    rings.position.copy(hero ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(-5.5, -2.2, -4));
    scene.add(rings);
    const cr = hero ? crystal(tex) : null;
    if (cr) scene.add(cr);

    const hold = new THREE.Group();
    if (hero) { [gal, rings, cr!].forEach((o) => { scene.remove(o); hold.add(o); }); scene.add(hold); }
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      // на широком экране кристалл слева от формы входа, на телефоне — над ней
      if (hero) { const wide = window.matchMedia('(min-width: 1024px) and (min-aspect-ratio: 23/20) and (hover: hover)').matches; hold.position.set(wide ? -3.6 : 0, wide ? 0 : 2.1, 0); hold.scale.setScalar(wide ? 1 : 0.7); }
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => { mouse.x = e.clientX / window.innerWidth - 0.5; mouse.y = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0;
    let last = performance.now();
    let t = 0;
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      gal.rotation.z += dt * (hero ? 0.06 : 0.035);
      d.rotation.y += dt * 0.01;
      r1.rotation.set(1.1 + Math.sin(t * 0.3) * 0.25, t * 0.25, 0);
      r2.rotation.set(1.4 + Math.cos(t * 0.25) * 0.3, -t * 0.18, 0.4);
      if (cr) {
        cr.rotation.y += dt * 0.45;
        cr.rotation.x = Math.sin(t * 0.6) * 0.25;
        cr.position.y = Math.sin(t * 1.1) * 0.15;
        const core = cr.getObjectByName('core');
        if (core) { core.rotation.x -= dt * 1.2; core.rotation.z += dt * 0.8; core.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08); }
      }
      // параллакс за мышью и прокруткой
      const sy = Math.min(1, window.scrollY / 1600);
      camera.position.x += (mouse.x * 1.4 - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 0.9 - sy * 1.2 - camera.position.y) * 0.04;
      camera.lookAt(0, -sy * 0.8, 0);
      renderer.render(scene, camera);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible' && !reduced) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); canvas.style.display = 'none'; };
    canvas.addEventListener('webglcontextlost', onLost);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      tex.dispose();
      renderer.dispose();
    };
  }, [mode]);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-full w-full" style={{ opacity: mode === 'hero' ? 1 : 0.6 }} />;
}
