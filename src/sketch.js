import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { lineMaterial } from "./ghost.js";
import { icon } from "./pin-drawer.js";
import { tokenColor } from "./tokens.js";

export const MIN_POINT_DISTANCE = 0.005;
export const AIR_DISTANCE = 0.15;
export const MAX_STROKES = 64;
export const MAX_POINTS = 1024;
export const BATCH_SIZE = 32;
const SURFACE_WIDTH = 0.003;
const LINE_WIDTH = 4;
const UNDERSTROKE_WIDTH = 6;
export const SURFACE_OFFSET = SURFACE_WIDTH * 0.55;
const validId = (id) => typeof id === "string" && id.length > 0 && id.length <= 80;
const validPoint = (p) => Array.isArray(p) && p.length === 3
  && p.every((n) => Number.isFinite(n) && Math.abs(n) <= 100);

// Both AR and desktop rays intersect part meshes only, never ghosts or sketches.
export function createSketchSampler(modelRoot, modelPivot) {
  const ray = new THREE.Raycaster();
  const meshes = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  return {
    sample(camera, pointer = null) {
      if (!modelRoot.visible || !modelPivot.visible) return null;
      modelRoot.updateWorldMatrix(true, true);
      camera.updateWorldMatrix(true, false);
      if (pointer) ray.setFromCamera(pointer, camera);
      else {
        camera.getWorldPosition(ray.ray.origin);
        camera.getWorldDirection(ray.ray.direction);
      }
      ray.near = camera.near;
      ray.far = camera.far;
      meshes.length = 0;
      modelPivot.traverseVisible((o) => { if (o.isMesh) meshes.push(o); });
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) {
        // Lift by half the line width to avoid flickering where it touches a face.
        normalMatrix.getNormalMatrix(hit.object.matrixWorld);
        normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix);
        return point.copy(hit.point).addScaledVector(normal, SURFACE_OFFSET);
      }
      // Mouse drawing is surface-only. AR can also draw 15 cm in front of the phone.
      return pointer ? null : ray.ray.at(AIR_DISTANCE, point);
    },
  };
}

