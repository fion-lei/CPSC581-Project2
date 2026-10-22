import * as THREE from "three";
import { renderer, camera } from "./scene.js";
import { modelRoot, modelPivot } from "./model.js";
import { createPartRaycast, getMode, onModeChange } from "./expert-tools.js";
import { showToast, hideToast, showPill } from "./hud.js";
import { getRole, onStatus } from "./net.js";
import { RESET_ICON, setIconButton } from "./icons.js";
import { createPhoneHold, validPose } from "./spatial.js";
import { play } from "./audio.js";

const SEND_MS = 50;
const SMOOTHING = 0.3;
const RAD_PER_PX = 0.008;
const REMOTE_IDLE_MS = 400;
const CENTRE = new THREE.Vector3(0, 0.07, 0);
const round = (n) => Math.round(n * 1e4) / 1e4;

export function initGrab({ send, controls }) {
  const canvas = renderer.domElement;
  const hud = document.getElementById("hud");
  const { raycaster, intersect } = createPartRaycast(modelRoot, modelPivot);
  const phoneHold = createPhoneHold(modelRoot, modelPivot);
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const rootQuat = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const before = new THREE.Vector3();
  const after = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const lastPointer = new THREE.Vector2();
  const rayMatrix = new THREE.Matrix4();
  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  const identity = new THREE.Quaternion();
  let ready = false;
  let holding = null;
  let remote = false;
  let session = null;
  let lastSent = 0;
  let lastRemoteAt = 0;
  let orbitBeforeHold = null;

  const canGrab = () => ready && getMode() === "grab"
    && !hud.querySelector(".expert-toolbar")?.hidden;

  const resetButton = document.createElement("button");
  resetButton.className = "btn tool-side-action grab-reset";
  setIconButton(resetButton, RESET_ICON, "Reset part");
  resetButton.hidden = true;
  resetButton.addEventListener("beforexrselect", (e) => e.preventDefault());
  resetButton.addEventListener("keydown", (e) => e.stopPropagation());
  resetButton.addEventListener("click", () => {
    cancel();
    modelPivot.position.set(0, 0, 0);
    modelPivot.quaternion.identity();
    sendPivot();
    showPill("Part reset");
  });
  hud.appendChild(resetButton);

  function sendPivot() {
    send({ t: "grab", p: modelPivot.position.toArray().map(round),
      q: modelPivot.quaternion.toArray().map(round) });
  }

  function startHold(source) {
    if (!canGrab() || holding !== null) return false;
    if (!intersect()) {
      showToast("Press on the part", "Hold it, then move or turn your phone", 2000);
      return false;
    }
    holding = source;
    hideToast();
    play("grab", { quiet: true });
    if (renderer.xr.isPresenting) phoneHold.capture(renderer.xr.getCamera());
    else {
      orbitBeforeHold = controls.enabled;
      controls.enabled = false;
    }
    return true;
  }

  function endHold(source) {
    if (holding === null || holding !== source) return;
    const id = holding;
    holding = null;
    if (typeof id === "number" && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (orbitBeforeHold !== null) {
      controls.enabled = !renderer.xr.isPresenting && orbitBeforeHold;
      orbitBeforeHold = null;
    }
    play("release", { quiet: true });
    sendPivot();
  }
  const cancel = () => endHold(holding);

  function xrStart(e) {
    if (!canGrab() || holding !== null) return;
    const pose = e.frame.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());
    if (!pose) {
      showToast("Tracking unavailable", "Move your phone slowly and try again", 2000);
      return;
    }
    rayMatrix.fromArray(pose.transform.matrix);
    raycaster.ray.origin.setFromMatrixPosition(rayMatrix);
    raycaster.ray.direction.set(0, 0, -1).transformDirection(rayMatrix);
    startHold(e.inputSource);
  }
  function xrEnd(e) { endHold(e.inputSource); }
  function sourcesChanged(e) { if (Array.from(e.removed).includes(holding)) cancel(); }
  function detachSession() {
    if (!session) return;
    session.removeEventListener("selectstart", xrStart);
    session.removeEventListener("selectend", xrEnd);
    session.removeEventListener("inputsourceschange", sourcesChanged);
    session = null;
  }
  renderer.xr.addEventListener("sessionstart", () => {
    cancel();
    detachSession();
    session = renderer.xr.getSession();
    session.addEventListener("selectstart", xrStart);
    session.addEventListener("selectend", xrEnd);
    session.addEventListener("inputsourceschange", sourcesChanged);
  });
  renderer.xr.addEventListener("sessionend", () => { cancel(); detachSession(); });

  canvas.addEventListener("pointerdown", (e) => {
    if (renderer.xr.isPresenting || e.button !== 0 || !canGrab()
      || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1,
      -(e.clientY - rect.top) / rect.height * 2 + 1);
    camera.updateWorldMatrix(true, false);
    raycaster.setFromCamera(pointer, camera);
    if (!startHold(e.pointerId)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    lastPointer.set(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  }, true);
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId !== holding) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    camera.getWorldQuaternion(qa);
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    lastPointer.set(e.clientX, e.clientY);
    axis.set(0, 1, 0).applyQuaternion(qa);
    qb.setFromAxisAngle(axis, dx * RAD_PER_PX);
    axis.set(1, 0, 0).applyQuaternion(qa);
    qa.setFromAxisAngle(axis, dy * RAD_PER_PX);
    qb.multiply(qa);
    modelRoot.getWorldQuaternion(rootQuat);
    qa.copy(rootQuat).invert().multiply(qb).multiply(rootQuat).multiply(modelPivot.quaternion);
    before.copy(CENTRE).applyQuaternion(modelPivot.quaternion);
    after.copy(CENTRE).applyQuaternion(qa);
    modelPivot.position.add(before).sub(after);
    modelPivot.quaternion.copy(qa);
  }, true);
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerId !== holding) return;
      e.stopImmediatePropagation();
      endHold(e.pointerId);
    }, true);
  }
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  onStatus((status) => { if (status !== "connected") cancel(); });
  onModeChange(cancel);

  function receive(msg) {
    if (!validPose(msg)) {
      console.warn("Ignoring invalid grab pose", msg);
      return;
    }
    const now = performance.now();
    if (getRole() === "novice" && now - lastRemoteAt > REMOTE_IDLE_MS) play("grab");
    lastRemoteAt = now;
    targetPos.fromArray(msg.p);
    targetQuat.fromArray(msg.q).normalize();
    remote = true;
  }

  function update(cam, aimReady) {
    ready = aimReady;
    resetButton.hidden = !canGrab();
    resetButton.disabled = holding === null && modelPivot.position.lengthSq() < 1e-10
      && modelPivot.quaternion.angleTo(identity) < 1e-5;
    if (holding !== null && !canGrab()) cancel();
    if (holding !== null) {
      if (renderer.xr.isPresenting) phoneHold.update(cam);
      const now = performance.now();
      if (now - lastSent >= SEND_MS) { lastSent = now; sendPivot(); }
    } else if (remote && getRole() === "novice") {
      if (performance.now() - lastRemoteAt > REMOTE_IDLE_MS) {
        remote = false;
        play("release");
      } else {
        modelPivot.position.lerp(targetPos, SMOOTHING);
        modelPivot.quaternion.slerp(targetQuat, SMOOTHING);
      }
    }
  }

  // Always replay, including identity after an offline reset.
  return { update, receive, resend: sendPivot };
}
