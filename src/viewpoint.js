import * as THREE from "three";
import { getLocalPose } from "./pose.js";
import { isPlaced, isTracking } from "./ar.js";
import { send, getRole, getStatus } from "./net.js";
import { modelRoot } from "./model.js";
import { createSavedView } from "./ghost.js";
import { renderer, camera } from "./scene.js";
import { getMode } from "./expert-tools.js";
import { layoutBottom, showPill } from "./hud.js";
import { ARROW_ICON, CAMERA_ICON, STEP_ICON, VIBRATE_ICON, setIconButton } from "./icons.js";
import { alignmentState, validPose, viewpointAlignment } from "./spatial.js";

const AXIS_COS = 0.9;
const NEAR = 0.05;
const FAR = 0.5; // past this, the arrow shows even with the view on screen
const BUZZ = [60, 40, 60];
const target = new THREE.Vector3();
const offset = new THREE.Vector3();
const projected = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const desiredDirection = new THREE.Vector3();
let hud;
let saveButton;
let viewToggle;
let direction;
let arrowIcon;
let stepIcon;
let directionText;
let guide;
let progress;
let progressText;
let sceneLabel;
let brackets;
let savedGhost;
let savedPose = null;
let visible = false;
let aligned = false;
let reportedId = null; // the expert hears about each saved view once
let onScreen = false;
let sequence = 0;

function ready() {
  return isPlaced() && (!renderer.xr.isPresenting || isTracking())
    && !hud.querySelector(".start-screen");
}

function flash() {
  const corners = document.createElement("div");
  corners.className = "view-flash";
  corners.setAttribute("aria-hidden", "true");
  corners.innerHTML = "<span></span><span></span><span></span><span></span>";
  hud.appendChild(corners);
  corners.addEventListener("animationend", () => corners.remove(), { once: true });
  setTimeout(() => corners.remove(), 500);
}

function saveViewpoint() {
  const pose = getLocalPose();
  if (!ready() || !pose) {
    showPill("Place the part and wait for tracking");
    return;
  }
  savedPose = { id: `${Date.now().toString(36)}-${++sequence}`, ...pose };
  resendViewpoint();
  flash();
  showPill(getStatus() === "connected" ? "View sent to novice" : "View saved for when novice connects");
}

function updateToggle() {
  setIconButton(viewToggle, CAMERA_ICON, visible ? "Hide saved view" : "Show saved view");
  viewToggle.setAttribute("aria-pressed", String(visible));
  viewToggle.classList.toggle("is-active", visible);
}

export function toggleViewpoint() {
  visible = !visible;
  updateToggle();
}

function action(className, icon, label, handler) {
  const button = document.createElement("button");
  button.className = `btn ${className}`;
  setIconButton(button, icon, label);
  button.hidden = true;
  button.addEventListener("beforexrselect", (e) => e.preventDefault());
  button.addEventListener("keydown", (e) => e.stopPropagation());
  button.addEventListener("click", handler);
  hud.appendChild(button);
  return button;
}

export function initViewpoint() {
  hud = document.getElementById("hud");
  saveButton = action("tool-side-action view-save", CAMERA_ICON, "Save view", saveViewpoint);
  viewToggle = action("tool-side-action view-toggle", CAMERA_ICON, "Show saved view", toggleViewpoint);
  updateToggle();
  direction = document.createElement("div");
  direction.className = "view-direction";
  direction.hidden = true;
  direction.innerHTML = `<span class="view-direction-icon" aria-hidden="true">${ARROW_ICON}</span>
    <span class="view-step-icon" aria-hidden="true">${STEP_ICON}</span>
    <span class="chip view-direction-text"></span>`;
  arrowIcon = direction.querySelector(".view-direction-icon");
  stepIcon = direction.querySelector(".view-step-icon");
  directionText = direction.querySelector(".view-direction-text");

  guide = document.createElement("div");
  guide.className = "toast view-guidance";
  guide.hidden = true;
  guide.innerHTML = `<div class="view-progress">
      <div class="view-aligned-head">
        <div class="toast-title">You're seeing the expert's view</div>${VIBRATE_ICON}
      </div>
      <div class="progress-label"></div>
      <div class="progress-track" role="progressbar" aria-label="View alignment"
        aria-valuemin="0" aria-valuemax="100"><div class="progress-fill"></div></div>
      <div class="view-aligned-caption">Aligned · 100%</div>
    </div>`;
  progress = guide.querySelector(".progress-track");
  progressText = guide.querySelector(".progress-label");

  sceneLabel = document.createElement("div");
  sceneLabel.className = "pin-label view-scene-label";
  sceneLabel.innerHTML = `${CAMERA_ICON}<span>Expert's view · step here</span>`;
  sceneLabel.hidden = true;
  brackets = document.createElement("div");
  brackets.className = "view-aligned";
  brackets.setAttribute("aria-hidden", "true");
  brackets.innerHTML = "<span></span><span></span><span></span><span></span>";
  brackets.hidden = true;
  hud.append(brackets, direction, guide, sceneLabel);
  new ResizeObserver(layoutBottom).observe(guide);
}

