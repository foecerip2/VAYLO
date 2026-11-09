"""Generates the music bed + SFX (public/music.wav) and the voice envelope (src/envelope.json).

Everything is synthesized from scratch with numpy: no samples, no downloads.
"""
import json
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i : i + len(sig)] += sig * gain


def kick(dur=0.32):
    t = np.arange(int(SR * dur)) / SR
    freq = 45 + 110 * np.exp(-t * 28)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    return np.sin(phase) * np.exp(-t * 9)


def hat(dur=0.05):
    t = np.arange(int(SR * dur)) / SR
    noise = rng.standard_normal(len(t))
    noise = np.diff(noise, prepend=0)  # crude high-pass
    return noise * np.exp(-t * 90)


def thunk(dur=0.25):
    t = np.arange(int(SR * dur)) / SR
    return (np.sin(2 * np.pi * 85 * t) * np.exp(-t * 18)
            + 0.5 * rng.standard_normal(len(t)) * np.exp(-t * 120))


def whoosh(dur=0.5):
    n = int(SR * dur)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    a = 0.0
    prev = 0.0
    for k in range(n):  # one-pole low-pass with rising cutoff
        a = 0.02 + 0.9 * (k / n) ** 2
        prev += a * (noise[k] - prev)
        out[k] = prev
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.5
    return out * env * 3.0


def pluck(freq, dur=0.3):
    t = np.arange(int(SR * dur)) / SR
    s = np.sin(2 * np.pi * freq * t) + 0.4 * np.sin(2 * np.pi * freq * 2 * t)
    return s * np.exp(-t * 11)


def pad(freq, dur):
    t = np.arange(int(SR * dur)) / SR
    s = (np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 2.003 * t)
         + 0.25 * np.sin(2 * np.pi * freq * 3.01 * t))
    env = np.minimum(1, t / 0.4) * np.minimum(1, (dur - t) / 0.4)
    return s * env


music = np.zeros(N)
BEAT = 0.5  # 120 bpm
HOOK_END = 2.9
SCENES = [2.9, 5.5, 9.65, 16.1, 19.5, 24.9]
STRIKES = [6.15, 7.65, 9.05]

# drums
t = 0.0
while t < DUR - 0.3:
    add(music, t, kick(), 0.55 if t < HOOK_END else 0.4)
    if t >= HOOK_END:
        add(music, t + BEAT / 2, hat(), 0.12)
    t += BEAT
# bass pad: Am - F - C - G
chords = [55.0, 43.65, 65.41, 49.0]
for k, f in enumerate(chords * 4):
    add(music, k * 2.0, pad(f, 2.0), 0.22)
# arpeggio from the code scene on
penta = [220.0, 261.63, 329.63, 392.0, 440.0, 392.0, 329.63, 261.63]
t, k = 9.65, 0
while t < DUR - 0.3:
    add(music, t, pluck(penta[k % len(penta)]), 0.12)
    t += BEAT / 2
    k += 1
# transitions + strikes
add(music, 0.0, whoosh(0.35)[::-1], 0.0)
for s in SCENES:
    add(music, s - 0.45, whoosh(0.45), 0.28)
    add(music, s, kick(0.5), 0.5)
for s in STRIKES:
    add(music, s, thunk(), 0.6)
# hook impact
add(music, 0.0, kick(0.9) * 1.2, 0.8)

music /= max(1e-9, np.abs(music).max())
music *= 0.9
pcm = (music * 32767).astype(np.int16)
with wave.open(str(ROOT / "public" / "music.wav"), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

# voice envelope, one value per video frame (30 fps)
with wave.open(str(ROOT / "public" / "voice.wav"), "rb") as w:
    vsr = w.getframerate()
    v = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float)
spf = vsr // 30
frames = len(v) // spf
env = np.array([np.sqrt(np.mean(v[i * spf : (i + 1) * spf] ** 2)) for i in range(frames)])
env = env / env.max()
env = np.concatenate([env, np.zeros(900 - len(env))])[:900]
(ROOT / "src" / "envelope.json").write_text(json.dumps([round(float(x), 3) for x in env]))
print("music.wav + envelope.json written")
