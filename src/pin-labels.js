import * as THREE from "three";
import { modelPivot } from "./model.js";

// What a pin can say: a problem, then one of its CAD fixes with a value. Keys go over
// the wire in the pin message (problem, fix, value). "Look here" is a plain pin.
export const PROBLEMS = {
  overhang: { name: "Overhang", fixes: ["chamfer", "rib"] },
  corner: { name: "Sharp corner", fixes: ["fillet"] },
  thin: { name: "Thin wall", fixes: ["thicken"] },
  look: { name: "Look here", fixes: [] },
};
// Chamfer angle is from the horizontal underside: 45° is the steepest overhang that
// prints without support, so shallower angles are left out
export const FIXES = {
  chamfer: { name: "Chamfer", values: [45, 60], value: 45, unit: "°",
    where: "Chamfer this lower edge, angle from horizontal" },
  rib: { name: "Add 45° rib", where: "Add a 45° rib under this face to hold it up" },
  fillet: { name: "Fillet", values: [1, 3, 5], value: 3, unit: " mm",
    where: "Fillet this inside edge to strengthen the joint" },
  // A 0.4 mm nozzle needs about 1.2 mm (3 lines) for a solid wall
  thicken: { name: "Thicken to", values: [1.5, 2, 3], value: 2, unit: " mm",
    where: "Thicken this wall so it prints solid" },
};

// Overhang angle from the surface normal (modelPivot space, +y up when printed):
// 90° for a face pointing straight down, 0° for a vertical wall
export function overhangAngle(n) {
  return Math.round(THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(-n[1], -1, 1))));
}

// A pin's text: { problem, fix, value } (fix and value only for problems with fixes)
export function valueText(fix, value) {
  return `${value}${FIXES[fix].unit}`;
}
export function fixText({ problem, fix, value }) {
  if (!fix) return PROBLEMS[problem].name;
  return FIXES[fix].values ? `${FIXES[fix].name} ${valueText(fix, value)}` : FIXES[fix].name;
}
export function problemText({ problem, n }) {
  const name = PROBLEMS[problem].name;
  return problem === "overhang" ? `${name} · ${overhangAngle(n)}°` : name;
}

// Is this a whole, valid mark (from the wire or the sheet)?
export function validMark({ problem, fix, value }) {
  const pr = PROBLEMS[problem];
  if (!pr) return false;
  if (!pr.fixes.length) return fix == null;
  if (!pr.fixes.includes(fix)) return false;
  return FIXES[fix].values ? FIXES[fix].values.includes(value) : value == null;
}

const NEAR_M = 0.6;   // closer than this, the label opens into a full card
const OFFSET_X = 24;  // px from the pin head to the label's near edge
const ELBOW_X = 12;   // px; the leader turns horizontal here
const RISE = 28;      // px from the pin head up to the label's bottom edge
const ARROW_GAP = 8;  // px between an off-screen label and its arrow
const BEHIND_EPS = 0.003; // m; part hits this close to the head don't hide it

const SVG = "http://www.w3.org/2000/svg";
const ARROW = `<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0 L10 5 L0 10 Z" fill="currentColor"/></svg>`;

function el(tag, className, text) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

