import * as THREE from "three";
import { renderer, camera } from "./scene.js";
import { modelRoot } from "./model.js";
import { isTracking } from "./ar.js";

const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const rootQuat = new THREE.Quaternion();

// Camera pose in modelRoot local space (camera looks down its local -z).
// getWorld* refresh matrices first: in AR the XR camera's matrixWorld is
// otherwise one frame stale until render() runs.
// Returns null while the part is not placed (ar.js hides it during placement)
// or while AR tracking is lost.
export function getLocalPose() {
  if (!modelRoot.visible) return null;
  if (renderer.xr.isPresenting && !isTracking()) return null;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(camPos);
  cam.getWorldQuaternion(camQuat);
  modelRoot.getWorldQuaternion(rootQuat);
  modelRoot.worldToLocal(camPos);
  rootQuat.invert().multiply(camQuat);
  return { p: camPos.toArray(), q: rootQuat.toArray() };
}
