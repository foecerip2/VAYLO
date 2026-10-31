import { useEffect, useRef } from 'react';
import { COUNTRY_LL } from './countries';
import { LAND } from './land';

export interface GlobeNode { id: string; name: string; countryCode?: string | null; online: boolean; usersOnline: number; lat?: number | null; lng?: number | null }
/** координаты точки: от сервера (автоопределение), иначе по коду страны */
const llOf = (n: GlobeNode): [number, number] | undefined => (typeof n.lat === 'number' && typeof n.lng === 'number' ? [n.lat, n.lng] : n.countryCode ? COUNTRY_LL[n.countryCode.toUpperCase()] : undefined);

const D2R = Math.PI / 180;
const ZMIN = 0.85, ZMAX = 3.2;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/**
 * Интерактивный глобус на обычном Canvas 2D (без WebGL и без three.js): работает на любом устройстве и по слабой сети.
 * Вращение пальцем/мышью с инерцией, приближение щипком / колесом / кнопками +/−, тап по маркеру выбирает сервер,
 * камера плавно доворачивает и приближается к выбранной точке.
 */
export default function GlobeScene({ nodes, selectedId, onSelect, className }: { nodes: GlobeNode[]; selectedId?: string | null; onSelect?: (id: string) => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ zoom: (k: number) => void; reset: () => void }>({ zoom: () => {}, reset: () => {} });
  const state = useRef({ nodes, selectedId: selectedId ?? null, onSelect });
  state.current = { nodes, selectedId: selectedId ?? null, onSelect };

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let W = 1, H = 1, dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    // lon0 — долгота в центре, lat0 — наклон; точки хранятся в радианах заранее
    let lon0 = 20 * D2R, lat0 = 22 * D2R, zoom = 1, zoomT = 1;
    const land = LAND.map(([la, lo]) => [la * D2R, lo * D2R] as const);
    const starSeed = Array.from({ length: 70 }, (_, i) => [(Math.sin(i * 12.9898) * 43758.5453) % 1, (Math.sin(i * 78.233) * 12543.123) % 1, 0.4 + ((i * 37) % 10) / 12] as const);

    const project = (lat: number, lon: number, R: number, cx: number, cy: number) => {
      const dl = lon - lon0;
      const cl = Math.cos(lat), sl = Math.sin(lat);
      const x = cl * Math.sin(dl);
      const y = Math.cos(lat0) * sl - Math.sin(lat0) * cl * Math.cos(dl);
      const z = Math.sin(lat0) * sl + Math.cos(lat0) * cl * Math.cos(dl);
      return { x: cx + x * R, y: cy - y * R, z };
    };

    let focus: { lon: number; lat: number; zoom: number } | null = null;
    let dragging = false, lastX = 0, lastY = 0, moved = 0, vLon = 0, vLat = 0, idle = 0;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    type Hit = { id: string; x: number; y: number; r: number };
    let hits: Hit[] = [];

    const base = () => Math.min(W, H) * 0.42;
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y); }
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; focus = null; vLon = vLat = 0;
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinch > 0) zoomT = clamp(zoomT * (d / pinch), ZMIN, ZMAX);
        pinch = d; moved = 99; return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      const k = 1 / (base() * zoom);
      lon0 -= dx * k; lat0 = clamp(lat0 + dy * k, -1.25, 1.25); vLon = -dx * k; vLat = dy * k; idle = 0;
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      if (pts.size > 0) return;
      dragging = false;
      if (moved < 8) {
        const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
        let best: Hit | null = null, bd = 1e9;
        for (const h of hits) { const d = Math.hypot(h.x - px, h.y - py); if (d < h.r && d < bd) { best = h; bd = d; } }
        if (best) state.current.onSelect?.(best.id);
      }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoomT = clamp(zoomT * Math.exp(-e.deltaY * 0.0015), ZMIN, ZMAX); };
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    const centroid = () => {
      let x = 0, y = 0, z = 0, n = 0;
      for (const nd of state.current.nodes) { const ll = llOf(nd); if (!ll) continue; const la = ll[0] * D2R, lo = ll[1] * D2R; x += Math.cos(la) * Math.sin(lo); y += Math.sin(la); z += Math.cos(la) * Math.cos(lo); n++; }
      return n ? { lon: Math.atan2(x, z), lat: Math.atan2(y, Math.hypot(x, z)) } : null;
    };
    api.current = { zoom: (k) => {
        const nz = clamp(zoomT * k, ZMIN, ZMAX);
        // приближаем к серверам, а не к пустому центру шара
        const c = k > 1 && !state.current.selectedId ? centroid() : null;
        focus = c ? { lon: c.lon, lat: c.lat * 0.85, zoom: nz } : null;
        zoomT = nz;
      }, reset: () => { focus = { lon: 20 * D2R, lat: 22 * D2R, zoom: 1 }; } };

    let lastSel: string | null = null;
    let raf = 0, last = performance.now(), visible = true, t = 0;
    const io = new IntersectionObserver((e) => { visible = e[0]?.isIntersecting ?? true; }); io.observe(canvas);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible || document.hidden) return;
      t += dt; idle += dt;
      const { nodes: ns, selectedId: sel } = state.current;
      if (sel !== lastSel) {
        lastSel = sel;
        const n = ns.find((x) => x.id === sel); const ll = n ? llOf(n) : undefined;
        if (ll) focus = { lon: ll[1] * D2R, lat: ll[0] * D2R * 0.8, zoom: Math.max(zoomT, 1.7) };
      }
      if (focus) {
        const dl = Math.atan2(Math.sin(focus.lon - lon0), Math.cos(focus.lon - lon0));
        const k = Math.min(1, dt * 4.5);
        lon0 += dl * k; lat0 += (focus.lat - lat0) * k; zoomT += (focus.zoom - zoomT) * k;
        if (Math.abs(dl) < 0.004 && Math.abs(focus.lat - lat0) < 0.004) focus = null;
      } else if (!dragging) {
        const f = Math.pow(0.03, dt); vLon *= f; vLat *= f;
        lon0 += vLon; lat0 = clamp(lat0 + vLat, -1.25, 1.25);
        if (idle > 2.5 && !reduced && !sel) lon0 += dt * 0.14;
      }
      zoom += (zoomT - zoom) * Math.min(1, dt * 8);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2 + (zoom > 1.4 ? 0 : 0), R = base() * zoom;

      // звёзды
      ctx.fillStyle = '#f5d0fe';
      for (const [sx, sy, a] of starSeed) { ctx.globalAlpha = 0.15 + 0.25 * Math.abs(Math.sin(t * a + sx * 9)); ctx.fillRect(Math.abs(sx) * W, Math.abs(sy) * H, 1.4, 1.4); }
      ctx.globalAlpha = 1;
      // свечение (атмосфера)
      const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
      glow.addColorStop(0, 'rgba(168,85,247,.38)'); glow.addColorStop(0.45, 'rgba(236,72,153,.12)'); glow.addColorStop(1, 'rgba(168,85,247,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 7); ctx.fill();
      // шар
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      body.addColorStop(0, '#2c1450'); body.addColorStop(0.6, '#150a28'); body.addColorStop(1, '#0a0514');
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgba(216,180,254,.5)'; ctx.stroke();

      // сетка
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
      ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(192,132,252,.16)';
      for (let la = -60; la <= 60; la += 30) { ctx.beginPath(); let pen = false; for (let lo = -180; lo <= 181; lo += 6) { const p = project(la * D2R, lo * D2R, R, cx, cy); if (p.z > 0) { pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; } else pen = false; } ctx.stroke(); }
      for (let lo = -180; lo < 180; lo += 30) { ctx.beginPath(); let pen = false; for (let la = -90; la <= 90; la += 6) { const p = project(la * D2R, lo * D2R, R, cx, cy); if (p.z > 0) { pen ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); pen = true; } else pen = false; } ctx.stroke(); }

      // материки — точки; ближе к краю тусклее и мельче
      const ds = Math.max(1.1, R * 0.0105);
      for (const [la, lo] of land) {
        const p = project(la, lo, R, cx, cy);
        if (p.z <= 0.02) continue;
        const a = 0.25 + 0.75 * Math.pow(p.z, 0.7);
        ctx.fillStyle = `rgba(${233 - Math.round((1 - p.z) * 60)},${184 - Math.round((1 - p.z) * 60)},255,${a.toFixed(2)})`;
        const s = ds * (0.55 + 0.6 * p.z);
        ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, 7); ctx.fill();
      }
      ctx.restore();

      // маркеры
      hits = [];
      const items: { n: GlobeNode; p: { x: number; y: number; z: number } }[] = [];
      for (const n of ns) {
        const ll = llOf(n);
        if (!ll) continue;
        const p = project(ll[0] * D2R, ll[1] * D2R, R, cx, cy);
        if (p.z > 0.08) items.push({ n, p });
      }
      items.sort((a, b) => a.p.z - b.p.z);
      for (const { n, p } of items) {
        const isSel = n.id === sel;
        const col = n.online ? '34,211,160' : '236,72,153';
        const pulse = (t * 0.8 + p.x * 0.01) % 1;
        const r0 = (isSel ? 7 : 5) * (0.8 + Math.min(zoom, 2) * 0.25);
        ctx.strokeStyle = `rgba(${col},${(1 - pulse) * 0.7})`; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, r0 + pulse * 14, 0, 7); ctx.stroke();
        ctx.fillStyle = `rgba(${col},.28)`; ctx.beginPath(); ctx.arc(p.x, p.y, r0 * 1.9, 0, 7); ctx.fill();
        ctx.fillStyle = `rgb(${col})`; ctx.beginPath(); ctx.arc(p.x, p.y, r0, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = isSel ? 2 : 1; ctx.stroke();
        hits.push({ id: n.id, x: p.x, y: p.y, r: Math.max(22, r0 * 3) });
        if (isSel || zoom > 2.3) {
          ctx.font = '700 12px Manrope, system-ui, sans-serif';
          const label = `${n.name.length > 22 ? n.name.slice(0, 21) + '…' : n.name}${n.online ? ` · ${n.usersOnline}` : ''}`;
          const w = ctx.measureText(label).width + 16;
          const lx = clamp(p.x - w / 2, 6, W - w - 6), ly0 = p.y - r0 - 30, ly = ly0 < 6 ? p.y + r0 + 10 : ly0;
          ctx.fillStyle = 'rgba(14,8,26,.88)'; ctx.strokeStyle = 'rgba(192,132,252,.55)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.roundRect(lx, ly, w, 22, 11); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx + 8, ly + 11.5);
        }
      }
      // блик
      const sh = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.5, 0, cx - R * 0.45, cy - R * 0.5, R * 0.9);
      sh.addColorStop(0, 'rgba(255,255,255,.07)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, []);

  const btn = 'flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-lg font-bold backdrop-blur transition active:scale-90 hover:border-primary/50';
  return (
    <div className="relative">
      <canvas ref={ref} className={className ?? 'h-[340px] w-full touch-none md:h-[420px]'} aria-label="Глобус локаций" />
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        <button type="button" className={btn} aria-label="Приблизить" onClick={() => api.current.zoom(1.4)}>+</button>
        <button type="button" className={btn} aria-label="Отдалить" onClick={() => api.current.zoom(1 / 1.4)}>−</button>
        <button type="button" className={btn} aria-label="Сбросить вид" onClick={() => api.current.reset()}>⟲</button>
      </div>
    </div>
  );
}
