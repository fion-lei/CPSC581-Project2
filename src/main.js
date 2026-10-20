import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { renderer, scene, camera, startLoop } from "./scene.js";
import { modelRoot } from "./model.js";
import { initAR, onSessionStart, onSessionEnd, updateAR } from "./ar.js";
import { initDebug, updateDebug } from "./debug.js";

scene.add(modelRoot);

// Desktop-only helpers
const grid = new THREE.GridHelper(1, 20, 0x555555, 0x333333);
scene.add(grid);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.07, 0);
controls.enableDamping = true;
controls.update();

initAR();
initDebug();
onSessionStart(() => {
  grid.visible = false;
  controls.enabled = false;
});
onSessionEnd(() => {
  grid.visible = true;
  controls.enabled = true;
});

startLoop((_time, frame) => {
  if (renderer.xr.isPresenting) updateAR(frame);
  else controls.update();
  updateDebug();
});
