import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  random,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import envelope from "./envelope.json";
import { PHRASES, SCENES } from "./timeline";

const FPS = 30;
export const TOTAL_FRAMES = 960;
const C = {
  bg: "#07070c",
  orange: "#ff7a45",
  cyan: "#4de1ff",
  violet: "#8b5cf6",
  lime: "#b6ff5c",
  red: "#ff2d55",
  yellow: "#ffd400",
};
const SANS = 'Inter, "DejaVu Sans", sans-serif';
const MONO = '"DejaVu Sans Mono", monospace';
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const outCubic = { ...clamp, easing: Easing.out(Easing.cubic) } as const;
const sf = (s: number) => Math.round(s * FPS);
const OVERLAP = 14;

const pop = (frame: number, delaySec = 0, damping = 11, stiffness = 170) =>
  spring({
    frame: frame - sf(delaySec),
    fps: FPS,
    config: { damping, stiffness, mass: 0.7 },
  });

// ───────────────────────── particles ─────────────────────────
const Burst: React.FC<{
  x: number;
  y: number;
  start: number;
  count?: number;
  seed?: string;
  life?: number;
  speed?: number;
  size?: number;
  gravity?: number;
  colors?: string[];
}> = ({
  x,
  y,
  start,
  count = 30,
  seed = "b",
  life = 28,
  speed = 40,
  size = 10,
  gravity = 0.5,
  colors = [C.orange, C.yellow, "#fff"],
}) => {
  const f = useCurrentFrame();
  const t = f - start;
  if (t < 0 || t > life) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const a = random(`${seed}a${i}`) * Math.PI * 2;
        const v = (0.35 + random(`${seed}v${i}`) * 0.65) * speed;
        const dist = v * (1 - Math.exp(-t / 7)) * 7;
        const px = x + Math.cos(a) * dist;
        const py = y + Math.sin(a) * dist + gravity * t * t * 0.5;
        const k = 1 - t / life;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: px,
              top: py,
              width: size * (1 + 3 * k),
              height: size * 0.45,
              borderRadius: 4,
              background: colors[i % colors.length],
              opacity: k,
              transform: `translate(-50%, -50%) rotate(${a}rad)`,
              boxShadow: `0 0 14px ${colors[i % colors.length]}`,
            }}
          />
        );
      })}
    </>
  );
};

// ───────────────────────── captions ─────────────────────────
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
              transform: active ? "scale(1.1) rotate(-1.5deg)" : "scale(1)",
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

// ───────────────────────── background / hud / transitions ─────────────────────────
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

type Transition = "none" | "flash" | "circle" | "wipe" | "blinds" | "zoom";

const Shell: React.FC<{ type: Transition; children: React.ReactNode }> = ({ type, children }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, 14], [0, 1], outCubic);
  const style: React.CSSProperties = {};
  if (type === "circle") style.clipPath = `circle(${p * 1500}px at 50% 50%)`;
  if (type === "wipe") {
    const x = p * 160;
    style.clipPath = `polygon(0 0, ${x}% 0, ${x - 60}% 100%, 0 100%)`;
  }
  if (type === "blinds") {
    const m = `repeating-linear-gradient(180deg, #000 0px, #000 ${p * 130}px, transparent ${p * 130}px, transparent 130px)`;
    style.maskImage = m;
    style.WebkitMaskImage = m;
  }
  if (type === "zoom") {
    style.transform = `scale(${1 + (1 - p) * 0.8})`;
    style.opacity = Math.min(1, p * 2.5);
    style.filter = `blur(${(1 - p) * 18}px)`;
  }
  return (
    <>
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {(type === "flash" || type === "zoom") && (
        <AbsoluteFill
          style={{
            background: "#fff",
            opacity: interpolate(f, [0, 8], [type === "flash" ? 0.85 : 0.4, 0], clamp),
          }}
        />
      )}
    </>
  );
};