// HTML labels for pins, inside #hud (the AR dom-overlay root), placed each frame by
// projecting the pin head to the screen. Flat on the screen, so they always face the
// camera and keep their size. onTap(pin) runs when a label is tapped.
export function createPinLabels(hud, { onTap }) {
  const leaders = document.createElementNS(SVG, "svg");
  leaders.classList.add("pin-leaders");
  leaders.setAttribute("aria-hidden", "true");
  // Labels stay clear of the chips at the top and the controls at the bottom
  const bounds = el("div", "pin-label-bounds");
  Object.assign(bounds.style, { position: "absolute", visibility: "hidden", pointerEvents: "none",
    top: "var(--below-chips)", left: "var(--edge-left)", right: "var(--edge-right)",
    bottom: "calc(var(--edge-bottom) + var(--bottom-clearance, 0px))" });
  hud.prepend(leaders, bounds);

  const labels = new Map(); // pin id → label
  const raycaster = new THREE.Raycaster();
  const camPos = new THREE.Vector3();
  const head = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let partMeshes = null;

  function add(pin) {
    const root = el("div", "pin-label");
    const chip = el("div", "pin-label-chip");
    const card = el("div", "pin-label-card");
    const problem = el("div", "pin-label-problem");
    const fix = el("div", "pin-label-fix");
    const where = el("div", "pin-label-where");
    card.append(problem, fix, where);
    root.append(chip, card);
    root.hidden = true;
    // A tap on a label must never fire the laser
    root.addEventListener("beforexrselect", (e) => e.preventDefault());
    root.addEventListener("click", () => onTap(pin));
    const arrow = el("div", "pin-label-arrow");
    arrow.innerHTML = ARROW;
    arrow.hidden = true;
    const leader = document.createElementNS(SVG, "polyline");
    leader.classList.add("pin-leader");
    leaders.appendChild(leader);
    hud.insertBefore(root, bounds.nextSibling);
    hud.insertBefore(arrow, root.nextSibling);
    const label = { pin, root, chip, problem, fix, where, arrow, leader, expanded: false, key: "" };
    labels.set(pin.id, label);
  }

  // What the label shows: the pin, or the sheet's edit while the expert picks
  // (pin.edit; null at step 1 of a new pin, which shows the draft chip)
  const shown = (pin) => (pin.edit !== undefined ? pin.edit : pin);
  const textKey = (pin) => {
    const m = shown(pin);
    return m ? `${pin.no}|${m.problem}|${m.fix}|${m.value}` : `${pin.no}|draft`;
  };

  function setText(label) {
    const { pin } = label;
    label.key = textKey(pin);
    const m = shown(pin);
    if (!m) {
      label.chip.textContent = "Draft · not sent";
      return;
    }
    const mark = { ...m, n: pin.n };
    const no = pin.no ? `${pin.no} · ` : "";
    label.chip.textContent = no + fixText(mark);
    label.problem.textContent = no + problemText(mark);
    label.fix.textContent = fixText(mark);
    label.where.textContent = m.fix ? FIXES[m.fix].where : "";
    label.where.hidden = !m.fix;
  }

  function remove(id) {
    const label = labels.get(id);
    if (!label) return;
    label.root.remove();
    label.arrow.remove();
    label.leader.remove();
    labels.delete(id);
  }

  function clear() {
    for (const id of [...labels.keys()]) remove(id);
  }

  // Tapping a label opens or closes its card, whatever the distance
  function toggle(id) {
    const label = labels.get(id);
    if (label) label.expanded = !label.expanded;
  }

  // Is the part between the camera and this point?
  function behindPart(point, dist) {
    partMeshes ??= modelPivot.children.filter((o) => o.isMesh);
    dir.subVectors(point, camPos).normalize();
    raycaster.set(camPos, dir);
    raycaster.far = dist - BEHIND_EPS;
    return raycaster.intersectObjects(partMeshes, false).length > 0;
  }

  // Once per frame. show = the part is placed; selectedId dims every other label.
  function update(cam, show, selectedId) {
    cam.getWorldPosition(camPos);
    const box = bounds.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const placed = [];

    // Pass 1: state and classes (writes only)
    for (const label of labels.values()) {
      const { pin } = label;
      if (label.key !== textKey(pin)) setText(label);
      const visible = show && (!!pin.problem || pin.edit !== undefined) && pin.object.visible;
      label.root.hidden = !visible;
      if (!visible) {
        label.arrow.hidden = true;
        label.leader.setAttribute("visibility", "hidden");
        continue;
      }
      pin.head.getWorldPosition(head);
      const dist = camPos.distanceTo(head);
      ndc.copy(head).project(cam);
      // In front of the camera the projected depth is below 1
      const behindCam = ndc.z > 1;
      const x = (ndc.x + 1) / 2 * w;
      const y = (1 - ndc.y) / 2 * h;
      // Off screen = outside the viewport; the bounds only say where to clamp to
      const off = behindCam || x < 0 || x > w || y < 0 || y > h;
      const selected = pin.id === selectedId;
      const behind = !off && behindPart(head, dist);
      const dim = !!selectedId && !selected;
      // While editing: a dark draft chip, then a dashed live preview card
      const editing = pin.edit !== undefined;
      label.root.classList.toggle("is-draft", editing && !pin.edit);
      label.root.classList.toggle("is-preview", editing && !!pin.edit);
      label.root.classList.toggle("is-card",
        !off && (editing ? !!pin.edit : label.expanded || selected || dist <= NEAR_M));
      label.root.classList.toggle("is-behind", behind);
      label.root.classList.toggle("is-dim", dim);
      label.leader.classList.toggle("is-behind", behind);
      label.leader.classList.toggle("is-dim", dim);
      placed.push({ label, x, y, off, behindCam });
    }

    // Pass 2: sizes (reads only), then positions (writes only)
    for (const p of placed) {
      p.lw = p.label.root.offsetWidth;
      p.lh = p.label.root.offsetHeight;
    }
    for (const { label, x, y, off, behindCam, lw, lh } of placed) {
      if (off) placeOffscreen(label, x, y, behindCam, lw, lh, box);
      else placeBeside(label, x, y, lw, lh, box);
    }
  }

  // Up and to the right of the head (left if it would run off screen), with an elbow
  // leader from the head to the label's nearest bottom corner
  function placeBeside(label, x, y, lw, lh, box) {
    const side = x + OFFSET_X + lw > box.right ? -1 : 1;
    const top = Math.max(box.top, y - RISE - lh);
    const left = side > 0 ? x + OFFSET_X : x - OFFSET_X - lw;
    const cornerY = top + lh;
    label.root.style.transform = `translate(${left}px, ${top}px)`;
    label.arrow.hidden = true;
    label.leader.setAttribute("points",
      `${x},${y} ${x + side * ELBOW_X},${cornerY} ${x + side * OFFSET_X},${cornerY}`);
    label.leader.setAttribute("visibility", "visible");
  }

  // Clamped to the edge of the safe area, on the line from the screen centre toward
  // the pin, with an arrow on the side facing it
  function placeOffscreen(label, x, y, behindCam, lw, lh, box) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    // Behind the camera the projection is mirrored through the centre
    let dx = behindCam ? cx - x : x - cx;
    let dy = behindCam ? cy - y : y - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const halfW = Math.max(0, (box.right - box.left) / 2 - lw / 2 - ARROW_GAP - 5);
    const halfH = Math.max(0, (box.bottom - box.top) / 2 - lh / 2 - ARROW_GAP - 5);
    const t = Math.min(dx ? halfW / Math.abs(dx) : Infinity, dy ? halfH / Math.abs(dy) : Infinity);
    const lx = cx + dx * t;
    const ly = cy + dy * t;
    label.root.style.transform = `translate(${lx - lw / 2}px, ${ly - lh / 2}px)`;
    // Arrow just outside the label's border, along the same line
    const s = Math.min(dx ? lw / 2 / Math.abs(dx) : Infinity, dy ? lh / 2 / Math.abs(dy) : Infinity) + ARROW_GAP;
    label.arrow.style.transform =
      `translate(${lx + dx * s}px, ${ly + dy * s}px) rotate(${Math.atan2(dy, dx)}rad)`;
    label.arrow.hidden = false;
    label.leader.setAttribute("visibility", "hidden");
  }

  return { add, remove, clear, toggle, update };
}
