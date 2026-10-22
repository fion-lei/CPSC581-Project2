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

export function viewpointAlignment(current, saved) {
  const position = new THREE.Vector3().fromArray(current.p);
  const direction = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion().fromArray(current.q).normalize());
  const targetDirection = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(new THREE.Quaternion().fromArray(saved.q).normalize());
  const distance = position.distanceTo(new THREE.Vector3().fromArray(saved.p));
  const angle = direction.angleTo(targetDirection);
  const aligned = distance <= 0.05 && angle <= THREE.MathUtils.degToRad(10);
  const positionScore = THREE.MathUtils.clamp(1 - (distance - 0.05) / 0.45, 0, 1);
  const angleScore = THREE.MathUtils.clamp(
    1 - (angle - THREE.MathUtils.degToRad(10)) / THREE.MathUtils.degToRad(80), 0, 1);
  const score = aligned ? 100 : Math.min(99, Math.round(Math.min(positionScore, angleScore) * 100));
  return { distance, angle, aligned, score };
}
