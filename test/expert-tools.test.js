import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createModeStore, createCentreAim } from "../src/expert-tools.js";

test("one mode is active; changes notify subscribers and can be unsubscribed", () => {
  const store = createModeStore();
  const seen = [];
  const stop = store.onModeChange((mode) => seen.push(mode));
  assert.equal(store.getMode(), "view");
  for (const mode of ["grab", "pin", "draw", "view"]) {
    store.setMode(mode);
    assert.equal(store.getMode(), mode);
  }
  store.setMode("view");
  assert.deepEqual(seen, ["view", "grab", "pin", "draw", "view"]);
  stop();
  store.setMode("draw");
  assert.equal(seen.length, 5);
});

test("invalid modes cannot replace the selected mode", () => {
  const store = createModeStore();
  store.setMode("pin");
  assert.throws(() => store.setMode("unknown"), RangeError);
  assert.equal(store.getMode(), "pin");
});

function fixture() {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  const part = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.add(pivot);
  pivot.add(part);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 20);
  camera.position.set(0, 0, 3);
  return { root, pivot, part, camera, aim: createCentreAim(root, pivot) };
}

test("centre aim hits the part, ignoring nearer ghosts and edge lines", () => {
  const { root, pivot, part, camera, aim } = fixture();
  const ghost = part.clone();
  ghost.position.z = 2;
  root.add(ghost);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, 2), new THREE.Vector3(1, 0, 2),
    ]), new THREE.LineBasicMaterial());
  pivot.add(line);
  const hit = aim.update(camera);
  assert.equal(hit.object, part);
  assert.ok(Math.abs(hit.point.z - 0.5) < 1e-6);
});

test("aim refreshes part transforms before the renderer has run", () => {
  const { pivot, camera, aim } = fixture();
  assert.ok(aim.update(camera));
  pivot.position.x = 4;
  assert.equal(aim.update(camera), null);
  assert.equal(aim.getHit(), null);
});

test("aim works after table placement rotation, translation and scaling", () => {
  const { root, part, camera, aim } = fixture();
  root.position.set(3, 1, -2);
  root.rotation.y = 0.6;
  root.scale.setScalar(1.5);
  root.updateWorldMatrix(true, true);
  camera.position.copy(root.localToWorld(new THREE.Vector3(0, 0, 3)));
  camera.lookAt(root.localToWorld(new THREE.Vector3()));
  const hit = aim.update(camera);
  assert.equal(hit.object, part);
  const local = root.worldToLocal(hit.point.clone());
  assert.ok(local.distanceTo(new THREE.Vector3(0, 0, 0.5)) < 1e-6);
});

test("unready frames clear a previous hit, and hidden part meshes are skipped", () => {
  const { root, pivot, part, camera, aim } = fixture();
  assert.ok(aim.update(camera));
  assert.equal(aim.update(camera, false), null);
  assert.equal(aim.getHit(), null);
  for (const object of [root, pivot, part]) {
    object.visible = false;
    assert.equal(aim.update(camera), null);
    object.visible = true;
  }
  assert.ok(aim.update(camera));
});

test("a parented camera uses its world position and viewing direction", () => {
  const { root, camera, aim } = fixture();
  const rig = new THREE.Group();
  rig.position.set(2, 0, 0);
  rig.rotation.y = Math.PI / 2;
  camera.position.set(0, 0, 0);
  rig.add(camera);
  root.rotation.y = 0.2;
  assert.ok(aim.update(camera));
  rig.rotation.y = -Math.PI / 2;
  assert.equal(aim.update(camera), null);
});
