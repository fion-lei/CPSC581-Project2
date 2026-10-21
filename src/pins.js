import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { renderer, scene } from "./scene.js";
import { modelPivot } from "./model.js";
import { isPlaced } from "./ar.js";
import { getMode, onModeChange } from "./expert-tools.js";
import { lineMaterial } from "./ghost.js";
import { tokenColor } from "./tokens.js";

// Pin anatomy in metres (modelPivot space): a small physical object on the part
const HEAD_R = 0.004;       // 8 mm sphere
const RIM_R = 0.005;        // white rim behind the head, reads on any background
const STEM_LEN = 0.012;     // along the surface normal
const STEM_R = 0.0006;
const RING_R = 0.0075;      // 15 mm flat ring on the surface
const RING_W = 0.001;
const MIN_HEAD_PX = 5;      // far away, scale the pin up so it never vanishes
const PULSE_MS = 1600;
const PULSE_SCALE = 2.8;
const BEAM_PX = 4;
// Camera space: just below the bottom edge of the screen, so the beam enters from there
const BEAM_ORIGIN = new THREE.Vector3(0, -0.05, -0.03);
const BEAM_MISS = 1;        // m; length of a beam that hits nothing
const REMOTE_BEAM_MS = 300; // novice: beam from the ghost before the pin lands
const FADE_MS = 200;
const DASH_SPEED = 0.15;    // m/s
const DRAG_PX = 6;          // desktop: a press that moves further is an orbit, not a shot

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const round = (n) => Math.round(n * 1e4) / 1e4;
const easeOut = (t) => 1 - (1 - t) ** 3;
// Pins and the beam must never catch the centre ray (crosshair, aiming)
const noRaycast = () => {};

const EXPERT = tokenColor("--expert");
const headMaterial = new THREE.MeshStandardMaterial({ color: EXPERT, roughness: 0.35 });
const rimMaterial = new THREE.MeshBasicMaterial({ color: tokenColor("--label-bg"), side: THREE.BackSide });
const stemMaterial = new THREE.MeshStandardMaterial({ color: tokenColor("--expert-strong"), roughness: 0.5 });
// Ring lies on the part's face: polygonOffset keeps it from z-fighting the surface
const flat = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
const ringMaterial = new THREE.MeshBasicMaterial({ color: EXPERT, ...flat });
const ringFillMaterial = new THREE.MeshBasicMaterial({
  color: EXPERT, transparent: true, opacity: 0.18, depthWrite: false, ...flat });
// Only drawn where the part is in front, so a pin round the back is never lost
const hiddenMaterial = new THREE.MeshBasicMaterial({
  color: EXPERT, transparent: true, opacity: 0.45, depthWrite: false, depthFunc: THREE.GreaterDepth });

const headGeometry = new THREE.SphereGeometry(HEAD_R, 24, 16);
const rimGeometry = new THREE.SphereGeometry(RIM_R, 24, 16);
// CylinderGeometry runs along +Y, which is the pin's normal; base on the surface
const stemGeometry = new THREE.CylinderGeometry(STEM_R, STEM_R, STEM_LEN, 8).translate(0, STEM_LEN / 2, 0);
// RingGeometry is in XY; turn it into the surface plane (XZ)
const ringGeometry = new THREE.RingGeometry(RING_R - RING_W, RING_R, 40).rotateX(-Math.PI / 2);
const ringFillGeometry = new THREE.CircleGeometry(RING_R - RING_W, 40).rotateX(-Math.PI / 2);
// Billboarded circle just outside the rim
const hiddenGeometry = new THREE.RingGeometry(RIM_R * 1.05, RIM_R * 1.3, 32);

const Y = new THREE.Vector3(0, 1, 0);
const v = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const q = new THREE.Quaternion();

function mesh(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.raycast = noRaycast;
  return m;
}

// Pin in modelPivot space: p = point, n = surface normal. Local +y is the normal,
// so the stem stands up on a top face, sticks out of a side and hangs under a shelf.
function makePin(id, p, n) {
  const object = new THREE.Group();
  object.position.fromArray(p);
  object.quaternion.setFromUnitVectors(Y, v.fromArray(n).normalize());
  object.visible = false;

  const head = new THREE.Group();
  head.position.y = STEM_LEN;
  const outline = mesh(hiddenGeometry, hiddenMaterial);
  head.add(mesh(headGeometry, headMaterial), mesh(rimGeometry, rimMaterial), outline);

  // Landing pulse: a copy of the surface ring that grows and fades
  const pulse = mesh(ringGeometry, new THREE.MeshBasicMaterial({
    color: EXPERT, transparent: true, depthWrite: false, ...flat }));
  pulse.visible = false;

  object.add(mesh(ringFillGeometry, ringFillMaterial), mesh(ringGeometry, ringMaterial),
    mesh(stemGeometry, stemMaterial), head, pulse);
  return { id, p, n, object, outline, pulse, landAt: 0, pulseAt: -Infinity };
}