const FadeOut: React.FC<{ dur: number; last?: boolean; children: React.ReactNode }> = ({
  dur,
  last,
  children,
}) => {
  const f = useCurrentFrame();
  // the outgoing scene disappears quickly while the next one's transition plays over it
  const o = last ? 1 : interpolate(f, [dur - OVERLAP, dur - OVERLAP + 9], [1, 0], clamp);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Scene: React.FC<{
  range: readonly [number, number];
  type?: Transition;
  last?: boolean;
  children: React.ReactNode;
}> = ({ range, type = "none", last, children }) => {
  const dur = sf(range[1]) - sf(range[0]) + (last ? 0 : OVERLAP);
  return (
    <Sequence from={sf(range[0])} durationInFrames={dur}>
      <FadeOut dur={dur} last={last}>
        <Shell type={type}>{children}</Shell>
      </FadeOut>
    </Sequence>
  );
};

// ───────────────────────── scene 1: the HARD hook ─────────────────────────
const Tape: React.FC<{ y: number; rot: number; dir: number; delay: number; text: string }> = ({
  y,
  rot,
  dir,
  delay,
  text,
}) => {
  const f = useCurrentFrame();
  const p = pop(f, delay, 14, 140);
  const line = Array.from({ length: 14 }).map(() => text).join("");
  return (
    <div
      style={{
        position: "absolute",
        left: -200,
        top: y,
        width: 1500,
        height: 92,
        overflow: "hidden",
        background: C.yellow,
        transform: `rotate(${rot}deg) translateX(${(1 - p) * dir * 1500}px)`,
        boxShadow: "0 12px 40px rgba(0,0,0,.6)",
      }}
    >
      <div
        style={{
          whiteSpace: "nowrap",
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 56,
          lineHeight: "92px",
          color: "#000",
          transform: `translateX(${-((f * 20 * dir) % 900) - (dir > 0 ? 0 : 0)}px)`,
          letterSpacing: 3,
        }}
      >
        {line}
      </div>
    </div>
  );
};

const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const beat = Math.exp(-(f % 15) / 3.2);
  const glitchOn = f >= 12 && f % 19 < 3;
  const amp = 46 * Math.exp(-Math.max(0, f - 6) / 5) + (glitchOn ? 14 : 2);
  const shake = {
    x: (random(`hx${f}`) - 0.5) * amp,
    y: (random(`hy${f}`) - 0.5) * amp,
    r: (random(`hr${f}`) - 0.5) * amp * 0.05,
  };
  const s1 = interpolate(f, [0, 4, 8], [2.2, 0.92, 1], outCubic);
  const s2 = interpolate(f - 6, [0, 4, 9], [3.2, 0.88, 1], outCubic);
  const b1 = interpolate(f, [0, 5], [14, 0], clamp);
  const b2 = interpolate(f - 6, [0, 5], [26, 0], clamp);
  const split = 5 + 34 * Math.exp(-Math.max(0, f - 6) / 6) + (glitchOn ? 16 : 0);
  const drift = interpolate(f, [9, 87], [1, 1.07], clamp);

  const lines = (fill: string, blur: boolean, glow = false) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: SANS,
        fontWeight: 900,
        lineHeight: 1,
        color: fill,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 108,
          transform: `scale(${s1})`,
          filter: blur ? `blur(${b1}px)` : undefined,
          textShadow: glow ? `0 0 50px ${C.red}` : undefined,
        }}
      >
        ТЫ СЕЙЧАС
      </div>
      <div
        style={{
          fontSize: 150,
          marginTop: 18,
          transform: `scale(${s2})`,
          filter: blur ? `blur(${b2}px)` : undefined,
          textShadow: glow ? `0 0 70px ${C.red}, 0 0 20px ${C.orange}` : undefined,
        }}
      >
        ОХУЕЕШЬ
      </div>
    </div>
  );

  return (
    <AbsoluteFill>
      {/* red alarm vignette */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, transparent 35%, ${C.red}${Math.round(
            60 + beat * 120,
          )
            .toString(16)
            .padStart(2, "0")} 100%)`,
        }}
      />
      {/* shockwaves */}
      {[0, 6].map((d, i) => {
        const p = interpolate(f - d, [0, 16], [0, 1], outCubic);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 540 - 250,
              top: 960 - 250,
              width: 500,
              height: 500,
              borderRadius: "50%",
              border: `${28 * (1 - p) + 4}px solid ${i ? "#fff" : C.orange}`,
              opacity: f - d < 0 ? 0 : 1 - p,
              transform: `scale(${0.2 + p * 6})`,
            }}
          />
        );
      })}
      <Burst x={540} y={960} start={6} count={44} seed="hook" speed={60} size={22} life={26} gravity={0.2} />
      <Burst x={540} y={960} start={0} count={20} seed="hook0" speed={40} size={16} life={18} gravity={0} colors={[C.red, "#fff"]} />

      <Tape y={330} rot={-6} dir={1} delay={0.4} text="ВНИМАНИЕ ▮ ЭТО КОД ▮ " />
      <Tape y={1290} rot={5} dir={-1} delay={0.5} text="БЕЗ AFTER EFFECTS ▮ БЕЗ МОНТАЖЁРА ▮ " />

      <AbsoluteFill
        style={{
          transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg) scale(${drift + beat * 0.02})`,
        }}
      >
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${-split}px)`, mixBlendMode: "screen" }}>
          {lines(C.red, false)}
        </div>
        <div style={{ position: "absolute", inset: 0, transform: `translateX(${split}px)`, mixBlendMode: "screen" }}>
          {lines(C.cyan, false)}
        </div>
        {lines("#ffffff", true, true)}
        {glitchOn &&
          [0, 1, 2, 3].map((i) => {
            const top = random(`gt${f}${i}`) * 80;
            const h = 6 + random(`gh${f}${i}`) * 12;
            const dx = (random(`gx${f}${i}`) - 0.5) * 160;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: `inset(${top}% 0 ${100 - top - h}% 0)`,
                  transform: `translateX(${dx}px)`,
                }}
              >
                {lines(i % 2 ? C.cyan : "#fff", false)}
              </div>
            );
          })}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          background: "#fff",
          opacity: interpolate(f, [6, 7, 12], [0, 0.75, 0], clamp),
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,.06) 0 3px, transparent 3px 7px)",
        }}
      />
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 2: "made by Claude" ─────────────────────────
const StarBurst: React.FC<{ size: number; rot: number; color: string }> = ({ size, rot, color }) => {
  const rays = 12;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-100 -100 200 200"
      style={{ transform: `rotate(${rot}deg)` }}
    >
      {Array.from({ length: rays }).map((_, i) => {
        const a = (i / rays) * 360;
        const long = i % 2 === 0;
        return (
          <polygon
            key={i}
            points={`-7,0 0,${long ? -96 : -66} 7,0`}
            fill={color}
            transform={`rotate(${a})`}
          />
        );
      })}
    </svg>
  );
};

const TitleScene: React.FC = () => {
  const f = useCurrentFrame();
  const a = pop(f, 0.0, 12, 150);
  const intro = "ЭТО ВИДЕО СДЕЛАЛ".split("");
  const name = "CLAUDE".split("");
  const chips = ["React", "Remotion", "FFmpeg"];
  const burstIn = pop(f, 0.1, 16, 60);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          left: 540 - 500,
          top: 880 - 500,
          opacity: 0.35 * burstIn,
          transform: `scale(${burstIn})`,
          filter: `blur(2px) drop-shadow(0 0 60px ${C.orange})`,
        }}
      >
        <StarBurst size={1000} rot={f * 1.4} color={C.orange} />
      </div>
      {Array.from({ length: 14 }).map((_, i) => {
        const ang = (i / 14) * Math.PI * 2 + f * 0.035;
        const r = 470 + Math.sin(f / 8 + i) * 30;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: 540 + Math.cos(ang) * r - 11,
              top: 880 + Math.sin(ang) * r * 0.55 - 11,
              width: 22,
              height: 22,
              borderRadius: i % 2 ? 11 : 4,
              background: [C.cyan, C.orange, C.violet, C.lime][i % 4],
              opacity: a,
              boxShadow: `0 0 20px ${[C.cyan, C.orange, C.violet, C.lime][i % 4]}`,
              transform: `rotate(${f * 6}deg)`,
            }}
          />
        );
      })}
      <div style={{ display: "flex", whiteSpace: "pre", marginBottom: 6 }}>
        {intro.map((ch, i) => {
          const p = pop(f, i * 0.025, 9, 220);
          return (
            <div
              key={i}
              style={{
                fontFamily: SANS,
                fontWeight: 800,
                fontSize: 76,
                color: "#fff",
                letterSpacing: 4,
                opacity: Math.min(1, p * 1.5),
                transform: `translateY(${(1 - p) * -260}px) rotate(${(1 - p) * (i % 2 ? 40 : -40)}deg)`,
              }}
            >
              {ch}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", perspective: 1000 }}>
        {name.map((ch, i) => {
          const p = pop(f, 0.2 + i * 0.07, 8, 130);
          const hue = interpolate(Math.sin(f / 10 + i), [-1, 1], [0, 1]);
          return (
            <div
              key={i}
              style={{
                fontFamily: SANS,
                fontWeight: 900,
                fontSize: 220,
                lineHeight: 1.1,
                color: "transparent",
                backgroundImage: `linear-gradient(180deg, #ffe2cf ${hue * 30}%, ${C.orange} 70%)`,
                WebkitBackgroundClip: "text",
                transform: `rotateX(${(1 - p) * -110}deg) translateY(${(1 - p) * 120}px) scale(${0.5 + p * 0.5})`,
                transformOrigin: "50% 100%",
                opacity: Math.min(1, p * 2),
                filter: `drop-shadow(0 0 ${30 + 25 * hue}px ${C.orange}cc)`,
              }}
            >
              {ch}
            </div>
          );
        })}
      </div>
      <Burst x={540} y={880} start={sf(0.55)} count={36} seed="claude" speed={70} size={20} life={26} />
      <div style={{ display: "flex", gap: 24, marginTop: 50 }}>
        {chips.map((c, i) => {
          const p = pop(f, 0.9 + i * 0.12);
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
                transform: `scale(${p}) translateY(${(1 - p) * 60}px) rotate(${(1 - p) * (i - 1) * 25}deg)`,
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

type Row = { name: string; appear: number; strike: number; icon: string; color: string };

const RowBody: React.FC<{ r: Row; strikeW: number; bad: number }> = ({ r, strikeW, bad }) => (
  <>
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
    <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 76, color: "#fff" }}>{r.name}</div>
    <div
      style={{
        position: "absolute",
        left: 30,
        top: 94,
        height: 14,
        width: strikeW * 880,
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
  </>
);

const WithoutScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const rows: Row[] = [
    { name: "After Effects", appear: 0.0, strike: 1.15, icon: "Ae", color: C.violet },
    { name: "Монтажёр", appear: 1.55, strike: 2.55, icon: "✂", color: C.cyan },
    { name: "Клик мышкой", appear: 2.85, strike: 4.7, icon: "", color: C.lime },
  ];
  const kick = rows.reduce((m, r) => {
    const d = t - r.strike;
    return d >= 0 && d < 0.5 ? Math.max(m, Math.exp(-d * 9)) : m;
  }, 0);
  const sx = (random(`sx${f}`) - 0.5) * 44 * kick;
  const sy = (random(`sy${f}`) - 0.5) * 44 * kick;
  const head = pop(f, 0, 9, 200);
  const cardStyle: React.CSSProperties = {
    width: 940,
    height: 200,
    borderRadius: 40,
    background: "rgba(255,255,255,.1)",
    display: "flex",
    alignItems: "center",
    gap: 40,
    padding: "0 48px",
    position: "relative",
  };
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        transform: `translate(${sx}px, ${sy}px) rotate(${(random(`rr${f}`) - 0.5) * kick * 1.5}deg)`,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 230,
          lineHeight: 1,
          color: C.red,
          transform: `scale(${0.3 + head * 0.7}) rotate(${(1 - head) * -14}deg)`,
          opacity: head,
          textShadow: `0 0 70px ${C.red}99`,
          marginBottom: 26,
        }}
      >
        БЕЗ
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
        {rows.map((r, idx) => {
          const p = pop(f, r.appear, 13, 160);
          const strikeW = interpolate(t, [r.strike, r.strike + 0.2], [0, 1], clamp);
          const bad = interpolate(t, [r.strike, r.strike + 0.2], [0, 1], clamp);
          const shatter = t - (r.strike + 0.35);
          if (shatter > 0) {
            const g = 5200;
            const ty = shatter * shatter * g * 0.5;
            const half = (dir: number) => ({
              ...cardStyle,
              position: "absolute" as const,
              left: 0,
              top: 0,
              border: `4px solid ${C.red}`,
              clipPath: dir < 0 ? "inset(0 0 50% 0)" : "inset(50% 0 0 0)",
              transform: `translate(${dir * shatter * 380}px, ${dir < 0 ? -shatter * 300 + ty * 0.35 : ty * 0.6}px) rotate(${dir * shatter * 95}deg)`,
              opacity: Math.max(0, 1 - shatter * 1.6),
            });
            return (
              <div key={r.name} style={{ width: 940, height: 200, position: "relative" }}>
                <div style={half(-1)}>
                  <RowBody r={r} strikeW={1} bad={1} />
                </div>
                <div style={half(1)}>
                  <RowBody r={r} strikeW={1} bad={1} />
                </div>
              </div>
            );
          }
          return (
            <div
              key={r.name}
              style={{
                ...cardStyle,
                border: `4px solid ${bad > 0.5 ? C.red : r.color}`,
                transform: `perspective(1200px) translateX(${(1 - p) * -1200}px) rotateY(${(1 - p) * 60}deg) rotate(${bad > 0 ? (random(r.name) - 0.5) * 4 * bad : 0}deg)`,
              }}
            >
              <RowBody r={r} strikeW={strikeW} bad={bad} />
              <Burst
                x={30 + 880}
                y={101}
                start={sf(r.strike) + 4}
                count={18}
                seed={`st${idx}`}
                speed={36}
                size={14}
                life={20}
                colors={[C.red, C.yellow, "#fff"]}
              />
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
  const loop = (f % 40) / 30;
  const xv = interpolate(Math.min(1, loop), [0, 1], [0, 1080], {
    easing: Easing.inOut(Easing.cubic),
  });
  const trackIn = pop(f, 0.9, 12, 160);
  const stripIn = pop(f, 1.2, 12, 160);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          marginTop: 170,
          width: 960,
          borderRadius: 34,
          background: "#0e0e18",
          border: "3px solid rgba(255,255,255,.18)",
          boxShadow: `0 30px 90px rgba(0,0,0,.6), 0 0 80px ${C.violet}44`,
          transform: `perspective(1400px) rotateX(${(1 - win) * 40}deg) scale(${0.8 + win * 0.2})`,
          opacity: win,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", gap: 14, padding: "20px 28px", background: "#181826" }}>
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
            padding: "24px 34px",
            fontFamily: MONO,
            fontSize: 36,
            lineHeight: 1.45,
            minHeight: 330,
            whiteSpace: "pre-wrap",
          }}
        >
          {highlight(CODE.slice(0, typed))}
          <span style={{ color: C.orange, opacity: Math.floor(f / 8) % 2 === 0 ? 1 : 0 }}>▌</span>
        </pre>
      </div>

      <div style={{ marginTop: 22, display: "flex", alignItems: "baseline", gap: 34 }}>
        <div style={{ fontFamily: MONO, fontSize: 38, letterSpacing: 8, color: "#9a9ab5" }}>КАДР</div>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 900,
            fontSize: 170,
            lineHeight: 1,
            color: "#fff",
            fontVariantNumeric: "tabular-nums",
            textShadow: `0 0 60px ${C.cyan}88`,
            transform: `scale(${1 + 0.04 * Math.exp(-(f % 15) / 3)})`,
          }}
        >
          {String(counter).padStart(4, "0")}
        </div>
      </div>

      {/* live preview: the box position IS the x from the code above */}
      <div
        style={{
          marginTop: 18,
          width: 960,
          height: 104,
          borderRadius: 24,
          border: "3px solid rgba(255,255,255,.2)",
          background: "rgba(255,255,255,.06)",
          position: "relative",
          opacity: trackIn,
          transform: `translateY(${(1 - trackIn) * 60}px)`,
        }}
      >
        {[4, 3, 2, 1, 0].map((g) => {
          const lag = Math.max(0, (loop - g * 0.03) as number);
          const gx = interpolate(Math.min(1, lag), [0, 1], [0, 1080], {
            easing: Easing.inOut(Easing.cubic),
          });
          return (
            <div
              key={g}
              style={{
                position: "absolute",
                top: 17,
                left: 20 + (gx / 1080) * (960 - 40 - 70),
                width: 70,
                height: 70,
                borderRadius: 18,
                background: g === 0 ? C.orange : C.orange,
                opacity: g === 0 ? 1 : 0.14 + (4 - g) * 0.05,
                boxShadow: g === 0 ? `0 0 40px ${C.orange}` : undefined,
              }}
            />
          );
        })}
        <div
          style={{
            position: "absolute",
            right: 26,
            top: 26,
            fontFamily: MONO,
            fontSize: 38,
            color: C.cyan,
          }}
        >
          x={Math.round(xv)}
        </div>
      </div>

      <div
        style={{
          marginTop: 18,
          width: 1000,
          height: 190,
          overflow: "hidden",
          borderRadius: 24,
          border: "3px solid rgba(255,255,255,.15)",
          position: "relative",
          background: "#000",
          opacity: stripIn,
          transform: `translateY(${(1 - stripIn) * 60}px)`,
        }}
      >
        <div style={{ position: "absolute", left: -(strip % TILE), top: 0, display: "flex" }}>
          {Array.from({ length: 7 }).map((_, k) => {
            const n = Math.floor(strip / TILE) + k;
            const hue = (n * 47) % 360;
            return (
              <div
                key={n}
                style={{
                  width: TILE - 10,
                  height: 190,
                  marginRight: 10,
                  background: `linear-gradient(160deg, hsl(${hue} 80% 55%), hsl(${(hue + 70) % 360} 80% 25%))`,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 30 + ((n * 37) % 90),
                    top: 30 + ((n * 53) % 70),
                    width: 60,
                    height: 60,
                    borderRadius: n % 2 ? 30 : 10,
                    background: "rgba(255,255,255,.85)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 12,
                    bottom: 8,
                    fontFamily: MONO,
                    fontSize: 26,
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
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 5: voice ─────────────────────────
const VoiceScene: React.FC<{ startFrame: number }> = ({ startFrame }) => {
  const f = useCurrentFrame();
  const abs = startFrame + f;
  const env = (n: number) => (envelope as number[])[Math.max(0, n)] ?? 0;
  const title = pop(f, 0, 12, 150);
  const now = env(abs);
  const hit = now > 0.6;
  const jx = hit ? (random(`vx${f}`) - 0.5) * 16 : 0;
  const bars = 64;
  const R = 120;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 190,
          color: "#fff",
          transform: `translateX(${jx}px) scale(${0.5 + title * 0.5 + now * 0.06})`,
          opacity: title,
          lineHeight: 1,
          textShadow: `${hit ? 8 : 0}px 0 ${C.red}, ${hit ? -8 : 0}px 0 ${C.cyan}, 0 0 60px ${C.orange}88`,
        }}
      >
        ЗВУК
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 42,
          color: C.orange,
          letterSpacing: 3,
          margin: "14px 0 30px",
          opacity: title,
        }}
      >
        МУЗЫКА · УДАРЫ · ПЕРЕХОДЫ
      </div>
      <div style={{ position: "relative", width: 640, height: 640, opacity: title }}>
        <div style={{ position: "absolute", inset: 0, transform: `rotate(${f * 1.5}deg)` }}>
          {Array.from({ length: bars }).map((_, i) => {
            const j = i < bars / 2 ? i : bars - 1 - i;
            const v = env(abs - j);
            const len = 14 + v * 190;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: 320 - 7,
                  top: 320,
                  width: 14,
                  height: len,
                  borderRadius: 7,
                  transformOrigin: "7px 0",
                  transform: `rotate(${(i / bars) * 360}deg) translateY(${R + now * 30}px)`,
                  background: `linear-gradient(180deg, ${C.cyan}, ${C.violet})`,
                  boxShadow: `0 0 18px ${C.cyan}66`,
                }}
              />
            );
          })}
        </div>
        <div
          style={{
            position: "absolute",
            left: 320 - (70 + now * 40),
            top: 320 - (70 + now * 40),
            width: 140 + now * 80,
            height: 140 + now * 80,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${C.orange}, ${C.red})`,
            boxShadow: `0 0 ${50 + now * 120}px ${C.orange}`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 6: four steps ─────────────────────────
const StepsScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const steps = [
    { n: "01", title: "Сценарий", file: "script.md", icon: "≡", at: 0.12, color: C.cyan },
    { n: "02", title: "Код", file: "Video.tsx", icon: "{ }", at: 1.2, color: C.violet },
    { n: "03", title: "Озвучка", file: "voice.wav", icon: "♪", at: 1.97, color: C.orange },
    { n: "04", title: "Рендер", file: "video.mp4", icon: "▶", at: 2.91, color: C.lime },
  ];
  const head = pop(f, 0, 12, 160);
  const pulse = t > 3.94 ? Math.exp(-(t - 3.94) * 6) : 0;
  const done = pop(f, 5.5, 10, 160);
  const fill = interpolate(t, [3.94, 5.5], [0, 1], clamp);
  const check = interpolate(t, [5.6, 6.0], [0, 1], clamp);
  return (
    <AbsoluteFill style={{ alignItems: "center" }}>
      <div
        style={{
          marginTop: 190,
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 130,
          color: "#fff",
          opacity: head,
          transform: `scale(${0.7 + head * 0.3 + pulse * 0.28}) rotate(${pulse * -4}deg)`,
          textShadow: pulse > 0.05 ? `0 0 60px ${C.orange}` : undefined,
        }}
      >
        4 ШАГА
      </div>
      <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 24 }}>
        {steps.map((s) => {
          const p = pop(f, s.at, 13, 170);
          const glow = Math.max(0, 1 - Math.abs(t - s.at - 0.25) * 3);
          return (
            <div
              key={s.n}
              style={{
                width: 940,
                height: 170,
                borderRadius: 36,
                background: `rgba(255,255,255,${0.08 + glow * 0.12})`,
                border: `4px solid ${s.color}`,
                display: "flex",
                alignItems: "center",
                gap: 34,
                padding: "0 40px",
                transform: `perspective(1200px) translateX(${(1 - p) * 1200}px) rotateY(${(1 - p) * -70}deg)`,
                boxShadow: `0 0 ${50 + glow * 60}px ${s.color}${glow > 0.3 ? "99" : "33"}`,
              }}
            >
              <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 72, color: s.color }}>{s.n}</div>
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 24,
                  background: `${s.color}33`,
                  border: `3px solid ${s.color}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: MONO,
                  fontWeight: 700,
                  fontSize: 46,
                  color: s.color,
                  transform: `rotate(${(1 - p) * 180}deg)`,
                }}
              >
                {s.icon}
              </div>
              <div style={{ flex: 1, fontFamily: SANS, fontWeight: 900, fontSize: 66, color: "#fff" }}>
                {s.title}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 32, color: "#9a9ab5" }}>{s.file}</div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 40,
          width: 940,
          height: 34,
          borderRadius: 17,
          background: "rgba(255,255,255,.12)",
          overflow: "hidden",
          position: "relative",
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
          marginTop: 24,
          display: "flex",
          alignItems: "center",
          gap: 22,
          fontFamily: MONO,
          fontSize: 46,
          fontWeight: 700,
          color: "#06130a",
          background: C.lime,
          padding: "10px 38px 10px 24px",
          borderRadius: 100,
          transform: `scale(${done})`,
          opacity: done,
          boxShadow: `0 0 60px ${C.lime}88`,
        }}
      >
        <svg width="64" height="64" viewBox="0 0 110 110">
          <path
            d="M20 58 L45 82 L92 26"
            fill="none"
            stroke="#06130a"
            strokeWidth="14"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="120"
            strokeDashoffset={(1 - check) * 120}
          />
        </svg>
        ГОТОВО · video.mp4
      </div>
      <Burst x={540} y={1330} start={sf(5.5)} count={40} seed="done" speed={80} size={18} life={30} colors={[C.lime, C.cyan, C.yellow, "#fff"]} />
    </AbsoluteFill>
  );
};