// Expert owns the document. Points on the wire and geometry are modelRoot-local.
// Each stroke uses one fixed GPU buffer; appending never rebuilds old geometry.
export function createSketch({ modelRoot, send, getRole, makeId = () => crypto.randomUUID() }) {
  const group = new THREE.Group();
  group.name = "sketches";
  modelRoot.add(group);
  const color = tokenColor("--expert");
  const underMaterial = lineMaterial(tokenColor("--label-bg"), {
    linewidth: UNDERSTROKE_WIDTH, transparent: true, opacity: 0.45,
  });
  const material = lineMaterial(color, { linewidth: LINE_WIDTH, transparent: true });
  const dotMaterial = new THREE.MeshBasicMaterial({ color });
  const dotGeometry = new THREE.SphereGeometry(SURFACE_WIDTH / 2, 8, 6);
  const strokes = new Map();
  const listeners = new Set();
  const local = new THREE.Vector3();
  const previousWorld = new THREE.Vector3();
  let epoch = makeId();
  let remoteEpoch = null;
  let active = null;
  let drawing = false;
  let limited = false;
  let lastFlush = 0;

  function state() { return { count: strokes.size, drawing, limited }; }
  function notify() { for (const fn of listeners) fn(state()); }
  function create(id) {
    if (strokes.size >= MAX_STROKES) return null;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(new Float32Array((MAX_POINTS - 1) * 6));
    geometry.instanceCount = 0;
    geometry.attributes.instanceStart.data.setUsage(THREE.DynamicDrawUsage);
    const underLine = new LineSegments2(geometry, underMaterial);
    underLine.frustumCulled = false;
    underLine.renderOrder = 0;
    underLine.visible = false;
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false; // Bounds would otherwise contain unused buffer entries.
    line.renderOrder = 1;
    line.visible = false;
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    const object = new THREE.Group();
    object.name = id;
    object.add(underLine, line, dot);
    group.add(object);
    const stroke = { id, points: [], sent: 0, object, line, underLine, dot };
    strokes.set(id, stroke);
    return stroke;
  }
  function append(stroke, points) {
    const buffer = stroke.line.geometry.attributes.instanceStart.data;
    const start = Math.max(0, stroke.points.length - 1) * 6;
    for (const p of points) {
      const last = stroke.points.at(-1);
      if (last) buffer.array.set([...last, ...p], (stroke.points.length - 1) * 6);
      stroke.points.push([...p]);
    }
    const segments = stroke.points.length - 1;
    stroke.line.geometry.instanceCount = segments;
    stroke.underLine.geometry.instanceCount = segments;
    stroke.line.visible = segments > 0;
    stroke.underLine.visible = segments > 0;
    stroke.dot.position.fromArray(stroke.points[0]);
    stroke.dot.visible = segments === 0;
    if (segments > 0) {
      buffer.addUpdateRange(start, segments * 6 - start);
      buffer.needsUpdate = true;
    }
  }
  function transmit(stroke, start = stroke.sent) {
    for (let i = start; i < stroke.points.length; i += BATCH_SIZE) {
      send({ t: "stroke", epoch, id: stroke.id, start: i,
        points: stroke.points.slice(i, i + BATCH_SIZE) });
    }
    stroke.sent = stroke.points.length;
  }
  function flush() { if (active && getRole() === "expert") transmit(active); }
  function end() {
    flush();
    if (!drawing && !active) return;
    active = null;
    drawing = false;
    notify();
  }
  function reset() {
    for (const stroke of strokes.values()) stroke.line.geometry.dispose();
    group.clear();
    strokes.clear();
    active = null;
    drawing = limited = false;
    notify();
  }
  const api = {
    group,
    getState: state,
    onChange(fn) { listeners.add(fn); fn(state()); return () => listeners.delete(fn); },
    begin() {
      if (getRole() !== "expert" || drawing) return false;
      limited = strokes.size >= MAX_STROKES;
      drawing = !limited;
      notify();
      return drawing;
    },
    addWorldPoint(point) {
      if (!drawing || getRole() !== "expert") return false;
      modelRoot.updateWorldMatrix(true, false);
      local.copy(point);
      modelRoot.worldToLocal(local);
      if (!validPoint(local.toArray())) return false;
      if (active) {
        previousWorld.fromArray(active.points.at(-1));
        modelRoot.localToWorld(previousWorld);
        if (previousWorld.distanceToSquared(point) < MIN_POINT_DISTANCE ** 2) return false;
        if (active.points.length >= MAX_POINTS) {
          end();
          limited = true;
          notify();
          return false;
        }
      } else {
        active = create(makeId());
        if (!active) return false;
      }
      const first = active.points.length === 0;
      append(active, [local.toArray().map((n) => Math.round(n * 1e5) / 1e5)]);
      if (first) notify();
      return true;
    },
    update(time) {
      if (time - lastFlush >= 50) { flush(); lastFlush = time; }
    },
    end,
    clear() {
      if (getRole() !== "expert") return;
      epoch = makeId();
      reset();
      send({ t: "clear", epoch });
    },
    undo() {
      if (getRole() !== "expert") return;
      end();
      const last = Array.from(strokes.values()).at(-1);
      if (!last) return;
      last.line.geometry.dispose();
      last.object.removeFromParent();
      strokes.delete(last.id);
      limited = false;
      notify();
      epoch = makeId();
      send({ t: "clear", epoch });
      for (const stroke of strokes.values()) transmit(stroke, 0);
    },
    // Called after the novice's hello, including after reconnecting. Reliable
    // ordered delivery makes clear + snapshot + subsequent deltas one sequence.
    replay() {
      if (getRole() !== "expert") return;
      send({ t: "clear", epoch });
      for (const stroke of strokes.values()) transmit(stroke, 0);
    },
    receive(msg) {
      if (getRole() !== "novice" || !msg || !validId(msg.epoch)) return false;
      if (msg.t === "clear") {
        remoteEpoch = msg.epoch;
        reset();
        return true;
      }
      if (msg.t !== "stroke" || msg.epoch !== remoteEpoch || !validId(msg.id)
        || !Number.isInteger(msg.start) || msg.start < 0
        || !Array.isArray(msg.points) || !msg.points.length || msg.points.length > BATCH_SIZE
        || msg.start + msg.points.length > MAX_POINTS || !msg.points.every(validPoint)) return false;
      let stroke = strokes.get(msg.id);
      // Ignore duplicates or gaps rather than drawing a spurious connector.
      if (msg.start !== (stroke?.points.length ?? 0)) return false;
      if (!stroke) stroke = create(msg.id);
      if (!stroke) return false;
      append(stroke, msg.points);
      notify();
      return true;
    },
    dispose() {
      end();
      reset();
      group.removeFromParent();
      dotMaterial.dispose(); dotGeometry.dispose();
      listeners.clear();
    },
  };
  return api;
}

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
  let navigating = false;
  const actions = document.createElement("div");
  actions.className = "sketch-actions";
  actions.hidden = true;
  const undo = document.createElement("button");
  undo.className = "btn sketch-action";
  undo.type = "button";
  undo.setAttribute("aria-label", "Undo latest drawing");
  undo.title = "Undo latest drawing";
  undo.innerHTML = icon("<path d='M9 14 4 9l5-5'/><path d='M4 9h10a6 6 0 0 1 0 12h-2'/>");
  const clear = document.createElement("button");
  clear.className = "btn sketch-action";
  clear.type = "button";
  clear.title = "Clear all drawings";
  clear.setAttribute("aria-label", "Clear all sketches for both people");
  clear.innerHTML = icon("<path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/>");
  actions.append(undo, clear);
  hud.appendChild(actions);
  for (const control of [actions, undo, clear]) {
    control.addEventListener("beforexrselect", (e) => e.preventDefault());
    control.addEventListener("keydown", (e) => e.stopPropagation());
  }

  function ready() {
    return getRole() === "expert" && getMode() === "draw" && !toolbar.hidden
      && isPlaced() && (!renderer.xr.isPresenting || isTracking());
  }
  function render() {
    const state = sketch.getState();
    undo.disabled = state.count === 0;
    clear.disabled = state.count === 0;
  }
  function updateUI() {
    const visible = ready();
    if (visible !== uiVisible) {
      uiVisible = visible;
      actions.hidden = !visible;
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
    if (navigating || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (pointerId !== null) { stop(e); return; }
    setPointer(e);
    // Background drags belong to OrbitControls, even while Draw is selected.
    if (!sampler.sample(camera, pointer)) return;
    stop(e);
    pointerId = e.pointerId;
    orbitBeforeHold = controls.enabled;
    controls.enabled = false;
    canvas.setPointerCapture(pointerId);
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
  function undoLatest() { release(); sketch.undo(); }
  function clearAll() { release(); sketch.clear(); }
  undo.addEventListener("click", undoLatest);
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
  controls.addEventListener("start", () => { navigating = true; });
  controls.addEventListener("end", () => { navigating = false; });
  onModeChange(() => { release(); updateUI(); });
  sketch.onChange(render);

  return {
    update(time) {
      updateUI();
      if (pointerId !== null || xrSource) sample();
      sketch.update(time);
      // Keep annotations out of the translucent placement preview.
      sketch.group.visible = isPlaced() && (!renderer.xr.isPresenting || isTracking());
    },
  };
}
