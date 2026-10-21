// Sound effects for events 
// Web audio synths used for actions 
const STORE_KEY = "ghostlens.mute";
const QUIET = 0.35;
const MIN_INTERVAL_MS = 100;
const MASTER = 0.35;

// Update with more sounds as they are added 
const SOUNDS = {
  grab: { freqs: [180, 140], dur: 0.08, type: "triangle", fall: true },
  release: { freqs: [140, 200], dur: 0.1, type: "triangle", fall: false },
  pin: { freqs: [660], dur: 0.06, type: "sine", fall: false },
  stroke: { freqs: [420, 380], dur: 0.04, type: "sawtooth", fall: true },
  view: { freqs: [440, 554], dur: 0.12, type: "sine", fall: false },
  aligned: { freqs: [392, 523, 659], dur: 0.18, type: "sine", fall: false },
  gotIt: { freqs: [784, 988], dur: 0.1, type: "sine", fall: false },
};

let ctx = null;
let master = null;
let muted = loadMuted();
const lastPlayed = new Map();
const muteHandlers = [];

function loadMuted() {
  try { return localStorage.getItem(STORE_KEY) === "1"; } catch { return false; }
}

function saveMuted(on) {
  try { localStorage.setItem(STORE_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.AudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER;
  master.connect(ctx.destination);
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
}

export function isMuted() { return muted; }

export function onMuteChange(fn) { muteHandlers.push(fn); }

export function setMuted(on) {
  muted = !!on;
  saveMuted(muted);
  const c = ensure();
  if (c && master) {
    const t = c.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(muted ? 0 : MASTER, t + 0.04);
  }
  muteHandlers.forEach((fn) => fn(muted));
}

// Play sound effect 
// TODO: add more sounds as they are updated  
export function play(name, { quiet = false } = {}) {
  const spec = SOUNDS[name];
  if (!spec || muted) return;
  const c = ensure();
  if (!c || c.state !== "running") return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? 0) < MIN_INTERVAL_MS) return;
  lastPlayed.set(name, now);

  const t0 = c.currentTime;
  const step = spec.dur / Math.max(1, spec.freqs.length);
  const voice = c.createGain();
  const peak = quiet ? QUIET : 1;
  voice.gain.setValueAtTime(0, t0);
  voice.gain.linearRampToValueAtTime(peak, t0 + 0.008);
  voice.gain.setValueAtTime(peak, t0 + spec.dur - 0.02);
  voice.gain.linearRampToValueAtTime(0, t0 + spec.dur);
  voice.connect(master);

  spec.freqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = spec.type;
    const start = t0 + i * step * 0.55;
    const f0 = spec.fall ? freq : freq;
    const f1 = spec.fall ? freq * 0.85 : freq * 1.05;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.linearRampToValueAtTime(f1, start + step);
    osc.connect(voice);
    osc.start(start);
    osc.stop(t0 + spec.dur + 0.02);
  });
}

document.addEventListener("pointerdown", () => unlock(), { once: true, capture: true });
