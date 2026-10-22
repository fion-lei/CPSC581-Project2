import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { renderer, scene } from "./scene.js";
import { modelPivot } from "./model.js";
import { isPlaced } from "./ar.js";
import { getMode, onModeChange } from "./expert-tools.js";
import { lineMaterial } from "./ghost.js";
import { tokenColor, tokenNumber } from "./tokens.js";
import { showToast, showPill, setHint } from "./hud.js";
import { play } from "./audio.js";
import { overhangAngle, fixText, validMark, createPinLabels } from "./pin-labels.js";
import { createPinDrawer, createPinSheet } from "./pin-drawer.js";
import { createPinToast } from "./pin-toast.js";

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
const HIT_R = HEAD_R * 2.5; // aim catch sphere round the head, so a pin is easy to hit
const PIN_FIRST = 0.01;     // m; aiming at a pin wins unless the part is this much nearer
const SELECTED_SCALE = 1.4; // drawer: the selected pin grows
const REMOVE_MS = 250;      // removed pins shrink and fade out
const UNDO_MS = 5000;
const TOAST_MS = 6000;      // novice: "Expert removed a pin"
const DIM = tokenNumber("--dim");
const OVERHANG_MIN = 45;    // degrees; a face pointing down more than this suggests Overhang
const INSIDE_EDGE = 0.01;   // m; a wall this close beside the hit suggests Sharp corner

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
// Cloned per pin (so one pin can dim or fade); all transparent so opacity just works
const pinMaterials = [headMaterial, rimMaterial, stemMaterial, ringMaterial, ringFillMaterial];
for (const m of pinMaterials) {
  m.userData.opacity = m.opacity;
  m.transparent = true;
}
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
// Never drawn: only catches the aim ray (Pin mode: aim at a pin to relabel or remove it)
const hitGeometry = new THREE.SphereGeometry(HIT_R, 12, 8);
const hitMaterial = new THREE.MeshBasicMaterial();

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
// no = the number the expert and novice call it by, null while it is the expert's draft;
// mark = { problem, fix, value } (see PROBLEMS, FIXES), null until picked.
function makePin(id, p, n, no = null, mark = null) {
  const object = new THREE.Group();
  object.position.fromArray(p);
  object.quaternion.setFromUnitVectors(Y, v.fromArray(n).normalize());
  object.visible = false;

  const [head_, rim, stem, ring, ringFill] = pinMaterials.map((m) => m.clone());
  const head = new THREE.Group();
  head.position.y = STEM_LEN;
  const outline = mesh(hiddenGeometry, hiddenMaterial);
  const hitSphere = new THREE.Mesh(hitGeometry, hitMaterial);
  hitSphere.visible = false;
  hitSphere.userData.pinId = id;
  head.add(mesh(headGeometry, head_), mesh(rimGeometry, rim), outline, hitSphere);

  // Landing pulse: a copy of the surface ring that grows and fades
  const pulse = mesh(ringGeometry, new THREE.MeshBasicMaterial({
    color: EXPERT, transparent: true, depthWrite: false, ...flat }));
  pulse.visible = false;

  object.add(mesh(ringFillGeometry, ringFill), mesh(ringGeometry, ring),
    mesh(stemGeometry, stem), head, pulse);
  return { id, no, problem: mark?.problem ?? null, fix: mark?.fix ?? null, value: mark?.value ?? null,
    acked: false, p, n, object, head, outline, pulse, hitSphere,
    materials: [head_, rim, stem, ring, ringFill], landAt: 0, pulseAt: -Infinity, removedAt: 0 };
}

function setPinOpacity(pin, a) {
  for (const m of pin.materials) m.opacity = m.userData.opacity * a;
}

