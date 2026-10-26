// 던전 엔진: 상태, 격자 이동, Three.js 3D 렌더링(횃불 조명·안개·그림자), 미니맵, 사건 처리.
// 콘텐츠는 data.js(window.DUNGEON)에서만 읽는다. 게임 규칙은 격자 단위, 화면은 그 위를 부드럽게 따라간다.
(function () {
  'use strict';
  const D = window.DUNGEON;
  const THREE = window.THREE;
  const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
  const DIR_NAME = ['북', '동', '남', '서'];
  const CELL = 2, WALL_H = 2.6, EYE = 1.3;
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const $ = (id) => document.getElementById(id);
  const sfx = (name) => { if (window.BGM && BGM.sfx) BGM.sfx(name); }; // 효과음 (music.js)
  const view = $('view');
  const mini = $('minimap'), mctx = mini.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const C = {
    bg: css.getPropertyValue('--void').trim(),
    torch: css.getPropertyValue('--torch').trim(),
    dim: css.getPropertyValue('--ash').trim(),
    seen: css.getPropertyValue('--stone').trim()
  };

  let S = null;       // 게임 상태 (저장 가능한 순수 데이터)
  let dialog = null;  // { key, ev, pageId } 사건 진행 중이면 이동 잠금

  // ---------- 상태 ----------
  function newState() {
    const st = D.start, dg = D.dungeon;
    return {
      // mode: 'world' 위에서 보는 필드·마을 / 'dungeon' 1인칭 던전
      mode: 'world', area: st.area, wx: st.x, wy: st.y, wdir: st.dir,
      floor: dg.floor, x: dg.x, y: dg.y, dir: dg.dir,
      party: D.party.members.map((m) => ({
        name: m.name, cls: m.cls, lv: 1, exp: 0,
        hp: m.hp, maxHp: m.hp, mp: m.mp, maxMp: m.mp, atk: m.atk, def: m.def,
        grow: m.grow, spells: m.spells.slice(), weapon: m.weapon
      })),
      gold: st.gold || 0, steps: 0, calm: 0, battle: null,
      items: [], flags: {}, done: {}, unlocked: {}, seen: {},
      log: [], ended: null
    };
  }
  const alive = () => S.party.filter((m) => m.hp > 0);
  // 무기 (data.js weapons): 공격력은 맨몸 + 무기, 주문 위력은 무기의 mag 만큼 더 세다
  const WEAPONS = D.weapons || {};
  const weaponOf = (m) => WEAPONS[m.weapon] || null;
  const atkOf = (m) => m.atk + ((weaponOf(m) || {}).atk || 0);
  const magOf = (m) => (weaponOf(m) || {}).mag || 0;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const roll = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const floor = () => D.floors[S.floor];
  const key = (x, y, f = S.floor) => f + ':' + x + ',' + y;
  function cellOf(fl, x, y) {
    const row = D.floors[fl].map[y];
    return (row && row[x]) || '#';
  }
  const cell = (x, y) => cellOf(S.floor, x, y);
  // 'wall' | 'door' | 'locked' | 'open'
  function kindOf(fl, x, y) {
    const ch = cellOf(fl, x, y);
    if (ch === '#') return 'wall';
    if (ch === '+') return 'door';
    if (D.floors[fl].locks[ch]) return S.unlocked[key(x, y, fl)] ? 'door' : 'locked';
    return 'open';
  }
  const kind = (x, y) => kindOf(S.floor, x, y);
  const has = (id) => S.items.includes(id);
  const inWorld = () => S.mode === 'world';
  const area = () => D.areas[S.area];

  function log(msg, tone) {
    S.log.push({ msg, tone: tone || '' });
    if (S.log.length > 40) S.log.shift();
    renderLog();
  }

  // ---------- 이동 ----------
  function rel(fwd, side) {
    const r = (S.dir + 1) % 4;
    return [S.x + DX[S.dir] * fwd + DX[r] * side, S.y + DY[S.dir] * fwd + DY[r] * side];
  }

  function tryMove(dirOffset) {
    if (dialog || S.ended || S.battle) return;
    const d = (S.dir + dirOffset) % 4;
    const nx = S.x + DX[d], ny = S.y + DY[d];
    const k = kind(nx, ny);
    if (k === 'wall') { bump(d, '쿵! 벽에 부딪혔다.'); return; }
    if (k === 'locked') {
      const lock = floor().locks[cell(nx, ny)];
      if (has(lock.item)) {
        S.unlocked[key(nx, ny)] = true;
        log(lock.open, 'good');
      } else { bump(d, lock.locked); return; }
    }
    S.x = nx; S.y = ny; S.steps++;
    sfx('stepStone');
    afterStep();
  }

  function turn(delta) {
    if (dialog || S.ended || S.battle) return;
    S.dir = (S.dir + delta + 4) % 4;
    cam.targetYaw += -delta * Math.PI / 2;
    draw();
  }

  function bump(d, msg) {
    sfx('bump');
    log(msg, 'warn');
    cam.bump = { dx: DX[d], dz: DY[d], t: 0 };
  }

  function afterStep() {
    draw();
    S.calm++;
    const ev = eventHere();
    if (!ev) {
      const enc = floor().encounters;
      if (enc && S.calm > 5 && Math.random() < enc.rate) startBattle(pick(enc.table), null);
      return;
    }
    if (ev.trigger === 'step') openEvent(ev);
    else if (ev.hint) log(ev.hint, 'hint');
  }

  function eventHere() {
    const ev = floor().events[cell(S.x, S.y)];
    if (!ev) return null;
    if (ev.once && S.done[key(S.x, S.y)]) return null;
    return ev;
  }

  function search() {
    if (dialog || S.ended || S.battle) return;
    const ev = eventHere();
    if (ev && ev.trigger === 'search') openEvent(ev);
    else log('주변을 살폈지만 아무것도 없다.');
  }

  // ---------- 사건 ----------
  function check(when) {
    if (!when) return true;
    if (when.has && !has(when.has)) return false;
    if (when.lacks && has(when.lacks)) return false;
    if (when.flag && !S.flags[when.flag]) return false;
    if (when.noflag && S.flags[when.noflag]) return false;
    if (when.gold && S.gold < when.gold) return false;
    if (when.nogold && S.gold >= when.nogold) return false;
    return true;
  }

  function openEvent(ev, at) {
    let start = ev.start || 'start';
    if (Array.isArray(start)) start = (start.find((s) => check(s.when)) || {}).page;
    dialog = { key: at || key(S.x, S.y), ev };
    showPage(start);
  }

  function showPage(pageId) {
    const page = dialog.ev.pages[pageId];
    dialog.pageId = pageId;
    if (page.effects) applyEffects(page.effects);
    if (!dialog) return;
    $('evTitle').textContent = page.title || dialog.ev.name;
    $('evText').textContent = page.text || '';
    const box = $('evChoices');
    box.textContent = '';
    let choices = (page.choices || []).filter((c) => check(c.when));
    if (!choices.length) choices = [{ label: '계속' }];
    choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = '<span class="num">' + (i + 1) + '</span>';
      b.appendChild(document.createTextNode(c.label));
      b.addEventListener('click', () => choose(c));
      box.appendChild(b);
    });
    $('event').hidden = false;
    box.firstChild.focus({ preventScroll: true });
  }

  function choose(c) {
    if (!dialog) return;
    if (c.effects) applyEffects(c.effects);
    if (!dialog) return;
    if (c.shop) { dialog.back = dialog.pageId; showShop(); return; }
    if (c.next) showPage(c.next);
    else closeEvent();
  }

  // ---------- 무기 상점 (대장간) ----------
  // 누구의 무기를 살지 고른 뒤, 지금 무기보다 좋은 것만 보여 준다. 쓰던 무기는 값의 절반에 사 준다
  const wpScore = (w) => (w ? (w.atk || 0) + (w.mag || 0) : -1);
  const wpStat = (w) => '공격 +' + (w.atk || 0) + (w.mag ? ' · 주문 +' + w.mag : '');
  function shopButtons(list) {
    const box = $('evChoices');
    box.textContent = '';
    list.forEach(([label, fn, off], i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.innerHTML = '<span class="num">' + (i + 1) + '</span>';
      b.appendChild(document.createTextNode(label));
      if (off) b.classList.add('off');
      b.addEventListener('click', fn);
      box.appendChild(b);
    });
    $('event').hidden = false;
    box.firstChild.focus({ preventScroll: true });
  }
  function shopBack() { const id = dialog.back; if (id && dialog.ev.pages[id]) showPage(id); else closeEvent(); }
  function showShop(msg) {
    $('evTitle').textContent = '대장간 · 무기';
    $('evText').textContent = (msg ? msg + '\n' : '') + '누구의 무기를 고를까? (금화 ' + S.gold + '닢)';
    shopButtons(S.party.map((m, i) => {
      const w = weaponOf(m);
      return [m.name + ' (' + m.cls + ') · ' + (w ? w.name : '맨손'), () => showShopFor(i)];
    }).concat([['돌아간다', shopBack]]));
  }
  function showShopFor(i, msg) {
    const m = S.party[i], cur = weaponOf(m);
    const back = cur && cur.price ? Math.floor(cur.price / 2) : 0;
    const list = Object.keys(WEAPONS).filter((id) => {
      const w = WEAPONS[id];
      return w.price && w.cls === m.cls && wpScore(w) > wpScore(cur);
    });
    $('evTitle').textContent = '대장간 · ' + m.name + '의 무기';
    $('evText').textContent = (msg ? msg + '\n' : '') + '지금: ' + (cur ? cur.name + ' (' + wpStat(cur) + ')' : '맨손') +
      (back ? ' · 넘기면 ' + back + '닢' : '') + '\n금화 ' + S.gold + '닢' +
      (list.length ? '' : '\n"' + m.name + '에게 이보다 나은 건 내 가게에 없네."');
    shopButtons(list.map((id) => {
      const w = WEAPONS[id], cost = w.price - back;
      return [w.name + ' · ' + wpStat(w) + ' · ' + w.price + '닢', () => buyWeapon(i, id), S.gold < cost];
    }).concat([['다른 사람', () => showShop()], ['돌아간다', shopBack]]));
  }
  function buyWeapon(i, id) {
    const m = S.party[i], w = WEAPONS[id], cur = weaponOf(m);
    const cost = w.price - (cur && cur.price ? Math.floor(cur.price / 2) : 0);
    if (S.gold < cost) { showShopFor(i, '"금화가 ' + (cost - S.gold) + '닢 모자라는군. ' + w.desc + '"'); return; }
    S.gold -= w.price;
    applyEffects([{ equip: { member: i, weapon: id } }]);
    sfx('slash');
    updateStatus();
    showShop('"' + w.desc + '"\n' + m.name + '이(가) ' + w.name + '을(를) 쥐었다! (' + wpStat(w) + ')');
  }

  function closeEvent() {
    dialog = null;
    $('event').hidden = true;
    draw();
  }

  function applyEffects(list) {
    for (const e of list) {
      if (e.give && !has(e.give)) { S.items.push(e.give); log(D.items[e.give].name + '을(를) 얻었다.', 'good'); }
      if (e.take) S.items = S.items.filter((i) => i !== e.take);
      if (e.flag) S.flags[e.flag] = true;
      if (e.unflag) delete S.flags[e.unflag];
      if (e.log) log(e.log);
      if (e.done && dialog) S.done[dialog.key] = true;
      if (e.hp) {
        const m = pick(alive());
        m.hp = Math.max(0, Math.min(m.maxHp, m.hp + e.hp));
        log(e.hp < 0 ? m.name + '의 체력 ' + (-e.hp) + ' 손실.' : m.name + '의 체력 ' + e.hp + ' 회복.', e.hp < 0 ? 'warn' : 'good');
        if (e.hp < 0) flash('hurt');
        if (m.hp <= 0) log(m.name + '이(가) 쓰러졌다.', 'warn');
        if (!alive().length) { closeEvent(); end('dead'); return; }
      }
      if (e.gold) {
        S.gold = Math.max(0, S.gold + e.gold);
        if (e.gold > 0) log('금화 ' + e.gold + '닢을 받았다.', 'good');
      }
      if (e.stat) { // { member: 파티 순번, atk·def·hp·mp: 올릴 값 }
        const m = S.party[e.stat.member || 0], up = [];
        if (e.stat.atk) { m.atk += e.stat.atk; up.push('공격력 +' + e.stat.atk); }
        if (e.stat.def) { m.def += e.stat.def; up.push('방어력 +' + e.stat.def); }
        if (e.stat.hp) { m.maxHp += e.stat.hp; m.hp += e.stat.hp; up.push('최대 체력 +' + e.stat.hp); }
        if (e.stat.mp) { m.maxMp += e.stat.mp; m.mp += e.stat.mp; up.push('최대 마력 +' + e.stat.mp); }
        log(m.name + ': ' + up.join(', '), 'good');
      }
      if (e.equip) { // { member, weapon } 쓰던 무기는 값의 절반에 사 준다
        const m = S.party[e.equip.member || 0], old = weaponOf(m), w = WEAPONS[e.equip.weapon];
        if (old && old.price) { const back = Math.floor(old.price / 2); S.gold += back; log('쓰던 ' + old.name + '을(를) ' + back + '닢에 넘겼다.'); }
        m.weapon = e.equip.weapon;
        log(m.name + '이(가) ' + w.name + '을(를) 쥐었다.', 'good');
      }
      if (e.save) writeSave();
      if (e.heal) {
        for (const m of S.party) { m.hp = m.maxHp; m.mp = m.maxMp; }
        log('파티 전원의 체력과 마력이 회복되었다.', 'good');
      }
      if (e.battle) {
        const from = dialog && dialog.key;
        closeEvent();
        startBattle(e.battle, from);
        return;
      }
      if (e.spin) {
        S.dir = Math.floor(Math.random() * 4);
        let y = yawFor(S.dir);
        while (y < cam.targetYaw) y += Math.PI * 2;
        cam.targetYaw = y + Math.PI * 2; // 한 바퀴 이상 빙글 돈다
      }
      if (e.warp) { closeEvent(); warpTo(e.warp); return; }
      if (e.end) { closeEvent(); end(e.end); return; }
    }
    updateStatus();
  }

  // 지상(area)과 던전(floor) 사이를 오간다
  // 장소를 옮길 때: 소리를 내고 화면 전환 막(transition.js)이 다 가렸을 때 장면을 바꾼다
  function warpTo(w) {
    const fromWorld = inWorld(), toWorld = !!w.area;
    const sound = !toWorld ? (fromWorld ? 'enterDungeon' : 'stairs')
      : !fromWorld ? 'leaveDungeon' : w.area === 'town' ? 'enterTown' : S.area === 'town' ? 'leaveTown' : null;
    if (sound) sfx(sound);
    if (!window.Curtain) { swapPlace(w); flash('fade'); return; }
    Curtain.run({
      style: fromWorld && toWorld ? 'iris' : 'dark',
      title: toWorld ? D.areas[w.area].name : D.floors[w.floor].name,
      sub: toWorld ? '' : D.title || ''
    }, () => swapPlace(w));
  }
  function swapPlace(w) {
    if (w.area) {
      S.mode = 'world'; S.area = w.area; S.wx = w.x; S.wy = w.y; S.wdir = w.dir || 2;
      snapHero();
      if (window.World3D) World3D.reset(); // 3D 파티를 새 자리에 다시 줄 세운다
      log(area().name + '에 왔다.');
    } else {
      S.mode = 'dungeon';
      S.floor = w.floor; S.x = w.x; S.y = w.y; S.dir = w.dir;
      snapCamera();
      log(floor().name + '에 도착했다.');
    }
    S.calm = 0;
    draw();
  }

  function end(kindOfEnd) {
    S.ended = kindOfEnd;
    if (kindOfEnd === 'dead') { showGameOver(); updateStatus(); return; }
    const win = kindOfEnd === 'win';
    $('endTitle').textContent = win ? '사건 해결' : '탐험대 전멸';
    $('endText').textContent = win
      ? S.steps + '걸음 만에 사라진 탐험대를 찾아냈다.'
      : '어둠 속에서 탐험대의 등불이 꺼졌다.';
    $('ending').hidden = false;
    $('endRestart').focus({ preventScroll: true });
    updateStatus();
  }

  function flash(type) {
    const f = $('flash');
    f.className = 'flash';
    void f.offsetWidth;
    f.className = 'flash ' + type;
  }

  // ---------- 절차적 텍스처 ----------
  // 같은 시드로 색상판과 높이(범프)판을 함께 그린다.
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

  function canvasTex(size, paint, color) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    paint(c.getContext('2d'), size, color);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  function speckle(g, size, r, n, light, dark, alpha) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = alpha * r();
      g.fillStyle = r() > 0.5 ? light : dark;
      const s = 1 + r() * 1.5;
      g.fillRect(r() * size, r() * size, s, s);
    }
    g.globalAlpha = 1;
  }

  function paintBricks(g, size, color) {
    const r = rng(7);
    g.fillStyle = color ? '#2a2420' : '#000';
    g.fillRect(0, 0, size, size);
    const rows = 7, bh = size / rows;
    for (let row = 0; row < rows; row++) {
      const cols = 3, bw = size / cols, off = (row % 2) * bw / 2;
      for (let c = -1; c < cols + 1; c++) {
        const x = c * bw + off + 3, y = row * bh + 3, w = bw - 6 - r() * 4, h = bh - 6;
        if (color) {
          const v = 62 + r() * 38, warm = r() * 8;
          g.fillStyle = 'rgb(' + (v + warm) + ',' + (v + warm * 0.4 - 1) + ',' + (v - 3) + ')';
        } else {
          const v = 150 + r() * 60;
          g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        }
        g.fillRect(x, y, w, h);
        // 모서리를 어둡게 해 돌의 굴곡을 만든다
        const grd = g.createLinearGradient(x, y, x, y + h);
        grd.addColorStop(0, color ? 'rgba(255,240,220,0.10)' : 'rgba(255,255,255,0.25)');
        grd.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = grd;
        g.fillRect(x, y, w, h);
      }
    }
    speckle(g, size, r, 2500, color ? '#9d9488' : '#fff', '#000', 0.22);
    // 금
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      let x = r() * size, y = r() * size;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 5; j++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); }
      g.stroke();
    }
    if (color) { // 아래쪽 이끼와 얼룩
      const grd = g.createLinearGradient(0, size * 0.65, 0, size);
      grd.addColorStop(0, 'rgba(40,60,30,0)');
      grd.addColorStop(1, 'rgba(40,60,30,0.35)');
      g.fillStyle = grd; g.fillRect(0, 0, size, size);
    }
  }

  function paintFlags(g, size, color) {
    const r = rng(31);
    g.fillStyle = color ? '#1c1916' : '#000';
    g.fillRect(0, 0, size, size);
    const n = 3, s = size / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = i * s + 4 + r() * 3, y = j * s + 4 + r() * 3, w = s - 8 - r() * 4, h = s - 8 - r() * 4;
      if (color) {
        const v = 58 + r() * 30;
        g.fillStyle = 'rgb(' + (v + 6) + ',' + (v + 2) + ',' + (v - 4) + ')';
      } else {
        const v = 160 + r() * 50;
        g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      }
      g.fillRect(x, y, w, h);
    }
    speckle(g, size, r, 3000, color ? '#7a7268' : '#fff', '#000', 0.25);
    if (color) {
      for (let i = 0; i < 10; i++) {
        g.globalAlpha = 0.15;
        g.fillStyle = r() > 0.5 ? '#2f3a22' : '#0b0a09';
        g.beginPath(); g.arc(r() * size, r() * size, 10 + r() * 40, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  function paintCeil(g, size, color) {
    const r = rng(53);
    g.fillStyle = color ? '#25211d' : '#777';
    g.fillRect(0, 0, size, size);
    speckle(g, size, r, 9000, color ? '#4a423a' : '#fff', '#000', 0.5);
    g.fillStyle = color ? 'rgba(0,0,0,0.55)' : '#000';
    g.fillRect(0, size * 0.46, size, size * 0.08); // 이음 홈
  }

  function paintWood(g, size, color) {
    const r = rng(97);
    const planks = 5, pw = size / planks;
    for (let i = 0; i < planks; i++) {
      if (color) {
        const v = 60 + r() * 25;
        g.fillStyle = 'rgb(' + (v + 30) + ',' + (v + 6) + ',' + (v - 22) + ')';
      } else g.fillStyle = 'rgb(180,180,180)';
      g.fillRect(i * pw, 0, pw, size);
      for (let k = 0; k < 40; k++) { // 나뭇결
        g.strokeStyle = color ? 'rgba(30,15,5,' + (0.15 + r() * 0.25) + ')' : 'rgba(0,0,0,0.3)';
        g.beginPath();
        const x = i * pw + r() * pw;
        g.moveTo(x, 0);
        g.bezierCurveTo(x + (r() - 0.5) * 8, size * 0.3, x + (r() - 0.5) * 8, size * 0.7, x, size);
        g.stroke();
      }
      g.fillStyle = '#000'; g.fillRect(i * pw, 0, 3, size);
    }
    // 쇠 띠와 못
    for (const y of [0.18, 0.78]) {
      g.fillStyle = color ? '#2b2a2c' : '#ddd';
      g.fillRect(0, size * y, size, size * 0.07);
      for (let i = 0; i < planks; i++) {
        g.fillStyle = color ? '#6b6560' : '#fff';
        g.beginPath(); g.arc(i * pw + pw / 2, size * (y + 0.035), 5, 0, Math.PI * 2); g.fill();
      }
    }
  }

  function glowTexture(inner, outer) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, inner); grd.addColorStop(0.35, outer); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function ghostTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.filter = 'blur(6px)';
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(190,220,255,0.9)'); grd.addColorStop(0.6, 'rgba(120,170,255,0.55)'); grd.addColorStop(1, 'rgba(80,120,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(64, 46, 22, 26, 0, 0, Math.PI * 2); g.fill(); // 두건 쓴 머리
    g.beginPath(); g.moveTo(30, 70); g.quadraticCurveTo(64, 50, 98, 70); g.lineTo(112, 250); g.lineTo(16, 250); g.closePath(); g.fill();
    g.filter = 'none';
    g.fillStyle = 'rgba(10,20,40,0.85)';
    g.beginPath(); g.ellipse(64, 50, 12, 14, 0, 0, Math.PI * 2); g.fill(); // 얼굴 그늘
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function runeTexture() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.font = '800 58px "Nanum Myeongjo", serif';
    g.textAlign = 'center';
    g.shadowColor = 'rgba(120,255,220,1)'; g.shadowBlur = 18;
    g.fillStyle = 'rgba(170,255,230,0.95)';
    g.fillText('말하는 자에게', 256, 105);
    g.fillText('문은 열리지 않는다', 256, 180);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }


  // ---------- 전투 ----------
  // S.battle = { mid, foes:[{hp,max}], from, round, cmds:[] }  (저장 가능한 데이터만)
  const battleUI = $('battle');
  let busy = false;      // 한 라운드가 연출되는 동안 입력 잠금
  let foeSprites = [];   // 3D 화면 위 적 스프라이트

  // 3D로 보기의 전투 무대(world3d.js)에 파티 동작·효과를 알린다. 2D 화면이면 아무 일도 없다
  const act3D = (m, kind, arg) => { if (on3D()) World3D.act(S.party.indexOf(m), kind, arg); };
  const fx3D = (kind, arg) => { if (on3D()) World3D.fx(kind, arg); };

  function startBattle(mid, fromKey) {
    const mon = D.monsters[mid];
    const n = roll(mon.count[0], mon.count[1]);
    S.battle = { mid, foes: Array.from({ length: n }, () => ({ hp: mon.hp, max: mon.hp })), from: fromKey, round: 1, cmds: [] };
    S.calm = 0;
    flash('hurt');
    spawnFoes();
    bLog = [];
    blog(mon.name + (n > 1 ? ' ' + n + '마리가' : '이(가)') + ' 나타났다!', 'warn');
    log(mon.name + '와(과) 마주쳤다!', 'warn');
    showBattle();
  }

  let bLog = [];
  function blog(msg, tone) {
    bLog.push({ msg, tone: tone || '' });
    if (bLog.length > 4) bLog.shift();
    const ul = $('bLog'); ul.textContent = '';
    for (const l of bLog) { const li = document.createElement('li'); li.textContent = l.msg; if (l.tone) li.className = l.tone; ul.appendChild(li); }
  }

  function showBattle() {
    const B = S.battle, mon = D.monsters[B.mid];
    battleUI.hidden = false;
    if (window.BGM) BGM.battle(); // 전투음악 (music.js)
    $('bTitle').textContent = mon.name;
    const foes = $('bFoes'); foes.textContent = '';
    B.foes.forEach((f) => {
      const i = document.createElement('i');
      i.className = f.hp > 0 ? '' : 'dead';
      i.innerHTML = '<s style="width:' + (100 * Math.max(0, f.hp) / f.max) + '%"></s>';
      foes.appendChild(i);
    });
    updateStatus();
    if (!busy) prompt();
  }

  // 아직 명령을 고르지 않은 다음 파티원에게 묻는다
  function prompt() {
    const B = S.battle;
    const idx = S.party.findIndex((m, i) => m.hp > 0 && B.cmds[i] === undefined);
    if (idx < 0) { runRound(); return; }
    const m = S.party[idx];
    $('bPrompt').textContent = B.round + '라운드 · ' + m.name + '(' + m.cls + ')의 행동은?';
    const opts = [{ label: '공격', cmd: { act: 'attack' } }, { label: '방어', cmd: { act: 'guard' } }];
    for (const id of m.spells) {
      const sp = D.spells[id];
      opts.push({ label: sp.name + ' (' + sp.mp + 'MP)', cmd: { act: 'spell', id }, off: m.mp < sp.mp });
    }
    if (!D.monsters[B.mid].boss) opts.push({ label: '도망', cmd: { act: 'flee' } });
    if (B.cmds.some((c) => c)) opts.push({ label: '다시 고르기', back: true });
    const box = $('bCmds'); box.textContent = '';
    opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'choice'; b.disabled = !!o.off;
      b.innerHTML = '<span class="num">' + (i + 1) + '</span>';
      b.appendChild(document.createTextNode(o.label));
      b.addEventListener('click', () => {
        if (busy) return;
        if (o.back) { B.cmds = []; prompt(); return; }
        if (o.cmd.act === 'flee') { B.cmds = []; tryFlee(); return; }
        B.cmds[idx] = o.cmd; prompt();
      });
      box.appendChild(b);
    });
    box.firstChild.focus({ preventScroll: true });
  }

  // 주문의 힘은 시전자 레벨만큼 커진다 (Lv1 그대로, 레벨마다 +1)
  // 무기의 주문 위력(mag)만큼 더 세다
  const spellRoll = (m, sp) => roll(sp.power[0], sp.power[1]) + (m.lv - 1) + magOf(m);

  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 120) : ms));
  const liveFoes = () => S.battle.foes.map((f, i) => [f, i]).filter(([f]) => f.hp > 0);

  function lockCmds(text) {
    busy = true;
    $('bPrompt').textContent = text;
    $('bCmds').textContent = '';
  }

  async function tryFlee() {
    lockCmds('도망칠 길을 찾는다…');
    await wait(450);
    if (Math.random() < 0.55) { blog('무사히 도망쳤다!', 'good'); await wait(500); endBattle('fled'); return; }
    blog('도망치지 못했다!', 'warn');
    await enemyPhase([]);
    nextRound();
  }

  async function runRound() {
    const B = S.battle;
    lockCmds(B.round + '라운드');
    const guards = [];
    // 파티와 적이 섞여서 움직인다
    const order = [];
    S.party.forEach((m, i) => { if (m.hp > 0 && B.cmds[i]) order.push({ who: 'p', i, cmd: B.cmds[i], spd: Math.random() + 0.2 }); });
    const acts = D.monsters[B.mid].acts || 1; // 큰 적은 한 라운드에 여러 번 움직인다
    B.foes.forEach((f, i) => { if (f.hp > 0) for (let k = 0; k < acts; k++) order.push({ who: 'e', i, spd: Math.random() }); });
    order.sort((a, b) => b.spd - a.spd);
    S.party.forEach((m, i) => { if (B.cmds[i] && B.cmds[i].act === 'guard') guards.push(i); });
    for (const a of order) {
      if (!S.battle) return;
      if (a.who === 'p') {
        const m = S.party[a.i];
        if (m.hp <= 0 || !liveFoes().length) continue;
        await partyAct(m, a.cmd);
      } else {
        const f = B.foes[a.i];
        if (f.hp <= 0 || !alive().length) continue;
        await foeAct(a.i, guards);
      }
      if (await checkEnd()) return;
    }
    nextRound();
  }

  async function enemyPhase(guards) {
    const acts = D.monsters[S.battle.mid].acts || 1;
    for (const [, i] of liveFoes()) for (let k = 0; k < acts; k++) {
      await foeAct(i, guards);
      if (await checkEnd()) return;
    }
  }

  function nextRound() {
    if (!S.battle) return;
    S.battle.round++;
    S.battle.cmds = [];
    busy = false;
    showBattle();
  }

  async function partyAct(m, cmd) {
    const mon = D.monsters[S.battle.mid];
    if (cmd.act === 'guard') { act3D(m, 'guard'); sfx('guard'); blog(m.name + '은(는) 방어 자세를 취했다.'); await wait(350); return; }
    if (cmd.act === 'attack') {
      const [f, i] = pick(liveFoes());
      lunge(-1);
      act3D(m, 'attack', i);
      if (Math.random() > 0.88) { sfx('miss'); blog(m.name + '의 공격이 빗나갔다.'); await wait(550); return; }
      const crit = Math.random() < 0.1;
      const dmg = Math.max(1, roll(atkOf(m), atkOf(m) + 4) - mon.def) * (crit ? 2 : 1);
      hitFoe(i, dmg);
      fx3D('spark', i);
      sfx(crit ? 'crit' : 'slash');
      blog(m.name + '의 공격! ' + mon.name + '에게 ' + dmg + '의 피해' + (crit ? ' (급소!)' : '') + (f.hp <= 0 ? ', 쓰러뜨렸다.' : '.'), crit ? 'good' : '');
      await wait(650);
      return;
    }
    const sp = D.spells[cmd.id];
    if (m.mp < sp.mp) { blog(m.name + '은(는) 마력이 부족하다.'); await wait(400); return; }
    m.mp -= sp.mp;
    if (sp.target === 'ally') {
      const t = alive().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
      const amt = Math.min(t.maxHp - t.hp, spellRoll(m, sp));
      t.hp += amt;
      act3D(m, 'heal'); fx3D('heal', S.party.indexOf(t));
      flash('heal'); sfx('heal');
      blog(m.name + '의 ' + sp.name + '! ' + t.name + '의 체력이 ' + amt + ' 회복되었다.', 'good');
    } else {
      act3D(m, 'fire'); fx3D('fire');
      flash('fire'); sfx('fire');
      const hits = liveFoes();
      let downs = 0;
      for (const [f, i] of hits) { hitFoe(i, spellRoll(m, sp)); if (f.hp <= 0) downs++; }
      blog(m.name + '의 ' + sp.name + '! 불길이 적을 휩쓴다' + (downs ? ', ' + downs + '마리가 쓰러졌다.' : '.'), 'good');
    }
    updateStatus();
    await wait(700);
  }

  async function foeAct(i, guards) {
    const mon = D.monsters[S.battle.mid];
    // 앞줄의 전사가 더 자주 노려진다
    const pool = [];
    S.party.forEach((m, k) => { if (m.hp > 0) for (let w = 0; w < [3, 2, 1][k] || 0; w++) pool.push(k); });
    const k = pick(pool), m = S.party[k];
    foeLunge(i);
    const br = mon.breath; // 숨결: 파티 전원에게, 방어력 무시 (방어 자세면 절반)
    if (br && Math.random() < br.chance) {
      flash('fire'); sfx('fire'); fx3D('breath');
      cam.bump = { dx: 0, dz: 0, t: 0, shake: true };
      const hurt = [];
      S.party.forEach((p, j) => {
        if (p.hp <= 0) return;
        let d = roll(br.power[0], br.power[1]);
        if (guards.includes(j)) d = Math.max(1, Math.floor(d / 2));
        p.hp = Math.max(0, p.hp - d);
        act3D(p, 'hit');
        hurt.push(p.name + ' ' + d + (p.hp <= 0 ? '(쓰러짐)' : ''));
      });
      blog(mon.name + '의 ' + br.name + '! ' + hurt.join(', '), 'warn');
      updateStatus();
      await wait(800);
      return;
    }
    if (Math.random() > 0.85) { sfx('dodge'); blog(mon.name + '의 공격을 ' + m.name + '이(가) 피했다.'); await wait(550); return; }
    let dmg = Math.max(1, roll(mon.atk - 1, mon.atk + 3) - (mon.magic ? 0 : m.def));
    if (guards.includes(k)) dmg = Math.max(1, Math.floor(dmg / 2));
    m.hp = Math.max(0, m.hp - dmg);
    act3D(m, guards.includes(k) ? 'guard' : 'hit');
    flash('hurt'); sfx(guards.includes(k) ? 'block' : 'hit');
    cam.bump = { dx: 0, dz: 0, t: 0, shake: true };
    blog(mon.name + '의 공격! ' + m.name + '이(가) ' + dmg + '의 피해를 입었다' + (m.hp <= 0 ? '. ' + m.name + '이(가) 쓰러졌다!' : '.'), 'warn');
    updateStatus();
    await wait(650);
  }

  async function checkEnd() {
    if (!alive().length) { await wait(400); battleUI.hidden = true; clearFoes(); S.battle = null; busy = false; if (window.BGM) BGM.battleEnd(); end('dead'); return true; }
    if (!liveFoes().length) { await victory(); return true; }
    showBattleBars();
    return false;
  }

  function showBattleBars() {
    const bars = $('bFoes').children;
    S.battle.foes.forEach((f, i) => {
      if (!bars[i]) return;
      bars[i].className = f.hp > 0 ? '' : 'dead';
      bars[i].firstChild.style.width = (100 * Math.max(0, f.hp) / f.max) + '%';
    });
  }

  async function victory() {
    const B = S.battle, mon = D.monsters[B.mid];
    showBattleBars();
    if (window.BGM) BGM.victory(); // 승리 팡파레
    const exp = mon.exp * B.foes.length, gold = mon.gold * B.foes.length + roll(0, mon.gold);
    S.gold += gold;
    blog('승리! 경험치 ' + exp + ', 금화 ' + gold + '닢을 얻었다.', 'good');
    for (const m of alive()) {
      m.exp += exp;
      while (m.exp >= m.lv * 25) {
        m.exp -= m.lv * 25; m.lv++;
        m.maxHp += m.grow.hp; m.hp += m.grow.hp; m.maxMp += m.grow.mp; m.mp += m.grow.mp;
        m.atk += 1; if (m.lv % 2) m.def += 1;
        blog(m.name + '의 레벨이 ' + m.lv + '(으)로 올랐다!', 'good');
        log(m.name + ' 레벨 업! (Lv ' + m.lv + ')', 'good');
      }
    }
    if (B.from) S.done[B.from] = true;
    log(mon.name + '을(를) 물리쳤다.', 'good');
    updateStatus();
    $('bPrompt').textContent = '';
    const box = $('bCmds'); box.textContent = '';
    const b = document.createElement('button');
    b.className = 'choice'; b.innerHTML = '<span class="num">1</span>'; b.appendChild(document.createTextNode('계속'));
    b.addEventListener('click', () => endBattle('won'));
    box.appendChild(b);
    busy = false;
    b.focus({ preventScroll: true });
  }

  function endBattle() {
    S.battle = null;
    // 전투가 끝나면(이기거나 도망쳐도) 쓰러진 동료가 체력 1로 일어난다
    for (const m of S.party) if (m.hp <= 0) { m.hp = 1; log(m.name + '이(가) 간신히 정신을 차렸다. (HP 1)', 'good'); }
    updateStatus();
    if (window.BGM) BGM.battleEnd();
    busy = false;
    battleUI.hidden = true;
    clearFoes();
    draw();
  }

  // ----- 적 스프라이트 -----
  function monsterTexture(kind) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    const eyes = (pts, color, r) => {
      g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = color;
      for (const [x, y] of pts) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      g.shadowBlur = 0;
    };
    if (kind === 'rat') {
      g.strokeStyle = '#6a554a'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(200, 190); g.bezierCurveTo(250, 170, 240, 120, 215, 110); g.stroke(); // 꼬리
      const body = g.createRadialGradient(130, 160, 10, 130, 175, 90);
      body.addColorStop(0, '#7a6a5e'); body.addColorStop(1, '#2c231e');
      g.fillStyle = body;
      g.beginPath(); g.ellipse(135, 180, 80, 55, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(78, 165, 42, 34, -0.3, 0, Math.PI * 2); g.fill(); // 머리
      g.beginPath(); g.moveTo(40, 170); g.lineTo(62, 150); g.lineTo(60, 180); g.fill(); // 주둥이
      g.fillStyle = '#5a4038';
      g.beginPath(); g.ellipse(86, 128, 14, 18, -0.3, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(108, 134, 13, 17, 0.2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e0d0'; g.fillRect(44, 176, 5, 10); g.fillRect(52, 178, 5, 9); // 이빨
      eyes([[66, 158], [86, 155]], '#ff3a2a', 5);
    } else if (kind === 'skeleton') {
      g.strokeStyle = '#d9cfb8'; g.fillStyle = '#d9cfb8'; g.lineCap = 'round';
      g.lineWidth = 9;
      g.beginPath(); g.moveTo(128, 78); g.lineTo(128, 160); g.stroke(); // 척추
      g.lineWidth = 5;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(128, 100 + i * 14, 30 - i * 3, 6, 0, Math.PI, 0); g.stroke(); }
      g.lineWidth = 7;
      g.beginPath(); g.moveTo(98, 88); g.lineTo(78, 130); g.lineTo(70, 165); g.stroke(); // 왼팔
      g.beginPath(); g.moveTo(158, 88); g.lineTo(184, 120); g.lineTo(196, 100); g.stroke(); // 오른팔
      g.beginPath(); g.moveTo(110, 165); g.lineTo(100, 210); g.lineTo(96, 250); g.stroke();
      g.beginPath(); g.moveTo(146, 165); g.lineTo(156, 210); g.lineTo(160, 250); g.stroke();
      g.beginPath(); g.ellipse(128, 166, 26, 10, 0, 0, Math.PI * 2); g.fill(); // 골반
      g.beginPath(); g.arc(128, 48, 26, 0, Math.PI * 2); g.fill(); // 해골
      g.fillRect(114, 66, 28, 14);
      g.fillStyle = '#1a1512';
      g.beginPath(); g.arc(118, 48, 7, 0, Math.PI * 2); g.arc(138, 48, 7, 0, Math.PI * 2); g.fill();
      eyes([[118, 49], [138, 49]], '#7fd0ff', 2.5);
      g.strokeStyle = '#8a8d94'; g.lineWidth = 6; // 녹슨 검
      g.beginPath(); g.moveTo(196, 100); g.lineTo(226, 10); g.stroke();
      g.strokeStyle = '#5a4030'; g.lineWidth = 6; g.beginPath(); g.moveTo(184, 104); g.lineTo(208, 112); g.stroke();
    } else if (kind === 'wisp') {
      for (let k = 0; k < 3; k++) {
        const grd = g.createRadialGradient(128, 150 - k * 12, 4, 128, 140 - k * 10, 90 - k * 22);
        grd.addColorStop(0, k === 2 ? 'rgba(255,255,255,1)' : 'rgba(150,255,220,0.9)');
        grd.addColorStop(0.5, 'rgba(60,220,180,0.45)'); grd.addColorStop(1, 'rgba(0,80,90,0)');
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(128, 30 + k * 20);
        g.bezierCurveTo(205 - k * 20, 110, 200 - k * 20, 230, 128, 230);
        g.bezierCurveTo(56 + k * 20, 230, 51 + k * 20, 110, 128, 30 + k * 20); g.fill();
      }
      g.fillStyle = 'rgba(0,30,30,0.85)';
      g.beginPath(); g.ellipse(112, 160, 7, 11, 0, 0, Math.PI * 2); g.ellipse(144, 160, 7, 11, 0, 0, Math.PI * 2); g.fill();
    } else if (kind === 'guardian') {
      const steel = g.createLinearGradient(40, 0, 220, 0);
      steel.addColorStop(0, '#1d1d22'); steel.addColorStop(0.5, '#4a4a54'); steel.addColorStop(1, '#16161a');
      g.fillStyle = steel;
      g.beginPath(); g.moveTo(70, 70); g.lineTo(186, 70); g.lineTo(200, 170); g.lineTo(170, 256); g.lineTo(86, 256); g.lineTo(56, 170); g.closePath(); g.fill(); // 몸통
      g.beginPath(); g.ellipse(58, 82, 38, 24, -0.2, 0, Math.PI * 2); g.ellipse(198, 82, 38, 24, 0.2, 0, Math.PI * 2); g.fill(); // 견갑
      g.beginPath(); g.moveTo(98, 70); g.lineTo(98, 22); g.quadraticCurveTo(128, 0, 158, 22); g.lineTo(158, 70); g.closePath(); g.fill(); // 투구
      g.strokeStyle = '#6a6a74'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(128, 4); g.lineTo(128, 70); g.stroke();
      g.fillStyle = '#000'; g.fillRect(104, 38, 48, 8);
      eyes([[116, 42], [140, 42]], '#ff2a18', 4);
      g.strokeStyle = '#9aa0aa'; g.lineWidth = 12; // 대검
      g.beginPath(); g.moveTo(212, 250); g.lineTo(236, 60); g.stroke();
      g.strokeStyle = '#3a2a20'; g.lineWidth = 8; g.beginPath(); g.moveTo(196, 196); g.lineTo(232, 200); g.stroke();
      g.strokeStyle = 'rgba(255,60,30,0.6)'; g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(90 + i * 18, 120); g.lineTo(96 + i * 16, 200); g.stroke(); }
    } else if (kind === 'slime') {
      const body = g.createRadialGradient(110, 140, 10, 128, 170, 100);
      body.addColorStop(0, '#c8f0a0'); body.addColorStop(0.6, '#5cb848'); body.addColorStop(1, '#2a6a24');
      g.fillStyle = body;
      g.beginPath(); g.moveTo(128, 60);
      g.bezierCurveTo(150, 100, 222, 150, 220, 200); g.bezierCurveTo(218, 236, 38, 236, 36, 200);
      g.bezierCurveTo(34, 150, 106, 100, 128, 60); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(96, 140, 14, 22, -0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1a2a14';
      g.beginPath(); g.ellipse(106, 172, 9, 13, 0, 0, Math.PI * 2); g.ellipse(150, 172, 9, 13, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#1a2a14'; g.lineWidth = 5; g.lineCap = 'round';
      g.beginPath(); g.arc(128, 196, 18, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    } else if (kind === 'horn_rabbit') {
      g.fillStyle = '#e8dcc4';
      g.beginPath(); g.ellipse(132, 196, 62, 46, 0, 0, Math.PI * 2); g.fill(); // 몸
      g.beginPath(); g.ellipse(128, 138, 40, 36, 0, 0, Math.PI * 2); g.fill(); // 머리
      g.beginPath(); g.ellipse(104, 84, 11, 36, -0.25, 0, Math.PI * 2); g.ellipse(152, 84, 11, 36, 0.25, 0, Math.PI * 2); g.fill(); // 귀
      g.fillStyle = '#d89a9a'; g.beginPath(); g.ellipse(104, 86, 5, 26, -0.25, 0, Math.PI * 2); g.ellipse(152, 86, 5, 26, 0.25, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c8a050'; g.beginPath(); g.moveTo(120, 112); g.lineTo(128, 62); g.lineTo(136, 112); g.fill(); // 뿔
      g.fillStyle = '#c8b8a0'; g.beginPath(); g.ellipse(96, 236, 22, 12, 0, 0, Math.PI * 2); g.ellipse(166, 236, 22, 12, 0, 0, Math.PI * 2); g.fill();
      eyes([[112, 136], [144, 136]], '#d02828', 5);
    } else if (kind === 'wolf') {
      g.fillStyle = '#5a5f66';
      g.beginPath(); g.moveTo(40, 120); g.lineTo(20, 90); g.lineTo(30, 140); g.fill(); // 꼬리
      g.beginPath(); g.ellipse(130, 160, 82, 44, -0.1, 0, Math.PI * 2); g.fill(); // 몸
      g.fillRect(70, 170, 16, 78); g.fillRect(104, 176, 16, 72); g.fillRect(160, 170, 16, 78); g.fillRect(190, 164, 16, 84); // 다리
      g.fillStyle = '#6c727a';
      g.beginPath(); g.ellipse(196, 118, 40, 32, 0, 0, Math.PI * 2); g.fill(); // 머리
      g.beginPath(); g.moveTo(178, 96); g.lineTo(184, 58); g.lineTo(200, 90); g.moveTo(204, 90); g.lineTo(222, 58); g.lineTo(226, 100); g.fill(); // 귀
      g.beginPath(); g.moveTo(214, 120); g.lineTo(252, 138); g.lineTo(216, 148); g.fill(); // 주둥이
      g.fillStyle = '#e8e0d0'; g.fillRect(228, 140, 4, 8); g.fillRect(238, 138, 4, 8);
      eyes([[192, 112], [214, 112]], '#ffc020', 4);
    } else if (kind === 'cave_bat') {
      g.fillStyle = '#3a2c3c';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(128, 120);
        g.quadraticCurveTo(128 + s * 70, 50, 128 + s * 124, 80);
        g.lineTo(128 + s * 104, 120); g.lineTo(128 + s * 88, 104); g.lineTo(128 + s * 70, 140); g.lineTo(128 + s * 50, 124); g.lineTo(128 + s * 30, 156); g.closePath(); g.fill();
      }
      g.fillStyle = '#4e3c50'; g.beginPath(); g.ellipse(128, 136, 30, 38, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(106, 112); g.lineTo(100, 78); g.lineTo(120, 104); g.moveTo(136, 104); g.lineTo(156, 78); g.lineTo(150, 112); g.fill();
      g.fillStyle = '#f0e8e0'; g.fillRect(118, 150, 4, 9); g.fillRect(134, 150, 4, 9);
      eyes([[116, 126], [140, 126]], '#ff4030', 4);
    } else if (kind === 'rock_golem' || kind === 'golem') {
      const big = kind === 'golem';
      const rock = (x, y, rx, ry, c) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3; g.stroke(); };
      const c1 = big ? '#8a7f6a' : '#9a8c74', c2 = big ? '#6e6454' : '#7c705e';
      rock(92, 226, 30, 26, c2); rock(164, 226, 30, 26, c2); // 다리
      rock(128, 150, big ? 78 : 64, big ? 64 : 54, c1); // 몸통
      rock(48, 150, big ? 32 : 26, big ? 48 : 40, c2); rock(208, 150, big ? 32 : 26, big ? 48 : 40, c2); // 팔
      rock(44, 206, big ? 30 : 22, 24, c1); rock(212, 206, big ? 30 : 22, 24, c1); // 주먹
      rock(128, 76, 34, 28, c1); // 머리
      if (big) { g.fillStyle = '#9ec8ff'; g.shadowColor = '#9ec8ff'; g.shadowBlur = 12; for (const [x, y] of [[100, 140], [150, 170], [130, 120]]) { g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 7, y); g.lineTo(x, y + 12); g.lineTo(x - 7, y); g.fill(); } g.shadowBlur = 0; }
      eyes([[116, 76], [140, 76]], big ? '#9ec8ff' : '#ffb040', 5);
    } else if (kind === 'miner') {
      const ghost = g.createLinearGradient(0, 40, 0, 250);
      ghost.addColorStop(0, 'rgba(190,210,240,0.95)'); ghost.addColorStop(1, 'rgba(120,150,200,0)');
      g.fillStyle = ghost;
      g.beginPath(); g.moveTo(84, 100); g.quadraticCurveTo(128, 70, 172, 100); g.lineTo(186, 200); g.quadraticCurveTo(160, 250, 128, 230); g.quadraticCurveTo(96, 250, 70, 200); g.closePath(); g.fill();
      g.beginPath(); g.arc(128, 74, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#c89a30'; g.beginPath(); g.arc(128, 62, 32, Math.PI, 0); g.fill(); g.fillRect(92, 60, 72, 8); // 안전모
      g.fillStyle = '#fff6c0'; g.shadowColor = '#ffe080'; g.shadowBlur = 16; g.beginPath(); g.arc(128, 46, 7, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
      g.strokeStyle = '#5a4030'; g.lineWidth = 7; g.beginPath(); g.moveTo(178, 190); g.lineTo(214, 70); g.stroke(); // 곡괭이
      g.strokeStyle = '#8a8d94'; g.lineWidth = 8; g.beginPath(); g.moveTo(180, 70); g.quadraticCurveTo(214, 56, 246, 84); g.stroke();
      g.fillStyle = '#1a2030'; g.beginPath(); g.ellipse(116, 80, 6, 9, 0, 0, Math.PI * 2); g.ellipse(140, 80, 6, 9, 0, 0, Math.PI * 2); g.fill();
    } else if (kind === 'grave_crow') {
      g.fillStyle = '#20202a';
      g.beginPath(); g.ellipse(128, 160, 50, 60, 0, 0, Math.PI * 2); g.fill(); // 몸
      g.beginPath(); g.moveTo(90, 140); g.quadraticCurveTo(20, 90, 6, 150); g.quadraticCurveTo(50, 150, 96, 190); g.fill(); // 날개
      g.beginPath(); g.moveTo(166, 140); g.quadraticCurveTo(236, 90, 250, 150); g.quadraticCurveTo(206, 150, 160, 190); g.fill();
      g.beginPath(); g.moveTo(108, 210); g.lineTo(128, 250); g.lineTo(148, 210); g.fill(); // 꽁지
      g.beginPath(); g.arc(128, 98, 30, 0, Math.PI * 2); g.fill(); // 머리
      g.fillStyle = '#8a8070'; g.beginPath(); g.moveTo(118, 108); g.lineTo(128, 146); g.lineTo(138, 108); g.fill(); // 부리
      eyes([[116, 94], [140, 94]], '#c060ff', 4);
    } else if (kind === 'ghoul') {
      g.fillStyle = '#6f8a5a'; g.strokeStyle = '#6f8a5a'; g.lineCap = 'round';
      g.beginPath(); g.ellipse(124, 130, 46, 54, 0.15, 0, Math.PI * 2); g.fill(); // 굽은 몸
      g.lineWidth = 16; g.beginPath(); g.moveTo(96, 120); g.lineTo(56, 170); g.lineTo(48, 214); g.moveTo(152, 120); g.lineTo(196, 160); g.lineTo(214, 206); g.stroke(); // 긴 팔
      g.lineWidth = 18; g.beginPath(); g.moveTo(108, 176); g.lineTo(96, 248); g.moveTo(144, 176); g.lineTo(160, 248); g.stroke();
      g.beginPath(); g.arc(136, 76, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a3a30'; g.fillRect(84, 150, 82, 40); // 누더기
      g.fillStyle = '#1a1210'; g.beginPath(); g.ellipse(136, 98, 16, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e0c0'; for (let i = 0; i < 5; i++) g.fillRect(124 + i * 5, 92, 3, 6);
      eyes([[124, 72], [148, 72]], '#f0f060', 4);
    } else if (kind === 'bone_knight') {
      g.strokeStyle = '#d9cfb8'; g.lineCap = 'round'; g.lineWidth = 9;
      g.beginPath(); g.moveTo(108, 170); g.lineTo(100, 250); g.moveTo(148, 170); g.lineTo(158, 250); g.stroke();
      g.fillStyle = '#4a4e58'; g.beginPath(); g.moveTo(86, 70); g.lineTo(170, 70); g.lineTo(160, 176); g.lineTo(96, 176); g.closePath(); g.fill(); // 흉갑
      g.beginPath(); g.ellipse(84, 78, 26, 16, 0, 0, Math.PI * 2); g.ellipse(172, 78, 26, 16, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#d9cfb8'; g.beginPath(); g.arc(128, 44, 24, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#4a4e58'; g.beginPath(); g.arc(128, 40, 27, Math.PI, 0); g.fill(); g.fillRect(124, 4, 8, 20); // 투구
      g.fillStyle = '#1a1512'; g.beginPath(); g.arc(119, 48, 6, 0, Math.PI * 2); g.arc(137, 48, 6, 0, Math.PI * 2); g.fill();
      eyes([[119, 48], [137, 48]], '#ffd060', 2.5);
      g.fillStyle = '#6a3a2a'; g.beginPath(); g.moveTo(26, 100); g.lineTo(82, 100); g.lineTo(78, 170); g.lineTo(54, 196); g.lineTo(30, 170); g.closePath(); g.fill(); // 방패
      g.strokeStyle = '#c8a050'; g.lineWidth = 4; g.stroke();
      g.strokeStyle = '#9aa0aa'; g.lineWidth = 8; g.beginPath(); g.moveTo(186, 150); g.lineTo(236, 20); g.stroke(); // 검
    } else if (kind === 'gravekeeper') {
      g.fillStyle = '#3e4a3a';
      g.beginPath(); g.moveTo(70, 80); g.lineTo(186, 80); g.lineTo(206, 256); g.lineTo(50, 256); g.closePath(); g.fill(); // 녹슨 갑옷 위 망토
      g.fillStyle = '#5a5248'; g.beginPath(); g.ellipse(64, 92, 34, 20, -0.2, 0, Math.PI * 2); g.ellipse(192, 92, 34, 20, 0.2, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(100, 82); g.lineTo(100, 28); g.quadraticCurveTo(128, 6, 156, 28); g.lineTo(156, 82); g.closePath(); g.fill(); // 투구
      g.fillStyle = '#000'; g.fillRect(106, 46, 44, 7);
      eyes([[118, 50], [138, 50]], '#60ff90', 4);
      g.strokeStyle = '#5a4030'; g.lineWidth = 8; g.beginPath(); g.moveTo(222, 250); g.lineTo(222, 40); g.stroke(); // 삽
      g.fillStyle = '#7a7a70'; g.beginPath(); g.moveTo(206, 40); g.lineTo(238, 40); g.lineTo(234, 4); g.lineTo(210, 4); g.fill();
      g.strokeStyle = '#a89a70'; g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(46 + i * 6, 190 + i * 8, 8, 0, Math.PI * 2); g.stroke(); } // 열쇠 꾸러미
    } else if (kind === 'fallen_monk') {
      g.fillStyle = '#3a3040';
      g.beginPath(); g.moveTo(128, 30); g.quadraticCurveTo(176, 40, 180, 110); g.lineTo(204, 252); g.lineTo(52, 252); g.lineTo(76, 110); g.quadraticCurveTo(80, 40, 128, 30); g.fill(); // 두건 달린 법의
      g.fillStyle = '#0c0a10'; g.beginPath(); g.ellipse(128, 84, 28, 32, 0, 0, Math.PI * 2); g.fill(); // 두건 속 어둠
      eyes([[118, 84], [138, 84]], '#ff5050', 3.5);
      g.strokeStyle = '#8a6a40'; g.lineWidth = 5; g.beginPath(); g.moveTo(96, 150); g.lineTo(160, 150); g.stroke(); // 허리끈
      g.fillStyle = '#c8a050'; g.beginPath(); g.arc(128, 196, 10, 0, Math.PI * 2); g.fill(); // 묵주
      g.fillStyle = '#d8d0b8'; g.beginPath(); g.ellipse(78, 176, 12, 10, 0, 0, Math.PI * 2); g.ellipse(178, 176, 12, 10, 0, 0, Math.PI * 2); g.fill(); // 앙상한 손
      g.fillStyle = 'rgba(180,120,255,0.8)'; g.shadowColor = '#b080ff'; g.shadowBlur = 18; g.beginPath(); g.arc(178, 160, 9, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
    } else if (kind === 'gargoyle') {
      g.fillStyle = '#6a6c70';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128 + s * 30, 100); g.lineTo(128 + s * 120, 30); g.lineTo(128 + s * 110, 90); g.lineTo(128 + s * 124, 120); g.lineTo(128 + s * 90, 130); g.lineTo(128 + s * 40, 150); g.fill(); } // 날개
      g.fillStyle = '#80838a';
      g.beginPath(); g.ellipse(128, 156, 46, 56, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(94, 226, 26, 22, 0, 0, Math.PI * 2); g.ellipse(162, 226, 26, 22, 0, 0, Math.PI * 2); g.fill(); // 웅크린 다리
      g.beginPath(); g.arc(128, 92, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5a5c60'; g.beginPath(); g.moveTo(104, 76); g.lineTo(92, 40); g.lineTo(114, 68); g.moveTo(142, 68); g.lineTo(164, 40); g.lineTo(152, 76); g.fill(); // 뿔
      g.fillStyle = '#1a1a1e'; g.fillRect(110, 106, 36, 8);
      g.fillStyle = '#e8e0d0'; g.fillRect(114, 106, 4, 6); g.fillRect(138, 106, 4, 6);
      eyes([[116, 90], [140, 90]], '#ffa020', 4);
    } else if (kind === 'dragon') {
      const scale = g.createLinearGradient(0, 30, 0, 256);
      scale.addColorStop(0, '#8a8478'); scale.addColorStop(1, '#3e3a34');
      g.fillStyle = '#4a4640';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(128 + s * 40, 120); g.lineTo(128 + s * 124, 20); g.lineTo(128 + s * 120, 70); g.lineTo(128 + s * 128, 130); g.lineTo(128 + s * 104, 120); g.lineTo(128 + s * 100, 170); g.lineTo(128 + s * 50, 170); g.fill(); } // 날개
      g.fillStyle = scale;
      g.beginPath(); g.ellipse(128, 196, 70, 56, 0, 0, Math.PI * 2); g.fill(); // 몸
      g.beginPath(); g.moveTo(108, 160); g.quadraticCurveTo(100, 90, 120, 60); g.lineTo(144, 60); g.quadraticCurveTo(156, 90, 148, 160); g.fill(); // 목
      g.beginPath(); g.ellipse(132, 52, 36, 26, 0, 0, Math.PI * 2); g.fill(); // 머리
      g.beginPath(); g.moveTo(150, 46); g.lineTo(196, 60); g.lineTo(150, 72); g.fill(); // 주둥이
      g.fillStyle = '#d8cfb0'; g.beginPath(); g.moveTo(108, 36); g.lineTo(84, 6); g.lineTo(118, 30); g.moveTo(140, 30); g.lineTo(150, 0); g.lineTo(152, 34); g.fill(); // 뿔
      g.fillStyle = '#e8c890'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(128, 168 + i * 16, 30 - i * 2, 6, 0, 0, Math.PI * 2); g.fill(); } // 배 비늘
      g.fillStyle = '#3e3a34'; g.beginPath(); g.ellipse(76, 240, 26, 14, 0, 0, Math.PI * 2); g.ellipse(180, 240, 26, 14, 0, 0, Math.PI * 2); g.fill(); // 발
      g.fillStyle = 'rgba(255,140,40,0.85)'; g.shadowColor = '#ff8020'; g.shadowBlur = 20; g.beginPath(); g.moveTo(196, 60); g.lineTo(228, 52); g.lineTo(216, 66); g.lineTo(234, 74); g.lineTo(196, 66); g.fill(); g.shadowBlur = 0; // 입김
      eyes([[126, 46], [146, 46]], '#ffb020', 4);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // 적 그림 종류(sprite)마다 3D 화면 속 크기·높이·거리, 기본 빛깔. glow 는 빛나는 적
  const FOE_LOOK = {
    rat: { scale: 1.1, y: 0.53, dist: 2.1, tint: 0xffffff },
    skeleton: { scale: 2.0, y: 1.03, dist: 2.4, tint: 0xffffff },
    wisp: { scale: 1.4, y: 1.2, dist: 2.2, tint: 0xffffff, glow: true },
    guardian: { scale: 2.2, y: 1.1, dist: 2.6, tint: 0xffffff },
    slime: { scale: 1.0, y: 0.48, dist: 2.1, tint: 0xffffff },
    horn_rabbit: { scale: 1.0, y: 0.48, dist: 2.1, tint: 0xffffff },
    wolf: { scale: 1.4, y: 0.68, dist: 2.2, tint: 0xffffff },
    cave_bat: { scale: 1.2, y: 1.35, dist: 2.2, tint: 0xffffff },
    rock_golem: { scale: 1.6, y: 0.8, dist: 2.3, tint: 0xffffff },
    miner: { scale: 1.9, y: 1.0, dist: 2.4, tint: 0xffffff },
    golem: { scale: 2.6, y: 1.3, dist: 2.7, tint: 0xffffff },
    grave_crow: { scale: 1.1, y: 1.3, dist: 2.2, tint: 0xffffff },
    ghoul: { scale: 1.9, y: 0.95, dist: 2.4, tint: 0xffffff },
    bone_knight: { scale: 2.1, y: 1.05, dist: 2.4, tint: 0xffffff },
    gravekeeper: { scale: 2.5, y: 1.25, dist: 2.7, tint: 0xffffff },
    fallen_monk: { scale: 2.0, y: 1.0, dist: 2.4, tint: 0xffffff },
    gargoyle: { scale: 1.8, y: 1.0, dist: 2.4, tint: 0xffffff },
    dragon: { scale: 2.8, y: 1.3, dist: 3.0, tint: 0xffffff }
  };
  const foeLook = (sprite) => FOE_LOOK[sprite] || { scale: 1.6, y: 0.8, dist: 2.3, tint: 0xffffff };
  const texCache = {};
  // monsters/<sprite>.png 가 있으면 그 그림을 쓰고, 없으면 코드로 그린 기본 그림을 쓴다
  const SPRITE_DIR = 'monsters/';
  function foeArt(kind) {
    if (texCache[kind]) return texCache[kind];
    const art = { tex: monsterTexture(kind), aspect: 1, custom: false };
    texCache[kind] = art;
    new THREE.TextureLoader().load(SPRITE_DIR + kind + '.png', (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      art.tex = t; art.aspect = t.image.width / t.image.height; art.custom = true;
      for (const f of foeSprites) if (f.kind === kind) dressFoe(f, art);
    }, undefined, () => { /* 파일이 없으면 기본 그림 유지 */ });
    return art;
  }
  function dressFoe(f, art) {
    const m = f.sp.material;
    m.map = art.tex;
    m.blending = art.custom ? THREE.NormalBlending : (f.look.glow ? THREE.AdditiveBlending : THREE.NormalBlending);
    m.needsUpdate = true;
    f.sp.scale.set(f.look.scale * art.aspect, f.look.scale, 1);
  }
  function preloadFoeArt() { for (const id in D.monsters) foeArt(D.monsters[id].sprite); }

  function spawnFoes() {
    clearFoes();
    if (!S.battle) return;
    if (inWorld()) {
      // 지상 전투는 2D 화면에 그린다 (drawWorldBattle)
      const mon = D.monsters[S.battle.mid], art = foeArt(mon.sprite);
      foeSprites = S.battle.foes.map((f) => ({ art, hit: 0, lunge: 0, dying: f.hp > 0 ? 0 : 1, phase: Math.random() * 6 }));
      return;
    }
    if (!scene) return;
    const mon = D.monsters[S.battle.mid], look = foeLook(mon.sprite);
    const art = foeArt(mon.sprite);
    const n = S.battle.foes.length, fx = DX[S.dir], fz = DY[S.dir], rx = -fz, rz = fx;
    S.battle.foes.forEach((f, i) => {
      const tint = mon.tint != null ? mon.tint : look.tint;
      const mat = new THREE.SpriteMaterial({ map: art.tex, color: tint, transparent: true, depthTest: false, depthWrite: false, fog: false,
        blending: look.glow ? THREE.AdditiveBlending : THREE.NormalBlending });
      const sp = new THREE.Sprite(mat);
      const lat = (i - (n - 1) / 2) * (n > 2 ? 0.7 : 0.9);
      const dist = look.dist + (i % 2) * 0.2;
      sp.position.set(wx(S.x) + fx * dist + rx * lat, look.y, wz(S.y) + fz * dist + rz * lat);
      sp.scale.setScalar(look.scale);
      sp.renderOrder = 10 + i;
      sp.visible = f.hp > 0;
      scene.add(sp);
      const fs = { sp, kind: mon.sprite, base: sp.position.clone(), look, tint, hit: 0, lunge: 0, dying: f.hp > 0 ? 0 : 1, phase: Math.random() * 6 };
      dressFoe(fs, art);
      foeSprites.push(fs);
    });
    if (look.glow || mon.boss) {
      const l = new THREE.PointLight(look.glow ? 0x7a7cff : 0xff3020, 3, 5, 1.5);
      l.position.set(wx(S.x) + fx * 1.2, 1.2, wz(S.y) + fz * 1.2);
      scene.add(l);
      foeSprites.light = l;
    }
  }

  function clearFoes() {
    for (const f of foeSprites) if (f.sp) { scene.remove(f.sp); f.sp.material.dispose(); }
    if (foeSprites.light) scene.remove(foeSprites.light);
    foeSprites = [];
  }

  function hitFoe(i, dmg) {
    const f = S.battle.foes[i];
    f.hp -= dmg;
    const s = foeSprites[i];
    if (s) { s.hit = 1; if (f.hp <= 0) s.dying = 0.001; }
  }
  function foeLunge(i) { const s = foeSprites[i]; if (s) s.lunge = 1; }
  function lunge() { cam.bump = { dx: DX[S.dir], dz: DY[S.dir], t: 0 }; }

  function animateFoes(dt) {
    for (const f of foeSprites) {
      if (!f.sp) { // 지상 전투: 연출 시간만 흘려보낸다
        f.lunge = Math.max(0, f.lunge - dt * 3); f.hit = Math.max(0, f.hit - dt * 3);
        if (f.dying > 0) f.dying = Math.min(1, f.dying + dt * 1.6);
        continue;
      }
      const t = clock + f.phase;
      const p = f.sp.position;
      p.copy(f.base);
      p.y += f.look.glow ? Math.sin(t * 2.2) * 0.08 : Math.abs(Math.sin(t * 1.5)) * 0.03;
      if (f.lunge > 0) { // 플레이어 쪽으로 달려든다
        const k = Math.sin((1 - f.lunge) * Math.PI) * 0.7;
        p.x -= DX[S.dir] * k; p.z -= DY[S.dir] * k;
        f.lunge = Math.max(0, f.lunge - dt * 3);
      }
      if (f.hit > 0) {
        f.sp.material.color.setRGB(1, 0.35 + (1 - f.hit) * 0.5, 0.3 + (1 - f.hit) * 0.5);
        p.x += Math.sin(clock * 80) * 0.04 * f.hit;
        f.hit = Math.max(0, f.hit - dt * 3);
        if (!f.hit) f.sp.material.color.setHex(f.tint);
      }
      if (f.dying > 0) {
        f.dying = Math.min(1, f.dying + dt * 1.6);
        f.sp.material.opacity = 1 - f.dying;
        p.y -= f.dying * 0.4;
        if (f.dying >= 1) f.sp.visible = false;
      }
    }
    if (foeSprites.light) foeSprites.light.intensity = 3 + Math.sin(clock * 6) * 0.5;
  }

  // ---------- 3D 장면 ----------
  let renderer, scene, camera, torch, level, dust, props = [], doors = [], lights3d = [];
  let builtFloor = null;
  const cam = { x: 0, z: 0, yaw: 0, targetYaw: 0, bob: 0, bump: null };
  let M = null; // 재질 모음

  const yawFor = (dir) => -dir * Math.PI / 2;
  const wx = (x) => x * CELL, wz = (y) => y * CELL;

  function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x060508);
    scene.background = fogColor;
    scene.fog = new THREE.FogExp2(fogColor, 0.17);

    camera = new THREE.PerspectiveCamera(70, 16 / 10, 0.05, 40);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    // 손에 든 횃불: 카메라 오른쪽 아래에서 비춘다
    torch = new THREE.PointLight(0xffb27a, 6, 14, 1.6);
    torch.position.set(0.45, -0.25, -0.25);
    torch.castShadow = true;
    torch.shadow.mapSize.set(512, 512);
    torch.shadow.bias = -0.004;
    torch.shadow.radius = 4;
    camera.add(torch);
    scene.add(new THREE.HemisphereLight(0x4a5c88, 0x120c08, 0.3));

    const mk = (paint) => [canvasTex(512, paint, true), canvasTex(512, paint, false)];
    const [wallC, wallB] = mk(paintBricks), [floorC, floorB] = mk(paintFlags), [ceilC, ceilB] = mk(paintCeil), [woodC, woodB] = mk(paintWood);
    M = {
      wall: new THREE.MeshStandardMaterial({ map: wallC, bumpMap: wallB, bumpScale: 3, roughness: 0.92, metalness: 0 }),
      floor: new THREE.MeshStandardMaterial({ map: floorC, bumpMap: floorB, bumpScale: 3, roughness: 0.85, metalness: 0 }),
      ceil: new THREE.MeshStandardMaterial({ map: ceilC, bumpMap: ceilB, bumpScale: 2, roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ map: woodC, bumpMap: woodB, bumpScale: 3, roughness: 0.8 }),
      iron: new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.45, metalness: 0.8 }),
      bone: new THREE.MeshStandardMaterial({ color: 0xcfc3a6, roughness: 0.7 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.75 }),
      water: new THREE.MeshStandardMaterial({ color: 0x050a10, roughness: 0.05, metalness: 0.4 }),
      obsidian: new THREE.MeshStandardMaterial({ color: 0x111014, roughness: 0.25, metalness: 0.3 }),
      glowWarm: glowTexture('rgba(255,236,190,1)', 'rgba(255,170,70,0.35)'),
      glowRed: glowTexture('rgba(255,170,150,1)', 'rgba(220,40,30,0.35)')
    };

    // 문짝은 나무 소품과 재질을 나눠, 문 그림이 다른 나무에 묻지 않게 한다
    M.door = M.wood.clone();
    const ART_GAIN = 2.2;
    for (const mat of [M.wall, M.floor, M.ceil]) mat.userData.gain = 1;
    // textures/<이름>.png 가 있으면 코드로 그린 질감 대신 그 그림을 쓴다 (명암은 그림 밝기로 요철을 낸다)
    for (const [file, mat] of [['wall', M.wall], ['floor', M.floor], ['ceiling', M.ceil], ['door', M.door]]) {
      new THREE.TextureLoader().load('textures/' + file + '.png', (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        const bump = t.clone(); bump.colorSpace = THREE.NoColorSpace; bump.needsUpdate = true;
        mat.map = t; mat.bumpMap = bump; mat.bumpScale = 1.5;
        // 그려 온 그림은 어둡게 칠해져 있어 횃불 아래에서 묻히므로 밝기를 올린다
        mat.userData.gain = ART_GAIN; tintLevel();
        // 문 그림에는 고리가 그려져 있으니 입체 고리는 감춘다
        if (file === 'door') { mat.userData.art = true; for (const d of doors) d.ring.visible = false; }
        mat.needsUpdate = true;
      }, undefined, () => { /* 파일이 없으면 기본 질감 유지 */ });
    }

    // 횃불빛에 떠도는 먼지
    const N = reduceMotion ? 0 : 260, pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = (Math.random() - 0.5) * 8;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dust = new THREE.Points(dg, new THREE.PointsMaterial({
      size: 0.035, map: M.glowWarm, transparent: true, opacity: 0.55, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffc080
    }));
    scene.add(dust);

    new ResizeObserver(resize).observe(view.parentElement);
    resize();
  }

  function resize() {
    const r = view.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const G = {}; // 공용 지오메트리
  function geo(name, make) { return G[name] || (G[name] = make()); }

  function addMesh(group, geometry, material, x, y, z, ry, opts) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.receiveShadow = true;
    m.castShadow = !!(opts && opts.cast);
    group.add(m);
    return m;
  }

  // 방향 d의 가장자리에 안쪽을 보는 벽면을 세운다
  const FACE_RY = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  function wallFace(group, cx, cz, d, y0, h, mat) {
    const g = geo('wall' + h, () => new THREE.PlaneGeometry(CELL, h));
    addMesh(group, g, mat || M.wall, cx + DX[d] * CELL / 2, y0 + h / 2, cz + DY[d] * CELL / 2, FACE_RY[d]);
  }

  // 층마다 벽·바닥·천장 빛깔(floor.tint)과 안개 빛깔(floor.fog)을 바꾼다
  function tintLevel() {
    if (!S || !scene) return;
    const F = D.floors[S.floor] || {};
    for (const mat of [M.wall, M.floor, M.ceil]) mat.color.set(F.tint != null ? F.tint : 0xffffff).multiplyScalar(mat.userData.gain || 1);
    const fog = new THREE.Color(F.fog != null ? F.fog : 0x060508);
    scene.fog.color.copy(fog); scene.background = fog;
  }
  function buildLevel() {
    if (level) {
      scene.remove(level);
      level.traverse((o) => { if (o.material && o.material.map && o.material.userData.own) o.material.map.dispose(); });
    }
    level = new THREE.Group();
    props = []; doors = []; lights3d = [];
    const fl = S.floor, map = D.floors[fl].map;
    const floorGeo = geo('floor', () => new THREE.PlaneGeometry(CELL, CELL));
    for (let y = 0; y < map.length; y++) {
      for (let x = 0; x < map[y].length; x++) {
        if (kindOf(fl, x, y) === 'wall') continue;
        const cx = wx(x), cz = wz(y), ch = cellOf(fl, x, y);
        const ev = D.floors[fl].events[ch];
        const ptype = ev && ev.prop && ev.prop.type;
        if (ptype !== 'stairs-down') {
          const f = addMesh(level, floorGeo, M.floor, cx, 0, cz);
          f.rotation.x = -Math.PI / 2;
        }
        if (ptype !== 'stairs-up') {
          const c = addMesh(level, floorGeo, M.ceil, cx, WALL_H, cz);
          c.rotation.x = Math.PI / 2;
        }
        for (let d = 0; d < 4; d++) {
          if (kindOf(fl, x + DX[d], y + DY[d]) === 'wall') wallFace(level, cx, cz, d, 0, WALL_H);
        }
        const ck = cellOf(fl, x, y);
        if (ck === '+' || D.floors[fl].locks[ck]) buildDoor(x, y, cx, cz);
        if (ev && ev.prop) buildProp(ev, x, y, cx, cz);
      }
    }
    scene.add(level);
    builtFloor = fl;
    tintLevel();
    refreshProps();
  }

  function buildDoor(x, y, cx, cz) {
    const fl = S.floor;
    // 통로가 동서로 나 있으면 문짝은 남북으로 선다
    const alongX = kindOf(fl, x - 1, y) !== 'wall' || kindOf(fl, x + 1, y) !== 'wall';
    const ry = alongX ? Math.PI / 2 : 0;
    const g = new THREE.Group();
    g.position.set(cx, 0, cz); g.rotation.y = ry;
    const post = geo('post', () => new THREE.BoxGeometry(0.22, WALL_H, 0.4));
    const lintel = geo('lintel', () => new THREE.BoxGeometry(CELL, 0.5, 0.4));
    for (const s of [-1, 1]) addMesh(g, post, M.wall, s * (CELL / 2 - 0.11), WALL_H / 2, 0, 0, { cast: true });
    addMesh(g, lintel, M.wall, 0, WALL_H - 0.25, 0, 0, { cast: true });
    const panelH = WALL_H - 0.5;
    const panel = addMesh(g, geo('panel', () => new THREE.BoxGeometry(CELL - 0.44, panelH, 0.12)), M.door, 0, panelH / 2, 0, 0, { cast: true });
    const ring = addMesh(panel, geo('ring', () => new THREE.TorusGeometry(0.08, 0.02, 8, 16)), M.iron, 0.4, -0.1, 0.08);
    ring.castShadow = false;
    ring.visible = !M.door.userData.art;
    level.add(g);
    doors.push({ x, y, panel, ring, closedY: panelH / 2, openY: panelH / 2 + panelH - 0.05 });
  }

  function glowSprite(group, y, tex, scale) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.position.y = y; s.scale.setScalar(scale);
    group.add(s);
    return s;
  }

  function buildProp(ev, x, y, cx, cz) {
    const fl = S.floor, type = ev.prop.type;
    const g = new THREE.Group();
    g.position.set(cx, 0, cz);
    const p = { key: key(x, y), ev, group: g, glow: null, anim: null };
    // 소품을 바라볼 방향: 통로 쪽(벽이 아닌 이웃)으로 돌린다
    let openDir = 0;
    for (let d = 0; d < 4; d++) if (kindOf(fl, x + DX[d], y + DY[d]) !== 'wall') { openDir = d; break; }
    const wallDir = [0, 1, 2, 3].find((d) => kindOf(fl, x + DX[d], y + DY[d]) === 'wall');

    if (type === 'backpack') {
      addMesh(g, new THREE.BoxGeometry(0.5, 0.42, 0.3), M.leather, 0.2, 0.21, -0.3, 0.4, { cast: true });
      addMesh(g, new THREE.BoxGeometry(0.52, 0.06, 0.34), M.leather, 0.2, 0.43, -0.3, 0.4, { cast: true });
      const sheet = addMesh(g, new THREE.PlaneGeometry(0.3, 0.22), M.bone, -0.2, 0.012, -0.1, 0);
      sheet.rotation.x = -Math.PI / 2; sheet.rotation.z = 0.5;
      p.glow = glowSprite(g, 0.5, M.glowWarm, 0.5);
    } else if (type === 'well') {
      const ring = addMesh(g, new THREE.CylinderGeometry(0.62, 0.68, 0.75, 20, 1, true), M.wall, 0, 0.375, 0, 0, { cast: true });
      ring.material = M.wall.clone(); ring.material.side = THREE.DoubleSide;
      addMesh(g, new THREE.TorusGeometry(0.65, 0.08, 8, 24), M.wall, 0, 0.75, 0, 0, { cast: true }).rotation.x = Math.PI / 2;
      const w = addMesh(g, new THREE.CircleGeometry(0.6, 20), M.water, 0, 0.35, 0);
      w.rotation.x = -Math.PI / 2;
      for (const s of [-1, 1]) addMesh(g, new THREE.BoxGeometry(0.1, 1.6, 0.1), M.wood, s * 0.72, 0.8, 0, 0, { cast: true });
      addMesh(g, new THREE.BoxGeometry(1.6, 0.1, 0.1), M.wood, 0, 1.6, 0, 0, { cast: true });
      addMesh(g, new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4), M.leather, 0, 1.05, 0);
      p.glow = glowSprite(g, 0.42, M.glowWarm, 0.35);
    } else if (type === 'ghost') {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ghostTexture(), transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.material.userData.own = true;
      s.scale.set(0.9, 1.8, 1); s.position.y = 1.05;
      g.add(s);
      const l = new THREE.PointLight(0x6f9cff, 2.5, 5, 1.5); l.position.y = 1.2; g.add(l);
      lights3d.push(l);
      p.anim = (t) => { s.position.y = 1.05 + Math.sin(t * 1.6) * 0.06; s.material.opacity = 0.6 + Math.sin(t * 2.3) * 0.12; };
    } else if (type === 'bones') {
      const back = wallDir === undefined ? 0 : wallDir;
      const bx = DX[back] * 0.55, bz = DY[back] * 0.55;
      addMesh(g, new THREE.SphereGeometry(0.13, 16, 12), M.bone, bx, 0.62, bz, 0, { cast: true });
      addMesh(g, new THREE.BoxGeometry(0.42, 0.5, 0.26), M.iron, bx, 0.3, bz, FACE_RY[back], { cast: true });
      for (let i = 0; i < 4; i++) {
        const b = addMesh(g, new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), M.bone, bx * 0.3 + (i - 1.5) * 0.18, 0.04, bz * 0.3 + (i % 2) * 0.2, 0, { cast: true });
        b.rotation.z = Math.PI / 2; b.rotation.y = i * 0.8;
      }
      p.glow = glowSprite(g, 0.4, M.glowWarm, 0.3);
      p.glow.position.x = bx * 0.7; p.glow.position.z = bz * 0.7;
    } else if (type === 'runes') {
      const d = wallDir === undefined ? 0 : wallDir;
      const mat = new THREE.MeshBasicMaterial({ map: runeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9, fog: false });
      mat.userData.own = true;
      const m = addMesh(g, new THREE.PlaneGeometry(1.6, 0.8), mat, DX[d] * (CELL / 2 - 0.01), 1.4, DY[d] * (CELL / 2 - 0.01), FACE_RY[d]);
      m.receiveShadow = false;
      const l = new THREE.PointLight(0x60ffd0, 1.5, 3, 1.5);
      l.position.set(DX[d] * 0.6, 1.4, DY[d] * 0.6); g.add(l); lights3d.push(l);
      p.anim = (t) => { mat.opacity = 0.7 + Math.sin(t * 1.2) * 0.2; };
    } else if (type === 'fountain') {
      const d = wallDir === undefined ? 0 : wallDir;
      const bx = DX[d] * 0.62, bz = DY[d] * 0.62;
      addMesh(g, new THREE.BoxGeometry(1.2, 0.5, 0.7), M.wall, bx, 0.25, bz, FACE_RY[d], { cast: true });
      const w = addMesh(g, new THREE.PlaneGeometry(1.0, 0.5), new THREE.MeshStandardMaterial({ color: 0x1a4a6a, emissive: 0x0a3050, roughness: 0.05, metalness: 0.2 }), bx, 0.48, bz, FACE_RY[d]);
      w.rotation.x = -Math.PI / 2; w.rotation.z = FACE_RY[d];
      addMesh(g, new THREE.SphereGeometry(0.16, 12, 10), M.wall, DX[d] * 0.92, 1.25, DY[d] * 0.92, 0, { cast: true });
      const stream = addMesh(g, new THREE.CylinderGeometry(0.025, 0.04, 0.75, 6), new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.6 }), DX[d] * 0.8, 0.85, DY[d] * 0.8);
      stream.receiveShadow = false;
      const l = new THREE.PointLight(0x5ac8ff, 2.5, 4, 1.5); l.position.set(bx * 0.6, 0.9, bz * 0.6); g.add(l); lights3d.push(l);
      p.anim = (t) => { l.intensity = 2.5 + Math.sin(t * 2) * 0.4; stream.material.opacity = 0.5 + Math.sin(t * 9) * 0.1; };
    } else if (type === 'altar') {
      addMesh(g, new THREE.BoxGeometry(1.1, 0.9, 0.7), M.obsidian, 0, 0.45, 0, 0, { cast: true });
      addMesh(g, new THREE.BoxGeometry(1.3, 0.1, 0.85), M.obsidian, 0, 0.95, 0, 0, { cast: true });
      const orb = glowSprite(g, 1.35, M.glowRed, 0.7);
      const l = new THREE.PointLight(0xff3020, 8, 7, 1.3); l.position.y = 1.4; g.add(l);
      lights3d.push(l);
      p.anim = (t) => { orb.position.y = 1.35 + Math.sin(t * 1.3) * 0.05; l.intensity = 8 + Math.sin(t * 7) * 0.8 + Math.sin(t * 13) * 0.5; };
    } else if (type === 'stairs-down' || type === 'stairs-up') {
      const down = type === 'stairs-down';
      const opp = (openDir + 2) % 4; // 들어오는 쪽의 반대편 벽을 향해 내려간다/올라간다
      const d = kindOf(fl, x + DX[opp], y + DY[opp]) === 'wall' || wallDir === undefined ? opp : wallDir;
      const steps = 6, rise = 0.32, depth = CELL / steps;
      for (let i = 0; i < steps; i++) {
        const along = -CELL / 2 + depth * (i + 0.5);
        const top = (down ? -1 : 1) * rise * (i + 1);
        const h = down ? rise : top;
        const m = addMesh(g, new THREE.BoxGeometry(CELL, h, depth), M.floor, DX[d] * along, down ? top - h / 2 : h / 2, DY[d] * along, FACE_RY[d], { cast: true });
        m.castShadow = !down;
      }
      // 아래(또는 위)로 이어지는 수직 벽
      for (let k = 0; k < 4; k++) wallFace(g, 0, 0, k, down ? -2.4 : WALL_H, 2.4);
      if (ev.prop.barrier) { // 아이템이 없으면 푸른 결계가 계단을 막는다
        const mat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        const back = (d + 2) % 4;
        const wall = addMesh(g, new THREE.PlaneGeometry(CELL * 0.98, WALL_H), mat, DX[back] * (CELL / 2 - 0.05), WALL_H / 2, DY[back] * (CELL / 2 - 0.05), FACE_RY[back]);
        wall.receiveShadow = false;
        const l = new THREE.PointLight(0x4aa8ff, 4, 5, 1.5); l.position.y = 1; g.add(l); lights3d.push(l);
        p.barrier = { item: ev.prop.barrier, objs: [wall, l] };
        p.anim = (t) => { mat.opacity = 0.18 + Math.sin(t * 2.1) * 0.06 + Math.sin(t * 5.3) * 0.03; };
      }
    }
    level.add(g);
    props.push(p);
  }

  function refreshProps() {
    for (const p of props) {
      const done = p.ev.once && S.done[p.key];
      if (p.glow) p.glow.visible = !done;
      if (p.ev.prop.vanish) p.group.visible = !done;
      if (p.barrier) for (const o of p.barrier.objs) o.visible = !has(p.barrier.item);
    }
  }

  function snapCamera() {
    cam.x = wx(S.x); cam.z = wz(S.y);
    cam.yaw = cam.targetYaw = yawFor(S.dir);
  }

  let last = performance.now(), clock = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; clock += dt;
    if (inWorld() || !renderer) {
      if (inWorld()) { animateFoes(dt); drawWorld(dt); }
      requestAnimationFrame(frame);
      return;
    }
    if (builtFloor !== S.floor) { buildLevel(); snapCamera(); }

    // 격자 위치를 향해 부드럽게 이동·회전
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 11);
    const tx = wx(S.x), tz = wz(S.y);
    const dist = Math.hypot(tx - cam.x, tz - cam.z);
    cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k;
    cam.yaw += (cam.targetYaw - cam.yaw) * (reduceMotion ? 1 : 1 - Math.exp(-dt * 13));
    if (dist > 0.02) cam.bob += dt * 14;
    const bobY = reduceMotion ? 0 : Math.sin(cam.bob) * 0.035 * Math.min(1, dist);

    let ox = 0, oz = 0;
    if (cam.bump) {
      cam.bump.t += dt;
      const t = cam.bump.t / 0.22;
      const a = Math.sin(Math.min(1, t) * Math.PI) * 0.22;
      ox = cam.bump.dx * a; oz = cam.bump.dz * a;
      if (cam.bump.shake) { ox = Math.sin(clock * 70) * 0.05 * (1 - Math.min(1, t)); oz = Math.cos(clock * 63) * 0.05 * (1 - Math.min(1, t)); }
      if (t >= 1) cam.bump = null;
    }
    camera.position.set(cam.x + ox, EYE + bobY, cam.z + oz);
    camera.rotation.y = cam.yaw;
    camera.rotation.x = -0.02;

    // 횃불 흔들림
    const fl = Math.sin(clock * 9.1) * 0.5 + Math.sin(clock * 23.7) * 0.3 + Math.sin(clock * 4.3) * 0.2;
    torch.intensity = 6 + fl * 0.7;
    torch.position.y = -0.25 + fl * 0.015;

    // 문: 열린 문은 가까이 가면 위로 올라간다
    for (const d of doors) {
      const [fx, fy] = rel(1, 0), [bx, by] = rel(-1, 0);
      const near = (d.x === S.x && d.y === S.y) || (d.x === fx && d.y === fy) || (d.x === bx && d.y === by);
      const open = kind(d.x, d.y) === 'door' && near;
      const target = open ? d.openY : d.closedY;
      d.panel.position.y += (target - d.panel.position.y) * (1 - Math.exp(-dt * 6));
    }
    for (const p of props) if (p.anim && p.group.visible) p.anim(clock);
    animateFoes(dt);
    for (const p of props) if (p.glow && p.glow.visible) p.glow.material.opacity = 0.7 + Math.sin(clock * 3 + p.group.position.x) * 0.3;

    // 먼지: 카메라 주변 상자 안에서 떠돈다
    if (dust.geometry.attributes.position.count) {
      const a = dust.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i] += Math.sin(clock * 0.7 + i) * dt * 0.05;
        a[i + 1] += dt * 0.03;
        if (a[i + 1] > WALL_H - 0.1) a[i + 1] = 0.1;
        for (const [j, c] of [[0, camera.position.x], [2, camera.position.z]]) {
          if (a[i + j] - c > 4) a[i + j] -= 8; else if (a[i + j] - c < -4) a[i + j] += 8;
        }
        if (a[i + 1] < 0.05) a[i + 1] = Math.random() * WALL_H;
      }
      dust.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // 지금 시야에 들어온 칸을 자동 지도에 기록
  function markVisible() {
    let block = 7;
    for (let d = 1; d <= 7; d++) {
      const [x, y] = rel(d, 0);
      if (kind(x, y) !== 'open') { block = d; break; }
    }
    for (let d = 0; d <= block; d++) {
      for (const side of [-1, 0, 1]) {
        const [x, y] = rel(d, side);
        S.seen[key(x, y)] = true;
      }
    }
  }

  // ---------- 지상 (위에서 내려다보는 필드·마을) ----------
  // 옛 드래곤 퀘스트처럼 16×16 도트 타일을 크게 키워 그린다. world/<이름>.png 그림이 있으면 그 그림을 쓴다
  const worldCv = $('world'), wctx = worldCv.getContext('2d');
  const w3dCv = $('world3d'); // 3D로 보기 (world3d.js)
  const TERRAIN = {
    '.': { tile: 'grass', walk: true },
    ',': { tile: 'flowers', walk: true },
    ':': { tile: 'path', walk: true, enc: 'path' },
    '=': { tile: 'bridge', walk: true, enc: 'path' }, '|': { tile: 'bridge', walk: true, enc: 'path', turn: true },
    'T': { tile: 'forest', walk: true, enc: 'forest' },
    'F': { tile: 'woods' }, '^': { tile: 'mountain', under: 'grass' }, '~': { tile: 'water' },
    't': { tile: 'tree', under: 'grass' }, 'R': { tile: 'roof' }, 'W': { tile: 'wall' }, 'w': { tile: 'pond' },
    // 마을 소품 (under: 'ground' 는 그 지역의 바닥을 먼저 깐다 / over: 그 너머 사람과 말할 수 있다)
    'p': { tile: 'cobble', walk: true }, 'y': { tile: 'crops', walk: true },
    'f': { tile: 'fence', under: 'ground' }, 'h': { tile: 'hedge', under: 'ground' },
    'o': { tile: 'fountain', under: 'cobble' }, 'u': { tile: 'well', under: 'ground' },
    'k': { tile: 'stall', under: 'ground', over: true }, 'l': { tile: 'lamp', under: 'ground' },
    'v': { tile: 'barrel', under: 'ground' }, 'C': { tile: 'chapel_roof' }, 'G': { tile: 'stone_wall' },
    // 집 안
    '_': { tile: 'floor', walk: true }, 'r': { tile: 'rug', walk: true }, 'I': { tile: 'iwall' },
    // block: 그림이 있으면 붙어 있는 같은 칸 묶음 위에 한 장으로 그린다 (fit 비율 유지 / wide 옆으로 늘림 / rise 위로 넘치는 높이, 기본 0.6칸, scale 묶음 안에서 더 작게)
    'q': { tile: 'table', under: 'ground', block: 'fit', scale: 0.62 }, 'B': { tile: 'bed', under: 'ground', block: 'fit' },
    'K': { tile: 'counter', under: 'ground', over: true }, 'J': { tile: 'shelf', under: 'ground' },
    'O': { tile: 'hearth' }, 'e': { tile: 'pew', under: 'ground', block: 'wide' }, 'Q': { tile: 'altar', under: 'ground', over: true, block: 'wide', rise: 0.25 },
    'P': { tile: 'plant', under: 'ground' }
  };
  // 'ground' 는 지역 바닥 타일로 바꿔 읽는다
  const underTile = (ter) => (ter.under === 'ground' ? (TERRAIN[area().ground] || TERRAIN['.']).tile : ter.under);
  // 그 칸의 지형 (사람이 서 있던 칸은 그 바닥으로 본다)
  function terrainAt(x, y) {
    const ch = wcell(x, y), ev = area().events[ch];
    if (ev) return ev.npc ? TERRAIN[ev.ground || area().ground] : null;
    return TERRAIN[ch];
  }
  const wkey = (x, y) => S.area + ':' + x + ',' + y;
  const wcell = (x, y) => { const r = area().map[y]; return (r && r[x]) || null; };
  function worldEventAt(x, y) {
    const m = moverAt(x, y);
    if (m) return m.ev;
    const ev = area().events[wcell(x, y)];
    if (ev && ev.npc) return null; // 그 사람은 다른 칸으로 걸어갔다
    if (!ev || (ev.once && S.done[wkey(x, y)])) return null;
    return ev;
  }

  // ----- 도트 타일 (코드 그림) -----
  const PX = 16;
  function dot(paint) {
    const c = document.createElement('canvas'); c.width = c.height = PX;
    const g = c.getContext('2d');
    const r = (col, x, y, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    paint(r, g);
    return c;
  }
  const speck = (r, seed, cols, n) => { const R = rng(seed); for (let i = 0; i < n; i++) r(cols[i % cols.length], Math.floor(R() * PX), Math.floor(R() * PX)); };
  const grassBase = (r, seed) => { r('#4f9a3c', 0, 0, PX, PX); speck(r, seed, ['#3f8530', '#62ad48'], 26); };
  const treeAt = (r, x, y, dark) => {
    r('#5a3a1e', x + 3, y + 6, 2, 3);
    r(dark ? '#1e5a26' : '#2a7a32', x, y + 1, 8, 5); r(dark ? '#1e5a26' : '#2a7a32', x + 1, y, 6, 7);
    r(dark ? '#2e7034' : '#3f9a44', x + 1, y + 1, 3, 2); r('#164a1c', x + 5, y + 4, 2, 2);
  };
  const waterTile = (shift) => dot((r) => {
    r('#2f63c8', 0, 0, PX, PX);
    for (let y = 2; y < PX; y += 5) for (let x = (y + shift * 3) % 8; x < PX; x += 8) r('#8fb8f0', x, y, 3, 1);
  });
  const fountainTile = (f) => dot((r) => {
    r('#8c867a', 1, 3, 14, 12); r('#b8b2a6', 1, 3, 14, 2); r('#6e695f', 1, 14, 14, 1);
    r('#3f7fd8', 3, 5, 10, 8); r('#8fb8f0', 4 + f * 2, 7, 3, 1); r('#8fb8f0', 8 - f * 2, 10, 3, 1);
    r('#d0cabc', 7, 4, 2, 7); r('#cfe6ff', 6 - f, 1 + f, 4 + f * 2, 2); r('#cfe6ff', 5 + f * 5, 3, 1, 2);
  });
  const TILE_PAINT = {
    grass: () => dot((r) => grassBase(r, 11)),
    flowers: () => dot((r) => { grassBase(r, 12); for (const [x, y, c] of [[3, 3, '#f0d040'], [11, 4, '#e8605a'], [6, 10, '#f4f0e8'], [13, 12, '#f0d040'], [2, 13, '#e8605a']]) { r(c, x, y, 2, 2); } }),
    path: () => dot((r) => { r('#c9a86a', 0, 0, PX, PX); speck(r, 13, ['#b39255', '#d8bc84', '#a88648'], 22); }),
    bridge: () => dot((r) => { r('#2f63c8', 0, 0, PX, PX); r('#8a5a2c', 0, 1, PX, 14); for (let x = 0; x < PX; x += 4) r('#6a4220', x, 1, 1, 14); r('#4a2c14', 0, 1, PX, 1); r('#4a2c14', 0, 14, PX, 1); }),
    forest: () => dot((r) => { grassBase(r, 14); treeAt(r, 0, 0); treeAt(r, 8, 7); treeAt(r, 9, -1); treeAt(r, -1, 8); }),
    woods: () => dot((r) => { r('#1c4a20', 0, 0, PX, PX); treeAt(r, 0, 0, true); treeAt(r, 8, 0, true); treeAt(r, 4, 7, true); treeAt(r, -4, 7, true); treeAt(r, 12, 7, true); }),
    tree: () => dot((r) => { grassBase(r, 15); treeAt(r, 4, 3); }),
    mountain: () => dot((r) => {
      grassBase(r, 16);
      for (let i = 0; i < 8; i++) { r('#8a7a62', 7 - i, 3 + i, 2 + i * 2, 1); r('#6a5a46', 8, 3 + i, 1 + i, 1); }
      r('#f4f4f4', 7, 3, 2, 2); r('#e0e0e8', 6, 5, 4, 1); r('#5a4c3a', 0, 11, PX, 1);
    }),
    water: () => waterTile(0), water2: () => waterTile(1),
    pond: () => waterTile(0), pond2: () => waterTile(1),
    roof: () => dot((r) => { r('#b03a2a', 0, 0, PX, PX); for (let y = 1; y < PX; y += 4) r('#7a2418', 0, y, PX, 1); for (let y = 0; y < PX; y += 4) for (let x = (y / 4) % 2 * 4; x < PX; x += 8) r('#7a2418', x, y, 1, 4); }),
    wall: () => dot((r) => { r('#d8c8a0', 0, 0, PX, PX); r('#8a6a3a', 0, 0, PX, 2); r('#b8a47c', 0, 15, PX, 1); r('#6a8ab8', 3, 5, 3, 4); r('#6a8ab8', 10, 5, 3, 4); r('#5a4020', 3, 5, 3, 1); r('#5a4020', 10, 5, 3, 1); }),
    door: () => dot((r) => { r('#d8c8a0', 0, 0, PX, PX); r('#8a6a3a', 0, 0, PX, 2); r('#6a3e1a', 4, 4, 8, 12); r('#4a2a10', 4, 4, 8, 1); r('#8a5428', 5, 5, 6, 11); r('#f0d040', 9, 10, 1, 1); }),
    town: () => dot((r) => {
      grassBase(r, 17);
      for (const [x, y] of [[1, 2], [8, 1], [4, 8]]) { r('#b03a2a', x, y, 7, 3); r('#7a2418', x, y + 2, 7, 1); r('#e8dcc0', x + 1, y + 3, 5, 3); r('#5a3a1e', x + 3, y + 4, 1, 2); }
    }),
    // --- 마을 소품 ---
    cobble: () => dot((r) => {
      r('#7a756a', 0, 0, PX, PX);
      for (let y = 0; y < PX; y += 4) for (let x = (y / 4) % 2 ? -2 : 0; x < PX; x += 4) { r('#a39d90', x, y, 3, 3); r('#bdb7aa', x, y, 2, 1); }
    }),
    crops: () => dot((r) => {
      r('#6a4a2a', 0, 0, PX, PX);
      for (let y = 3; y < PX; y += 4) { r('#4e341a', 0, y, PX, 1); for (let x = 1; x < PX; x += 3) { r('#5aa448', x, y - 2, 1, 2); r('#7ac050', x + 1, y - 2, 1, 1); } }
    }),
    fence: () => dot((r) => {
      r('rgba(0,0,0,0.22)', 0, 13, PX, 2);
      r('#a0703c', 0, 6, PX, 2); r('#a0703c', 0, 10, PX, 2); r('#c8945a', 0, 6, PX, 1);
      r('#6a4422', 1, 4, 2, 10); r('#6a4422', 13, 4, 2, 10); r('#8a5a2c', 1, 4, 2, 1); r('#8a5a2c', 13, 4, 2, 1);
    }),
    hedge: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 1, 13, 14, 2);
      r('#2a6226', 1, 4, 14, 10); r('#3a8432', 2, 2, 12, 6); r('#3a8432', 1, 6, 14, 4);
      speck(r, 31, ['#55a648', '#24561f', '#4c9a40'], 22);
    }),
    fountain: () => fountainTile(0), fountain2: () => fountainTile(1),
    well: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 2, 13, 13, 2);
      r('#8c867a', 2, 7, 12, 7); r('#a8a294', 2, 7, 12, 2); r('#1a2a3a', 4, 9, 8, 3); r('#2f63c8', 5, 10, 6, 1);
      r('#6a4422', 2, 1, 1, 7); r('#6a4422', 13, 1, 1, 7); r('#8a3a26', 1, 0, 14, 2); r('#6a2a1a', 1, 2, 14, 1);
      r('#a0703c', 7, 4, 2, 3); r('#4a3018', 7, 3, 2, 1);
    }),
    stall: () => dot((r) => {
      r('rgba(0,0,0,0.22)', 1, 14, 15, 2);
      r('#5a3a1e', 1, 6, 1, 8); r('#5a3a1e', 14, 6, 1, 8);
      for (let i = 0; i < 8; i++) r(i % 2 ? '#f4f0e8' : '#c03028', i * 2, 1, 2, 5);
      r('#8a2420', 0, 5, PX, 1);
      r('#8a5a2c', 1, 9, 14, 5); r('#a0703c', 1, 9, 14, 1);
      r('#e8c040', 2, 7, 3, 2); r('#d8564a', 6, 7, 3, 2); r('#7ac050', 10, 7, 3, 2); r('#f4f0e8', 13, 8, 1, 1);
    }),
    lamp: () => dot((r) => {
      r('rgba(246,216,120,0.22)', 3, 0, 10, 8);
      r('rgba(0,0,0,0.25)', 5, 14, 7, 2);
      r('#2a2a30', 7, 5, 2, 9); r('#2a2a30', 6, 13, 4, 2);
      r('#2a2a30', 5, 1, 6, 5); r('#f6d878', 6, 2, 4, 3); r('#fff2c0', 7, 2, 2, 1); r('#2a2a30', 6, 0, 4, 1);
    }),
    barrel: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 3, 13, 11, 2);
      r('#8a5a2c', 4, 3, 8, 11); r('#a0703c', 5, 3, 3, 11); r('#4a3018', 4, 5, 8, 1); r('#4a3018', 4, 11, 8, 1);
      r('#b88450', 5, 2, 6, 2); r('#6a4422', 5, 2, 6, 1);
    }),
    chapel_roof: () => dot((r) => {
      r('#4a5a78', 0, 0, PX, PX);
      for (let y = 1; y < PX; y += 3) { r('#36425a', 0, y + 1, PX, 1); for (let x = (y % 2) * 2; x < PX; x += 4) r('#5c6e90', x, y, 2, 1); }
    }),
    stone_wall: () => dot((r) => {
      r('#a8a49c', 0, 0, PX, PX);
      for (let y = 3; y < PX; y += 4) r('#7e7a72', 0, y, PX, 1);
      for (let y = 0; y < PX; y += 4) for (let x = (y / 4) % 2 ? 2 : 6; x < PX; x += 8) r('#7e7a72', x, y, 1, 3);
      r('#2a3458', 6, 4, 4, 8); r('#2a3458', 7, 3, 2, 1); r('#7aa0e0', 7, 5, 2, 6); r('#e8c040', 7, 7, 2, 1); r('#d8564a', 7, 9, 2, 1);
    }),
    // --- 집 안 ---
    floor: () => dot((r) => {
      r('#a0703c', 0, 0, PX, PX);
      for (let y = 3; y < PX; y += 4) r('#7a5228', 0, y, PX, 1);
      for (let y = 0; y < PX; y += 4) r('#7a5228', (y * 5) % PX, y, 1, 3);
      speck(r, 41, ['#b07c46', '#8e6230'], 10);
    }),
    rug: () => dot((r) => {
      r('#9a2a28', 0, 0, PX, PX); r('#d8b048', 0, 1, PX, 1); r('#d8b048', 0, 14, PX, 1);
      for (let x = 1; x < PX; x += 4) { r('#c84a3a', x, 6, 2, 2); r('#d8b048', x + 1, 7, 1, 1); }
    }),
    iwall: () => dot((r) => {
      r('#cdb88c', 0, 0, PX, PX); r('#b9a478', 0, 9, PX, 5);
      r('#6a4422', 0, 0, PX, 3); r('#8a5a2c', 0, 2, PX, 1); r('#6a4422', 0, 14, PX, 2); r('#7a5228', 0, 3, 1, 11);
    }),
    table: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 1, 13, 15, 2);
      r('#6a4422', 2, 10, 2, 4); r('#6a4422', 12, 10, 2, 4);
      r('#8a5a2c', 1, 4, 14, 7); r('#a0703c', 1, 4, 14, 2); r('#6a4422', 1, 10, 14, 1);
      r('#f4f0e8', 4, 5, 3, 2); r('#c8a040', 10, 5, 2, 2); r('#f6d878', 10, 4, 2, 1);
    }),
    bed: () => dot((r) => {
      r('#6a4422', 2, 1, 12, 14); r('#f4f0e8', 3, 2, 10, 4); r('#d8d0c0', 3, 5, 10, 1);
      r('#3a5ab8', 3, 6, 10, 8); r('#5a7ad8', 3, 6, 10, 1); r('#2a4498', 3, 13, 10, 1);
    }),
    counter: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 0, 13, PX, 2);
      r('#7a5228', 0, 5, PX, 8); r('#a0703c', 0, 3, PX, 3); r('#c8945a', 0, 3, PX, 1);
      for (let x = 3; x < PX; x += 5) r('#5a3a1e', x, 7, 1, 5);
    }),
    shelf: () => dot((r) => {
      r('#6a4422', 1, 0, 14, 15); r('#4a3018', 2, 1, 12, 13);
      const C = ['#c03028', '#3a5ab8', '#e8c040', '#5aa448', '#8a5ab8', '#d8b048'];
      for (const y of [1, 6, 11]) { r('#7a5228', 1, y + 4, 14, 1); for (let x = 2, i = y; x < 14; x += 2, i++) r(C[i % C.length], x, y + 1, 2, 3); }
    }),
    hearth: () => dot((r) => {
      r('#8c867a', 0, 0, PX, PX); for (let y = 3; y < PX; y += 4) r('#6e695f', 0, y, PX, 1);
      r('#6a4422', 1, 3, 14, 2); r('#1a1010', 3, 5, 10, 10);
      r('#e8602a', 5, 9, 6, 6); r('#f6d878', 6, 11, 4, 4); r('#fff2c0', 7, 13, 2, 2); r('#4a3018', 4, 14, 8, 1);
    }),
    pew: () => dot((r) => {
      r('rgba(0,0,0,0.22)', 1, 12, 15, 2);
      r('#6a4422', 1, 3, 14, 3); r('#8a5a2c', 1, 6, 14, 5); r('#a0703c', 1, 6, 14, 1);
      r('#4a3018', 2, 11, 2, 2); r('#4a3018', 12, 11, 2, 2);
    }),
    altar: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 1, 13, 15, 2);
      r('#e8e0cc', 1, 5, 14, 8); r('#c8a040', 1, 5, 14, 1); r('#c8a040', 1, 12, 14, 1);
      r('#c8a040', 7, 6, 2, 5); r('#c8a040', 6, 7, 4, 1);
      r('#f4f0e8', 2, 2, 1, 3); r('#f4f0e8', 13, 2, 1, 3); r('#f6d878', 2, 1, 1, 1); r('#f6d878', 13, 1, 1, 1);
    }),
    plant: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 4, 14, 9, 2);
      r('#a0502c', 5, 10, 6, 5); r('#c06a3a', 5, 10, 6, 1);
      r('#2e7a2e', 3, 3, 10, 8); r('#4a9a3a', 5, 1, 6, 6); r('#6ab84a', 6, 2, 2, 2); r('#2a6226', 2, 6, 3, 3); r('#2a6226', 11, 6, 3, 3);
    }),
    chest: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 2, 13, 13, 2);
      r('#8a5a2c', 3, 7, 10, 7); r('#a0703c', 3, 4, 10, 4); r('#b88450', 4, 4, 8, 1);
      r('#c8a040', 3, 8, 10, 1); r('#c8a040', 5, 4, 1, 10); r('#c8a040', 10, 4, 1, 10); r('#f0d040', 7, 8, 2, 2);
    }),
    chest_open: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 2, 13, 13, 2);
      r('#6a4422', 3, 1, 10, 4); r('#2a1a10', 4, 6, 8, 2);
      r('#8a5a2c', 3, 7, 10, 7); r('#c8a040', 3, 8, 10, 1); r('#c8a040', 5, 7, 1, 7); r('#c8a040', 10, 7, 1, 7);
    }),
    mat: () => dot((r) => { r('#7a2420', 2, 4, 12, 9); r('#9a2a28', 3, 5, 10, 7); r('#d8b048', 2, 4, 12, 1); r('#d8b048', 2, 12, 12, 1); }),
    sign: () => dot((r) => {
      r('rgba(0,0,0,0.25)', 5, 14, 7, 2);
      r('#6a4422', 7, 8, 2, 7); r('#6a4422', 2, 1, 12, 8); r('#b88450', 3, 2, 10, 6);
      r('#4a3018', 4, 3, 8, 1); r('#4a3018', 4, 5, 6, 1);
    }),
    mine: () => dot((r) => {
      r('#7a6a52', 0, 0, PX, PX); speck(r, 23, ['#6a5a44', '#8c7c62'], 22);
      r('#5a4a38', 1, 3, 14, 12); r('#6e5e48', 2, 2, 12, 2);
      r('#120c08', 4, 6, 8, 9); r('#2a1e14', 5, 7, 6, 8);
      r('#8a5a2c', 3, 5, 2, 10); r('#8a5a2c', 11, 5, 2, 10); r('#a0703c', 3, 4, 10, 2); r('#6a4422', 3, 5, 10, 1);
      r('#9a9aa8', 6, 13, 1, 2); r('#9a9aa8', 9, 13, 1, 2); r('#6a4422', 5, 14, 6, 1);
      r('#a8d8ff', 1, 1, 1, 1); r('#a8d8ff', 14, 2, 1, 1);
    }),
    shrine: () => dot((r) => {
      grassBase(r, 29);
      r('rgba(0,0,0,0.25)', 2, 13, 13, 2);
      r('#8c8c94', 3, 11, 10, 3); r('#a4a4ac', 3, 11, 10, 1);
      r('#7a7a84', 5, 4, 6, 7); r('#9a9aa4', 5, 4, 2, 7); r('#5a6a48', 5, 4, 6, 1);
      r('#6c6c74', 4, 2, 8, 2); r('#5a6a48', 4, 2, 3, 1);
      r('#2a3458', 7, 6, 2, 3); r('#a8d8ff', 7, 7, 2, 1); r('#fff2c0', 8, 1, 1, 1);
    }),
    crypt: () => dot((r) => {
      r('#2c3a24', 0, 0, PX, PX); speck(r, 31, ['#24301e', '#36462c'], 20);
      r('rgba(0,0,0,0.3)', 2, 13, 13, 2);
      r('#6a6a70', 3, 5, 10, 9); r('#84848a', 3, 5, 10, 1); r('#55555c', 2, 3, 12, 2); r('#6e6e76', 4, 2, 8, 1);
      r('#0c0a10', 6, 8, 4, 6); r('#1c1824', 7, 9, 2, 5);
      r('#7a7a80', 7, 0, 2, 3); r('#7a7a80', 6, 1, 4, 1);
      r('#4a6a3a', 3, 5, 2, 1); r('#4a6a3a', 11, 6, 2, 2); r('#4a6a3a', 2, 4, 3, 1);
      r('#8a8a90', 0, 10, 2, 4); r('#8a8a90', 14, 11, 2, 3); r('#9ad0ff', 1, 9, 1, 1);
    }),
    abbey: () => dot((r) => {
      r('#6a5a46', 0, 0, PX, PX); speck(r, 18, ['#5a4c3a', '#7a6a52'], 20);
      r('#8c8c94', 2, 6, 12, 9); r('#6c6c74', 2, 14, 12, 1); r('#a4a4ac', 7, 1, 2, 6); r('#a4a4ac', 6, 3, 4, 1);
      r('#2a2830', 6, 10, 4, 5); r('#3a3a44', 3, 8, 2, 2); r('#3a3a44', 11, 8, 2, 2);
    })
  };
  // 사람: dir 0 위(북) 1 오른쪽 2 아래 3 왼쪽, step 0/1 걸음
  const LOOKS = {
    hero: { hair: '#5a3418', skin: '#f0c090', body: '#3a5ab8', cape: '#c03028', leg: '#4a3020' },
    guard: { hair: '#8c8c98', skin: '#e8b888', body: '#7a7a88', cape: '#3a3a48', leg: '#3a3a48', helm: true },
    child: { hair: '#c08030', skin: '#f4c8a0', body: '#e8c040', cape: null, leg: '#3a5a8a', small: true },
    traveler: { hair: '#4a3a2a', skin: '#e0b080', body: '#4a7a3a', cape: '#2e5a26', leg: '#3a2a1a', hat: true },
    elder: { hair: '#e8e8e8', skin: '#e8b888', body: '#6a3a8a', cape: '#4a2a6a', leg: '#4a2a6a' },
    innkeeper: { hair: '#8a4a20', skin: '#f0c090', body: '#f4f0e8', cape: null, leg: '#6a4422' },
    priest: { hair: '#c8a040', skin: '#f0c8a0', body: '#f4f0e8', cape: '#c8a040', leg: '#e8e0cc' },
    granny: { hair: '#b8b8c0', skin: '#e8b888', body: '#8a5a8a', cape: '#5a3a5a', leg: '#5a3a5a', small: true },
    smith: { hair: '#2a2020', skin: '#c8905a', body: '#5a4a3a', cape: null, leg: '#3a2a1a' },
    woman: { hair: '#c86a2a', skin: '#f4c8a0', body: '#d8564a', cape: null, leg: '#f4f0e8' },
    merchant: { hair: '#3a2a1a', skin: '#e0b080', body: '#c8a040', cape: '#8a5a2c', leg: '#4a3020', hat: true },
    farmer: { hair: '#6a4a2a', skin: '#d8a070', body: '#5a8ab8', cape: null, leg: '#6a4a2a', hat: true },
    hermit: { hair: '#d8d8d0', skin: '#e0b080', body: '#6a5a42', cape: '#4a3e2c', leg: '#4a3e2c' }
  };
  function personTile(look, dir, step) {
    return dot((r) => {
      const L = LOOKS[look] || LOOKS.traveler, s = L.small ? 2 : 0;
      r('rgba(0,0,0,0.25)', 3, 14, 10, 2);
      // 다리
      const lo = step ? 1 : 0;
      r(L.leg, 5, 12 - lo, 2, 3 + lo); r(L.leg, 9, 12 - (1 - lo), 2, 3 + (1 - lo));
      // 몸통과 망토
      if (L.cape && dir !== 2) r(L.cape, 4, 7 + s, 8, 6 - s);
      r(L.body, 5, 7 + s, 6, 5 - s);
      if (L.cape && dir === 2) { r(L.cape, 4, 7 + s, 1, 5 - s); r(L.cape, 11, 7 + s, 1, 5 - s); }
      r(L.skin, dir === 3 ? 3 : dir === 1 ? 11 : 4, 8 + s, 1, 3); if (dir === 0 || dir === 2) r(L.skin, 11, 8 + s, 1, 3);
      // 머리
      r(L.skin, 5, 2 + s, 6, 5);
      r(L.helm ? '#9a9aa8' : L.hair, 4, 1 + s, 8, 3);
      if (L.hat) { r('#6a4a2a', 3, 1 + s, 10, 1); r('#6a4a2a', 5, 0 + s, 6, 2); }
      if (dir === 0) r(L.helm ? '#9a9aa8' : L.hair, 4, 2 + s, 8, 5);
      else if (dir === 2) { r(L.helm ? '#9a9aa8' : L.hair, 4, 2 + s, 1, 3); r(L.helm ? '#9a9aa8' : L.hair, 11, 2 + s, 1, 3); r('#1a1010', 6, 4 + s, 1, 1); r('#1a1010', 9, 4 + s, 1, 1); }
      else if (dir === 1) { r(L.helm ? '#9a9aa8' : L.hair, 4, 2 + s, 3, 4); r('#1a1010', 9, 4 + s, 1, 1); }
      else { r(L.helm ? '#9a9aa8' : L.hair, 9, 2 + s, 3, 4); r('#1a1010', 6, 4 + s, 1, 1); }
    });
  }
  const DOTS = {};
  const dotTile = (name) => DOTS[name] || (DOTS[name] = TILE_PAINT[name]());
  const dotPerson = (look, dir, step) => DOTS[look + dir + step] || (DOTS[look + dir + step] = personTile(look, dir, step));

  // ----- 바깥 그림 (world/<이름>.png) -----
  const WORLD_ART = {};
  const DIR_FILE = ['up', 'right', 'down', 'left'];
  function worldArt(name) {
    if (name in WORLD_ART) return WORLD_ART[name];
    WORLD_ART[name] = null;
    const img = new Image();
    img.onload = () => { WORLD_ART[name] = img; };
    img.src = 'world/' + name + '.png';
    return null;
  }
  function tileImg(name, t) {
    const art = worldArt(name);
    if (art) return art;
    if ((name === 'water' || name === 'pond' || name === 'fountain') && Math.floor(t * 1.6) % 2) return dotTile(name + '2');
    return dotTile(name);
  }
  // 그림은 처음 쓰일 때가 아니라 미리 불러 둔다 (방향을 바꾸는 순간 도트 그림이 끼어들지 않게)
  function preloadWorldArt() {
    Object.values(TERRAIN).forEach((t) => { worldArt(t.tile); if (t.under) worldArt(t.under); });
    DIR_FILE.forEach((d) => { worldArt('hero_' + d); worldArt('hero_' + d + '_1'); worldArt('hero_' + d + '_2'); });
    ['door', 'shore_edge', 'shore_corner', 'forest_edge'].forEach(worldArt);
    for (const A of Object.values(D.areas || {})) {
      worldArt('battle_' + Object.keys(D.areas).find((k) => D.areas[k] === A));
      for (const ev of Object.values(A.events)) { if (ev.icon) worldArt(ev.icon); if (ev.iconDone) worldArt(ev.iconDone); if (ev.npc) worldArt('npc_' + ev.npc); }
    }
  }
  function personImg(look, dir, step) {
    // 주인공은 hero_up/right/down/left.png, 마을 사람은 npc_<이름>.png (한 장)
    if (look === 'hero') {
      const art = worldArt('hero_' + DIR_FILE[dir]);
      if (art) return art;
      // 그 방향 그림이 아직 없으면 이미 있는 다른 방향 그림으로 버틴다
      const any = DIR_FILE.map((d) => WORLD_ART['hero_' + d]).find(Boolean);
      return any || dotPerson(look, dir, step);
    }
    return worldArt('npc_' + look) || dotPerson(look, dir, step);
  }
  // 주인공: hero_<방향>.png(서기)와 _1·_2(왼발·오른발)가 있으면 phase 0·2 에 걸음 그림, 1·3·멈춤(-1)에 서기 그림
  function drawHero(dir, phase, x, y, T) {
    const d = DIR_FILE[dir], a = WORLD_ART['hero_' + d + '_1'], b = WORLD_ART['hero_' + d + '_2'], st = worldArt('hero_' + d);
    if (a && b && st) {
      wctx.imageSmoothingEnabled = true;
      wctx.drawImage(phase === 0 ? a : phase === 2 ? b : st, x, y, T, T);
      return;
    }
    if (phase < 0) { const img = personImg('hero', dir, 0); if (img.width > 32) { wctx.imageSmoothingEnabled = true; wctx.drawImage(img, x, y, T, T); return; } }
    drawPerson('hero', dir, phase === 2 ? 1 : 0, x, y, T, phase >= 0);
  }
  // 사람 그리기: 그림 한 장으로 걷는 느낌을 낸다 (위·아래는 걸음마다 좌우 뒤집기, 옆은 살짝 들썩임)
  function drawPerson(look, dir, step, x, y, T, moving) {
    // 걷는 그림 hero_<방향>_1.png · _2.png 가 둘 다 있으면 걷는 동안 번갈아 쓴다
    if (look === 'hero' && moving) {
      const f = WORLD_ART['hero_' + DIR_FILE[dir] + '_' + (step ? 2 : 1)];
      if (f && WORLD_ART['hero_' + DIR_FILE[dir] + '_' + (step ? 1 : 2)]) { wctx.imageSmoothingEnabled = true; wctx.drawImage(f, x, y, T, T); return; }
    }
    const img = personImg(look, dir, step);
    if (img.width <= 32) { blit(img, x, y, T); return; } // 도트 그림은 자체 걸음 그림이 있다
    const flip = step && (dir === 0 || dir === 2);
    const bob = step && (dir === 1 || dir === 3) ? -Math.max(1, Math.round(T / 24)) : 0;
    wctx.imageSmoothingEnabled = true;
    if (flip) {
      wctx.save(); wctx.translate(x + T, y + bob); wctx.scale(-1, 1);
      wctx.drawImage(img, 0, 0, T, T); wctx.restore();
    } else wctx.drawImage(img, x, y + bob, T, T);
  }
  function blit(img, x, y, size) {
    wctx.imageSmoothingEnabled = img.width > 32;
    wctx.drawImage(img, x, y, size, size);
  }

  // ----- 경계: 강가와 숲 가장자리 -----
  // 물 칸 옆이 땅이면 풀 둑과 물가 선을, 숲 칸 옆이 숲이 아니면 나무 윗부분이 들쭉날쭉한 가장자리를 그린다.
  // world/shore_edge.png · shore_corner.png · forest_edge.png 가 있으면 코드 그림 대신 그 그림을 돌려 쓴다.
  const WATERY = '~w=|', WOODY = 'TF';
  const EDGE_CACHE = new Map();
  const sameGroup = (set, x, y) => { const c = wcell(x, y); return c == null || set.includes(c); };
  function edgeBits(set, x, y) {
    let b = 0;
    DX.forEach((dx, s) => { if (!sameGroup(set, x + dx, y + DY[s])) b |= 1 << s; });
    // 안쪽 모서리: 두 옆은 같은 무리인데 대각선만 다를 때 (북동·남동·남서·북서)
    [[1, -1, 0, 1], [1, 1, 1, 2], [-1, 1, 2, 3], [-1, -1, 3, 0]].forEach(([dx, dy, s1, s2], i) => {
      if (!(b & (1 << s1)) && !(b & (1 << s2)) && !sameGroup(set, x + dx, y + dy)) b |= 16 << i;
    });
    return b;
  }
  function edgeCanvas(T) { const c = document.createElement('canvas'); c.width = c.height = T; return c; }
  // 위쪽 가장자리 하나를 그릴 수 있게 회전해 둔다 (s: 0 북, 1 동, 2 남, 3 서)
  function turned(g, T, s, fn) { g.save(); g.translate(T / 2, T / 2); g.rotate(s * Math.PI / 2); g.translate(-T / 2, -T / 2); fn(); g.restore(); }
  function wavyTop(g, T, depth, amp, waves, phase) {
    g.moveTo(0, 0); g.lineTo(T, 0);
    for (let i = 24; i >= 0; i--) { const x = T * i / 24; g.lineTo(x, depth + amp * Math.sin(phase + x / T * Math.PI * waves)); }
    g.closePath();
  }
  function wavyLine(g, T, depth, amp, waves, phase) {
    for (let i = 0; i <= 24; i++) { const x = T * i / 24, y = depth + amp * Math.sin(phase + x / T * Math.PI * waves); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  }
  function shoreOverlay(bits, T, v) {
    const grass = tileImg('grass', 0), artE = worldArt('shore_edge'), artC = worldArt('shore_corner');
    const key = 'shore|' + bits + '|' + T + '|' + v + '|' + grass.width + '|' + !!artE + !!artC;
    if (EDGE_CACHE.has(key)) return EDGE_CACHE.get(key);
    const c = edgeCanvas(T), g = c.getContext('2d');
    g.imageSmoothingEnabled = grass.width > 32;
    const d = T * 0.2, amp = T * 0.05;
    for (let s = 0; s < 4; s++) {
      if (!(bits & (1 << s))) continue;
      turned(g, T, s, () => {
        if (artE) { g.drawImage(artE, 0, 0, T, T); return; }
        const ph = v * 1.7 + s;
        g.save(); g.beginPath(); wavyTop(g, T, d, amp, 2, ph); g.clip(); g.drawImage(grass, 0, 0, T, T); g.restore();
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(122, 92, 52, 0.95)'; g.lineWidth = T / 14; g.beginPath(); wavyLine(g, T, d, amp, 2, ph); g.stroke();
        g.strokeStyle = 'rgba(220, 240, 255, 0.35)'; g.lineWidth = T / 36; g.beginPath(); wavyLine(g, T, d + T / 10, amp * 0.8, 2, ph + 0.6); g.stroke();
      });
    }
    for (let i = 0; i < 4; i++) {
      if (!(bits & (16 << i))) continue;
      turned(g, T, (i + 1) % 4, () => { // 북서 모서리 그림을 돌려서 각 모서리에
        if (artC) { g.drawImage(artC, 0, 0, T, T); return; }
        const r = T * 0.24;
        g.save(); g.beginPath(); g.moveTo(0, 0); g.lineTo(r, 0); g.quadraticCurveTo(r * 0.75, r * 0.75, 0, r); g.closePath(); g.clip();
        g.drawImage(grass, 0, 0, T, T); g.restore();
        g.strokeStyle = 'rgba(122, 92, 52, 0.95)'; g.lineWidth = T / 14; g.lineCap = 'round';
        g.beginPath(); g.moveTo(r, 0); g.quadraticCurveTo(r * 0.75, r * 0.75, 0, r); g.stroke();
      });
    }
    EDGE_CACHE.set(key, c);
    return c;
  }
  // 숲 칸: 숲이 아닌 쪽은 띠 모양으로 깎되 나무 꼭대기(반원)는 남겨, 아래 풀밭과 들쭉날쭉하게 이어진다
  function forestCut(name, bits, T, v) {
    const img = tileImg(name, 0), key = 'forest|' + name + '|' + (bits & 15) + '|' + T + '|' + v + '|' + img.width;
    if (EDGE_CACHE.has(key)) return EDGE_CACHE.get(key);
    const c = edgeCanvas(T), g = c.getContext('2d');
    g.imageSmoothingEnabled = img.width > 32;
    g.drawImage(img, 0, 0, T, T);
    const d = T * 0.24;
    g.globalCompositeOperation = 'destination-out';
    for (let s = 0; s < 4; s++) {
      if (!(bits & (1 << s))) continue;
      turned(g, T, s, () => {
        g.beginPath(); g.moveTo(0, 0); g.lineTo(T, 0); g.lineTo(T, d);
        for (let k = 2; k >= 0; k--) {
          const rr = T * (0.14 + 0.025 * ((v + k + s) % 3)), cx = T * (k + 0.5) / 3 + T * 0.03 * (((v + k) % 3) - 1);
          g.lineTo(cx + rr, d); g.arc(cx, d, rr, 0, Math.PI, true);
        }
        g.lineTo(0, d); g.closePath(); g.fill();
      });
    }
    EDGE_CACHE.set(key, c);
    return c;
  }
  // 숲 그림 가장자리 (forest_edge.png): 빽빽한 숲(F) 옆 땅 칸 위에, 숲 쪽에서 삐져나온 나무를 덧그린다.
  // 듬성듬성한 숲(T)은 그림과 어울리지 않아 계속 나무 꼭대기 모양으로 깎아 잇는다.
  function forestOverhang(x, y, px, py, T) {
    const art = worldArt('forest_edge');
    if (!art) return;
    for (let s = 0; s < 4; s++) {
      const c = wcell(x + DX[s], y + DY[s]);
      if (c === 'F') { wctx.save(); wctx.translate(px, py); turned(wctx, T, s, () => wctx.drawImage(art, 0, 0, T, T)); wctx.restore(); }
    }
  }
  // 흙길 가장자리: 풀밭과 닿은 쪽에 풀이 들쭉날쭉하게 덮이고 안쪽에 흙 그늘을 넣는다.
  // 들쭉날쭉한 선은 지도 좌표로 정해서 옆 길 칸과 이어진다.
  const PATHY = ':=|', PM = 32;
  const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (t, k) => { const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f); return hash2(i, k) * (1 - s) + hash2(i + 1, k) * s; };
  function grassy(x, y) {
    const c = wcell(x, y); if (c == null || PATHY.includes(c)) return false;
    const ev = area().events[c], ter = ev ? TERRAIN[ev.ground || area().ground] : TERRAIN[c];
    if (!ter) return false;
    return ['grass', 'flowers', 'forest', 'woods'].includes(ter.under ? underTile(ter) : ter.tile);
  }
  function pathOverlay(x, y, T) {
    const side = DX.map((dx, s) => grassy(x + dx, y + DY[s]));
    const diag = [[1, -1], [1, 1], [-1, 1], [-1, -1]].map(([dx, dy]) => grassy(x + dx, y + dy));
    if (!side.some(Boolean) && !diag.some(Boolean)) return null;
    const grass = tileImg('grass', 0), key = 'path|' + S.area + '|' + x + ',' + y + '|' + T + '|' + grass.width;
    if (EDGE_CACHE.has(key)) return EDGE_CACHE.get(key);
    // 가장자리에서 풀이 들어오는 깊이 (PM 칸 도트 단위, u: 가장자리를 따라가는 지도 좌표)
    const depth = (s, u) => 1.5 + 2.6 * vnoise(u / 6, s % 2 ? 11 : 7) + vnoise(u / 2.5, s % 2 ? 5 : 3);
    const m = new ImageData(PM, PM), rim = new ImageData(PM, PM);
    for (let j = 0; j < PM; j++) for (let i = 0; i < PM; i++) {
      const wx = x * PM + i, wy = y * PM + j;
      const d = [j, PM - 1 - i, PM - 1 - j, i], u = [wx, wy, wx, wy]; // 북·동·남·서
      let g = -99;
      for (let s = 0; s < 4; s++) if (side[s]) g = Math.max(g, depth(s, u[s]) - d[s]);
      // 두 옆이 풀이면 바깥 모서리를 둥글게, 대각선만 풀이면 모서리에 작은 풀 덩이
      [[0, 1], [2, 1], [2, 3], [0, 3]].forEach(([a, b], k) => {
        const R = 9;
        if (side[a] && side[b] && d[a] < R && d[b] < R) g = Math.max(g, Math.hypot(R - d[a], R - d[b]) - R + 0.5);
        if (!side[a] && !side[b] && diag[k]) g = Math.max(g, 4 + 2.5 * vnoise((wx + wy) / 5, 13) - Math.hypot(d[a], d[b]));
      });
      g += (hash2(wx, wy) - 0.5) * 1.1;
      const p = (j * PM + i) * 4;
      if (g > 0) m.data[p + 3] = 255;
      else if (g > -1.6) { rim.data[p] = 70; rim.data[p + 1] = 46; rim.data[p + 2] = 22; rim.data[p + 3] = 90; }
    }
    const c = edgeCanvas(T), g = c.getContext('2d'), mc = edgeCanvas(PM), mg = mc.getContext('2d');
    g.imageSmoothingEnabled = false;
    mg.putImageData(rim, 0, 0); g.drawImage(mc, 0, 0, T, T);
    const gc = edgeCanvas(T), gg = gc.getContext('2d');
    gg.imageSmoothingEnabled = grass.width > 32; gg.drawImage(grass, 0, 0, T, T);
    mg.putImageData(m, 0, 0);
    gg.globalCompositeOperation = 'destination-in'; gg.imageSmoothingEnabled = false; gg.drawImage(mc, 0, 0, T, T);
    g.drawImage(gc, 0, 0);
    EDGE_CACHE.set(key, c);
    return c;
  }

  // ----- 마을 사람: wander 칸 안에서 천천히 돌아다니고, 말을 걸면 주인공 쪽을 본다 -----
  let movers = null, moversArea = null;
  function ensureMovers() {
    if (movers && moversArea === S.area) return movers;
    moversArea = S.area; movers = [];
    const A = area();
    A.map.forEach((row, y) => [...row].forEach((ch, x) => {
      const ev = A.events[ch];
      if (ev && ev.npc) movers.push({ ev, hx: x, hy: y, x, y, fx: x, fy: y, dir: ev.face == null ? 2 : ev.face, wait: 1 + Math.random() * 3 });
    }));
    return movers;
  }
  const moverAt = (x, y) => (inWorld() ? ensureMovers().find((m) => m.x === x && m.y === y) : null);
  function updateMovers(dt) {
    for (const m of ensureMovers()) {
      const d = Math.hypot(m.x - m.fx, m.y - m.fy);
      if (d > 0) { const k = Math.min(1, (3 * dt) / d); m.fx += (m.x - m.fx) * k; m.fy += (m.y - m.fy) * k; continue; }
      if (!m.ev.wander || dialog || S.battle) continue;
      m.wait -= dt;
      if (m.wait > 0) continue;
      m.wait = 1.6 + Math.random() * 2.8;
      const s = Math.floor(Math.random() * 4), nx = m.x + DX[s], ny = m.y + DY[s];
      m.dir = s;
      if (Math.abs(nx - m.hx) > m.ev.wander || Math.abs(ny - m.hy) > m.ev.wander) continue;
      if ((nx === S.wx && ny === S.wy) || moverAt(nx, ny)) continue;
      const ch = wcell(nx, ny), ev = area().events[ch];
      const ter = ev ? (ev.npc ? TERRAIN[ev.ground || area().ground] : null) : TERRAIN[ch];
      if (!ter || !ter.walk || ter.enc === 'forest' || ter.tile === 'bridge') continue; // 숲·다리로는 가지 않는다
      m.x = nx; m.y = ny;
    }
  }
  function faceHero(ev) {
    const m = ensureMovers().find((mm) => mm.ev === ev);
    if (m) m.dir = (S.wdir + 2) % 4;
  }
  // 앞 칸이 계산대·제단처럼 너머로 말할 수 있는 곳이면 그 너머 사람을 찾는다
  function talkTarget(x, y, d) {
    let ev = worldEventAt(x, y);
    if (!ev) { const t = TERRAIN[wcell(x, y)]; if (t && t.over) { x += DX[d]; y += DY[d]; ev = worldEventAt(x, y); } }
    return ev && ev.solid ? { ev, x, y } : null;
  }

  // ----- 주인공 이동 -----
  // walk: 지금까지 걸은 거리(칸). 걸음 그림 순서를 거리에 맞춘다
  const hero = { x: 0, y: 0, walk: 0 };
  // 누르고 있는 걷기 방향 (-1 이면 없음): 칸에 닿자마자 멈추지 않고 다음 칸으로 이어 걷는다
  let heldWalk = -1;
  function snapHero() { if (S) { hero.x = S.wx; hero.y = S.wy; } }
  const heroBusy = () => Math.abs(hero.x - S.wx) + Math.abs(hero.y - S.wy) > 0.2;

  function walk(d) {
    if (dialog || S.ended || S.battle || heroBusy()) return;
    S.wdir = d;
    const nx = S.wx + DX[d], ny = S.wy + DY[d];
    const ch = wcell(nx, ny);
    const ev = worldEventAt(nx, ny);
    if (ev && ev.solid) { faceHero(ev); openEvent(ev, wkey(nx, ny)); return; }
    const over = !ev && talkTarget(nx, ny, d);
    if (over) { faceHero(over.ev); openEvent(over.ev, wkey(over.x, over.y)); return; }
    const ter = ev ? null : terrainAt(nx, ny);
    if (!ch || (!ev && !(ter && ter.walk))) { draw(); return; }
    S.wx = nx; S.wy = ny; S.steps++;
    sfx('step');
    S.calm++;
    draw();
    if (ev && ev.go) { warpTo(ev.go); return; }
    if (ev && ev.trigger === 'step') { openEvent(ev, wkey(nx, ny)); return; }
    const enc = area().encounters;
    if (enc && S.calm > 4) {
      const mult = ter && ter.enc ? (enc[ter.enc] || 1) : 1;
      if (Math.random() < enc.rate * mult) startBattle(pick(enc.table), null);
    }
  }

  // [조사]: 마주 보는 사람·문에게 말을 걸거나, 서 있는 칸을 살핀다
  function talk() {
    if (dialog || S.ended || S.battle) return;
    const front = talkTarget(S.wx + DX[S.wdir], S.wy + DY[S.wdir], S.wdir);
    if (front) { faceHero(front.ev); openEvent(front.ev, wkey(front.x, front.y)); return; }
    const here = worldEventAt(S.wx, S.wy);
    if (here && here.trigger === 'search') { openEvent(here, wkey(S.wx, S.wy)); return; }
    log('주변을 살폈지만 아무것도 없다.');
  }

  // ----- 그리기 -----
  // 한 화면에 보이는 칸 수: 좁은 폰에서는 칸을 줄여 그림을 크게
  const viewCols = () => { const w = worldCv.clientWidth || 600; return w < 420 ? 10 : w < 640 ? 12 : 15; };
  function fitWorld() {
    const r = worldCv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (worldCv.width !== w || worldCv.height !== h) { worldCv.width = w; worldCv.height = h; }
  }

  // 같은 글자가 붙어 있는 가구 칸을 직사각형 묶음으로 (지역마다 한 번 계산)
  const BLOCKS = {};
  function areaBlocks() {
    if (BLOCKS[S.area]) return BLOCKS[S.area];
    const map = area().map, seen = {}, out = [];
    map.forEach((row, y) => [...row].forEach((ch, x) => {
      if (!TERRAIN[ch] || !TERRAIN[ch].block || seen[x + ',' + y]) return;
      let w = 1, h = 1;
      while (map[y][x + w] === ch) w++;
      while (map[y + h] && [...Array(w)].every((_, i) => map[y + h][x + i] === ch)) h++;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) seen[(x + i) + ',' + (y + j)] = true;
      out.push({ x, y, w, h, ch });
    }));
    return (BLOCKS[S.area] = out);
  }
  // 깔개: 옆 칸이 깔개가 아닌 쪽에만 테두리를 그린다 (rug.png 를 아홉 조각으로 나눠 쓴다)
  function drawRug(x, y, px, py, T) {
    const img = worldArt('rug'), n = img.width, b = Math.round(n * 0.11), k = Math.round(T * 0.22);
    const on = (dx, dy) => { const c = wcell(x + dx, y + dy), ev = c && area().events[c]; return c === 'r' || !!(ev && ev.ground === 'r'); };
    const L = !on(-1, 0), R = !on(1, 0), U = !on(0, -1), D = !on(0, 1);
    wctx.imageSmoothingEnabled = true;
    wctx.drawImage(img, b, b, n - 2 * b, n - 2 * b, px, py, T, T);
    const piece = (sx, sy, sw, sh, dx, dy, dw, dh) => wctx.drawImage(img, sx, sy, sw, sh, px + dx, py + dy, dw, dh);
    if (U) piece(b, 0, n - 2 * b, b, 0, 0, T, k);
    if (D) piece(b, n - b, n - 2 * b, b, 0, T - k, T, k);
    if (L) piece(0, b, b, n - 2 * b, 0, 0, k, T);
    if (R) piece(n - b, b, b, n - 2 * b, T - k, 0, k, T);
    if (U && L) piece(0, 0, b, b, 0, 0, k, k);
    if (U && R) piece(n - b, 0, b, b, T - k, 0, k, k);
    if (D && L) piece(0, n - b, b, b, 0, T - k, k, k);
    if (D && R) piece(n - b, n - b, b, b, T - k, T - k, k, k);
  }
  // 울타리: 위아래로 이어진 칸은 말뚝 하나만 세운다
  const fenceUpright = (x, y) => wcell(x - 1, y) !== 'f' && wcell(x + 1, y) !== 'f' && (wcell(x, y - 1) === 'f' || wcell(x, y + 1) === 'f');
  function drawPicket(px, py, T) {
    const img = worldArt('fence'), n = img.width, pw = n / 4; // fence.png 에는 말뚝이 네 개
    wctx.imageSmoothingEnabled = true;
    wctx.drawImage(img, pw * 1.5 - pw / 2, 0, pw, n, px + (T - T / 4) / 2, py, T / 4, T);
  }
  function drawWorld(dt) {
    fitWorld();
    const W = worldCv.width, H = worldCv.height, A = area(), map = A.map;
    const rows = map.length, cols = map[0].length;
    // 일정한 속도로 다음 칸까지 걷는다. 방향을 누르고 있으면 남은 거리만큼 다음 칸으로 바로 이어 간다
    let sp = (reduceMotion ? 50 : 5) * dt;
    if (dialog || S.battle) heldWalk = -1; // 말을 걸거나 싸우면 손을 떼야 다시 걷는다 (같은 사람에게 계속 말 걸지 않게)
    for (let n = 0; n < 3 && sp > 0; n++) {
      const dx = S.wx - hero.x, dy = S.wy - hero.y, d = Math.hypot(dx, dy);
      if (d > 3) { snapHero(); break; }
      if (d > 0 && sp >= d) { hero.x = S.wx; hero.y = S.wy; hero.walk += d; sp -= d; }
      else if (d > 0) { hero.x += dx * sp / d; hero.y += dy * sp / d; hero.walk += sp; sp = 0; }
      const at = heldWalk + ':' + S.area + ':' + S.wx + ',' + S.wy;
      if (hero.x !== S.wx || hero.y !== S.wy || heldWalk < 0 || hero.blocked === at || dialog || S.battle || (window.Curtain && Curtain.busy)) break;
      const A0 = S.area;
      walk(heldWalk);
      if (S.area !== A0) break;
      if (hero.x === S.wx && hero.y === S.wy) { hero.blocked = at; break; } // 벽 앞: 매 장면마다 다시 부딪히지 않는다
    }
    const dist = hero.x !== S.wx || hero.y !== S.wy ? 1 : 0;
    if (on3D()) { drawWorld3D(dt); return; }
    if (!w3dCv.hidden) { w3dCv.hidden = true; worldCv.hidden = false; }
    const T = Math.ceil(W / viewCols());
    const viewW = W / T, viewH = H / T;
    const clampC = (c, n, v) => (n <= v ? n / 2 : Math.max(v / 2, Math.min(n - v / 2, c)));
    const camX = clampC(hero.x + 0.5, cols, viewW), camY = clampC(hero.y + 0.5, rows, viewH);
    let ox = W / 2 - camX * T, oy = H / 2 - camY * T;
    if (cam.bump) {
      cam.bump.t += dt;
      const t = cam.bump.t / 0.22;
      if (cam.bump.shake) { ox += Math.sin(clock * 70) * T * 0.12 * (1 - Math.min(1, t)); oy += Math.cos(clock * 63) * T * 0.12 * (1 - Math.min(1, t)); }
      if (t >= 1) cam.bump = null;
    }
    ox = Math.round(ox); oy = Math.round(oy);
    wctx.fillStyle = A.indoor ? '#000' : '#0b1a0e'; wctx.fillRect(0, 0, W, H);
    updateMovers(dt);
    const x0 = Math.max(0, Math.floor(-ox / T)), x1 = Math.min(cols - 1, Math.ceil((W - ox) / T));
    const y0 = Math.max(0, Math.floor(-oy / T)), y1 = Math.min(rows - 1, Math.ceil((H - oy) / T));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ch = map[y][x], px = ox + x * T, py = oy + y * T;
        const ev = A.events[ch];
        if (!ev) {
          const ter = TERRAIN[ch];
          if (!ter) continue;
          const v = (x * 7 + y * 13) % 3;
          if (ch === 'T' || (ch === 'F' && !worldArt('forest_edge'))) {
            const bits = edgeBits(WOODY, x, y);
            if (bits & 15) { blit(tileImg('grass', clock), px, py, T); wctx.drawImage(forestCut(ter.tile, bits, T, v), px, py); continue; }
          }
          if (ter.under) blit(tileImg(underTile(ter), clock), px, py, T);
          if (ter.block && worldArt(ter.tile)) continue; // 아래 blocks 단계에서 한 장으로 그린다
          if (ch === 'r' && worldArt('rug')) { drawRug(x, y, px, py, T); continue; }
          if (ch === 'f' && worldArt('fence') && fenceUpright(x, y)) { drawPicket(px, py, T); continue; }
          if (ter.tile === 'bridge') { // 다리 밑에 강물과 강가를 먼저 깔아 다리 칸끼리 이어지게 한다
            blit(tileImg('water', clock), px, py, T);
            const bits = edgeBits(WATERY, x, y); if (bits) wctx.drawImage(shoreOverlay(bits, T, v), px, py);
          }
          if (ter.turn) { // 세로 다리: 가로 다리 그림을 90° 돌린다
            wctx.save(); wctx.translate(px + T, py); wctx.rotate(Math.PI / 2);
            blit(tileImg(ter.tile, clock), 0, 0, T); wctx.restore();
          } else blit(tileImg(ter.tile, clock), px, py, T);
          if (ch === ':') { const o = pathOverlay(x, y, T); if (o) wctx.drawImage(o, px, py); }
          if (ch === '~' || ch === 'w') { const bits = edgeBits(WATERY, x, y); if (bits) wctx.drawImage(shoreOverlay(bits, T, v), px, py); }
          else if (!WOODY.includes(ch)) forestOverhang(x, y, px, py, T);
          continue;
        }
        const ground = TERRAIN[ev.ground || A.ground] || TERRAIN['.'];
        if (ev.ground === 'r' && worldArt('rug')) drawRug(x, y, px, py, T);
        else {
          if (ground.under) blit(tileImg(underTile(ground), clock), px, py, T);
          blit(tileImg(ground.tile, clock), px, py, T);
        }
        if (ev.icon) blit(tileImg(ev.iconDone && S.done[wkey(x, y)] ? ev.iconDone : ev.icon, clock), px, py, T);
        if (ev.door) blit(tileImg('door', clock), px, py, T);
      }
    }
    // 가구 묶음과 사람은 아래쪽 끝이 위에 있는 것부터 그린다 (제단 뒤에 선 사람은 다리가 가려진다)
    const draws = [];
    for (const b of areaBlocks()) {
      if (b.x + b.w < x0 || b.x > x1 + 1 || b.y + b.h < y0 || b.y > y1 + 1) continue;
      const img = worldArt(TERRAIN[b.ch].tile); if (!img) continue;
      draws.push({ z: b.y + b.h, f: () => {
        const W2 = b.w * T, H2 = b.h * T;
        let s = Math.min(W2 * 0.96 / img.width, (H2 + T * (TERRAIN[b.ch].rise ?? 0.6)) / img.height), w = img.width * s, h = img.height * s;
        if (TERRAIN[b.ch].block === 'wide') w = Math.min(W2 * 0.96, w * 1.6);
        const k = TERRAIN[b.ch].scale ?? 1; w *= k; h *= k;
        wctx.imageSmoothingEnabled = true;
        wctx.drawImage(img, Math.round(ox + b.x * T + (W2 - w) / 2), Math.round(oy + b.y * T + H2 - h - T * 0.03), Math.round(w), Math.round(h));
      } });
    }
    // 한 칸에 반걸음씩: 왼발 → 서기 → 오른발 → 서기 (멈추면 서기)
    const stepF = dist ? Math.floor(hero.walk * 2) % 4 : -1;
    for (const m of ensureMovers()) draws.push({ z: m.fy + 1, f: () => drawPerson(m.ev.npc, m.dir, Math.floor(clock * 2 + m.hx) % 2, Math.round(ox + m.fx * T), Math.round(oy + m.fy * T), T) });
    draws.push({ z: hero.y + 1, f: () => drawHero(S.wdir, stepF, Math.round(ox + hero.x * T), Math.round(oy + hero.y * T), T) });
    draws.sort((a, b) => a.z - b.z).forEach((d) => d.f());
    if (S.battle) drawWorldBattle(W, H);
  }

  // ----- 3D로 보기: 같은 격자를 world3d.js 가 3D로 그린다. 전투 창은 2D 캔버스를 투명하게 겹쳐 그린다 -----
  const W3D_KEY = 'ashen-abbey-3d';
  let use3D = false;
  try { use3D = localStorage.getItem(W3D_KEY) === '1'; } catch (e) { /* 저장소 없음 */ }
  const on3D = () => use3D && inWorld() && !!window.World3D && World3D.ready && World3D.wants(S.area);
  // 따라오는 파티가 설 수 있는 칸 (사건 칸·사람 칸은 빼고)
  const open3D = (x, y) => { const ch = wcell(x, y), t = ch && !area().events[ch] && TERRAIN[ch]; return !!(t && t.walk) && !moverAt(x, y); };
  function drawWorld3D(dt) {
    updateMovers(dt);
    let shake = 0;
    if (cam.bump) {
      cam.bump.t += dt;
      const t = cam.bump.t / 0.22;
      if (cam.bump.shake) shake = 1 - Math.min(1, t);
      if (t >= 1) cam.bump = null;
    }
    w3dCv.hidden = false;
    worldCv.hidden = true; // 전투도 3D 무대에서 (world3d.js battleFrame)
    World3D.frame({
      area: S.area, hero: { x: hero.x, y: hero.y, dir: S.wdir }, dt, shake, reduceMotion, ok: open3D, done: (x, y) => !!S.done[wkey(x, y)], flag: (n) => !!S.flags[n],
      movers: ensureMovers().map((m) => ({ x: m.fx, y: m.fy, dir: m.dir, npc: m.ev.npc, key: m.hx + ',' + m.hy })),
      battle: battle3D()
    });
  }
  // 3D 전투 무대에 넘길 것: 적 그림(던전·2D 전투와 같은 monsters/<sprite>.png)과 크기, 적마다 연출 상태, 쓰러진 파티원
  function battle3D() {
    const B = S.battle;
    if (!B || !foeSprites.length) return null;
    const mon = D.monsters[B.mid], look = foeLook(mon.sprite), art = foeSprites[0].art;
    return {
      ref: B, img: art.tex.image, aspect: art.aspect || 1, scale: look.scale, tint: mon.tint != null ? mon.tint : look.tint,
      glow: !!look.glow && !art.custom, fly: !!look.glow || look.y > look.scale * 0.6,
      foes: foeSprites.map((f) => ({ hit: f.hit, lunge: f.lunge, dying: f.dying })),
      down: S.party.map((m) => m.hp <= 0), won: !B.foes.some((f) => f.hp > 0) && S.party.some((m) => m.hp > 0)
    };
  }
  function set3D(on) {
    use3D = on;
    try { localStorage.setItem(W3D_KEY, on ? '1' : '0'); } catch (e) { /* 저장소 없음 */ }
    update3DButton();
    if (on && window.World3D && !World3D.ready) load3D(false);
    else log(on ? (World3D.wants(S.area) ? '3D로 본다.' : '3D로 보기를 켰다. 이곳은 아직 2D로 보인다.') : '2D로 본다.', 'hint');
    draw();
  }
  function load3D(quiet) {
    if (!window.World3D) return;
    const box = $('w3dLoad'), bar = box.querySelector('i');
    box.hidden = false; bar.style.width = '4%';
    World3D.load((p) => { bar.style.width = Math.round(p * 100) + '%'; })
      .then(() => {
        box.hidden = true;
        if (!quiet && use3D) log(World3D.wants(S.area) ? '3D로 본다.' : '3D로 보기를 켰다. 이곳은 아직 2D로 보인다.', 'hint');
        draw();
      })
      .catch(() => { box.hidden = true; use3D = false; update3DButton(); log('3D 화면을 불러오지 못해 2D로 본다.', 'warn'); });
  }
  function update3DButton() {
    const b = $('btn3d');
    b.setAttribute('aria-pressed', String(use3D));
    b.title = use3D ? '2D로 보기 (V)' : '3D로 보기 (V)';
    b.hidden = !S || !inWorld();
  }
  $('btn3d').addEventListener('click', () => set3D(!use3D));

  // 지상 전투: 화면 가운데 창에 적을 세운다 (적 그림은 던전 전투와 같은 monsters/<sprite>.png)
  function drawWorldBattle(W, H) {
    wctx.fillStyle = 'rgba(0,0,0,0.45)'; wctx.fillRect(0, 0, W, H);
    const bw = Math.round(W * 0.7), bh = Math.round(H * 0.62), bx = Math.round((W - bw) / 2), by = Math.round(H * 0.12);
    const bg = worldArt('battle_' + S.area);
    if (bg) { // 창 비율에 맞춰 가운데를 잘라 그린다 (늘이지 않음)
      const r = Math.min(bg.width / bw, bg.height / bh), sw = bw * r, sh = bh * r;
      wctx.imageSmoothingEnabled = true;
      wctx.drawImage(bg, (bg.width - sw) / 2, (bg.height - sh) / 2, sw, sh, bx, by, bw, bh);
    }
    else {
      const sky = wctx.createLinearGradient(0, by, 0, by + bh);
      sky.addColorStop(0, '#5e9ee0'); sky.addColorStop(0.5, '#b8d8f0'); sky.addColorStop(0.52, '#4f9a3c'); sky.addColorStop(1, '#2e6a24');
      wctx.fillStyle = sky; wctx.fillRect(bx, by, bw, bh);
      wctx.fillStyle = '#2a6a2e';
      for (let i = 0; i < 9; i++) { const tx = bx + (i + 0.3) * bw / 9; wctx.beginPath(); wctx.moveTo(tx, by + bh * 0.5); wctx.lineTo(tx + bw / 18, by + bh * (0.26 + (i % 3) * 0.05)); wctx.lineTo(tx + bw / 9, by + bh * 0.5); wctx.fill(); }
    }
    const lw = Math.max(2, Math.round(W / 300));
    wctx.strokeStyle = '#f4f0e8'; wctx.lineWidth = lw; wctx.strokeRect(bx - lw * 1.5, by - lw * 1.5, bw + lw * 3, bh + lw * 3);
    const n = foeSprites.length, mon = D.monsters[S.battle.mid], look = foeLook(mon.sprite);
    foeSprites.forEach((f, i) => {
      if (f.dying >= 1) return;
      const img = f.art.tex.image, aspect = f.art.aspect || 1;
      const h = Math.min(bh * 0.8, bh * 0.36 * look.scale) * (1 + (f.lunge > 0 ? Math.sin((1 - f.lunge) * Math.PI) * 0.18 : 0));
      const w = h * aspect;
      const cx = bx + bw * (i + 0.5) / n + (f.hit > 0 ? Math.sin(clock * 80) * bw * 0.01 * f.hit : 0);
      const base = by + bh * 0.9 - (look.glow ? Math.sin(clock * 2.2 + f.phase) * bh * 0.03 : 0);
      wctx.globalAlpha = (1 - f.dying) * (f.hit > 0 && Math.floor(clock * 30) % 2 ? 0.4 : 1);
      wctx.imageSmoothingEnabled = true;
      wctx.drawImage(img, cx - w / 2, base - h, w, h);
      wctx.globalAlpha = 1;
    });
  }

  // 지상 미니맵: 지역 전체를 작은 색 칸으로
  const MINI_COL = { grass: '#4f9a3c', flowers: '#5aa448', path: '#c9a86a', bridge: '#8a5a2c', forest: '#2a7a32', woods: '#1c4a20', tree: '#2a7a32', mountain: '#8a7a62', water: '#2f63c8', pond: '#2f63c8', roof: '#b03a2a', wall: '#d8c8a0',
    cobble: '#a39d90', crops: '#6a4a2a', fence: '#a0703c', hedge: '#2a6226', fountain: '#3f7fd8', well: '#8c867a', stall: '#c03028',
    lamp: '#4f9a3c', barrel: '#8a5a2c', chapel_roof: '#4a5a78', stone_wall: '#a8a49c',
    floor: '#a0703c', rug: '#9a2a28', iwall: '#3a2a1a', table: '#6a4422', bed: '#3a5ab8', counter: '#6a4422', shelf: '#4a3018',
    hearth: '#e8602a', pew: '#6a4422', altar: '#e8e0cc', plant: '#2e7a2e' };
  function drawWorldMini(W, H, A, pad) {
    const map = area().map, rows = map.length, cols = map[0].length, ar = area();
    const cs = Math.min((W - pad * 2) / cols, (H - pad * 2) / rows);
    const ox = (W - cs * cols) / 2, oy = (H - cs * rows) / 2;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = map[y][x], ev = ar.events[ch];
      const ter = ev ? TERRAIN[ev.ground || ar.ground] : TERRAIN[ch];
      mctx.fillStyle = ev && (ev.icon || ev.door) ? '#f0d040' : (ter ? MINI_COL[ter.tile] : '#000');
      mctx.fillRect(ox + x * cs, oy + y * cs, cs + 0.5, cs + 0.5);
    }
    const px = ox + (S.wx + 0.5) * cs, py = oy + (S.wy + 0.5) * cs;
    if (A.player) {
      mctx.save(); mctx.translate(px, py); mctx.rotate(S.wdir * Math.PI / 2);
      mctx.drawImage(A.player, -cs * 0.9, -cs * 0.9, cs * 1.8, cs * 1.8); mctx.restore();
    } else {
      mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(px, py, Math.max(2.5, cs * 0.6), 0, Math.PI * 2); mctx.fill();
      mctx.strokeStyle = '#c03028'; mctx.lineWidth = 1.5; mctx.stroke();
    }
  }

  // ---------- 미니맵 (자동 지도) ----------
  // map/<이름>.png 그림이 있으면 지도를 그 그림으로 그린다. 없는 것만 코드 그림으로 남는다
  const MAP_ART = {};
  for (const n of ['bg', 'frame', 'floor', 'wall', 'door', 'locked', 'down', 'up', 'player']) {
    const img = new Image();
    img.onload = () => {
      // 테두리는 두께를 재 두었다가 아홉 조각으로 나눠 얇게 그린다 (지도가 가려지지 않게)
      if (n === 'frame') img.edge = frameEdge(img);
      MAP_ART[n] = img; if (S) drawMini();
    };
    img.src = 'map/' + n + '.png';
  }
  function frameEdge(img) {
    const c = document.createElement('canvas'); c.width = img.width; c.height = 1;
    const x = c.getContext('2d'); x.drawImage(img, 0, -Math.floor(img.height / 2));
    const d = x.getImageData(0, 0, img.width, 1).data;
    let t = 0; while (t < img.width / 2 && d[t * 4 + 3] <= 20) t++;   // 바깥 투명 여백을 건너뛰고
    while (t < img.width / 2 && d[t * 4 + 3] > 20) t++;               // 틀이 끝나는 곳까지
    return Math.max(4, t);
  }
  const FRAME_T = 0.11;   // 화면에서 지도 테두리 두께 (지도 너비 대비)
  function drawFrame9(img, W, H) {
    const s = img.edge, iw = img.width, ih = img.height, t = Math.round(W * FRAME_T);
    const sx = [0, s, iw - s, iw], sy = [0, s, ih - s, ih], dx = [0, t, W - t, W], dy = [0, t, H - t, H];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      if (i === 1 && j === 1) continue;
      mctx.drawImage(img, sx[i], sy[j], sx[i + 1] - sx[i], sy[j + 1] - sy[j], dx[i], dy[j], dx[i + 1] - dx[i], dy[j + 1] - dy[j]);
    }
  }
  function drawMini() {
    const map = floor().map, rows = map.length, cols = map[0].length;
    const A = MAP_ART, W = mini.width, H = mini.height;
    // 테두리 그림이 있으면 칸들은 그 안쪽에 그린다
    const pad = A.frame ? Math.round(W * (FRAME_T + 0.03)) : 0;
    const cs = Math.min((W - pad * 2) / cols, (H - pad * 2) / rows);
    const ox = (W - cs * cols) / 2, oy = (H - cs * rows) / 2;
    mctx.imageSmoothingEnabled = true;
    if (A.bg) mctx.drawImage(A.bg, 0, 0, W, H);
    else { mctx.fillStyle = C.bg; mctx.fillRect(0, 0, W, H); }
    if (inWorld()) { drawWorldMini(W, H, A, pad); if (A.frame) drawFrame9(A.frame, W, H); return; }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!S.seen[key(x, y)]) continue;
        const k = kind(x, y), px = ox + x * cs, py = oy + y * cs;
        const ev = floor().events[map[y][x]];
        const tile = k === 'wall' ? A.wall : A.floor;
        if (tile) {
          mctx.drawImage(tile, px, py, cs + 0.5, cs + 0.5);
          const over = k === 'door' ? A.door : k === 'locked' ? A.locked
            : ev && ev.mark === 'stairs-down' ? A.down : ev && ev.mark ? A.up : null;
          if (over) { mctx.drawImage(over, px, py, cs, cs); continue; }
          if (k === 'wall' || (k === 'open' && !(ev && ev.mark))) continue;
        }
        if (k === 'wall') { mctx.fillStyle = C.seen; mctx.fillRect(px, py, cs, cs); continue; }
        mctx.fillStyle = C.torch;
        if (k !== 'open') mctx.fillRect(px + cs * 0.25, py + cs * 0.25, cs * 0.5, cs * 0.5);
        mctx.strokeStyle = C.dim; mctx.globalAlpha = 0.35;
        mctx.strokeRect(px + 0.5, py + 0.5, cs - 1, cs - 1);
        mctx.globalAlpha = 1;
        if (ev && ev.mark) {
          mctx.fillStyle = C.torch;
          mctx.font = Math.floor(cs * 0.9) + 'px VT323, monospace';
          mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
          mctx.fillText(ev.mark === 'stairs-down' ? '▼' : '▲', px + cs / 2, py + cs / 2 + 1);
        }
      }
    }
    const px = ox + S.x * cs + cs / 2, py = oy + S.y * cs + cs / 2;
    mctx.save();
    mctx.translate(px, py);
    mctx.rotate(S.dir * Math.PI / 2);
    if (A.player) {
      // 북쪽(위)을 보는 그림을 바라보는 방향으로 돌린다. 칸보다 조금 크게
      const ps = cs * 1.3;
      mctx.drawImage(A.player, -ps / 2, -ps / 2, ps, ps);
      mctx.restore();
      if (A.frame) drawFrame9(A.frame, W, H);
      return;
    }
    mctx.fillStyle = C.torch;
    mctx.beginPath();
    mctx.moveTo(0, -cs * 0.42); mctx.lineTo(cs * 0.34, cs * 0.34); mctx.lineTo(-cs * 0.34, cs * 0.34);
    mctx.closePath(); mctx.fill();
    mctx.restore();
    if (A.frame) drawFrame9(A.frame, W, H);
  }

  // ---------- 얼굴 그림 ----------
  // 평소 얼굴과 다친 얼굴(_dmg)을 미리 받아 둔다. 다 받으면 파티 칸을 다시 그려서, 처음 다쳤을 때 그림을 못 받아 평소 얼굴로 남는 일이 없게 한다
  const FACE_OK = {};
  for (const m of D.party.members) {
    for (const k of [m.face, m.face + '_dmg']) {
      if (!m.face || k in FACE_OK) continue;
      FACE_OK[k] = null;
      const img = new Image();
      img.onload = () => { FACE_OK[k] = true; if (S) updateStatus(); };
      img.onerror = () => { FACE_OK[k] = false; if (S) updateStatus(); };
      img.src = 'portraits/' + k + '.png';
    }
  }

  // ---------- 무기 아이콘 ----------
  // weapons/<id>.png 그림이 있으면 그 그림, 없으면 16칸 도트로 코드가 그린다 (검·철퇴·지팡이)
  const WP_ART = {};
  const WP_DOT = {};
  for (const id of Object.keys(WEAPONS)) {
    const img = new Image();
    img.onload = () => { WP_ART[id] = img.src; if (S) updateStatus(); };
    img.src = 'weapons/' + id + '.png';
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k))));
    return 'rgb(' + c.join(',') + ')';
  }
  function weaponIcon(id) {
    if (WP_ART[id]) return WP_ART[id];
    if (WP_DOT[id]) return WP_DOT[id];
    const w = WEAPONS[id], N = 16, px = {};
    const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < N && y < N) px[x + ',' + y] = c; };
    const hi = shade(w.color, 1.45), mid = shade(w.color, 1), lo = shade(w.color, 0.62);
    const wood = '#7a4a26', woodHi = '#a8703c', gold = '#e0b040', goldLo = '#9a6a1a';
    if (w.kind === 'sword') {
      for (let t = 0; t < 9; t++) { put(5 + t, 10 - t, hi); put(6 + t, 10 - t, mid); put(6 + t, 11 - t, lo); }
      put(14, 1, hi);
      [[2, 9], [3, 10], [4, 11], [5, 12], [6, 13]].forEach(([x, y], i) => put(x, y, i < 2 ? gold : goldLo));
      put(3, 12, wood); put(2, 13, woodHi); put(1, 14, gold);
    } else if (w.kind === 'mace') {
      for (let t = 0; t < 8; t++) { put(2 + t, 14 - t, t % 2 ? wood : woodHi); put(3 + t, 14 - t, wood); }
      for (let y = 3; y <= 7; y++) for (let x = 9; x <= 13; x++) if (!((x === 9 || x === 13) && (y === 3 || y === 7))) put(x, y, x + y < 15 ? hi : x + y > 17 ? lo : mid);
      [[11, 1], [11, 2], [15, 5], [14, 5], [7, 5], [8, 5], [11, 9], [11, 8]].forEach(([x, y]) => put(x, y, mid));
    } else {
      for (let t = 0; t < 11; t++) { put(1 + t, 15 - t, t % 3 ? wood : woodHi); put(2 + t, 15 - t, wood); }
      put(10, 2, wood); put(14, 6, wood); put(13, 1, wood);
      for (let y = 2; y <= 5; y++) for (let x = 11; x <= 14; x++) if (!((x === 11 || x === 14) && (y === 2 || y === 5))) put(x, y, x + y < 15 ? hi : x + y > 16 ? lo : mid);
      put(12, 3, '#ffffff');
    }
    const cv = document.createElement('canvas'), Z = 3;
    cv.width = cv.height = N * Z;
    const g = cv.getContext('2d');
    g.fillStyle = '#1a0b07'; // 1칸 짙은 갈색 테두리
    for (const k in px) {
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!px[(x + dx) + ',' + (y + dy)]) g.fillRect((x + dx) * Z, (y + dy) * Z, Z, Z);
    }
    for (const k in px) { const [x, y] = k.split(',').map(Number); g.fillStyle = px[k]; g.fillRect(x * Z, y * Z, Z, Z); }
    return (WP_DOT[id] = cv.toDataURL());
  }
  function weaponSay(m) {
    const w = weaponOf(m);
    log(w ? m.name + ' · ' + w.name + ' (' + wpStat(w) + ') — ' + w.desc : m.name + '은(는) 맨손이다.');
  }
  function updateEquip() {
    const L = $('eqL'), R = $('eqR');
    if (!L) return;
    const slot = (m) => {
      const b = document.createElement('button'), w = weaponOf(m);
      b.type = 'button'; b.className = 'eqSlot';
      b.title = m.name + ': ' + (w ? w.name : '맨손');
      if (w) { const img = new Image(); img.alt = w.name; img.src = weaponIcon(m.weapon); b.append(img); }
      const n = document.createElement('b'); n.textContent = '공' + atkOf(m);
      const t = document.createElement('small'); t.textContent = m.name;
      b.append(n, t);
      b.addEventListener('click', () => weaponSay(m));
      return b;
    };
    const coin = document.createElement('div');
    coin.className = 'eqSlot coin';
    coin.innerHTML = '<small>금화</small><b></b>';
    coin.querySelector('b').textContent = S.gold;
    L.replaceChildren(slot(S.party[0]), slot(S.party[1]));
    R.replaceChildren(slot(S.party[2]), coin);
  }

  // ---------- UI ----------
  // 체력이 3분의 1 이하이거나 쓰러지면 <face>_dmg.png 다친 얼굴 (쓰러지면 CSS 가 회색으로), 그 그림이 없으면 평소 얼굴
  function faceImg(face, m) {
    const hurt = Number(m.hp) <= Number(m.maxHp) / 3 && FACE_OK[face + '_dmg'] !== false;
    const img = new Image();
    img.alt = '';
    img.onerror = () => { if (hurt && !img.dataset.fallback) { img.dataset.fallback = 1; img.src = 'portraits/' + face + '.png'; } else img.remove(); };
    img.src = 'portraits/' + face + (hurt ? '_dmg' : '') + '.png';
    return img;
  }
  const CLASS_GLYPH = { '전사': '⚔\uFE0E', '사제': '✚\uFE0E', '마법사': '✦\uFE0E' };
  function updateStatus() {
    $('floorName').textContent = inWorld() ? area().name : floor().name;
    $('dir').textContent = DIR_NAME[S.dir];
    $('gold').textContent = S.gold;
    const ul = $('party');
    ul.textContent = '';
    S.party.forEach((m, i) => {
      const li = document.createElement('li');
      if (m.hp <= 0) li.className = 'down';
      const ratio = m.hp / m.maxHp;
      // 얼굴 그림이 없으면 뒤에 깔린 직업 문양이 보인다 (예전 저장에는 face 가 없어 data.js 에서 찾는다)
      const face = m.face || (D.party.members[i] || {}).face;
      li.innerHTML = '<div class="face" data-glyph="' + (CLASS_GLYPH[m.cls] || '?') + '"></div><div class="pm-info"><div class="pm-top"><b></b><span class="cls"></span><span class="lv"></span></div>' +
        '<div class="bar"><i style="width:' + (100 * ratio) + '%"' + (ratio <= 0.3 ? ' class="low"' : '') + '></i></div>' +
        '<div class="pm-num"><span>HP ' + m.hp + '/' + m.maxHp + '</span>' + (m.maxMp ? '<span>MP ' + m.mp + '/' + m.maxMp + '</span>' : '') + '</div></div>';
      if (face) li.querySelector('.face').append(faceImg(face, m));
      if (m.hp <= 0) li.querySelector('.pm-num span').textContent = '쓰러짐';
      li.querySelector('b').textContent = m.name;
      li.querySelector('.cls').textContent = m.cls;
      li.querySelector('.lv').textContent = 'Lv ' + m.lv;
      const w = weaponOf(m);
      if (w) { // 무기 한 줄: 그림 · 이름 · 공격력 (폰 세로에선 패드 옆에 따로 보여서 숨긴다)
        const row = document.createElement('div');
        row.className = 'pm-wpn';
        const img = new Image(); img.alt = ''; img.src = weaponIcon(m.weapon);
        const n = document.createElement('span'); n.textContent = w.name;
        const a = document.createElement('em'); a.textContent = '공' + atkOf(m) + (magOf(m) ? ' 주+' + magOf(m) : '');
        row.append(img, n, a);
        li.querySelector('.pm-info').append(row);
      }
      ul.appendChild(li);
    });
    updateEquip();
    const inv = $('inventory');
    inv.textContent = '';
    if (!S.items.length) {
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = '아직 아무것도 없다.'; inv.appendChild(li);
    }
    for (const id of S.items) {
      const li = document.createElement('li');
      const n = document.createElement('b'); n.textContent = D.items[id].name;
      const d = document.createElement('span'); d.textContent = D.items[id].desc;
      li.append(n, d); inv.appendChild(li);
    }
  }

  function renderLog() {
    const ul = $('log');
    ul.textContent = '';
    for (const l of S.log.slice(-6)) {
      const li = document.createElement('li');
      li.textContent = l.msg;
      if (l.tone) li.className = l.tone;
      ul.appendChild(li);
    }
  }

  let glFailed = false;
  function draw() {
    const w = inWorld();
    view.hidden = w; worldCv.hidden = !w || on3D(); $('dir').hidden = w;
    w3dCv.hidden = !on3D();
    update3DButton();
    $('noGL').hidden = !(glFailed && !w);
    if (!w) markVisible();
    if (!w && scene && builtFloor === S.floor) refreshProps();
    drawMini();
    updateStatus();
    if (window.BGM) { const P = w ? area() : floor(); BGM.scene(P.music || (w ? S.area : S.floor)); } // 장면별 배경음악 (music.js)
  }

  function worldOk(a, x, y) {
    const A = D.areas[a], ch = A && A.map[y] && A.map[y][x];
    if (!ch) return false;
    const ev = A.events[ch];
    if (ev) return !ev.solid;
    return !!(TERRAIN[ch] && TERRAIN[ch].walk);
  }
  function startGame(saved) {
    S = saved && saved.floor && saved.party ? saved : newState();
    S.party.forEach((m, i) => { // 무기가 생기기 전의 기록: 처음 무기를 쥐여 주고, 대장간에서 벼린 +3 은 별빛 검으로 바꾼다
      if (m.weapon !== undefined) return;
      const base = D.party.members[i] || {};
      m.weapon = base.weapon || null;
      if (i === 0) { m.atk -= 1; if (S.flags && S.flags.forged) { m.atk -= 3; m.weapon = 'starlight_sword'; } }
    });
    if (!S.mode) { // 지상이 생기기 전의 기록은 던전 안에서 이어 간다
      Object.assign(S, { mode: 'dungeon', area: 'field', wx: 27, wy: 4, wdir: 2 });
    }
    // 지도가 바뀌어 기록된 자리가 벽 속이면 마을 시작점으로 옮긴다
    if (!D.areas[S.area] || !worldOk(S.area, S.wx, S.wy)) Object.assign(S, { area: D.start.area, wx: D.start.x, wy: D.start.y, wdir: D.start.dir });
    if (!D.floors[S.floor]) Object.assign(S, { floor: D.dungeon.floor, x: D.dungeon.x, y: D.dungeon.y, dir: D.dungeon.dir });
    snapHero();
    if (window.World3D) World3D.reset();
    preloadWorldArt();
    battleUI.hidden = true; clearFoes(); busy = false;
    if (window.BGM) BGM.battleEnd(); // 전투 도중 새로 시작·불러오기
    dialog = null;
    $('event').hidden = true;
    $('ending').hidden = !S.ended || S.ended === 'dead';
    if (S.ended === 'dead') showGameOver(); else $('gameOver').hidden = true;
    if (!S.log.length) { D.intro.forEach((l) => log(l)); log((inWorld() ? area().name : floor().name) + '. 방향 버튼으로 걷고, [조사]로 말을 건다.', 'hint'); }
    builtFloor = null;
    if (camera) snapCamera();
    renderLog();
    draw();
    if (S.battle && !D.monsters[S.battle.mid]) S.battle = null; // 없어진 적이면 전투를 버린다
    if (S.battle) { if (scene) spawnFoes(); showBattle(); }
  }

  // ---------- 저장 ----------
  const SAVE_KEY = 'dungeon-save-v2';
  function save() {
    if (dialog || S.battle) { log('사건이나 전투가 끝난 뒤에 저장할 수 있다.', 'warn'); return; }
    writeSave();
  }
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); log('기록했다.', 'good'); }
    catch (e) { log('이 브라우저에서는 저장할 수 없다.', 'warn'); }
  }
  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* 저장소 없음 */ }
    if (!data) { log('불러올 기록이 없다.', 'warn'); return; }
    startGame(data);
    log('기록을 불러왔다.', 'good');
  }

  // ---------- 입력 ----------
  // 지상에서는 위·아래·왼쪽·오른쪽으로 걷고, 던전에서는 앞뒤 이동과 90° 회전
  const ACTIONS = {
    fwd: () => (inWorld() ? walk(0) : tryMove(0)), back: () => (inWorld() ? walk(2) : tryMove(2)),
    left: () => (inWorld() ? walk(3) : turn(-1)), right: () => (inWorld() ? walk(1) : turn(1)),
    sl: () => (inWorld() ? walk(3) : tryMove(3)), sr: () => (inWorld() ? walk(1) : tryMove(1)),
    search: () => (inWorld() ? talk() : search())
  };
  // 화면 전환 중에는 움직이지 않는다
  for (const k in ACTIONS) { const f = ACTIONS[k]; ACTIONS[k] = () => { if (!(window.Curtain && Curtain.busy)) f(); }; }
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (titleOpen) { // 시작 화면에서는 Enter 로 맨 위 버튼을 누른다
      if (window.BGM && BGM.wokeBy && BGM.wokeBy(e)) { e.preventDefault(); return; } // 첫 키는 음악만 깨운다 (PRESS ENTER)
      if (e.key === 'Enter' && !(document.activeElement && document.activeElement.closest('#titleScreen button'))) { e.preventDefault(); ($('tsCont').hidden ? $('tsNew') : $('tsCont')).click(); }
      return;
    }
    if (dialog || S.battle) {
      const n = parseInt(e.key, 10);
      const btns = (dialog ? $('evChoices') : $('bCmds')).children;
      if (n >= 1 && n <= btns.length) { btns[n - 1].click(); e.preventDefault(); }
      return;
    }
    if ((e.key === 'v' || e.key === 'V') && inWorld()) { e.preventDefault(); set3D(!use3D); return; } // 3D로 보기 켜고 끄기
    const map = {
      ArrowUp: 'fwd', w: 'fwd', W: 'fwd', ArrowDown: 'back', s: 'back', S: 'back',
      ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
      q: 'sl', Q: 'sl', e: 'sr', E: 'sr', ' ': 'search', f: 'search', F: 'search'
    };
    const act = map[e.key];
    if (!act) return;
    e.preventDefault();
    if (WALK_DIR[act] != null && inWorld()) { // 지상: 누르고 있는 동안 이어 걷는다 (키 반복 입력은 쓰지 않음)
      if (e.repeat) return;
      heldKey = e.key.toLowerCase(); heldWalk = WALK_DIR[act]; hero.blocked = null;
    }
    ACTIONS[act]();
  });
  document.addEventListener('keyup', (e) => { if (e.key.toLowerCase() === heldKey || e.key === heldKey) { heldKey = ''; heldWalk = -1; } });
  const WALK_DIR = { fwd: 0, right: 1, sr: 1, back: 2, left: 3, sl: 3 };
  let heldKey = '';
  // 패드 버튼: 누르는 즉시 움직이고, 지상에서 걷기 버튼을 누르고 있으면 계속 걷는다
  const HOLD = { fwd: 1, back: 1, left: 1, right: 1, sl: 1, sr: 1 };
  let holdTimer = 0;
  const stopHold = () => { clearTimeout(holdTimer); holdTimer = 0; heldWalk = -1; heldKey = ''; };
  document.querySelectorAll('[data-act]').forEach((b) => {
    const act = b.dataset.act;
    b.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      e.preventDefault();
      stopHold();
      if (WALK_DIR[act] != null && inWorld()) { heldWalk = WALK_DIR[act]; hero.blocked = null; } // 지상: 누르고 있으면 그림 그리는 쪽에서 이어 걷는다
      ACTIONS[act]();
      const repeat = () => {
        if (HOLD[act] && inWorld() && heldWalk < 0 && !dialog && !S.battle) ACTIONS[act]();
        holdTimer = setTimeout(repeat, 170);
      };
      if (HOLD[act]) holdTimer = setTimeout(repeat, 320);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stopHold));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    // 키보드로 누른 클릭(Enter·Space)만 따로 받는다. 손가락·마우스는 pointerdown 에서 이미 처리
    b.addEventListener('click', (e) => { if (e.detail === 0) ACTIONS[act](); });
  });
  window.addEventListener('blur', stopHold);

  // 화면 밀기: 위로 밀면 전진, 아래로 후퇴, 옆으로 회전(지상에선 그쪽으로 걷기), 짧게 톡 치면 조사
  (function swipe() {
    const el = $('viewFrame');
    let sx = 0, sy = 0, st = 0, id = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.event, .ending, button')) return;
      id = e.pointerId; sx = e.clientX; sy = e.clientY; st = performance.now();
    });
    el.addEventListener('pointerup', (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (dialog || S.battle || S.ended) return;
      const dx = e.clientX - sx, dy = e.clientY - sy, ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < 24) { if (performance.now() - st < 300) ACTIONS.search(); return; }
      if (ax > ay) ACTIONS[dx > 0 ? 'right' : 'left']();
      else ACTIONS[dy < 0 ? 'fwd' : 'back']();
    });
    el.addEventListener('pointercancel', () => { id = null; });
  })();
  // ui/ 그림: 제목(title), SAVE/LOAD/NEW(save·load·new), 던전 화면 테두리(frame, 가운데가 투명한 16:10)
  const uiArt = (file, done) => { const img = new Image(); img.alt = ''; img.onload = () => done(img); img.src = 'ui/' + file + '.png'; };
  uiArt('title', (img) => { const h = document.querySelector('header h1'); h.setAttribute('aria-label', D.title); h.textContent = ''; h.append(img); h.classList.add('art'); });
  for (const [id, file] of [['btnSave', 'save'], ['btnLoad', 'load'], ['btnNew', 'new']]) {
    uiArt(file, (img) => { const b = $(id); b.setAttribute('aria-label', b.textContent); b.textContent = ''; b.append(img); b.classList.add('art'); });
  }
  uiArt('frame', (img) => { img.className = 'frameArt'; $('flash').after(img); $('viewFrame').classList.add('framed'); });
  // buttons/<동작>.png 가 있으면 글자 버튼 대신 그림 버튼을 쓴다 (일곱 장이 다 있을 때 배치도 바둑판으로 바꾼다)
  const padBtns = [...document.querySelectorAll('.pad [data-act]')];
  let padArt = 0;
  for (const btn of padBtns) {
    const img = new Image();
    img.onload = () => {
      btn.setAttribute('aria-label', btn.textContent.replace(/^\S+/, '').trim());
      img.alt = ''; btn.textContent = ''; btn.append(img); btn.classList.add('art');
      if (++padArt === padBtns.length) btn.parentElement.classList.add('art');
    };
    img.src = 'buttons/' + btn.dataset.act + '.png';
  }
  $('btnSave').addEventListener('click', save);
  $('btnLoad').addEventListener('click', load);
  $('btnNew').addEventListener('click', () => startGame(null));
  $('endRestart').addEventListener('click', () => startGame(null));

  // ---------- 게임 오버 ----------
  const GO_TEXT = ['어둠 속에서 탐험대의 등불이 꺼졌다.', '차가운 돌바닥 위로 마지막 숨이 흩어졌다.', '수도원의 침묵이 또 한 무리의 발소리를 삼켰다.'];
  function showGameOver() {
    const where = inWorld() ? area().name : floor().name;
    $('goText').textContent = GO_TEXT[Math.floor(Math.random() * GO_TEXT.length)];
    $('goStat').textContent = where + ' · ' + S.steps + '걸음 · Lv ' + Math.max(...S.party.map((m) => m.lv));
    const faces = $('goFaces'); faces.textContent = '';
    S.party.forEach((m, i) => { const face = m.face || (D.party.members[i] || {}).face; if (face) faces.append(faceImg(face, { hp: 0, maxHp: 1 })); });
    const info = savedInfo();
    $('goLoad').hidden = !info;
    $('goLoadInfo').textContent = info || '';
    $('ending').hidden = true;
    $('event').hidden = true;
    $('gameOver').hidden = false;
    if (window.BGM) BGM.stop();
    setTimeout(() => { if (!$('gameOver').hidden) (info ? $('goLoad') : $('goNew')).focus({ preventScroll: true }); }, 1700);
  }
  function leaveGameOver(next) { $('gameOver').hidden = true; next(); }
  $('goLoad').addEventListener('click', () => leaveGameOver(load));
  $('goNew').addEventListener('click', () => leaveGameOver(() => startGame(null)));
  $('goTitle').addEventListener('click', () => leaveGameOver(() => { startGame(null); showTitle(); }));

  // 미니맵 선명도
  (function hiDPI() {
    const r = Math.min(window.devicePixelRatio || 1, 3), w = mini.width, h = mini.height;
    mini.width = w * r; mini.height = h * r; mctx.scale(r, r);
    Object.defineProperty(mini, 'width', { get: () => w });
    Object.defineProperty(mini, 'height', { get: () => h });
  })();

  // ---------- 시작 화면 ----------
  // 처음 열 때 보여 준다 (기록이 있으면 이어하기). ui/title_bg.png 가 있으면 배경, ui/title.png 가 있으면 제목 그림
  const titleUI = $('titleScreen');
  let titleOpen = false;
  function savedInfo() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return null;
      const P = d.mode === 'dungeon' ? D.floors[d.floor] : D.areas[d.area];
      return (P ? P.name + ' · ' : '') + 'Lv ' + Math.max(...d.party.map((m) => m.lv || 1));
    } catch (e) { return null; }
  }
  function showTitle() {
    const info = savedInfo();
    $('tsCont').hidden = !info;
    $('tsContInfo').textContent = info || '';
    titleUI.hidden = false; titleOpen = true;
    if (window.BGM && BGM.title) BGM.title(); // 시작 화면 테마곡 (music.js)
    (info ? $('tsCont') : $('tsNew')).focus();
  }
  function closeTitle(next) { titleUI.hidden = true; titleOpen = false; if (window.BGM && BGM.titleEnd) BGM.titleEnd(); next(); }
  $('tsNew').addEventListener('click', () => closeTitle(() => startGame(null)));
  $('tsCont').addEventListener('click', () => closeTitle(load));
  $('tsHelpBtn').addEventListener('click', () => {
    const open = $('tsHelp').hidden;
    $('tsHelp').hidden = !open; $('tsHelpBtn').setAttribute('aria-expanded', String(open));
  });
  uiArt('title_bg', (img) => { titleUI.style.setProperty('--title-bg', 'url("' + img.src + '")'); titleUI.classList.add('hasArt'); });
  uiArt('title', (img) => { const h = $('tsTitle'); h.setAttribute('aria-label', D.title); h.textContent = ''; h.append(img); });

  function boot(data) {
    startGame(data);
    if (use3D) load3D(true); // 지난번에 3D로 보고 있었으면 바로 불러 둔다
    if (!data && location.hash !== '#debug') showTitle();
    try {
      if (!THREE) throw new Error('three');
      initThree();
      snapCamera();
      preloadFoeArt();
      if (S.battle) spawnFoes();
    } catch (err) {
      glFailed = true;
      draw();
    }
    // 지상 화면은 WebGL 없이도 그린다
    requestAnimationFrame((t) => { last = t; frame(t); });
  }

  // 개발용: 주소 끝에 #debug 를 붙이면 콘솔에서 dungeon.warp('b1', x, y, dir) 사용 가능
  if (location.hash === '#debug') {
    window.dungeon = {
      state: () => S, hero: () => hero, battle: (id) => startBattle(id, null), set3D,
      art: (kind) => monsterTexture(kind).image.toDataURL(), // 코드로 그린 기본 적 그림
      warp: (f, x, y, dir) => { applyEffects([{ warp: D.areas[f] ? { area: f, x, y, dir } : { floor: f, x, y, dir } }]); }
    };
  }

  // 게시된 페이지가 갱신돼도 진행 상황을 유지
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => S);
  const ready = document.fonts ? document.fonts.ready : Promise.resolve();
  if (hot && hot.ready) hot.ready((data) => ready.then(() => boot(data)));
  else ready.then(() => boot(hot && hot.data));
})();
