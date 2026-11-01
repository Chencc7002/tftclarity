import { cpSync, copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const out = resolve(root, 'dist', `TFTClarityPet-${version}-win-x64`);
const configuredPets = JSON.parse(readFileSync(join(root, 'pets.json'), 'utf8'));
for (const pet of configuredPets) {
  const manifestPath = join(root, pet.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.renderer === 'glb' && !existsSync(join(dirname(manifestPath), manifest.model))) throw new Error('Character model is excluded; provide an appropriately licensed local asset before packaging.');
}
if (existsSync(out)) throw new Error('Output already exists; choose a new version to preserve the prior build: ' + out);
const runtime = resolve(root, 'node_modules/electron/dist');
if (!existsSync(join(runtime, 'electron.exe'))) throw new Error('Run node node_modules/electron/install.js first.');
mkdirSync(out, { recursive: true }); cpSync(runtime, out, { recursive: true });
renameSync(join(out, 'electron.exe'), join(out, 'TFTClarityPet.exe'));
const app = join(out, 'resources/app'); mkdirSync(app, { recursive: true });
for (const file of ['package.json', 'main.cjs', 'window-policy.cjs', 'pet-preload.cjs', 'chat-preload.cjs', 'pet.html', 'pet.css', 'pet.mjs', 'model-renderer.mjs', 'narration.mjs', 'bubble-lifetime.mjs', 'pets.json', 'THIRD_PARTY_NOTICES.md', 'vendor']) cpSync(join(root, file), join(app, file), { recursive: true });
mkdirSync(join(app, 'assets'), { recursive: true });
copyFileSync(join(root, 'assets/tray.png'), join(app, 'assets/tray.png'));
if (existsSync(join(root, 'assets/tray.ico'))) copyFileSync(join(root, 'assets/tray.ico'), join(app, 'assets/tray.ico'));
const pets = JSON.parse(readFileSync(join(root, 'pets.json'), 'utf8'));
for (const pet of pets) {
  const folder = dirname(pet.manifest);
  cpSync(join(root, folder), join(app, folder), { recursive: true });
}
copyFileSync(join(root, 'README.md'), join(out, '使用说明.md'));
writeFileSync(join(out, '启动桌宠.vbs'), 'Set sh = CreateObject("WScript.Shell")\r\nSet fso = CreateObject("Scripting.FileSystemObject")\r\nbase = fso.GetParentFolderName(WScript.ScriptFullName)\r\nsh.Run Chr(34) & base & "\\TFTClarityPet.exe" & Chr(34), 1, False\r\n');
console.log(out);
