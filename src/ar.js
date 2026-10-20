import { ARButton } from "three/examples/jsm/webxr/ARButton.js";
import { renderer, scene } from "./scene.js";

const startHandlers = [];
const endHandlers = [];

export function onSessionStart(fn) { startHandlers.push(fn); }
export function onSessionEnd(fn) { endHandlers.push(fn); }

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

  // Camera feed shows through a transparent background in AR
  let savedBackground = null;
  renderer.xr.addEventListener("sessionstart", () => {
    savedBackground = scene.background;
    scene.background = null;
    startHandlers.forEach((fn) => fn());
  });
  renderer.xr.addEventListener("sessionend", () => {
    scene.background = savedBackground;
    hud.style.display = ""; // ARButton hides the overlay root on exit
    endHandlers.forEach((fn) => fn());
  });
}
