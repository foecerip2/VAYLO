import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import envelope from "./envelope.json";

const FPS = 30;
export const TOTAL_FRAMES = 900;
const C = {
  bg: "#07070c",
  orange: "#ff7a45",
  cyan: "#4de1ff",
  violet: "#8b5cf6",
  lime: "#b6ff5c",
  red: "#ff3b5c",
};
const SANS = 'Inter, "DejaVu Sans", sans-serif';
const MONO = '"DejaVu Sans Mono", monospace';
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const sf = (s: number) => Math.round(s * FPS);

const pop = (frame: number, delaySec = 0, damping = 11, stiffness = 170) =>
  spring({
    frame: frame - sf(delaySec),
    fps: FPS,
    config: { damping, stiffness, mass: 0.7 },
  });

// ───────────────────────── captions (timed to the voice-over) ─────────────────────────
const PHRASES = [
  { a: 0.05, b: 2.71, t: "Ты сейчас офигеешь." },
  { a: 2.95, b: 5.26, t: "Это видео сделал Claude." },
  { a: 5.6, b: 6.71, t: "Без After Effects." },
  { a: 7.15, b: 8.25, t: "Без монтажёра." },
  { a: 8.25, b: 9.53, t: "Без единого клика мышкой." },
  { a: 9.72, b: 12.77, t: "Я написал код, и каждый кадр нарисовала программа:" },
  { a: 13.2, b: 15.71, t: "графику, анимацию, субтитры." },
  { a: 16.18, b: 19.14, t: "Даже голос, который ты слышишь, синтезирован." },
  { a: 19.54, b: 21.75, t: "Сценарий, код, озвучка, рендер." },
  { a: 22.15, b: 24.72, t: "Четыре шага, и готовое видео." },
  { a: 24.98, b: 25.86, t: "Хочешь так же?" },
  { a: 26.34, b: 28.76, t: "Подписывайся, и я покажу, как." },
];

const Captions: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const p = PHRASES.find((x) => t >= x.a - 0.04 && t <= x.b + 0.3);
  if (!p) return null;
  const words = p.t.split(" ");
  const total = words.reduce((n, w) => n + w.length + 2, 0);
  let acc = 0;
  const timed = words.map((w) => {
    const s = p.a + (acc / total) * (p.b - p.a);
    acc += w.length + 2;
    return { w, s };
  });
  const enter = pop(f, p.a - 0.04, 14, 220);
  return (
    <div
      style={{
        position: "absolute",
        left: 50,
        right: 50,
        bottom: 210,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "4px 22px",
        fontFamily: SANS,
        fontWeight: 900,
        fontSize: 82,
        lineHeight: 1.12,
        transform: `scale(${0.85 + enter * 0.15})`,
        opacity: enter,
      }}
    >
      {timed.map((x, i) => {
        const next = timed[i + 1]?.s ?? p.b + 1;
        const active = t >= x.s && t < next;
        const said = t >= x.s;
        return (
          <span
            key={i}
            style={{
              color: active ? C.orange : "#fff",
              opacity: said ? 1 : 0.28,
              transform: active ? "scale(1.08)" : "scale(1)",
              textShadow: "0 6px 30px #000, 0 0 6px #000, 0 0 2px #000",
              WebkitTextStroke: "3px #000",
              paintOrder: "stroke fill",
            }}
          >
            {x.w}
          </span>
        );
      })}
    </div>
  );
};

// ───────────────────────── shared pieces ─────────────────────────
const Background: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          width: 1300,
          height: 1300,
          borderRadius: "50%",
          left: -200 + Math.sin(t * 0.7) * 220,
          top: -100 + Math.cos(t * 0.5) * 260,
          background: `radial-gradient(circle, ${C.violet}66, transparent 62%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 1200,
          height: 1200,
          borderRadius: "50%",
          left: 250 + Math.cos(t * 0.6) * 240,
          top: 800 + Math.sin(t * 0.8) * 260,
          background: `radial-gradient(circle, ${C.orange}55, transparent 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.07) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,.07) 2px, transparent 2px)",
          backgroundSize: "90px 90px",
          backgroundPosition: `0 ${f * 3}px`,
          maskImage: "radial-gradient(circle at 50% 45%, #000 20%, transparent 75%)",
        }}
      />
    </AbsoluteFill>
  );
};