// ───────────────────────── scene 7: CTA ─────────────────────────
const Cursor: React.FC<{ scale: number }> = ({ scale }) => (
  <svg width="110" height="130" viewBox="0 0 22 26" style={{ transform: `scale(${scale})`, transformOrigin: "2px 2px" }}>
    <path
      d="M2 2 L2 21 L7 16.5 L10.5 24 L13.5 22.6 L10 15.3 L17 15 Z"
      fill="#fff"
      stroke="#000"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const CtaScene: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const q = pop(f, 0.1, 10, 150);
  const btnIn = pop(f, 1.0, 8, 150);
  const u = interpolate(t, [1.4, 2.2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const P0 = { x: 1010, y: 380 };
  const P1 = { x: 940, y: 1150 };
  const P2 = { x: 620, y: 1215 };
  const cx = (1 - u) ** 2 * P0.x + 2 * (1 - u) * u * P1.x + u ** 2 * P2.x;
  const cy = (1 - u) ** 2 * P0.y + 2 * (1 - u) * u * P1.y + u ** 2 * P2.y;
  const clickAt = 2.3;
  const clicked = t >= clickAt;
  const press = interpolate(t, [2.2, 2.3, 2.45], [1, 0.8, 1], clamp);
  const ripple = interpolate(t, [clickAt, clickAt + 0.6], [0, 1], outCubic);
  const after = pop(f, clickAt, 9, 180);
  const glow = 40 + Math.sin(f / 4) * 25;
  const chev = interpolate(t, [2.1, 2.4], [1, 0], clamp);
  return (
    <AbsoluteFill>
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
              opacity: 0.55,
              borderRadius: i % 3 === 0 ? size : 4,
              transform: `rotate(${f * (i % 5) * 3}deg)`,
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          top: 250,
          width: "100%",
          textAlign: "center",
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 150,
          lineHeight: 1.05,
          color: "#fff",
          transform: `scale(${0.4 + q * 0.6}) rotate(${(1 - q) * 8}deg)`,
          opacity: q,
          textShadow: `0 0 60px ${C.violet}`,
        }}
      >
        ХОЧЕШЬ
        <br />
        ТАК ЖЕ?
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 0,
            width: "100%",
            top: 700 + i * 90 + Math.sin(f / 4 - i) * 18,
            textAlign: "center",
            fontSize: 110,
            fontFamily: MONO,
            color: C.orange,
            opacity: chev * btnIn * (0.35 + 0.65 * ((Math.sin(f / 4 - i) + 1) / 2)),
          }}
        >
          ▼
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 1090,
          width: 800,
          height: 190,
          borderRadius: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: clicked ? 70 : 84,
          color: clicked ? "#06130a" : "#fff",
          background: clicked
            ? C.lime
            : `linear-gradient(90deg, ${C.red}, ${C.orange})`,
          boxShadow: `0 0 ${clicked ? 90 : glow}px ${clicked ? C.lime : C.orange}`,
          transform: `scale(${btnIn * (clicked ? 0.92 + after * 0.08 : 1 + Math.sin(f / 5) * 0.025)})`,
          opacity: btnIn,
        }}
      >
        {clicked ? "✓ ТЫ ПОДПИСАН" : "ПОДПИСАТЬСЯ"}
      </div>
      {clicked && (
        <div
          style={{
            position: "absolute",
            left: 620 - 150,
            top: 1215 - 150,
            width: 300,
            height: 300,
            borderRadius: "50%",
            border: `10px solid ${C.lime}`,
            opacity: 1 - ripple,
            transform: `scale(${0.1 + ripple * 3})`,
          }}
        />
      )}
      <Burst x={620} y={1215} start={sf(clickAt)} count={50} seed="sub" speed={95} size={20} life={34} colors={[C.lime, C.cyan, C.yellow, C.orange, "#fff"]} />
      <div style={{ position: "absolute", left: cx, top: cy, opacity: btnIn }}>
        <Cursor scale={press} />
      </div>
      <div
        style={{
          position: "absolute",
          top: 1330,
          width: "100%",
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 36,
          color: "#9a9ab5",
          opacity: interpolate(t, [2.9, 3.3], [0, 1], clamp),
        }}
      >
        единственный клик в этом видео
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────── main ─────────────────────────
export const Main: React.FC = () => {
  const f = useCurrentFrame();
  const beat = 1 + 0.02 * Math.exp(-(f % 15) / 3.2); // music is 120 bpm = a kick every 15 frames
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {/* The voice-over is added separately: drop public/voice.wav and uncomment the line below,
          or lay it over out/video.mp4 with ffmpeg (see README). */}
      <Audio src={staticFile("music.wav")} volume={0.5} />
      <AbsoluteFill style={{ transform: `scale(${beat})` }}>
        <Background />
        <Scene range={SCENES.hook}>
          <Hook />
        </Scene>
        <Scene range={SCENES.title} type="flash">
          <TitleScene />
        </Scene>
        <Scene range={SCENES.without} type="wipe">
          <WithoutScene />
        </Scene>
        <Scene range={SCENES.code} type="blinds">
          <CodeScene />
        </Scene>
        <Scene range={SCENES.voice} type="circle">
          <VoiceScene startFrame={sf(SCENES.voice[0])} />
        </Scene>
        <Scene range={SCENES.steps} type="zoom">
          <StepsScene />
        </Scene>
        <Scene range={SCENES.cta} type="wipe" last>
          <CtaScene />
        </Scene>
      </AbsoluteFill>
      <HUD />
      <Captions />
    </AbsoluteFill>
  );
};
