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
// Standing inside a ghost's cone tints and frames the whole screen, so the ghost
// fades out as this phone nears it: gone within HIDE_NEAR, full past FADE_FAR.
const HIDE_NEAR = 0.12;  // m
const FADE_FAR = 0.3;    // m

const fillMaterial = (color, opacity, side) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, depthWrite: false, side });

// Fat lines; linewidth is in CSS px because resolution is the window size.
// Shared with pins.js for the laser beam.
const lineMaterials = [];
export function lineMaterial(color, options) {
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

export function createSavedView() {
  const object = new THREE.Group();
  const material = lineMaterial(COLORS.expert,
    { dashed: true, dashSize: 0.01, gapSize: 0.006, transparent: true });
  for (const geometry of [loopLine, coneEdges]) {
    const edges = new LineSegments2(geometry, material);
    edges.computeLineDistances();
    object.add(edges);
  }
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  object.visible = false;
  return {
    object,
    update(time) {
      material.opacity = reducedMotion.matches ? 1 : 0.775 + Math.sin(time / 600) * 0.225;
    },
  };
}

// The other person's phone, posed in modelRoot local space. Looks down its local -z
// like a camera. role picks the look: expert = orange with a view cone, novice =
// smaller blue phone without one.
export function createGhost(role) {
  const color = COLORS[role];
  const object = new THREE.Group();
  object.visible = false;
  // Holds the looks, so fading never touches object.visible (that tracks timeouts)
  const look = new THREE.Group();
  object.add(look);

  // FrontSide only, so a closed body doesn't stack two layers of opacity
  look.add(new THREE.Mesh(body, fillMaterial(color, 0.22, THREE.FrontSide)));
  look.add(new LineSegments2(loopLine, lineMaterial(color, { transparent: true })));

  if (role === "novice") {
    object.scale.setScalar(NOVICE_SCALE);
  } else {
    // DoubleSide: the cone is open, so its far faces are seen from inside
    look.add(new THREE.Mesh(coneFill, fillMaterial(color, 0.14, THREE.DoubleSide)));
    const edges = new LineSegments2(coneEdges, lineMaterial(color,
      { dashed: true, dashSize: 0.01, gapSize: 0.006, transparent: true }));
    edges.computeLineDistances();
    look.add(edges);
  }
  const fades = look.children.map(({ material }) => ({ material, opacity: material.opacity }));

  // How close this phone is decides how much of the ghost shows.
  function fadeNear(localPosition) {
    const t = localPosition
      ? THREE.MathUtils.smoothstep(object.position.distanceTo(localPosition), HIDE_NEAR, FADE_FAR)
      : 1;
    look.visible = t > 0;
    fades.forEach(({ material, opacity }) => { material.opacity = opacity * t; });
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

  // Once per frame: ease toward the latest pose; hide when poses stop arriving.
  // localPosition is this phone in modelRoot space (or null), for fadeNear.
  function update(localPosition) {
    if (performance.now() - lastPoseAt > TIMEOUT_MS) {
      object.visible = false;
      return;
    }
    // Coming back from hidden, or a big jump: no long glide across the room
    if (!object.visible || object.position.distanceTo(targetPos) > SNAP_DISTANCE) {
      object.position.copy(targetPos);
      object.quaternion.copy(targetQuat);
      object.visible = true;
    } else {
      object.position.lerp(targetPos, SMOOTHING);
      object.quaternion.slerp(targetQuat, SMOOTHING);
    }
    fadeNear(localPosition);
  }

  return { object, setPose, update };
}
