import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['build/three.module.js', 'build/three.core.js', 'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js', 'LICENSE'];
for (const file of files) {
  const target = resolve(root, 'vendor/three', file); mkdirSync(dirname(target), { recursive: true });
  if (file.endsWith('.js')) writeFileSync(target, readFileSync(resolve(root, 'node_modules/three', file), 'utf8').replaceAll("from 'three'", "from '../../../build/three.module.js'"));
  else cpSync(resolve(root, 'node_modules/three', file), target);
}
console.log('Staged pinned Three.js renderer without remote imports.');
