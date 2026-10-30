// Personal trial: a loopback server and a separate desktop profile. Exiting
// the trial desktop also stops this server; nothing is installed as a service.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadLocalEnvironment } from '../../src/config/load-env.js';
import { createSmallWindowRuntime, createSmallWindowServer, resolveSmallWindowStructuredParserConfig } from '../../src/app/small-window-server.js';
import { createReactDecisionProvider } from '../../src/react/react-decision-provider.js';
import { SQLiteConversationBridgeStore } from '../../src/conversation/sqlite-conversation-bridge-store.js';
const petRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(petRoot, 'test-output/gwen-persona-trial');
mkdirSync(data, { recursive: true });
loadLocalEnvironment();
const config = resolveSmallWindowStructuredParserConfig();
if (!config.enabled || !config.apiKey) throw new Error('Local real model configuration is unavailable');
const store = await SQLiteConversationBridgeStore.open({ filePath: resolve(data, 'conversations.sqlite') });
const runtime = createSmallWindowRuntime({ companionPersonaMode: 'on', reactChatMode: 'on',
  conversationBridgeMode: 'on', conversationBridgeStore: store,
  reactDecisionProvider: createReactDecisionProvider({ ...config, thinkingMode: 'disabled' }) });
const server = createSmallWindowServer({ runtime });
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const url = `http://127.0.0.1:${server.address().port}/`;
writeFileSync(resolve(data, 'trial.json'), JSON.stringify({ url, persona: 'gwen-companion.v1', model: config.model, pid: process.pid }, null, 2));
console.log('Gwen trial ready: ' + url);
const env = { ...process.env, TFT_PET_SITE: url, TFT_PET_DATA_DIR: resolve(data, 'desktop-profile') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(resolve(petRoot, 'node_modules/electron/dist/electron.exe'), [petRoot], { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); server.close(); process.exitCode = 1; });
child.on('exit', () => { server.close(); store.database.close(); });
