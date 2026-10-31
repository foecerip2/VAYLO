import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { NEON, createStage, detectQuality, dotTexture, easeOutBack } from './engine';

export type ShieldTone = 'safe' | 'warn' | 'off';
const TONE: Record<ShieldTone, { body: number; glow: number; edge: number }> = {
  safe: { body: 0x7c3aed, glow: 0x2a0a4a, edge: 0xf0abfc },
  warn: { body: 0xb06a10, glow: 0x3a1a00, edge: 0xffc46b },
  off: { body: 0xa3102e, glow: 0x3a0610, edge: 0xff7b8f },
};

/** Объёмный щит с замком: цвет по состоянию подписки, наклон за пальцем, импульс по касанию, «зарядка» при connecting. */
export default function ShieldScene({ tone, busy, onTap, className }: { tone: ShieldTone; busy?: boolean; onTap?: () => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ tone, busy: Boolean(busy), pulse: 0 });
  live.current.tone = tone;
  live.current.busy = Boolean(busy);

  useEffect(() => {
    const canvas = ref.current;
    const quality = detectQuality();
    if (!canvas || quality === 'off') return;
    const st = createStage(canvas, { fov: 38, z: 8.2, quality });
    const { scene } = st;
    scene.add(new THREE.AmbientLight(0x5a3a8a, 0.9));
    const key = new THREE.PointLight(0xb67cff, 90, 30); key.position.set(-4, 4, 6); scene.add(key);
    const fill = new THREE.PointLight(0xec4899, 80, 30); fill.position.set(4, -2, 5); scene.add(fill);
    const rim = new THREE.PointLight(0xec4899, 40, 30); rim.position.set(0, 5, -2); scene.add(rim);

    const g = new THREE.Group(); scene.add(g);
    const s = new THREE.Shape();
    s.moveTo(0, 1.55); s.bezierCurveTo(0.55, 1.25, 1.05, 1.2, 1.35, 1.2); s.lineTo(1.35, 0.1);
    s.bezierCurveTo(1.35, -0.9, 0.6, -1.45, 0, -1.75); s.bezierCurveTo(-0.6, -1.45, -1.35, -0.9, -1.35, 0.1);
    s.lineTo(-1.35, 1.2); s.bezierCurveTo(-1.05, 1.2, -0.55, 1.25, 0, 1.55);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.09, bevelSegments: quality === 'high' ? 6 : 3, curveSegments: quality === 'high' ? 40 : 18 });
    geo.center();
    const mat = new THREE.MeshPhysicalMaterial({ color: TONE[tone].body, metalness: 0.85, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15, emissive: TONE[tone].glow, emissiveIntensity: 0.9 });
    const body = new THREE.Mesh(geo, mat); g.add(body);
    const edgeMat = new THREE.LineBasicMaterial({ color: TONE[tone].edge });
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat));

    const lock = new THREE.Group();
    const lm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xc084fc, emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.3 });
    lock.add(new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.78, 0.2, 4, 0.1), lm));
    const sh = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 16, 40, Math.PI), lm); sh.position.y = 0.39; lock.add(sh);
    for (const x of [-0.32, 0.32]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16), lm); c.position.set(x, 0.36, 0); lock.add(c); }
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.25, 16), new THREE.MeshBasicMaterial({ color: 0x2a0a40 })); hole.rotation.x = Math.PI / 2; lock.add(hole);
    lock.position.set(0, -0.1, 0.45); lock.scale.setScalar(0.95); g.add(lock);

    const rings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3 + i * 0.38, i === 1 ? 0.02 : 0.012, 8, 140), new THREE.MeshBasicMaterial({ color: [NEON.blue, NEON.violet, NEON.blue][i]!, transparent: true, opacity: 0.8 }));
      ring.rotation.x = Math.PI / 2 + 0.35 + i * 0.3;
      g.add(ring); rings.push(ring);
    }
    // орбитальные искры
    const SP = quality === 'high' ? 90 : 40;
    const sp = new Float32Array(SP * 3);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.11, map: dotTexture(), color: 0xf5d0fe, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(sparks);
    const seeds = Array.from({ length: SP }, () => ({ a: Math.random() * 6.28, r: 2.0 + Math.random() * 1.4, y: (Math.random() - 0.5) * 3, s: 0.2 + Math.random() * 0.6 }));

    let tx = 0, ty = 0, rx = 0, ry = 0, appear = 0, curTone: ShieldTone = tone;
    const cBody = new THREE.Color(TONE[tone].body), cGlow = new THREE.Color(TONE[tone].glow), cEdge = new THREE.Color(TONE[tone].edge);
    const rectOf = () => canvas.getBoundingClientRect();
    const move = (e: PointerEvent) => { const r = rectOf(); tx = ((e.clientX - r.left) / r.width - 0.5) * 2; ty = ((e.clientY - r.top) / r.height - 0.5) * 2; };
    const leave = () => { tx = 0; ty = 0; };
    const down = () => { live.current.pulse = 1; onTapRef.current?.(); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('pointerdown', down);
    const onOrient = (e: DeviceOrientationEvent) => { if (e.gamma != null && e.beta != null) { tx = Math.max(-1, Math.min(1, e.gamma / 35)); ty = Math.max(-1, Math.min(1, (e.beta - 45) / 45)); } };
    window.addEventListener('deviceorientation', onOrient, { passive: true });

    st.onFrame((dt, t) => {
      const L = live.current;
      appear = Math.min(1, appear + dt * 1.4);
      if (curTone !== L.tone) { curTone = L.tone; }
      const k = Math.min(1, dt * 4);
      cBody.lerp(new THREE.Color(TONE[curTone].body), k); cGlow.lerp(new THREE.Color(TONE[curTone].glow), k); cEdge.lerp(new THREE.Color(TONE[curTone].edge), k);
      mat.color.copy(cBody); mat.emissive.copy(cGlow); edgeMat.color.copy(cEdge);
      L.pulse = Math.max(0, L.pulse - dt * 2.2);
      const sc = easeOutBack(appear) * (1 + L.pulse * 0.14 + (L.busy ? 0.04 * Math.sin(t * 14) : 0));
      g.scale.setScalar(Math.max(0.001, sc));
      rx += ((ty * 0.35 + Math.sin(t * 0.7) * 0.06) - rx) * Math.min(1, dt * 5);
      ry += ((tx * 0.6 + Math.sin(t * 0.5) * 0.25 + (L.busy ? t * 3 : 0)) - ry) * Math.min(1, dt * (L.busy ? 1.2 : 5));
      g.rotation.x = rx; g.rotation.y = ry;
      g.position.y = Math.sin(t * 1.3) * 0.08;
      rings.forEach((r, i) => { r.rotation.z = t * (i % 2 ? -0.6 : 0.8) * (L.busy ? 3 : 1); });
      lm.emissiveIntensity = 0.55 + L.pulse * 1.2 + (L.busy ? 0.4 + 0.3 * Math.sin(t * 10) : 0);
      for (let i = 0; i < SP; i++) { const q = seeds[i]!; const a = q.a + t * q.s * (L.busy ? 3 : 1); sp[i * 3] = Math.cos(a) * q.r; sp[i * 3 + 1] = q.y + Math.sin(t * q.s * 2 + i) * 0.2; sp[i * 3 + 2] = Math.sin(a) * q.r * 0.6; }
      sg.attributes.position!.needsUpdate = true;
    });

    return () => {
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('pointerdown', down);
      window.removeEventListener('deviceorientation', onOrient);
      st.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  return <canvas ref={ref} className={className ?? 'h-[250px] w-full touch-pan-y'} aria-label="3D-щит" />;
}
