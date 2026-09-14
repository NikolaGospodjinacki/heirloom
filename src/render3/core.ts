import * as THREE from 'three';

/**
 * The simulation still thinks in the units it always has: x and y are the
 * ground plane in "sim pixels", and z is height. Three wants y up, so the
 * bridge is (simX, simY, simZ) -> (x, z, y), scaled. Nothing in game/ had to
 * learn about 3D.
 */
export const SCALE = 0.05;          // sim px -> world units
export const EYE = 1.62;            // camera height above the feet, in units
export const TILE_U = 48 * SCALE;   // one sim tile, in units

export function ux(simX: number): number { return simX * SCALE; }
export function uy(simZ: number): number { return simZ * SCALE; }
export function uz(simY: number): number { return simY * SCALE; }

export function setPos(o: THREE.Object3D, simX: number, simY: number, simZ = 0): void {
  o.position.set(simX * SCALE, simZ * SCALE, simY * SCALE);
}

/** Sim facing (radians, 0 = +x, PI/2 = +y) from a three-space direction. */
export function facingFromDir(d: THREE.Vector3): number {
  return Math.atan2(d.z, d.x);
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** everything belonging to the current scene, cleared on transition */
  world: THREE.Group;
  /** parented to the camera: hands, weapon */
  rig: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  resize: (w: number, h: number) => void;
}

export function makeStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance',
    // keeps the frame readable for screenshots and captures
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#8fb8d8');
  scene.fog = new THREE.Fog('#8fb8d8', 40, 150);

  const camera = new THREE.PerspectiveCamera(74, 1, 0.05, 600);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const world = new THREE.Group();
  scene.add(world);

  const rig = new THREE.Group();
  camera.add(rig);

  const hemi = new THREE.HemisphereLight('#cfe4ff', '#5a4a34', 1.15);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#ffe6bd', 1.55);
  sun.position.set(30, 46, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  const d = 44;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  const resize = (w: number, h: number) => {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };

  return { renderer, scene, camera, world, rig, sun, hemi, resize };
}

/** Move the shadow camera with the player so the map can be large. */
export function trackSun(stage: Stage, simX: number, simY: number): void {
  const x = ux(simX), z = uz(simY);
  stage.sun.position.set(x + 30, 46, z + 18);
  stage.sun.target.position.set(x, 0, z);
  stage.sun.target.updateMatrixWorld();
}

export function clearGroup(g: THREE.Group): void {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    g.remove(c);
    disposeTree(c);
  }
}

export function disposeTree(o: THREE.Object3D): void {
  o.traverse((n) => {
    if ((n as THREE.InstancedMesh).isInstancedMesh) (n as THREE.InstancedMesh).dispose();
    const m = n as THREE.Mesh;
    if (m.geometry && !(m.geometry as { keep?: boolean }).keep) m.geometry.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const mm of list) if (!(mm as { keep?: boolean }).keep) mm.dispose?.();
  });
}
