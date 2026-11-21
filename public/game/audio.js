// Retro sound effects synthesized with WebAudio (no audio files).
// Browsers only allow audio after a click/key press on this page.

let ctx = null;
let master = null;
let muted = false;
let noiseBuf = null;
const VOLUME = 0.35;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

export const isReady = () => !!ctx && ctx.state === 'running';

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : VOLUME;
  return muted;
}

function tone({ type = 'square', f0, f1 = f0, dur, vol = 0.2, delay = 0 }) {
  if (!isReady()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur, vol = 0.3, f = 2000, f1 = f, delay = 0 }) {
  if (!isReady()) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.setValueAtTime(f, t);
  if (f1 !== f) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(flt).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur);
}

const melody = (notes, step, type = 'square', vol = 0.12) =>
  notes.forEach((f, i) => f && tone({ type, f0: f, dur: step * 0.95, vol, delay: i * step }));

let lastHit = 0;

export const sfx = {
  shoot: () => tone({ f0: 1500, f1: 280, dur: 0.08, vol: 0.07 }),
  hit: () => {
    if (!isReady() || ctx.currentTime - lastHit < 0.05) return;
    lastHit = ctx.currentTime;
    noise({ dur: 0.08, vol: 0.18, f: 4000, f1: 600 });
  },
  boom: () => {
    noise({ dur: 0.3, vol: 0.3, f: 2200, f1: 120 });
    tone({ type: 'triangle', f0: 260, f1: 40, dur: 0.25, vol: 0.15 });
  },
  bigBoom: () => {
    for (let i = 0; i < 4; i++) noise({ dur: 0.6, vol: 0.4, f: 1800, f1: 60, delay: i * 0.18 });
    tone({ type: 'sawtooth', f0: 180, f1: 25, dur: 1.4, vol: 0.25 });
  },
  die: () => {
    noise({ dur: 1.0, vol: 0.45, f: 3000, f1: 80 });
    tone({ type: 'sawtooth', f0: 600, f1: 40, dur: 1.0, vol: 0.2 });
  },
  dive: () => tone({ type: 'square', f0: 1100, f1: 260, dur: 0.45, vol: 0.04 }),
  power: () => melody([523, 659, 784, 1047, 1319], 0.06, 'square', 0.12),
  extra: () => melody([784, 988, 1175, 1568, 0, 1568], 0.08, 'square', 0.12),
  bomb: () => {
    noise({ dur: 1.3, vol: 0.55, f: 900, f1: 40 });
    tone({ type: 'sawtooth', f0: 140, f1: 25, dur: 1.2, vol: 0.3 });
  },
  alarm: () => {
    for (let i = 0; i < 6; i++) tone({ type: 'sawtooth', f0: i % 2 ? 660 : 880, dur: 0.2, vol: 0.08, delay: i * 0.22 });
  },
  stage: () => melody([523, 659, 784, 1047, 784, 1047], 0.09),
  start: () => melody([392, 523, 659, 784, 0, 659, 784, 1047, 0, 1047, 1175, 1319], 0.11),
  gameover: () => melody([523, 0, 415, 0, 349, 0, 262], 0.16, 'triangle', 0.2),
  join: () => melody([660, 990], 0.07),
  tick: () => tone({ f0: 880, dur: 0.04, vol: 0.06 }),
  laser: () => tone({ type: 'sawtooth', f0: 1900, f1: 900, dur: 0.07, vol: 0.035 }),
  missile: () => noise({ dur: 0.15, vol: 0.08, f: 5000, f1: 1500 }),
  slow: () => tone({ type: 'triangle', f0: 900, f1: 90, dur: 0.9, vol: 0.2 }),
  split: () => tone({ type: 'square', f0: 300, f1: 900, dur: 0.12, vol: 0.08 }),
  tractor: () => {
    for (let i = 0; i < 10; i++) tone({ type: 'sine', f0: i % 2 ? 300 : 460, f1: i % 2 ? 460 : 300, dur: 0.2, vol: 0.09, delay: i * 0.2 });
  },
  captured: () => melody([784, 659, 523, 392, 330], 0.12, 'triangle', 0.18),
  rescue: () => melody([523, 659, 784, 1047, 1319, 1568], 0.08),
  roll: () => noise({ dur: 0.25, vol: 0.14, f: 6000, f1: 700 }),
  combo: (m) => tone({ f0: 500 + m * 180, dur: 0.12, vol: 0.1 }),
};
