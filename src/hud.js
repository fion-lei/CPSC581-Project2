import { ROOM_IN_USE } from "./net.js";
import { TOOL_MODES, setMode, onModeChange } from "./expert-tools.js";

const STORE_KEY = "ghostlens.join";
const TITLES = { expert: "Start a session", novice: "Join a session" };

let net = null;     // { connect, disconnect }
let joined = null;  // { role, code } once in a room
let state = "disconnected";
let detail = "";
let peerRole = null;

// Role chip, top-left after the start screen
let chip = null;
let chipDot = null;
let chipText = null;
let connectionChip = null;
let callChip = null;
let onCall = false;
let inScene = false;
let toolbar = null;
let crosshair = null;
let aimReady = false;
let aimHit = false;
let hudRoot = null;
// Start screen status chip and Enter AR button, or null once it's gone
let screenStatus = null;
let enterButton = null;
// Start screen: gives the expert a fresh code when theirs is taken, or null
let onRoomInUse = null;

const label = (role) => role[0].toUpperCase() + role.slice(1);
const validCode = (code) => /^\d{4}$/.test(code);
const randomCode = () => String(Math.floor(Math.random() * 10000)).padStart(4, "0");

function loadLast() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}

function saveLast(role, code) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ role, code })); } catch { /* private mode */ }
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

function makeStatusChip(className) {
  const c = el("div", `chip ${className}`);
  const dot = el("span", "chip-dot");
  const text = el("span", "chip-text");
  c.append(dot, text);
  return { c, dot, text };
}

// Join (or switch to) a room; null leaves the current one
function join(role, code) {
  if (joined && role && joined.role === role && joined.code === code) return;
  if (joined) net.disconnect();
  joined = role ? { role, code } : null;
  peerRole = null;
  onCall = false;
  setMode("view");
  if (joined) net.connect(role, code);
  render();
}

function render() {
  if (chip && joined) {
    chipDot.className = `chip-dot is-${joined.role}`;
    chipText.textContent = [label(joined.role), joined.code].join(" · ");
    connectionChip.dot.className = `chip-dot is-${state}`;
    connectionChip.text.textContent = detail || state;
    connectionChip.c.title = `Connection: ${detail || state}`;
    callChip.textContent = onCall ? "On call" : "Not on call";
    callChip.setAttribute("aria-pressed", String(onCall));
  }
  renderTools();
  if (!screenStatus) return;

  // "Connected · expert", or "Waiting for novice…" while connecting
  screenStatus.c.hidden = !joined;
  screenStatus.dot.className = `chip-dot is-${state}`;
  screenStatus.text.textContent = state === "connected"
    ? ["Connected", peerRole].filter(Boolean).join(" · ")
    : (detail || state) + (state === "connecting" || state === "waiting" ? "…" : "");

  // The expert can go in once the room is open and wait there for the novice;
  // the novice needs the expert connected first
  const ready = state === "connected" || (state === "waiting" && joined?.role === "expert");
  enterButton.disabled = !ready;
  enterButton.classList.toggle("is-expert", ready && joined.role === "expert");
  enterButton.classList.toggle("is-novice", ready && joined.role === "novice");
}

function renderTools() {
  if (!toolbar) return;
  const visible = inScene && joined?.role === "expert" && aimReady;
  toolbar.hidden = crosshair.hidden = !visible;
  hudRoot.classList.toggle("has-expert-tools", visible);
}

