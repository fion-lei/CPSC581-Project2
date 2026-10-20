import "./session.css";

const STORE_KEY = "ghostlens.join";
const validRole = (role) => role === "expert" || role === "novice";
const validCode = (code) =>
  typeof code === "string" && /^\d{4}$/.test(code);
const randomCode = () =>
  String(Math.floor(Math.random() * 10000)).padStart(4, "0");

let joined = null;
let view = null;

function loadLast() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export function setStatus(state, detail = "") {
  if (!view) return;

  const name = state[0].toUpperCase() + state.slice(1);
  view.chip.dataset.state = state;
  view.dot.style.background = {
    connecting: "#fbbf24",
    connected: "#4ade80",
    disconnected: "#929ba5",
  }[state] || "#929ba5";

  const prefix = joined
    ? (joined.role === "expert" ? "Expert" : "Novice") +
      " · " + joined.code + " · "
    : "";

  view.text.textContent =
    prefix + name + (detail ? " · " + detail : "");
  view.chip.title = detail || name;
  view.message.textContent = detail || name;
}

export function initHud(onJoin) {
  if (view) return;

  const hud = document.getElementById("hud");

  const chip = document.createElement("button");
  chip.id = "net-chip";
  chip.className = "net-chip";
  chip.type = "button";
  chip.setAttribute("aria-label", "Open connection settings");
  chip.setAttribute("aria-controls", "net-start");
  chip.setAttribute("aria-expanded", "true");

  const dot = document.createElement("span");
  dot.className = "net-dot";

  const text = document.createElement("span");
  text.setAttribute("role", "status");
  chip.append(dot, text);

  const screen = document.createElement("section");
  screen.id = "net-start";
  screen.className = "net-start";
  screen.style.zIndex = "1000";
  screen.setAttribute("aria-label", "Shared session setup");

  screen.innerHTML = `
    <form class="net-card" novalidate>
      <span class="net-eyebrow">GHOST LENS</span>
      <h1>Join a shared session</h1>
      <p>The expert creates a room. The novice joins with the same code.</p>

      <label>Your role
        <select id="net-role">
          <option value="expert">Expert</option>
          <option value="novice">Novice</option>
        </select>
      </label>

      <label>Room code
        <input id="net-code" type="text" inputmode="numeric"
          maxlength="4" placeholder="e.g. 1234" autocomplete="off"
          aria-describedby="net-message">
      </label>

      <button type="button" id="net-generate" class="net-quiet">
        Generate a code
      </button>
      <button type="submit" id="net-submit" class="net-primary">
        Create room
      </button>

      <p id="net-message" role="status"></p>

      <div class="net-actions">
        <button type="button" id="net-preview" class="net-quiet">
          Local preview
        </button>
        <button type="button" id="net-disconnect" class="net-quiet" hidden>
          Disconnect &amp; reload
        </button>
      </div>
    </form>`;

  hud.append(chip, screen);

  const find = (name) => screen.querySelector("#net-" + name);
  const form = screen.querySelector("form");
  const role = find("role");
  const code = find("code");
  const submit = find("submit");
  const generate = find("generate");
  const message = find("message");
  const preview = find("preview");
  const leave = find("disconnect");

  view = { chip, dot, text, message };

  const saved = loadLast();
  const params = new URLSearchParams(location.search);
  const linkRole = params.get("role");
  const linkCode = params.get("room") ?? params.get("code") ?? "";

  role.value = validRole(linkRole)
    ? linkRole
    : validRole(saved.role) ? saved.role : "expert";
  code.value = linkCode || (validCode(saved.code) ? saved.code : "");

  function refreshControls() {
    role.disabled = !!joined;
    code.disabled = !!joined;
    generate.hidden = !!joined || role.value !== "expert";
    leave.hidden = !joined;
    preview.textContent = joined ? "Back to scene" : "Local preview";
    submit.textContent = joined
      ? "Back to scene"
      : role.value === "expert" ? "Create room" : "Join room";
  }

  function closeScreen() {
    screen.hidden = true;
    chip.setAttribute("aria-expanded", "false");
    chip.focus();
  }

  function joinRoom() {
    if (joined) {
      closeScreen();
      return;
    }

    if (!validRole(role.value)) {
      message.textContent = "Choose Expert or Novice.";
      role.focus();
      return;
    }

    code.value = code.value.trim();

    if (role.value === "expert" && !code.value) {
      code.value = randomCode();
    }

    if (!validCode(code.value)) {
      message.textContent = "Enter exactly four digits, such as 1234.";
      code.focus();
      return;
    }

    // connect() can report a status immediately.
    joined = { role: role.value, code: code.value };

    try {
      onJoin(joined.role, joined.code);
    } catch (error) {
      joined = null;
      setStatus(
        "disconnected",
        error.message || "Could not start the connection."
      );
      refreshControls();
      return;
    }

    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(joined));
    } catch {
      // Joining still works if browser storage is unavailable.
    }

    refreshControls();
    closeScreen();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    joinRoom();
  });

  role.addEventListener("change", refreshControls);

  generate.addEventListener("click", () => {
    code.value = randomCode();
  });

  code.addEventListener("input", () => {
    code.value = code.value.replace(/\D/g, "").slice(0, 4);
  });

  chip.addEventListener("click", () => {
    screen.hidden = false;
    chip.setAttribute("aria-expanded", "true");
    (joined ? preview : code).focus();
  });

  preview.addEventListener("click", closeScreen);

  // Existing net.js destroys its peer on beforeunload.
  // Clear auto-join parameters so reload shows the start screen.
  leave.addEventListener("click", () => {
    const url = new URL(location.href);

    for (const key of ["role", "room", "code"]) {
      url.searchParams.delete(key);
    }

    history.replaceState(null, "", url);
    location.reload();
  });

  // Keep form keystrokes away from scene shortcuts.
  screen.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });

  // HUD interaction must not also select objects in AR.
  for (const element of [chip, screen]) {
    element.addEventListener("beforexrselect", (event) => {
      event.preventDefault();
    });
  }

  refreshControls();
  setStatus("disconnected", "Choose a role and room");

  // Preserve direct links such as ?role=novice&room=1234.
  if (validRole(linkRole) && validCode(linkCode)) {
    joinRoom();
  }
}