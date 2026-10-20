import * as THREE from "three";
import { getLocalPose } from "./pose.js";
import { isPlaced } from "./ar.js";
import { renderer } from "./scene.js";

const UPDATE_MS = 100; // ~10 Hz keeps the numbers readable

let panel = null;
let visible = new URLSearchParams(location.search).has("debug");
let lastUpdate = 0;

const quat = new THREE.Quaternion();
const forward = new THREE.Vector3();

function setVisible(on) {
  visible = on;
  panel.hidden = !on;
}

export function initDebug() {
  const hud = document.getElementById("hud");

  panel = document.createElement("pre");
  panel.className = "debug-panel";
  panel.hidden = !visible;
  hud.appendChild(panel);

  // Phone toggle. Taps on it must not also fire an XR select.
  // TODO(#19): remove or hide this button (e.g. only with ?debug) before the demo.
  const button = document.createElement("button");
  button.className = "chip debug-toggle";
  button.textContent = "Dbg";
  button.addEventListener("beforexrselect", (e) => e.preventDefault());
  button.addEventListener("click", () => setVisible(!visible));
  hud.appendChild(button);

  // Desktop toggle
  window.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "d" || e.key === "D") setVisible(!visible);
  });
}

export function updateDebug() {
  if (!visible) return;
  const now = performance.now();
  if (now - lastUpdate < UPDATE_MS) return;
  lastUpdate = now;

  // "opaque" blend means the browser is not passing the camera feed through
  const session = renderer.xr.getSession();
  const xrLine = session
    ? `\nblend ${session.environmentBlendMode}  overlay ${session.domOverlayState?.type ?? "none"}`
    : "";

  const pose = getLocalPose();
  if (!pose) {
    panel.textContent = (isPlaced() ? "local pose: tracking lost" : "local pose: not placed") + xrLine;
    return;
  }
  const { p, q } = pose;
  forward.set(0, 0, -1).applyQuaternion(quat.fromArray(q));
  const yaw = THREE.MathUtils.radToDeg(Math.atan2(-forward.x, -forward.z));
  const pitch = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)));
  const dist = Math.hypot(...p) * 100;
  const f = (n) => n.toFixed(3).padStart(7);
  panel.textContent =
    `p    ${p.map(f).join(" ")}\n` +
    `q    ${q.map(f).join(" ")}\n` +
    `dist ${dist.toFixed(1)} cm\n` +
    `yaw  ${yaw.toFixed(0)}°  pitch ${pitch.toFixed(0)}°` + xrLine;
}