function makeExpertTools(hud) {
  toolbar = el("div", "expert-toolbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Expert tools");
  const buttons = TOOL_MODES.map((mode) => {
    const button = el("button", "btn expert-tool", label(mode));
    button.type = "button";
    button.dataset.mode = mode;
    button.addEventListener("click", () => setMode(mode));
    toolbar.appendChild(button);
    return button;
  });
  onModeChange((mode) => {
    for (const button of buttons) {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  });
  toolbar.addEventListener("beforexrselect", (e) => e.preventDefault());
  toolbar.addEventListener("keydown", (e) => e.stopPropagation());
  crosshair = el("div", "crosshair expert-crosshair");
  crosshair.setAttribute("aria-hidden", "true");
  toolbar.hidden = crosshair.hidden = true;
  hud.append(toolbar, crosshair);
}

// Called each frame with placement/tracking readiness and the centre-ray hit.
export function setCrosshair(ready, hit) {
  if (!crosshair) return;
  if (ready !== aimReady) {
    aimReady = ready;
    renderTools();
  }
  const nextHit = ready && !!hit;
  if (nextHit !== aimHit) {
    aimHit = nextHit;
    crosshair.classList.toggle("is-hit", nextHit);
  }
}

// Full-screen role + room code picker. Joins the room right away. Enter AR unlocks for
// the expert once their room is open, for the novice once connected to the expert.
// Covers the AR button until then.
function makeStartScreen(hud, onEnter, arSupported) {
  const last = loadLast();
  // The expert opens the room; keep their last code so a reload rejoins it
  let expertCode = last.role === "expert" && validCode(last.code) ? last.code : randomCode();

  const screen = el("div", "start-screen");
  const top = el("div", "start-top");
  const bottom = el("div", "start-bottom");

  const title = el("h1", "start-title", "Start or join a session");
  const segmented = el("div", "segmented");
  const codeField = el("div", "start-field");
  const codeLabel = el("div", "field-label");

  // Expert: the code, read-only, one box per digit
  const digits = el("div", "code-digits");
  const help = el("p", "start-help", "Read this code to the novice over the call");
  // Novice: type it in
  const input = el("input", "code-input");
  Object.assign(input, { inputMode: "numeric", maxLength: 4, placeholder: "0000",
    autocomplete: "off", ariaLabel: "Room code" });

  codeField.append(codeLabel, digits, help, input);
  codeField.hidden = true;

  const roleButtons = {};
  for (const r of ["expert", "novice"]) {
    const b = el("button", "segment", label(r));
    b.addEventListener("click", () => pick(r));
    roleButtons[r] = b;
    segmented.appendChild(b);
  }

  function pick(role) {
    for (const [r, b] of Object.entries(roleButtons)) b.classList.toggle(`is-${r}`, r === role);
    title.textContent = TITLES[role];
    codeField.hidden = false;
    codeLabel.textContent = role === "expert" ? "Room code" : "Enter room code";
    digits.hidden = help.hidden = role !== "expert";
    input.hidden = role !== "novice";

    if (role === "expert") {
      digits.replaceChildren(...[...expertCode].map((d) => el("span", "code-digit", d)));
      join("expert", expertCode);
    } else {
      if (!input.value && last.role === "novice" && validCode(last.code)) input.value = last.code;
      typed();
      input.focus();
    }
  }

  function typed() {
    input.value = input.value.replace(/\D/g, "").slice(0, 4);
    join(validCode(input.value) ? "novice" : null, input.value);
  }

  // Someone else hosts this code (or a closed tab still holds it): switch to a new one
  // rather than retry forever. The new code is shown before anyone has read it out.
  onRoomInUse = () => {
    const taken = expertCode;
    while (expertCode === taken) expertCode = randomCode();
    pick("expert");
  };

  input.addEventListener("input", typed);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !enterButton.disabled) enterButton.click(); });

  screenStatus = makeStatusChip("start-status");
  const enter = el("button", "btn start-enter", "Enter AR");
  enterButton = enter;
  // Desktop and phones without AR still get in, to the non-AR view
  arSupported.then((ok) => { if (!ok) enter.textContent = "Continue without AR"; });
  enter.addEventListener("click", () => {
    saveLast(joined.role, joined.code);
    screen.remove();
    screenStatus = enterButton = onRoomInUse = null;
    inScene = true;
    chip.hidden = false;
    render();
    onEnter();
  });

  top.append(el("div", "field-label", "Ghost Lens"), title,
    el("div", "field-label", "I am the"), segmented, codeField);
  bottom.append(screenStatus.c, enterButton);
  screen.append(top, bottom);
  hud.appendChild(screen);
  render();
}

// Start screen, then onEnter() from its Enter AR button.
// ?role=expert&room=1234 skips the screen and joins straight away.
export function initHud({ connect, disconnect, onEnter, arSupported }) {
  net = { connect, disconnect };
  const hud = document.getElementById("hud");
  hudRoot = hud;
  chip = el("div", "session-status");
  const roleChip = makeStatusChip("session-role");
  chipDot = roleChip.dot;
  chipText = roleChip.text;
  connectionChip = makeStatusChip("session-connection");
  connectionChip.text.setAttribute("role", "status");
  callChip = el("button", "chip call-chip", "Not on call");
  callChip.type = "button";
  callChip.title = "Mark whether your separate voice call is active";
  callChip.setAttribute("aria-label", "External voice call active (manual status)");
  callChip.setAttribute("aria-pressed", "false");
  callChip.addEventListener("click", () => { onCall = !onCall; render(); });
  chip.addEventListener("beforexrselect", (e) => e.preventDefault());
  chip.append(roleChip.c, connectionChip.c, callChip);
  chip.hidden = true;
  hud.appendChild(chip);
  // Keep the debug readout below the chips even when they wrap on a phone.
  new ResizeObserver(([entry]) => {
    hud.style.setProperty("--session-status-height", `${entry.contentRect.height}px`);
  }).observe(chip);
  makeExpertTools(hud);

  const params = new URLSearchParams(location.search);
  const role = params.get("role");
  const code = params.get("room") ?? "";
  if ((role === "expert" || role === "novice") && validCode(code)) {
    inScene = true;
    chip.hidden = false;
    join(role, code);
  } else makeStartScreen(hud, onEnter, arSupported);
}

// Connection state from net.js, displayed separately from role and voice-call status.
export function setStatus(s, d = "") {
  state = s;
  detail = d;
  if (s !== "connected") peerRole = null;
  render();
  if (d === ROOM_IN_USE && joined?.role === "expert") onRoomInUse?.();
}

// Role from the other phone's hello
export function setPeerRole(role) {
  peerRole = role;
  render();
}
