// 몬스터 GLB (build_monsters.py) → models3d/mon_<이름>.json ({ "mon_<이름>": base64 }), 꼭짓점을 작은 정수로·동작 키를 줄여서
// usage: node pack_monsters.mjs <glb 폴더> <models3d 폴더> golem gravekeeper dragon ...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, resample } from '@gltf-transform/functions';
import fs from 'fs';
const [,, src, outDir, ...names] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const n of names) {
  const doc = await io.read(`${src}/${n}.glb`);
  await doc.transform(dedup(), resample(), prune(), quantize());
  const bin = await io.writeBinary(doc);
  fs.writeFileSync(`${outDir}/mon_${n}.json`, JSON.stringify({ ['mon_' + n]: Buffer.from(bin).toString('base64') }));
  console.log(n, fs.statSync(`${src}/${n}.glb`).size, '→', bin.length);
}
