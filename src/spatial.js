import * as THREE from "three";

export function validPose(pose) {
  if (!pose || typeof pose !== "object") return false;
  const { p, q } = pose;
  return Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
    && Array.isArray(q) && q.length === 4 && q.every(Number.isFinite)
    && Math.abs(q.reduce((sum, n) => sum + n * n, 0) - 1) < 0.01;
}

// Keep the full camera-to-part offset, then convert back into this table's space.
export function createPhoneHold(root, pivot) {
  const offset = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  return {
    capture(camera) {
      pivot.updateWorldMatrix(true, false);
      camera.updateWorldMatrix(true, false);
      offset.copy(camera.matrixWorld).invert().multiply(pivot.matrixWorld);
    },
    update(camera) {
      root.updateWorldMatrix(true, false);
      camera.updateWorldMatrix(true, false);
      local.copy(root.matrixWorld).invert().multiply(camera.matrixWorld).multiply(offset);
      local.decompose(pivot.position, pivot.quaternion, scale);
    },
  };
}

const MATCH_DISTANCE = 0.05;
const MATCH_ANGLE = THREE.MathUtils.degToRad(10);
// Once aligned, stay aligned until clearly out, so the state doesn't flicker at the edge.
const LEAVE_DISTANCE = 0.08;
const LEAVE_ANGLE = THREE.MathUtils.degToRad(15);
// The bar starts rising this far from the saved view, so walking over from the table counts.
const FAR_DISTANCE = 1.5;

export function viewpointAlignment(current, saved) {
  const position = new THREE.Vector3().fromArray(current.p);
  const direction = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion().fromArray(current.q).normalize());
  const targetDirection = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion().fromArray(saved.q).normalize());
  const distance = position.distanceTo(new THREE.Vector3().fromArray(saved.p));
  const angle = direction.angleTo(targetDirection);
  const aligned = distance <= MATCH_DISTANCE && angle <= MATCH_ANGLE;
  const positionScore = THREE.MathUtils.clamp(
    1 - (distance - MATCH_DISTANCE) / (FAR_DISTANCE - MATCH_DISTANCE), 0, 1);
  const angleScore = THREE.MathUtils.clamp(1 - (angle - MATCH_ANGLE) / (Math.PI - MATCH_ANGLE), 0, 1);
  // Position matters most; facing the wrong way holds the bar back but doesn't zero it.
  const score = aligned ? 100 : Math.min(99, Math.round(positionScore * (0.5 + 0.5 * angleScore) * 100));
  return { distance, angle, aligned, score };
}

export function alignmentState(wasAligned, { distance, angle, aligned }) {
  if (wasAligned) return distance <= LEAVE_DISTANCE && angle <= LEAVE_ANGLE;
  return aligned;
}
