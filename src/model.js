import * as THREE from "three";

export const modelRoot = new THREE.Group();
export const modelPivot = new THREE.Group();
modelRoot.add(modelPivot);

const WIDTH = 0.2;   // x
const THICK = 0.015; // plate thickness
const DEPTH = 0.12;  // base depth (z)
const HEIGHT = 0.12; // upright height
const SHELF = 0.08;  // shelf depth, overhangs forward from the upright

const material = new THREE.MeshStandardMaterial({
  color: 0x9ca3af, metalness: 0.3, roughness: 0.6 });
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1f2937 });

function addBox(name, w, h, d, x, y, z) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial));
  modelPivot.add(mesh);
}

const back = -DEPTH / 2;
addBox("base", WIDTH, THICK, DEPTH, 0, THICK / 2, 0);
addBox("upright", WIDTH, HEIGHT, THICK, 0, THICK + HEIGHT / 2, back + THICK / 2);
addBox("shelf", WIDTH, THICK, SHELF, 0, THICK + HEIGHT + THICK / 2, back + SHELF / 2);

// Dark grid mat under the placement preview (mockup Scene 1), hidden once placed
const MAT = 0.3;
const mat = new THREE.Mesh(
  new THREE.PlaneGeometry(MAT, MAT).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x262a33 }));
mat.position.y = 0.001;
const matGrid = new THREE.GridHelper(MAT, 6, 0x3b4252, 0x3b4252);
matGrid.position.y = 0.002;
mat.visible = matGrid.visible = false;
modelRoot.add(mat, matGrid);

// Translucent look on a mat while the part is a placement preview
export function setPreview(on) {
  mat.visible = matGrid.visible = on;
  for (const m of [material, edgeMaterial]) {
    m.transparent = on;
    m.opacity = on ? 0.45 : 1;
    m.depthWrite = !on;
    m.needsUpdate = true;
  }
}
