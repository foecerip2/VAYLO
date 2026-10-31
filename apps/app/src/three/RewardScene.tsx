import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { NEON, createStage, detectQuality } from './engine';

/** Вращающаяся 3D-монета с кристаллом для шапки «Заданий». pulse растёт при получении награды. */
export default function RewardScene({ pulseKey, className }: { pulseKey: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pulse = useRef(0);
  const last = useRef(pulseKey);
  if (last.current !== pulseKey) { last.current = pulseKey; pulse.current = 1; }

  useEffect(() => {
    const canvas = ref.current;
    const quality = detectQuality();
    if (!canvas || quality === 'off') return;
    const st = createStage(canvas, { fov: 36, z: 6.5, quality });
    const { scene } = st;
    scene.add(new THREE.AmbientLight(0x7a5aa0, 1));
    const l1 = new THREE.PointLight(0xc084fc, 90, 30); l1.position.set(-3, 3, 5); scene.add(l1);
    const l2 = new THREE.PointLight(0xec4899, 60, 30); l2.position.set(3, -2, 4); scene.add(l2);
    const g = new THREE.Group(); scene.add(g);

    const tex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!;
      const gr = x.createRadialGradient(128, 128, 10, 128, 128, 128); gr.addColorStop(0, '#f0abfc'); gr.addColorStop(1, '#a855f7'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
      x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 10; x.beginPath(); x.arc(128, 128, 104, 0, 7); x.stroke();
      x.fillStyle = '#fff'; x.font = '800 130px Unbounded, Manrope, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('V', 128, 140);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const coin = new THREE.Group();
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.22, 64), new THREE.MeshPhysicalMaterial({ color: 0xffc34d, metalness: 1, roughness: 0.25, clearcoat: 1, emissive: 0x6a3c00, emissiveIntensity: 0.4 }));
    edge.rotation.x = Math.PI / 2; coin.add(edge);
    for (const z of [0.115, -0.115]) {
      const f = new THREE.Mesh(new THREE.CircleGeometry(1.08, 64), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.5, roughness: 0.35, emissive: 0x5b1a8a, emissiveIntensity: 0.5 }));
      f.position.z = z; if (z < 0) f.rotation.y = Math.PI; coin.add(f);
    }
    g.add(coin);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshPhysicalMaterial({ color: NEON.violet, metalness: 0.2, roughness: 0.05, transmission: 0.2, emissive: 0x5a14b0, emissiveIntensity: 0.9, clearcoat: 1 }));
    gem.position.set(1.6, 0.9, 0.3); g.add(gem);
    const gem2 = gem.clone(); gem2.scale.setScalar(0.6); gem2.position.set(-1.6, -0.8, 0.2); (gem2.material as THREE.MeshPhysicalMaterial) = (gem.material as THREE.MeshPhysicalMaterial).clone(); (gem2.material as THREE.MeshPhysicalMaterial).color.setHex(NEON.red); g.add(gem2);

    st.onFrame((dt, t) => {
      pulse.current = Math.max(0, pulse.current - dt * 1.5);
      const p = pulse.current;
      coin.rotation.y = t * 1.2 + p * 8 * (1 - p);
      coin.rotation.x = Math.sin(t * 0.8) * 0.15;
      g.scale.setScalar(1 + p * 0.25);
      g.position.y = Math.sin(t * 1.5) * 0.1 + p * 0.2;
      gem.rotation.set(t * 0.9, t * 1.3, 0); gem.position.y = 0.9 + Math.sin(t * 2) * 0.12;
      gem2.rotation.set(-t, t * 0.8, 0); gem2.position.y = -0.8 + Math.sin(t * 1.7 + 1) * 0.12;
    });
    return () => st.dispose();
  }, []);
  return <canvas ref={ref} className={className ?? 'h-[120px] w-[120px]'} aria-label="3D-награда" />;
}
