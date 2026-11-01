import { _electron as electron } from 'playwright';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const out=resolve(root,'test-output/hair-review');mkdirSync(out,{recursive:true});
const source=readFileSync(resolve(root,'model-renderer.mjs'),'utf8').replaceAll("'./vendor/", "'../../vendor/").replace('return { render, setAction, sample, dispose,', 'return { debugModel: model, render, setAction, sample, dispose,');
writeFileSync(resolve(out,'diagnostic-renderer.mjs'),source);
const env={...process.env,TFT_PET_DATA_DIR:resolve(out,'profile-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:[root,'--pet-test'],env});
try {
  const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('#pet')?.dataset.petId==='prestige-gwen');
  await page.evaluate(async()=>{
      const {createModelRenderer}=await import('./test-output/hair-review/diagnostic-renderer.mjs');
      const m=await(await fetch('./assets/prestige-gwen/pet.json')).json();
      window.hairReview=await createModelRenderer(new URL('./assets/prestige-gwen/model.glb',location.href).href,m.camera);
      window.reviewMaterials=[];window.hairReview.debugModel.traverse(o=>{if(o.isMesh)for(const mat of Array.isArray(o.material)?o.material:[o.material])window.reviewMaterials.push({mat,visible:mat.visible,depthWrite:mat.depthWrite,side:mat.side,alphaTest:mat.alphaTest});});
  });
  const variants={original:{},mouthHidden:{Mouth_Base:{visible:false}},eyeHidden:{Eye_Base:{visible:false}},bodyHidden:{Body:{visible:false}},hairHidden:{Hair:{visible:false}},faceDouble:{Face:{side:2}},faceBack:{Face:{side:1}},mouthDouble:{Mouth_Base:{side:2}},alpha05:{Face:{alphaTest:0.5},Hair:{alphaTest:0.5}}};
  for(const [name,overrides] of Object.entries(variants)) {
    const data=await page.evaluate(overrides=>{
      for(const {mat,visible,depthWrite,side,alphaTest} of window.reviewMaterials){Object.assign(mat,{visible,depthWrite,side,alphaTest,transparent:['Hair','Face'].includes(mat.name)?true:mat.transparent},overrides[mat.name]??{});mat.needsUpdate=true;}
      return window.hairReview.render(0).toDataURL();
    },overrides);
    writeFileSync(resolve(out,name+'.png'),Buffer.from(data.split(',')[1],'base64'));
  }
  console.log('hair material variants rendered');
} finally {await app.close();}
