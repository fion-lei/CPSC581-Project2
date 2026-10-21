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

// Plain number tokens, e.g. --dim (an opacity)
export function tokenNumber(name) {
  const value = parseFloat(styles.getPropertyValue(name));
  if (Number.isNaN(value)) console.warn(`Missing number token ${name}`);
  return value;
}
