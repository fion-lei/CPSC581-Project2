import { ROOM_IN_USE } from "./net.js";
import { setIconButton } from "./icons.js";
import { TOOL_MODES, setMode, onModeChange } from "./expert-tools.js";
import { unlock, setMuted, isMuted, onMuteChange } from "./audio.js";

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
let inScene = false;
let toolbar = null;
let crosshair = null;
let aimReady = false;
let aimHit = false;
let toolsHidden = false; // the pin sheet has the mode bar's slot
let hint = null;
let hudRoot = null;
let toast = null;
let toastTitle = null;
let toastBody = null;
let toastActions = null;
let toastBar = null;
let toastFill = null;
let toastTimer = 0;
let toastAnim = null;
let toastOnClose = null;
let pill = null;
let pillText = null;
let pillDot = null;
let pillAction = null;
let pillTimer = 0;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let helpButton = null;
let helpCooldown = 0;
const HELP_COOLDOWN_MS = 10000; // cooldown for help so it doesn't spam the expert
let muteButton = null;
const SPEAKER_ON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18 5a9 9 0 0 1 0 14"/></svg>`;
const SPEAKER_OFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
const BOTTOM_GAP = 24; // px between stacked bottom controls
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
  setMode("view");
  hideToast();
  hidePill();
  clearTimeout(helpCooldown);
  helpCooldown = 0;
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
  }
  renderHelp();
  renderMute();
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

// Renders help button for novice -> expert communication
function renderHelp() {
  if (!helpButton) return;
  helpButton.hidden = !inScene || joined?.role !== "novice";
  helpButton.disabled = !!helpCooldown || state !== "connected";
  helpButton.textContent = helpCooldown ? "Expert notified" : "Help";
}

function makeHelpButton(onHelp) {
  helpButton = el("button", "chip help-chip");
  helpButton.type = "button";
  helpButton.setAttribute("aria-live", "polite");
  helpButton.addEventListener("click", () => {
    if (!onHelp()) return;
    helpCooldown = setTimeout(() => {
      helpCooldown = 0;
      renderHelp();
    }, HELP_COOLDOWN_MS);
    renderHelp();
  });
  helpButton.addEventListener("keydown", (e) => e.stopPropagation());
  helpButton.addEventListener("beforexrselect", (e) => e.preventDefault());
  // Keep the session chips clear of the help button as its label changes
  new ResizeObserver(() => {
    const w = helpButton.offsetWidth;
    hudRoot.style.setProperty("--help-clearance", `${w ? w + 8 : 0}px`);
  }).observe(helpButton);
  return helpButton;
}

function renderMute() {
  if (!muteButton) return;
  muteButton.hidden = !inScene;
  const on = !isMuted();
  muteButton.setAttribute("aria-pressed", String(on));
  muteButton.setAttribute("aria-label", on ? "Sound on" : "Sound muted");
  muteButton.innerHTML = on ? SPEAKER_ON : SPEAKER_OFF;
}

function makeMuteButton() {
  muteButton = el("button", "chip mute-chip");
  muteButton.type = "button";
  muteButton.addEventListener("click", () => {
    unlock().then(() => {
      setMuted(!isMuted());
      navigator.vibrate?.(40);
    });
  });
  muteButton.addEventListener("keydown", (e) => e.stopPropagation());
  muteButton.addEventListener("beforexrselect", (e) => e.preventDefault());
  onMuteChange(renderMute);
  renderMute();
  hudRoot.appendChild(muteButton);
  return muteButton;
}

function renderTools() {
  if (!toolbar) return;
  const visible = inScene && joined?.role === "expert" && aimReady;
  toolbar.hidden = crosshair.hidden = !visible || toolsHidden;
  if (hint && !visible) hint.hidden = true;
  layoutBottom();
}

// Tallest visible element of a slot, plus the gap above it
function slotSpace(selector) {
  let space = 0;
  for (const e of hudRoot.querySelectorAll(selector)) {
    if (!e.hidden) space = Math.max(space, e.offsetHeight + BOTTOM_GAP);
  }
  return space;
}

// Stack from the bottom: mode bar (or pin sheet), toast, then the AR and placement
// controls. Call again when something in either slot shows, hides or resizes.
export function layoutBottom() {
  if (!toolbar || !toast) return;
  const toolbarSpace = slotSpace(".bottom-bar");
  const toastSpace = slotSpace(".toast-area");
  const guidanceSpace = slotSpace(".view-guidance");
  hudRoot.style.setProperty("--toast-offset", `${toolbarSpace}px`);
  hudRoot.style.setProperty("--guidance-offset", `${toolbarSpace + toastSpace}px`);
  hudRoot.style.setProperty("--bottom-clearance", `${toolbarSpace + toastSpace + guidanceSpace}px`);
}

function makeToast(hud) {
  toast = el("div", "toast toast-area");
  toast.setAttribute("role", "status");
  const text = el("div", "toast-text");
  toastTitle = el("div", "toast-title");
  toastBody = el("div", "toast-body");
  text.append(toastTitle, toastBody);
  toastActions = el("div", "toast-actions");
  toastBar = el("div", "toast-timer");
  toastFill = el("div", "toast-timer-fill");
  toastBar.appendChild(toastFill);
  toast.append(text, toastActions, toastBar);
  toast.addEventListener("beforexrselect", (e) => e.preventDefault());
  toast.addEventListener("keydown", (e) => e.stopPropagation());
  toast.hidden = true;
  hud.appendChild(toast);
}

