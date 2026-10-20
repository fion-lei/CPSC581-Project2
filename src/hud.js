const ROLE_COLORS = { expert: "#EA580C", novice: "#1D4ED8" };
const STATUS_COLORS = { connecting: "#F59E0B", connected: "#22C55E", disconnected: "#EF4444" };
const STORE_KEY = "ghostlens.join";

let chip = null;
let chipDot = null;
let chipText = null;
let joined = null; // { role, code }

const label = (role) => role[0].toUpperCase() + role.slice(1);
const validCode = (code) => /^\d{4}$/.test(code);
const randomCode = () => String(Math.floor(Math.random() * 10000)).padStart(4, "0");

function loadLast() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch { return {}; }
}

function saveLast(role, code) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ role, code })); } catch { /* private mode */ }
}

function makeChip(hud) {
  chip = document.createElement("div");
  Object.assign(chip.style, {
    position: "absolute", left: "50%", top: "16px", transform: "translateX(-50%)",
    display: "flex", alignItems: "center", gap: "8px", width: "max-content",
    maxWidth: "calc(100% - 136px)", boxSizing: "border-box", padding: "8px 14px",
    borderRadius: "16px", background: "rgba(17, 17, 17, 0.7)", color: "#fff",
    font: "13px system-ui, sans-serif", whiteSpace: "nowrap", overflow: "hidden",
  });
  chipDot = document.createElement("span");
  Object.assign(chipDot.style, { width: "8px", height: "8px", borderRadius: "4px", flex: "none" });
  chipText = document.createElement("span");
  Object.assign(chipText.style, { overflow: "hidden", textOverflow: "ellipsis" });
  chip.append(chipDot, chipText);
  chip.hidden = true;
  hud.appendChild(chip);
}

// Full-screen role + room code picker. Covers the AR button until joined.
function makeStartScreen(hud, onJoin) {
  const last = loadLast();
  let role = last.role;

  const screen = document.createElement("div");
  Object.assign(screen.style, {
    position: "absolute", inset: "0", zIndex: "1000", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "16px", padding: "16px",
    background: "#111", pointerEvents: "auto", font: "16px system-ui, sans-serif",
  });

  const title = document.createElement("h1");
  title.textContent = "Ghost Lens";
  Object.assign(title.style, { margin: "0 0 8px", font: "700 28px system-ui, sans-serif" });

  const roles = document.createElement("div");
  Object.assign(roles.style, { display: "flex", gap: "12px", width: "100%", maxWidth: "320px" });

  const input = document.createElement("input");
  Object.assign(input, { inputMode: "numeric", maxLength: 4, placeholder: "Room code",
    autocomplete: "off", value: last.code ?? "" });
  Object.assign(input.style, {
    width: "100%", maxWidth: "320px", boxSizing: "border-box", minHeight: "56px",
    border: "2px solid #444", borderRadius: "16px", background: "#1b1b1b", color: "#fff",
    font: "600 24px ui-monospace, monospace", textAlign: "center", letterSpacing: "8px",
  });

  const join = document.createElement("button");
  join.textContent = "Join";
  Object.assign(join.style, {
    width: "100%", maxWidth: "320px", minHeight: "56px", border: "none", borderRadius: "28px",
    color: "#fff", font: "600 18px system-ui, sans-serif",
  });

  const roleButtons = {};
  for (const r of ["expert", "novice"]) {
    const b = document.createElement("button");
    b.textContent = label(r);
    Object.assign(b.style, {
      flex: "1", minHeight: "72px", borderRadius: "16px", color: "#fff",
      font: "600 18px system-ui, sans-serif",
    });
    b.addEventListener("click", () => {
      role = r;
      // The expert opens the room, so they get a fresh code to read out
      if (r === "expert" && !validCode(input.value)) input.value = randomCode();
      refresh();
    });
    roleButtons[r] = b;
    roles.appendChild(b);
  }

  function refresh() {
    for (const [r, b] of Object.entries(roleButtons)) {
      const on = r === role;
      b.style.border = `2px solid ${ROLE_COLORS[r]}`;
      b.style.background = on ? ROLE_COLORS[r] : "transparent";
    }
    input.value = input.value.replace(/\D/g, "").slice(0, 4);
    const ready = !!role && validCode(input.value);
    join.disabled = !ready;
    join.style.background = ready ? ROLE_COLORS[role] : "#333";
    join.style.opacity = ready ? "1" : "0.6";
  }

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !join.disabled) join.click(); });
  join.addEventListener("click", () => {
    saveLast(role, input.value);
    screen.remove();
    start(role, input.value, onJoin);
  });

  screen.append(title, roles, input, join);
  hud.appendChild(screen);
  refresh();
}

function start(role, code, onJoin) {
  joined = { role, code };
  chip.hidden = false;
  onJoin(role, code);
}

// Start screen, then onJoin(role, code). ?role=expert&room=1234 skips the screen.
export function initHud(onJoin) {
  const hud = document.getElementById("hud");
  makeChip(hud);

  const params = new URLSearchParams(location.search);
  const role = params.get("role");
  const code = params.get("room") ?? "";
  if ((role === "expert" || role === "novice") && validCode(code)) start(role, code, onJoin);
  else makeStartScreen(hud, onJoin);
}

// Connection status chip: "Expert · 1234 · connected", or the detail in place of the
// state ("Novice · 1234 · waiting for expert"); the dot colour shows the state
export function setStatus(state, detail = "") {
  if (!joined) return;
  chipDot.style.background = STATUS_COLORS[state];
  chipText.textContent = [label(joined.role), joined.code, detail || state].join(" · ");
}
