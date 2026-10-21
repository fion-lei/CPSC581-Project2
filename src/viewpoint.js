import { getLocalPose } from "./pose.js";
import { isPlaced, isTracking } from "./ar.js";
import { send, getRole } from "./net.js";
import { modelRoot } from "./model.js";
import { createGhost } from "./ghost.js";
import * as THREE from "three";
import { renderer, camera } from "./scene.js";

const ARRIVE_M = 0.05;        // closer than 8 cm counts as "at the view"
const AHEAD_RATIO = 0.17;     // within ~10° of screen centre counts as "straight ahead"

let arrow = null;
let arrowIcon = null;
let arrowText = null;
const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const target = new THREE.Vector3();
const offset = new THREE.Vector3();

let button = null;
let hud = null;

let savedGhost = null;
let savedPose = null;
let viewToggle = null;

let reached = false;

// Flash the screen and show a toast notification when the expert saves a view
function flash() {
  const f = document.createElement("div");
  f.className = "view-flash";
  f.setAttribute("aria-hidden", "true");
  hud.appendChild(f);
  requestAnimationFrame(() => { f.style.opacity = "0"; });
  setTimeout(() => f.remove(), 350);
}

// Show a toast notification for a few seconds
function notification(text) {
  const t = document.createElement("div");
  t.className = "toast view-toast";
  t.textContent = text;
  t.setAttribute("role", "status");
  hud.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

//  Expert: send the current pose to the novice, and show a flash and toast
function saveViewpoint() {
  const pose = getLocalPose();
  if (!pose) {
    notification("Unable to save viewpoint: pose not available");
    return;
  }
  window.savedViewpoint = pose;
  savedPose = pose;
  send({ t: "viewpoint", p: pose.p, q: pose.q });
  flash();
  notification("View sent to Novice");
}

// Novice: show/hide the saved ghost
export function toggleViewpoint() {
  if (!savedGhost) return;
  savedGhost.object.visible = !savedGhost.object.visible;
  viewToggle.textContent = savedGhost.object.visible ? "Hide view" : "Show view";
}

// Called once at startup to create the button and add it to the HUD
export function initViewpoint() {
  hud = document.getElementById("hud");
  button = document.createElement("button");
  button.id = "ViewButton";
  button.className = "btn view-button";
  button.textContent = "Save view";
  button.hidden = true;
  button.addEventListener("beforexrselect", (e) => e.preventDefault());
  button.addEventListener("click", saveViewpoint);
  hud.appendChild(button);

  viewToggle = document.createElement("button");
  viewToggle.className = "btn view-button";
  viewToggle.textContent = "hide view";
  viewToggle.hidden = true;
  viewToggle.addEventListener("beforexrselect", (e) => e.preventDefault());
  viewToggle.addEventListener("click", () => {;
    savedGhost.object.visible = !savedGhost.object.visible;
    viewToggle.textContent = savedGhost.object.visible ? "Hide view" : "Show view";
  });
  hud.appendChild(viewToggle);

    arrow = document.createElement("div");
  arrow.className = "view-arrow";
  arrow.hidden = true;
  arrow.innerHTML =
    `<svg class="view-arrow-icon" viewBox="0 0 48 48" width="56" height="56">
       <path d="M24 4 L40 40 L24 32 L8 40 Z" fill="#fff" stroke="#16191D"
             stroke-width="2" stroke-linejoin="round"/>
     </svg>
     <div class="toast view-arrow-text"></div>`;
  hud.appendChild(arrow);
  arrowIcon = arrow.querySelector(".view-arrow-icon");
  arrowText = arrow.querySelector(".view-arrow-text");
}

// Novice: a frozen ghost. update() is never called on it, so it doesn't time out.
export function receiveViewpoint({ p, q }) {
  savedPose = { p, q };
  reached = false;
  if (!savedGhost) {
    savedGhost = createGhost("expert");
    savedGhost.object.traverse((o) => o.material?.color.set(0xffffff)); // white = saved view
    modelRoot.add(savedGhost.object);
  }
  savedGhost.object.position.fromArray(p);
  savedGhost.object.quaternion.fromArray(q);
  savedGhost.object.visible = true;
  if (viewToggle) viewToggle.textContent = "Hide view";
  notification("Expert saved a new view");
} 

// Call every frame: only the expert sees it, and only once the part is placed
export function updateViewpoint() {
    const role = getRole();
    button.hidden = !(role === "expert" && isPlaced());
    viewToggle.hidden = !(role === "novice" && savedGhost);
    updateGuide();
}

function pingsound(volume = 0.05) {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  
  // Strike tone (High & sharp)
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(987.77, ctx.currentTime); // B5 note

  // Resonance tone (Slightly detuned/lower to create depth)
  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(493.88, ctx.currentTime); // B4 note

  gain.gain.setValueAtTime(volume, ctx.currentTime);
  // Long fade out time (0.8 seconds) so it rings out
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);

  osc1.connect(gain);
  osc2.connect(gain);
  gain.connect(ctx.destination);

  osc1.start();
  osc2.start();
  osc1.stop(ctx.currentTime + 0.8);
  osc2.stop(ctx.currentTime + 0.8);
}

function updateGuide() {
  const show = getRole() === "novice" && savedPose && savedGhost?.object.visible
    && (!renderer.xr.isPresenting || isTracking());
  arrow.hidden = !show;
  if (!show) return;

  // Saved position in world space, then relative to the novice's camera
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(camPos);
  cam.getWorldQuaternion(camQuat);
  target.fromArray(savedPose.p);
  modelRoot.localToWorld(target);
  offset.copy(target).sub(camPos);
  const dist = offset.length();
  offset.applyQuaternion(camQuat.invert()); // x right, y up, -z forward

  const arrived = dist < ARRIVE_M;
    if (arrived && !reached) {
    reached = true;
    savedGhost.object.visible = false;
    viewToggle.textContent = "Show view";
    arrow.hidden = true;
    pingsound();
    notification("Reached Experts Saved View");
    reached = false;
    return;
  }
  const ahead = offset.z < 0 && Math.hypot(offset.x, offset.y) < AHEAD_RATIO * dist;
  arrowIcon.style.visibility = arrived || ahead ? "hidden" : "visible";
  arrowIcon.style.transform = `rotate(${Math.atan2(offset.x, offset.y)}rad)`;
  arrowText.textContent = ahead
    ? `Straight ahead · ${Math.round(dist * 100)} cm`
    : `${Math.round(dist * 100)} cm`;
}

// Expert: the latest pose, so it can be resent when the novice (re)connects
export function getSavedPose() { return savedPose; }