import * as THREE from "three";

// Colour tokens from src/style.css :root, so 3D materials share one palette with
// the HUD. main.js imports style.css first, so the tokens exist before any module
// builds its materials.
const styles = getComputedStyle(document.documentElement);

export function tokenColor(name) {
  const value = styles.getPropertyValue(name).trim();
  if (!value) console.warn(`Missing colour token ${name}`);
  return new THREE.Color(value || undefined);
}
