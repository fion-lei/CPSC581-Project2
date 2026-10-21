import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { renderer, scene, camera, startLoop } from "./scene.js";
import { modelRoot, modelPivot } from "./model.js";
import { initAR, onSessionStart, onSessionEnd, updateAR, enterAR, arSupported, isPlaced, isTracking } from "./ar.js";
import { initDebug, updateDebug } from "./debug.js";
import { connect, disconnect, on, onStatus, send, getRole } from "./net.js";
import { initHud, setStatus, setPeerRole, setCrosshair, showToast } from "./hud.js";
import { createCentreAim } from "./expert-tools.js";
import { getLocalPose } from "./pose.js";
import { createGhost } from "./ghost.js";
import { initPins } from "./pins.js";

const POSE_INTERVAL_MS = 50; // ~20 pose messages a second
const centreAim = createCentreAim(modelRoot, modelPivot);

scene.add(modelRoot);

// One ghost per role. Poses go to the other role's ghost, so this phone's own
// ghost never gets any and stays hidden.
const ghosts = { expert: createGhost("expert"), novice: createGhost("novice") };
Object.values(ghosts).forEach((g) => modelRoot.add(g.object));

// Desktop-only helpers
const grid = new THREE.GridHelper(1, 20, 0x555555, 0x333333);
scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.07, 0);
controls.enableDamping = true;
controls.update();

const pins = initPins({ expertGhost: ghosts.expert.object, send, getRole });

initAR();
initDebug();

onStatus(setStatus);
on("hello", (msg) => {
  console.log(`hello from ${msg.role}`);
  setPeerRole(msg.role);
  // The novice (re)joined: give it every pin placed so far. The expert's hello
  // comes first on the same ordered channel, so the novice clears, then refills.
  if (getRole() === "expert") pins.resend();
  else if (msg.role === "expert") pins.clearRemote();
});
on("pose", (msg) => ghosts[getRole() === "expert" ? "novice" : "expert"].setPose(msg));
on("help", () => {
  if (getRole() !== "expert") return;
  showToast("Novice is stuck", "Check in with them", 8000);
  navigator.vibrate?.([50, 100, 50]); // mimicks 2 knocks
});
on("pin", pins.addRemote);
on("unpin", pins.removeRemote);
on("ack", pins.onAck);
initHud({ connect, disconnect, onEnter: enterAR, onHelp: () => send({ t: "help" }), arSupported });

onSessionStart(() => {
  grid.visible = false;
  controls.enabled = false;
});
onSessionEnd(() => {
  grid.visible = true;
  controls.enabled = true;
});

// Each phone streams its pose, relative to the part. Nothing is sent while the
// pose is unknown, so the other phone's ghost times out and hides. Where AR works, only
// the AR pose counts: outside a session the pose would be the desktop camera's.
// Without AR (desktop testing) the orbit camera stands in for the phone.
const round = (n) => Math.round(n * 1e4) / 1e4;
let lastPoseSent = 0;
let hasAR = true;
arSupported.then((ok) => { hasAR = ok; });
function sendPose() {
  const time = performance.now();
  if (!getRole() || time - lastPoseSent < POSE_INTERVAL_MS) return;
  if (hasAR && !renderer.xr.isPresenting) return;
  const pose = getLocalPose();
  if (!pose) return;
  lastPoseSent = time;
  send({ t: "pose", p: pose.p.map(round), q: pose.q.map(round) });
}

startLoop((_time, frame) => {
  if (renderer.xr.isPresenting) updateAR(frame);
  else controls.update();
  const ready = getRole() === "expert" && isPlaced()
    && (!renderer.xr.isPresenting || isTracking());
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  setCrosshair(ready, centreAim.update(activeCamera, ready));
  sendPose();
  ghosts.expert.update();
  ghosts.novice.update();
  pins.update(activeCamera, ready, centreAim.getHit());
  updateDebug();
});
