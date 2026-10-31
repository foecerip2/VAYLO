import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { NEON, createStage, detectQuality, easeOutCubic } from './engine';

export interface WheelHandle {
  /** Прокрутить колесо до сектора index; промис завершается, когда колесо остановилось. onTick вызывается при проходе каждого сектора. */
  spinTo(index: number, onTick?: () => void): Promise<void>;
}
interface Props { labels: string[]; className?: string }

const SEG_COLORS = ['#7c3aed', '#c026d3', '#6d28d9', '#db2777', '#9333ea', '#a21caf', '#8b5cf6', '#be185d'];

function wheelTexture(labels: string[]): THREE.CanvasTexture {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d')!;
  const n = labels.length, a = (Math.PI * 2) / n;
  g.translate(S / 2, S / 2);
  for (let i = 0; i < n; i++) {
    // сектор 0 центрирован на «12 часов»
    const a0 = -Math.PI / 2 + i * a - a / 2, a1 = a0 + a;
    const grad = g.createRadialGradient(0, 0, 40, 0, 0, S / 2);
    const base = SEG_COLORS[i % SEG_COLORS.length]!;
    grad.addColorStop(0, '#14081f'); grad.addColorStop(0.35, base); grad.addColorStop(1, base);
    g.fillStyle = grad; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, S / 2 - 6, a0, a1); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 5; g.stroke();
    g.save(); g.rotate(a0 + a / 2); g.fillStyle = '#fff'; g.textAlign = 'right'; g.textBaseline = 'middle';
    g.font = '800 62px Unbounded, Manrope, sans-serif'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8;
    g.fillText(labels[i]!, S / 2 - 70, 0); g.restore();
  }
  const hub = g.createRadialGradient(0, 0, 0, 0, 0, 90); hub.addColorStop(0, '#fff'); hub.addColorStop(1, '#c084fc');
  g.fillStyle = hub; g.beginPath(); g.arc(0, 0, 70, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** 3D-колесо: диск с бортиком и мигающими лампочками, указатель сверху, плавная остановка с лёгким «перелётом». */
const WheelScene = forwardRef<WheelHandle, Props>(function WheelScene({ labels, className }, handle) {
  const ref = useRef<HTMLCanvasElement>(null);
  const api = useRef<WheelHandle | null>(null);
  useImperativeHandle(handle, () => ({ spinTo: (i, t) => api.current!.spinTo(i, t) }), []);

  useEffect(() => {
    const canvas = ref.current;
    const quality = detectQuality();
    if (!canvas || quality === 'off') return;
    const st = createStage(canvas, { fov: 34, z: 10.6, quality });
    const { scene } = st;
    scene.add(new THREE.AmbientLight(0x6a4a9a, 1.0));
    const l1 = new THREE.PointLight(0xc084fc, 130, 40); l1.position.set(-4, 5, 7); scene.add(l1);
    const l2 = new THREE.PointLight(0xec4899, 100, 40); l2.position.set(5, -3, 6); scene.add(l2);

    const root = new THREE.Group(); scene.add(root);
    const R = 2.5, n = labels.length;
    const tex = wheelTexture(labels);
    const disc = new THREE.Group(); root.add(disc);
    const face = new THREE.Mesh(new THREE.CircleGeometry(R, 96), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.z = 0.201; disc.add(face);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.08, R + 0.08, 0.4, 96), new THREE.MeshPhysicalMaterial({ color: 0x170b26, metalness: 0.9, roughness: 0.25, clearcoat: 1 }));
    body.rotation.x = Math.PI / 2; disc.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, 0.13, 20, 120), new THREE.MeshPhysicalMaterial({ color: 0xa855f7, metalness: 0.9, roughness: 0.2, clearcoat: 1, emissive: 0x5b1a8a, emissiveIntensity: 0.9 }));
    rim.position.z = 0.1; root.add(rim);

    const bulbs: THREE.Mesh[] = [];
    const BN = n * 2;
    for (let i = 0; i < BN; i++) {
      const a = (i / BN) * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), new THREE.MeshBasicMaterial({ color: i % 2 ? NEON.red : 0xffffff }));
      b.position.set(Math.cos(a) * (R + 0.12), Math.sin(a) * (R + 0.12), 0.26); root.add(b); bulbs.push(b);
    }
    // указатель
    const ptr = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 24), new THREE.MeshPhysicalMaterial({ color: NEON.red, emissive: 0xdb2777, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.3 }));
    ptr.rotation.z = Math.PI; ptr.position.set(0, R + 0.38, 0.4); root.add(ptr);
    const ptrGlow = new THREE.PointLight(0xec4899, 8, 4); ptrGlow.position.set(0, R + 0.3, 0.8); root.add(ptrGlow);

    root.rotation.x = -0.28;
    let angle = 0, spin: { from: number; to: number; t: number; dur: number; resolve: () => void; tick?: () => void; lastSeg: number } | null = null;
    let sway = 0;
    const segOf = (a: number) => Math.floor(((a % (Math.PI * 2)) + Math.PI * 2 + Math.PI / n) / ((Math.PI * 2) / n)) % n;

    api.current = {
      spinTo(index, onTick) {
        return new Promise<void>((resolve) => {
          const step = (Math.PI * 2) / n;
          // Сектора на диске идут по часовой стрелке от «12 часов». Чтобы сектор index оказался под указателем сверху, диск надо
          // повернуть против часовой на index*step, т.е. на +index*step (положительный угол three.js — против часовой).
          // Само вращение идёт по часовой (угол убывает): отнимаем целые обороты.
          const target = index * step - Math.PI * 2 * (5 + Math.floor(Math.random() * 2)) + (Math.random() - 0.5) * step * 0.6;
          const from = angle % (Math.PI * 2);
          angle = from;
          spin = { from, to: target, t: 0, dur: 4.6, resolve, tick: onTick, lastSeg: segOf(from) };
        });
      },
    };

    st.onFrame((dt, t) => {
      sway += dt;
      if (spin) {
        spin.t += dt;
        const k = Math.min(1, spin.t / spin.dur);
        // easeOutCubic + крошечный «откат» в конце
        const e = easeOutCubic(k) + Math.sin(Math.min(1, Math.max(0, (k - 0.92) / 0.08)) * Math.PI) * 0.0025;
        angle = spin.from + (spin.to - spin.from) * e;
        const sg = segOf(angle);
        if (sg !== spin.lastSeg) { spin.lastSeg = sg; spin.tick?.(); }
        if (k >= 1) { const r = spin.resolve; spin = null; r(); }
      } else {
        angle += Math.sin(t * 0.6) * 0.0006;
      }
      disc.rotation.z = angle;
      root.rotation.y = Math.sin(sway * 0.5) * 0.08 + (spin ? 0.05 * Math.sin(t * 8) : 0);
      bulbs.forEach((b, i) => { (b.material as THREE.MeshBasicMaterial).color.setHex((Math.floor(t * (spin ? 10 : 3)) + i) % 2 ? NEON.red : 0xffffff); });
      ptr.rotation.z = Math.PI + (spin ? Math.sin(t * 40) * 0.12 : 0);
    });

    return () => st.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels.join('|')]);

  return <canvas ref={ref} className={className ?? 'h-[320px] w-full'} aria-label="3D-колесо удачи" />;
});
export default WheelScene;