const HUD: React.FC = () => {
  const f = useCurrentFrame();
  const blink = Math.floor(f / 15) % 2 === 0;
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 12,
          width: `${(f / TOTAL_FRAMES) * 100}%`,
          background: `linear-gradient(90deg, ${C.violet}, ${C.orange})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 62,
          left: 56,
          right: 56,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: MONO,
          fontSize: 32,
          color: "#fff",
          opacity: 0.92,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: C.red,
              opacity: blink ? 1 : 0.2,
            }}
          />
          СДЕЛАНО КОДОМ
        </div>
        <div>
          {String(f).padStart(4, "0")} / {TOTAL_FRAMES}
        </div>
      </div>
    </>
  );
};

const Flash: React.FC<{ len?: number }> = ({ len = 7 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, len], [0.9, 0], clamp);
  return <AbsoluteFill style={{ background: "#fff", opacity: o }} />;
};

const Scene: React.FC<{ from: number; to: number; noFlash?: boolean; children: React.ReactNode }> = ({
  from,
  to,
  noFlash,
  children,
}) => (
  <Sequence from={sf(from)} durationInFrames={sf(to) - sf(from)}>
    <AbsoluteFill>{children}</AbsoluteFill>
    {!noFlash && <Flash />}
  </Sequence>
);

// ───────────────────────── scene 1: the hook ─────────────────────────
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, 7, 88], [1.2, 1, 1.05], clamp);
  const glitching = f % 14 < 3 || f < 6;
  const amp = glitching ? 26 : 4;
  const shake = {
    x: (random(`hx${f}`) - 0.5) * amp,
    y: (random(`hy${f}`) - 0.5) * amp,
  };
  const split = glitching ? 16 : 4;
  const layer = (color: string, dx: number, mix: string, opacity = 1) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        transform: `translate(${dx + shake.x}px, ${shake.y}px) scale(${scale})`,
        mixBlendMode: mix as any,
        opacity,
        color,
        fontFamily: SANS,
        fontWeight: 900,
        textAlign: "center",
        lineHeight: 1,
      }}
    >
      <div style={{ fontSize: 104, letterSpacing: 2 }}>ТЫ СЕЙЧАС</div>
      <div style={{ fontSize: 134, marginTop: 16 }}>ОФИГЕЕШЬ</div>
    </div>
  );
  return (
    <AbsoluteFill>
      {[0, 1, 2].map((i) => {
        const p = ((f + i * 12) % 36) / 36;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 400,
              height: 400,
              marginLeft: -200,
              marginTop: -200,
              borderRadius: "50%",
              border: `10px solid ${C.orange}`,
              opacity: 0.8 * (1 - p),
              transform: `scale(${0.3 + p * 4.2})`,
            }}
          />
        );
      })}
      {layer(C.red, -split, "screen")}
      {layer(C.cyan, split, "screen")}
      {layer("#ffffff", 0, "normal")}
      <div
        style={{
          position: "absolute",
          top: 330,
          width: "100%",
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 44,
          color: C.orange,
          opacity: f % 10 < 6 ? 1 : 0.35,
          letterSpacing: 4,
        }}
      >
        ▶ ЖМИ И СМОТРИ ДО КОНЦА
      </div>
      {glitching && (
        <AbsoluteFill
          style={{
            background: `repeating-linear-gradient(0deg, rgba(255,255,255,.07) 0 3px, transparent 3px 7px)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 2: "made by Claude" ─────────────────────────
const TitleScene: React.FC = () => {
  const f = useCurrentFrame();
  const a = pop(f, 0, 12, 150);
  const b = pop(f, 0.25, 9, 140);
  const chips = ["React", "Remotion", "FFmpeg"];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: 76,
          color: "#fff",
          letterSpacing: 6,
          opacity: a,
          transform: `translateY(${(1 - a) * -80}px)`,
        }}
      >
        ЭТО ВИДЕО СДЕЛАЛ
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 232,
          lineHeight: 1.1,
          color: "transparent",
          backgroundImage: `linear-gradient(90deg, ${C.orange}, #ffd9bf)`,
          WebkitBackgroundClip: "text",
          transform: `scale(${0.3 + b * 0.7}) rotate(${(1 - b) * -8}deg)`,
          opacity: Math.min(1, b * 1.4),
          filter: `drop-shadow(0 0 50px ${C.orange}bb)`,
        }}
      >
        CLAUDE
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 50 }}>
        {chips.map((c, i) => {
          const p = pop(f, 0.8 + i * 0.12);
          return (
            <div
              key={c}
              style={{
                fontFamily: MONO,
                fontSize: 44,
                color: "#fff",
                padding: "16px 34px",
                borderRadius: 100,
                border: `3px solid ${[C.cyan, C.violet, C.lime][i]}`,
                background: "rgba(255,255,255,.07)",
                transform: `scale(${p}) translateY(${(1 - p) * 40}px)`,
              }}
            >
              {c}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 3: "without ..." ─────────────────────────
const Mouse: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      width: 64,
      height: 96,
      borderRadius: 32,
      border: `7px solid ${color}`,
      position: "relative",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 22,
        top: 12,
        width: 8,
        height: 24,
        borderRadius: 4,
        background: color,
      }}
    />
  </div>
);

const WithoutScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS; // local seconds, scene starts at 5.5s
  const rows = [
    { name: "After Effects", appear: 0.0, strike: 0.7, icon: "Ae", color: C.violet },
    { name: "Монтажёр", appear: 1.5, strike: 2.0, icon: "✂", color: C.cyan },
    { name: "Клик мышкой", appear: 2.65, strike: 3.45, icon: "", color: C.lime },
  ];
  const kick = rows.reduce((m, r) => {
    const d = t - r.strike;
    return d >= 0 && d < 0.5 ? Math.max(m, Math.exp(-d * 9)) : m;
  }, 0);
  const sx = (random(`sx${f}`) - 0.5) * 40 * kick;
  const sy = (random(`sy${f}`) - 0.5) * 40 * kick;
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        transform: `translate(${sx}px, ${sy}px)`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 44 }}>
        {rows.map((r) => {
          const p = pop(f, r.appear, 13, 160);
          const s = interpolate(t, [r.strike, r.strike + 0.22], [0, 1], clamp);
          const bad = interpolate(t, [r.strike, r.strike + 0.2], [0, 1], clamp);
          return (
            <div
              key={r.name}
              style={{
                width: 940,
                height: 200,
                borderRadius: 40,
                background: "rgba(255,255,255,.08)",
                border: `4px solid ${bad > 0.5 ? C.red : r.color}`,
                display: "flex",
                alignItems: "center",
                gap: 40,
                padding: "0 48px",
                position: "relative",
                transform: `translateX(${(1 - p) * -1100}px) rotate(${bad > 0 ? (random(r.name) - 0.5) * 3 * bad : 0}deg)`,
                opacity: 1 - bad * 0.25,
              }}
            >
              <div
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 28,
                  background: `${r.color}33`,
                  border: `4px solid ${r.color}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: SANS,
                  fontWeight: 900,
                  fontSize: 64,
                  color: r.color,
                }}
              >
                {r.icon === "" ? <Mouse color={r.color} /> : r.icon}
              </div>
              <div
                style={{
                  fontFamily: SANS,
                  fontWeight: 800,
                  fontSize: 76,
                  color: "#fff",
                }}
              >
                {r.name}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 30,
                  top: 94,
                  height: 14,
                  width: s * 880,
                  background: C.red,
                  borderRadius: 7,
                  boxShadow: `0 0 30px ${C.red}`,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 36,
                  top: 36,
                  fontFamily: SANS,
                  fontWeight: 900,
                  fontSize: 110,
                  color: C.red,
                  opacity: bad,
                  transform: `scale(${0.5 + bad * 0.5})`,
                }}
              >
                ✕
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 4: code → frames ─────────────────────────
const CODE = `export const Video = () => {
  const frame = useCurrentFrame();
  const x = interpolate(frame,
    [0, 30], [0, 1080]);
  return <Scene x={x} />;
};`;

const highlight = (src: string) =>
  src.split(/(\b(?:export|const|return)\b|\b\d+\b|\b[a-zA-Z]+(?=\())/).map((part, i) => {
    let color = "#e8e8f0";
    if (/^(export|const|return)$/.test(part)) color = C.orange;
    else if (/^\d+$/.test(part)) color = C.cyan;
    else if (/^[a-zA-Z]+$/.test(part) && src.includes(part + "(")) color = C.lime;
    return (
      <span key={i} style={{ color }}>
        {part}
      </span>
    );
  });

const CodeScene: React.FC = () => {
  const f = useCurrentFrame();
  const typed = Math.floor(interpolate(f, [4, 120], [0, CODE.length], clamp));
  const win = pop(f, 0, 14, 160);
  const counter = Math.floor(interpolate(f, [0, 190], [0, 897], clamp));
  const strip = f * 7;
  const TILE = 200;
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          marginTop: 190,
          width: 960,
          borderRadius: 34,
          background: "#0e0e18",
          border: "3px solid rgba(255,255,255,.18)",
          boxShadow: `0 30px 90px rgba(0,0,0,.6), 0 0 80px ${C.violet}44`,
          transform: `scale(${0.8 + win * 0.2})`,
          opacity: win,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 14, padding: "22px 28px", background: "#181826" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 24, height: 24, borderRadius: 12, background: c }} />
          ))}
          <div style={{ marginLeft: 20, fontFamily: MONO, fontSize: 28, color: "#9a9ab5" }}>
            Video.tsx
          </div>
        </div>
        <pre
          style={{
            margin: 0,
            padding: "30px 34px",
            fontFamily: MONO,
            fontSize: 37,
            lineHeight: 1.5,
            minHeight: 400,
            whiteSpace: "pre-wrap",
          }}
        >
          {highlight(CODE.slice(0, typed))}
          <span style={{ color: C.orange, opacity: Math.floor(f / 8) % 2 === 0 ? 1 : 0 }}>▌</span>
        </pre>
      </div>

      <div
        style={{
          marginTop: 36,
          fontFamily: MONO,
          fontSize: 38,
          letterSpacing: 8,
          color: "#9a9ab5",
        }}
      >
        КАДР
      </div>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 190,
          lineHeight: 1,
          color: "#fff",
          fontVariantNumeric: "tabular-nums",
          textShadow: `0 0 60px ${C.cyan}88`,
        }}
      >
        {String(counter).padStart(4, "0")}
      </div>

      <div
        style={{
          marginTop: 40,
          width: 1000,
          height: 250,
          overflow: "hidden",
          borderRadius: 24,
          border: "3px solid rgba(255,255,255,.15)",
          position: "relative",
          background: "#000",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -(strip % TILE),
            top: 0,
            display: "flex",
          }}
        >
          {Array.from({ length: 7 }).map((_, k) => {
            const n = Math.floor(strip / TILE) + k;
            const hue = (n * 47) % 360;
            return (
              <div
                key={n}
                style={{
                  width: TILE - 10,
                  height: 250,
                  marginRight: 10,
                  background: `linear-gradient(160deg, hsl(${hue} 80% 55%), hsl(${(hue + 70) % 360} 80% 25%))`,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 30 + ((n * 37) % 90),
                    top: 40 + ((n * 53) % 110),
                    width: 70,
                    height: 70,
                    borderRadius: n % 2 ? 35 : 10,
                    background: "rgba(255,255,255,.85)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    bottom: 8,
                    fontFamily: MONO,
                    fontSize: 28,
                    color: "#fff",
                  }}
                >
                  {String(n).padStart(3, "0")}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 26, fontFamily: MONO, fontSize: 34, color: C.lime }}>
        30 fps · 900 кадров · 0 кликов
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 5: voice ─────────────────────────
const VoiceScene: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const f = useCurrentFrame();
  const abs = startFrame + f;
  const env = (n: number) => (envelope as number[])[Math.max(0, n)] ?? 0;
  const title = pop(f, 0, 12, 150);
  const bars = 36;
  const now = env(abs);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 190,
          color: "#fff",
          transform: `scale(${0.5 + title * 0.5})`,
          opacity: title,
          lineHeight: 1,
          textShadow: `0 0 60px ${C.orange}88`,
        }}
      >
        ГОЛОС
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 42,
          color: C.orange,
          letterSpacing: 5,
          margin: "18px 0 70px",
          opacity: title,
        }}
      >
        СИНТЕЗ РЕЧИ · RU
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, height: 430 }}>
        {Array.from({ length: bars }).map((_, i) => {
          const v = env(abs - (bars - 1 - i));
          const h = 14 + v * 410;
          const g = i / bars;
          return (
            <div
              key={i}
              style={{
                width: 20,
                height: h,
                borderRadius: 10,
                background: `linear-gradient(180deg, ${C.cyan}, ${C.violet})`,
                opacity: 0.35 + g * 0.65,
                boxShadow: i === bars - 1 ? `0 0 40px ${C.cyan}` : undefined,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          marginTop: 20,
          width: 110 + now * 60,
          height: 110 + now * 60,
          borderRadius: "50%",
          border: `8px solid ${C.orange}`,
          boxShadow: `0 0 ${40 + now * 80}px ${C.orange}`,
          opacity: pop(f, 0.3),
        }}
      />
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 6: four steps ─────────────────────────
const StepsScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS; // scene starts at 19.5s
  const steps = [
    { n: "01", title: "Сценарий", file: "script.md", at: 0.1, color: C.cyan },
    { n: "02", title: "Код", file: "Video.tsx", at: 0.7, color: C.violet },
    { n: "03", title: "Озвучка", file: "voice.wav", at: 1.3, color: C.orange },
    { n: "04", title: "Рендер", file: "video.mp4", at: 1.9, color: C.lime },
  ];
  const head = pop(f, 0, 12, 160);
  const pulse = pop(f, 2.65, 8, 220);
  const done = pop(f, 4.0, 10, 160);
  const fill = interpolate(t, [2.65, 4.0], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          marginTop: 200,
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 130,
          color: "#fff",
          opacity: head,
          transform: `scale(${(0.7 + head * 0.3) * (1 + (pulse - 1 < 0 ? 0 : 0) + (t > 2.65 ? (1 - Math.min(1, pulse)) * 0 : 0))})`,
        }}
      >
        4 ШАГА
      </div>
      <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 26 }}>
        {steps.map((s) => {
          const p = pop(f, s.at, 13, 170);
          return (
            <div
              key={s.n}
              style={{
                width: 940,
                height: 176,
                borderRadius: 36,
                background: "rgba(255,255,255,.08)",
                border: `4px solid ${s.color}`,
                display: "flex",
                alignItems: "center",
                gap: 36,
                padding: "0 44px",
                transform: `translateX(${(1 - p) * 1100}px)`,
                boxShadow: `0 0 50px ${s.color}33`,
              }}
            >
              <div
                style={{
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: 76,
                  color: s.color,
                }}
              >
                {s.n}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: SANS, fontWeight: 900, fontSize: 70, color: "#fff" }}>
                  {s.title}
                </div>
              </div>
              <div style={{ fontFamily: MONO, fontSize: 34, color: "#9a9ab5" }}>{s.file}</div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 44,
          width: 940,
          height: 34,
          borderRadius: 17,
          background: "rgba(255,255,255,.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${fill * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${C.violet}, ${C.lime})`,
          }}
        />
      </div>
      <div
        style={{
          marginTop: 28,
          fontFamily: MONO,
          fontSize: 46,
          fontWeight: 700,
          color: "#06130a",
          background: C.lime,
          padding: "12px 38px",
          borderRadius: 100,
          transform: `scale(${done})`,
          opacity: done,
        }}
      >
        ✓ ГОТОВО · video.mp4
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 7: CTA ─────────────────────────
const CtaScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS; // scene starts at 24.9s
  const q = pop(f, 0.1, 10, 150);
  const btn = pop(f, 1.4, 8, 150);
  const glow = 40 + Math.sin(f / 4) * 25;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {Array.from({ length: 30 }).map((_, i) => {
        const speed = 3 + random(`s${i}`) * 5;
        const x = random(`x${i}`) * 1080;
        const y = 1920 - ((f * speed * 2 + random(`y${i}`) * 1920) % 2100);
        const size = 14 + random(`z${i}`) * 26;
        const color = [C.orange, C.cyan, C.violet, C.lime][i % 4];
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              background: color,
              opacity: 0.6,
              borderRadius: i % 3 === 0 ? size : 4,
              transform: `rotate(${f * (i % 5) * 3}deg)`,
            }}
          />
        );
      })}
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 150,
          lineHeight: 1.05,
          color: "#fff",
          textAlign: "center",
          transform: `scale(${0.4 + q * 0.6}) rotate(${(1 - q) * 6}deg)`,
          opacity: q,
          textShadow: `0 0 60px ${C.violet}`,
        }}
      >
        ХОЧЕШЬ
        <br />
        ТАК ЖЕ?
      </div>
      <div
        style={{
          marginTop: 90,
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 84,
          color: "#fff",
          background: `linear-gradient(90deg, ${C.red}, ${C.orange})`,
          padding: "34px 80px",
          borderRadius: 120,
          boxShadow: `0 0 ${glow}px ${C.orange}`,
          transform: `scale(${btn * (1 + Math.sin(f / 5) * 0.025)})`,
          opacity: btn,
        }}
      >
        ПОДПИСАТЬСЯ
      </div>
      <div
        style={{
          marginTop: 40,
          fontFamily: MONO,
          fontSize: 38,
          color: "#9a9ab5",
          opacity: interpolate(t, [2.4, 2.8], [0, 1], clamp),
        }}
      >
        покажу, как это сделать
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── main ─────────────────────────
export const Main: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Audio src={staticFile("voice.wav")} />
      <Audio src={staticFile("music.wav")} volume={0.5} />
      <Background />
      <Scene from={0} to={2.9} noFlash>
        <Hook />
      </Scene>
      <Scene from={2.9} to={5.5}>
        <TitleScene />
      </Scene>
      <Scene from={5.5} to={9.65}>
        <WithoutScene />
      </Scene>
      <Scene from={9.65} to={16.1}>
        <CodeScene />
      </Scene>
      <Scene from={16.1} to={19.5}>
        <VoiceScene startFrame={sf(16.1)} />
      </Scene>
      <Scene from={19.5} to={24.9}>
        <StepsScene />
      </Scene>
      <Scene from={24.9} to={30}>
        <CtaScene />
      </Scene>
      <HUD />
      <Captions />
    </AbsoluteFill>
  );
};
