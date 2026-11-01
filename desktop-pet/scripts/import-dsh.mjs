// Reproducible, local-only import. Does not execute upstream scripts.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const upstream = resolve(root, '../.cache/dsh-pet-reference');
const files = ['state', 'affinity', 'remarks', 'client/spritesheet'];
for (const name of files) {
  const source = readFileSync(resolve(upstream, `src/${name}.ts`), 'utf8');
  const target = resolve(root, `vendor/dsh-pet/${name}.mjs`);
  mkdirSync(dirname(target), { recursive: true });
  const js = stripTypeScriptTypes(source, { mode: 'transform' }).replaceAll("'./remarks.ts'", "'./remarks.mjs'").replaceAll("'../state.ts'", "'../state.mjs'");
  writeFileSync(target, '// Adapted from dsh-pet 9ccb048c82b4ac4f6cc52fbb3ca92323b42c799b (Apache-2.0).\n// Changes: TypeScript erased with Node.js; relative imports changed to .mjs.\n' + js);
}
copyFileSync(resolve(upstream, 'LICENSE'), resolve(root, 'vendor/dsh-pet/LICENSE'));
copyFileSync(resolve(upstream, 'THIRD_PARTY_NOTICES.md'), resolve(root, 'vendor/dsh-pet/UPSTREAM_THIRD_PARTY_NOTICES.md'));
copyFileSync(resolve(root, '../src/app/small-window-ui/favicon.png'), resolve(root, 'assets/tray.png'));
console.log('Imported four pure modules; no DSH host, telemetry or install scripts.');
