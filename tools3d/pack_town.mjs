// KayKit Medieval Hexagon 소품 여러 개를 한 GLB로 (장면 하나 = 소품 하나, 장면 이름 = 소품 이름), 같은 텍스처는 하나로
import { NodeIO } from '@gltf-transform/core';
import { dedup, prune, mergeDocuments, unpartition } from '@gltf-transform/functions';
import fs from 'fs'; import path from 'path';
const [,, base, out, ...names] = process.argv;
const io = new NodeIO();
const doc = new (await import('@gltf-transform/core')).Document();
const find = (n) => { const stack=[base]; while (stack.length){const d=stack.pop(); for (const f of fs.readdirSync(d,{withFileTypes:true})){ const p=path.join(d,f.name); if (f.isDirectory()) stack.push(p); else if (f.name===n+'.gltf') return p; } } throw new Error(n); };
for (const n of names) {
  const src = await io.read(find(n));
  const map = mergeDocuments(doc, src);
  for (const s of src.getRoot().listScenes()) map.get(s).setName(n);
}
await doc.transform(unpartition(), dedup(), prune({ keepLeaves: false }));
await io.write(out, doc);
console.log(doc.getRoot().listScenes().map(s=>s.getName()).join(' '), fs.statSync(out).size);
