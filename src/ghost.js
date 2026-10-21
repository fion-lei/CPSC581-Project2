import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { tokenColor } from "./tokens.js";

const COLORS = {
  expert: tokenColor("--expert"),
  novice: tokenColor("--novice"),
};
const NOVICE_SCALE = 0.8;

const PHONE_W = 0.07;    // portrait phone, x
const PHONE_H = 0.14;    // y, the long edge
const PHONE_D = 0.008;   // thickness, z
const PHONE_RADIUS = 0.01;

const CONE_LENGTH = 0.25;
const CONE_HALF_H = CONE_LENGTH * Math.tan(THREE.MathUtils.degToRad(30)); // ~60° vertical
const CONE_HALF_W = CONE_HALF_H * (PHONE_W / PHONE_H);

const SMOOTHING = 0.25;  // lerp / slerp factor per frame
const SNAP_DISTANCE = 1; // m; bigger jumps teleport
const TIMEOUT_MS = 2000;

const fillMaterial = (color, opacity, side) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, side });

// Fat lines; linewidth is in CSS px because resolution is the window size
const lineMaterials = [];
function lineMaterial(color, options) {
  const m = new LineMaterial({ color, linewidth: 2, depthWrite: false, ...options });
  m.resolution.set(window.innerWidth, window.innerHeight);
  lineMaterials.push(m);
  return m;
}
window.addEventListener("resize", () => {
  lineMaterials.forEach((m) => m.resolution.set(window.innerWidth, window.innerHeight));
});

// Geometry is shared by every ghost; only the materials differ by role.

// Phone outline in the screen plane: a rectangle with rounded corners
const outline = new THREE.Shape();
{
  const x = PHONE_W / 2 - PHONE_RADIUS;
  const y = PHONE_H / 2 - PHONE_RADIUS;
  outline.absarc(x, y, PHONE_RADIUS, 0, Math.PI / 2);
  outline.absarc(-x, y, PHONE_RADIUS, Math.PI / 2, Math.PI);
  outline.absarc(-x, -y, PHONE_RADIUS, Math.PI, Math.PI * 1.5);
  outline.absarc(x, -y, PHONE_RADIUS, Math.PI * 1.5, Math.PI * 2);
}

// Phone body: the outline extruded to the phone's thickness, centred on z = 0
const body = new THREE.ExtrudeGeometry(outline, { depth: PHONE_D, bevelEnabled: false })
  .translate(0, 0, -PHONE_D / 2);

// One loop around the body, rather than every edge of the extrusion
const loop = outline.getPoints(6);
const loopLine = new LineSegmentsGeometry().setPositions(
  loop.flatMap((a, i) => {
    const b = loop[(i + 1) % loop.length];
    return [a.x, a.y, 0, b.x, b.y, 0];
  }));

// View cone: pyramid from the phone out along -z
const apex = [0, 0, 0];
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  .map(([x, y]) => [x * CONE_HALF_W, y * CONE_HALF_H, -CONE_LENGTH]);

const coneFill = new THREE.BufferGeometry();
coneFill.setAttribute("position", new THREE.Float32BufferAttribute(
  corners.flatMap((c, i) => [...apex, ...c, ...corners[(i + 1) % 4]]), 3));

const coneEdges = new LineSegmentsGeometry().setPositions(
  corners.flatMap((c, i) => [...apex, ...c, ...c, ...corners[(i + 1) % 4]]));

// The other person's phone, posed in modelRoot local space. Looks down its local -z
// like a camera. role picks the look: expert = orange with a view cone, novice =
// smaller blue phone without one.
export function createGhost(role) {
  const color = COLORS[role];
  const object = new THREE.Group();
  object.visible = false;

  // FrontSide only, so a closed body doesn't stack two layers of opacity
  object.add(new THREE.Mesh(body, fillMaterial(color, 0.22, THREE.FrontSide)));
  object.add(new LineSegments2(loopLine, lineMaterial(color)));

  if (role === "novice") {
    object.scale.setScalar(NOVICE_SCALE);
  } else {
    // DoubleSide: the cone is open, so its far faces are seen from inside
    object.add(new THREE.Mesh(coneFill, fillMaterial(color, 0.14, THREE.DoubleSide)));
    const edges = new LineSegments2(coneEdges,
      lineMaterial(color, { dashed: true, dashSize: 0.01, gapSize: 0.006 }));
    edges.computeLineDistances();
    object.add(edges);
  }

  const targetPos = new THREE.Vector3();
  const targetQuat = new THREE.Quaternion();
  let lastPoseAt = -Infinity;

  // Latest pose from the other phone: { p: [x, y, z], q: [x, y, z, w] }
  function setPose({ p, q }) {
    targetPos.fromArray(p);
    targetQuat.fromArray(q);
    lastPoseAt = performance.now();
  }

  // Once per frame: ease toward the latest pose; hide when poses stop arriving
  function update() {
    if (performance.now() - lastPoseAt > TIMEOUT_MS) {
      object.visible = false;
      return;
    }
    // Coming back from hidden, or a big jump: no long glide across the room
    if (!object.visible || object.position.distanceTo(targetPos) > SNAP_DISTANCE) {
      object.position.copy(targetPos);
      object.quaternion.copy(targetQuat);
      object.visible = true;
      return;
    }
    object.position.lerp(targetPos, SMOOTHING);
    object.quaternion.slerp(targetQuat, SMOOTHING);
  }

  return { object, setPose, update };
}
