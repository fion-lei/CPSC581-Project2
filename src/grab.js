import * as THREE from "three";
import { renderer, camera } from "./scene.js";
import { modelRoot, modelPivot } from "./model.js";
import { getMode, onModeChange } from "./expert-tools.js";
import { showToast, hideToast } from "./hud.js";

const SEND_MS = 50;       // ~20 grab messages a second while rotating
const SMOOTHING = 0.3;    // novice: ease toward the latest pose per frame
const RAD_PER_PX = 0.008; // desktop: drag distance to rotation
const CENTRE = new THREE.Vector3(0, 0.07, 0); // part's visual centre, modelPivot space

const round = (n) => Math.round(n * 1e4) / 1e4;

// Grab mode: rotate the part, nothing else. It always turns about its own centre.
// WebXR: hold anywhere on the screen and turn the phone; the part turns by the same amount.
// Desktop: drag with the left mouse button.
// Only modelPivot's rotation changes; pins (its children) turn with it.
// send = net.js send; controls = the desktop OrbitControls.
export function initGrab({ send, controls }) {
  const canvas = renderer.domElement;

  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const rootQuat = new THREE.Quaternion();
  const startCam = new THREE.Quaternion();  // AR: phone's orientation at the press
  const startQuat = new THREE.Quaternion(); // AR: part's orientation at the press
  const axis = new THREE.Vector3();
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const lastPointer = new THREE.Vector2();

  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();

  let ready = false;   // expert, part placed, tracking (from main.js each frame)
  let hit = null;      // centre-ray hit on the part (from main.js each frame)
  let holding = null;  // pointerId (desktop) or XRInputSource (AR)
  let moved = false;   // expert: the part has been rotated since the last reset
  let remote = false;  // novice: a grab pose has arrived
  let hintShown = false;
  let lastSent = 0;

  const canGrab = () => ready && getMode() === "grab";

  // Reset button: only while Grab is the active expert mode
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "btn grab-reset";
  resetButton.innerHTML =
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
     <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
     <path d="M3 3v5h5"/>
   </svg>`;
resetButton.setAttribute("aria-label", "Reset part");
resetButton.title = "Reset part";
  resetButton.hidden = true;
  resetButton.addEventListener("beforexrselect", (e) => e.preventDefault());
  resetButton.addEventListener("click", () => {
    cancel();
    modelPivot.position.set(0, 0, 0);
    modelPivot.quaternion.identity();
    moved = false;
    sendPivot(); // the novice eases back too
  });
  document.getElementById("hud").appendChild(resetButton);

  function sendPivot() {
    send({
      t: "grab",
      p: modelPivot.position.toArray().map(round),
      q: modelPivot.quaternion.toArray().map(round),
    });
  }

  // Set the part's orientation, shifting its position just enough that its centre
  // stays where it was (so it spins in place rather than swinging about its base)
  function setRotation(q) {
    before.copy(CENTRE).applyQuaternion(modelPivot.quaternion);
    modelPivot.quaternion.copy(q);
    after.copy(CENTRE).applyQuaternion(modelPivot.quaternion);
    modelPivot.position.add(before).sub(after);
    moved = true;
  }

  // A world-space turn, re-expressed in modelRoot space
  function toLocalTurn(worldTurn) {
    modelRoot.getWorldQuaternion(rootQuat);
    return worldTurn.premultiply(qb.copy(rootQuat).invert()).multiply(rootQuat);
  }

  function startHold(source) {
    if (!canGrab() || holding !== null) return false;
    if (!hit) {
      showToast("Aim at the part", "Put the crosshair on it, then hold", 2000);
      return false;
    }
    holding = source;
    hideToast();
    if (renderer.xr.isPresenting) {
      renderer.xr.getCamera().getWorldQuaternion(startCam);
      startQuat.copy(modelPivot.quaternion);
    }
    return true;
  }

  function endHold(source) {
    if (holding === null || holding !== source) return;
    holding = null;
    sendPivot(); // final resting pose
  }
  const cancel = () => endHold(holding);

  // WebXR: hold anywhere on the screen. HUD controls stop their own touches with
  // beforexrselect, so tapping a mode button never grabs.
  renderer.xr.addEventListener("sessionstart", () => {
    const session = renderer.xr.getSession();
    session.addEventListener("selectstart", (e) => startHold(e.inputSource));
    session.addEventListener("selectend", (e) => endHold(e.inputSource));
  });
  renderer.xr.addEventListener("sessionend", () => {
    cancel();
    modelPivot.position.set(0, 0, 0);
    modelPivot.quaternion.identity();
    moved = remote = false;
  });

  // Desktop: the orbit controls are off in Grab mode, so a drag only turns the part
  canvas.addEventListener("pointerdown", (e) => {
    if (renderer.xr.isPresenting || e.button !== 0 || !startHold(e.pointerId)) return;
    lastPointer.set(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== holding) return;
    // Horizontal drag turns about the camera's up axis, vertical about its right axis
    camera.updateMatrixWorld();
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer.set(e.clientX, e.clientY);
    qa.setFromAxisAngle(axis.set(0, 1, 0).applyQuaternion(camera.quaternion), dx * RAD_PER_PX);
    qb.setFromAxisAngle(axis.set(1, 0, 0).applyQuaternion(camera.quaternion), dy * RAD_PER_PX);
    qa.multiply(qb);
    setRotation(toLocalTurn(qa).multiply(modelPivot.quaternion));
  });
  canvas.addEventListener("pointerup", (e) => endHold(e.pointerId));
  canvas.addEventListener("pointercancel", (e) => endHold(e.pointerId));

  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });

  onModeChange((mode) => {
    cancel();
    // The orbit camera must not turn the view while Grab turns the part
    if (controls) controls.enableRotate = controls.enablePan = mode !== "grab";
    if (mode === "grab") {
      showToast("Grab",
        renderer.xr.isPresenting
          ? "Aim at the part, hold the screen, then turn your phone"
          : "Aim at the part, then drag to rotate it",
        4000);
      hintShown = true;
    } else if (hintShown) {
      hideToast();
      hintShown = false;
    }
  });

  // Novice: latest part pose from the expert
  function receive({ p, q }) {
    if (!Array.isArray(p) || !Array.isArray(q)) return;
    targetPos.fromArray(p);
    targetQuat.fromArray(q);
    remote = true;
  }

  // Expert: send the current part pose again, e.g. when the novice (re)joins
  function resend() {
    if (moved) sendPivot();
  }

  // Once per frame. cam = the camera rendering this frame; aimReady and aimHit come
  // from the centre ray in main.js.
  function update(cam, aimReady, aimHit) {
    ready = aimReady;
    hit = aimHit;
    resetButton.hidden = !canGrab();
    if (holding !== null && !canGrab()) cancel();

    if (holding !== null) {
      if (renderer.xr.isPresenting) {
        // The phone's turn since the press, applied to the part's orientation at the press
        cam.getWorldQuaternion(qa);
        qa.multiply(qb.copy(startCam).invert());
        setRotation(toLocalTurn(qa).multiply(startQuat));
      }
      const now = performance.now();
      if (now - lastSent >= SEND_MS) {
        lastSent = now;
        sendPivot();
      }
    } else if (remote) {
      modelPivot.position.lerp(targetPos, SMOOTHING);
      modelPivot.quaternion.slerp(targetQuat, SMOOTHING);
    }
  }

  return { update, receive, resend };
}