export function receiveViewpoint(msg) {
  if (!validPose(msg) || typeof msg.id !== "string" || !msg.id) {
    console.warn("Ignoring invalid saved view", msg);
    return;
  }
  if (savedPose?.id === msg.id) return;
  savedPose = { id: msg.id, p: [...msg.p], q: [...msg.q] };
  setAligned(false);
  visible = true;
  if (!savedGhost) {
    savedGhost = createSavedView();
    modelRoot.add(savedGhost.object);
  }
  savedGhost.object.position.fromArray(msg.p);
  savedGhost.object.quaternion.fromArray(msg.q).normalize();
  updateToggle();
  showPill("Expert saved a new view");
}

function buzz() {
  try {
    navigator.vibrate?.(BUZZ);
  } catch {
    // No vibration here (iPhone, desktop): skip silently.
  }
}

function setAligned(on) {
  aligned = on;
  guide.classList.toggle("is-aligned", on);
  brackets.hidden = !on;
}

function setGuideVisible(show) {
  // Keep `aligned` while hidden (e.g. a tracking blip): on return the hysteresis
  // decides, so a brief loss doesn't re-buzz.
  brackets.hidden = !(show && aligned);
  if (guide.hidden !== !show) {
    guide.hidden = !show;
    layoutBottom();
  }
  direction.hidden = !show;
  sceneLabel.hidden = !show;
}

export function updateViewpoint(time) {
  const novice = getRole() === "novice";
  const available = ready();
  saveButton.hidden = !(getRole() === "expert" && available && getMode() === "view"
    && !hud.querySelector(".expert-toolbar")?.hidden);
  viewToggle.hidden = !(novice && available && savedPose);
  viewToggle.classList.toggle("beside-drawer", hud.classList.contains("has-pin-drawer"));
  const show = !!(novice && available && savedPose && visible);
  if (savedGhost) {
    savedGhost.object.visible = show;
    savedGhost.update(time);
  }
  setGuideVisible(show);
  if (!show || document.hidden) return;

  const pose = getLocalPose();
  const alignment = viewpointAlignment(pose, savedPose);
  const nowAligned = alignmentState(aligned, alignment);
  if (nowAligned !== aligned) {
    setAligned(nowAligned);
    if (nowAligned) {
      buzz();
      if (reportedId !== savedPose.id) {
        reportedId = savedPose.id;
        send({ t: "aligned", id: savedPose.id });
      }
    }
  }
  // Aligned: the brackets replace the ghost camera and its label, so only one frame shows.
  savedGhost.object.visible = !aligned;
  const score = aligned ? 100 : alignment.score;
  progressText.textContent = `Getting closer · ${score}%`;
  progress.setAttribute("aria-valuenow", String(score));
  progress.querySelector(".progress-fill").style.width = `${score}%`;
  direction.hidden = aligned;
  if (aligned) {
    sceneLabel.hidden = true;
    return;
  }
  updateLabel();
  updateDirection(pose, alignment);
}

// Only runs while not aligned; the brackets and panel take over once aligned.
function updateDirection(pose, { distance }) {
  offset.fromArray(savedPose.p).sub(target.fromArray(pose.p));
  rotation.fromArray(pose.q).invert();
  offset.applyQuaternion(rotation);
  const along = distance > 0 ? -offset.z / distance : 0;
  const near = distance <= NEAR;
  const onAxis = Math.abs(along) > AXIS_COS;
  // The ghost camera itself shows the way when it's on screen and close.
  arrowIcon.hidden = near || onAxis || (onScreen && distance <= FAR);
  stepIcon.hidden = near || !onAxis;
  if (near) {
    desiredDirection.set(0, 0, -1)
      .applyQuaternion(new THREE.Quaternion().fromArray(savedPose.q))
      .applyQuaternion(rotation);
    const yaw = Math.atan2(desiredDirection.x, -desiredDirection.z);
    const pitch = Math.atan2(desiredDirection.y, Math.hypot(desiredDirection.x, desiredDirection.z));
    const horizontal = Math.abs(yaw) >= Math.abs(pitch);
    const turn = horizontal ? (yaw > 0 ? 90 : -90) : (pitch > 0 ? 0 : 180);
    stepIcon.hidden = false;
    stepIcon.style.transform = `rotate(${turn}deg)`;
    directionText.textContent = horizontal
      ? `Turn ${yaw > 0 ? "right" : "left"} to match`
      : `Tilt ${pitch > 0 ? "up" : "down"} to match`;
  } else {
    const cm = Math.round(distance * 100);
    arrowIcon.style.transform = `rotate(${Math.atan2(offset.x, offset.y)}rad)`;
    stepIcon.style.transform = along > 0 ? "" : "rotate(180deg)";
    directionText.textContent = onAxis
      ? `${along > 0 ? "Move forward" : "Move back"} · ${cm} cm`
      : `${along < 0 ? "Behind you" : "Move toward camera"} · ${cm} cm`;
  }
}

function updateLabel() {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  savedGhost.object.getWorldPosition(projected);
  projected.project(cam);
  onScreen = projected.z >= -1 && projected.z <= 1
    && [projected.x, projected.y, projected.z].every(Number.isFinite)
    && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1;
  sceneLabel.hidden = !onScreen;
  if (!onScreen) return;
  sceneLabel.style.left = `${(projected.x + 1) * window.innerWidth / 2}px`;
  sceneLabel.style.top = `${(1 - projected.y) * window.innerHeight / 2}px`;
}

export function resendViewpoint() {
  if (getRole() === "expert" && savedPose) send({ t: "viewpoint", ...savedPose });
}

export function receiveAlignment({ id }) {
  if (savedPose?.id === id) showPill("Novice reached your view", null, 2000, "novice");
}
