// KayKit 소품 여러 개를 한 GLB로 (장면 하나 = 소품 하나, 장면 이름 = 소품 이름), 같은 텍스처는 하나로. Medieval Hexagon → town, Dungeon Remastered → interior
// 집 안 묶음 예: node pack_town.mjs <Dungeon-Remastered>/addons interior.glb barrel_large keg bottle_A_brown bottle_B_green bottle_C_brown candle_lit candle_triple candle_thin_lit stool chest plate_food_A plate_food_B plate_small table_medium table_small sword_shield coin_stack_small shelf_small_candles crates_stacked
// 그다음 { "interior": base64 } 로 models3d/interior.json 에 담는다
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, mergeDocuments, unpartition } from '@gltf-transform/functions';
import fs from 'fs'; import path from 'path';
const [,, base, out, ...names] = process.argv;
const io = new NodeIO();
const doc = new (await import('@gltf-transform/core')).Document();
const find = (n) => { const stack=[base]; while (stack.length){const d=stack.pop(); for (const f of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,f.name); if (f.isDirectory()) stack.push(p); else if ([n+'.gltf', n+'.gltf.glb', n+'.glb'].includes(f.name)) return p; } } throw new Error(n); };
for (const n of names) {
  const src = await io.read(find(n));
  const map = mergeDocuments(doc, src);
  for (const s of src.getRoot().listScenes()) map.get(s).setName(n);
}
await doc.transform(unpartition(), dedup(), prune({ keepLeaves: false }));
await io.write(out, doc);
console.log(doc.getRoot().listScenes().map(s=>s.getName()).join(' '), fs.statSync(out).size);
