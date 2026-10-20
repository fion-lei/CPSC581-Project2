import * as THREE from "three";

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color("#111111");

export const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0.35, 0.3, 0.45);
camera.lookAt(0, 0.07, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

export function startLoop(onFrame) {
  renderer.setAnimationLoop((time, frame) => {
    onFrame?.(time, frame);
    renderer.render(scene, camera);
  });
}