// One beam per phone: the expert's aim, or the expert's shot seen by the novice.
// World space; it is a local effect, never synced.
function makeBeam() {
  const geometry = new LineSegmentsGeometry().setPositions([0, 0, 0, 0, 0, -1]);
  const line = new LineSegments2(geometry, lineMaterial(EXPERT, {
    linewidth: BEAM_PX, dashed: true, dashSize: 0.012, gapSize: 0.008, transparent: true }));
  line.computeLineDistances();
  line.frustumCulled = false;
  line.raycast = noRaycast;
  line.visible = false;
  scene.add(line);
  return line;
}

// Move the beam in place: rebuilding its buffers every frame would leak GPU memory
function setBeam(line, a, b) {
  const pos = line.geometry.attributes.instanceStart.data;
  pos.array.set([a.x, a.y, a.z, b.x, b.y, b.z]);
  pos.needsUpdate = true;
  const dist = line.geometry.attributes.instanceDistanceStart.data;
  dist.array[1] = a.distanceTo(b);
  dist.needsUpdate = true;
}

// Pin mode: press and hold to aim at the crosshair, release to pin the hit point.
// expertGhost = the ghost object the novice's beam starts from; send = net.js send.
export function initPins({ expertGhost, send }) {
  const canvas = renderer.domElement;
  const group = new THREE.Group();
  modelPivot.add(group);
  const pins = new Map();
  const beam = makeBeam();
  const beamFrom = new THREE.Vector3();
  const beamTo = new THREE.Vector3();
  let beamState = "off"; // off | aim | remote | fade
  let beamAt = 0;
  let remotePin = null;

  let ready = false; // expert, part placed, tracking (from main.js each frame)
  let hit = null;    // centre-ray hit in world space
  let holding = null; // pointerId (desktop) or XRInputSource
  const pressAt = new THREE.Vector2(); // desktop: where the button went down
  const v2 = new THREE.Vector2();
  let counter = 0;
  let lastTime = performance.now();

  const canAim = () => ready && getMode() === "pin";

  function addPin(pin, { pulse }) {
    pins.set(pin.id, pin);
    group.add(pin.object);
    if (!pulse) pin.object.visible = true;
    return pin;
  }

  function land(pin, now) {
    pin.object.visible = true;
    pin.pulseAt = now;
  }

  function fadeBeam(now) {
    beamState = "fade";
    beamAt = now;
  }

  function startHold(source) {
    if (!canAim() || holding !== null) return false;
    holding = source;
    beamState = "aim";
    beam.material.opacity = 1;
    return true;
  }

  function endHold(source, fire) {
    if (holding === null || holding !== source) return;
    holding = null;
    const now = performance.now();
    if (fire && canAim() && hit) {
      placeAtHit(now);
      fadeBeam(now);
    } else if (beamState === "aim") {
      beamState = "off";
    }
  }
  const cancel = () => endHold(holding, false);

  function placeAtHit(now) {
    modelPivot.updateWorldMatrix(true, false);
    const p = modelPivot.worldToLocal(hit.point.clone());
    // Face normal: object space → world → modelPivot space
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      .applyQuaternion(modelPivot.getWorldQuaternion(q).invert()).normalize();
    const id = `${Date.now().toString(36)}-${++counter}`;
    const pin = addPin(makePin(id, p.toArray().map(round), n.toArray().map(round)), { pulse: true });
    land(pin, now);
    send({ t: "pin", id, p: pin.p, n: pin.n });
  }

  // Desktop: hold the left mouse button still to aim. OrbitControls gets the same
  // events, so a drag still orbits; it cancels the laser instead of pinning.
  canvas.addEventListener("pointerdown", (e) => {
    if (renderer.xr.isPresenting || e.button !== 0 || !startHold(e.pointerId)) return;
    pressAt.set(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId === holding && pressAt.distanceTo(v2.set(e.clientX, e.clientY)) > DRAG_PX) {
      endHold(e.pointerId, false);
    }
  });
  canvas.addEventListener("pointerup", (e) => endHold(e.pointerId, true));
  canvas.addEventListener("pointercancel", (e) => endHold(e.pointerId, false));

  // AR: hold anywhere on the screen. HUD controls stop their own touches with
  // beforexrselect, so tapping a mode button never fires the laser.
  renderer.xr.addEventListener("sessionstart", () => {
    const session = renderer.xr.getSession();
    session.addEventListener("selectstart", (e) => startHold(e.inputSource));
    session.addEventListener("selectend", (e) => endHold(e.inputSource, true));
  });
  renderer.xr.addEventListener("sessionend", cancel);
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  onModeChange(cancel);

  // Expert → novice: a new pin, or r = 1 for a resend after reconnecting (no beam)
  function addRemote({ id, p, n, r }) {
    if (pins.has(id) || !Array.isArray(p) || !Array.isArray(n)) return;
    const pin = addPin(makePin(id, p, n), { pulse: !r });
    if (r) return;
    const now = performance.now();
    if (!expertGhost.visible) {
      land(pin, now);
      return;
    }
    // A newer shot replaces a beam still in flight; that pin lands now
    if (remotePin && !remotePin.object.visible) land(remotePin, now);
    remotePin = pin;
    pin.landAt = now + REMOTE_BEAM_MS;
    beamState = "remote";
    beam.material.opacity = 1;
  }

  // Expert: send every pin again, e.g. when the novice (re)joins
  function resend() {
    for (const { id, p, n } of pins.values()) send({ t: "pin", id, p, n, r: 1 });
  }

  function updateBeam(cam, now, dt) {
    if (beamState === "aim") {
      cam.updateWorldMatrix(true, false);
      beamFrom.copy(BEAM_ORIGIN).applyMatrix4(cam.matrixWorld);
      if (hit) beamTo.copy(hit.point);
      else beamTo.set(0, 0, -BEAM_MISS).applyMatrix4(cam.matrixWorld);
    } else if (beamState === "remote") {
      expertGhost.getWorldPosition(beamFrom);
      remotePin.object.getWorldPosition(beamTo);
      if (now >= remotePin.landAt) {
        land(remotePin, now);
        remotePin = null;
        fadeBeam(now);
      }
    } else if (beamState === "fade") {
      const t = (now - beamAt) / FADE_MS;
      beam.material.opacity = 1 - t;
      if (t >= 1) beamState = "off";
    }
    beam.visible = beamState !== "off";
    if (!beam.visible) return;
    setBeam(beam, beamFrom, beamTo);
    // Laser dash flow toward the target
    if (!reducedMotion.matches) beam.material.dashOffset -= dt * DASH_SPEED;
  }

  function updatePin(pin, worldPerPx, partScale, now) {
    // Real size up close; never smaller than MIN_HEAD_PX on screen
    pin.object.getWorldPosition(v);
    const minR = camPos.distanceTo(v) * worldPerPx * MIN_HEAD_PX;
    pin.object.scale.setScalar(Math.max(1, minR / (HEAD_R * partScale)));
    // Billboard the hidden outline: undo its parent's world rotation, then face the camera
    pin.outline.parent.getWorldQuaternion(q);
    pin.outline.quaternion.copy(q.invert().multiply(camQuat));

    const t = (now - pin.pulseAt) / PULSE_MS;
    pin.pulse.visible = t >= 0 && t < 1;
    if (!pin.pulse.visible) return;
    pin.pulse.scale.setScalar(1 + (PULSE_SCALE - 1) * easeOut(t));
    pin.pulse.material.opacity = 1 - t;
  }

  // Once per frame. cam = the camera rendering this frame; aimReady and aimHit come
  // from the centre ray in main.js.
  function update(cam, aimReady, aimHit) {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    ready = aimReady;
    hit = aimHit;
    if (holding !== null && !canAim()) cancel();

    updateBeam(cam, now, dt);

    // Keep pins out of the translucent placement preview
    group.visible = isPlaced();
    if (!group.visible || pins.size === 0) return;
    cam.getWorldPosition(camPos);
    cam.getWorldQuaternion(camQuat);
    // World units per screen px at 1 m: from the vertical field of view
    const worldPerPx = 2 / (cam.projectionMatrix.elements[5] * window.innerHeight);
    const partScale = modelPivot.getWorldScale(v).x;
    for (const pin of pins.values()) {
      if (pin.object.visible) updatePin(pin, worldPerPx, partScale, now);
    }
  }

  return { update, addRemote, resend };
}
