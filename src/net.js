import { Peer } from "peerjs";

const RETRY_MS = 2000;
const OPEN_TIMEOUT_MS = 8000; // a connection that never opens (blocked WebRTC) is retried

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

// fn(state, detail): state is "connecting" | "connected" | "disconnected"
export function onStatus(fn) { statusHandlers.push(fn); }

// Messages are { t: "type", ...data }. Dropped while not connected.
export function send(msg) {
  if (conn?.open) conn.send(msg);
}

export function getStatus() { return status; }

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
  setStatus("disconnected", waitingText());
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
  peer = role === "expert" ? new Peer(hostId) : new Peer();

  peer.on("open", () => {
    if (role === "novice") dial();
    else if (!conn?.open) setStatus("connecting", waitingText());
  });
  peer.on("connection", (c) => {
    if (role === "expert") attach(c);
    else c.close();
  });
  // Lost the signalling server. Open connections keep working; reconnect for new ones.
  peer.on("disconnected", () => {
    const p = peer;
    retry(() => { if (p === peer && !p.destroyed) p.reconnect(); });
  });
  peer.on("error", (err) => {
    console.warn("Peer error:", err.type, err);
    if (err.type === "peer-unavailable") {
      // Expert isn't hosting this room yet
      setStatus("connecting", waitingText());
      retry(dial);
    } else if (err.type === "unavailable-id") {
      // Another tab or phone already hosts this room (or a closed one hasn't timed out)
      setStatus("disconnected", "room in use");
      retry(start);
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

// Free the room id right away so a reload can host it again
window.addEventListener("beforeunload", () => peer?.destroy());
