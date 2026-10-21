import { getLocalPose } from "./pose.js";
import { isPlaced, isTracking } from "./ar.js";
import { send, getRole } from "./net.js";
import { modelRoot } from "./model.js";
import { createGhost } from "./ghost.js";


let button = null;
let hud = null;

let savedGhost = null;
let savedPose = null;
let viewToggle = null;

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

// Call every frame: only the expert sees it, and only once the part is placed
export function updateViewpoint() {
    const role = getRole();
    button.hidden = !(role === "expert" && isPlaced());
    viewToggle.hidden = !(role === "novice" && savedGhost);
}

// Expert: the latest pose, so it can be resent when the novice (re)connects
export function getSavedPose() { return savedPose; }