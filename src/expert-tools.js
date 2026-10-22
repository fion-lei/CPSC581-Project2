import * as THREE from "three";

export const TOOL_MODES = Object.freeze(["grab", "pin", "draw", "view"]);

export function createModeStore() {
  let mode = "view";
  const listeners = new Set();
  return {
    getMode: () => mode,
    setMode(next) {
      if (!TOOL_MODES.includes(next)) throw new RangeError(`Unknown tool mode: ${next}`);
      if (next === mode) return;
      mode = next;
      for (const fn of listeners) fn(mode);
    },
    onModeChange(fn) {
      listeners.add(fn);
      fn(mode);
      return () => listeners.delete(fn);
    },
  };
}

// Shared with the grab, pin, sketch and view implementations.
export const { getMode, setMode, onModeChange } = createModeStore();

// Intersect actual part meshes only: edge lines, ghosts and later annotations
// must not light up the crosshair. Returned points are in WORLD coordinates.
export function createPartRaycast(modelRoot, modelPivot) {
  const raycaster = new THREE.Raycaster();
  // The CAD meshes are direct children. Pins and their catch meshes are not.
  const meshes = modelPivot.children.filter((object) => object.isMesh);
  return {
    raycaster,
    intersect() {
      if (!modelRoot.visible || !modelPivot.visible) return null;
      modelRoot.updateWorldMatrix(true, true);
      return raycaster.intersectObjects(meshes, false)[0] ?? null;
    },
  };
}

export function createCentreAim(modelRoot, modelPivot) {
  const { raycaster, intersect } = createPartRaycast(modelRoot, modelPivot);
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let hit = null;

  return {
    getHit: () => hit,
    update(camera, ready = true) {
      hit = null;
      if (!ready || !modelRoot.visible || !modelPivot.visible) return null;

      modelRoot.updateWorldMatrix(true, true);
      camera.getWorldPosition(origin);
      camera.getWorldDirection(direction);
      raycaster.set(origin, direction);
      raycaster.near = camera.near;
      raycaster.far = camera.far;
      hit = intersect();
      return hit;
    },
  };
}
