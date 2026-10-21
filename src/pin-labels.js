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
const CROWD_PX = 64;      // heads closer than this on screen crowd each other
const CROWD_EXIT_PX = 80; // ...and stay crowded until this far apart, so nothing flickers
const STACK_GAP = 6;      // px between stacked labels
const EASE = 0.3;         // per frame, toward a label's new spot
const MERGE_ROUNDS = 3;   // columns that overlap are merged at most this often

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

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
    const label = { pin, root, chip, problem, fix, where, arrow, leader,
      expanded: false, key: "", crowded: false, pos: null };
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
    const entries = [];

    // Pass 1: project each head, set state classes (writes only)
    for (const label of labels.values()) {
      const { pin } = label;
      if (label.key !== textKey(pin)) setText(label);
      const visible = show && (!!pin.problem || pin.edit !== undefined) && pin.object.visible;
      label.root.hidden = !visible;
      if (!visible) {
        label.arrow.hidden = true;
        label.leader.setAttribute("visibility", "hidden");
        label.pos = null;
        label.crowded = false;
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
      label.root.classList.toggle("is-behind", behind);
      label.root.classList.toggle("is-dim", dim);
      label.leader.classList.toggle("is-behind", behind);
      label.leader.classList.toggle("is-dim", dim);
      entries.push({ label, x, y, dist, off, behindCam, selected, editing });
    }

    // Heads close together on screen crowd each other: their labels collapse to chips
    // and stack (below)
    const onScreen = entries.filter((e) => !e.off);
    const offScreen = entries.filter((e) => e.off);
    const clusters = clusterHeads(onScreen);
    for (const cluster of clusters) {
      for (const e of cluster) e.label.crowded = cluster.length > 1;
    }
    for (const e of offScreen) e.label.crowded = false;

    // Chip or card. In a crowd only the edited, selected or tapped label stays a card.
    for (const e of entries) {
      const { label } = e;
      label.root.classList.toggle("is-card", !e.off && (e.editing ? !!label.pin.edit
        : label.expanded || e.selected || (!label.crowded && e.dist <= NEAR_M)));
    }

    // Pass 2: sizes (reads only), then positions (writes only)
    for (const e of entries) {
      e.lw = e.label.root.offsetWidth;
      e.lh = e.label.root.offsetHeight;
    }
    layoutStacks(clusters, box);
    layoutOffscreen(offScreen, box);
    const snap = reducedMotion.matches;
    for (const e of onScreen) drawBeside(e, snap);
    for (const e of offScreen) drawOffscreen(e, snap);
  }

  // Single-link groups of heads closer than CROWD_PX on screen. A pair that is already
  // crowded stays linked until CROWD_EXIT_PX, so labels don't flicker at the edge.
  function clusterHeads(entries) {
    const parent = entries.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const limit = a.label.crowded && b.label.crowded ? CROWD_EXIT_PX : CROWD_PX;
        if (Math.hypot(a.x - b.x, a.y - b.y) < limit) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    entries.forEach((e, i) => {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(e);
    });
    return [...groups.values()];
  }

  // Each cluster becomes a column of labels beside it (one label: today's spot).
  // Columns that still overlap each other are merged into one and laid out again.
  function layoutStacks(clusters, box) {
    let groups = clusters;
    for (let round = 0; round <= MERGE_ROUNDS; round++) {
      const rects = groups.map((g) => placeColumn(g, box));
      const pair = round < MERGE_ROUNDS && overlappingPair(rects);
      if (!pair) return;
      const [i, j] = pair;
      groups = groups.filter((_, k) => k !== i && k !== j).concat([groups[i].concat(groups[j])]);
    }
  }

  function overlappingPair(rects) {
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        if (rects[i].some((a) => rects[j].some((b) => a.l < b.r + STACK_GAP && b.l < a.r + STACK_GAP
          && a.t < b.b + STACK_GAP && b.t < a.b + STACK_GAP))) return [i, j];
      }
    }
    return null;
  }

  // Ordered by head height so leaders don't cross. Too tall for the screen: the
  // second half goes in a column on the other side. Returns the column rectangles.
  function placeColumn(group, box) {
    const sorted = [...group].sort((a, b) => a.y - b.y);
    const height = sorted.reduce((sum, e) => sum + e.lh + STACK_GAP, -STACK_GAP);
    if (sorted.length > 1 && height > box.bottom - box.top) {
      const half = Math.ceil(sorted.length / 2);
      return [stack(sorted.slice(0, half), box, 1), stack(sorted.slice(half), box, -1)];
    }
    return [stack(sorted, box, 0)];
  }

  // One column: right of the rightmost head (left of the leftmost if it won't fit),
  // labels lined up on the column edge, each as high as its head allows, STACK_GAP apart
  function stack(list, box, forceSide) {
    const maxX = Math.max(...list.map((e) => e.x));
    const minX = Math.min(...list.map((e) => e.x));
    const widest = Math.max(...list.map((e) => e.lw));
    const side = forceSide || (maxX + OFFSET_X + widest > box.right ? -1 : 1);
    const edge = side > 0 ? maxX + OFFSET_X : minX - OFFSET_X;
    let bottom = -Infinity;
    for (const e of list) {
      e.top = Math.max(e.y - RISE - e.lh, bottom + STACK_GAP);
      bottom = e.top + e.lh;
    }
    // Keep the column on screen: up if it runs off the bottom, then down to the top
    const shift = Math.max(Math.min(0, box.bottom - bottom), box.top - list[0].top);
    for (const e of list) {
      e.top += shift;
      e.side = side;
      e.left = side > 0 ? edge : edge - e.lw;
    }
    return {
      l: side > 0 ? edge : edge - widest, r: side > 0 ? edge + widest : edge,
      t: list[0].top, b: bottom + shift,
    };
  }

  // Ease toward the target spot; snap when just shown or with reduced motion
  function moveTo(label, x, y, snap) {
    if (!label.pos || snap) label.pos = { x, y };
    else {
      label.pos.x += (x - label.pos.x) * EASE;
      label.pos.y += (y - label.pos.y) * EASE;
    }
    label.root.style.transform = `translate(${label.pos.x}px, ${label.pos.y}px)`;
    return label.pos;
  }

  // Elbow leader from the head to the label's near bottom corner, which sits on the
  // column edge
  function drawBeside({ label, x, y, side, left, top, lw, lh }, snap) {
    const pos = moveTo(label, left, top, snap);
    const cornerY = pos.y + lh;
    const cornerX = side > 0 ? pos.x : pos.x + lw;
    label.arrow.hidden = true;
    label.leader.setAttribute("points",
      `${x},${y} ${x + side * ELBOW_X},${cornerY} ${cornerX},${cornerY}`);
    label.leader.setAttribute("visibility", "visible");
  }

  // Off-screen chips: clamped to the edge of the safe area on the line from the screen
  // centre toward the pin, then spread along that edge so they don't pile up
  function layoutOffscreen(list, box) {
    const cx = (box.left + box.right) / 2;
    const cy = (box.top + box.bottom) / 2;
    const edges = { left: [], right: [], top: [], bottom: [] };
    for (const e of list) {
      // Behind the camera the projection is mirrored through the centre
      let dx = e.behindCam ? cx - e.x : e.x - cx;
      let dy = e.behindCam ? cy - e.y : e.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const halfW = Math.max(0, (box.right - box.left) / 2 - e.lw / 2 - ARROW_GAP - 5);
      const halfH = Math.max(0, (box.bottom - box.top) / 2 - e.lh / 2 - ARROW_GAP - 5);
      const tx = dx ? halfW / Math.abs(dx) : Infinity;
      const ty = dy ? halfH / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty);
      Object.assign(e, { dx, dy, cx: cx + dx * t, cy: cy + dy * t });
      if (tx <= ty) edges[dx < 0 ? "left" : "right"].push(e);
      else edges[dy < 0 ? "top" : "bottom"].push(e);
    }
    const lo = (size) => ARROW_GAP + 5 + size / 2;
    spread(edges.left, "cy", "lh", box.top, box.bottom, lo);
    spread(edges.right, "cy", "lh", box.top, box.bottom, lo);
    spread(edges.top, "cx", "lw", box.left, box.right, lo);
    spread(edges.bottom, "cx", "lw", box.left, box.right, lo);
  }

  // 1-D version of the column sweep, along one screen edge
  function spread(list, axis, size, min, max, margin) {
    if (!list || list.length < 2) return;
    list.sort((a, b) => a[axis] - b[axis]);
    let end = -Infinity;
    for (const e of list) {
      e[axis] = Math.max(e[axis], end + STACK_GAP + e[size] / 2);
      end = e[axis] + e[size] / 2;
    }
    // Back inside the edge's range: up/left if the last runs past it, then down/right
    const last = list[list.length - 1];
    const over = last[axis] - (max - margin(last[size]));
    if (over > 0) for (const e of list) e[axis] -= over;
    const under = min + margin(list[0][size]) - list[0][axis];
    if (under > 0) for (const e of list) e[axis] += under;
  }

  function drawOffscreen({ label, dx, dy, cx, cy, lw, lh }, snap) {
    const pos = moveTo(label, cx - lw / 2, cy - lh / 2, snap);
    // Arrow just outside the label's border, on the side facing the pin
    const lx = pos.x + lw / 2;
    const ly = pos.y + lh / 2;
    const s = Math.min(dx ? lw / 2 / Math.abs(dx) : Infinity, dy ? lh / 2 / Math.abs(dy) : Infinity) + ARROW_GAP;
    label.arrow.style.transform =
      `translate(${lx + dx * s}px, ${ly + dy * s}px) rotate(${Math.atan2(dy, dx)}rad)`;
    label.arrow.hidden = false;
    label.leader.setAttribute("visibility", "hidden");
  }

  return { add, remove, clear, toggle, update };
}
