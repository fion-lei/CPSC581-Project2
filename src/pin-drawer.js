import { PROBLEMS, FIXES, fixText, valueText, CHECK_BADGE } from "./pin-labels.js";
import { layoutBottom, hideToast, setToolsHidden } from "./hud.js";

// Inline icons: 2 px stroke, round caps (docs/DESIGN.md)
export const icon = (path) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
// Thumbtack (Lucide "pin", ISC licence)
const PIN_ICON = icon("<path d='M12 17v5'/><path d='M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'/>");
const CLOSE_ICON = icon("<path d='M6 6l12 12M18 6L6 18'/>");
const TRASH_ICON = icon("<path d='M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'/>");
export const CHECK_ICON = icon("<path d='M5 12.5l4.5 4.5L19 7.5'/>");
// Waiting for the novice: an empty ring the size of the check badge
const WAIT_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="8" cy="8" r="6"/></svg>`;

function el(tag, className, text) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

function button(className, text) {
  const b = el("button", className, text);
  b.type = "button";
  return b;
}

// HUD controls catch their own touches: no laser, no debug "D" toggle
function shield(e) {
  e.addEventListener("beforexrselect", (ev) => ev.preventDefault());
  e.addEventListener("keydown", (ev) => ev.stopPropagation());
}

// A tab on the right edge opens a drawer listing every pin. Selecting a row highlights
// its pin in the scene. Each row shows whether the novice confirmed it (blue check).
// Expert (Pin mode): the trash icon removes a pin. Novice: no removing; a waiting
// pin has a check button instead. isNovice() is read on each render: the role is
// only known once in a room.
export function createPinDrawer(hud, { isNovice, onSelect, onRemove, onRemoveAll, onAck, onOpen, onClose }) {
  const tab = button("btn pin-tab");
  tab.innerHTML = PIN_ICON;
  // Expert: new confirmations; novice: pins still waiting to be confirmed
  const dot = el("span", "pin-tab-dot");
  dot.hidden = true;
  tab.appendChild(dot);

  const drawer = el("div", "pin-drawer");
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-label", "Pins");
  const head = el("div", "pin-drawer-head");
  const title = el("div", "field-label");
  const close = button("btn pin-icon-button");
  close.setAttribute("aria-label", "Close pins");
  close.innerHTML = CLOSE_ICON;
  head.append(title, close);
  const rows = el("ul", "pin-rows");
  const empty = el("p", "pin-empty", "No pins yet");
  const removeAll = button("pin-remove-all", "Remove all");
  drawer.append(head, rows, empty, removeAll);

  for (const e of [tab, drawer]) shield(e);
  tab.hidden = drawer.hidden = true;
  hud.append(tab, drawer);

  let visible = false; // Pin mode and the tools are showing
  let open = false;

  function setOpen(on) {
    open = on;
    apply();
    if (on && visible) onOpen?.();
  }

  function apply() {
    tab.hidden = !visible || open;
    drawer.hidden = !visible || !open;
    hud.classList.toggle("has-pin-drawer", !drawer.hidden);
  }

  // Closed by its ×, or by a tap outside it (pins.js)
  function dismiss() {
    open = false;
    apply();
    onClose();
  }

  tab.addEventListener("click", () => setOpen(true));
  close.addEventListener("click", dismiss);
  removeAll.addEventListener("click", onRemoveAll);

  // pins: sent pins in placement order; selectedId: the highlighted one, or null
  function render(pins, selectedId) {
    const novice = isNovice();
    // The dot is in the colour of whoever is waiting on you: the expert's pins
    // (orange, novice tab) or the novice's confirmations (blue, expert tab)
    dot.classList.toggle("is-new-pin", novice);
    tab.setAttribute("aria-label", `Pins (${pins.length})`);
    title.textContent = `Pins · ${pins.length}`;
    empty.hidden = pins.length > 0;
    removeAll.hidden = novice || pins.length === 0;
    rows.replaceChildren(...pins.map((pin) => {
      const selected = pin.id === selectedId;
      const row = el("li", `pin-row${selected ? " is-selected" : ""}`);
      const main = button("pin-row-main");
      main.setAttribute("aria-pressed", String(selected));
      const text = el("span", "pin-row-text");
      text.appendChild(el("div", "pin-row-fix", fixText(pin)));
      // A plain "Look here" pin has no separate problem line
      if (pin.fix) text.appendChild(el("div", "pin-row-problem", PROBLEMS[pin.problem].name));
      main.append(el("span", "pin-badge", String(pin.no)), text);
      main.addEventListener("click", () => onSelect(pin.id));
      row.appendChild(main);
      if (novice) {
        if (!pin.acked) {
          const confirm = button("pin-row-confirm");
          confirm.setAttribute("aria-label", `Confirm pin ${pin.no}`);
          confirm.innerHTML = WAIT_ICON;
          confirm.addEventListener("click", () => onAck(pin.id));
          row.appendChild(confirm);
        } else {
          const status = el("span", "pin-row-confirm is-confirmed");
          status.setAttribute("role", "img");
          status.setAttribute("aria-label", "Confirmed by the novice");
          status.innerHTML = CHECK_BADGE;
          row.appendChild(status);
        }
        return row;
      }
      const status = el("span", `pin-row-status${pin.acked ? " is-acked" : ""}`);
      status.setAttribute("role", "img");
      status.setAttribute("aria-label", pin.acked ? "Confirmed by the novice" : "Waiting for the novice");
      status.innerHTML = pin.acked ? CHECK_BADGE : WAIT_ICON;
      row.appendChild(status);
      if (novice) return row;
      const remove = button("pin-row-remove");
      remove.setAttribute("aria-label", `Remove pin ${pin.no}`);
      remove.innerHTML = TRASH_ICON;
      remove.addEventListener("click", () => onRemove(pin.id));
      row.append(remove);
      return row;
    }));
  }

  return {
    render,
    setVisible(on) {
      if (on === visible) return;
      visible = on;
      apply();
    },
    setDot(on) { dot.hidden = !on; },
    openDrawer() { setOpen(true); },
    close() { open = false; apply(); },
    dismiss,
    isOpen: () => visible && open,
  };
}

// Expert: two steps after releasing on the part or on a pin. 1: the problem (the
// suggested one preselected); 2: the fix and its value, then Send pin. Takes the mode
// bar's slot until it closes.
export function createPinSheet(hud) {
  const sheet = el("div", "pin-sheet bottom-bar");
  sheet.setAttribute("role", "dialog");
  const head = el("div", "pin-sheet-head");
  const back = button("pin-sheet-back");
  const title = el("div", "pin-sheet-title");
  const step = el("div", "pin-sheet-step");
  const close = button("pin-sheet-close");
  close.setAttribute("aria-label", "Cancel pin");
  close.innerHTML = CLOSE_ICON;
  head.append(back, title, step, close);
  const body = el("div", "pin-sheet-body");
  const foot = el("div", "pin-sheet-foot");
  const remove = button("btn is-destructive");
  remove.innerHTML = TRASH_ICON;
  remove.append("Remove pin");
  const next = button("btn is-expert");
  foot.append(remove, next);
  sheet.append(el("div", "pin-sheet-handle"), head, body, foot);
  shield(sheet);
  sheet.hidden = true;
  hud.appendChild(sheet);

  let pin = null;
  let handlers = null; // { onChange(mark|null), onSend(mark), onRemove(), onCancel() }
  let stepNo = 1;
  let mark = { problem: null, fix: null, value: null };
  let suggested = null; // { problem, note }

  back.addEventListener("click", () => go(1));
  close.addEventListener("click", () => handlers?.onCancel());
  remove.addEventListener("click", () => handlers?.onRemove());
  next.addEventListener("click", () => {
    if (stepNo === 1 && PROBLEMS[mark.problem].fixes.length) go(2);
    else handlers?.onSend({ ...mark });
  });

  // A problem with its first fix at that fix's default value
  function markFor(problem) {
    const fix = PROBLEMS[problem].fixes[0] ?? null;
    return { problem, fix, value: fix ? FIXES[fix].value ?? null : null };
  }

  function setProblem(problem) {
    if (problem !== mark.problem) mark = markFor(problem);
    render();
  }

  function setFix(fix, value = FIXES[fix].value ?? null) {
    mark = { ...mark, fix, value };
    render();
  }

  function go(n) {
    stepNo = n;
    render();
  }

  function choice(text, selected, onClick) {
    const b = button(`pin-choice${selected ? " is-selected" : ""}`);
    b.setAttribute("aria-pressed", String(selected));
    b.append(el("span", "pin-choice-name", text));
    b.addEventListener("click", onClick);
    return b;
  }

  function render() {
    const existing = !!pin.no;
    const plain = mark.problem && !PROBLEMS[mark.problem].fixes.length;
    back.hidden = stepNo !== 2;
    back.textContent = `‹ ${mark.problem ? PROBLEMS[mark.problem].name : ""}`;
    title.textContent = stepNo === 1 ? "What's the problem?" : "Which fix?";
    step.textContent = `${stepNo} / 2`;
    sheet.setAttribute("aria-label", title.textContent);

    if (stepNo === 1) {
      const grid = el("div", "pin-sheet-grid");
      for (const [k, pr] of Object.entries(PROBLEMS)) {
        const b = choice(pr.name, k === mark.problem, () => setProblem(k));
        if (k === suggested?.problem) b.append(el("span", "pin-choice-note", suggested.note));
        grid.appendChild(b);
      }
      body.replaceChildren(grid);
    } else {
      const list = el("div", "pin-sheet-list");
      for (const fix of PROBLEMS[mark.problem].fixes) {
        const f = FIXES[fix];
        const selected = fix === mark.fix;
        const row = el("div", `pin-choice pin-fix${selected ? " is-selected" : ""}`);
        // Tapping the chosen fix again keeps its value
        const name = choice(f.name, selected, () => { if (!selected) setFix(fix); });
        name.className = "pin-fix-name";
        row.appendChild(name);
        if (selected && f.values) {
          const seg = el("div", "segmented pin-values");
          seg.setAttribute("aria-label", `${f.name} value`);
          for (const value of f.values) {
            const sb = button(`segment${value === mark.value ? " is-expert" : ""}`, valueText(fix, value));
            sb.setAttribute("aria-pressed", String(value === mark.value));
            sb.addEventListener("click", () => setFix(fix, value));
            seg.appendChild(sb);
          }
          row.appendChild(seg);
        }
        list.appendChild(row);
      }
      body.replaceChildren(list);
    }

    // Step 1: [Remove pin] Next; step 2: Send pin. A plain pin sends from step 1.
    // Cancel is the × in the header, or a tap outside the sheet (pins.js).
    const sends = stepNo === 2 || plain;
    remove.hidden = !existing || stepNo !== 1;
    next.textContent = sends ? (existing ? "Update pin" : "Send pin") : "Next";
    next.disabled = !mark.problem;
    // The label previews the mark from step 2 on (or at once for a pin already sent)
    handlers?.onChange(stepNo === 2 || existing ? { ...mark } : null);
    layoutBottom();
  }

  return {
    // forPin: the pin; current: its mark if it has one; hint: suggested problem or null
    open(forPin, { current = null, hint = null, ...h }) {
      pin = forPin;
      handlers = h;
      suggested = hint;
      stepNo = 1;
      mark = current ? { ...current }
        : hint ? markFor(hint.problem) : { problem: null, fix: null, value: null };
      hideToast();
      sheet.hidden = false;
      setToolsHidden(true);
      render();
    },
    close() {
      pin = handlers = null;
      sheet.hidden = true;
      setToolsHidden(false);
      layoutBottom();
    },
    isOpen: () => handlers !== null,
  };
}
