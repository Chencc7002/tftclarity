import { _electron as electron } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'test-output/model-review'); mkdirSync(out, { recursive: true });
const env = { ...process.env, TFT_PET_DATA_DIR: resolve(out, 'profile-' + Date.now()) }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: [root, '--pet-test'], env });
try {
  const page = await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(() => document.querySelector('#pet')?.dataset.petId === 'prestige-gwen', null, {timeout:30000});
  await page.screenshot({path:resolve(out,'initial.png'),omitBackground:true});
  const inventory = await page.evaluate(async()=>{
    const {createModelRenderer} = await import('./model-renderer.mjs');
    const m=await (await fetch('./assets/prestige-gwen/pet.json')).json();
    window.reviewModel=await createModelRenderer(new URL('./assets/prestige-gwen/model.glb',location.href).href,m.camera);
    return {clips:window.reviewModel.clips,bounds:window.reviewModel.bounds};
  });
  writeFileSync(resolve(out,'inventory.json'),JSON.stringify({ ...inventory,errors },null,2));
  const candidates=['Idle_Base','Interact','Celebrate','Cast_Cycle','Damage_Hurt','Laugh01','Dance_Loop','Run'];
  for(const name of candidates) {
    const clip=inventory.clips.find(c=>c.name===name); const folder=resolve(out,name);mkdirSync(folder,{recursive:true});
    for(let i=0;i<12;i++) {
      const data=await page.evaluate(({name,time})=>window.reviewModel.sample(name,time).toDataURL('image/png'),{name,time:clip.duration*i/12});
      writeFileSync(resolve(folder,`${String(i).padStart(2,'0')}.png`),Buffer.from(data.split(',')[1],'base64'));
    }
    console.log('inspected',name,clip.duration);
  }
  for(const angle of [0,90,180,270]) {
    const data=await page.evaluate(angle=>window.reviewModel.sample('Idle_Base',1,angle).toDataURL('image/png'),angle);
    writeFileSync(resolve(out,`orientation-${angle}.png`),Buffer.from(data.split(',')[1],'base64'));
  }
  await page.evaluate(()=>window.reviewModel.dispose());
  console.log('model inspection complete',JSON.stringify(errors));
} finally {await app.close();}
