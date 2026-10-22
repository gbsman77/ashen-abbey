// 장소를 옮길 때의 화면 전환 막. 엔진의 warpTo가 부른다.
//   Curtain.run({ style: 'iris' | 'dark', title, sub }, mid)
//   iris: 옛 RPG처럼 동그랗게 닫혔다가 열린다 (마을 ↔ 들판)
//   dark: 천천히 어두워지고 장소 이름이 떴다가 밝아진다 (수도원 드나들기, 층 이동)
// 화면이 다 가려진 순간에 mid()를 불러 장면을 바꾼다. 도는 동안 Curtain.busy 가 true.
(function () {
  'use strict';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let el = null, hole = null, card = null;

  function build(host) {
    el = document.createElement('div');
    el.className = 'curtain';
    el.style.cssText = 'position:absolute;inset:0;z-index:5;pointer-events:none;overflow:hidden;display:none';
    hole = document.createElement('div');
    hole.style.cssText = 'position:absolute;left:50%;top:50%;width:0;height:0;border-radius:50%;' +
      'transform:translate(-50%,-50%);box-shadow:0 0 0 300vmax #000';
    card = document.createElement('div');
    card.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:.5em;color:#e8dcc0;text-align:center;opacity:0;font-family:inherit;text-shadow:0 2px 8px #000;padding:0 12%';
    el.append(hole, card);
    // 나침반·글자·테두리까지 모두 덮는다
    host.append(el);
  }

  const ease = (x) => x * x * (3 - 2 * x);
  function tween(ms, step) {
    return new Promise((done) => {
      if (reduce) ms = Math.min(ms, 60);
      const t0 = performance.now();
      const tick = (now) => {
        const x = Math.min(1, (now - t0) / ms);
        step(ease(x));
        if (x < 1) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 300) : ms));

  async function run(opt, mid) {
    const host = document.getElementById('viewFrame');
    if (!host) { mid(); return; }
    if (!el || !el.isConnected) build(host);
    api.busy = true;
    const iris = opt.style === 'iris';
    card.innerHTML = '';
    const t = document.createElement('div');
    t.textContent = opt.title || '';
    t.style.cssText = 'font-size:clamp(18px,3.2vw,30px);letter-spacing:.18em;font-weight:700';
    const s = document.createElement('div');
    s.textContent = opt.sub || '';
    s.style.cssText = 'font-size:clamp(11px,1.5vw,14px);letter-spacing:.3em;opacity:.7';
    card.append(s, t);
    el.style.display = 'block';
    const big = Math.hypot(host.clientWidth, host.clientHeight) * 1.05;
    const setHole = (r) => { hole.style.width = hole.style.height = r + 'px'; };
    try {
      if (iris) {
        el.style.background = 'transparent';
        await tween(420, (x) => setHole(big * (1 - x)));
        mid();
        card.style.opacity = '1';
        await pause(450);
        card.style.opacity = '0';
        await tween(480, (x) => setHole(big * x));
      } else {
        setHole(big); // 구멍은 다 열어 두고 바탕을 어둡게
        await tween(550, (x) => { el.style.background = 'rgba(0,0,0,' + x + ')'; });
        mid();
        await tween(350, (x) => { card.style.opacity = String(x); });
        await pause(800);
        await tween(350, (x) => { card.style.opacity = String(1 - x); });
        await tween(650, (x) => { el.style.background = 'rgba(0,0,0,' + (1 - x) + ')'; });
      }
    } finally {
      el.style.display = 'none'; el.style.background = 'transparent'; card.style.opacity = '0';
      api.busy = false;
    }
  }

  const api = { run, busy: false };
  window.Curtain = api;
})();
