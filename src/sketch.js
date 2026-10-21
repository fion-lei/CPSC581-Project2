import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

export const MIN_POINT_DISTANCE = 0.005;
export const AIR_DISTANCE = 0.15;
export const MAX_STROKES = 64;
export const MAX_POINTS = 1024;
export const BATCH_SIZE = 32;
const WIDTH = 0.003;
export const SURFACE_OFFSET = WIDTH * 0.55;
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
  const material = new LineMaterial({ color: 0xea580c, linewidth: WIDTH, worldUnits: true });
  const dotMaterial = new THREE.MeshBasicMaterial({ color: 0xea580c });
  const dotGeometry = new THREE.SphereGeometry(WIDTH / 2, 8, 6);
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
    const line = new LineSegments2(geometry, material);
    line.frustumCulled = false; // Bounds would otherwise contain unused buffer entries.
    line.visible = false;
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    const object = new THREE.Group();
    object.name = id;
    object.add(line, dot);
    group.add(object);
    const stroke = { id, points: [], sent: 0, object, line, dot };
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
    stroke.line.visible = segments > 0;
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
      material.dispose(); dotMaterial.dispose(); dotGeometry.dispose();
      listeners.clear();
    },
  };
  return api;
}