function disposePin(pin) {
  for (const m of pin.materials) m.dispose();
  pin.pulse.material.dispose();
  pin.object.removeFromParent();
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

// Pin mode: press and hold to aim at the crosshair, release to pin the hit point and
// pick its problem and fix. Aiming at an existing pin and releasing reopens the sheet for it.
// expertGhost = the ghost object the novice's beam starts from; send and getRole from net.js.
// The novice confirms a pin with a check (ack), which turns it blue on both phones.
export function initPins({ expertGhost, send, getRole }) {
  const canvas = renderer.domElement;
  const hud = document.getElementById("hud");
  const group = new THREE.Group();
  modelPivot.add(group);
  const pins = new Map();    // id → pin, in placement order
  const removed = new Map(); // expert: id → { id, no, p, n, problem, fix, value } of removed pins, for undo
  const fading = new Set();  // removed pins shrinking out
  const beam = makeBeam();
  const beamFrom = new THREE.Vector3();
  const beamTo = new THREE.Vector3();
  let beamState = "off"; // off | aim | remote | fade
  let beamAt = 0;
  let remotePin = null;

  let ready = false; // expert, part placed, tracking (from main.js each frame)
  let hit = null;    // centre-ray hit on the part, world space
  let pinHit = null; // pin the centre ray is on, if it beats the part hit
  let holding = null; // pointerId (desktop) or XRInputSource
  // A press that started while the sheet or the drawer was open: a tap outside it
  // cancels the pin or closes the drawer, and fires no laser. The press that opened
  // the sheet doesn't count, as it began before.
  let dismissing = null;
  const pressAt = new THREE.Vector2(); // desktop: where the button went down
  const v2 = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const rayDir = new THREE.Vector3();
  let counter = 0;
  let lastNo = 0;
  let selectedId = null; // expert: the pin highlighted from the drawer
  let hidden = false;    // the eye in the drawer: every pin hidden on this phone only
  let sheetPin = null;   // expert: the pin the sheet is open for
  // Novice: id → mark key of every pin we confirmed, kept across a reconnect so an
  // ack the expert never got (sent while disconnected) goes again
  const acks = new Map();
  const isNovice = () => getRole() === "novice";
  let lastTime = performance.now();

  const labels = createPinLabels(hud, { onTap: tapLabel });
  const sheet = createPinSheet(hud);
  const drawer = createPinDrawer(hud, {
    isNovice,
    onSelect: (id) => (selectedId === id ? select(null) : reveal(id)),
    onRemove: (id) => removePin(id, { undo: true }),
    onRemoveAll: confirmRemoveAll,
    onAck: ackLocal,
    onToggleHidden: () => setHidden(!hidden),
    onOpen: openedDrawer,
    onClose: () => select(null),
  });
  const toast = createPinToast({ onAck: ackLocal, onFind: reveal });

  const canAim = () => ready && getMode() === "pin";
  // Pins that are on both phones (drafts have no number yet), in placement order
  const sentPins = () => [...pins.values()].filter((pin) => pin.no);
  const markOf = ({ problem, fix, value }) => ({ problem, fix, value });
  const markKey = ({ problem, fix, value }) => `${problem}|${fix}|${value}`;
  // Plain pins and fixes without a value leave those fields out
  function pinMessage({ id, no, p, n, problem, fix, value }) {
    const msg = { t: "pin", id, no, p, n, problem };
    if (fix) msg.fix = fix;
    if (value != null) msg.value = value;
    return msg;
  }

  function addPin(pin, { pulse }) {
    pins.set(pin.id, pin);
    group.add(pin.object);
    labels.add(pin);
    if (!pulse) pin.object.visible = true;
    return pin;
  }

  // Off the map at once; the object shrinks out in update()
  function dropPin(pin, now) {
    pins.delete(pin.id);
    labels.remove(pin.id);
    if (!pin.object.visible) {
      disposePin(pin);
      return;
    }
    pin.removedAt = now;
    pin.hitSphere.removeFromParent();
    fading.add(pin);
  }

  function land(pin, now, { notify = false } = {}) {
    pin.object.visible = true;
    pin.pulseAt = now;
    if (isNovice()) {
      play("pin");
      navigator.vibrate?.(40);
      if (notify) toast.show(pin);
    }
  }

  function fadeBeam(now) {
    beamState = "fade";
    beamAt = now;
  }

  function renderDrawer() {
    const sent = sentPins();
    drawer.render(sent, selectedId, hidden);
    // Novice: a dot while some pin still waits to be confirmed
    if (isNovice()) drawer.setDot(sent.some((pin) => !pin.acked));
  }

  // Expert: the new confirmations are seen, so the dot goes. Novice: the newest
  // waiting pin is selected (it grows and pulses).
  function openedDrawer() {
    if (!isNovice()) {
      drawer.setDot(false);
      return;
    }
    const waiting = sentPins().filter((pin) => !pin.acked);
    if (waiting.length) select(waiting[waiting.length - 1].id);
  }

  // Drawer selection: the pin grows and pulses, every other pin dims
  function select(id) {
    selectedId = id && pins.has(id) ? id : null;
    if (selectedId) pins.get(selectedId).pulseAt = performance.now();
    renderDrawer();
  }

  // Hidden pins show again on any pin action, so nothing lands or gets picked unseen
  function setHidden(on) {
    if (on === hidden) return;
    hidden = on;
    renderDrawer();
  }

  // A row or Find picked this pin: show the pins and select it. (Opening the drawer
  // selects too, but that alone leaves hidden pins hidden.)
  function reveal(id) {
    setHidden(false);
    select(id);
  }

  function tapLabel(pin) {
    if (pin.no && getMode() === "pin" && ready && pins.has(pin.id)) {
      // Expert in Pin mode: a pin in the scene selects it, like its row
      drawer.openDrawer();
      reveal(pin.id);
    } else {
      labels.toggle(pin.id);
    }
  }

  // ---- Expert: picking, relabelling and removing ----

  // Suggested problem from the hit face (the expert can always change it)
  function suggest(pin) {
    const angle = overhangAngle(pin.n);
    if (angle > OVERHANG_MIN) return { problem: "overhang", note: `Suggested · ${angle}°` };
    if (nearInsideEdge(pin)) return { problem: "corner", note: "Suggested" };
    return null;
  }

  // A wall of the part right beside the hit, along the surface: an inside edge
  function nearInsideEdge(pin) {
    pin.object.updateWorldMatrix(true, false);
    const origin = pin.object.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(pin.object.getWorldQuaternion(q));
    origin.addScaledVector(normal, 0.001);
    const tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(0, 0, 1);
    tangent.cross(normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
    const part = modelPivot.children.filter((o) => o.isMesh);
    raycaster.far = INSIDE_EDGE * modelPivot.getWorldScale(v).x;
    const found = [tangent, bitangent].some((t) => [1, -1].some((sign) => {
      raycaster.set(origin, rayDir.copy(t).multiplyScalar(sign));
      return raycaster.intersectObjects(part, false).length > 0;
    }));
    raycaster.far = Infinity;
    return found;
  }

  // Step 1 problem, step 2 fix, then Send pin. A draft is local only; the label
  // previews the sheet's choice live (pin.edit) until it closes.
  function openSheet(pin) {
    const existing = !!pin.no;
    sheetPin = pin;
    sheet.open(pin, {
      current: existing ? markOf(pin) : null,
      hint: existing ? null : suggest(pin),
      onChange(mark) { pin.edit = mark; },
      onSend(mark) {
        sheet.close();
        sheetPin = null;
        pin.edit = undefined;
        if (!pins.has(pin.id)) return;
        const changed = Object.entries(mark).some(([key, value]) => pin[key] !== value);
        Object.assign(pin, mark);
        if (!existing) {
          // The draft turns solid with a pulse and gets the next number
          pin.no = ++lastNo;
          pin.pulseAt = performance.now();
          if (send(pinMessage(pin))) play("pin", { quiet: true });
          showPill(`Pin ${pin.no} sent to novice`);
        } else if (changed) {
          // A new fix needs confirming again
          pin.acked = false;
          if (send(pinMessage(pin))) play("pin", { quiet: true });
          showPill(`Pin ${pin.no} updated`);
        }
        renderDrawer();
      },
      onRemove() {
        sheet.close();
        sheetPin = null;
        pin.edit = undefined;
        removePin(pin.id, { undo: true });
      },
      onCancel: closeSheet,
    });
  }

  // Cancel (or a mode change from a room switch, or the AR session ending): a draft
  // was never sent, so it just goes. The sheet hides the mode bar, so the expert
  // can't switch mode while it is open.
  function closeSheet() {
    if (!sheet.isOpen()) return;
    sheet.close();
    sheetPin = null;
    for (const pin of [...pins.values()]) {
      pin.edit = undefined;
      if (!pin.no) dropPin(pin, performance.now());
    }
  }

  function removePin(id, { undo }) {
    const pin = pins.get(id);
    if (!pin?.no) return;
    if (undo) removed.set(id, { id, no: pin.no, p: pin.p, n: pin.n, ...markOf(pin) });
    dropPin(pin, performance.now());
    send({ t: "unpin", id });
    if (selectedId === id) selectedId = null;
    // A sheet open on another pin (or a new draft) is left alone
    if (sheetPin === pin) closeSheet();
    renderDrawer();
    if (undo) showPill(`Pin ${pin.no} removed`, { label: "Undo", onClick: () => restore(id) }, UNDO_MS);
  }

  // Undo: the same pin again, with its number and fix
  function restore(id) {
    const data = removed.get(id);
    if (!data || pins.has(id)) return;
    removed.delete(id);
    setHidden(false);
    const pin = addPin(makePin(data.id, data.p, data.n, data.no, data), { pulse: true });
    land(pin, performance.now());
    if (send(pinMessage(pin))) play("pin", { quiet: true });
    renderDrawer();
  }

  function confirmRemoveAll() {
    const count = sentPins().length;
    if (!count) return;
    showPill(`Remove all ${count} pins?`, { label: "Remove all", onClick() {
      for (const pin of sentPins()) removePin(pin.id, { undo: false });
      showPill("All pins removed");
    } }, UNDO_MS);
  }

  // Novice confirmed a pin: its row gets a blue check, and the tab a dot until the
  // drawer opens. Unknown ids (removed since) and repeats are ignored.
  function onAck({ id }) {
    const pin = pins.get(id);
    if (!pin?.no || pin.acked) return;
    pin.acked = true;
    play("gotIt");
    navigator.vibrate?.(40);
    if (!drawer.isOpen()) drawer.setDot(true);
    renderDrawer();
  }

  // ---- Expert: aiming ----

  function startHold(source) {
    if (!canAim() || holding !== null || sheet.isOpen()) return false;
    holding = source;
    setHidden(false);
    beamState = "aim";
    beam.material.opacity = 1;
    if (!drawer.isOpen()) select(null);
    return true;
  }

  function endHold(source, fire) {
    if (holding === null || holding !== source) return;
    holding = null;
    setHint(null);
    const now = performance.now();
    if (fire && canAim() && (pinHit || hit)) {
      if (pinHit) openSheet(pinHit);
      else placeAtHit();
      fadeBeam(now);
    } else if (beamState === "aim") {
      beamState = "off";
    }
  }
  const cancel = () => endHold(holding, false);

  // A draft pin lands here at once; it goes to the novice on Send pin
  function placeAtHit() {
    modelPivot.updateWorldMatrix(true, false);
    const p = modelPivot.worldToLocal(hit.point.clone());
    // Face normal: object space → world → modelPivot space
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      .applyQuaternion(modelPivot.getWorldQuaternion(q).invert()).normalize();
    const id = `${Date.now().toString(36)}-${++counter}`;
    const pin = addPin(makePin(id, p.toArray().map(round), n.toArray().map(round)), { pulse: false });
    openSheet(pin);
  }

  // Centre ray against the pins' catch spheres; a pin wins unless the part is clearly nearer
  function aimAtPins(cam) {
    pinHit = null;
    if (!canAim() || sheet.isOpen()) return;
    const spheres = [];
    for (const pin of pins.values()) if (pin.no && pin.object.visible) spheres.push(pin.hitSphere);
    if (!spheres.length) return;
    cam.getWorldPosition(camPos);
    cam.getWorldDirection(rayDir);
    raycaster.set(camPos, rayDir);
    const first = raycaster.intersectObjects(spheres, false)[0];
    if (first && (!hit || first.distance < hit.distance + PIN_FIRST)) {
      pinHit = pins.get(first.object.userData.pinId) ?? null;
    }
  }

  // Desktop: hold the left mouse button still to aim. OrbitControls gets the same
  // events, so a drag still orbits; it cancels the laser instead of pinning.
  canvas.addEventListener("pointerdown", (e) => {
    if (renderer.xr.isPresenting || e.button !== 0) return;
    if (sheet.isOpen() || drawer.isOpen()) dismissing = e.pointerId;
    else if (!startHold(e.pointerId)) return;
    pressAt.set(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pressAt.distanceTo(v2.set(e.clientX, e.clientY)) <= DRAG_PX) return;
    // A drag orbits instead: no shot, and no cancel
    if (e.pointerId === holding) endHold(e.pointerId, false);
    if (e.pointerId === dismissing) dismissing = null;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerId === dismissing) dismiss();
    endHold(e.pointerId, true);
  });
  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerId === dismissing) dismissing = null;
    endHold(e.pointerId, false);
  });

  function dismiss() {
    dismissing = null;
    if (sheet.isOpen()) closeSheet();
    else if (drawer.isOpen()) drawer.dismiss();
  }

  // AR: hold anywhere on the screen. HUD controls stop their own touches with
  // beforexrselect, so tapping a mode button never fires the laser.
  renderer.xr.addEventListener("sessionstart", () => {
    const session = renderer.xr.getSession();
    session.addEventListener("selectstart", (e) => {
      if (sheet.isOpen() || drawer.isOpen()) dismissing = e.inputSource;
      else startHold(e.inputSource);
    });
    session.addEventListener("selectend", (e) => {
      if (e.inputSource === dismissing) dismiss();
      endHold(e.inputSource, true);
    });
  });
  renderer.xr.addEventListener("sessionend", () => {
    cancel();
    closeSheet();
  });
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  onModeChange(() => {
    cancel();
    closeSheet();
    drawer.close();
    select(null);
  });

  // ---- Novice ----

  // Novice: the check, from the pin toast or the drawer. It can't be undone. The pin
  // turning blue is the only feedback.
  function ackLocal(id) {
    const pin = pins.get(id);
    if (!pin?.no || pin.acked) return;
    pin.acked = true;
    acks.set(id, markKey(pin));
    if (send({ t: "ack", id })) play("gotIt", { quiet: true });
    renderDrawer();
    toast.close(id);
  }

  // Expert → novice: a new pin, a changed fix, or r = 1 for a resend after
  // reconnecting (no beam, no toast; a = 1 if we already confirmed it)
  function addRemote({ id, no, p, n, problem, fix = null, value = null, r, a }) {
    const mark = { problem, fix, value };
    if (!validMark(mark) || !Array.isArray(p) || !Array.isArray(n)) return;
    const known = pins.get(id);
    if (known) {
      if (Object.entries(mark).every(([key, val]) => known[key] === val)) return;
      // A changed fix needs confirming again
      Object.assign(known, mark);
      known.acked = false;
      acks.delete(id);
      if (!r) setHidden(false);
      renderDrawer();
      if (!r) {
        play("pin");
        navigator.vibrate?.(40);
        toast.show(known);
      }
      return;
    }
    const pin = addPin(makePin(id, p, n, no, mark), { pulse: !r });
    if (r) {
      // A confirmation sent while the expert was away never arrived: send it again
      if (a) pin.acked = true;
      else if (acks.get(id) === markKey(pin)) {
        pin.acked = true;
        send({ t: "ack", id });
      }
      renderDrawer();
      return;
    }
    setHidden(false);
    renderDrawer();
    const now = performance.now();
    if (!expertGhost.visible) {
      land(pin, now, { notify: true });
      return;
    }
    // A newer shot replaces a beam still in flight; that pin lands now
    if (remotePin && !remotePin.object.visible) land(remotePin, now, { notify: true });
    remotePin = pin;
    pin.landAt = now + REMOTE_BEAM_MS;
    beamState = "remote";
    beam.material.opacity = 1;
  }

  // Expert removed a pin. Unknown ids (already gone) are ignored.
  function removeRemote({ id }) {
    const pin = pins.get(id);
    if (!pin) return;
    const now = performance.now();
    if (remotePin === pin) {
      remotePin = null;
      fadeBeam(now);
    }
    dropPin(pin, now);
    acks.delete(id);
    if (selectedId === id) selectedId = null;
    renderDrawer();
    // Takes the toast slot, which hides the pin toast if it is showing
    showToast("Expert removed a pin", fixText(pin), TOAST_MS);
  }

  // Expert: send every pin again when the novice (re)joins. This is the whole list:
  // the novice clears its pins on the expert's hello (clearRemote) just before.
  function resend() {
    for (const pin of sentPins()) send({ ...pinMessage(pin), r: 1, ...(pin.acked && { a: 1 }) });
  }

  // Novice: the expert (re)connected and is about to resend every pin it still has.
  // Dropping ours first means pins removed while we were away, or left over from
  // before the expert reloaded, never come back.
  function clearRemote() {
    for (const pin of [...pins.values()]) disposePin(pin);
    pins.clear();
    for (const pin of fading) disposePin(pin);
    fading.clear();
    labels.clear();
    toast.close();
    selectedId = null;
    renderDrawer();
    remotePin = null;
    if (beamState === "remote") beamState = "off";
  }

  function updateBeam(cam, now, dt) {
    if (beamState === "aim") {
      cam.updateWorldMatrix(true, false);
      beamFrom.copy(BEAM_ORIGIN).applyMatrix4(cam.matrixWorld);
      if (pinHit) pinHit.head.getWorldPosition(beamTo);
      else if (hit) beamTo.copy(hit.point);
      else beamTo.set(0, 0, -BEAM_MISS).applyMatrix4(cam.matrixWorld);
    } else if (beamState === "remote") {
      expertGhost.getWorldPosition(beamFrom);
      remotePin.object.getWorldPosition(beamTo);
      if (now >= remotePin.landAt) {
        land(remotePin, now, { notify: true });
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

  // grow: extra scale (selected, removing); opacity: dimmed or fading out
  function updatePin(pin, worldPerPx, partScale, now, grow, opacity) {
    // Real size up close; never smaller than MIN_HEAD_PX on screen
    pin.object.getWorldPosition(v);
    const minR = camPos.distanceTo(v) * worldPerPx * MIN_HEAD_PX;
    pin.object.scale.setScalar(Math.max(1, minR / (HEAD_R * partScale)) * grow);
    setPinOpacity(pin, opacity);
    // Billboard the hidden outline: undo its parent's world rotation, then face the camera
    pin.outline.parent.getWorldQuaternion(q);
    pin.outline.quaternion.copy(q.invert().multiply(camQuat));

    const t = (now - pin.pulseAt) / PULSE_MS;
    pin.pulse.visible = t >= 0 && t < 1;
    if (!pin.pulse.visible) return;
    pin.pulse.scale.setScalar(1 + (PULSE_SCALE - 1) * easeOut(t));
    pin.pulse.material.opacity = (1 - t) * opacity;
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
    drawer.setVisible(isNovice() ? isPlaced() : canAim() && !sheet.isOpen());

    aimAtPins(cam);
    if (holding !== null) {
      setHint(pinHit ? `Release to edit pin ${pinHit.no}`
        : hit ? "Release to drop a pin here" : "Aim at the part");
    }
    updateBeam(cam, now, dt);

    // Keep pins out of the translucent placement preview
    group.visible = isPlaced() && !hidden;
    labels.update(cam, group.visible, selectedId);
    if (!group.visible || (pins.size === 0 && fading.size === 0)) return;
    cam.getWorldPosition(camPos);
    cam.getWorldQuaternion(camQuat);
    // World units per screen px at 1 m: from the vertical field of view
    const worldPerPx = 2 / (cam.projectionMatrix.elements[5] * window.innerHeight);
    const partScale = modelPivot.getWorldScale(v).x;
    for (const pin of pins.values()) {
      if (!pin.object.visible) continue;
      const selected = pin.id === selectedId;
      // Drafts, and every pin but the selected one, are dimmed
      const dim = !pin.no || (selectedId && !selected);
      updatePin(pin, worldPerPx, partScale, now, selected ? SELECTED_SCALE : 1, dim ? DIM : 1);
    }
    for (const pin of fading) {
      const t = Math.min(1, (now - pin.removedAt) / REMOVE_MS);
      if (t >= 1) {
        fading.delete(pin);
        disposePin(pin);
        continue;
      }
      updatePin(pin, worldPerPx, partScale, now, 1 - easeOut(t), 1 - t);
    }
  }

  renderDrawer();
  return { update, addRemote, removeRemote, resend, clearRemote, onAck };
}
