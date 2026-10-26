// 3D 지상 (설정의 "3D로 보기"). 걷기·사건·저장 규칙은 engine.js 의 격자 그대로 두고, 같은 지도를 3D로 세워 그리기만 한다.
// 지금은 마을 로엘 바깥만 3D (AREAS). 집 안과 들판은 2D 그대로.
// three.js 는 모듈판(index.html importmap 의 'three')을 켤 때 따로 불러 쓴다. 던전의 three.min.js 와 물체를 섞지 않는다.
(function () {
  'use strict';

  // ----- 바꿔 끼우는 곳 -----
  // 파티 3D 모델: models3d/<key>.json = { "<key>": base64 GLB }. 순서 = data.js party 순서 = 줄 서는 순서
  // keep: 보일 무기 메시 이름 (나머지 무기·책은 숨김) / 동작 이름은 Idle · Walking_A · Running_A
  const PARTY3D = [
    { key: 'warrior', keep: ['1H_Sword', 'Round_Shield'] },
    { key: 'priest', keep: ['1H_Wand'] },
    { key: 'mage', keep: ['2H_Staff'] }
  ];
  // 마을 사람 3D 모델: models3d/npc_<이름>.json (tools3d/build_npcs.py). 이름 = data.js 의 npc. h = 키 (주인공 키에 곱한다)
  // 처음 보일 때 따로 불러오고, 오기 전까지와 파일이 없을 때는 2D 그림 판(world/npc_*.png)으로 선다
  const NPC3D = {
    child: { h: 0.8 }, elder: { h: 1.0 }, farmer: { h: 1.02 }, granny: { h: 0.92 }, guard: { h: 1.1 }, hermit: { h: 0.98 },
    innkeeper: { h: 1.04 }, merchant: { h: 1.02 }, priest: { h: 1.02 }, smith: { h: 1.1 }, traveler: { h: 1.0 }, woman: { h: 0.98 }
  };
  const AREAS = { town: true };   // 3D로 그리는 지역
  const PROPS = 'town';           // models3d/town.json: KayKit Medieval Hexagon 소품 묶음 (장면 이름 = 소품 이름)
  const HERO_H = 1.1;             // 사람 키 (칸 단위, 한 칸 = 1)
  const MODEL_H = 2.3;            // 파티 모델 원래 키 (KayKit 뼈대와 같은 크기). 무기까지 재면 사람마다 달라져서 고정값으로 줄인다
  const GAP = 0.85;               // 줄 선 사람 사이 거리

  const D = window.DUNGEON;
  let THREE = null, GLTFLoader = null, mergeGeometries = null, cloneSkinned = null;
  let renderer = null, camera = null, sun = null, hemi = null;
  let props = null;               // 이름 → gltf 장면
  let party = [];                 // { root, mixer, acts, cur, pos, yaw }
  const scenes = {};              // 지역 → { scene, buildings, doors, water, spray, npcs, cols, rows }
  let cur = null, curArea = null;

  const W3 = window.World3D = {
    state: 'idle', // idle | loading | ready | failed
    wants: (id) => !!AREAS[id],
    get ready() { return W3.state === 'ready'; },
    load, frame, reset: () => { trail.length = 0; }
  };

  // ---------- 불러오기 ----------
  function parse(loader, b64) {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Promise((ok, fail) => loader.parse(bin.buffer, '', ok, fail));
  }
  let loading = null;
  function load(progress) {
    if (loading) return loading;
    W3.state = 'loading';
    const step = (() => { let n = 0; const total = 2 + PARTY3D.length; return () => progress && progress(++n / total); })();
    loading = (async () => {
      const [three, gl, bgu, sku] = await Promise.all([
        import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/BufferGeometryUtils.js'),
        import('three/addons/utils/SkeletonUtils.js')
      ]);
      THREE = three; GLTFLoader = gl.GLTFLoader; mergeGeometries = bgu.mergeGeometries; cloneSkinned = sku.clone;
      step();
      const loader = new GLTFLoader();
      const fetchPack = (name) => fetch('models3d/' + name + '.json').then((r) => { if (!r.ok) throw new Error(name); return r.json(); })
        .then((p) => parse(loader, p[name])).then((g) => { step(); return g; });
      const [town, ...chars] = await Promise.all([fetchPack(PROPS), ...PARTY3D.map((p) => fetchPack(p.key).catch(() => null))]);
      props = {};
      for (const s of town.scenes) { s.updateMatrixWorld(true); props[s.name] = s; }
      initRenderer();
      party = chars.map((g, i) => makeMember(g, PARTY3D[i]));
      W3.state = 'ready';
    })().catch((err) => { W3.state = 'failed'; loading = null; throw err; });
    return loading;
  }

  function initRenderer() {
    const canvas = document.getElementById('world3d');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    camera = new THREE.PerspectiveCamera(34, 4 / 3, 0.3, 120);
    hemi = new THREE.HemisphereLight(0xfff8ee, 0x6d7d5a, 1.55);
    sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
    sun.castShadow = true;
    const small = Math.min(screen.width, screen.height) < 600;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 70 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }

  // ---------- 파티 ----------
  const HIDE = /Shield|Sword|Staff|Wand|Spellbook|Crossbow|Knife|Throwable|Axe|Mug/;
  function makeMember(gltf, def) {
    if (!gltf) return makeStandIn(def);
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.frustumCulled = false;
      const n = o.name.replace(/_\d+$/, '');
      if (HIDE.test(n) && !def.keep.includes(n)) o.visible = false;
    });
    root.scale.setScalar(HERO_H / MODEL_H);
    const wrap = new THREE.Group(); wrap.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clip = (n) => THREE.AnimationClip.findByName(gltf.animations, n) || gltf.animations[0];
    const acts = { idle: mixer.clipAction(clip('Idle')), walk: mixer.clipAction(clip('Walking_A')), run: mixer.clipAction(clip('Running_A')) };
    acts.idle.play();
    return { root: wrap, mixer, acts, cur: 'idle', pos: new THREE.Vector3(), yaw: 0, still: 0 };
  }
  // 모델 파일이 없을 때: 색 기둥 하나로 자리만 지킨다
  function makeStandIn(def) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, HERO_H - 0.4, 4, 10), new THREE.MeshLambertMaterial({ color: 0xc8b48a }));
    m.position.y = HERO_H / 2; m.castShadow = true; g.add(m);
    return { root: g, mixer: null, acts: null, cur: 'idle', pos: new THREE.Vector3(), yaw: 0, still: 0 };
  }
  function setAnim(ch, name) {
    if (!ch.acts || ch.cur === name) return;
    const from = ch.acts[ch.cur], to = ch.acts[name];
    to.reset().play();
    from.crossFadeTo(to, 0.18, false);
    ch.cur = name;
  }

  // ---------- 마을 사람 ----------
  const npcGltf = {};   // 이름 → gltf | 'loading' | 'failed'
  function npcModel(name) {
    const g = npcGltf[name];
    if (g && g !== 'loading' && g !== 'failed') return g;
    if (!g && NPC3D[name]) {
      npcGltf[name] = 'loading';
      fetch('models3d/npc_' + name + '.json').then((r) => { if (!r.ok) throw new Error(name); return r.json(); })
        .then((p) => parse(new GLTFLoader(), p['npc_' + name]))
        .then((gl) => { npcGltf[name] = gl; }, () => { npcGltf[name] = 'failed'; });
    }
    return null;
  }
  function makeNpc(name, gltf) {
    const root = cloneSkinned(gltf.scene);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    root.scale.setScalar(HERO_H * NPC3D[name].h / MODEL_H);
    const wrap = new THREE.Group(); wrap.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const clip = (n) => THREE.AnimationClip.findByName(gltf.animations, n) || gltf.animations[0];
    const acts = { idle: mixer.clipAction(clip('Idle')), walk: mixer.clipAction(clip('Walking_A')) };
    // 여럿이 같은 박자로 움직이지 않게 시작점을 흩는다
    acts.idle.play(); acts.idle.time = Math.random() * acts.idle.getClip().duration;
    acts.walk.timeScale = 0.8;
    return { root: wrap, mixer, acts, cur: 'idle', yaw: null, still: 1, model: true, px: null, pz: null };
  }

  // ---------- 땅 그림 (지도 한 칸 = PPT 픽셀, 둘레 MARGIN 칸까지) ----------
  const PPT = 32, MARGIN = 10;
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // 칸 → 땅 종류: 0 풀 1 흙길 2 돌길 3 밭 4 물
  function groundKind(A, ch) {
    const ev = A.events[ch];
    if (ev) {
      if (ev.go && !ev.door) return 1;            // 마을 출구는 길
      ch = ev.ground || A.ground;
    }
    if (ch === ':') return 1;
    if (ch === 'p' || ch === 'o' || ch === 'k' || ch === 'W' || ch === 'G' || ch === 'R' || ch === 'C') return 2;
    if (ch === 'y') return 3;
    if (ch === 'w') return 4;
    return 0;
  }
  function paintGround(A) {
    const rows = A.map.length, cols = A.map[0].length;
    const GW = cols + MARGIN * 2, GH = rows + MARGIN * 2;
    // 칸마다 종류 (지도 밖은 풀, 출구 줄은 길이 이어진다)
    const kind = new Uint8Array(GW * GH);
    const exits = [];
    A.map.forEach((row, y) => [...row].forEach((ch, x) => {
      kind[(y + MARGIN) * GW + x + MARGIN] = groundKind(A, ch);
      const ev = A.events[ch];
      if (ev && ev.go && !ev.door) exits.push([x, y]);
    }));
    for (const [x, y] of exits) { // 출구 바깥으로 길을 지도 끝까지
      const dx = x === 0 ? -1 : x === cols - 1 ? 1 : 0, dy = y === 0 ? -1 : y === rows - 1 ? 1 : 0;
      for (let i = 1; i <= MARGIN; i++) kind[(y + MARGIN + dy * i) * GW + x + MARGIN + dx * i] = 1;
    }
    const K = (tx, ty, k) => (tx < 0 || ty < 0 || tx >= GW || ty >= GH ? 0 : kind[ty * GW + tx] === k ? 1 : 0);
    const cv = document.createElement('canvas');
    cv.width = GW * PPT; cv.height = GH * PPT;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(cv.width, cv.height), px = img.data;
    const C = {
      g1: [104, 160, 66], g2: [82, 136, 52], g3: [128, 176, 78],
      d1: [196, 160, 104], d2: [168, 132, 84],
      s1: [168, 162, 150], s2: [132, 126, 116], mortar: [96, 92, 86],
      soil: [112, 78, 48], soilD: [84, 56, 34],
      w1: [64, 128, 200], w2: [40, 92, 168]
    };
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    // 칸 경계에서 부드럽게 섞이도록 이웃 네 칸 가운데를 이어 본 값 (0~1)
    function weight(u, v, k) {
      const x = u - 0.5, y = v - 0.5, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const a = K(xi, yi, k), b = K(xi + 1, yi, k), c = K(xi, yi + 1, k), d = K(xi + 1, yi + 1, k);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
    for (let py = 0; py < cv.height; py++) {
      const v = (py + 0.5) / PPT;
      for (let pxi = 0; pxi < cv.width; pxi++) {
        const u = (pxi + 0.5) / PPT;
        const tx = Math.floor(u), ty = Math.floor(v);
        const n1 = vnoise(u * 0.35, v * 0.35), n2 = vnoise(u * 2.2 + 50, v * 2.2), n3 = hash(pxi, py);
        // 풀
        let col = mix(mix(C.g2, C.g1, n1), C.g3, Math.max(0, n2 - 0.55) * 1.6);
        col = mix(col, C.g2, n3 * 0.18);
        // 근처에 다른 땅이 없으면 여기서 끝 (대부분의 칸)
        let near = false;
        for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) { const t = tx + i, s = ty + j; if (t >= 0 && s >= 0 && t < GW && s < GH && kind[s * GW + t]) { near = true; break; } }
        if (near) {
          const edge = (vnoise(u * 3.1, v * 3.1) - 0.5) * 0.28;
          // 흙길
          const wd = weight(u, v, 1);
          if (wd > 0) {
            const a = smooth(0.38, 0.62, wd + edge);
            let dc = mix(C.d1, C.d2, vnoise(u * 4, v * 4) * 0.8 + n3 * 0.2);
            if (hash(pxi >> 2, py >> 2) > 0.93) dc = mix(dc, [150, 120, 80], 0.6); // 작은 돌
            col = mix(col, dc, a);
          }
          // 돌길: 엇갈린 네모 돌
          const wc = weight(u, v, 2);
          if (wc > 0) {
            const a = smooth(0.45, 0.55, wc + edge * 0.4);
            const su = u * 3, sv = v * 4, row = Math.floor(sv), off = (row % 2) * 0.5;
            const cu = su + off, ci = Math.floor(cu);
            const gx = Math.min(cu - ci, 1 - (cu - ci)), gy = Math.min(sv - row, 1 - (sv - row));
            const stone = mix(C.s2, C.s1, hash(ci, row) * 0.8 + n3 * 0.2);
            const sc = Math.min(gx * 3, gy * 4) < 0.16 ? C.mortar : stone;
            col = mix(col, sc, a);
          }
          // 밭: 가로 이랑
          const ws = weight(u, v, 3);
          if (ws > 0) {
            const a = smooth(0.45, 0.55, ws + edge * 0.3);
            const furrow = Math.abs(((v * 3) % 1) - 0.5) * 2;
            col = mix(col, mix(C.soil, C.soilD, smooth(0.6, 1, furrow) * 0.8 + n3 * 0.2), a);
          }
          // 물 (가장자리는 흙빛, 안쪽일수록 짙게)
          const ww = weight(u, v, 4);
          if (ww > 0) {
            const a = smooth(0.3, 0.5, ww + edge * 0.5);
            col = mix(col, C.d2, a);
            const b = smooth(0.45, 0.6, ww + edge * 0.5);
            col = mix(col, mix(C.w1, C.w2, smooth(0.6, 1, ww)), b);
          }
        }
        const o = (py * cv.width + pxi) * 4;
        px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 꽃밭: 작은 점
    A.map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ',') return;
      for (let i = 0; i < 14; i++) {
        const r = hash(x * 31 + i, y * 17);
        ctx.fillStyle = ['#f4efe2', '#f2d24a', '#e8789a', '#d2443a', '#b48ae0'][Math.floor(hash(i, x + y * 99) * 5)];
        ctx.beginPath();
        ctx.arc((x + MARGIN + 0.1 + 0.8 * r) * PPT, (y + MARGIN + 0.1 + 0.8 * hash(y + i * 7, x)) * PPT, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }));
    return { cv, GW, GH };
  }

  // ---------- 재질 ----------
  const MAT = {};
  function canvasTex(size, paint, rep) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    paint(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (rep) t.repeat.set(rep, rep);
    return t;
  }
  function materials() {
    if (MAT.plaster) return MAT;
    const L = (o) => new THREE.MeshLambertMaterial(o);
    const speck = (base, dark, n) => (g, s) => {
      g.fillStyle = base; g.fillRect(0, 0, s, s);
      for (let i = 0; i < n; i++) { g.fillStyle = dark; g.globalAlpha = Math.random() * 0.12; g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 2 + Math.random() * 6); }
      g.globalAlpha = 1;
    };
    // 기와: 한 장 = 가로 0.5 · 세로 0.33 (텍스처 한 장 = 2×2 칸)
    const tiles = (base, line) => (g, s) => {
      g.fillStyle = base; g.fillRect(0, 0, s, s);
      const rw = s / 6, cw = s / 4;
      for (let r = 0; r < 6; r++) for (let c = -1; c < 5; c++) {
        const x = c * cw + (r % 2) * cw / 2, y = r * rw;
        g.fillStyle = 'rgba(0,0,0,' + (0.05 + Math.random() * 0.12) + ')';
        g.fillRect(x + 1, y + 1, cw - 2, rw - 2);
        g.fillStyle = line; g.fillRect(x, y + rw - 3, cw, 3); g.fillRect(x, y, 2, rw);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 3, y + 2, cw - 6, 3);
      }
    };
    const stones = (g, s) => {
      g.fillStyle = '#6e6a62'; g.fillRect(0, 0, s, s);
      const rh = s / 8;
      for (let r = 0; r < 8; r++) for (let x = (r % 2) * -s / 10; x < s; ) {
        const w = s / 6 + Math.random() * s / 8, v = 150 + Math.random() * 45 | 0;
        g.fillStyle = 'rgb(' + v + ',' + (v - 4) + ',' + (v - 12) + ')';
        g.fillRect(x + 2, r * rh + 2, w - 4, rh - 4);
        x += w;
      }
    };
    const planks = (g, s) => {
      g.fillStyle = '#7a4e2c'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 4; i++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(i * s / 4, 0, 3, s); g.fillStyle = 'rgba(255,220,180,0.08)'; g.fillRect(i * s / 4 + 6, 0, 4, s); }
    };
    Object.assign(MAT, {
      plaster: L({ color: 0xffffff, map: canvasTex(128, speck('#efe3c8', '#8a7a5a', 120)) }),
      stone: L({ color: 0xffffff, map: canvasTex(256, stones) }),
      timber: L({ color: 0x5c3b22 }),
      roof: L({ color: 0xffffff, map: canvasTex(256, tiles('#b5432d', '#7e2a1c')) }),
      slate: L({ color: 0xffffff, map: canvasTex(256, tiles('#566984', '#36445a')) }),
      ridge: L({ color: 0x7a2a1c }),
      ridgeSlate: L({ color: 0x36445a }),
      door: L({ color: 0xffffff, map: canvasTex(64, planks) }),
      dark: new THREE.MeshBasicMaterial({ color: 0x16100c }),
      glass: new THREE.MeshLambertMaterial({ color: 0x2c4466, emissive: 0x1a2436 }),
      stained: new THREE.MeshLambertMaterial({ color: 0x6a5aa0, emissive: 0x2a2048 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.7, roughness: 0.35 }),
      iron: new THREE.MeshLambertMaterial({ color: 0x2e2c2a }),
      wood: L({ color: 0x8a5a32 }),
      leaf: L({ color: 0x4f8a3a, flatShading: true }),
      leafD: L({ color: 0x3d7030, flatShading: true }),
      pot: L({ color: 0xb0603a }),
      water: new THREE.MeshStandardMaterial({ color: 0x4f8fd8, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82 }),
      lamp: new THREE.MeshBasicMaterial({ color: 0xffd890 }),
      canvasR: L({ color: 0xc23a2c }), canvasW: L({ color: 0xf2ead8 }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
    });
    return MAT;
  }

  // 상자 면마다 월드 좌표로 UV (질감이 크기에 따라 늘어나지 않게). s = 1칸에 텍스처 몇 장
  function worldUV(geo, s) {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) * s, p.getZ(i) * s);
      else if (ax >= az) uv.setXY(i, p.getZ(i) * s, p.getY(i) * s);
      else uv.setXY(i, p.getX(i) * s, p.getY(i) * s);
    }
    return geo;
  }

  // 재질별로 모아 한 덩어리로 합친다 (건물 하나에 그리기 호출 몇 번만)
  function Batch() {
    const parts = new Map();
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    return {
      add(geo, mat, x, y, z, rx = 0, ry = 0, uv = 0, uvLocal = false) {
        if (uv && uvLocal) worldUV(geo, uv);
        geo.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, 0)), new THREE.Vector3(1, 1, 1)));
        if (uv && !uvLocal) worldUV(geo, uv);
        if (!parts.has(mat)) parts.set(mat, []);
        parts.get(mat).push(geo.index ? geo : geo);
      },
      box(w, h, d, mat, x, y, z, uv) { this.add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, 0, 0, uv); },
      build(group, own) {
        for (const [mat, list] of parts) {
          const g = mergeGeometries(list.map((x) => (x.index ? x : x)), false);
          const mesh = new THREE.Mesh(g, own ? mat.clone() : mat);
          mesh.castShadow = mesh.receiveShadow = true;
          group.add(mesh);
        }
        return group;
      }
    };
  }

  // ---------- 건물: 붙어 있는 지붕(R·C)·벽(W·G)·문 칸 묶음 하나 = 집 한 채 ----------
  const SIGNS = [['여관', '여관'], ['대장간', '대장간'], ['약초', '약초']];
  function findBuildings(A) {
    const map = A.map, rows = map.length, cols = map[0].length, seen = {};
    const part = (x, y) => {
      const ch = map[y] && map[y][x];
      if (!ch) return false;
      if ('RWCG'.includes(ch)) return true;
      const ev = A.events[ch];
      return !!(ev && ev.door);
    };
    const out = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (seen[x + ',' + y] || !part(x, y)) continue;
      const b = { x0: x, x1: x, y0: y, y1: y, doors: [], church: false };
      const q = [[x, y]]; seen[x + ',' + y] = true;
      while (q.length) {
        const [cx, cy] = q.pop(), ch = map[cy][cx];
        b.x0 = Math.min(b.x0, cx); b.x1 = Math.max(b.x1, cx); b.y0 = Math.min(b.y0, cy); b.y1 = Math.max(b.y1, cy);
        if (ch === 'C' || ch === 'G') b.church = true;
        const ev = A.events[ch];
        if (ev && ev.door) b.doors.push({ x: cx, y: cy, name: ev.name });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!seen[nx + ',' + ny] && part(nx, ny)) { seen[nx + ',' + ny] = true; q.push([nx, ny]); }
        }
      }
      out.push(b);
    }
    return out;
  }

  function signTexture(text) {
    return canvasTex(128, (g, s) => {
      g.fillStyle = '#5a3a20'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#7a5230'; g.fillRect(6, 6, s - 12, s - 12);
      g.fillStyle = '#f4e4b8';
      g.font = '700 ' + (text.length > 2 ? 34 : 46) + 'px "Nanum Myeongjo", serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, s / 2, s / 2 + 3);
    });
  }

  function makeBuilding(b, scene, doors) {
    const M = materials();
    const church = b.church;
    const x0 = b.x0, x1 = b.x1 + 1, w = x1 - x0, cx = (x0 + x1) / 2;
    const zf = b.y1 + 0.72, zb = b.y0 + 0.12, depth = zf - zb, zc = (zf + zb) / 2;
    const wallH = church ? 2.15 : 1.7, roofH = church ? 1.55 : 1.25, base = 0.32;
    const B = Batch();
    const wallMat = church ? M.stone : M.plaster;
    // 돌 밑단 + 벽
    B.box(w + 0.06, base, depth + 0.06, M.stone, cx, base / 2, zc, 1);
    B.box(w, wallH - base, depth, wallMat, cx, base + (wallH - base) / 2, zc, church ? 1 : 2);
    // 박공 (양 끝 세모 벽)
    for (const side of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(-depth / 2, 0); sh.lineTo(depth / 2, 0); sh.lineTo(0, roofH); sh.closePath();
      const g = new THREE.ShapeGeometry(sh);
      g.rotateY(side * Math.PI / 2);
      g.translate(side > 0 ? x1 : x0, wallH, zc);
      worldUV(g, church ? 1 : 2);
      B.add(g, wallMat, 0, 0, 0);
    }
    // 지붕: 용마루는 동서로, 앞뒤 두 장 (처마는 조금 내민다)
    const hd = depth / 2 + 0.32, ang = Math.atan2(roofH, hd), len = Math.hypot(hd, roofH) + 0.04;
    const roofMat = church ? M.slate : M.roof;
    for (const side of [1, -1]) {
      const g = new THREE.BoxGeometry(w + 0.5, 0.1, len);
      B.add(g, roofMat, cx, wallH + roofH / 2 + 0.05, zc + side * hd / 2, side * ang, 0, 0.5, true);
    }
    B.box(w + 0.56, 0.14, 0.18, church ? M.ridgeSlate : M.ridge, cx, wallH + roofH + 0.06, zc);
    // 앞면: 나무 기둥·보 (돌 성당은 없음), 창, 문
    const door = b.doors[0];
    const dX = door ? door.x + 0.5 : null;
    if (!church) {
      for (let px = x0; px <= x1 + 0.01; px += 2) B.box(0.1, wallH - base, 0.06, M.timber, Math.min(px, x1) + (px === x0 ? 0.05 : px >= x1 ? -0.05 : 0), base + (wallH - base) / 2, zf + 0.02);
      B.box(w, 0.09, 0.06, M.timber, cx, wallH - 0.05, zf + 0.02);
      B.box(w, 0.08, 0.06, M.timber, cx, base + 0.04, zf + 0.02);
      for (const sx of [x0 + 0.04, x1 - 0.04]) B.box(0.08, wallH - base, depth, M.timber, sx, base + (wallH - base) / 2, zc); // 모서리
      B.box(w, 0.08, 0.06, M.timber, cx, wallH - 0.05, zb - 0.02);
    }
    const segs = [];
    if (church) for (let px = x0 + 1; px < x1 - 0.5; px += 2) segs.push(px + 0.5);
    else for (let px = x0; px < x1 - 0.01; px += 2) segs.push(px + Math.min(2, x1 - px) / 2);
    for (const sx of segs) {
      if (dX !== null && Math.abs(sx - dX) < (church ? 1.4 : 0.9)) continue;
      const ww = church ? 0.34 : 0.5, wh = church ? 0.95 : 0.46, wy = church ? 1.2 : 1.05;
      B.box(ww + 0.12, wh + 0.12, 0.06, M.timber, sx, wy, zf + 0.03);
      B.box(ww, wh, 0.07, church ? M.stained : M.glass, sx, wy, zf + 0.04);
      if (!church) {
        B.box(0.05, wh, 0.08, M.timber, sx, wy, zf + 0.05);
        B.box(ww + 0.16, 0.06, 0.16, M.timber, sx, wy - wh / 2 - 0.08, zf + 0.08); // 창턱
        if (hash(sx * 7, b.y0) > 0.45) B.box(ww + 0.06, 0.1, 0.12, M.leaf, sx, wy - wh / 2 - 0.02, zf + 0.1); // 꽃 상자
      }
    }
    // 굴뚝
    if (!church) B.box(0.34, 1.2, 0.34, M.stone, x0 + w * 0.72, wallH + roofH * 0.55, zc - depth * 0.22, 1);
    // 성당 종탑: 문 위로 솟는다
    let doorZ = zf;
    if (church && door) {
      const tw = 1.5, tz0 = zf - 1.3, tz1 = zf + 0.28, th = wallH + roofH + 1.1;
      B.box(tw, th, tz1 - tz0, M.stone, dX, th / 2, (tz0 + tz1) / 2, 1);
      const cone = new THREE.ConeGeometry(tw * 0.78, 1.5, 4); cone.rotateY(Math.PI / 4);
      B.add(cone, M.slate, dX, th + 0.75, (tz0 + tz1) / 2);
      B.box(0.06, 0.5, 0.06, M.gold, dX, th + 1.7, (tz0 + tz1) / 2);
      B.box(0.28, 0.06, 0.06, M.gold, dX, th + 1.78, (tz0 + tz1) / 2);
      const ring = new THREE.CircleGeometry(0.3, 16);
      B.add(ring, M.stained, dX, th - 0.75, tz1 + 0.01);
      doorZ = tz1;
    }
    const group = new THREE.Group();
    B.build(group, true);
    // 문 (따로 움직인다): 안쪽 어둠 + 문짝 (경첩은 왼쪽)
    if (door) {
      const dw = church ? 0.82 : 0.72, dh = church ? 1.35 : 1.15;
      const fr = Batch();
      fr.box(dw + 0.16, 0.1, 0.1, M.timber, dX, dh + 0.05, doorZ + 0.03);
      fr.box(0.08, dh, 0.1, M.timber, dX - dw / 2 - 0.04, dh / 2, doorZ + 0.03);
      fr.box(0.08, dh, 0.1, M.timber, dX + dw / 2 + 0.04, dh / 2, doorZ + 0.03);
      fr.box(dw + 0.3, 0.06, 0.3, M.stone, dX, 0.03, doorZ + 0.12);
      fr.build(group, true);
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), M.dark.clone());
      hole.position.set(dX, dh / 2, doorZ + 0.005); group.add(hole);
      const pivot = new THREE.Group(); pivot.position.set(dX - dw / 2, 0, doorZ + 0.02);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.05), M.door.clone());
      leaf.position.set(dw / 2, dh / 2, 0); leaf.castShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), M.iron); knob.position.set(dw - 0.12, dh * 0.5, 0.04);
      pivot.add(leaf); leaf.add(knob);
      group.add(pivot);
      doors.push({ pivot, x: door.x, y: door.y, open: 0 });
      // 간판
      const sign = SIGNS.find(([k]) => door.name.includes(k));
      if (sign) {
        const sx = dX + dw / 2 + 0.55;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), M.iron.clone()); arm.position.set(sx, 1.55, zf + 0.25); group.add(arm);
        const bd = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.04), [M.timber, M.timber, M.timber, M.timber, new THREE.MeshLambertMaterial({ map: signTexture(sign[1]) }), M.timber]);
        bd.position.set(sx, 1.25, zf + 0.42); bd.castShadow = true; group.add(bd);
      }
    }
    scene.add(group);
    group.userData.box = new THREE.Box3().setFromObject(group);
    return group;
  }

  // ---------- 소품 ----------
  // KayKit 소품을 여러 자리에 한꺼번에 (InstancedMesh). list: [{x, z, s, r, y}]
  function scatter(scene, name, list) {
    if (!list.length || !props[name]) return;
    const src = props[name], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    src.traverse((m) => {
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, list.length);
      list.forEach((p, i) => {
        m4.compose(new THREE.Vector3(p.x, p.y || 0, p.z), q.setFromAxisAngle(up, p.r || 0), new THREE.Vector3(p.s, p.s, p.s)).multiply(m.matrixWorld);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = im.receiveShadow = true; im.frustumCulled = false;
      scene.add(im);
    });
  }
  // 코드로 만든 모양을 여러 자리에 (InstancedMesh). list: [{x, y, z, sx, sy, sz, r, color}]
  function instances(scene, geo, mat, list, shadow = true) {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    list.forEach((p, i) => {
      m4.compose(new THREE.Vector3(p.x, p.y || 0, p.z), q.setFromAxisAngle(up, p.r || 0), new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
      im.setMatrixAt(i, m4);
      if (p.color != null) im.setColorAt(i, c.set(p.color));
    });
    im.castShadow = shadow; im.receiveShadow = true; im.frustumCulled = false;
    scene.add(im);
    return im;
  }

  function buildArea(id) {
    const t0 = performance.now();
    const A = D.areas[id], map = A.map, rows = map.length, cols = map[0].length;
    const M = materials();
    const scene = new THREE.Scene();
    const SKY = 0xa8cfe0;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 20, 42);
    scene.add(hemi.clone());
    const light = sun.clone(); light.shadow = sun.shadow.clone(); light.castShadow = true;
    scene.add(light, light.target);
    const S3 = { scene, sun: light, buildings: [], doors: [], npcs: new Map(), cols, rows, A, spray: null, water: null };
    const at = (x, y) => (map[y] && map[y][x]) || null;
    const R = (x, y, k = 0) => hash(x * 13 + k * 101, y * 7 + k * 37);

    // 땅
    const { cv, GW, GH } = paintGround(A);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(cols / 2, 0, rows / 2); ground.receiveShadow = true;
    scene.add(ground);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x5f9440 }));
    far.rotation.x = -Math.PI / 2; far.position.set(cols / 2, -0.02, rows / 2); scene.add(far);

    // 건물
    for (const b of findBuildings(A)) S3.buildings.push(makeBuilding(b, scene, S3.doors));

    // 지도 칸마다
    const L = { trees: { tree_single_A: [], tree_single_B: [], trees_B_small: [] }, barrel: [], well: [], hedge: [], post: [], rail: [], crop: [], cropLeaf: [], grass: [], lily: [], reed: [], pot: [], bush: [], lampPost: [], lampHead: [], waterTiles: [] };
    const outer = (x, y) => x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      const cx = x + 0.5, cz = y + 0.5;
      const ev = A.events[ch];
      if (ch === 't') {
        // 남쪽 끝 줄은 낮은 덤불 (카메라와 주인공 사이를 가리지 않게)
        if (y === rows - 1) L.trees.trees_B_small.push({ x: cx, z: cz + 0.2, s: 1.15 + R(x, y) * 0.3, r: R(x, y, 1) * 6 });
        else L.trees[R(x, y) < 0.5 ? 'tree_single_A' : 'tree_single_B'].push({ x: cx + (R(x, y, 2) - 0.5) * 0.2, z: cz + (R(x, y, 3) - 0.5) * 0.2, s: (outer(x, y) ? 2.2 : 2.0) + R(x, y, 4) * 0.5, r: R(x, y, 1) * 6 });
      } else if (ch === 'v') {
        L.barrel.push({ x: cx + (R(x, y) - 0.5) * 0.2, z: cz, s: 2.6, r: R(x, y, 1) * 6 });
      } else if (ch === 'u') {
        makeWell(scene, cx, cz);
        L.well.push({ x: cx + 0.3, z: cz + 0.36, s: 2.4, r: 0.4 });
      } else if (ch === 'h') {
        for (let i = 0; i < 3; i++) L.hedge.push({ x: cx + (i - 1) * 0.3 + (R(x, y, i) - 0.5) * 0.1, y: 0.28, z: cz + (R(x, y, i + 5) - 0.5) * 0.15, sx: 0.42 + R(x, y, i) * 0.1, sy: 0.34 + R(x, y, i + 1) * 0.1, sz: 0.42, r: R(x, y, i) * 6, color: R(x, y, i + 2) < 0.5 ? 0x3f7a32 : 0x4c8a38 });
      } else if (ch === 'f') {
        L.post.push({ x: cx, y: 0.3, z: cz, sx: 0.09, sy: 0.6, sz: 0.09 });
        if (at(x + 1, y) === 'f') for (const h of [0.22, 0.45]) L.rail.push({ x: cx + 0.5, y: h, z: cz, sx: 1, sy: 0.06, sz: 0.04 });
        if (at(x, y + 1) === 'f') for (const h of [0.22, 0.45]) L.rail.push({ x: cx, y: h, z: cz + 0.5, sx: 0.04, sy: 0.06, sz: 1 });
      } else if (ch === 'P') {
        L.pot.push({ x: cx, y: 0.14, z: cz, sx: 1, sy: 1, sz: 1 });
        L.bush.push({ x: cx, y: 0.48, z: cz, sx: 0.3, sy: 0.32, sz: 0.3, r: R(x, y) * 6, color: 0x4c8a38 });
      } else if (ch === 'l') {
        L.lampPost.push({ x: cx, y: 0.75, z: cz, sx: 1, sy: 1, sz: 1 });
        L.lampHead.push({ x: cx, y: 1.5, z: cz, sx: 1, sy: 1, sz: 1 });
      } else if (ch === 'w') {
        L.waterTiles.push([x, y]);
        if (R(x, y) < 0.55) L.lily.push({ x: cx + (R(x, y, 1) - 0.5) * 0.6, z: cz + (R(x, y, 2) - 0.5) * 0.6, s: 3, r: R(x, y, 3) * 6, y: 0.02 });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy) !== 'w' && R(x + dx, y + dy, 9) < 0.5) L.reed.push({ x: cx + dx * 0.45, z: cz + dy * 0.45, s: 3, r: R(x, y, 5) * 6 });
      } else if (ch === 'k') {
        makeStall(scene, cx, cz, at(x, y + 1) === 'p' || at(x, y + 1) === 'k' ? 0 : Math.PI);
      } else if (ch === 'o') {
        S3.spray = makeFountain(scene, cx, cz);
      } else if (ch === 'y') {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          const px = x + 0.18 + i * 0.32, pz = y + 0.18 + j * 0.33;
          L.crop.push({ x: px, y: 0.1, z: pz, sx: 1, sy: 0.8 + R(x * 3 + i, y * 3 + j) * 0.5, sz: 1, r: R(i, j) * 6 });
        }
      } else if (ev && ev.icon === 'sign') {
        makeSignpost(scene, cx, cz, A.name);
      } else if (ev && ev.icon) {
        iconSprite(scene, ev.icon, cx, cz);
      }
      // 풀 포기 (풀밭 칸)
      const gk = groundKind(A, ch);
      if (gk === 0 && !ev && ch !== 't' && R(x, y, 7) < 0.7) for (let i = 0; i < 2; i++) L.grass.push({ x: x + 0.1 + R(x, y, i + 10) * 0.8, y: 0.06, z: y + 0.1 + R(x, y, i + 20) * 0.8, sx: 1, sy: 0.7 + R(x, y, i) * 0.6, sz: 1, r: R(x, y, i + 30) * 6, color: R(x, y, i + 40) < 0.5 ? 0x4f8a34 : 0x6aa244 });
    }));
    for (const [n, list] of Object.entries(L.trees)) scatter(scene, n, list);
    scatter(scene, 'barrel', L.barrel);
    scatter(scene, 'bucket_water', L.well);
    scatter(scene, 'waterlily_A', L.lily.filter((_, i) => i % 2 === 0));
    scatter(scene, 'waterlily_B', L.lily.filter((_, i) => i % 2 === 1));
    scatter(scene, 'waterplant_B', L.reed);
    instances(scene, new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ flatShading: true }), L.hedge);
    instances(scene, new THREE.BoxGeometry(1, 1, 1), M.wood, L.post);
    instances(scene, new THREE.BoxGeometry(1, 1, 1), M.wood, L.rail);
    instances(scene, new THREE.ConeGeometry(0.1, 0.24, 5), M.leaf, L.crop);
    instances(scene, new THREE.CylinderGeometry(0.16, 0.12, 0.28, 8), M.pot, L.pot);
    instances(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), L.bush);
    instances(scene, new THREE.ConeGeometry(0.035, 0.14, 3), new THREE.MeshLambertMaterial({}), L.grass, false);
    instances(scene, new THREE.CylinderGeometry(0.035, 0.05, 1.5, 6), M.iron, L.lampPost);
    instances(scene, new THREE.BoxGeometry(0.16, 0.22, 0.16), M.lamp, L.lampHead, false);
    instances(scene, new THREE.ConeGeometry(0.15, 0.12, 4), M.iron, L.lampHead.map((p) => ({ ...p, y: 1.67, r: Math.PI / 4 })));
    // 연못 물 (흔들리는 빛)
    if (L.waterTiles.length) {
      const geos = L.waterTiles.map(([x, y]) => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.translate(x + 0.5, 0.025, y + 0.5); return g; });
      const wmat = M.water.clone();
      wmat.map = canvasTex(128, (g, s) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, s, s);
        g.strokeStyle = 'rgba(160,200,255,0.9)'; g.lineWidth = 2;
        for (let i = 0; i < 14; i++) { g.beginPath(); const x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); g.quadraticCurveTo(x + 10, y - 4, x + 22, y); g.stroke(); }
      });
      const water = new THREE.Mesh(mergeGeometries(geos), wmat);
      water.receiveShadow = true;
      scene.add(water); S3.water = wmat.map;
    }
    // 지도 밖: 숲, 그 너머 언덕과 산. 출구 길은 비워 둔다
    const exitRows = [];
    map.forEach((row, y) => [...row].forEach((ch, x) => { const ev = A.events[ch]; if (ev && ev.go && !ev.door) exitRows.push([x, y]); }));
    const forest = { trees_A_large: [], trees_A_medium: [], trees_B_large: [], trees_B_medium: [] }, hills = { hills_A_trees: [], mountain_A_grass_trees: [], mountain_B_grass_trees: [] };
    const names = Object.keys(forest);
    for (let y = -MARGIN - 6; y < rows + MARGIN + 6; y += 1.6) for (let x = -MARGIN - 6; x < cols + MARGIN + 6; x += 1.6) {
      const jx = x + (R(x * 5 | 0, y * 5 | 0, 1) - 0.5) * 1.2, jy = y + (R(x * 5 | 0, y * 5 | 0, 2) - 0.5) * 1.2;
      const out = Math.max(-jx, jx - cols, -jy, jy - rows);
      if (out < 0.9) continue;
      if (exitRows.some(([ex, ey]) => Math.abs(jy - ey - 0.5) < 2.2 && (ex === 0 ? jx < 1 : jx > cols - 1))) continue;
      if (jy > rows && out < 3) continue; // 남쪽 바로 앞은 비워 둔다 (카메라 쪽)
      if (out > MARGIN + 1) {
        if (R(x * 3 | 0, y * 3 | 0, 7) < 0.12) hills[Object.keys(hills)[Math.floor(R(x | 0, y | 0, 8) * 3)]].push({ x: jx, z: jy, s: 3 + R(x | 0, y | 0, 9) * 2.5, r: R(x | 0, y | 0, 3) * 6 });
        continue;
      }
      forest[names[Math.floor(R(x * 7 | 0, y * 7 | 0, 4) * names.length)]].push({ x: jx, z: jy, s: 1.9 + R(x * 3 | 0, y * 3 | 0, 5) * 0.8, r: R(x | 0, y | 0, 6) * 6 });
    }
    for (const [n, list] of Object.entries(forest)) scatter(scene, n, list);
    for (const [n, list] of Object.entries(hills)) scatter(scene, n, list);
    if (location.hash === '#debug') console.log('[t] build', id, Math.round(performance.now() - t0), 'ms');
    return S3;
  }

  function makeStall(scene, x, z, rot) {
    const M = materials(), B = Batch();
    B.box(0.86, 0.5, 0.42, M.wood, 0, 0.25, -0.12);
    B.box(0.92, 0.05, 0.48, M.timber, 0, 0.52, -0.12);
    for (const [px, pz] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.22], [0.42, 0.22]]) B.box(0.05, 1.25, 0.05, M.timber, px, 0.62, pz);
    for (let i = 0; i < 5; i++) {
      const g = new THREE.BoxGeometry(0.2, 0.04, 0.78);
      B.add(g, i % 2 ? M.canvasW : M.canvasR, -0.4 + i * 0.2, 1.3, -0.08, 0.28);
    }
    for (let i = 0; i < 6; i++) {
      const g = new THREE.SphereGeometry(0.06, 6, 4);
      B.add(g, i % 3 === 0 ? M.canvasR : i % 3 === 1 ? M.pot : M.leaf, -0.3 + i * 0.12, 0.6, -0.12 + (i % 2) * 0.1);
    }
    const g = B.build(new THREE.Group());
    g.position.set(x, 0, z); g.rotation.y = rot;
    scene.add(g);
  }
  function makeFountain(scene, x, z) {
    const M = materials(), B = Batch();
    B.add(new THREE.CylinderGeometry(0.76, 0.8, 0.38, 12), M.stone, 0, 0.19, 0, 0, 0, 0);
    B.add(new THREE.CylinderGeometry(0.12, 0.16, 1.0, 8), M.stone, 0, 0.6, 0);
    B.add(new THREE.CylinderGeometry(0.34, 0.14, 0.14, 12), M.stone, 0, 1.1, 0);
    B.add(new THREE.CylinderGeometry(0.06, 0.08, 0.22, 6), M.stone, 0, 1.27, 0);
    const g = B.build(new THREE.Group());
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.68, 20), M.water); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.33; g.add(pool);
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), M.water); top.rotation.x = -Math.PI / 2; top.position.y = 1.175; g.add(top);
    // 물보라: 꼭대기에서 솟아 둘레로 떨어지는 작은 알갱이
    const N = 60, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe8f4ff, size: 0.05, transparent: true, opacity: 0.85 }));
    g.add(pts);
    g.position.set(x, 0, z);
    scene.add(g);
    return { geo, seed, N };
  }
  // 우물: 돌 테두리 + 기둥 둘 + 작은 기와지붕 + 도르래
  function makeWell(scene, x, z) {
    const M = materials(), B = Batch();
    B.add(new THREE.CylinderGeometry(0.36, 0.4, 0.42, 10, 1, true), M.stone, 0, 0.21, 0, 0, 0, 0);
    B.add(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 10), M.stone, 0, 0.44, 0);
    B.add(new THREE.CircleGeometry(0.34, 10), M.dark, 0, 0.3, 0, -Math.PI / 2);
    for (const sx of [-0.34, 0.34]) B.box(0.07, 1.0, 0.07, M.timber, sx, 0.72, 0);
    B.box(0.76, 0.06, 0.06, M.timber, 0, 1.06, 0);
    B.add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 8), M.wood, 0, 0.98, 0, 0, 0, 0);
    for (const side of [1, -1]) B.add(new THREE.BoxGeometry(0.98, 0.05, 0.56), M.roof, 0, 1.22, side * 0.2, side * 0.62, 0, 0.5, true);
    const g = B.build(new THREE.Group());
    g.position.set(x, 0, z); scene.add(g);
  }
  function makeSignpost(scene, x, z, title) {
    const M = materials(), B = Batch();
    B.box(0.08, 0.95, 0.08, M.timber, 0, 0.47, 0);
    const g = B.build(new THREE.Group());
    const bd = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.05), [M.timber, M.timber, M.timber, M.timber, new THREE.MeshLambertMaterial({ map: signTexture((title.split(' ').pop() || '').slice(0, 2)) }), M.timber]);
    bd.position.set(0, 0.85, 0.05); bd.castShadow = true;
    g.add(bd); g.position.set(x, 0, z); scene.add(g);
  }

  // 사람·그림 아이콘: world/<이름>.png 를 늘 카메라를 보는 판으로 세운다 (3단계에서 3D 사람으로 바꿀 자리)
  const texCache = {};
  function artTex(file) {
    if (texCache[file]) return texCache[file];
    const t = new THREE.TextureLoader().load('world/' + file + '.png', (tt) => { tt.userData.ok = true; });
    t.colorSpace = THREE.SRGBColorSpace;
    return (texCache[file] = t);
  }
  function billboard(file, h) {
    const mat = new THREE.SpriteMaterial({ map: artTex(file), alphaTest: 0.4 });
    const sp = new THREE.Sprite(mat);
    sp.center.set(0.5, 0.02); sp.scale.set(h, h, 1);
    const g = new THREE.Group(); g.add(sp);
    const sh = new THREE.Mesh(new THREE.CircleGeometry(0.26, 14), materials().shadow);
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012; sh.scale.set(1, 0.7, 1);
    g.add(sh);
    return g;
  }
  function iconSprite(scene, icon, x, z) { const g = billboard(icon, 1.1); g.position.set(x, 0, z); scene.add(g); }

  // ---------- 매 장면 ----------
  const trail = [];   // 주인공이 걸어온 자리 (오래된 것부터)
  const camT = { x: 0, z: 0, ok: false };
  let lastHero = null, clockT = 0;
  const ray = { o: null, d: null };

  // v: { area, hero: {x, y, dir}, moving, movers: [{x, y, npc, key}], ok(x, y), shake, battle, dt, reduceMotion }
  function frame(v) {
    if (!W3.ready) return false;
    const canvas = renderer.domElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return true;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (!scenes[v.area]) scenes[v.area] = buildArea(v.area);
    const S3 = scenes[v.area];
    if (curArea !== v.area) {
      cur = S3; curArea = v.area;
      for (const m of party) S3.scene.add(m.root);
      trail.length = 0;
    }
    const dt = v.dt; clockT += dt;
    const hx = v.hero.x + 0.5, hz = v.hero.y + 0.5;
    // 순간이동(문·출구·불러오기)이면 파티를 다시 줄 세운다
    if (!lastHero || Math.hypot(lastHero.x - hx, lastHero.z - hz) > 1.5 || !trail.length) lineUp(v, hx, hz);
    lastHero = { x: hx, z: hz };
    const tl = trail[trail.length - 1];
    if (Math.hypot(tl.x - hx, tl.z - hz) > 0.04) { trail.push({ x: hx, z: hz }); if (trail.length > 300) trail.shift(); }

    // 파티: 앞사람은 주인공 자리, 뒷사람은 걸어온 길을 따라 GAP 씩 뒤에
    party.forEach((m, i) => {
      let px = hx, pz = hz;
      if (i > 0) {
        let need = GAP * i, k = trail.length - 1;
        px = trail[k].x; pz = trail[k].z;
        for (; k > 0 && need > 0; k--) {
          const a = trail[k], b = trail[k - 1], d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d >= need) { px = a.x + (b.x - a.x) * need / d; pz = a.z + (b.z - a.z) * need / d; need = 0; }
          else { need -= d; px = b.x; pz = b.z; }
        }
      }
      const dx = px - m.pos.x, dz = pz - m.pos.z, moved = Math.hypot(dx, dz);
      m.pos.set(px, 0, pz);
      let want = m.yaw;
      if (i === 0) want = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][v.hero.dir];
      else if (moved > 0.001) want = Math.atan2(dx, dz);
      let d = want - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      m.yaw += d * Math.min(1, dt * 14);
      const speed = moved / Math.max(dt, 1e-3);
      if (speed > 0.3) m.still = 0; else m.still += dt;
      setAnim(m, m.still > 0.12 ? 'idle' : speed > 3 ? 'run' : 'walk');
      m.root.position.copy(m.pos);
      m.root.rotation.y = m.yaw;
      if (m.mixer) m.mixer.update(dt);
    });

    // 마을 사람: 3D 모델이 오면 그림 판을 바꿔 끼운다. 걷는 중이면 걷기, 서 있으면 숨쉬기
    const live = new Set();
    for (const p of v.movers) {
      let n = S3.npcs.get(p.key);
      if (!n || !n.model) {
        const gl = npcModel(p.npc);
        if (gl) { if (n) S3.scene.remove(n.root); n = makeNpc(p.npc, gl); S3.scene.add(n.root); S3.npcs.set(p.key, n); }
        else if (!n) { n = { root: billboard('npc_' + p.npc, 1.2), model: false }; S3.scene.add(n.root); S3.npcs.set(p.key, n); }
      }
      const x = p.x + 0.5, z = p.y + 0.5;
      if (n.model) {
        const moved = n.px == null ? 0 : Math.hypot(x - n.px, z - n.pz);
        n.px = x; n.pz = z;
        const want = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][p.dir == null ? 2 : p.dir];
        if (n.yaw == null) n.yaw = want;
        let d = want - n.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        n.yaw += d * Math.min(1, dt * 8);
        if (moved / Math.max(dt, 1e-3) > 0.2) n.still = 0; else n.still += dt;
        setAnim(n, n.still > 0.15 ? 'idle' : 'walk');
        n.root.rotation.y = n.yaw;
        n.mixer.update(dt);
      }
      n.root.position.set(x, 0, z);
      live.add(p.key);
    }
    for (const [k, n] of S3.npcs) n.root.visible = live.has(k);

    // 문: 앞에 서면 안으로 열린다
    for (const d of S3.doors) {
      const near = Math.abs(hx - (d.x + 0.5)) < 0.6 && hz - d.y < 1.9 && hz > d.y;
      d.open += ((near ? 1 : 0) - d.open) * Math.min(1, dt * 8);
      d.pivot.rotation.y = -d.open * 1.6;
    }
    // 분수 물보라, 연못 물결
    if (S3.spray) {
      const a = S3.spray.geo.attributes.position.array;
      for (let i = 0; i < S3.spray.N; i++) {
        const t = (clockT * 0.9 + S3.spray.seed[i]) % 1, ang = S3.spray.seed[i] * 40;
        a[i * 3] = Math.cos(ang) * (0.1 + t * 0.55); a[i * 3 + 2] = Math.sin(ang) * (0.1 + t * 0.55); a[i * 3 + 1] = 1.38 + 0.5 * t - 1.5 * t * t;
      }
      S3.spray.geo.attributes.position.needsUpdate = true;
    }
    if (S3.water) { S3.water.offset.x = Math.sin(clockT * 0.4) * 0.05; S3.water.offset.y = clockT * 0.03; }

    // 카메라: 남쪽 위에서 비스듬히 내려다본다 (위 = 북쪽, 패드 방향 그대로). 화면 폭에 칸이 10~13개 보이게
    const aspect = w / h, across = aspect < 1.45 ? 10.5 : 12.5;
    const fovR = THREE.MathUtils.degToRad(camera.fov);
    const dist = across / (2 * Math.tan(fovR / 2) * aspect) * 1.02;
    const pitch = THREE.MathUtils.degToRad(52);
    const halfW = across / 2;
    const tx = S3.cols <= across ? S3.cols / 2 : Math.max(halfW - 1.2, Math.min(S3.cols - halfW + 1.2, hx));
    const tz = Math.max(3.2, Math.min(S3.rows - 1.8, hz));
    if (!camT.ok || v.reduceMotion) { camT.x = tx; camT.z = tz; camT.ok = true; }
    const k = 1 - Math.exp(-dt * 7);
    camT.x += (tx - camT.x) * k; camT.z += (tz - camT.z) * k;
    let sx = 0, sz = 0;
    if (v.shake) { sx = Math.sin(clockT * 70) * 0.08 * v.shake; sz = Math.cos(clockT * 63) * 0.08 * v.shake; }
    camera.position.set(camT.x + sx, Math.sin(pitch) * dist, camT.z + Math.cos(pitch) * dist + sz);
    camera.lookAt(camT.x + sx, 0.4, camT.z + sz);
    S3.sun.position.set(camT.x + 7, 16, camT.z + 9);
    S3.sun.target.position.set(camT.x, 0, camT.z);

    // 주인공을 가리는 건물은 흐리게
    const head = new THREE.Vector3(hx, 0.55, hz), dir = head.clone().sub(camera.position);
    const len = dir.length(); dir.normalize();
    const r = new THREE.Ray(camera.position.clone(), dir), hit = new THREE.Vector3();
    for (const b of S3.buildings) {
      const p = r.intersectBox(b.userData.box, hit);
      const fade = !!p && camera.position.distanceTo(hit) < len - 0.2;
      if (b.userData.faded !== fade) {
        b.userData.faded = fade;
        b.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material)) { o.material.transparent = fade; o.material.opacity = fade ? 0.32 : 1; o.material.depthWrite = !fade; o.castShadow = !fade; } });
      }
    }
    renderer.render(S3.scene, camera);
    return true;
  }

  function lineUp(v, hx, hz) {
    trail.length = 0;
    const back = (v.hero.dir + 2) % 4, DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
    const x = Math.floor(hx), y = Math.floor(hz);
    // 뒤쪽이 막혔으면 옆으로, 그것도 막혔으면 한자리에 겹쳐 선다
    for (const d of [back, (back + 1) % 4, (back + 3) % 4]) {
      if (v.ok(x + DX[d], y + DY[d]) && v.ok(x + DX[d] * 2, y + DY[d] * 2)) {
        trail.push({ x: hx + DX[d] * 2, z: hz + DY[d] * 2 }, { x: hx + DX[d], z: hz + DY[d] });
        break;
      }
      if (v.ok(x + DX[d], y + DY[d])) { trail.push({ x: hx + DX[d], z: hz + DY[d] }); break; }
    }
    trail.push({ x: hx, z: hz });
    // 줄 선 자리로 바로 옮기고 보는 방향도 맞춘다
    party.forEach((m) => { m.pos.set(hx, 0, hz); m.yaw = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][v.hero.dir]; });
    camT.ok = false;
  }
})();