// Short message for both roles: one bold line + optional short line.
// Stays until hideToast(), or for ms milliseconds when given.
// actions: [{ icon, label, primary, onClick }]. Icon makes a square button (label
// is for screen readers); otherwise the label is shown. timer: a bar draining
// over ms. onClose runs once, when this toast hides or another replaces it.
export function showToast(title, body = "", ms = 0, { actions = [], timer = false, onClose = null } = {}) {
  if (!toast) return;
  endToast();
  toastTitle.textContent = title;
  toastBody.textContent = body;
  toastBody.hidden = !body;
  toast.classList.toggle("has-actions", actions.length > 0);
  toastActions.replaceChildren(...actions.map(({ icon, label: text, primary, onClick }) => {
    const b = el("button", `toast-action${icon ? " is-icon" : ""}${primary ? "" : " is-secondary"}`);
    if (icon) setIconButton(b, icon, text);
    else {
      b.type = "button";
      b.textContent = text;
    }
    b.addEventListener("click", onClick);
    return b;
  }));
  const bar = timer && ms > 0 && !reducedMotion.matches;
  toastBar.hidden = !bar;
  if (bar) {
    toastAnim = toastFill.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      { duration: ms, easing: "linear", fill: "forwards" });
  }
  toastOnClose = onClose;
  toast.hidden = false;
  layoutBottom();
  if (ms) toastTimer = setTimeout(hideToast, ms);
}

function endToast() {
  clearTimeout(toastTimer);
  toastAnim?.cancel();
  toastAnim = null;
  const onClose = toastOnClose;
  toastOnClose = null;
  onClose?.();
}

// Pin sheet: hide the mode bar and crosshair while it has their slot
export function setToolsHidden(on) {
  toolsHidden = on;
  renderTools();
}

// Small pill just above the mode bar while holding in Pin mode; null hides it
export function setHint(text) {
  if (!hint) return;
  if (hint.textContent !== (text ?? "")) hint.textContent = text ?? "";
  hint.hidden = !text || toolbar.hidden;
}

export function hideToast() {
  if (!toast) return;
  endToast();
  toast.hidden = true;
  layoutBottom();
}

function makePill(hud) {
  pill = el("div", "pill");
  pill.setAttribute("role", "status");
  pillDot = el("span", "pill-dot");
  pillDot.setAttribute("aria-hidden", "true");
  pillDot.hidden = true;
  pillText = el("span", "pill-text");
  pillAction = el("button", "pill-action");
  pillAction.type = "button";
  pill.append(pillDot, pillText, pillAction);
  pill.addEventListener("beforexrselect", (e) => e.preventDefault());
  pill.addEventListener("keydown", (e) => e.stopPropagation());
  pill.hidden = true;
  hud.appendChild(pill);
}

// White confirmation pill, top-centre: "View sent to novice". With an action
// ({ label, onClick }) it carries a button, e.g. Undo. Hides after ms. A dot role
// ("novice") marks news from the other person with their colour.
export function showPill(text, action = null, ms = 2000, dot = null) {
  if (!pill) return;
  clearTimeout(pillTimer);
  pillText.textContent = text;
  pillDot.hidden = !dot;
  pillDot.className = dot ? `pill-dot is-${dot}` : "pill-dot";
  pill.classList.toggle("has-action", !!action);
  pillAction.hidden = !action;
  pillAction.textContent = action?.label ?? "";
  pillAction.onclick = action ? () => { hidePill(); action.onClick(); } : null;
  pill.hidden = false;
  pillTimer = setTimeout(hidePill, ms);
}

export function hidePill() {
  if (!pill) return;
  clearTimeout(pillTimer);
  pill.hidden = true;
  pillAction.onclick = null;
}

function makeExpertTools(hud) {
  toolbar = el("div", "expert-toolbar bottom-bar");
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
  // Keys typed on a focused tool button must not reach debug.js's "D" toggle.
  toolbar.addEventListener("keydown", (e) => e.stopPropagation());
  crosshair = el("div", "crosshair expert-crosshair");
  crosshair.setAttribute("aria-hidden", "true");
  toolbar.hidden = crosshair.hidden = true;
  hint = el("div", "toast pin-hint");
  hint.setAttribute("role", "status");
  hint.hidden = true;
  hud.append(toolbar, crosshair, hint);
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
    unlock();
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
export function initHud({ connect, disconnect, onEnter, onHelp, arSupported }) {
  net = { connect, disconnect };
  const hud = document.getElementById("hud");
  hudRoot = hud;
  chip = el("div", "session-status");
  const roleChip = makeStatusChip("session-role");
  chipDot = roleChip.dot;
  chipText = roleChip.text;
  connectionChip = makeStatusChip("session-connection");
  connectionChip.text.setAttribute("role", "status");
  chip.addEventListener("beforexrselect", (e) => e.preventDefault());
  chip.append(roleChip.c, connectionChip.c);
  chip.hidden = true;
  hud.append(chip, makeHelpButton(onHelp));
  makeMuteButton();
  // Keep the debug readout below the chips even when they wrap on a phone.
  new ResizeObserver(([entry]) => {
    hud.style.setProperty("--session-status-height", `${entry.contentRect.height}px`);
  }).observe(chip);
  makeToast(hud);
  makePill(hud);
  makeExpertTools(hud);

  const params = new URLSearchParams(location.search);
  const role = params.get("role");
  const code = params.get("room") ?? "";
  if ((role === "expert" || role === "novice") && validCode(code)) {
    inScene = true;
    chip.hidden = false;
    join(role, code);
  } else makeStartScreen(hud, onEnter, arSupported);
  renderMute();
}

// Connection state from net.js, shown in its own chip next to the role chip.
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
