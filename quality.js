// 휴대폰에서 3D 화면이 버벅이지 않게: 그리는 해상도(픽셀 비율)를 실제 화면 속도에 맞춰 조금씩 낮추거나 올린다.
//   const q = Quality.tuner(renderer);  매 장면 그리기 전에 q.tick(key)
//   key = 장면 이름. 무거운 들판과 가벼운 집 안·전투 무대를 따로 재서 장면마다 알맞은 해상도를 기억한다
// 한 번 버벅인 해상도로는 그 장면에서 다시 올라가지 않는다 (오르내리며 화면이 깜빡이지 않게)
(function () {
  'use strict';
  const small = Math.min(screen.width, screen.height) < 600;
  const DPR = window.devicePixelRatio || 1;
  const MAX = Math.min(DPR, 2);
  const START = Math.min(MAX, small ? 1.5 : 2); // 휴대폰은 한 단계 낮게 시작해서 빠르면 올린다
  const MIN = Math.min(0.75, MAX);
  const STEP = 0.25, SLOW = 1 / 40, FAST = 1 / 52, WINDOW = 1.5;

  function tuner(renderer) {
    const lv = {}, cap = {};
    let key = null, last = 0, acc = 0, n = 0, good = 0;
    function set(pr) { if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr); }
    return {
      tick(k) {
        const now = performance.now();
        if (k !== key) { // 장면이 바뀌면 그 장면의 해상도로, 재기는 처음부터 (장면을 짓느라 걸린 틈은 빼고)
          key = k; acc = 0; n = 0; good = 0; last = 0;
          if (lv[k] == null) { lv[k] = START; cap[k] = MAX; }
          set(lv[k]);
        }
        const dt = last ? (now - last) / 1000 : 0;
        last = now;
        if (dt <= 0 || dt > 0.5) return; // 탭을 다녀왔거나 장면을 짓던 틈
        acc += dt; n++;
        if (acc < WINDOW) return;
        const avg = acc / n;
        acc = 0; n = 0;
        let pr = lv[k];
        if (avg > SLOW && pr > MIN) { cap[k] = pr - STEP; pr = Math.max(MIN, pr - STEP); good = 0; }
        else if (avg < FAST && pr < cap[k]) { if (++good >= 2) { pr = Math.min(cap[k], pr + STEP); good = 0; } }
        else good = 0;
        if (pr !== lv[k]) { lv[k] = pr; set(pr); }
      },
      info: () => ({ key, pr: renderer.getPixelRatio(), levels: { ...lv } })
    };
  }
  // 그림자 거르기: 휴대폰은 가벼운 PCF, 큰 화면은 부드러운 PCFSoft
  const shadowType = (THREE) => (small ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap);
  window.Quality = { tuner, small, shadowType };
})();
