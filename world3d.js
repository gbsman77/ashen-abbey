// 3D 지상 (설정의 "3D로 보기"). 걷기·사건·저장 규칙은 engine.js 의 격자 그대로 두고, 같은 지도를 3D로 세워 그리기만 한다.
// 지상 전부(들판·마을 로엘·집 안 여섯 곳)를 3D로 그린다 (AREAS). 던전은 원래의 1인칭 화면 그대로.
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
  // 3D로 그리는 지역. 집 안(indoor)은 buildRoom 이 벽·가구를 세운다
  const AREAS = { field: true, town: true, elder_house: true, inn: true, church: true, granny_house: true, smithy: true, home: true };
  // 소품 묶음 (장면 이름 = 소품 이름, tools3d/pack_town.mjs): town = KayKit Medieval Hexagon, interior = KayKit Dungeon Remastered
  // field = Medieval Hexagon 산·바위 + KayKit Halloween Bits 묘지 (납골당·비석·마른 나무·등불)
  const PROPS = ['town', 'interior', 'field'];
  const HERO_H = 1.1;             // 사람 키 (칸 단위, 한 칸 = 1)
  const MODEL_H = 2.3;            // 파티 모델 원래 키 (KayKit 뼈대와 같은 크기). 무기까지 재면 사람마다 달라져서 고정값으로 줄인다
  const GAP = 0.85;               // 줄 선 사람 사이 거리
  // 전투 동작 (KayKit 동작 이름). 무기에 따라 휘두르는 모양이 다르다
  const BATTLE_ANIM = {
    slash: '1H_Melee_Attack_Chop', swing: '2H_Melee_Attack_Chop', cast: 'Spellcast_Shoot', raise: 'Spellcast_Raise',
    guard: 'Block', hit: 'Hit_A', down: 'Death_A', cheer: 'Cheer'
  };
  const ATTACK_ANIM = ['slash', 'swing', 'swing'];   // 파티 순서대로 (전사 한손검, 사제·마법사 지팡이)

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
    load, frame, reset: () => { trail.length = 0; },
    act: (i, kind, arg) => battleAct(i, kind, arg), fx: (kind, arg) => battleFx(kind, arg),
    info: () => renderer && { ...renderer.info.render, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries }
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
    const step = (() => { let n = 0; const total = 1 + PROPS.length + PARTY3D.length; return () => progress && progress(++n / total); })();
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
      const [packs, chars] = await Promise.all([
        Promise.all(PROPS.map((n, i) => (i ? fetchPack(n).catch(() => null) : fetchPack(n)))),
        Promise.all(PARTY3D.map((p) => fetchPack(p.key).catch(() => null)))
      ]);
      props = {};
      for (const pk of packs) if (pk) for (const s of pk.scenes) {
        s.updateMatrixWorld(true); props[s.name] = s;
        s.traverse((m) => { if (m.isMesh) seeThrough(m.material); });
      }
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
    CUT.hero.value = new THREE.Vector3();
    hemi = new THREE.HemisphereLight(0xfff8ee, 0x6d7d5a, 1.55);
    sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
    sun.castShadow = true;
    const small = Math.min(screen.width, screen.height) < 600;
    sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 70 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }

  // 주인공을 가리는 나무·산·소품: 카메라와 주인공 사이에 든 부분만 점점이 비워 둔다 (한 재질을 여러 곳에 같이 쓰므로 통째로 흐리게 할 수 없다)
  const CUT = { hero: { value: null }, r: { value: 0 } };
  function seeThrough(mat) {
    if (mat.userData.cut) return;
    mat.userData.cut = true;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCutHero = CUT.hero; sh.uniforms.uCutR = CUT.r;
      sh.vertexShader = 'varying vec3 vCutW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 cw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cw = instanceMatrix * cw;
        #endif
          vCutW = (modelMatrix * cw).xyz; }`);
      sh.fragmentShader = 'varying vec3 vCutW;\nuniform vec3 uCutHero;\nuniform float uCutR;\n' + sh.fragmentShader.replace('void main() {', `void main() {
        if (uCutR > 0.0) {
          vec3 hc = uCutHero - cameraPosition; float L = length(hc); vec3 dr = hc / L;
          vec3 pc = vCutW - cameraPosition; float t = dot(pc, dr);
          float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (t < L - 0.5 && length(pc - dr * t) < uCutR * (0.55 + 0.45 * n)) discard;
        }`);
    };
    mat.customProgramCacheKey = () => 'cut';
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
    // 전투 동작은 처음 쓸 때 만든다 (BATTLE_ANIM)
    for (const [k, n] of Object.entries(BATTLE_ANIM)) {
      const c = THREE.AnimationClip.findByName(gltf.animations, n);
      if (c) { acts[k] = mixer.clipAction(c); if (k !== 'cheer') { acts[k].setLoop(THREE.LoopOnce, 1); acts[k].clampWhenFinished = true; } }
    }
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
  function setAnim(ch, name, again) {
    if (!ch.acts || !ch.acts[name]) return;
    if (ch.cur === name) { if (again) ch.acts[name].reset().play(); return; }
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

  // ---------- 땅 그림 (지도 한 칸 = PPT 픽셀, 둘레 MARGIN 칸까지. 넓은 들판은 칸당 픽셀을 줄인다) ----------
  const MARGIN = 10;
  const pptFor = (A) => ((A.map.length + MARGIN * 2) * (A.map[0].length + MARGIN * 2) > 2500 ? 24 : 32);
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // 칸 → 땅 종류: 0 풀 1 흙길 2 돌길 3 밭 4 물 5 숲 바닥 6 바위산 7 깊은 숲
  function groundKind(A, ch) {
    const ev = A.events[ch];
    if (ev) {
      if (ev.go && !ev.door) return 1;            // 마을 출구는 길
      ch = ev.ground || A.ground;
    }
    if (ch === ':') return 1;
    if (ch === 'p' || ch === 'o' || ch === 'k' || ch === 'W' || ch === 'G' || ch === 'R' || ch === 'C') return 2;
    if (ch === 'y') return 3;
    if (ch === 'w' || ch === '~' || ch === '=' || ch === '|') return 4;
    if (ch === 'T') return 5;
    if (ch === '^') return 6;
    if (ch === 'F') return 7;
    return 0;
  }
  // 걸어 다닐 수 있는 칸 (산·숲 높이를 낮출지 정할 때 쓴다)
  function walkable(A, x, y) {
    const ch = A.map[y] && A.map[y][x];
    if (!ch) return false;
    const ev = A.events[ch];
    if (ev) return !ev.solid || !!ev.npc;
    return '.,:=|Tpy_r'.includes(ch);
  }
  function paintGround(A, extraPath = []) {
    const rows = A.map.length, cols = A.map[0].length, PPT = pptFor(A);
    const GW = cols + MARGIN * 2, GH = rows + MARGIN * 2;
    // 칸마다 종류 (지도 밖은 풀, 출구 줄은 길이 이어진다)
    const kind = new Uint8Array(GW * GH);
    const exits = [];
    A.map.forEach((row, y) => [...row].forEach((ch, x) => {
      kind[(y + MARGIN) * GW + x + MARGIN] = groundKind(A, ch);
      const ev = A.events[ch];
      if (ev && ev.go && !ev.door && (x === 0 || y === 0 || x === cols - 1 || y === rows - 1)) exits.push([x, y]);
    }));
    for (const [x, y] of exits) { // 출구 바깥으로 길을 지도 끝까지
      const dx = x === 0 ? -1 : x === cols - 1 ? 1 : 0, dy = y === 0 ? -1 : y === rows - 1 ? 1 : 0;
      for (let i = 1; i <= MARGIN; i++) kind[(y + MARGIN + dy * i) * GW + x + MARGIN + dx * i] = 1;
    }
    for (const [x, y] of extraPath) if (x >= -MARGIN && y >= -MARGIN && x < cols + MARGIN && y < rows + MARGIN) kind[(y + MARGIN) * GW + x + MARGIN] = 1;
    // 칸마다 둘레 3×3 에 있는 땅 종류 (비트). 풀만 있으면 0
    const nb = new Uint16Array(GW * GH);
    for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
      let m = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const t = tx + i, u = ty + j;
        if (t >= 0 && u >= 0 && t < GW && u < GH && kind[u * GW + t]) m |= 1 << kind[u * GW + t];
      }
      nb[ty * GW + tx] = m;
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
      w1: [64, 128, 200], w2: [40, 92, 168],
      f1: [70, 116, 48], f2: [52, 92, 38], litter: [112, 92, 56],
      r1: [142, 138, 124], r2: [108, 104, 94], moss: [96, 128, 70],
      k1: [44, 76, 36], k2: [32, 58, 28]
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
        const m = nb[ty * GW + tx];
        if (m) {
          const edge = (vnoise(u * 3.1, v * 3.1) - 0.5) * 0.28;
          // 숲 바닥: 짙은 풀에 낙엽
          if (m & 32) {
            const a = smooth(0.3, 0.7, weight(u, v, 5) + edge);
            if (a > 0) {
              let fc = mix(C.f2, C.f1, vnoise(u * 1.3, v * 1.3) * 0.7 + n3 * 0.3);
              fc = mix(fc, C.litter, Math.max(0, vnoise(u * 2.6 + 9, v * 2.6) - 0.58) * 1.8);
              col = mix(col, fc, a);
            }
          }
          // 깊은 숲: 그늘진 풀
          if (m & 128) {
            const a = smooth(0.3, 0.7, weight(u, v, 7) + edge);
            if (a > 0) col = mix(col, mix(C.k2, C.k1, vnoise(u, v) * 0.8 + n3 * 0.2), a);
          }
          // 바위산 기슭: 회색 바위에 이끼
          if (m & 64) {
            const a = smooth(0.35, 0.6, weight(u, v, 6) + edge);
            if (a > 0) {
              let rc = mix(C.r2, C.r1, vnoise(u * 2.4, v * 2.4) * 0.8 + n3 * 0.2);
              rc = mix(rc, C.moss, smooth(0.5, 0.75, vnoise(u * 1.1 + 30, v * 1.1)) * 0.8);
              col = mix(col, rc, a);
            }
          }
          // 흙길
          if (m & 2) {
            const wd = weight(u, v, 1);
            if (wd > 0) {
              const a = smooth(0.38, 0.62, wd + edge);
              let dc = mix(C.d1, C.d2, vnoise(u * 4, v * 4) * 0.8 + n3 * 0.2);
              if (hash(pxi >> 2, py >> 2) > 0.93) dc = mix(dc, [150, 120, 80], 0.6); // 작은 돌
              col = mix(col, dc, a);
            }
          }
          // 돌길: 엇갈린 네모 돌
          if (m & 4) {
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
          }
          // 밭: 가로 이랑
          if (m & 8) {
            const ws = weight(u, v, 3);
            if (ws > 0) {
              const a = smooth(0.45, 0.55, ws + edge * 0.3);
              const furrow = Math.abs(((v * 3) % 1) - 0.5) * 2;
              col = mix(col, mix(C.soil, C.soilD, smooth(0.6, 1, furrow) * 0.8 + n3 * 0.2), a);
            }
          }
          // 물 (가장자리는 흙빛, 안쪽일수록 짙게)
          if (m & 16) {
            const ww = weight(u, v, 4);
            if (ww > 0) {
              const a = smooth(0.3, 0.5, ww + edge * 0.5);
              col = mix(col, C.d2, a);
              const b = smooth(0.45, 0.6, ww + edge * 0.5);
              col = mix(col, mix(C.w1, C.w2, smooth(0.6, 1, ww)), b);
            }
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
        ctx.arc((x + MARGIN + 0.1 + 0.8 * r) * PPT, (y + MARGIN + 0.1 + 0.8 * hash(y + i * 7, x)) * PPT, PPT * 0.07, 0, Math.PI * 2);
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
      moss: L({ color: 0xffffff, map: canvasTex(256, tiles('#7a9458', '#4e6438')) }),
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
  // KayKit 소품을 여러 자리에 한꺼번에 (InstancedMesh). list: [{x, z, s, r, y, sy}] (sy = 세로 배율, 없으면 s)
  function scatter(scene, name, list) {
    if (!list.length || !props[name]) return;
    const src = props[name], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const part of chunks(list)) src.traverse((m) => {
      if (!m.isMesh) return;
      const im = new THREE.InstancedMesh(m.geometry, m.material, part.length);
      part.forEach((p, i) => {
        m4.compose(new THREE.Vector3(p.x, p.y || 0, p.z), q.setFromAxisAngle(up, p.r || 0), new THREE.Vector3(p.s, p.sy ?? p.s, p.s)).multiply(m.matrixWorld);
        im.setMatrixAt(i, m4);
      });
      cullable(im);
      im.castShadow = im.receiveShadow = true;
      scene.add(im);
    });
  }
  // 코드로 만든 모양을 여러 자리에 (InstancedMesh). list: [{x, y, z, sx, sy, sz, r, color}]
  function instances(scene, geo, mat, list, shadow = true) {
    if (!list.length) return null;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    for (const part of chunks(list)) {
      const im = new THREE.InstancedMesh(geo, mat, part.length);
      part.forEach((p, i) => {
        m4.compose(new THREE.Vector3(p.x, p.y || 0, p.z), q.setFromAxisAngle(up, p.r || 0), new THREE.Vector3(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1));
        im.setMatrixAt(i, m4);
        if (p.color != null) im.setColorAt(i, c.set(p.color));
      });
      cullable(im);
      im.castShadow = shadow; im.receiveShadow = true;
      scene.add(im);
    }
  }
  // 넓은 들판은 소품이 많아서 8칸 조각으로 나눠 화면(과 그림자) 밖 조각은 그리지 않는다
  const CHUNK = 8;
  function chunks(list) {
    const by = new Map();
    for (const p of list) {
      const k = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(p);
    }
    return [...by.values()];
  }
  function cullable(im) {
    if (im.computeBoundingSphere) { im.computeBoundingSphere(); im.boundingSphere.radius += 0.5; im.frustumCulled = true; }
    else im.frustumCulled = false;
  }

  function buildArea(id) {
    if (D.areas[id].indoor) return buildRoom(id);
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
    // edge: 지도 밖을 카메라가 몇 칸까지 비출지 (들판은 마을 문 너머 집이 보이게 넓게)
    const S3 = { scene, sun: light, buildings: [], doors: [], npcs: new Map(), cols, rows, A, spray: null, water: null, fires: [], chests: [], glows: [], wisps: [], edge: id === 'town' ? 1.2 : 2.8 };
    const at = (x, y) => (map[y] && map[y][x]) || null;
    const R = (x, y, k = 0) => hash(x * 13 + k * 101, y * 7 + k * 37);
    // 들판 표지(마을 문·수도원·묘지) 둘레는 숲·산을 비우고 따로 세운다. clear: [x0, y0, x1, y1] 칸 범위 (지도 밖도 된다)
    const clear = [], extraPath = [];
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      const ev = A.events[ch], icon = ev && ev.icon;
      if (icon === 'town') {
        clear.push([-MARGIN - 7, y - 3, 0.99, y + 3]);
        for (let i = x - 1; i >= -MARGIN; i--) extraPath.push([i, y]);
      } else if (icon === 'abbey') clear.push([x - 2, y - 2, x + 2.99, y + 0.99]);
      else if (icon === 'crypt') clear.push([x - 4, y - 2, x + 4.99, y + 1.99]);
    }));
    const inClear = (x, y) => clear.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    // 북쪽 k 줄 안에 걸을 수 있는 칸이 있나 (그 남쪽의 산·숲은 카메라와 주인공 사이에 서므로 낮춘다)
    const walkNorth = (x, y, k) => { for (let j = 1; j <= k; j++) for (let i = -1; i <= 1; i++) if (walkable(A, x + i, y - j)) return true; return false; };

    // 땅
    const { cv, GW, GH } = paintGround(A, extraPath);
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
    const L = { trees: { tree_single_A: [], tree_single_B: [], trees_B_small: [] }, barrel: [], well: [], hedge: [], post: [], rail: [], crop: [], cropLeaf: [], grass: [], fern: [], lily: [], reed: [], pot: [], bush: [], lampPost: [], lampHead: [], waterTiles: [], rocks: { rock_single_B: [], rock_single_D: [] } };
    const forest = { trees_A_large: [], trees_A_medium: [], trees_B_large: [], trees_B_medium: [] }, hills = { hills_A_trees: [], mountain_A_grass_trees: [], mountain_B_grass_trees: [] };
    const MOUNTS = ['mountain_A', 'mountain_B', 'mountain_C'];
    const mounts = Object.fromEntries(MOUNTS.map((n) => [n, []]));
    const isWater = (ch) => ch === 'w' || ch === '~' || ch === '=' || ch === '|';
    const bridge = Batch();
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
      } else if (ch === 'w' || ch === '~') {
        L.waterTiles.push([x, y]);
        // 연꽃은 고인 물에만 (강은 둘레가 거의 물인 넓은 호수 칸만)
        const still = ch === 'w' || [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]].every(([dx, dy]) => at(x + dx, y + dy) === '~');
        if (R(x, y) < (ch === 'w' ? 0.55 : still ? 0.3 : 0)) L.lily.push({ x: cx + (R(x, y, 1) - 0.5) * 0.6, z: cz + (R(x, y, 2) - 0.5) * 0.6, s: 3, r: R(x, y, 3) * 6, y: 0.02 });
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!isWater(at(x + dx, y + dy)) && R(x + dx, y + dy, 9) < 0.5) L.reed.push({ x: cx + dx * 0.45, z: cz + dy * 0.45, s: 3, r: R(x, y, 5) * 6 });
      } else if (ch === '=' || ch === '|') {
        // 나무 다리: 건너는 방향(= 동서, | 남북)으로 널빤지, 양옆에 난간
        L.waterTiles.push([x, y]);
        const along = ch === '|', M2 = materials();
        const box = (w, h, d, mat, ox, oy, oz) => (along ? bridge.box(d, h, w, mat, cx + oz, oy, cz + ox) : bridge.box(w, h, d, mat, cx + ox, oy, cz + oz));
        box(1.02, 0.08, 0.84, M2.door, 0, 0.16, 0);
        for (const s of [-1, 1]) {
          box(1.02, 0.1, 0.1, M2.timber, 0, 0.1, s * 0.4);
          box(1.02, 0.06, 0.06, M2.timber, 0, 0.62, s * 0.42);
          for (const e of [-0.45, 0.05]) box(0.08, 0.5, 0.08, M2.timber, e, 0.4, s * 0.42);
        }
        if (!isWater(at(x + (along ? 0 : 1), y + (along ? 1 : 0)))) for (const s of [-1, 1]) box(0.1, 0.62, 0.1, M2.timber, 0.47, 0.34, s * 0.42); // 끝 기둥
      } else if (ch === '^') {
        // 바위산: 칸마다 KayKit 산 하나. 길가(북쪽에 걸을 칸)는 낮은 바위로, 안쪽일수록 높게
        // 산 안쪽은 칸을 몇 개 건너 크게 세워 덩어리가 덜 잘게 보이게
        const edge = walkNorth(x, y, 2) || walkable(A, x, y + 1) || walkable(A, x - 1, y) || walkable(A, x + 1, y);
        if (!inClear(x, y) && (edge || R(x, y, 12) < 0.62)) {
          const low = walkNorth(x, y, 1) ? 0.4 : walkNorth(x, y, 2) ? 0.68 : 1;
          mounts[MOUNTS[Math.floor(R(x, y, 1) * MOUNTS.length)]].push({ x: cx + (R(x, y, 2) - 0.5) * 0.3, z: cz + (R(x, y, 3) - 0.5) * 0.3, s: (edge ? 0.62 : 0.8) + R(x, y, 4) * 0.18, sy: (0.8 + R(x, y, 5) * 0.55) * low, r: Math.floor(R(x, y, 6) * 6) * Math.PI / 3 });
          if (walkable(A, x, y + 1) && R(x, y, 7) < 0.5) L.rocks[R(x, y, 8) < 0.5 ? 'rock_single_B' : 'rock_single_D'].push({ x: cx + (R(x, y, 9) - 0.5) * 0.6, z: cz + 0.45, s: 1.6 + R(x, y, 10), r: R(x, y, 11) * 6 });
        }
      } else if (ch === 'F') {
        // 깊은 숲: 칸마다 나무 덤불. 걸을 칸 바로 남쪽은 작은 덤불로
        if (!inClear(x, y)) {
          if (walkNorth(x, y, 1)) { if (R(x, y, 1) < 0.7) L.trees.trees_B_small.push({ x: cx + (R(x, y, 2) - 0.5) * 0.3, z: cz + 0.1, s: 0.95 + R(x, y, 3) * 0.3, r: R(x, y, 4) * 6 }); }
          else forest[Object.keys(forest)[Math.floor(R(x, y, 5) * 4)]].push({ x: cx + (R(x, y, 6) - 0.5) * 0.4, z: cz + (R(x, y, 7) - 0.5) * 0.4, s: (walkNorth(x, y, 2) ? 0.9 : 1.1) + R(x, y, 8) * 0.35, r: R(x, y, 9) * 6 });
        }
      } else if (ch === 'T') {
        // 걸을 수 있는 숲: 칸 가장자리에 덤불, 가운데는 비워 둔다 (나무는 아래에서 칸 모서리에)
        for (let i = 0; i < 2; i++) {
          const side = Math.floor(R(x, y, i + 1) * 4), t = R(x, y, i + 3) - 0.5;
          const [ox, oz] = [[t, -0.42], [t, 0.42], [-0.42, t], [0.42, t]][side];
          L.bush.push({ x: cx + ox, y: 0.14, z: cz + oz, sx: 0.24 + R(x, y, i + 5) * 0.1, sy: 0.2 + R(x, y, i + 6) * 0.08, sz: 0.24, r: R(x, y, i) * 6, color: R(x, y, i + 7) < 0.5 ? 0x3a6e2e : 0x4a7e34 });
        }
        for (let i = 0; i < 4; i++) L.fern.push({ x: x + 0.08 + R(x, y, i + 10) * 0.84, y: 0.13, z: y + 0.08 + R(x, y, i + 20) * 0.84, sx: 1, sy: 0.8 + R(x, y, i) * 0.6, sz: 1, r: R(x, y, i + 30) * 6, color: R(x, y, i + 40) < 0.5 ? 0x3d7a2c : 0x5a8e3a });
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
        makeSignpost(scene, cx, cz, id === 'town' ? (A.name.split(' ').pop() || '').slice(0, 2) : ev.name.split(' ')[0]);
      } else if (ev && ev.icon === 'town') {
        makeTownGate(S3, x, y);
      } else if (ev && ev.icon === 'abbey') {
        makeAbbey(S3, x, y);
      } else if (ev && ev.icon === 'mine') {
        makeMine(S3, x, y);
      } else if (ev && ev.icon === 'shrine') {
        makeShrine(S3, x, y);
      } else if (ev && ev.icon === 'crypt') {
        makeCrypt(S3, x, y);
      } else if (ev && ev.icon === 'chest') {
        const o = kit(scene, 'chest', cx, 0, cz, 0.3, Math.PI);
        const lid = o && o.getObjectByName('chest_lid');
        if (lid) S3.chests.push({ lid, x, y, open: 0 });
        else if (!o) iconSprite(scene, ev.icon, cx, cz);
      } else if (ev && ev.icon) {
        iconSprite(scene, ev.icon, cx, cz);
      }
      // 풀 포기 (풀밭 칸)
      const gk = groundKind(A, ch);
      if (gk === 0 && !ev && ch !== 't' && R(x, y, 7) < 0.7) for (let i = 0; i < 2; i++) L.grass.push({ x: x + 0.1 + R(x, y, i + 10) * 0.8, y: 0.06, z: y + 0.1 + R(x, y, i + 20) * 0.8, sx: 1, sy: 0.7 + R(x, y, i) * 0.6, sz: 1, r: R(x, y, i + 30) * 6, color: R(x, y, i + 40) < 0.5 ? 0x4f8a34 : 0x6aa244 });
    }));
    // 걸을 수 있는 숲의 나무: 네 칸이 모두 숲인 칸 모서리에 (사람이 다니는 칸 가운데와 겹치지 않게)
    for (let y = 1; y < rows; y++) for (let x = 1; x < cols; x++) {
      const c4 = [at(x - 1, y - 1), at(x, y - 1), at(x - 1, y), at(x, y)];
      if (!c4.includes('T') || !c4.every((c) => c === 'T' || c === 'F') || inClear(x, y) || R(x, y, 11) > 0.6) continue;
      L.trees[R(x, y, 12) < 0.5 ? 'tree_single_A' : 'tree_single_B'].push({ x: x + (R(x, y, 13) - 0.5) * 0.16, z: y + (R(x, y, 14) - 0.5) * 0.16, s: 1.5 + R(x, y, 15) * 0.5, r: R(x, y, 16) * 6 });
    }
    for (const [n, list] of Object.entries(L.trees)) scatter(scene, n, list);
    for (const [n, list] of Object.entries(mounts)) scatter(scene, n, list);
    for (const [n, list] of Object.entries(L.rocks)) scatter(scene, n, list);
    bridge.build(scene);
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
    instances(scene, new THREE.ConeGeometry(0.07, 0.26, 4), new THREE.MeshLambertMaterial({ flatShading: true }), L.fern, false);
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
    map.forEach((row, y) => [...row].forEach((ch, x) => { const ev = A.events[ch]; if (ev && ev.go && !ev.door && (x === 0 || x === cols - 1)) exitRows.push([x, y]); }));
    const names = Object.keys(forest);
    for (let y = -MARGIN - 6; y < rows + MARGIN + 6; y += 1.6) for (let x = -MARGIN - 6; x < cols + MARGIN + 6; x += 1.6) {
      const jx = x + (R(x * 5 | 0, y * 5 | 0, 1) - 0.5) * 1.2, jy = y + (R(x * 5 | 0, y * 5 | 0, 2) - 0.5) * 1.2;
      const out = Math.max(-jx, jx - cols, -jy, jy - rows);
      if (out < 0.9) continue;
      if (exitRows.some(([ex, ey]) => Math.abs(jy - ey - 0.5) < 2.2 && (ex === 0 ? jx < 1 : jx > cols - 1))) continue;
      if (jy > rows && out < 3) continue; // 남쪽 바로 앞은 비워 둔다 (카메라 쪽)
      if (inClear(jx, jy)) continue;
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

  // ---------- 집 안 ----------
  // 벽(I)은 칸마다 세우고, 맨 아래 줄(카메라 쪽)만 낮게 잘라 안이 들여다보이게 한다. 천장은 없고 바깥은 검다 (2D 집 안과 같다)
  // 가구 글자(q B K J O e Q)는 붙어 있는 같은 글자 묶음 하나를 한 덩어리로 세운다 (engine.js areaBlocks 와 같은 묶음)
  const ROOM = {
    elder_house: { rug: ['#7a2424', '#d8b060'], blanket: 0x6a3a7a, shelf: 'books' },
    inn: { rug: ['#28406e', '#d8c080'], blanket: 0x3a6a9a, shelf: 'kitchen' },
    church: { floor: 'flags', wall: 'stone', rug: ['#86202a', '#e0b84a'], shelf: 'books' },
    granny_house: { blanket: 0x5a7a3a, shelf: 'jars' },
    smithy: { floor: 'flags', wall: 'stone', shelf: 'iron' },
    home: { blanket: 0xb0703a, shelf: 'kitchen' }
  };
  const WALL_H = 1.9, LOW_H = 0.34;
  const KIT = 0.42;   // Dungeon Remastered 소품 크기 1 = 0.42칸 (사람 키에 맞춘 값)

  function roomMaterials() {
    const M = materials();
    if (M.planks) return M;
    const L = (o) => new THREE.MeshLambertMaterial(o);
    // 마루: 가로로 깐 널빤지, 이음매는 줄마다 어긋나게
    const boards = (g, s) => {
      const n = 8, bh = s / n;
      for (let r = 0; r < n; r++) {
        for (let x = -((r * 37) % 5) * s / 5; x < s; ) {
          const w = s * (0.35 + Math.random() * 0.4), v = Math.random() * 18 | 0;
          g.fillStyle = 'rgb(' + (150 + v) + ',' + (104 + v) + ',' + (64 + v * 0.6 | 0) + ')';
          g.fillRect(x, r * bh, w, bh);
          for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(80,48,24,0.14)'; g.fillRect(x + Math.random() * w, r * bh + Math.random() * bh, 10 + Math.random() * 30, 1.5); }
          g.fillStyle = 'rgba(60,34,16,0.8)'; g.fillRect(x, r * bh, 2, bh);
          x += w;
        }
        g.fillStyle = 'rgba(50,28,12,0.85)'; g.fillRect(0, r * bh + bh - 2, s, 2);
      }
    };
    // 돌바닥: 네모 판석
    const flags = (g, s) => {
      g.fillStyle = '#4a4540'; g.fillRect(0, 0, s, s);
      const n = 4, c = s / n;
      for (let r = 0; r < n; r++) for (let i = 0; i < n; i++) {
        const v = 128 + Math.random() * 36 | 0;
        g.fillStyle = 'rgb(' + v + ',' + (v - 6) + ',' + (v - 14) + ')';
        g.fillRect(i * c + 2, r * c + 2, c - 4, c - 4);
        for (let k = 0; k < 20; k++) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(i * c + Math.random() * c, r * c + Math.random() * c, 3 + Math.random() * 8, 3 + Math.random() * 8); }
      }
    };
    Object.assign(M, {
      planks: L({ map: canvasTex(256, boards) }),
      flags: L({ map: canvasTex(256, flags) }),
      cap: L({ color: 0x2a1f18 }),
      linen: L({ color: 0xf0e8d8 }),
      mat: L({ color: 0x9a7444 }), matEdge: L({ color: 0x5e4426 }),
      ember: new THREE.MeshBasicMaterial({ color: 0xff8a30 }),
      flame: new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.88, depthWrite: false }),
      day: new THREE.MeshBasicMaterial({ color: 0xd8ecf6 }),
      books: [0x8a2c24, 0x2c4a7a, 0x3a6a34, 0x7a5a2a, 0x5a3a6a, 0xb08a4a].map((c) => L({ color: c })),
      jar: L({ color: 0x9ab8a0, transparent: true, opacity: 0.85 })
    });
    return M;
  }
  function rugTex(w, h, base, trim) {
    const P = 64, c = document.createElement('canvas'); c.width = w * P; c.height = h * P;
    const g = c.getContext('2d');
    g.fillStyle = trim; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = base; g.fillRect(6, 6, c.width - 12, c.height - 12);
    g.strokeStyle = trim; g.lineWidth = 3; g.strokeRect(14, 14, c.width - 28, c.height - 28);
    g.fillStyle = trim; g.globalAlpha = 0.5; // 마름모 무늬
    for (let y = 1; y < h * 2; y++) for (let x = 1; x < w * 2; x++) if ((x + y) % 2 === 0) {
      const cx = x * P / 2, cy = y * P / 2;
      g.beginPath(); g.moveTo(cx, cy - 8); g.lineTo(cx + 8, cy); g.lineTo(cx, cy + 8); g.lineTo(cx - 8, cy); g.fill();
    }
    g.globalAlpha = 1;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  // Dungeon Remastered 소품 하나를 복제해 세운다 (집 안은 수가 적어 인스턴싱하지 않는다). s = 배율 또는 [x, y, z] 배율
  function kit(group, name, x, y, z, s = KIT, r = 0) {
    if (!props[name]) return null;
    const o = props[name].clone(true);
    o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    if (Array.isArray(s)) o.scale.set(s[0], s[1], s[2]); else o.scale.setScalar(s);
    o.position.set(x, y, z); o.rotation.y = r;
    group.add(o);
    return o;
  }
  function roomBlocks(map, chars) {
    const seen = {}, out = [];
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!chars.includes(ch) || seen[x + ',' + y]) return;
      let w = 1, h = 1;
      while (map[y][x + w] === ch) w++;
      while (map[y + h] && [...Array(w)].every((_, i) => map[y + h][x + i] === ch)) h++;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) seen[(x + i) + ',' + (y + j)] = true;
      out.push({ x, y, w, h, ch, cx: x + w / 2, cz: y + h / 2 });
    }));
    return out;
  }

  function buildRoom(id) {
    const A = D.areas[id], map = A.map, rows = map.length, cols = map[0].length;
    const M = roomMaterials(), st = ROOM[id] || {};
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.add(new THREE.HemisphereLight(0xffe6c4, 0x3a2a1a, 1.2));
    const light = sun.clone(); light.shadow = sun.shadow.clone(); light.castShadow = true;
    light.intensity = 1.2; light.color.set(0xffe2b8);
    scene.add(light, light.target);
    const S3 = { scene, sun: light, buildings: [], doors: [], npcs: new Map(), cols, rows, A, spray: null, water: null, fires: [], chests: [], indoor: true, edge: 1.2 };
    const at = (x, y) => (map[y] && map[y][x]) || null;
    const isWall = (x, y) => at(x, y) === 'I';
    const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !isWall(x, y);
    const floorAt = (x, y) => { const ch = at(x, y), ev = ch && A.events[ch]; return ch === '_' || ch === 'r' || !!(ev && !ev.icon); };
    const R = (x, y, k = 0) => hash(x * 13 + k * 101, y * 7 + k * 37);
    const B = Batch();
    const stoneWall = st.wall === 'stone', wallMat = stoneWall ? M.stone : M.plaster;
    // 로컬 좌표(문·창 앞면이 +z)로 만든 상자를 돌려서 붙인다
    const part = (w, h, d, mat, lx, ly, lz, X, Z, ry) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(lx, ly, lz); B.add(g, mat, X, 0, Z, 0, ry); };

    // 바닥
    const fg = new THREE.PlaneGeometry(cols, rows); fg.rotateX(-Math.PI / 2); fg.translate(cols / 2, 0, rows / 2);
    B.add(fg, st.floor === 'flags' ? M.flags : M.planks, 0, 0, 0, 0, 0, 0.5);

    // 벽: 안쪽 면에 나무 보·기둥 (회벽 집), 창은 몇 칸마다
    const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== 'I') return;
      const low = y === rows - 1, h = low ? LOW_H : WALL_H;
      B.box(1, h, 1, wallMat, x + 0.5, h / 2, y + 0.5, stoneWall ? 1 : 2);
      B.box(1, 0.05, 1, M.cap, x + 0.5, h + 0.025, y + 0.5);
      if (low) return;
      for (const [dx, dy] of DIRS) {
        if (!inside(x + dx, y + dy)) continue;
        const X = x + 0.5 + dx * 0.5, Z = y + 0.5 + dy * 0.5, ry = Math.atan2(dx, dy);
        if (!stoneWall) {
          part(1, 0.1, 0.05, M.timber, 0, h - 0.12, 0.02, X, Z, ry);
          part(1, 0.12, 0.05, M.timber, 0, 0.06, 0.02, X, Z, ry);
          if ((x + y) % 3 === 0) part(0.1, h, 0.06, M.timber, -0.45, h / 2, 0.02, X, Z, ry);
        }
        // 창 (선반·화덕 뒤와 맨 아래 두 줄 옆벽은 빼고)
        const n = at(x + dx, y + dy), k = dx === 0 ? x : y;
        if ('JOK'.includes(n) || (dx !== 0 && y >= rows - 2)) continue;
        if (id === 'church') {
          if (dx !== 0 || k % 2 !== 1 || Math.abs(x + 0.5 - cols / 2) < 1.5) continue;
          part(0.48, 1.12, 0.05, M.stone, 0, 1.2, 0.02, X, Z, ry);
          part(0.36, 0.95, 0.06, M.stained, 0, 1.18, 0.02, X, Z, ry);
          part(0.36, 0.03, 0.07, M.iron, 0, 1.18, 0.02, X, Z, ry);
          part(0.03, 0.95, 0.07, M.iron, 0, 1.18, 0.02, X, Z, ry);
        } else if (k % 3 === 1) {
          part(0.64, 0.66, 0.05, M.timber, 0, 1.25, 0.02, X, Z, ry);
          part(0.52, 0.54, 0.06, M.day, 0, 1.25, 0.02, X, Z, ry);
          part(0.04, 0.54, 0.07, M.timber, 0, 1.25, 0.02, X, Z, ry);
          part(0.52, 0.04, 0.07, M.timber, 0, 1.25, 0.02, X, Z, ry);
          part(0.72, 0.05, 0.14, M.timber, 0, 0.92, 0.05, X, Z, ry);
        }
      }
    }));

    // 깔개: 붙어 있는 깔개 칸 묶음마다 한 장 (사람이 선 칸도 바닥이 깔개면 포함)
    if (st.rug) {
      const rugAt = (x, y) => { const ch = at(x, y), ev = ch && A.events[ch]; return ch === 'r' || !!(ev && ev.ground === 'r'); };
      const seen = {};
      map.forEach((row, y) => [...row].forEach((_, x) => {
        if (seen[x + ',' + y] || !rugAt(x, y)) return;
        let x1 = x, y1 = y; const q = [[x, y]]; seen[x + ',' + y] = true;
        while (q.length) {
          const [cx, cy] = q.pop(); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
          for (const [dx, dy] of DIRS) { const nx = cx + dx, ny = cy + dy; if (!seen[nx + ',' + ny] && rugAt(nx, ny)) { seen[nx + ',' + ny] = true; q.push([nx, ny]); } }
        }
        const w = x1 - x + 1, h = y1 - y + 1;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.12, h - 0.12), new THREE.MeshLambertMaterial({ map: rugTex(w, h, st.rug[0], st.rug[1]) }));
        m.rotation.x = -Math.PI / 2; m.position.set(x + w / 2, 0.012, y + h / 2); m.receiveShadow = true;
        scene.add(m);
      }));
    }

    // 가구
    const blanket = new THREE.MeshLambertMaterial({ color: st.blanket || 0x7a4a6a });
    for (const b of roomBlocks(map, 'qBKJOeQ')) {
      const { cx, cz } = b;
      if (b.ch === 'q') {
        // 탁자 (KayKit 탁자를 묶음 크기에 맞게 늘림) + 위에 접시·초·병, 양옆에 걸상
        const tw = b.w - 0.24, td = b.h - 0.24, th = 0.46, big = b.w * b.h > 1;
        if (!kit(scene, big ? 'table_medium' : 'table_small', cx, 0, cz, [tw / (big ? 2 : 1), th, td / (big ? 2 : 1)])) {
          B.box(tw, 0.06, td, M.wood, cx, th - 0.03, cz);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.07, th, 0.07, M.timber, cx + sx * (tw / 2 - 0.06), th / 2, cz + sz * (td / 2 - 0.06));
        }
        const slots = [[-0.45, -0.35], [0.4, 0.3], [0.45, -0.4], [-0.4, 0.4]];
        const items = id === 'smithy' ? [] : big ? [['plate_food_A', 0.3], ['candle_lit', 0.3], ['bottle_B_green', 0.26], ['plate_small', 0.4]] : [['plate_small', 0.4], ['candle_lit', 0.3]];
        items.forEach(([n, s], i) => kit(scene, n, cx + slots[i][0] * tw / 2, th, cz + slots[i][1] * td / 2, s, R(b.x, b.y, i) * 6));
        if (id === 'smithy') { // 작업대: 쇳덩이와 망치
          for (let i = 0; i < 3; i++) B.box(0.2, 0.06, 0.09, M.iron, cx - 0.05, th + 0.03 + i * 0.06, cz - 0.4 + (i % 2) * 0.04);
          B.box(0.05, 0.05, 0.36, M.wood, cx + 0.12, th + 0.025, cz + 0.25);
          B.box(0.16, 0.08, 0.08, M.iron, cx + 0.12, th + 0.05, cz + 0.08);
        } else for (let j = 0; j < b.h; j++) for (const side of [-1, 1]) {
          const nx = side < 0 ? b.x - 1 : b.x + b.w;
          if (floorAt(nx, b.y + j)) kit(scene, 'stool', side < 0 ? b.x + 0.06 : b.x + b.w - 0.06, 0, b.y + j + 0.5, [0.42, 0.56, 0.42]);
        }
      } else if (b.ch === 'B') {
        // 침대: 머리는 북쪽
        const w = b.w - 0.18, d = b.h - 0.12, z0 = b.y + 0.06, z1 = b.y + b.h - 0.06;
        B.box(w, 0.2, d, M.wood, cx, 0.16, cz);
        B.box(w + 0.04, 0.72, 0.08, M.wood, cx, 0.36, z0 + 0.04);
        B.box(w + 0.04, 0.42, 0.08, M.wood, cx, 0.21, z1 - 0.04);
        B.box(w - 0.06, 0.1, d - 0.16, M.linen, cx, 0.31, cz);
        B.box(w - 0.22, 0.09, 0.24, M.linen, cx, 0.4, z0 + 0.24);
        const bl = d * (b.h > 1 ? 0.62 : 0.5);
        B.box(w - 0.02, 0.07, bl, blanket, cx, 0.38, z1 - 0.08 - bl / 2);
      } else if (b.ch === 'K') {
        // 계산대
        B.box(b.w - 0.04, 0.62, 0.6, M.door, cx, 0.31, cz, 2);
        B.box(b.w + 0.04, 0.06, 0.74, M.timber, cx, 0.65, cz);
        const items = id === 'smithy' ? [['coin_stack_small', 0.3], ['sword_shield', 0.3]] : [['bottle_A_brown', 0.26], ['plate_small', 0.4], ['bottle_C_brown', 0.24], ['candle_lit', 0.3]];
        items.forEach(([n, s], i) => {
          const o = kit(scene, n, b.x + 0.5 + i * (b.w - 1) / Math.max(1, items.length - 1), 0.68, cz + (i % 2 ? 0.12 : -0.08), s, R(b.x, i) * 0.6 - 0.3);
          if (o && n === 'sword_shield') { o.rotation.set(-Math.PI / 2 + 0.05, 0, 0.3); o.position.y = 0.7; }
        });
      } else if (b.ch === 'J') {
        shelf(b);
      } else if (b.ch === 'O') {
        hearth(b);
      } else if (b.ch === 'e') {
        // 긴 의자: 앉으면 북쪽(제단)을 본다, 등받이는 남쪽
        const w = b.w - 0.12;
        B.box(w, 0.06, 0.34, M.wood, cx, 0.28, cz - 0.04);
        B.box(w, 0.4, 0.05, M.wood, cx, 0.52, cz + 0.16);
        for (const sx of [-1, 1]) B.box(0.06, 0.66, 0.44, M.timber, cx + sx * w / 2, 0.33, cz);
      } else if (b.ch === 'Q') {
        // 제단: 돌 받침에 흰 천, 앞에 붉은 휘장, 양 끝에 촛대
        const w = b.w - 0.14;
        B.box(w, 0.6, 0.62, M.stone, cx, 0.3, cz, 1);
        B.box(w + 0.06, 0.04, 0.68, M.linen, cx, 0.62, cz);
        B.box(0.56, 0.5, 0.02, M.canvasR, cx, 0.36, cz + 0.32);
        B.box(0.56, 0.04, 0.025, M.gold, cx, 0.6, cz + 0.33);
        B.box(0.05, 0.24, 0.03, M.gold, cx, 0.38, cz + 0.335);
        B.box(0.16, 0.05, 0.03, M.gold, cx, 0.43, cz + 0.335);
        for (const sx of [-1, 1]) {
          kit(scene, 'candle_triple', cx + sx * (w / 2 - 0.2), 0.64, cz, 0.36);
          const c = new THREE.PointLight(0xffb060, 1.6, 4, 1.6); c.position.set(cx + sx * (w / 2 - 0.2), 1.05, cz + 0.1); scene.add(c);
          S3.fires.push({ light: c, base: 1.6, flames: [] });
        }
        // 제단 뒤 벽의 금빛 십자가
        B.box(0.1, 0.78, 0.04, M.gold, cx, 1.42, b.y - 0.98);
        B.box(0.46, 0.1, 0.04, M.gold, cx, 1.6, b.y - 0.98);
      }
    }
    function shelf(b) {
      // 북쪽 벽에 붙은 찬장: 칸 세 개에 책·병·쇳덩이
      const H = 1.45, dep = 0.36, zb = b.y + 0.02, zc = zb + dep / 2, w = b.w - 0.06, cx = b.cx;
      B.box(w, H, 0.04, M.timber, cx, H / 2, zb + 0.02);
      for (const sx of [-1, 1]) B.box(0.06, H, dep, M.wood, cx + sx * (w / 2 - 0.03), H / 2, zc);
      B.box(w + 0.06, 0.05, dep + 0.04, M.wood, cx, H, zc);
      const levels = [0.06, 0.52, 0.98];
      levels.forEach((ly, li) => {
        B.box(w - 0.08, 0.04, dep, M.wood, cx, ly, zc);
        let x = b.x + 0.12;
        let k = 0;
        while (x < b.x + b.w - 0.14) {
          const r = R(b.x * 9 + k, b.y + li * 31, 3); k++;
          const kind = st.shelf;
          if ((kind === 'books' || (kind === 'kitchen' && li === 2)) && r > 0.12) {
            const bw = 0.05 + R(k, li, 1) * 0.04, bh = 0.24 + R(k, li, 2) * 0.12;
            B.box(bw, bh, dep * 0.75, M.books[Math.floor(R(k, li + b.x, 4) * M.books.length)], x + bw / 2, ly + 0.02 + bh / 2, zc);
            x += bw + 0.008;
          } else if (kind === 'iron' && li === 0) {
            B.box(0.22, 0.12, 0.2, M.iron, x + 0.11, ly + 0.08, zc); x += 0.3;
          } else if (r > 0.25) {
            const n = ['bottle_A_brown', 'bottle_B_green', 'bottle_C_brown'][Math.floor(R(k, li, 5) * 3)];
            if (kind === 'jars' && R(k, li, 6) < 0.5) B.add(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 8), M.jar, x + 0.07, ly + 0.1, zc);
            else kit(scene, n, x + 0.07, ly + 0.02, zc, 0.3, R(k, li) * 6);
            x += 0.17;
          } else x += 0.12;
        }
      });
    }
    function hearth(b) {
      const forge = b.w > 1, cx = b.cx, zb = b.y, w = b.w - 0.08, dep = 0.6, zc = zb + dep / 2;
      const flames = [];
      let fy;
      if (forge) {
        // 대장간 화로: 허리 높이 돌 화덕에 숯불, 위로 덮개와 굴뚝
        B.box(w, 0.56, dep, M.stone, cx, 0.28, zc, 1);
        const coal = new THREE.Mesh(new THREE.BoxGeometry(w - 0.24, 0.04, dep - 0.2), M.ember); coal.position.set(cx, 0.57, zc); scene.add(coal);
        B.box(w + 0.06, 0.4, dep + 0.06, M.stone, cx, 1.42, zc, 1);
        B.box(w * 0.5, WALL_H - 1.6, dep * 0.6, M.stone, cx, 1.6 + (WALL_H - 1.6) / 2, zb + dep * 0.3, 1);
        fy = 0.58;
      } else {
        // 벽난로: 돌 기둥 둘 + 이맛돌 + 선반, 안은 어둡고 장작불
        B.box(w + 0.1, 0.08, dep + 0.14, M.stone, cx, 0.04, zc + 0.07, 1);
        for (const sx of [-1, 1]) B.box(0.2, 0.92, dep, M.stone, cx + sx * (w / 2 - 0.1), 0.46, zc, 1);
        B.box(w, 0.26, dep, M.stone, cx, 1.05, zc, 1);
        B.box(w + 0.14, 0.06, dep + 0.1, M.timber, cx, 1.21, zc + 0.03);
        B.box(w - 0.4, 0.84, 0.06, M.dark, cx, 0.5, zb + 0.04);
        B.box(w * 0.66, WALL_H - 1.24, dep * 0.7, M.stone, cx, 1.24 + (WALL_H - 1.24) / 2, zb + dep * 0.35, 1);
        for (const r of [-0.4, 0.4]) { const g = new THREE.CylinderGeometry(0.045, 0.045, 0.42, 6); g.rotateZ(Math.PI / 2); g.rotateY(r); B.add(g, M.wood, cx, 0.13, zc + 0.02); }
        fy = 0.14;
      }
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(forge ? 0.07 : 0.09, forge ? 0.18 : 0.3, 6), M.flame);
        f.position.set(cx + (i - 1) * (forge ? 0.22 : 0.1), fy + (forge ? 0.09 : 0.15), zc + 0.04);
        f.userData.h = forge ? 0.18 : 0.3; scene.add(f); flames.push(f);
      }
      const light = new THREE.PointLight(0xff8a3a, 5, 7, 1.3); light.position.set(cx, fy + 0.4, zc + 0.35);
      scene.add(light);
      S3.fires.push({ light, base: 5, flames });
    }

    // 낱칸 소품과 사건 칸
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      const cx = x + 0.5, cz = y + 0.5, ev = A.events[ch];
      if (ch === 'P') {
        B.add(new THREE.CylinderGeometry(0.17, 0.12, 0.3, 8), M.pot, cx, 0.15, cz);
        const g = new THREE.IcosahedronGeometry(0.28, 0); g.scale(1, 1.1, 1);
        B.add(g, M.leaf, cx, 0.52, cz, 0, R(x, y) * 6);
        const g2 = new THREE.IcosahedronGeometry(0.17, 0); B.add(g2, M.leafD, cx + 0.12, 0.72, cz - 0.05);
      } else if (ch === 'v') {
        kit(scene, id === 'inn' ? 'keg' : 'barrel_large', cx, 0, cz, id === 'inn' ? 0.24 : 0.27, R(x, y) * 6);
      } else if (ev && ev.icon === 'mat') {
        // 나가는 문: 발판 + 문틀, 문 밖으로 햇빛
        B.box(0.84, 0.02, 0.62, M.matEdge, cx, 0.01, cz);
        B.box(0.72, 0.025, 0.5, M.mat, cx, 0.012, cz);
        for (const sx of [-1, 1]) B.box(0.1, 0.7, 0.16, M.timber, cx + sx * 0.5, 0.35, cz + 0.2);
        const sunlit = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), M.day); sunlit.rotation.x = -Math.PI / 2; sunlit.position.set(cx, 0.005, cz + 0.85); scene.add(sunlit);
      } else if (ev && ev.icon === 'chest') {
        const o = kit(scene, 'chest', cx, 0, cz, 0.3);
        const lid = o && o.getObjectByName('chest_lid');
        if (lid) S3.chests.push({ lid, x, y, open: 0 });
        else if (!o) iconSprite(scene, ev.icon, cx, cz);
      } else if (ev && ev.icon) {
        iconSprite(scene, ev.icon, cx, cz);
      }
    }));
    if (id === 'smithy') kit(scene, 'sword_shield', 5.5, 1.62, 1.04, 0.42);
    if (id === 'inn') kit(scene, 'crates_stacked', 13.5, 0, 8.45, 0.22, 0.4);

    B.build(scene);
    return S3;
  }

  // ---------- 들판 표지: 마을 문 · 잿빛 수도원 · 옛 광산 · 별빛 사당 · 수도사 묘지 ----------
  // 흐리게 만들 수 있게 재질을 제 것으로 바꾼 묶음을 S3.buildings 에 넣는다 (주인공을 가리면 흐려진다)
  function landmark(S3, g) {
    g.traverse((o) => { if (o.isMesh && !o.userData.own) { o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); o.userData.own = true; } });
    S3.scene.add(g);
    g.userData.box = new THREE.Box3().setFromObject(g);
    S3.buildings.push(g);
    return g;
  }
  // 마을 입구: 지붕 얹은 나무 문과 간판, 지도 끝에 말뚝 울타리, 그 너머에 집 몇 채
  function makeTownGate(S3, x, y) {
    const M = materials(), B = Batch(), cx = x + 0.5, cz = y + 0.5;
    for (const sz of [-0.66, 0.66]) {
      B.box(0.2, 1.95, 0.2, M.timber, cx, 0.98, cz + sz);
      B.box(0.32, 0.24, 0.32, M.stone, cx, 0.12, cz + sz, 1);
      B.box(0.06, 0.62, 0.3, M.canvasR, cx + 0.13, 1.25, cz + sz); // 붉은 깃발
      B.box(0.07, 0.05, 0.34, M.gold, cx + 0.13, 1.57, cz + sz);
    }
    B.box(0.24, 0.16, 1.9, M.timber, cx, 1.86, cz);
    B.box(0.16, 0.1, 1.6, M.timber, cx, 1.55, cz);
    for (const side of [1, -1]) { const g = new THREE.BoxGeometry(0.3, 0.05, 2.0); g.rotateZ(-side * 0.5); B.add(g, M.roof, cx + side * 0.13, 2.0, cz); }
    B.box(0.07, 0.08, 2.04, M.ridge, cx, 2.08, cz);
    // 남쪽(카메라 쪽)을 보는 간판
    B.box(0.08, 0.95, 0.08, M.timber, cx + 0.42, 0.47, cz + 0.88);
    const g = B.build(new THREE.Group(), true);
    const bd = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.05), [M.timber, M.timber, M.timber, M.timber, new THREE.MeshLambertMaterial({ map: signTexture('로엘') }), M.timber]);
    bd.position.set(cx + 0.42, 0.86, cz + 0.93); bd.castShadow = true; g.add(bd);
    landmark(S3, g);
    // 말뚝 울타리: 지도 서쪽 끝 칸, 길만 비우고
    const stakes = [];
    for (let z = y - 3; z <= y + 3.9; z += 0.22) if (Math.abs(z - cz) > 0.75) stakes.push({ x: 0.55 + (hash(z * 9 | 0, 3) - 0.5) * 0.06, y: 0.5, z, sx: 1, sy: 0.85 + hash(z * 9 | 0, 5) * 0.3, sz: 1 });
    instances(S3.scene, new THREE.CylinderGeometry(0.075, 0.085, 1, 6), M.wood, stakes);
    instances(S3.scene, new THREE.ConeGeometry(0.08, 0.2, 6), M.timber, stakes.map((p) => ({ ...p, y: 0.5 + p.sy / 2 + 0.1, sy: 1 })));
    for (const b of [{ x0: -2, x1: -1, y0: y - 3, y1: y - 2 }, { x0: -3, x1: -2, y0: y + 1, y1: y + 2 }, { x0: -6, x1: -5, y0: y - 2, y1: y - 1 }, { x0: -7, x1: -5, y0: y + 2, y1: y + 3 }]) {
      S3.buildings.push(makeBuilding({ ...b, doors: [], church: false }, S3.scene, S3.doors));
    }
  }
  // 잿빛 수도원: 산 위의 돌 성당 (마을 성당과 같은 짜임, 더 크게). 정문이 잠겨 있으면 검은 사슬
  function makeAbbey(S3, x, y) {
    const M = materials();
    const g = makeBuilding({ x0: x - 2, x1: x + 2, y0: y - 2, y1: y, doors: [{ x, y, name: '잿빛 수도원' }], church: true }, S3.scene, S3.doors);
    S3.buildings.push(g);
    const d = S3.doors[S3.doors.length - 1];
    d.lock = 'abbey_open';
    const B = Batch(), dz = y + 1.08, cx = x + 0.5, chain = new THREE.MeshLambertMaterial({ color: 0x55565c });
    for (const s of [1, -1]) for (let t = -0.5; t <= 0.5; t += 0.085) {
      const link = new THREE.TorusGeometry(0.05, 0.017, 4, 8);
      if (Math.round(t / 0.085) % 2) link.rotateY(Math.PI / 2);
      link.rotateZ(s * 0.9);
      B.add(link, chain, cx + t, 0.68 + s * t * 1.15, dz);
    }
    B.box(0.2, 0.22, 0.1, M.gold, cx, 0.68, dz + 0.04);
    B.box(0.12, 0.1, 0.04, M.iron, cx, 0.84, dz + 0.04);
    d.chains = B.build(new THREE.Group(), true);
    g.add(d.chains);
    // 수도원 둘레 바위
    const rocks = [[-2.8, 0.6, 2.8], [2.9, 0.7, 3], [-2.4, 0.9, 1.8], [3.1, -0.4, 2.2]];
    rocks.forEach(([ox, oz, s], i) => kit(S3.scene, i % 2 ? 'rock_single_D' : 'rock_single_B', cx + ox, 0, y + oz, s, i * 1.7));
  }
  // 옛 광산: 바위 둔덕에 나무 틀을 댄 갱도, 밖으로 나온 레일, 상자와 손수레
  function makeMine(S3, x, y) {
    const M = materials(), B = Batch(), cx = x + 0.5, cz = y + 0.5, fz = cz + 0.06;
    const g = new THREE.Group();
    kit(g, 'mountain_C', cx + 0.1, -0.05, cz - 0.5, [0.72, 0.72, 0.56], Math.PI / 3);
    kit(g, 'rock_single_B', cx - 0.62, 0, fz - 0.12, 3, 0.4);
    kit(g, 'rock_single_D', cx + 0.6, 0, fz - 0.1, 3.2, 2.1);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.84), M.dark); hole.position.set(cx, 0.42, fz - 0.03); g.add(hole);
    for (const s of [-1, 1]) {
      B.box(0.11, 0.92, 0.11, M.timber, cx + s * 0.37, 0.46, fz);
      const brace = new THREE.BoxGeometry(0.06, 0.3, 0.06); brace.rotateZ(s * 0.7); B.add(brace, M.timber, cx + s * 0.28, 0.82, fz + 0.02);
    }
    B.box(0.96, 0.13, 0.15, M.timber, cx, 0.96, fz);
    for (const s of [-1, 1]) B.box(0.03, 0.03, 0.6, M.iron, cx + s * 0.15, 0.03, fz + 0.25);
    for (let i = 0; i < 5; i++) B.box(0.44, 0.025, 0.07, M.wood, cx, 0.013, fz - 0.02 + i * 0.13);
    B.box(0.1, 0.13, 0.1, M.lamp, cx - 0.3, 0.8, fz + 0.1);
    B.build(g, true);
    kit(g, 'crate_A_big', cx - 0.52, 0, fz + 0.34, 1.7, 0.3);
    kit(g, 'crate_A_big', cx - 0.5, 0.36, fz + 0.32, 1.3, 0.9);
    kit(g, 'wheelbarrow', cx + 0.56, 0, fz + 0.42, 1.8, 2.6);
    landmark(S3, g);
    const lamp = new THREE.PointLight(0xffb060, 1.4, 3, 1.6); lamp.position.set(cx - 0.3, 0.8, fz + 0.3);
    S3.scene.add(lamp); S3.fires.push({ light: lamp, base: 1.4, flames: [] });
  }
  // 별빛 사당: 네 기둥에 이끼 낀 지붕, 가운데 받침돌 위 물그릇에 별빛이 고인다
  function makeShrine(S3, x, y) {
    const M = materials(), B = Batch(), K = 1.25, X = x + 0.5, Z = y + 0.5;
    B.box(0.98, 0.1, 0.98, M.stone, 0, 0.05, 0, 1);
    B.box(0.82, 0.08, 0.82, M.stone, 0, 0.14, 0, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.box(0.1, 0.96, 0.1, M.stone, sx * 0.33, 0.66, sz * 0.33, 1);
    for (const s of [-1, 1]) { B.box(0.84, 0.1, 0.12, M.stone, 0, 1.18, s * 0.33, 1); B.box(0.12, 0.1, 0.84, M.stone, s * 0.33, 1.18, 0, 1); }
    const hd = 0.54, rh = 0.5, ang = Math.atan2(rh, hd), len = Math.hypot(hd, rh) + 0.06;
    for (const s of [1, -1]) B.add(new THREE.BoxGeometry(1.06, 0.07, len), M.moss, 0, 1.23 + rh / 2 + 0.03, s * hd / 2, s * ang, 0, 0.5, true);
    B.box(1.1, 0.08, 0.1, M.ridgeSlate, 0, 1.23 + rh + 0.06, 0);
    for (const s of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(-hd + 0.08, 0); sh.lineTo(hd - 0.08, 0); sh.lineTo(0, rh - 0.04); sh.closePath(); const t = new THREE.ShapeGeometry(sh); t.rotateY(s * Math.PI / 2); B.add(t, M.stone, s * 0.4, 1.23, 0); }
    B.add(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 8), M.stone, 0, 0.43, 0);
    B.add(new THREE.CylinderGeometry(0.2, 0.12, 0.1, 12), M.stone, 0, 0.72, 0);
    const g = B.build(new THREE.Group(), true);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xa8e0ff });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), glowMat); pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.775, 0); g.add(pool);
    g.position.set(X, 0, Z); g.scale.setScalar(K);
    landmark(S3, g);
    pool.material = glowMat;
    const light = new THREE.PointLight(0x8ccfff, 2.2, 4, 1.4); light.position.set(X, 1.1, Z);
    S3.scene.add(light);
    // 별빛 알갱이: 물그릇에서 천천히 떠오른다
    const N = 30, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) seed[i] = Math.random();
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xe0f4ff, size: 0.06, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    S3.scene.add(pts);
    S3.glows.push({ light, base: 2.2, mat: glowMat, geo, seed, N, x: X, y: 0.78 * K, z: Z });
  }
  // 수도사 묘지: 숲속 납골당 (입구는 동쪽), 둘레에 비석과 마른 나무, 등불, 떠다니는 푸른 불
  function makeCrypt(S3, x, y) {
    const cx = x + 0.5, cz = y + 0.5, scene = S3.scene;
    const g = new THREE.Group();
    if (!kit(g, 'crypt', cx - 0.32, 0, cz - 0.05, 0.22, Math.PI / 2)) { iconSprite(scene, 'crypt', cx, cz); return; }
    landmark(S3, g);
    g.traverse((o) => { if (o.isMesh) o.material.color.setRGB(0.6, 0.62, 0.7); }); // 주황 지붕을 잿빛 이끼 돌로
    const graves = [[-3.2, -1.6, 'grave_A'], [-2.3, -1.9, 'gravestone'], [-1.4, -1.45, 'gravemarker_A'], [-3.4, -0.4, 'gravemarker_B'], [-2.5, 0.2, 'grave_B'],
      [-3.0, 1.1, 'gravestone'], [-1.9, 1.2, 'gravemarker_A'], [0.2, 1.25, 'grave_A'], [1.3, 1.1, 'gravemarker_B'], [2.4, 1.3, 'gravestone'], [3.3, 1.0, 'grave_B'], [-4.2, -1.0, 'grave_B']];
    const sc = { grave_A: 0.25, grave_B: 0.25, gravestone: 0.3, gravemarker_A: 0.4, gravemarker_B: 0.4 };
    graves.forEach(([ox, oz, n], i) => kit(scene, n, cx + ox, 0, cz + oz, sc[n], (hash(i, 7) - 0.5) * 0.5));
    kit(scene, 'tree_dead_large', cx - 3.9, 0, cz - 2.4, 0.42, 0.8);
    kit(scene, 'tree_dead_medium', cx - 4.5, 0, cz + 0.4, 0.4, 2.2);
    kit(scene, 'tree_dead_small', cx + 4.1, 0, cz + 1.2, 0.36, 4);
    kit(scene, 'tree_dead_medium', cx + 2.2, 0, cz - 2.5, 0.42, 1.2);
    kit(scene, 'fence', cx - 2.4, 0, cz + 1.75, 0.22);
    kit(scene, 'fence_broken', cx + 1.9, 0, cz + 1.75, 0.22);
    kit(scene, 'post_lantern', cx + 0.6, 0, cz + 0.62, 0.36, -Math.PI / 2);
    const lamp = new THREE.PointLight(0xffc070, 1.2, 3, 1.6); lamp.position.set(cx + 0.6, 1.0, cz + 0.9);
    scene.add(lamp); S3.fires.push({ light: lamp, base: 1.2, flames: [] });
    // 푸른 불 (도깨비불)
    const halo = canvasTex(64, (c, s) => { const gr = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, 'rgba(200,240,255,1)'); gr.addColorStop(0.3, 'rgba(110,190,255,0.6)'); gr.addColorStop(1, 'rgba(60,120,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, s, s); });
    const blue = new THREE.PointLight(0x6ab8ff, 1.1, 3.2, 1.5); scene.add(blue);
    [[-2.6, -0.8], [-1.6, 0.6], [1.6, 0.9], [-3.4, 0.5]].forEach(([ox, oz], i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.scale.set(0.42, 0.42, 1); scene.add(sp);
      S3.wisps.push({ obj: sp, x: cx + ox, z: cz + oz, ph: i * 1.9, light: i === 0 ? blue : null });
    });
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
  function makeSignpost(scene, x, z, text) {
    const M = materials(), B = Batch();
    B.box(0.08, 0.95, 0.08, M.timber, 0, 0.47, 0);
    const g = B.build(new THREE.Group());
    const bd = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.05), [M.timber, M.timber, M.timber, M.timber, new THREE.MeshLambertMaterial({ map: signTexture(text) }), M.timber]);
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

  // ---------- 전투 무대 ----------
  // 3D로 보기에서 싸우면 따로 세운 들판 무대로 옮겨 싸운다. 파티는 오른쪽에 3D 모델로, 적은 왼쪽에 지금 쓰는 몬스터 그림 판으로 선다
  // 전투 규칙·명령 창은 engine.js 그대로. engine 이 매 장면 v.battle(적 연출 상태)을 넘기고, 행동마다 W3.act / W3.fx 를 부른다
  const PARTY_SPOT = [[1.05, -0.1], [2.0, -0.95], [2.35, 0.75]];   // 파티 순서대로 [x, z] (x 오른쪽, z 카메라 쪽). 전사가 앞에 선다
  const ONCE = new Set(['slash', 'swing', 'cast', 'raise', 'guard', 'hit']);
  let stage = null, bt = null;   // bt = 지금 전투 { ref, foes, fx, steps, saved }
  const imgTex = new WeakMap();
  let dotTex = null;

  function buildStage() {
    const scene = new THREE.Scene();
    const SKY = 0xa8cfe0;
    scene.background = new THREE.Color(SKY);
    scene.fog = new THREE.Fog(SKY, 18, 48);
    scene.add(hemi.clone());
    const light = sun.clone(); light.shadow = sun.shadow.clone(); light.castShadow = true;
    Object.assign(light.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    light.position.set(5, 14, 9); light.target.position.set(0, 0, 0);
    scene.add(light, light.target);
    const R = (i, k) => hash(i * 17 + k * 131, k * 7 + 3);
    // 땅: 풀밭, 가운데는 밟혀 흙이 드러난 자리
    const grass = canvasTex(256, (g, s) => {
      g.fillStyle = '#68a042'; g.fillRect(0, 0, s, s);
      const cols = ['#52883a', '#7cb04e', '#5c943c', '#88b85a'];
      for (let i = 0; i < 900; i++) { g.fillStyle = cols[i % 4]; g.globalAlpha = 0.25 + Math.random() * 0.4; g.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 3, 4 + Math.random() * 7); }
      g.globalAlpha = 1;
    }, 24);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(96, 96), new THREE.MeshLambertMaterial({ map: grass }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const dirt = canvasTex(256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, s * 0.08, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(176,142,92,0.85)'); r.addColorStop(0.55, 'rgba(160,128,80,0.6)'); r.addColorStop(1, 'rgba(150,120,76,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * s * 0.42;
        g.fillStyle = Math.random() < 0.5 ? 'rgba(120,92,58,0.35)' : 'rgba(200,170,120,0.3)';
        g.fillRect(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, 2 + Math.random() * 4, 2 + Math.random() * 3);
      }
    });
    dirt.wrapS = dirt.wrapT = THREE.ClampToEdgeWrapping;
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.5), new THREE.MeshLambertMaterial({ map: dirt, transparent: true, depthWrite: false }));
    patch.rotation.x = -Math.PI / 2; patch.position.set(0.1, 0.01, 0); patch.receiveShadow = true; patch.renderOrder = -1; scene.add(patch);

    // 둘레의 숲 (카메라 쪽은 비운다), 그 너머 언덕과 산
    const forest = { trees_A_large: [], trees_A_medium: [], trees_B_large: [], trees_B_medium: [], tree_single_A: [], tree_single_B: [] }, names = Object.keys(forest);
    for (let i = 0; i < 90; i++) {
      const a = R(i, 1) * Math.PI * 2, r = 6.2 + R(i, 2) * 7;
      const x = Math.cos(a) * r * 1.35, z = Math.sin(a) * r - 1.5;
      if (z > 1.5 && Math.abs(x) < 9) continue;
      forest[names[Math.floor(R(i, 3) * names.length)]].push({ x, z, s: 1.8 + R(i, 4) * 0.9, r: R(i, 5) * 6 });
    }
    const hills = { hills_A_trees: [], mountain_A_grass_trees: [], mountain_B_grass_trees: [], hill_single_A: [] };
    Object.keys(hills).forEach((n, k) => { for (let i = 0; i < 4; i++) hills[n].push({ x: -26 + (i * 4 + k) * 3.4 + R(i, k + 9) * 2, z: -19 - R(i, k + 11) * 6, s: 3.5 + R(i, k + 13) * 2.5, r: R(i, k + 15) * 6 }); });
    const rocks = { rock_single_A: [{ x: -4.4, z: -1.6, s: 2.2, r: 1 }, { x: 4.6, z: 1.6, s: 1.8, r: 2 }], rock_single_C: [{ x: -2.8, z: -3.4, s: 2, r: 0.4 }], rock_single_E: [{ x: 3.8, z: -2.9, s: 2.4, r: 3 }, { x: -5.4, z: 2.2, s: 1.7, r: 5 }] };
    for (const group of [forest, hills, rocks]) for (const [n, list] of Object.entries(group)) scatter(scene, n, list);
    // 풀 포기·덤불·들꽃
    const tufts = [], bushes = [], flowers = [];
    for (let i = 0; i < 520; i++) {
      const x = (R(i, 20) - 0.5) * 18, z = (R(i, 21) - 0.5) * 12 - 1;
      if (Math.abs(x) < 3.2 && Math.abs(z) < 1.9) continue;
      tufts.push({ x, y: 0.06, z, sy: 0.7 + R(i, 22) * 0.7, r: R(i, 23) * 6, color: R(i, 24) < 0.5 ? 0x4f8a34 : 0x6aa244 });
      if (i % 9 === 0) flowers.push({ x: x + 0.2, y: 0.09, z, sx: 0.05, sy: 0.05, sz: 0.05, color: [0xf2e070, 0xf4f0f0, 0xe07aa0, 0x9a8af0][i % 4] });
    }
    for (let i = 0; i < 14; i++) {
      const a = R(i, 30) * Math.PI * 2, r = 4.4 + R(i, 31) * 1.6, x = Math.cos(a) * r * 1.3, z = Math.sin(a) * r * 0.8 - 1;
      if (z > 1.2) continue;
      bushes.push({ x, y: 0.2, z, sx: 0.36 + R(i, 32) * 0.2, sy: 0.3 + R(i, 33) * 0.1, sz: 0.36, r: R(i, 34) * 6, color: R(i, 35) < 0.5 ? 0x3f7a32 : 0x4c8a38 });
    }
    instances(scene, new THREE.ConeGeometry(0.035, 0.14, 3), new THREE.MeshLambertMaterial({}), tufts, false);
    instances(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ flatShading: true }), bushes);
    instances(scene, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({}), flowers, false);
    return { scene, sun: light };
  }

  function foeTex(img) {
    let t = imgTex.get(img);
    if (!t) { t = new THREE.CanvasTexture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; imgTex.set(img, t); }
    return t;
  }
  // 적 그림 판: 아래 끝이 땅에 닿게 세우고 발밑에 그림자. 나는 적(fly)은 조금 떠 있다
  function setupBattle(b) {
    if (!stage) stage = buildStage();
    if (bt) clearFoes3D();
    else bt = { saved: party.map((m) => ({ pos: m.pos.clone(), yaw: m.yaw })), fx: [], steps: party.map(() => null) };
    bt.ref = b.ref; bt.img = b.img; bt.foes = [];
    const n = b.foes.length, h = 0.7 * b.scale, w = h * b.aspect, gap = Math.max(1.05, w * 0.9);
    b.foes.forEach((f, i) => {
      const g = new THREE.Group();
      const mat = new THREE.SpriteMaterial({ map: foeTex(b.img), color: b.tint, transparent: true, alphaTest: 0.03, depthWrite: false,
        blending: b.glow ? THREE.AdditiveBlending : THREE.NormalBlending });
      const sp = new THREE.Sprite(mat);
      sp.center.set(0.5, 0); sp.scale.set(w, h, 1);
      sp.position.y = b.fly ? 0.45 : 0;
      const sh = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.22, w * 0.36), 18), materials().shadow);
      sh.rotation.x = -Math.PI / 2; sh.position.y = 0.015; sh.scale.set(1, 0.55, 1); sh.renderOrder = -1;
      g.add(sp, sh);
      const base = new THREE.Vector3(-1.2 - w * 0.25 - (n > 1 && i % 2 ? 0.55 : 0), 0, (i - (n - 1) / 2) * gap);
      g.position.copy(base);
      stage.scene.add(g);
      bt.foes.push({ g, sp, sh, base, h, w, fly: b.fly, tint: new THREE.Color(b.tint), phase: i * 1.7 });
    });
    for (const m of party) { stage.scene.add(m.root); m.down = false; }
    party.forEach((m, i) => { const [x, z] = PARTY_SPOT[i] || [2.5, 0]; m.pos.set(x, 0, z); m.yaw = -Math.PI / 2 + 0.4; setAnim(m, 'idle'); });
  }
  function clearFoes3D() {
    for (const f of bt.foes) { stage.scene.remove(f.g); f.sp.material.dispose(); f.sh.geometry.dispose(); }
    bt.foes = [];
  }
  // 전투가 끝나면 파티를 원래 지역 장면·자리로 돌려놓는다
  function endBattle3D(S3) {
    clearFoes3D();
    for (const p of bt.fx) { stage.scene.remove(p.obj); if (p.light) stage.scene.remove(p.light); p.obj.geometry.dispose(); p.obj.material.dispose(); }
    party.forEach((m, i) => {
      const s = bt.saved[i];
      S3.scene.add(m.root);
      m.pos.copy(s.pos); m.yaw = s.yaw; m.root.position.copy(m.pos); m.root.rotation.y = m.yaw;
      setAnim(m, 'idle');
    });
    bt = null;
  }

  // 파티의 행동 (engine 의 partyAct·foeAct 에서): attack(적 번호) · fire · heal · guard · hit
  function battleAct(i, kind, arg) {
    const m = party[i];
    if (!bt || !m) return;
    if (kind === 'attack') { setAnim(m, ATTACK_ANIM[i] || 'slash', true); bt.steps[i] = { t: 0, foe: arg }; }
    else if (kind === 'fire') setAnim(m, 'cast', true);
    else if (kind === 'heal') setAnim(m, 'raise', true);
    else if (kind === 'guard') setAnim(m, 'guard', true);
    else if (kind === 'hit') setTimeout(() => { if (bt && !m.down) setAnim(m, 'hit', true); }, 180);
  }
  // 효과: fire(살아 있는 적 모두에 불꽃) · breath(파티 모두에 불꽃) · heal(파티원 번호) · spark(맞은 적 번호)
  function battleFx(kind, arg) {
    if (!bt) return;
    const at = [];
    if (kind === 'fire') for (const f of bt.foes) { if (f.g.visible) at.push(f.g.position.clone().setY(f.h * 0.45)); }
    if (kind === 'breath') for (const m of party) at.push(m.pos.clone().setY(0.5));
    if (kind === 'heal' && party[arg]) at.push(party[arg].pos.clone().setY(0.1));
    if (kind === 'spark' && bt.foes[arg]) at.push(bt.foes[arg].base.clone().setY(bt.foes[arg].h * 0.5 + (bt.foes[arg].fly ? 0.45 : 0)));
    const C = { fire: [0xff9a30, 0xffd060], breath: [0xff6a20, 0xffb040], heal: [0x9cff9a, 0xfff0a0], spark: [0xffffff, 0xfff0b0] }[kind];
    const delay = kind === 'spark' ? 0.22 : kind === 'fire' || kind === 'heal' ? 0.35 : 0;
    for (const p of at) burst(kind, p, C, delay);
  }
  function burst(kind, at, C, delay) {
    if (!dotTex) dotTex = canvasTex(64, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.4, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); });
    const N = kind === 'spark' ? 14 : kind === 'heal' ? 36 : 56, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = [];
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random();
      if (kind === 'heal') { pos.set([at.x + Math.cos(a) * 0.35 * u, at.y + Math.random() * 0.4, at.z + Math.sin(a) * 0.35 * u], i * 3); vel.push([0, 0.8 + Math.random() * 0.8, 0]); }
      else if (kind === 'spark') { pos.set([at.x, at.y, at.z], i * 3); vel.push([Math.cos(a) * 2.2 * u, (Math.random() - 0.3) * 2.4, Math.sin(a) * 2.2 * u]); }
      else { pos.set([at.x + (Math.random() - 0.5) * 0.4, at.y + (Math.random() - 0.5) * 0.5, at.z + (Math.random() - 0.5) * 0.4], i * 3); vel.push([Math.cos(a) * 0.9 * u, 0.6 + Math.random() * 1.4, Math.sin(a) * 0.9 * u]); }
      c.set(C[i % 2]); col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: kind === 'spark' ? 0.16 : kind === 'heal' ? 0.3 : 0.45, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const obj = new THREE.Points(geo, mat);
    stage.scene.add(obj);
    const light = kind === 'spark' ? null : new THREE.PointLight(C[0], 0, 4, 1.5);
    if (light) { light.position.copy(at).setY(at.y + 0.3); stage.scene.add(light); }
    bt.fx.push({ obj, vel, light, t: -delay, life: kind === 'spark' ? 0.4 : 0.9, grav: kind === 'spark' ? -6 : kind === 'heal' ? 0 : 0.6 });
  }

  // 전투 장면 한 번. v.battle = { ref, img, aspect, scale, tint, glow, fly, foes: [{hit, lunge, dying}], down: [파티원 쓰러짐], won }
  function battleFrame(v, w, h) {
    const b = v.battle, dt = v.dt;
    if (!bt || bt.ref !== b.ref || bt.img !== b.img || bt.foes.length !== b.foes.length) setupBattle(b);
    clockT += dt;
    // 적: 숨 쉬듯 들썩이고, 덤빌 때는 파티 쪽으로 달려들고, 맞으면 흔들리며 붉게 번쩍, 쓰러지면 가라앉으며 사라진다
    bt.foes.forEach((f, i) => {
      const s = b.foes[i] || { hit: 0, lunge: 0, dying: 1 };
      const t = clockT + f.phase;
      const p = f.g.position.copy(f.base);
      if (s.lunge > 0) p.x += Math.sin((1 - s.lunge) * Math.PI) * 1.5;
      if (s.hit > 0) p.x += Math.sin(clockT * 80) * 0.06 * s.hit - s.hit * 0.1;
      f.sp.position.y = (f.fly ? 0.45 + Math.sin(t * 2.2) * 0.08 : 0) - s.dying * f.h * 0.25;
      f.sp.scale.set(f.w * (1 - Math.sin(t * 3) * 0.015), f.h * (1 + Math.sin(t * 3) * 0.02) * (1 - s.dying * 0.3), 1);
      f.sp.material.opacity = 1 - s.dying;
      f.sh.visible = s.dying < 0.6;
      f.sp.material.color.copy(f.tint);
      if (s.hit > 0 && Math.floor(clockT * 30) % 2) f.sp.material.color.setRGB(1, 0.45, 0.4);
      f.g.visible = s.dying < 1;
    });
    // 파티: 제자리에서 적 쪽을 보고 선다. 공격할 때는 노린 적 쪽으로 몇 걸음 나갔다 돌아온다
    const fc = bt.foes.length ? bt.foes.reduce((a, f) => a.add(f.base), new THREE.Vector3()).multiplyScalar(1 / bt.foes.length) : new THREE.Vector3(-2, 0, 0);
    party.forEach((m, i) => {
      const [sx, sz] = PARTY_SPOT[i] || [2.5, 0];
      let px = sx, pz = sz;
      const st = bt.steps[i];
      if (st) {
        st.t += dt;
        const f = bt.foes[st.foe], k = Math.sin(Math.min(1, st.t / 0.75) * Math.PI) * 0.7;
        if (f) { const dx = f.base.x - sx, dz = f.base.z - sz, L = Math.hypot(dx, dz) || 1; px += dx / L * k * Math.min(1, L - 0.9); pz += dz / L * k * Math.min(1, L - 0.9); }
        if (st.t >= 0.75) bt.steps[i] = null;
      }
      m.pos.set(px, 0, pz);
      const want = Math.atan2(fc.x - px, fc.z - pz) + 0.25;
      let d = want - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      m.yaw += d * Math.min(1, dt * 10);
      m.down = !!(b.down && b.down[i]);
      const base = m.down ? 'down' : b.won ? 'cheer' : 'idle';
      const a = m.acts && m.acts[m.cur];
      const busy = ONCE.has(m.cur) && a && a.isRunning() && a.time < a.getClip().duration - 0.02;
      if (!busy) setAnim(m, m.acts && m.acts[base] ? base : 'idle');
      m.root.position.copy(m.pos); m.root.rotation.y = m.yaw;
      if (m.mixer) m.mixer.update(dt);
    });
    // 불꽃·빛 알갱이
    for (let i = bt.fx.length - 1; i >= 0; i--) {
      const p = bt.fx[i];
      p.t += dt;
      if (p.t < 0) continue;
      const k = p.t / p.life, arr = p.obj.geometry.attributes.position.array;
      p.vel.forEach((vv, j) => { vv[1] += p.grav * dt; arr[j * 3] += vv[0] * dt; arr[j * 3 + 1] += vv[1] * dt; arr[j * 3 + 2] += vv[2] * dt; });
      p.obj.geometry.attributes.position.needsUpdate = true;
      p.obj.material.opacity = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      if (p.light) p.light.intensity = 6 * Math.max(0, 1 - k) * Math.min(1, k * 8);
      if (k >= 1) { stage.scene.remove(p.obj); if (p.light) stage.scene.remove(p.light); p.obj.geometry.dispose(); p.obj.material.dispose(); bt.fx.splice(i, 1); }
    }
    // 카메라: 무대 앞쪽 조금 왼쪽 위에서 양쪽이 다 보이게. 천천히 좌우로 흔들린다
    const aspect = w / h, f2 = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const dist = Math.max(5.4 / (f2 * aspect), 2.6 / f2) + 0.6;
    const pitch = THREE.MathUtils.degToRad(17), yaw = -0.12 + (v.reduceMotion ? 0 : Math.sin(clockT * 0.25) * 0.05);
    let shx = 0, shz = 0;
    if (v.shake) { shx = Math.sin(clockT * 70) * 0.08 * v.shake; shz = Math.cos(clockT * 63) * 0.06 * v.shake; }
    const tx = 0.45, ty = 0.55, tz = 0.15;
    camera.position.set(tx + Math.sin(yaw) * Math.cos(pitch) * dist + shx, ty + Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist + shz);
    camera.lookAt(tx + shx, ty, tz + shz);
    CUT.r.value = 0;
    renderer.render(stage.scene, camera);
    return true;
  }

  // ---------- 매 장면 ----------
  const trail = [];   // 주인공이 걸어온 자리 (오래된 것부터)
  const camT = { x: 0, z: 0, ok: false };
  let lastHero = null, clockT = 0;
  const ray = { o: null, d: null };

  // v: { area, hero: {x, y, dir}, moving, movers: [{x, y, npc, key}], ok(x, y), done(x, y), flag(name), shake, battle, dt, reduceMotion }
  function frame(v) {
    if (!W3.ready) return false;
    const canvas = renderer.domElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return true;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    if (v.battle) return battleFrame(v, w, h);
    if (!scenes[v.area]) scenes[v.area] = buildArea(v.area);
    const S3 = scenes[v.area];
    if (bt) endBattle3D(S3);
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

    // 문: 앞에 서면 안으로 열린다 (잠긴 문은 열쇠 깃발이 설 때까지 닫혀 있고 사슬이 감겨 있다)
    for (const d of S3.doors) {
      const locked = !!d.lock && !(v.flag && v.flag(d.lock));
      if (d.chains) d.chains.visible = locked;
      const near = !locked && Math.abs(hx - (d.x + 0.5)) < 0.6 && hz - d.y < 1.9 && hz > d.y;
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
    // 집 안: 불꽃 일렁임, 열린 상자는 뚜껑을 연다
    if (S3.fires) for (const f of S3.fires) {
      const n = 0.82 + 0.18 * vnoise(clockT * 6 + f.base * 10, f.light.position.x);
      f.light.intensity = f.base * n;
      f.flames.forEach((m, i) => m.scale.set(1, 0.75 + 0.5 * vnoise(clockT * 8 + i * 3, i), 1));
    }
    // 별빛 사당: 물빛이 숨 쉬듯 밝아졌다 어두워지고, 알갱이가 떠오른다
    for (const gl of S3.glows || []) {
      const k = 0.8 + 0.2 * Math.sin(clockT * 1.6);
      gl.light.intensity = gl.base * k;
      gl.mat.color.setRGB(0.6 + 0.2 * k, 0.82 + 0.1 * k, 1);
      const a = gl.geo.attributes.position.array;
      for (let i = 0; i < gl.N; i++) {
        const t = (clockT * 0.25 + gl.seed[i]) % 1, ang = gl.seed[i] * 50 + clockT * 0.5;
        a[i * 3] = gl.x + Math.cos(ang) * 0.12 * (1 + t); a[i * 3 + 1] = gl.y + t * 0.9; a[i * 3 + 2] = gl.z + Math.sin(ang) * 0.12 * (1 + t);
      }
      gl.geo.attributes.position.needsUpdate = true;
    }
    // 묘지의 푸른 불: 비석 사이를 천천히 떠다닌다
    for (const w of S3.wisps || []) {
      const t = clockT * 0.5 + w.ph;
      w.obj.position.set(w.x + Math.sin(t * 0.7) * 0.5, 0.55 + Math.sin(t * 1.9) * 0.12, w.z + Math.cos(t * 0.53) * 0.35);
      w.obj.material.opacity = 0.65 + 0.35 * Math.sin(t * 3.1);
      if (w.light) { w.light.position.copy(w.obj.position); w.light.intensity = 0.8 + 0.4 * Math.sin(t * 3.1); }
    }
    if (S3.chests) for (const c of S3.chests) {
      c.open += ((v.done && v.done(c.x, c.y) ? 1 : 0) - c.open) * Math.min(1, dt * 6);
      c.lid.rotation.x = -c.open * 1.2;
    }

    // 카메라: 남쪽 위에서 비스듬히 내려다본다 (위 = 북쪽, 패드 방향 그대로). 화면 폭에 칸이 10~13개 보이게
    // 집 안은 방 폭에 맞춰 더 가까이, 세로는 방 가운데 근처만 따라간다
    const aspect = w / h, across = S3.indoor ? Math.min(aspect < 1.45 ? 10.5 : 12.5, S3.cols + 0.6) : aspect < 1.45 ? 10.5 : 12.5;
    const fovR = THREE.MathUtils.degToRad(camera.fov);
    const dist = across / (2 * Math.tan(fovR / 2) * aspect) * 1.02;
    const pitch = THREE.MathUtils.degToRad(52);
    const halfW = across / 2;
    const tx = S3.cols <= across ? S3.cols / 2 : Math.max(halfW - S3.edge, Math.min(S3.cols - halfW + S3.edge, hx));
    const tz = S3.indoor ? Math.max(S3.rows / 2 - 0.6, Math.min(S3.rows / 2 + 0.4 + Math.max(0, S3.rows - 9) * 0.6, hz)) : Math.max(3.2, Math.min(S3.rows - 1.8, hz));
    if (!camT.ok || v.reduceMotion) { camT.x = tx; camT.z = tz; camT.ok = true; }
    const k = 1 - Math.exp(-dt * 7);
    camT.x += (tx - camT.x) * k; camT.z += (tz - camT.z) * k;
    let sx = 0, sz = 0;
    if (v.shake) { sx = Math.sin(clockT * 70) * 0.08 * v.shake; sz = Math.cos(clockT * 63) * 0.08 * v.shake; }
    camera.position.set(camT.x + sx, Math.sin(pitch) * dist, camT.z + Math.cos(pitch) * dist + sz);
    camera.lookAt(camT.x + sx, 0.4, camT.z + sz);
    CUT.hero.value.set(hx, 0.55, hz); CUT.r.value = S3.indoor ? 0.7 : 0.95;
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
