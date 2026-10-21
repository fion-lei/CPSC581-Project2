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
  let holding = null;  // AR: the XRInputSource doing the grab
  let dragging = null; // desktop: the pointerId doing the drag
  let moved = false;   // expert: the part has been rotated at least once
  let remote = false;  // novice: a grab pose has arrived
  let lastSent = 0;

  const canGrab = () => ready && getMode() === "grab";

  let hintShown = false;

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

  // WebXR: start a grab when the user presses the screen, end it when they release.

  function startHold(source) {
    if (!canGrab() || holding !== null) return;
    renderer.xr.getCamera().getWorldQuaternion(startCam);
    startQuat.copy(modelPivot.quaternion);
    holding = source;
  }

  function endHold(source) {
    if (holding === null || holding !== source) return;
    holding = null;
    sendPivot();
  }

  // Developer mode: drag with the left mouse button to turn the part. The drag is interpreted
  // as a turn about the camera's up and right axes, so the part turns in the same direction
  // as the pointer. The part's centre stays where it was.

  canvas.addEventListener("pointerdown", (e) => {
    if (renderer.xr.isPresenting || e.button !== 0 || !canGrab() || dragging !== null) return;
    dragging = e.pointerId;
    lastPointer.set(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== dragging) return;
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
  const endDrag = (e) => {
    if (e.pointerId !== dragging) return;
    dragging = null;
    sendPivot();
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  // Shared by AR and desktop: the part's orientation is left where it was, but the grab ends.
  // Cancel any grab in progress, e.g. when the user switches modes or the session ends.
  function cancel() {
    endHold(holding);
    if (dragging !== null) {
      dragging = null;
      sendPivot();
    }
  }

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
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });

  onModeChange((mode) => {
    cancel();
    // The orbit camera must not turn the view while Grab turns the part
    if (controls) controls.enableRotate = controls.enablePan = mode !== "grab";
    if (mode === "grab") {
      showToast("Grab",
      renderer.xr.isPresenting
        ? "Grab mode: turn the part by turning the phone"
        : "Grab mode: turn the part by dragging with the mouse",
        0);
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

  // Once per frame. cam = the camera rendering this frame; aimReady from main.js.
  function update(cam, aimReady) {
    ready = aimReady;
    if ((holding !== null || dragging !== null) && !canGrab()) cancel();

    if (holding !== null) {
      // The phone's turn since the press, applied to the part's orientation at the press
      cam.getWorldQuaternion(qa);
      qa.multiply(qb.copy(startCam).invert());
      setRotation(toLocalTurn(qa).multiply(startQuat));
    }

    if (holding !== null || dragging !== null) {
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