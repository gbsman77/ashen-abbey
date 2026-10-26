// KayKit 소품 여러 개를 한 GLB로 (장면 하나 = 소품 하나, 장면 이름 = 소품 이름), 같은 텍스처는 하나로. Medieval Hexagon → town, Dungeon Remastered → interior
// 집 안 묶음 예: node pack_town.mjs <Dungeon-Remastered>/addons interior.glb barrel_large keg bottle_A_brown bottle_B_green bottle_C_brown candle_lit candle_triple candle_thin_lit stool chest plate_food_A plate_food_B plate_small table_medium table_small sword_shield coin_stack_small shelf_small_candles crates_stacked
// 그다음 { "interior": base64 } 로 models3d/interior.json 에 담는다
// 들판 묶음: Medieval Hexagon 과 Halloween Bits 의 gltf 폴더를 한 폴더(<src>) 아래에 모아 두고
//   node pack_town.mjs <src> field.glb mountain_A mountain_B mountain_C rock_single_B rock_single_D crypt gravestone grave_A grave_B gravemarker_A gravemarker_B tree_dead_large tree_dead_medium tree_dead_small fence fence_broken post_lantern
//   → { "field": base64 } 로 models3d/field.json
// 던전 전투 무대 묶음 (Dungeon Remastered): QUANT=1 node pack_town.mjs <Dungeon-Remastered>/addons dungeon.glb wall wall_arched wall_broken pillar pillar_decorated floor_tile_large floor_dirt_large floor_dirt_large_rocky rubble_large torch_mounted banner_patternA_red candle_triple barrel_small box_stacked
//   → { "dungeon": base64 } 로 models3d/dungeon.json
// 1인칭 던전 소품 묶음 (Dungeon Remastered 의 .glb 와 Halloween Bits 의 gltf 를 한 폴더에, candle*·pillar* 는 Dungeon Remastered 것만):
//   QUANT=1 node pack_town.mjs <src> crawl.glb torch_mounted banner_patternA_red banner_thin_red banner_shield_red barrel_small barrel_large box_stacked crates_stacked box_small rubble_large rubble_half candle_triple candle_melted candle_lit sword_shield_broken shelves shelf_large table_small_decorated_A table_medium_broken keyring_hanging key chest trunk_medium_A column bottle_A_brown chair coin_stack_small keg coffin coffin_decorated skull skull_candle bone_A bone_B bone_C ribcage plaque_candles lantern_hanging lantern_standing grave_A_destroyed shrine_candles
//   → { "crawl": base64 } 로 models3d/crawl.json
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, mergeDocuments, unpartition, quantize } from '@gltf-transform/functions';
import fs from 'fs'; import path from 'path';
const [,, base, out, ...names] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = new (await import('@gltf-transform/core')).Document();
const find = (n) => { const stack=[base]; while (stack.length){const d=stack.pop(); for (const f of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,f.name); if (f.isDirectory()) stack.push(p); else if ([n+'.gltf', n+'.gltf.glb', n+'.glb'].includes(f.name)) return p; } } throw new Error(n); };
for (const n of names) {
  const src = await io.read(find(n));
  const map = mergeDocuments(doc, src);
  for (const s of src.getRoot().listScenes()) map.get(s).setName(n);
}
await doc.transform(unpartition(), dedup(), prune({ keepLeaves: false }), ...(process.env.QUANT ? [quantize()] : []));   // QUANT=1: 꼭짓점을 작은 정수로 (파일 절반쯤)
await io.write(out, doc);
console.log(doc.getRoot().listScenes().map(s=>s.getName()).join(' '), fs.statSync(out).size);
