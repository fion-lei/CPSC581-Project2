import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createSketch, createSketchSampler, AIR_DISTANCE, SURFACE_OFFSET, MAX_POINTS, MAX_STROKES } from "../src/sketch.js";

function fixture(role = "expert") {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const messages = [];
  let id = 0;
  const sketch = createSketch({ modelRoot: root, send: (m) => messages.push(m),
    getRole: () => role, makeId: () => `test-${++id}` });
  return { root, pivot, messages, sketch };
}
const point = (x, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function draw(sketch, points) {
  sketch.begin();
  for (const p of points) sketch.addWorldPoint(p);
  sketch.end();
}
function geometry(sketch) { return sketch.group.children[0].children[0].geometry; }

test("AR samples the centre surface or 15 cm ahead; desktop misses produce no point", () => {
  const root = new THREE.Group(), pivot = new THREE.Group(); root.add(pivot);
  const camera = new THREE.PerspectiveCamera(60, 1, .01, 20);
  const sampler = createSketchSampler(root, pivot);
  assert.ok(sampler.sample(camera).distanceTo(point(0, 0, -AIR_DISTANCE)) < 1e-8);
  assert.equal(sampler.sample(camera, new THREE.Vector2()), null);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .1));
  mesh.position.z = -.4; pivot.add(mesh);
  assert.ok(sampler.sample(camera).distanceTo(point(0, 0, -.35 + SURFACE_OFFSET)) < 1e-7);
  assert.ok(sampler.sample(camera, new THREE.Vector2()).distanceTo(point(0, 0, -.35 + SURFACE_OFFSET)) < 1e-7);
  // A ghost under root must not intercept the part ray.
  const ghost = mesh.clone(); ghost.position.z = -.15; root.add(ghost);
  assert.ok(sampler.sample(camera).z < -.3);
  mesh.visible = false;
  assert.ok(Math.abs(sampler.sample(camera).z + AIR_DISTANCE) < 1e-8);
  root.visible = false; assert.equal(sampler.sample(camera), null);
});

test("rotated, parented AR camera samples in its world viewing direction", () => {
  const root = new THREE.Group(), pivot = new THREE.Group(); root.add(pivot);
  const rig = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  rig.position.set(2, 1, 3); rig.rotation.y = Math.PI / 2; rig.add(camera);
  const p = createSketchSampler(root, pivot).sample(camera);
  assert.ok(p.distanceTo(point(2 - AIR_DISTANCE, 1, 3)) < 1e-8);
});

test("distance filtering is 5 mm in world space and deltas contain only new points", () => {
  const { sketch, messages, root } = fixture(); root.scale.setScalar(2);
  sketch.begin();
  assert.equal(sketch.addWorldPoint(point(0)), true);
  assert.equal(sketch.addWorldPoint(point(.004)), false);
  assert.equal(sketch.addWorldPoint(point(.006)), true);
  sketch.update(50);
  assert.deepEqual(messages[0].points, [[0, 0, 0], [.003, 0, 0]]);
  sketch.addWorldPoint(point(.012)); sketch.end();
  assert.equal(messages[1].start, 2);
  assert.deepEqual(messages[1].points, [[.006, 0, 0]]);
  assert.equal(geometry(sketch).instanceCount, 2);
  assert.equal(sketch.group.children[0].children[0].material.worldUnits, true);
  sketch.dispose();
});

test("root-local strokes align across different placements and stay fixed when pivot rotates", () => {
  const expert = fixture(), novice = fixture("novice");
  expert.root.position.set(2, 0, -1); expert.root.rotation.y = Math.PI / 2;
  novice.root.position.set(-2, 0, 3); novice.root.rotation.y = -Math.PI / 2;
  expert.root.updateMatrixWorld(true);
  const a = expert.root.localToWorld(point(.1, .2, .3));
  const b = expert.root.localToWorld(point(.12, .2, .3));
  draw(expert.sketch, [a, b]); expert.messages.length = 0; expert.sketch.replay();
  expert.messages.forEach((m) => assert.equal(novice.sketch.receive(m), true));
  const coords = geometry(novice.sketch).attributes.instanceStart;
  assert.ok(Math.abs(coords.getX(0) - .1) < 1e-6);
  assert.ok(Math.abs(coords.getY(0) - .2) < 1e-6);
  assert.equal(expert.sketch.group.parent, expert.root);
  const before = new THREE.Vector3().fromBufferAttribute(coords, 0);
  novice.root.localToWorld(before);
  novice.pivot.rotation.set(1, 2, 3);
  const after = new THREE.Vector3().fromBufferAttribute(coords, 0);
  novice.root.localToWorld(after);
  assert.ok(before.distanceTo(after) < 1e-8);
  expert.sketch.dispose(); novice.sketch.dispose();
});

