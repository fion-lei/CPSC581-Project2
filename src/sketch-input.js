import * as THREE from "three";
import { createSketchSampler, MAX_STROKES } from "./sketch.js";

// Own only Draw input. View/Grab/Pin remain available to their implementations.
export function initSketchInput({ sketch, renderer, camera, modelRoot, modelPivot,
  controls, getRole, getMode, onModeChange, isPlaced, isTracking }) {
  const canvas = renderer.domElement;
  const hud = document.getElementById("hud");
  const toolbar = hud.querySelector(".expert-toolbar");
  const sampler = createSketchSampler(modelRoot, modelPivot);
  const pointer = new THREE.Vector2();
  let pointerId = null;
  let xrSource = null;
  let session = null;
  let orbitBeforeHold = null;
  let uiVisible = false;
  const actions = document.createElement("div");
  actions.className = "sketch-actions";
  actions.hidden = true;
  const hint = document.createElement("span");
  const clear = document.createElement("button");
  clear.className = "btn sketch-clear";
  clear.type = "button";
  clear.textContent = "Clear";
  clear.setAttribute("aria-label", "Clear all sketches for both people");
  actions.append(hint, clear);
  toolbar.appendChild(actions);

  function ready() {
    return getRole() === "expert" && getMode() === "draw" && !toolbar.hidden
      && isPlaced() && (!renderer.xr.isPresenting || isTracking());
  }
  function render() {
    const state = sketch.getState();
    clear.disabled = state.count === 0;
    hint.textContent = state.limited
      ? (state.count >= MAX_STROKES ? "Sketch full — clear to continue" : "Stroke full — release to continue")
      : state.drawing ? "Drawing…"
        : renderer.xr.isPresenting ? "Hold the screen and move your phone" : "Drag on the part to draw";
  }
  function updateUI() {
    const visible = ready();
    if (visible !== uiVisible) {
      uiVisible = visible;
      actions.hidden = !visible;
      hud.classList.toggle("has-sketch-tools", visible);
      render();
    }
  }
  function release() {
    const id = pointerId;
    pointerId = null;
    xrSource = null;
    sketch.end();
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    if (orbitBeforeHold !== null) {
      controls.enabled = !renderer.xr.isPresenting && orbitBeforeHold;
      orbitBeforeHold = null;
    }
  }
  function sample() {
    if (!ready()) { release(); return; }
    if (sketch.getState().limited) return;
    const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
    const point = sampler.sample(cam, renderer.xr.isPresenting ? null : pointer);
    if (!point) { sketch.end(); return; } // A mouse leaving the part breaks the stroke.
    if (!sketch.getState().drawing) sketch.begin();
    sketch.addWorldPoint(point);
  }
  function setPointer(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1,
      -(e.clientY - rect.top) / rect.height * 2 + 1);
  }
  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }
  function down(e) {
    if (renderer.xr.isPresenting || !ready() || e.button !== 0) return;
    stop(e);
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    orbitBeforeHold = controls.enabled;
    controls.enabled = false;
    canvas.setPointerCapture(pointerId);
    setPointer(e);
    sketch.begin();
    sample();
  }
  function move(e) {
    if (e.pointerId !== pointerId) return;
    stop(e);
    setPointer(e);
    sample();
  }
  function up(e) {
    if (e.pointerId !== pointerId) return;
    stop(e);
    if (e.type === "pointerup") { setPointer(e); sample(); }
    release();
  }
  function lost(e) { if (e.pointerId === pointerId) release(); }
  function xrStart(e) {
    if (!ready() || xrSource) return;
    xrSource = e.inputSource;
    sketch.begin();
    sample();
  }
  function xrEnd(e) { if (xrSource === e.inputSource) release(); }
  function sourcesChanged(e) { if (Array.from(e.removed).includes(xrSource)) release(); }
  function detachSession() {
    if (!session) return;
    session.removeEventListener("selectstart", xrStart);
    session.removeEventListener("selectend", xrEnd);
    session.removeEventListener("inputsourceschange", sourcesChanged);
    session = null;
  }
  function sessionStart() {
    release();
    detachSession();
    session = renderer.xr.getSession();
    session.addEventListener("selectstart", xrStart);
    session.addEventListener("selectend", xrEnd);
    session.addEventListener("inputsourceschange", sourcesChanged);
    render();
  }
  function sessionEnd() { release(); detachSession(); render(); }
  function visibility() { if (document.hidden) release(); }
  // DOM controls must not simultaneously begin an XR stroke, including Clear.
  function beforeXRSelect(e) {
    if (e.target instanceof Element && e.target.closest("button, input, select, a, .start-screen")) e.preventDefault();
  }
  function clearAll() { release(); sketch.clear(); }
  clear.addEventListener("click", clearAll);
  canvas.addEventListener("pointerdown", down, true);
  canvas.addEventListener("pointermove", move, true);
  canvas.addEventListener("pointerup", up, true);
  canvas.addEventListener("pointercancel", up, true);
  canvas.addEventListener("lostpointercapture", lost);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  hud.addEventListener("beforexrselect", beforeXRSelect);
  renderer.xr.addEventListener("sessionstart", sessionStart);
  renderer.xr.addEventListener("sessionend", sessionEnd);
  const unsubscribeMode = onModeChange(() => { release(); updateUI(); });
  const unsubscribeSketch = sketch.onChange(render);

  return {
    update(time) {
      updateUI();
      if (pointerId !== null || xrSource) sample();
      sketch.update(time);
      // Keep annotations out of the translucent placement preview.
      sketch.group.visible = isPlaced() && (!renderer.xr.isPresenting || isTracking());
    },
    cancel: release,
    dispose() {
      release(); detachSession(); unsubscribeMode(); unsubscribeSketch();
      clear.removeEventListener("click", clearAll);
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("pointermove", move, true);
      canvas.removeEventListener("pointerup", up, true);
      canvas.removeEventListener("pointercancel", up, true);
      canvas.removeEventListener("lostpointercapture", lost);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      hud.removeEventListener("beforexrselect", beforeXRSelect);
      renderer.xr.removeEventListener("sessionstart", sessionStart);
      renderer.xr.removeEventListener("sessionend", sessionEnd);
      actions.remove(); hud.classList.remove("has-sketch-tools");
    },
  };
}
