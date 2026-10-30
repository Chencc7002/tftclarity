import * as THREE from './vendor/three/build/three.module.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';

// The GLB retains original geometry, textures and animation clips. The only
// material changes honor the author's visibility/order metadata and hide smear
// effects that are unsuitable for a tiny transparent overlay.
export async function createModelRenderer(url, config = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setSize(384, 416); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const gltf = await new GLTFLoader().loadAsync(url);
  const scene = new THREE.Scene(), model = gltf.scene; scene.add(model);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(2, 4, 5); scene.add(key);
  const materialVisibility = new Map();
  model.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      m.visible = m.userData.visible !== false && !(config.hideMaterials ?? ['Smears']).includes(m.name);
      materialVisibility.set(m, m.visible);
      if (m.transparent) { m.alphaTest = 0.025; m.depthWrite = false; }
      const override = config.materialOverrides?.[m.name];
      // Layered face/hair meshes need an explicit base order plus depth writes:
      // ordering alone puts rear hair over the chin; depth alone hides bangs.
      if (override?.doubleSided) m.side = THREE.DoubleSide;
      if (typeof override?.depthWrite === 'boolean') m.depthWrite = override.depthWrite;
      o.renderOrder = Math.max(o.renderOrder, m.userData.renderOrder ?? 0);
      if (Number.isFinite(override?.renderOrder)) o.renderOrder = override.renderOrder;
    }
    if (materials.every(m => !m.visible)) o.visible = false;
  });
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  const mixer = new THREE.AnimationMixer(model);
  const idle = clips.get(config.idle ?? 'Idle_Base');
  if (!idle) throw new Error('Model has no configured idle animation');
  let active = mixer.clipAction(idle).play(), current = idle.name;
  mixer.update(0); model.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  model.traverseVisible(o => { if (o.isMesh) { o.computeBoundingBox(); bounds.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, size.x / (384 / 416)) * (config.padding ?? 1.35);
  const camera = new THREE.OrthographicCamera(-height * 384 / 416 / 2, height * 384 / 416 / 2, height / 2, -height / 2, 0.01, height * 30);
  function face(degrees = config.azimuth ?? 0) {
    const a = THREE.MathUtils.degToRad(degrees), elevation = THREE.MathUtils.degToRad(config.elevation ?? 6), distance = height * 5;
    camera.position.set(center.x + Math.sin(a) * Math.cos(elevation) * distance, center.y + Math.sin(elevation) * distance, center.z + Math.cos(a) * Math.cos(elevation) * distance);
    camera.lookAt(center); camera.updateMatrixWorld();
  }
  face();
  function setAction(name, { once = false, immediate = false } = {}) {
    if (current === name && !immediate) return;
    const clip = clips.get(name) || idle;
    const hidden = config.actionHiddenMaterials?.[clip.name] ?? [];
    for (const [material, visible] of materialVisibility) material.visible = visible && !hidden.includes(material.name);
    const previous = active;
    active = mixer.clipAction(clip); active.reset(); active.enabled = true;
    active.setEffectiveTimeScale(1); active.setEffectiveWeight(1);
    active.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); active.clampWhenFinished = once;
    active.play();
    if (previous !== active) { if (immediate) previous.stop(); else active.crossFadeFrom(previous, 0.18, false); }
    current = clip.name;
  }
  function render(delta = 0) { mixer.update(delta); model.updateMatrixWorld(true); renderer.render(scene, camera); return renderer.domElement; }
  function sample(name, time, angle) {
    mixer.stopAllAction(); setAction(name, { immediate: true }); active.time = time; if (angle !== undefined) face(angle); render(0); return renderer.domElement;
  }
  function dispose() {
    mixer.stopAllAction(); mixer.uncacheRoot(model);
    const textures = new Set(), materials = new Set();
    model.traverse(o => { o.geometry?.dispose(); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); });
    for (const m of materials) { for (const value of Object.values(m)) if (value?.isTexture) textures.add(value); m.dispose(); }
    for (const t of textures) { t.source?.data?.close?.(); t.dispose(); }
    renderer.dispose(); renderer.forceContextLoss();
  }
  return { render, setAction, sample, dispose, clips: gltf.animations.map(c => ({ name: c.name, duration: c.duration })), bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
}