test("reconnect replay restores previous and in-progress strokes without duplicating deltas", () => {
  const expert = fixture(), novice = fixture("novice");
  draw(expert.sketch, [point(0), point(.01)]);
  expert.sketch.begin(); expert.sketch.addWorldPoint(point(.1));
  expert.messages.length = 0; expert.sketch.replay();
  expert.messages.forEach((m) => novice.sketch.receive(m));
  assert.equal(novice.sketch.getState().count, 2);
  expert.messages.length = 0;
  expert.sketch.addWorldPoint(point(.12)); expert.sketch.end();
  assert.equal(expert.messages[0].start, 1);
  expert.messages.forEach((m) => novice.sketch.receive(m));
  assert.equal(novice.sketch.group.children[1].children[0].geometry.instanceCount, 1);
  expert.messages.length = 0; expert.sketch.replay();
  expert.messages.forEach((m) => novice.sketch.receive(m));
  assert.equal(novice.sketch.getState().count, 2);
  expert.sketch.dispose(); novice.sketch.dispose();
});

test("clear disposes geometry, cancels the stroke and rejects old-epoch packets", () => {
  const expert = fixture(), novice = fixture("novice");
  draw(expert.sketch, [point(0), point(.01)]);
  expert.messages.length = 0; expert.sketch.replay();
  expert.messages.forEach((m) => novice.sketch.receive(m));
  const old = expert.messages[1];
  let disposed = false; geometry(expert.sketch).addEventListener("dispose", () => { disposed = true; });
  expert.sketch.begin(); expert.sketch.clear();
  novice.sketch.receive(expert.messages.at(-1));
  assert.equal(disposed, true);
  assert.deepEqual(expert.sketch.getState(), { count: 0, drawing: false, limited: false });
  assert.equal(novice.sketch.receive(old), false);
  assert.equal(novice.sketch.getState().count, 0);
  expert.sketch.dispose(); novice.sketch.dispose();
});

test("malformed, oversized, duplicate, out-of-order and wrong-role messages cannot append", () => {
  const { sketch } = fixture("novice");
  assert.equal(sketch.begin(), false);
  assert.equal(sketch.receive({ t: "clear", epoch: "room-a" }), true);
  const m = { t: "stroke", epoch: "room-a", id: "a", start: 0, points: [[0, 0, 0]] };
  for (const change of [{points:[[NaN,0,0]]}, {points:[[Infinity,0,0]]},
    {points:[[101,0,0]]}, {points:[[0,0]]}, {points:[]}, {points:Array(33).fill([0,0,0])},
    {start:1}, {start:-1}, {id:""}, {epoch:"wrong"}]) assert.equal(sketch.receive({...m,...change}), false);
  assert.equal(sketch.getState().count, 0);
  assert.equal(sketch.receive(m), true);
  assert.equal(sketch.receive(m), false);
  assert.equal(sketch.receive({...m,start:2}), false);
  const expert = fixture(); assert.equal(expert.sketch.receive(m), false);
  sketch.dispose(); expert.sketch.dispose();
});

test("stroke and document limits are bounded and Clear permits drawing again", () => {
  const { sketch, messages } = fixture();
  sketch.begin();
  for (let i = 0; i <= MAX_POINTS; i++) sketch.addWorldPoint(point(i * .01));
  assert.equal(sketch.getState().limited, true);
  assert.equal(sketch.getState().drawing, false);
  assert.equal(geometry(sketch).instanceCount, MAX_POINTS - 1);
  assert.ok(messages.every((m) => m.points.length <= 32));
  sketch.clear();
  for (let i = 0; i < MAX_STROKES; i++) draw(sketch, [point(i * .01)]);
  assert.equal(sketch.begin(), false);
  sketch.clear(); assert.equal(sketch.begin(), true);
  sketch.dispose();
});
