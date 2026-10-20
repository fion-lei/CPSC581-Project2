import { Peer } from "peerjs";

const RETRY_MS = 2000;
const OPEN_TIMEOUT_MS = 8000; // a connection that never opens (blocked WebRTC) is retried

// Status detail when another peer already hosts the room
export const ROOM_IN_USE = "room in use";

const handlers = new Map();
const statusHandlers = [];

let role = null;
let hostId = null;
let peer = null;
let conn = null;
let retryTimer = null;
let status = "disconnected";
let remoteRole = null;

// Register a handler for messages of one type: on("hello", (msg) => ...)
export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, []);
  handlers.get(type).push(fn);
}

// fn(state, detail): state is "connecting" | "waiting" | "connected" | "disconnected".
// "waiting" = the expert's room is open but no novice has joined yet.
export function onStatus(fn) { statusHandlers.push(fn); }

// Messages are { t: "type", ...data }. Dropped while not connected.
export function send(msg) {
  if (conn?.open) conn.send(msg);
}

export function getStatus() { return status; }

// This phone's role ("expert" | "novice"), or null before joining a room
export function getRole() { return role; }

// Role sent by the other phone in its hello, or null
export function getRemoteRole() { return remoteRole; }

function setStatus(state, detail = "") {
  status = state;
  statusHandlers.forEach((fn) => fn(state, detail));
}

function retry(fn) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(fn, RETRY_MS);
}

function waitingText() { return role === "expert" ? "waiting for novice" : "waiting for expert"; }

// Use c as the one live connection. A newer connection replaces an older one.
function attach(c) {
  const old = conn;
  conn = c;
  old?.close();

  // PeerJS fires no "close" for a connection that never opened, so give up on it here
  const openTimer = setTimeout(() => {
    if (conn !== c || c.open) return;
    c.close();
    lost(c);
  }, OPEN_TIMEOUT_MS);

  c.on("open", () => {
    clearTimeout(openTimer);
    setStatus("connected");
    c.send({ t: "hello", role });
  });
  c.on("data", (msg) => {
    if (msg?.t === "hello") remoteRole = msg.role;
    handlers.get(msg?.t)?.forEach((fn) => fn(msg));
  });
  c.on("close", () => {
    clearTimeout(openTimer);
    lost(c);
  });
  // A closed tab or lost network often shows up only as an ICE state change, not "close"
  c.on("iceStateChanged", (state) => {
    if (state !== "disconnected" && state !== "failed") return;
    clearTimeout(openTimer);
    c.close();
    lost(c);
  });
  c.on("error", (err) => console.warn("Connection error:", err));
}

function lost(c) {
  if (conn !== c) return;
  conn = null;
  remoteRole = null;
  // The expert's room stays open for the novice to come back
  setStatus(role === "expert" && peer?.open ? "waiting" : "disconnected", waitingText());
  if (role === "novice") retry(dial);
}

// Novice: call the expert's peer id
function dial() {
  if (!peer?.open || conn?.open) return;
  setStatus("connecting", waitingText());
  attach(peer.connect(hostId, { serialization: "json", reliable: true }));
}

function start() {
  peer?.destroy();
  setStatus("connecting");
  const p = role === "expert" ? new Peer(hostId) : new Peer();
  peer = p;

  // Events from a peer that has since been replaced or left are ignored
  p.on("open", () => {
    if (p !== peer) return;
    if (role === "novice") dial();
    else if (!conn?.open) setStatus("waiting", waitingText());
  });
  p.on("connection", (c) => {
    if (p === peer && role === "expert") attach(c);
    else c.close();
  });
  // Lost the signalling server. Open connections keep working; reconnect for new ones.
  p.on("disconnected", () => {
    retry(() => { if (p === peer && !p.destroyed) p.reconnect(); });
  });
  p.on("error", (err) => {
    if (p !== peer) return;
    console.warn("Peer error:", err.type, err);
    if (err.type === "peer-unavailable") {
      // Expert isn't hosting this room yet
      setStatus("connecting", waitingText());
      retry(dial);
    } else if (err.type === "unavailable-id") {
      // Another tab or phone already hosts this room (or a closed one hasn't timed out).
      // Retry first: a status handler may switch to a new room, which cancels it.
      retry(start);
      setStatus("disconnected", ROOM_IN_USE);
    } else if (peer.destroyed) {
      setStatus("disconnected", err.type);
      retry(start);
    }
  });
}

// Join a room. The expert hosts as ghostlens-<code>; the novice connects to it.
export function connect(asRole, code) {
  role = asRole;
  hostId = `ghostlens-${code}`;
  start();
}

// Leave the room, e.g. when the role or code changes on the start screen
export function disconnect() {
  clearTimeout(retryTimer);
  const p = peer;
  peer = null;
  conn = null;
  remoteRole = null;
  p?.destroy();
  setStatus("disconnected");
}

// Free the room id right away so a reload can host it again
window.addEventListener("beforeunload", () => peer?.destroy());
