import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { NEON, createStage, detectQuality, dotTexture } from './engine';


/** Фиксированный 3D-фон: дальние частицы, неоновые кольца, лёгкий параллакс от касания/наклона. Один WebGL-контекст на всё приложение. */
export default function Background3D() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const quality = detectQuality();
    if (!canvas || quality === 'off') return;
    const st = createStage(canvas, { fov: 55, z: 10, quality });
    const { scene, camera } = st;

    // дальние звёзды
    const n = quality === 'high' ? 900 : 380;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const palette = [new THREE.Color(NEON.blue2), new THREE.Color(NEON.violet), new THREE.Color(NEON.blue), new THREE.Color(0xffffff), new THREE.Color(NEON.red)];
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 40, (Math.random() - 0.5) * 70, -Math.random() * 40], i * 3);
      const c = palette[Math.floor(Math.random() ** 2 * palette.length)]!;
      col.set([c.r, c.g, c.b], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.14, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    scene.add(stars);

    // спиральная галактика (как в админке)
    const GN = quality === 'high' ? 2600 : 1100;
    const gpos = new Float32Array(GN * 3), gcol = new Float32Array(GN * 3);
    const gpal = [new THREE.Color(0xa855f7), new THREE.Color(0xec4899), new THREE.Color(0x7c3aed), new THREE.Color(0xd946ef), new THREE.Color(0xf0abfc)];
    const white = new THREE.Color(0xffffff);
    for (let i = 0; i < GN; i++) {
      const r = Math.pow(Math.random(), 1.6) * 7.5;
      const arm = ((i % 3) / 3) * Math.PI * 2 + r * 0.55;
      const rnd = () => Math.pow(Math.random(), 3) * (Math.random() < 0.5 ? 1 : -1) * (0.25 + r * 0.18);
      gpos.set([Math.cos(arm) * r + rnd(), rnd() * 0.6, Math.sin(arm) * r + rnd()], i * 3);
      const c = gpal[Math.floor(Math.random() * gpal.length)]!.clone().lerp(white, r < 0.7 ? 0.6 : 0);
      gcol.set([c.r, c.g, c.b], i * 3);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
    const galaxy = new THREE.Points(gg, new THREE.PointsMaterial({ size: 0.11, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
    galaxy.position.set(4.5, 6, -16);
    galaxy.rotation.x = 1.05;
    scene.add(galaxy);

    // неоновые кольца
    const rings: THREE.Mesh[] = [];
    [[7, NEON.blue, -14], [10, NEON.violet, -20], [13.5, NEON.red, -26]].forEach(([r, c, z], i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r as number, 0.025, 8, 160), new THREE.MeshBasicMaterial({ color: c as number, transparent: true, opacity: 0.4 - i * 0.07 }));
      m.position.set(i % 2 ? 4 : -4, i * 3 - 4, z as number);
      m.rotation.x = 1.0 + i * 0.3;
      scene.add(m);
      rings.push(m);
    });

    // частицы вспышки
    const BN = 160;
    const bpos = new Float32Array(BN * 3), bcol = new Float32Array(BN * 3);
    const bvel = new Float32Array(BN * 3);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(bcol, 3));
    const bpts = new THREE.Points(bg, new THREE.PointsMaterial({ size: 0.34, map: dotTexture(), vertexColors: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    bpts.frustumCulled = false;
    scene.add(bpts);
    let burstT = -1;

    const onBurst = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number }>).detail;
      // экранные координаты → плоскость z=0 мировых
      const nx = (d.x / window.innerWidth) * 2 - 1, ny = -((d.y / window.innerHeight) * 2 - 1);
      const v = new THREE.Vector3(nx, ny, 0.5).unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const dist = -camera.position.z / dir.z;
      const p = camera.position.clone().add(dir.multiplyScalar(dist));
      for (let i = 0; i < BN; i++) {
        bpos.set([p.x, p.y, p.z], i * 3);
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6, z = (Math.random() - 0.3) * 3;
        bvel.set([Math.cos(a) * s, Math.sin(a) * s + 1.5, z], i * 3);
        const c = palette[Math.floor(Math.random() * palette.length)]!;
        bcol.set([c.r, c.g, c.b], i * 3);
      }
      bg.attributes.position!.needsUpdate = true;
      bg.attributes.color!.needsUpdate = true;
      burstT = 0;
    };
    window.addEventListener('vaylo:burst', onBurst);

    // параллакс
    let tx = 0, ty = 0;
    const onMove = (e: PointerEvent) => { tx = (e.clientX / window.innerWidth - 0.5) * 2; ty = (e.clientY / window.innerHeight - 0.5) * 2; };
    window.addEventListener('pointermove', onMove, { passive: true });
    const onOrient = (e: DeviceOrientationEvent) => { if (e.gamma != null && e.beta != null) { tx = Math.max(-1, Math.min(1, e.gamma / 30)); ty = Math.max(-1, Math.min(1, (e.beta - 45) / 40)); } };
    window.addEventListener('deviceorientation', onOrient, { passive: true });

    st.onFrame((dt, t) => {
      stars.position.z = (t * 0.25) % 6;
      stars.rotation.z = t * 0.008;
      galaxy.rotation.z += dt * 0.04;
      rings.forEach((r, i) => { r.rotation.z += dt * (0.08 + i * 0.03) * (i % 2 ? -1 : 1); });
      camera.position.x += (tx * 1.2 - camera.position.x) * Math.min(1, dt * 2);
      camera.position.y += (-ty * 1.2 - camera.position.y) * Math.min(1, dt * 2);
      camera.lookAt(0, 0, -5);
      if (burstT >= 0) {
        burstT += dt;
        for (let i = 0; i < BN; i++) {
          bvel[i * 3 + 1]! -= 0;
          bpos[i * 3] += bvel[i * 3]! * dt;
          bpos[i * 3 + 1] += bvel[i * 3 + 1]! * dt;
          bpos[i * 3 + 2] += bvel[i * 3 + 2]! * dt;
          bvel[i * 3] *= 0.985; bvel[i * 3 + 1] *= 0.985;
        }
        bg.attributes.position!.needsUpdate = true;
        (bpts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - burstT / 1.4);
        if (burstT > 1.4) { burstT = -1; bpos.fill(9999); bg.attributes.position!.needsUpdate = true; }
      }
    });
    bpos.fill(9999);

    return () => {
      window.removeEventListener('vaylo:burst', onBurst);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onOrient);
      st.dispose();
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
