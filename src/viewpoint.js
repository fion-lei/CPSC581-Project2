import * as THREE from "three";
import { getLocalPose } from "./pose.js";
import { isPlaced, isTracking } from "./ar.js";
import { send, getRole } from "./net.js";
import { modelRoot } from "./model.js";
import { createGhost } from "./ghost.js";
import { renderer, camera } from "./scene.js";

const ARRIVE_M = 0.05;  // closer than 5 cm counts as "at the view"
const AXIS_COS = 0.9;   // within ~25° of straight ahead or straight behind

let hud = null;
let button = null;      // expert: Save view
let viewToggle = null;  // novice: Show / Hide view

let arrow = null;       // novice guide: icon + label, top centre
let turnIcon = null;    // arrow that rotates toward the target
let stepIcon = null;    // double chevron: move forward / move back
let arrowText = null;

let savedGhost = null;
let savedPose = null;

const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const target = new THREE.Vector3();
const offset = new THREE.Vector3();

// Flash the screen corners when the expert saves a view
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

// Expert: send the current pose to the novice, and show a flash and toast
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

// Called once at startup to create the buttons and the guide and add them to the HUD
export function initViewpoint() {
  hud = document.getElementById("hud");

  button = document.createElement("button");
  button.id = "ViewButton";
  button.className = "btn view-button";
  button.innerHTML =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
     <circle cx="12" cy="13" r="3"/>
   </svg>`;
button.setAttribute("aria-label", "Save view");
button.title = "Save view";
button.classList.add("view-icon");
  button.hidden = true;
  button.addEventListener("beforexrselect", (e) => e.preventDefault());
  button.addEventListener("click", saveViewpoint);
  hud.appendChild(button);

  viewToggle = document.createElement("button");
  viewToggle.className = "btn view-button";
  viewToggle.innerHTML =
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
     <circle cx="12" cy="13" r="3"/>
   </svg>`;
  viewToggle.setAttribute("aria-label", "Toggle view");
  viewToggle.title = "Toggle view";
  viewToggle.hidden = true;
  viewToggle.addEventListener("beforexrselect", (e) => e.preventDefault());
  viewToggle.addEventListener("click", toggleViewpoint);
  hud.appendChild(viewToggle);

  // Compact guide, top centre under the status chips, so the part stays visible.
  // Styled inline: it doesn't depend on any rule in style.css.
  arrow = document.createElement("div");
  arrow.hidden = true;
  arrow.style.cssText =
    "position:absolute;left:50%;transform:translateX(-50%);" +
    "top:var(--below-chips, 72px);" +
    "display:flex;flex-direction:column;align-items:center;gap:6px;" +
    "width:max-content;pointer-events:none";

  const ICON = "display:block;width:44px;height:44px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))";
  const CHEVRONS = "M10 22 L24 8 L38 22 M10 38 L24 24 L38 38";
  arrow.innerHTML =
    `<svg data-part="turn" viewBox="0 0 48 48" style="${ICON}">
       <path d="M24 4 L40 40 L24 32 L8 40 Z" fill="#fff" stroke="#16191D"
             stroke-width="2" stroke-linejoin="round"/>
     </svg>
     <svg data-part="step" viewBox="0 0 48 48" style="${ICON};display:none">
       <path d="${CHEVRONS}" fill="none" stroke="#16191D" stroke-width="8"
             stroke-linecap="round" stroke-linejoin="round"/>
       <path d="${CHEVRONS}" fill="none" stroke="#fff" stroke-width="4.5"
             stroke-linecap="round" stroke-linejoin="round"/>
     </svg>
     <div data-part="label" style="padding:6px 12px;border-radius:999px;
          background:var(--hud);color:var(--hud-text);white-space:nowrap;
          font:500 12px/1 var(--font-mono);letter-spacing:.06em;text-transform:uppercase"></div>`;
  hud.appendChild(arrow);
  turnIcon = arrow.querySelector('[data-part="turn"]');
  stepIcon = arrow.querySelector('[data-part="step"]');
  arrowText = arrow.querySelector('[data-part="label"]');
}

// Novice: a frozen ghost. update() is never called on it, so it doesn't time out.
export function receiveViewpoint({ p, q }) {
  savedPose = { p, q };
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

// Call every frame: the expert sees Save view once the part is placed; the novice
// gets the toggle and the guide once a view has arrived
export function updateViewpoint() {
  const role = getRole();
  button.hidden = !(role === "expert" && isPlaced());
  viewToggle.hidden = !(role === "novice" && savedGhost);
  updateGuide();
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

  // Arrived: hide the ghost and the guide, and say so
  if (dist < ARRIVE_M) {
    savedGhost.object.visible = false;
    viewToggle.textContent = "Show view";
    arrow.hidden = true;
    notification("Reached Experts Saved View");
    return;
  }

  const cm = Math.round(dist * 100);
  const along = -offset.z / dist;               // 1 = dead ahead, -1 = dead behind
  const onAxis = Math.abs(along) > AXIS_COS;

  turnIcon.style.display = onAxis ? "none" : "block";
  stepIcon.style.display = onAxis ? "block" : "none";
  if (onAxis) {
    // Double chevron: up = move forward, flipped = move back
    stepIcon.style.transform = along > 0 ? "" : "rotate(180deg)";
    arrowText.textContent = `${along > 0 ? "Move forward" : "Move back"} · ${cm} cm`;
  } else {
    turnIcon.style.transform = `rotate(${Math.atan2(offset.x, offset.y)}rad)`;
    turnIcon.style.opacity = along < 0 ? "0.6" : "1"; // dimmer when it's behind you
    arrowText.textContent = along < 0 ? `Behind you · ${cm} cm` : `${cm} cm`;
  }
}

// Expert: the latest pose, so it can be resent when the novice (re)connects
export function getSavedPose() { return savedPose; }