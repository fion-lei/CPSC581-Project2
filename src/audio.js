// Sound effects for events 
// Web audio synths used for actions 
const STORE_KEY = "ghostlens.mute";
const QUIET = 0.55;
const MIN_INTERVAL_MS = 100;
const MASTER = 0.55;

// Update with more sounds as they are added
const SOUNDS = {
  grab: { freqs: [330, 392], dur: 0.09, type: "triangle", fall: false },
  release: { freqs: [392, 294], dur: 0.12, type: "triangle", fall: true },
  pin: { freqs: [659, 880], dur: 0.1, type: "sine", fall: false },
  stroke: { freqs: [440, 392], dur: 0.05, type: "triangle", fall: true },
  view: { freqs: [440, 587], dur: 0.14, type: "sine", fall: false },
  aligned: { freqs: [523, 659, 784], dur: 0.3, type: "sine", fall: false },
  gotIt: { freqs: [784, 1047], dur: 0.14, type: "sine", fall: false },
  mute: { freqs: [523, 330], dur: 0.12, type: "sine", fall: true },
};

let ctx = null;
let master = null;
let muted = loadMuted();
const lastPlayed = new Map();
const muteHandlers = new Set();

function loadMuted() {
  try { return localStorage.getItem(STORE_KEY) === "1"; } catch { return false; }
}

function saveMuted(on) {
  try { localStorage.setItem(STORE_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER;
  master.connect(ctx.destination);
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (!c) return Promise.resolve();
  if (c.state !== "running") return c.resume().catch(() => {});
  return Promise.resolve();
}

export function isMuted() { return muted; }

export function onMuteChange(fn) {
  muteHandlers.add(fn);
  return () => muteHandlers.delete(fn);
}

export function setMuted(on) {
  const was = muted;
  muted = !!on;
  saveMuted(muted);
  if (ctx && master) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    if (muted && !was) {
      play("mute", { force: true });
      const hold = t + SOUNDS.mute.dur * 2;
      master.gain.setValueAtTime(MASTER, t);
      master.gain.setValueAtTime(MASTER, hold);
      master.gain.linearRampToValueAtTime(0, hold + 0.04);
    } else if (!muted) {
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(MASTER, t + 0.04);
    }
  }
  muteHandlers.forEach((fn) => fn(muted));
}

export function play(name, { quiet = false, force = false } = {}) {
  const spec = SOUNDS[name];
  if (!spec || (muted && !force)) return;
  const c = ensure();
  if (!c) return;
  if (c.state !== "running") {
    c.resume().then(() => play(name, { quiet, force })).catch(() => {});
    return;
  }

  const nowMs = performance.now();
  if (nowMs - (lastPlayed.get(name) ?? -Infinity) < MIN_INTERVAL_MS) return;
  lastPlayed.set(name, nowMs);

  const t0 = c.currentTime;
  const step = spec.dur / Math.max(1, spec.freqs.length);
  const len = step * 1.6;
  const peak = quiet ? QUIET : 1;
  const bend = spec.fall ? 0.97 : 1.02;

  spec.freqs.forEach((freq, i) => {
    const s = t0 + i * step;
    const e = s + len;
    const osc = c.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(freq, s);
    osc.frequency.exponentialRampToValueAtTime(freq * bend, e);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(peak, s + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, e);
    osc.connect(g);
    g.connect(master);
    osc.start(s);
    osc.stop(e + 0.02);
  });
}

const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchstart", "touchend", "click", "keydown"];
function onGesture() {
  unlock().then(() => {
    if (ctx?.state === "running") {
      UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, onGesture, true));
    }
  });
}
UNLOCK_EVENTS.forEach((ev) => document.addEventListener(ev, onGesture, true));

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && ctx) unlock();
});
