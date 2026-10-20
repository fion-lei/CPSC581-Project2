import * as THREE from "three";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { renderer, scene } from "./scene.js";
import { modelRoot } from "./model.js";

const startHandlers = [];
const endHandlers = [];

export function onSessionStart(fn) { startHandlers.push(fn); }
export function onSessionEnd(fn) { endHandlers.push(fn); }

// Flat ring that marks where the part will go
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.075, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let hitTestSource = null;
let hitTestFailed = false;
let placing = false;
let placeButton = null;
let replaceButton = null;
let status = null;

function makeButton(label, onClick) {
  const button = document.createElement("button");
  button.textContent = label;
  Object.assign(button.style, {
    minHeight: "48px", padding: "0 24px", border: "none", borderRadius: "24px",
    background: "rgba(17, 17, 17, 0.7)", color: "#fff", font: "600 16px system-ui, sans-serif",
    pointerEvents: "auto",
  });
  button.hidden = true;
  button.addEventListener("click", onClick);
  return button;
}

// Move modelRoot to the reticle, level, with the part's front (+z) facing the phone
function place() {
  if (!placing || !reticle.visible) return;
  modelRoot.position.setFromMatrixPosition(reticle.matrix);
  const phone = renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
  modelRoot.rotation.set(0, Math.atan2(phone.x - modelRoot.position.x,
    phone.z - modelRoot.position.z), 0);
  modelRoot.visible = true;
  reticle.visible = false;
  placing = false;
}

export function updateAR(frame) {
  if (placing && hitTestSource) {
    const hits = frame.getHitTestResults(hitTestSource);
    const pose = hits[0]?.getPose(renderer.xr.getReferenceSpace());
    reticle.visible = !!pose;
    if (pose) reticle.matrix.fromArray(pose.transform.matrix);
  } else if (placing && hitTestFailed) {
    // No surface detection: hold the reticle 50 cm ahead and 30 cm below the phone
    const phone = renderer.xr.getCamera();
    const ahead = phone.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const spot = phone.getWorldPosition(new THREE.Vector3())
      .addScaledVector(ahead, 0.5).add(new THREE.Vector3(0, -0.3, 0));
    reticle.matrix.makeTranslation(spot.x, spot.y, spot.z);
    reticle.visible = true;
  }
  placeButton.hidden = !(placing && reticle.visible);
  replaceButton.hidden = placing;
}

export function initAR() {
  renderer.xr.enabled = true;

  // The button lives inside the overlay root, so STOP AR stays visible in AR
  const hud = document.getElementById("hud");
  const button = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: hud },
  });
  button.style.pointerEvents = "auto";
  hud.appendChild(button);

  // Placement buttons, bottom centre. Taps on them must not also fire an XR select.
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "absolute", left: "0", right: "0", bottom: "96px",
    display: "flex", justifyContent: "center",
  });
  bar.addEventListener("beforexrselect", (e) => e.preventDefault());
  placeButton = makeButton("Place part", place);
  replaceButton = makeButton("Re-place", () => { placing = true; });
  bar.append(placeButton, replaceButton);
  hud.appendChild(bar);

  status = document.createElement("div");
  Object.assign(status.style, {
    position: "absolute", left: "16px", right: "16px", bottom: "160px",
    textAlign: "center", font: "14px system-ui, sans-serif", color: "#fff",
    textShadow: "0 1px 3px #000",
  });
  status.hidden = true;
  hud.appendChild(status);

  // Camera feed shows through a transparent background in AR
  let savedBackground = null;
  renderer.xr.addEventListener("sessionstart", () => {
    savedBackground = scene.background;
    scene.background = null;

    const session = renderer.xr.getSession();
    session.requestReferenceSpace("viewer")
      .then((space) => session.requestHitTestSource({ space }))
      .then((source) => {
        // The session may have ended (or been replaced) while this was pending
        if (session !== renderer.xr.getSession()) source.cancel();
        else hitTestSource = source;
      })
      .catch((err) => {
        console.error("Hit-test unavailable:", err);
        if (session !== renderer.xr.getSession()) return;
        hitTestFailed = true;
        status.textContent = "Surface detection unavailable. Place part puts it in front of you.";
        status.hidden = false;
      });
    // Without dom-overlay there are no buttons, so a screen tap places instead.
    // With the overlay, taps are left free for grab and draw (issues 09, 10).
    if (!session.domOverlayState) session.addEventListener("select", place);
    placing = true;
    modelRoot.visible = false;

    startHandlers.forEach((fn) => fn());
  });
  renderer.xr.addEventListener("sessionend", () => {
    scene.background = savedBackground;
    hud.style.display = ""; // ARButton hides the overlay root on exit

    hitTestSource?.cancel();
    hitTestSource = null;
    hitTestFailed = false;
    status.hidden = true;
    placing = false;
    reticle.visible = false;
    placeButton.hidden = true;
    replaceButton.hidden = true;
    modelRoot.position.set(0, 0, 0);
    modelRoot.rotation.set(0, 0, 0);
    modelRoot.visible = true;

    endHandlers.forEach((fn) => fn());
  });
}
