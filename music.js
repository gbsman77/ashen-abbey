// 배경음악: 실제 악기 녹음(instruments/, FluidR3_GM 사운드폰트 CC BY 3.0)을 Web Audio로 연주하는 오리지널 곡.
// 피아노·현악·관악·합창·하프·팀파니·타이코에 홀 잔향을 입힌다. 악기 파일은 곡에 필요한 것만 그때그때 불러온다.
// 장면별 곡: town(마을), field(숲속나라 들판), dungeon1(수도원 지하 1층, 은은하게), dungeon2(지하 2층, 웅장하게),
//            crypt(수도사 묘지, 음침하게)
// 사용: BGM.play('town') / BGM.scene('b1') / BGM.stop() / BGM.toggle() (M 키, 오른쪽 아래 ♪ 버튼)
// 브라우저는 사용자가 한 번 누르거나 키를 쳐야 소리를 내므로 첫 입력 때 재생을 시작한다.
(function () {
  'use strict';

  // ---------- 음표 ----------
  const PC = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  const midi = (n) => { const m = /^([A-G]#?)(-?\d)$/.exec(n); return PC[m[1]] + 12 * (+m[2] + 1); };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // "A5/6 G5/2 -/4 C5+E5/4" → 16분음표 단위의 [{s 시작, l 길이, m [음]}] (막대 하나 = 16칸)
  function line(str, from) {
    let s = from || 0;
    const out = [];
    for (const tok of str.trim().split(/\s+/)) {
      const [n, len] = tok.split('/');
      const l = +len;
      if (n !== '-') out.push({ s, l, m: n.split('+').map(midi) });
      s += l;
    }
    return out;
  }
  // 여러 마디를 이어 붙인다 (마디마다 16칸인지 확인)
  function bars(list) {
    let s = 0;
    const out = [];
    for (const b of list) {
      const ev = line(b, s);
      const end = b.trim().split(/\s+/).reduce((a, t) => a + +t.split('/')[1], 0);
      if (end !== 16) console.warn('[BGM] 마디 길이가 16이 아님:', b);
      out.push(...ev);
      s += 16;
    }
    return out;
  }
  // 화음 이름 → 뿌리음 기준 구성음 (예: 'Dm', 'F#', 'Bb'은 'A#', 'Gsus', 'B7')
  function chord(name, oct) {
    const m = /^([A-G]#?)(m|sus|7|m7|maj7)?$/.exec(name);
    const r = midi(m[1] + oct);
    const q = { m: [0, 3, 7], sus: [0, 5, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11] }[m[2]] || [0, 4, 7];
    return q.map((i) => r + i);
  }
  // 화음 진행 위로 펼침화음: pat은 [r, 3, 5, r+8, 3+8, 5+8] 의 순번
  function arp(chords, oct, pat, len) {
    const out = [];
    chords.forEach((c, bar) => {
      const t = chord(c, oct), tones = t.slice(0, 3).concat(t.slice(0, 3).map((x) => x + 12));
      pat.forEach((i, k) => out.push({ s: bar * 16 + k * len, l: len, m: [tones[i]] }));
    });
    return out;
  }
  // 화음 진행을 마디당 리듬(칸 목록)으로 친다. fn(화음 구성음) → 칠 음들
  function comp(chords, oct, hits, fn) {
    const out = [];
    chords.forEach((c, bar) => {
      const t = chord(c, oct);
      hits.forEach(([at, l]) => out.push({ s: bar * 16 + at, l, m: fn(t) }));
    });
    return out;
  }
  // 드럼: 마디마다 16글자. k 킥, s 스네어, h 닫힌 하이햇, o 열린 하이햇, t 팀파니, c 심벌, . 쉼
  function drums(patterns) {
    const out = [];
    patterns.forEach((p, bar) => [...p].forEach((ch, i) => { if (ch !== '.') out.push({ s: bar * 16 + i, d: ch }); }));
    return out;
  }
  const times = (n, a) => Array.from({ length: n }, () => a).flat();

  // ---------- 곡 ----------
  // 마을: 잔잔하고 따뜻한 옛 RPG 마을풍. F장조, 하프 펼침화음 위에 플루트 선율.
  function songTown() {
    const ch = ['F', 'C', 'Dm', 'A#', 'Gm', 'C', 'F', 'C', 'A#', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'F'];
    const mel = bars([
      'A5/6 G5/2 F5/4 C5/4', 'E5/6 F5/2 G5/8', 'F5/6 E5/2 D5/4 A4/4', 'D5/4 F5/4 A#5/8',
      'A#5/6 A5/2 G5/4 D5/4', 'E5/4 G5/4 C6/4 A#5/4', 'A5/6 G5/2 F5/8', 'E5/4 F5/4 G5/8',
      'F5/4 D6/8 C6/4', 'A#5/4 A5/4 G5/8', 'C6/6 A5/2 E5/8', 'F5/4 A5/4 D6/8',
      'D6/6 C6/2 A#5/4 A5/4', 'G5/4 A5/4 A#5/4 G5/4', 'A5/16', '-/8 C5/2 D5/2 E5/4'
    ]);
    const echo = mel.map((e) => ({ s: e.s + 3, l: e.l, m: e.m.map((x) => x - 12) })).filter((e) => e.s < 256);
    return {
      bpm: 96, bars: 16, timp: 41, echo: { time: 0.31, fb: 0.32, mix: 0.3 },
      tracks: [
        { inst: 'flute', vol: 0.55, send: 0.35, pan: 0.12, ev: mel },
        { inst: 'piano', vol: 0.2, send: 0.4, pan: -0.25, ev: echo },
        { inst: 'harp', vol: 0.2, send: 0.4, pan: -0.35, ev: arp(ch, 4, [0, 1, 2, 4, 3, 2, 1, 2, 0, 1, 2, 4, 5, 4, 2, 1], 1) },
        { inst: 'strings', vol: 0.13, send: 0.5, pan: 0.3, ev: comp(ch, 3, [[0, 16]], (t) => t) },
        { inst: 'pizz', vol: 0.35, send: 0.25, pan: 0.15, ev: comp(ch, 2, [[0, 6], [6, 2], [8, 8]], (t) => [t[0]]).map((e, i) => (i % 3 === 2 ? { ...e, m: [e.m[0] + 7] } : e)) }
      ],
      drums: drums(times(16, ['....h.......h...']).map((p, i) => (i % 4 === 3 ? '....h.......h.hh' : p))),
      dvol: 0.35
    };
  }

  // 들판: 빠르고 힘찬 80년대 애니 주제가풍. E단조로 달리다 G장조 후렴에서 펼쳐진다.
  function songField() {
    const intro = ['Em', 'C', 'D', 'B'];
    const verse = ['Em', 'C', 'D', 'G', 'Em', 'C', 'Am', 'B'];
    const chorus = ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D'];
    const ch = [...intro, ...verse, ...chorus];
    const mel = bars([
      'B4/2 E5/2 G5/2 B5/6 A5/2 G5/2', 'G5/3 E5/3 C5/2 -/2 E5/2 G5/2 C6/2', 'A5/3 F#5/3 D5/2 -/2 F#5/2 A5/2 D6/2', 'D#6/8 B5/4 F#5/4',
      'E5/4 -/2 E5/2 F#5/2 G5/4 A5/2', 'G5/6 F#5/2 E5/4 C5/4', 'D5/4 -/2 D5/2 E5/2 F#5/4 A5/2', 'B5/8 A5/4 G5/4',
      'E5/4 -/2 E5/2 F#5/2 G5/4 B5/2', 'C6/6 B5/2 A5/4 G5/4', 'A5/4 C6/4 E6/4 C6/4', 'B5/8 A5/4 F#5/4',
      'G5/6 B5/2 D6/8', 'D6/4 C6/2 B5/2 A5/8', 'B5/6 G5/2 E5/4 G5/4', 'A5/4 G5/4 E5/4 C6/4',
      'B5/6 D6/2 G6/8', 'F#6/4 E6/2 D6/2 A5/8', 'C6/4 B5/4 A5/4 G5/4', 'F#5/4 G5/4 A5/8'
    ]);
    // 후렴에서는 한 옥타브 아래 금관이 겹친다
    const brass2 = mel.filter((e) => e.s >= 192).map((e) => ({ ...e, m: e.m.map((x) => x - 12) }));
    const pump = [];
    ch.forEach((c, bar) => { const r = chord(c, 2)[0]; for (let i = 0; i < 8; i++) pump.push({ s: bar * 16 + i * 2, l: 2, m: [i % 2 ? r + 12 : r] }); });
    const D_ = [
      'k.h.s.h.k.k.s.h.', 'k.h.s.h.k.k.s.h.', 'k.h.s.h.k.k.s.h.', 'k.s.s.k.s.s.ssss'
    ];
    return {
      bpm: 150, bars: 20, timp: 40, echo: { time: 0.2, fb: 0.2, mix: 0.18 },
      tracks: [
        { inst: 'trumpet', vol: 0.6, send: 0.3, pan: 0.1, ev: mel },
        { inst: 'strings', vol: 0.3, send: 0.35, pan: -0.25, ev: mel },
        { inst: 'horn', vol: 0.35, send: 0.35, pan: 0.3, ev: brass2 },
        { inst: 'stabs', vol: 0.22, send: 0.25, pan: -0.15, ev: comp(ch, 3, [[0, 2], [3, 2], [6, 2], [8, 2], [11, 2], [14, 2]], (t) => [t[0], t[2], t[0] + 12]) },
        { inst: 'cello', vol: 0.5, send: 0.15, pan: 0.2, ev: pump }
      ],
      drums: drums(['c.h.s.h.k.k.s.h.', ...D_.slice(1), ...D_, ...D_, 'c.h.s.h.k.k.s.h.', ...D_.slice(1), ...D_]),
      dvol: 0.5
    };
  }

  // 수도원 지하 1층: 느리고 은은하게. D단조, 낮게 깔린 지속음 위로 띄엄띄엄 울리는 종소리.
  function songDungeon1() {
    const ch = ['Dm', 'A#', 'Gm', 'A', 'Dm', 'F', 'Gm', 'A'];
    const mel = bars([
      '-/4 A5/4 D6/4 A5/4', 'F5/12 -/4', '-/4 G5/4 A#5/4 D6/4', 'C#6/12 -/4',
      '-/4 F5/4 E5/4 D5/4', 'C5/12 -/4', '-/4 D5/4 G5/4 A#5/4', 'A5/16'
    ]);
    // 물방울: 정해 둔 자리에서 높은 음이 똑 떨어진다
    const drip = [[5, 'A6'], [27, 'D7'], [58, 'F6'], [83, 'A6'], [101, 'E7'], [122, 'D7']].map(([s, n]) => ({ s, l: 1, m: [midi(n)] }));
    return {
      bpm: 64, bars: 8, timp: 38, echo: { time: 0.56, fb: 0.5, mix: 0.45 },
      tracks: [
        { inst: 'piano', vol: 1.2, send: 0.6, pan: 0.1, ev: mel },
        { inst: 'celesta', vol: 0.14, send: 0.8, pan: 0.45, ev: drip },
        { inst: 'strings', vol: 0.2, send: 0.55, pan: -0.2, ev: comp(ch, 3, [[0, 16]], (t) => t.slice(0, 3)) },
        { inst: 'harp', vol: 0.14, send: 0.6, pan: -0.4, ev: arp(ch, 4, [0, 2, 1, 2, 4, 2, 1, 2], 2) },
        { inst: 'bassLong', vol: 0.16, send: 0.3, pan: 0.15, ev: comp(ch, 2, [[0, 16]], (t) => [t[0]]) }
      ],
      drums: drums(times(8, ['t...............'])),
      dvol: 0.25
    };
  }

  // 수도원 지하 2층: 웅장하게. C단조, 오르간 화음과 팀파니 위로 금관 선율.
  function songDungeon2() {
    const ch = ['Cm', 'G#', 'A#', 'G', 'Cm', 'G#', 'Fm', 'G', 'G#', 'A#', 'D#', 'Cm', 'Fm', 'G', 'Cm', 'G'];
    const mel = bars([
      'C5/8 D#5/4 G5/4', 'G#5/8 G5/4 D#5/4', 'F5/6 D#5/2 D5/4 A#4/4', 'B4/8 D5/4 G5/4',
      'C6/8 A#5/4 G5/4', 'G#5/6 G5/2 F5/4 D#5/4', 'F5/4 G#5/4 C6/4 F6/4', 'D6/8 B5/8',
      'D#6/6 C6/2 G#5/8', 'D6/6 A#5/2 F5/8', 'G5/4 A#5/4 D#6/8', 'D#6/4 D6/4 C6/8',
      'C6/4 G#5/4 F5/4 G#5/4', 'B5/8 D6/8', 'C6/12 G5/4', 'B5/4 D6/4 G6/8'
    ]);
    const counter = mel.map((e) => ({ ...e, m: e.m.map((x) => x - 12) }));
    const bass = comp(ch, 2, [[0, 4], [4, 4], [8, 4], [12, 4]], (t) => [t[0] - 12, t[0]]);
    const D_ = ['t.......t.......', 't.......t.......', 't.......t.......', 't.......t...tttt'];
    return {
      bpm: 78, bars: 16, timp: 36, echo: { time: 0.38, fb: 0.38, mix: 0.35 },
      tracks: [
        { inst: 'strings', vol: 0.55, send: 0.45, pan: -0.2, ev: mel },
        { inst: 'trumpet', vol: 0.3, send: 0.5, pan: 0.15, ev: mel },
        { inst: 'horn', vol: 0.25, send: 0.5, pan: 0.3, ev: counter },
        { inst: 'organ', vol: 0.16, send: 0.55, ev: comp(ch, 3, [[0, 8], [8, 8]], (t) => [t[0], t[1], t[2], t[0] + 12]) },
        { inst: 'choir', vol: 0.3, send: 0.6, pan: -0.1, ev: comp(ch, 4, [[0, 16]], (t) => [t[1], t[2]]) },
        { inst: 'contrabass', vol: 0.28, send: 0.25, pan: 0.1, ev: bass }
      ],
      drums: drums(['c.......t.......', ...D_.slice(1), ...D_, 'c.......t.......', ...D_.slice(1), ...D_]),
      dvol: 0.6
    };
  }

  // 수도사 묘지: 음침하게. E 프리지아(반음 내려가는 F), 아주 느린 심장 박동 위로 낮은 합창과 금 간 종소리.
  function songCrypt() {
    const ch = ['Em', 'F', 'Em', 'Dm', 'Em', 'F', 'Am', 'B7'];
    const mel = bars([
      '-/8 B4/4 C5/4', 'B4/12 -/4', '-/4 E5/4 F5/4 E5/4', 'D5/12 -/4',
      '-/8 G4/4 A4/4', 'C5/6 B4/2 A4/8', '-/4 A4/4 C5/4 E5/4', 'D#5/16'
    ]);
    const toll = [[0, 'E3'], [32, 'E3'], [64, 'E3'], [96, 'B2']].map(([s, n]) => ({ s, l: 16, m: [midi(n)] }));
    const creak = [[13, 'F6'], [45, 'A#6'], [77, 'F6'], [109, 'B6']].map(([s, n]) => ({ s, l: 1, m: [midi(n)] }));
    return {
      bpm: 54, bars: 8, timp: 40, echo: { time: 0.72, fb: 0.55, mix: 0.5 },
      tracks: [
        { inst: 'choir', vol: 0.45, send: 0.7, pan: 0.1, ev: mel },
        { inst: 'bells', vol: 0.3, send: 0.8, pan: -0.3, ev: toll },
        { inst: 'celesta', vol: 0.1, send: 0.9, pan: 0.45, ev: creak },
        { inst: 'strings', vol: 0.16, send: 0.6, pan: -0.15, ev: comp(ch, 3, [[0, 16]], (t) => [t[0], t[1]]) },
        { inst: 'bassLong', vol: 0.2, send: 0.3, ev: comp(ch, 2, [[0, 16]], (t) => [t[0] - 12, t[0]]) }
      ],
      drums: drums(times(8, ['t..t............'])),
      dvol: 0.3
    };
  }

  // 전투: 빠르고 박진감 있게. A단조 168 BPM, 16분 하이햇과 몰아치는 킥·스네어, 마디 끝마다 탐 연타.
  function songBattle() {
    const ch = ['Am', 'Am', 'Am', 'F', 'G', 'Em', 'Am', 'F', 'G', 'E', 'Dm', 'Am', 'Dm', 'E', 'F', 'E'];
    const mel = bars([
      'A4+E5/2 -/2 A4+E5/2 -/4 A4+E5/2 -/2 G4+D5/2', 'A4+E5/2 -/2 A4+E5/2 -/4 C5+G5/3 D5+A5/3',
      'A5/3 E5/3 A5/2 C6/4 B5/4', 'A5/3 F5/3 C5/2 F5/4 A5/4', 'B5/3 G5/3 D5/2 G5/4 B5/4', 'E6/8 D6/4 B5/4',
      'A5/3 E5/3 A5/2 C6/4 E6/4', 'F6/6 E6/2 D6/4 C6/4', 'D6/6 C6/2 B5/4 G5/4', 'G#5/8 B5/4 E6/4',
      'D6/6 F6/2 A5/8', 'C6/6 E6/2 A5/8', 'F6/4 E6/4 D6/4 F6/4', 'E6/8 G#5/8',
      'A5/4 C6/4 F6/4 E6/2 D6/2', 'E6/2 -/2 E6/2 -/2 B5/2 G#5/2 E5/4'
    ]);
    const low = mel.filter((e) => e.s >= 32).map((e) => ({ ...e, m: e.m.map((x) => x - 12) }));
    const bass = [];
    ch.forEach((c, bar) => {
      const r = chord(c, 2)[0];
      [0, 0, 12, 0, 0, 12, 7, 12].forEach((d, i) => bass.push({ s: bar * 16 + i * 2, l: 2, m: [r + d] }));
    });
    const beat = 'k..ks.k.k.k.s..k', fill = 'k.s.rrr.rrr.ssss', hat = 'hhhohhhohhhohhho';
    const ks = ch.map((c, i) => (i % 4 === 3 ? fill : beat));
    const hats = ch.map((c, i) => ([2, 10].includes(i) ? 'c' + hat.slice(1) : i % 4 === 3 ? 'hhhohhho........' : hat));
    return {
      bpm: 168, bars: 16, timp: 33, fadeIn: 0.15, echo: { time: 0.18, fb: 0.15, mix: 0.12 },
      tracks: [
        { inst: 'trumpet', vol: 0.6, send: 0.25, pan: 0.1, ev: mel },
        { inst: 'strings', vol: 0.4, send: 0.3, pan: -0.3, ev: mel },
        { inst: 'horn', vol: 0.36, send: 0.3, pan: 0.3, ev: low },
        { inst: 'stabs', vol: 0.26, send: 0.2, pan: -0.1, ev: comp(ch, 3, [[0, 2], [3, 2], [6, 2], [10, 2], [12, 2]], (t) => [t[0], t[2], t[0] + 12]) },
        { inst: 'cello', vol: 0.55, send: 0.12, pan: 0.15, ev: bass }
      ],
      drums: drums(ks).concat(drums(hats)),
      dvol: 0.5
    };
  }

  // 승리 팡파레: 짧게 한 번만. C장조, 따따따 따—안, A♭·B♭를 지나 C로 끝난다.
  function songVictory() {
    return {
      bpm: 132, bars: 4, timp: 36, once: true, fadeIn: 0.05, echo: { time: 0.23, fb: 0.25, mix: 0.25 },
      tracks: [
        { inst: 'trumpet', vol: 0.7, send: 0.35, pan: 0.1, ev: bars(['G5/1 -/1 G5/1 -/1 G5/1 -/1 C6/6 A#5/4', 'G#5/4 A#5/4 C6/4 -/1 A#5/1 C6/2', 'C6/12 -/4', '-/16']) },
        { inst: 'horn', vol: 0.42, send: 0.35, pan: -0.2, ev: bars(['E5/1 -/1 E5/1 -/1 E5/1 -/1 G5/6 F5/4', 'D#5/4 F5/4 G5/4 -/1 F5/1 G5/2', 'E5/12 -/4', '-/16']) },
        { inst: 'harp', vol: 0.3, send: 0.5, pan: -0.35, ev: arp(['C', 'C', 'C'], 4, [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 5], 1).filter((e) => e.s >= 32) },
        { inst: 'trombone', vol: 0.4, send: 0.3, pan: 0.25, ev: bars(['C3/12 C3/2 D3/2', 'G#2/4 A#2/4 C3/8', 'C3/12 -/4', '-/16']) }
      ],
      drums: drums(['k.s.s.c.........', 'k...k...k.s.ssss', 'c...............', '................']),
      dvol: 0.55
    };
  }

  // 시작 화면: 웅장하고 신비롭게. D단조 72 BPM. 하프와 합창으로 조용히 열고, 뒤 절반은 현악·트럼펫이 선율을 크게 펼친다.
  function songTitle() {
    const ch = ['Dm', 'A#', 'Gm', 'A', 'Dm', 'F', 'C', 'A', 'A#', 'F', 'Gm', 'Dm', 'A#', 'C', 'A', 'A'];
    const mel = bars([
      '-/4 A4/4 D5/4 E5/4', 'F5/12 E5/2 D5/2', 'D5/8 C5/4 A#4/4', 'A4/16',
      '-/4 A4/4 D5/4 F5/4', 'A5/12 G5/2 F5/2', 'G5/8 E5/4 C5/4', 'E5/8 C#5/8',
      'D6/8 F6/4 D6/4', 'C6/12 A5/4', 'A#5/6 A5/2 G5/4 A#5/4', 'A5/16',
      'D6/6 C6/2 A#5/4 D6/4', 'E6/8 C6/4 G5/4', 'C#6/8 E6/8', 'A5/16'
    ]);
    const quiet = mel.filter((e) => e.s < 128), grand = mel.filter((e) => e.s >= 128);
    const sparkle = [[6, 'A6'], [22, 'F6'], [38, 'D7'], [54, 'C#7'], [70, 'A6'], [86, 'C7'], [102, 'G6'], [118, 'E7']].map(([s, n]) => ({ s, l: 1, m: [midi(n)] }));
    const toll = [0, 64, 128, 192].map((s) => ({ s, l: 16, m: [midi('D4')] }));
    const calm = 't...............', roll = 't.......t.t.tttt';
    return {
      bpm: 72, bars: 16, timp: 38, echo: { time: 0.5, fb: 0.4, mix: 0.4 },
      tracks: [
        { inst: 'horn', vol: 0.5, send: 0.55, pan: 0.15, ev: quiet },
        { inst: 'strings', vol: 0.55, send: 0.5, pan: -0.2, ev: grand },
        { inst: 'trumpet', vol: 0.28, send: 0.5, pan: 0.2, ev: grand },
        { inst: 'horn', vol: 0.3, send: 0.5, pan: 0.35, ev: grand.map((e) => ({ ...e, m: e.m.map((x) => x - 12) })) },
        { inst: 'harp', vol: 0.2, send: 0.6, pan: -0.4, ev: arp(ch, 3, [0, 1, 2, 4, 5, 4, 2, 1], 2) },
        { inst: 'choir', vol: 0.3, send: 0.65, ev: comp(ch, 4, [[0, 16]], (t) => t.slice(0, 3)) },
        { inst: 'celesta', vol: 0.14, send: 0.8, pan: 0.45, ev: sparkle },
        { inst: 'bells', vol: 0.22, send: 0.8, pan: -0.25, ev: toll },
        { inst: 'bassLong', vol: 0.2, send: 0.3, ev: comp(ch, 2, [[0, 16]], (t) => [t[0]]) }
      ],
      drums: drums([calm, '................', calm, roll, calm, '................', calm, roll,
        'c...............', calm, calm, roll, 'c...............', calm, calm, roll]),
      dvol: 0.5
    };
  }

  const SONGS = { title: songTitle, town: songTown, field: songField, dungeon1: songDungeon1, dungeon2: songDungeon2, crypt: songCrypt, battle: songBattle, victory: songVictory };
  const SCENES = { town: 'town', field: 'field', b1: 'dungeon1', b2: 'dungeon2', crypt: 'crypt' };
  const cache = {};
  const song = (name) => cache[name] || (cache[name] = SONGS[name]());
  // 곡에 필요한 악기 파일 이름들 (타악기 포함)
  const needs = (name) => [...new Set(song(name).tracks.map((tr) => INST[tr.inst] && INST[tr.inst].sf).concat(['taiko', 'timpani']).filter(Boolean))];

  // ---------- 악기 ----------
  const waves = new WeakMap();
  function pulseWave(ctx, duty) {
    let w = waves.get(ctx);
    if (!w) waves.set(ctx, (w = {}));
    if (w[duty]) return w[duty];
    const N = 48, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    return (w[duty] = ctx.createPeriodicWave(re, im));
  }
  function noiseBuf(ctx) {
    let w = waves.get(ctx);
    if (!w) waves.set(ctx, (w = {}));
    if (w.noise) return w.noise;
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    let x = 1;
    for (let i = 0; i < d.length; i++) { x = (x * 16807) % 2147483647; d[i] = (x / 2147483647) * 2 - 1; }
    return (w.noise = b);
  }

  // ---------- 실제 악기 (사운드폰트) ----------
  // instruments/<이름>.js 가 window.SOUNDFONT[이름] = { MIDI번호: base64 mp3 } 를 넣는다. 세 반음마다 한 음씩만 있고 사이는 음높이를 옮겨 쓴다.
  const base = (document.currentScript && document.currentScript.src || '').replace(/[^/]*$/, '');
  const SAMPLE_GAIN = 7; // 녹음이 작게 담겨 있어 키운다
  const SF = {}; // 이름 → { keys: [MIDI...], buf: {MIDI: AudioBuffer} }
  const sfLoading = {};
  function loadScript(src) {
    return new Promise((ok, fail) => {
      const el = document.createElement('script');
      el.src = src; el.onload = ok; el.onerror = fail;
      document.head.append(el);
    });
  }
  function b64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  function loadInst(name, ac) {
    if (SF[name]) return Promise.resolve(SF[name]);
    if (sfLoading[name]) return sfLoading[name];
    const got = window.SOUNDFONT && window.SOUNDFONT[name] ? Promise.resolve() : loadScript(base + 'instruments/' + name + '.js');
    return (sfLoading[name] = got.then(() => {
      const raw = window.SOUNDFONT[name], keys = Object.keys(raw).map(Number).sort((a, b) => a - b), buf = {};
      return Promise.all(keys.map((k) => new Promise((ok) => ac.decodeAudioData(b64(raw[k]), (b) => { buf[k] = b; ok(); }, () => ok()))))
        .then(() => { delete window.SOUNDFONT[name]; return (SF[name] = { keys: keys.filter((k) => buf[k]), buf }); });
    }).catch(() => { delete sfLoading[name]; return null; }));
  }
  const loadAll = (names, ac) => Promise.all(names.map((n) => loadInst(n, ac)));

  // 샘플 한 음. 녹음(약 3초)보다 긴 음은 뒷부분을 겹쳐 이어 붙여 늘인다.
  function sampleNote(ctx, out, p, t, dur, m, vol) {
    const sf = SF[p.sf];
    if (!sf || !sf.keys.length) return false;
    let k = sf.keys[0];
    for (const x of sf.keys) if (Math.abs(x - m) < Math.abs(k - m)) k = x;
    const buf = sf.buf[k], rate = Math.pow(2, (m - k) / 12);
    vol *= SAMPLE_GAIN;
    const g = ctx.createGain();
    let tail = g;
    if (p.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.lp; g.connect(f); tail = f; }
    tail.connect(out);
    const len = buf.duration / rate; // 이 음높이에서 녹음 길이
    if (p.perc) { // 뜯고 치는 악기: 저절로 사라지게 둔다
      const end = t + Math.min(len, p.max || len);
      g.gain.setValueAtTime(vol, t);
      if (p.max) g.gain.setTargetAtTime(0, t + Math.max(dur, p.max * 0.6), 0.15);
      const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
      src.connect(g); src.start(t); src.stop(end + 0.5);
      return true;
    }
    const rel = Math.max(t + dur, t + 0.05);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + (p.a || 0.01));
    g.gain.setTargetAtTime(0, rel, (p.r || 0.3) / 3);
    const stop = rel + (p.r || 0.3) * 2;
    // 녹음을 0.4초 겹치며 이어 친다 (두 번째부터는 앞의 0.8초를 건너뛴다)
    const seg = Math.max(0.6, len - 0.9), xf = 0.4;
    let at = t, off = 0, first = true;
    while (at < stop) {
      const src = ctx.createBufferSource(), sg = ctx.createGain();
      src.buffer = buf; src.playbackRate.value = rate;
      src.connect(sg); sg.connect(g);
      const segLen = first ? seg : seg - 0.8 / rate;
      if (!first) { sg.gain.setValueAtTime(0, at); sg.gain.linearRampToValueAtTime(1, at + xf); }
      const fadeAt = at + segLen;
      if (fadeAt < stop) { sg.gain.setValueAtTime(1, fadeAt); sg.gain.linearRampToValueAtTime(0, fadeAt + xf); }
      src.start(at, off); src.stop(Math.min(stop, fadeAt + xf) + 0.02);
      at = fadeAt; off = 0.8; first = false;
    }
    return true;
  }

  // 홀 잔향: 잡음을 지수적으로 줄여 만든 임펄스 응답
  const irs = new WeakMap();
  function hallIR(ctx, sec) {
    if (irs.has(ctx)) return irs.get(ctx);
    const sr = ctx.sampleRate, n = Math.floor(sr * sec), b = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let x = 7 + c * 13;
      for (let i = 0; i < n; i++) {
        x = (x * 16807) % 2147483647;
        const pre = i < sr * 0.012 ? 0 : 1;
        d[i] = pre * ((x / 2147483647) * 2 - 1) * Math.pow(1 - i / n, 2.2) * Math.exp(-i / (sr * 0.9));
      }
    }
    irs.set(ctx, b);
    return b;
  }

  // 악기 설정: wave(파형), a/d/s/r(엔벨로프), vib(떨림), lp(저역 필터), detune(겹친 음)
  const INST = {
    // 실제 악기: sf(파일), vol(파일마다 소리 크기 맞춤), a/r(시작·끝), perc(저절로 사라짐), max(최대 길이), lp(저역 필터)
    piano: { sf: 'piano', perc: true, vol: 0.9 },
    flute: { sf: 'flute', a: 0.04, r: 0.25, vol: 0.8 },
    harp: { sf: 'harp', perc: true, vol: 0.9 },
    pizz: { sf: 'pizz', perc: true, vol: 1 },
    strings: { sf: 'strings', a: 0.12, r: 0.6, vol: 0.7 },
    stabs: { sf: 'brass', a: 0.01, r: 0.12, vol: 0.6 },
    cello: { sf: 'cello', a: 0.02, r: 0.15, vol: 0.8 },
    contrabass: { sf: 'contrabass', a: 0.03, r: 0.3, vol: 0.9 },
    bassLong: { sf: 'contrabass', a: 0.8, r: 1.2, vol: 0.9, lp: 900 },
    horn: { sf: 'horn', a: 0.05, r: 0.35, vol: 0.8 },
    trombone: { sf: 'trombone', a: 0.04, r: 0.3, vol: 0.7 },
    trumpet: { sf: 'trumpet', a: 0.02, r: 0.25, vol: 0.6 },
    choir: { sf: 'choir', a: 0.3, r: 0.9, vol: 0.8 },
    organ: { sf: 'organ', a: 0.08, r: 0.5, vol: 0.5 },
    celesta: { sf: 'celesta', perc: true, vol: 0.9 },
    bells: { sf: 'bells', perc: true, vol: 0.8 },
    timpani: { sf: 'timpani', perc: true, vol: 1 },
    taiko: { sf: 'taiko', perc: true, vol: 1 },
    // 악기 파일을 못 불러왔을 때 대신 쓰는 합성음
    soft: { wave: 'triangle', a: 0.02, d: 0.3, s: 0.4, r: 0.3 }
  };

  function voice(ctx, out, inst, t, dur, m, vol) {
    let p = INST[inst];
    if (p.sf) { if (sampleNote(ctx, out, p, t, dur, m, vol * (p.vol || 1))) return; p = INST.soft; vol *= 0.4; }
    const g = ctx.createGain();
    let tail = g;
    if (p.lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(p.lp, t);
      if (p.lpEnv) { f.frequency.setValueAtTime(p.lp - p.lpEnv * 0.6, t); f.frequency.linearRampToValueAtTime(p.lp + p.lpEnv * 0.4, t + 0.06); f.frequency.linearRampToValueAtTime(p.lp, t + 0.25); }
      g.connect(f); tail = f;
    }
    tail.connect(out);
    const sus = vol * p.s;
    let stop;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + p.a);
    if (sus > 0) {
      const rel = Math.max(t + dur, t + p.a + 0.01);
      g.gain.setTargetAtTime(sus, t + p.a, p.d / 3);
      g.gain.setTargetAtTime(0, rel, p.r / 3);
      stop = rel + p.r * 1.5 + 0.05;
    } else { // 뜯는 소리: 음 길이와 상관없이 저절로 사라진다
      g.gain.setTargetAtTime(0, t + p.a, p.d / 3);
      stop = t + p.a + p.d * 1.5;
    }
    const f0 = hz(m);
    const oscs = [];
    const mk = (det) => {
      const o = ctx.createOscillator();
      if (typeof p.wave === 'number') o.setPeriodicWave(pulseWave(ctx, p.wave)); else o.type = p.wave;
      o.frequency.value = f0; o.detune.value = det;
      o.connect(g); oscs.push(o);
    };
    if (p.detune) { mk(-p.detune); mk(p.detune); } else mk(0);
    if (p.bell) { // 종: 높은 배음을 살짝 섞는다
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.value = f0 * 2.76; og.gain.setValueAtTime(vol * 0.5, t); og.gain.setTargetAtTime(0, t, 0.08);
      o.connect(og); og.connect(out); o.start(t); o.stop(stop);
    }
    if (p.vib) { // 떨림: 음이 길 때만 조금 늦게 들어간다
      const [rate, cents, delay] = p.vib;
      if (dur > delay + 0.1) {
        const l = ctx.createOscillator(), lg = ctx.createGain();
        l.frequency.value = rate; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(cents, t + delay + 0.2);
        l.connect(lg); oscs.forEach((o) => lg.connect(o.detune)); l.start(t); l.stop(stop);
      }
    }
    oscs.forEach((o) => { o.start(t); o.stop(stop); });
  }

  function drum(ctx, out, kind, t, vol, timp) {
    // 큰북(k)·탐(r)은 타이코, 팀파니(t)는 곡의 으뜸음으로 진짜 녹음을 쓴다
    if (kind === 'k' && sampleNote(ctx, out, INST.taiko, t, 0.4, 36, vol * 1.6)) return;
    if (kind === 'r' && sampleNote(ctx, out, INST.taiko, t, 0.3, 45, vol * 1.2)) return;
    if (kind === 't' && sampleNote(ctx, out, INST.timpani, t, 1, timp || 36, vol * 1.5)) return;
    if (kind === 'h') vol *= 0.5; // 하이햇은 셰이커처럼 작게
    const g = ctx.createGain();
    g.connect(out);
    if (kind === 'r') { // 탐: 짧게 내려가는 음
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.14);
      g.gain.setValueAtTime(vol * 1.1, t); g.gain.setTargetAtTime(0, t + 0.01, 0.09);
      o.connect(g); o.start(t); o.stop(t + 0.6);
      return;
    }
    if (kind === 'k' || kind === 't') { // 킥, 팀파니: 내려가는 사인파
      const o = ctx.createOscillator();
      const tim = kind === 't';
      o.type = tim ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(tim ? 110 : 150, t);
      o.frequency.exponentialRampToValueAtTime(tim ? 62 : 42, t + (tim ? 0.35 : 0.12));
      g.gain.setValueAtTime(vol * (tim ? 0.9 : 1), t);
      g.gain.setTargetAtTime(0, t + 0.01, tim ? 0.32 : 0.07);
      o.connect(g); o.start(t); o.stop(t + (tim ? 1.6 : 0.5));
      if (!tim) return;
    }
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf(ctx);
    const f = ctx.createBiquadFilter();
    const set = {
      s: ['bandpass', 1800, 0.8, 0.07, 0.5], h: ['highpass', 7000, 1, 0.018, 0.18], o: ['highpass', 6500, 1, 0.09, 0.18],
      c: ['highpass', 4000, 0.6, 0.9, 0.35], t: ['lowpass', 300, 1, 0.12, 0.25]
    }[kind];
    if (!set) return;
    f.type = set[0]; f.frequency.value = set[1]; f.Q.value = set[2];
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * set[4], t);
    ng.gain.setTargetAtTime(0, t + 0.005, set[3]);
    n.connect(f); f.connect(ng); ng.connect(out);
    n.start(t, Math.random() * 0.5); n.stop(t + set[3] * 8 + 0.1);
    if (kind === 's') { // 스네어 몸통
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
      g.gain.setValueAtTime(vol * 0.5, t); g.gain.setTargetAtTime(0, t, 0.04);
      o.connect(g); o.start(t); o.stop(t + 0.3);
    }
  }

  // ---------- 믹서 ----------
  // 곡 하나를 버스로 만든다: 트랙 → (곡 음량) → 마스터, 일부는 메아리(딜레이)로
  function makeBus(ctx, master, sg) {
    const bus = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    // 홀 잔향 (곡의 echo.time 이 길수록 넓은 공간)
    const rv = ctx.createConvolver(), lp = ctx.createBiquadFilter();
    rv.buffer = hallIR(ctx, 2.8); lp.type = 'lowpass'; lp.frequency.value = 5000;
    wet.connect(rv); rv.connect(lp);
    const wetOut = ctx.createGain(); wetOut.gain.value = 0.35 + sg.echo.mix;
    lp.connect(wetOut); wetOut.connect(bus); dry.connect(bus); bus.connect(master);
    const trackOuts = sg.tracks.map((tr) => {
      const g = ctx.createGain(), s = ctx.createGain();
      g.gain.value = 1; s.gain.value = tr.send || 0;
      let o = g;
      if (tr.pan && ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = tr.pan; g.connect(pn); o = pn; }
      o.connect(dry); o.connect(s); s.connect(wet);
      return g;
    });
    const drumOut = ctx.createGain(); drumOut.gain.value = sg.dvol || 0.4; drumOut.connect(dry);
    const ds = ctx.createGain(); ds.gain.value = 0.15; drumOut.connect(ds); ds.connect(wet);
    return { bus, trackOuts, drumOut };
  }

  // 한 칸(16분음표) 범위 [a, b) 의 소리를 t0 기준으로 예약한다
  function scheduleSteps(ctx, sg, mix, a, b, t0, stepDur) {
    sg.tracks.forEach((tr, i) => {
      for (const e of tr.ev) {
        if (e.s < a || e.s >= b) continue;
        const t = t0 + (e.s - a) * stepDur;
        for (const m of e.m) voice(ctx, mix.trackOuts[i], tr.inst, t, e.l * stepDur * 0.95, m, tr.vol / Math.sqrt(e.m.length));
      }
    });
    for (const d of sg.drums) if (d.s >= a && d.s < b) drum(ctx, mix.drumOut, d.d, t0 + (d.s - a) * stepDur, 0.5, sg.timp);
  }

  // ---------- 재생 ----------
  let ctx = null, master = null, cur = null, want = null;
  let sceneSong = null, fight = null; // 지금 장면의 곡, 전투 중이면 'battle'/'victory'
  let muted = false, volume = 0.75; // volume 0~1, 처음엔 예전보다 조금 작게
  try {
    muted = localStorage.getItem('dungeon-bgm-muted') === '1';
    const v = parseFloat(localStorage.getItem('dungeon-bgm-volume'));
    if (v >= 0 && v <= 1) volume = v;
  } catch (e) { /* 저장소 없음 */ }
  const MAX_GAIN = 0.7;
  const level = () => (muted ? 0 : MAX_GAIN * volume * volume); // 귀에 고르게 들리도록 제곱

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp_ = ctx.createDynamicsCompressor();
    comp_.threshold.value = -14; comp_.ratio.value = 3;
    master = ctx.createGain(); master.gain.value = level();
    master.connect(comp_); comp_.connect(ctx.destination);
    return ctx;
  }

  function start(name) {
    if (!ctx || ctx.state !== 'running') return;
    const miss = needs(name).filter((n) => !SF[n]);
    if (miss.length) { // 악기 파일을 다 받은 뒤에 시작한다 (그 사이 다른 곡으로 바뀌면 그만둔다)
      cur = { name, mix: null, loading: true };
      const mine = cur;
      loadAll(miss, ctx).then(() => { if (cur === mine) { cur = null; start(name); preloadRest(); } });
      return;
    }
    const sg = song(name);
    const mix = makeBus(ctx, master, sg);
    const stepDur = 60 / sg.bpm / 4, total = sg.bars * 16;
    const now = ctx.currentTime + 0.08;
    mix.bus.gain.setValueAtTime(0, now);
    mix.bus.gain.linearRampToValueAtTime(1, now + (sg.fadeIn || 1.2));
    const p = { name, sg, mix, step: 0, t: now };
    p.timer = setInterval(() => {
      // 앞으로 0.25초 분량을 미리 예약한다
      while (p.t < ctx.currentTime + 0.25) {
        scheduleSteps(ctx, sg, mix, p.step, p.step + 1, p.t, stepDur);
        p.step = (p.step + 1) % total; p.t += stepDur;
        if (sg.once && p.step === 0) { clearInterval(p.timer); break; } // 팡파레처럼 한 번만 치는 곡
      }
    }, 40);
    cur = p;
  }
  // 지금 곡이 시작되면 나머지 곡의 악기도 하나씩 미리 받아 둔다
  let preloaded = false;
  function preloadRest() {
    if (preloaded) return;
    preloaded = true;
    const all = [...new Set(Object.keys(SONGS).flatMap(needs))];
    all.reduce((pr, n) => pr.then(() => loadInst(n, ctx)), Promise.resolve());
  }
  function fadeOut(p, sec) {
    if (!p || !p.mix) return;
    clearInterval(p.timer);
    const t = ctx.currentTime;
    p.mix.bus.gain.cancelScheduledValues(t);
    p.mix.bus.gain.setValueAtTime(p.mix.bus.gain.value, t);
    p.mix.bus.gain.linearRampToValueAtTime(0, t + (sec || 0.8));
    setTimeout(() => p.mix.bus.disconnect(), 3500);
  }

  function play(name) {
    if (name && !SONGS[name]) return;
    want = name || null;
    if (cur && cur.name === want) return;
    if (!ctx || ctx.state !== 'running') return; // 첫 입력 때 시작
    fadeOut(cur, want && song(want).fadeIn ? 0.25 : 0.8); cur = null; // 전투곡은 바로 끊고 들어간다
    if (want) start(want);
  }

  function applyLevel() {
    if (master) { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(level(), ctx.currentTime, 0.08); }
    if (btn) {
      btn.textContent = muted || volume === 0 ? '♪̸' : '♪';
      btn.setAttribute('aria-pressed', String(!muted));
      btn.title = muted ? '배경음악 켜기 (M)' : '배경음악 끄기 (M)';
    }
    if (slider) { slider.value = String(Math.round(volume * 100)); slider.style.opacity = muted ? '0.4' : '1'; }
  }
  function setMuted(v) {
    muted = !!v;
    try { localStorage.setItem('dungeon-bgm-muted', muted ? '1' : '0'); } catch (e) { /* 저장소 없음 */ }
    applyLevel();
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, +v || 0));
    try { localStorage.setItem('dungeon-bgm-volume', String(volume)); } catch (e) { /* 저장소 없음 */ }
    if (muted && volume > 0) setMuted(false); else applyLevel();
  }

  // 아이폰은 Web Audio 를 '무음 모드 스위치를 따르는 효과음'으로 취급해, 무음 모드면 배경음악이 안 들린다.
  // 음악 재생(playback)으로 알리고, 그 기능이 없는 옛 iOS 는 소리 없는 <audio> 를 같이 틀어 재생 모드로 바꾼다.
  let silent = null;
  function silentWav() {
    const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, t) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    b.fill(128, 44);
    let bin = ''; b.forEach((x) => (bin += String.fromCharCode(x)));
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function playbackMode() {
    try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; } } catch (e) { /* 지원 안 함 */ }
    if (!/iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return;
    if (!silent) {
      silent = document.createElement('audio');
      silent.setAttribute('x-webkit-airplay', 'deny');
      silent.preload = 'auto'; silent.loop = true; silent.src = silentWav();
    }
    if (silent.paused) silent.play().catch(() => {});
  }

  // 브라우저 자동재생 제한: 첫 터치·클릭·키 입력에서 소리를 연다.
  // 폰에서는 손을 뗄 때(touchend·click)만 '사용자 동작'으로 쳐 주므로 매 입력마다 다시 시도한다.
  // 다른 앱·전화로 끊기면(interrupted) 화면으로 돌아오거나 다음에 누를 때 다시 켠다.
  let wakeEvent = null; // 소리를 처음 깨운 입력 (시작 화면에서 그 입력은 음악만 켠다)
  function unlock(ev) {
    const was = !!ctx && ctx.state === 'running';
    if (!ensure()) return;
    if (!was && !wakeEvent) wakeEvent = ev || true;
    playbackMode();
    const go = () => { if (want && (!cur || cur.name !== want)) { fadeOut(cur); cur = null; start(want); } };
    if (ctx.state === 'running') go(); else ctx.resume().then(go, () => {});
  }
  ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'mousedown', 'click'].forEach((ev) =>
    window.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { if (silent) silent.pause(); ctx.suspend().catch(() => {}); }
    else unlock();
  });
  window.addEventListener('pageshow', () => { if (ctx && !document.hidden) unlock(); });
  window.addEventListener('keydown', (e) => {
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA/.test(e.target.tagName)) setMuted(!muted);
  });

  // 오른쪽 아래: ♪ 켜기/끄기 버튼 + 음량 막대
  let btn = null, slider = null;
  function addButton() {
    const box = document.createElement('div');
    box.id = 'bgmControl';
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:50;display:flex;align-items:center;gap:6px;' +
      'padding:3px 12px 3px 3px;border-radius:20px;border:1px solid rgba(255,255,255,.25);background:rgba(10,10,14,.78)';
    btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'bgmToggle';
    btn.style.cssText = 'width:32px;height:32px;border-radius:50%;border:0;background:none;color:#e8dcc0;' +
      'font-size:18px;line-height:1;cursor:pointer;padding:0';
    btn.addEventListener('click', () => setMuted(!muted));
    slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '5';
    slider.setAttribute('aria-label', '배경음악 크기');
    slider.style.cssText = 'width:92px;margin:0;accent-color:#e9a23b;cursor:pointer';
    slider.addEventListener('input', () => setVolume(slider.value / 100));
    box.append(btn, slider);
    // 화면 위쪽 SAVE/LOAD/NEW 옆에 둔다 (넓은 화면에선 position:fixed 라 그대로 오른쪽 아래에 뜬다)
    (document.querySelector('.sys') || document.body).append(box);
    applyLevel();
  }
  if (document.body) addButton(); else document.addEventListener('DOMContentLoaded', addButton);

  // 미리 듣기·점검용: 곡 한 바퀴를 오프라인으로 그려 AudioBuffer로 돌려준다
  async function render(name, sampleRate, solo) {
    let sg = song(name);
    if (solo != null) sg = { ...sg, tracks: sg.tracks.filter((t, i) => i === solo), drums: solo < 0 ? sg.drums : [] }; // 점검용: 트랙 하나만
    const stepDur = 60 / sg.bpm / 4, total = sg.bars * 16;
    const sr = sampleRate || 44100;
    const off = new OfflineAudioContext(2, Math.ceil((total * stepDur + 3) * sr), sr);
    await loadAll(needs(name), off);
    const c = off.createDynamicsCompressor(); c.threshold.value = -14; c.ratio.value = 3;
    const m = off.createGain(); m.gain.value = 0.7; m.connect(c); c.connect(off.destination);
    scheduleSteps(off, sg, makeBus(off, m, sg), 0, total, 0.05, stepDur);
    return off.startRendering();
  }

  // ---------- 효과음 ----------
  // 전투 소리도 같은 방식으로 합성한다. 배경음악과 같은 음량·끄기 설정을 따른다.
  function tone(c, out, type, f0, f1, t, len, vol, curve) {
    const o = c.createOscillator(), g = c.createGain();
    if (typeof type === 'number') o.setPeriodicWave(pulseWave(c, type)); else o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len * (curve || 1));
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + len + 0.02);
  }
  function hiss(c, out, type, f0, f1, t, len, vol, q) {
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = noiseBuf(c);
    f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
    n.connect(f); f.connect(g); g.connect(out); n.start(t, Math.random() * 0.5); n.stop(t + len + 0.02);
  }
  const SFX = {
    // 아군 공격: 칼이 바람을 가르고 '퍽' 맞는다
    slash: (c, o, t) => { hiss(c, o, 'bandpass', 5000, 900, t, 0.13, 0.9, 2); tone(c, o, 'square', 220, 70, t + 0.08, 0.14, 0.35); hiss(c, o, 'lowpass', 1800, 200, t + 0.08, 0.12, 0.6); },
    // 급소: 더 세게, 끝에 높은 울림
    crit: (c, o, t) => { SFX.slash(c, o, t); tone(c, o, 'square', 1760, 1760, t + 0.1, 0.25, 0.12); tone(c, o, 'sawtooth', 160, 45, t + 0.08, 0.25, 0.35); },
    // 헛침·피함: 휙
    miss: (c, o, t) => hiss(c, o, 'bandpass', 2500, 6000, t, 0.18, 0.5, 3),
    dodge: (c, o, t) => hiss(c, o, 'bandpass', 4500, 1500, t, 0.2, 0.5, 3),
    // 방어: 방패의 '챙' 하는 쇳소리
    guard: (c, o, t) => { tone(c, o, 0.25, 1320, 1250, t, 0.35, 0.16); tone(c, o, 'square', 1975, 1900, t, 0.22, 0.07); hiss(c, o, 'highpass', 6000, 4000, t, 0.06, 0.5); },
    // 적의 공격: 낮고 묵직한 타격과 '으직'
    hit: (c, o, t) => { tone(c, o, 'sine', 140, 40, t, 0.25, 0.9); tone(c, o, 'square', 300, 60, t, 0.12, 0.3, 0.5); hiss(c, o, 'lowpass', 2500, 300, t, 0.18, 0.8); },
    // 방어한 채로 맞음: 쇳소리 + 약한 타격
    block: (c, o, t) => { SFX.guard(c, o, t); tone(c, o, 'sine', 120, 50, t, 0.15, 0.5); },
    // 공격 주문(불꽃): 올라가는 마력 소리 뒤에 '화르륵'
    fire: (c, o, t) => {
      [0, 4, 7, 12, 16].forEach((d, i) => tone(c, o, 0.125, hz(72 + d), hz(72 + d), t + i * 0.04, 0.12, 0.12));
      hiss(c, o, 'lowpass', 300, 3000, t + 0.18, 0.25, 0.7); hiss(c, o, 'lowpass', 3000, 200, t + 0.43, 0.5, 0.8);
      tone(c, o, 'sawtooth', 90, 40, t + 0.2, 0.6, 0.35);
    },
    // 회복 주문: 반짝이며 올라가는 맑은 소리
    heal: (c, o, t) => {
      [0, 4, 7, 12, 16, 19, 24].forEach((d, i) => { tone(c, o, 'triangle', hz(79 + d), hz(79 + d), t + i * 0.06, 0.5, 0.2); tone(c, o, 'sine', hz(91 + d), hz(91 + d), t + i * 0.06 + 0.03, 0.3, 0.06); });
      hiss(c, o, 'highpass', 8000, 9000, t, 0.6, 0.08);
    },
    // 발소리: 지상은 흙·풀 밟는 '척', 던전은 돌바닥 '탁' (번갈아 높낮이를 바꾼다)
    step: (c, o, t) => { const v = (stepAlt = !stepAlt) ? 1 : 0.85; hiss(c, o, 'bandpass', 1100 * v, 350, t, 0.08, 0.55, 1.5); tone(c, o, 'sine', 130 * v, 70, t, 0.06, 0.25); },
    stepStone: (c, o, t) => {
      const v = (stepAlt = !stepAlt) ? 1 : 0.88;
      hiss(c, o, 'bandpass', 2400 * v, 900, t, 0.05, 0.6, 2); tone(c, o, 'sine', 190 * v, 90, t, 0.07, 0.3);
      hiss(c, o, 'bandpass', 1800 * v, 700, t + 0.11, 0.05, 0.12, 2); // 돌방의 메아리
    },
    bump: (c, o, t) => { tone(c, o, 'sine', 110, 45, t, 0.25, 0.8); hiss(c, o, 'lowpass', 900, 120, t, 0.2, 0.6); },
    // 장소를 옮길 때
    enterTown: (c, o, t) => { [60, 64, 67, 72, 76, 79, 84, 88].forEach((m, i) => note(c, o, 'harp', t + i * 0.055, 0.6, m, 0.9)); },
    leaveTown: (c, o, t) => { [84, 79, 76, 72, 67, 64, 60, 55].forEach((m, i) => note(c, o, 'harp', t + i * 0.055, 0.6, m, 0.8)); hiss(c, o, 'bandpass', 3000, 600, t, 0.6, 0.25, 1); },
    enterDungeon: (c, o, t) => {
      [0, 0.16, 0.29, 0.39, 0.47, 0.54, 0.6].forEach((d, i) => note(c, o, 'timpani', t + d, 0.4, 36, 0.5 + i * 0.08));
      note(c, o, 'taiko', t + 0.75, 0.5, 33, 1.3); hiss(c, o, 'lowpass', 400, 80, t + 0.75, 1.2, 0.9); // 육중한 문이 닫힌다
      note(c, o, 'choir', t + 0.75, 1.6, 45, 0.5); note(c, o, 'choir', t + 0.75, 1.6, 52, 0.4);
    },
    leaveDungeon: (c, o, t) => { hiss(c, o, 'bandpass', 400, 4000, t, 0.7, 0.4, 0.8); [57, 60, 64, 69, 72].forEach((m, i) => note(c, o, 'harp', t + 0.2 + i * 0.07, 0.6, m, 0.8)); note(c, o, 'strings', t + 0.3, 1.2, 76, 0.4); },
    stairs: (c, o, t) => { for (let i = 0; i < 6; i++) SFX.stepStone(c, o, t + i * 0.2); note(c, o, 'timpani', t + 1.25, 0.6, 33, 0.7); },
    // 적이 쓰러짐
    down: (c, o, t) => { tone(c, o, 0.5, 440, 60, t, 0.35, 0.15); hiss(c, o, 'lowpass', 1200, 100, t, 0.35, 0.4); }
  };
  let sfxBus = null, stepAlt = false;
  // 효과음 안에서 진짜 악기 한 음 (악기 파일이 아직 없으면 조용히 넘어간다)
  function note(c, o, inst, t, dur, m, vol) { sampleNote(c, o, INST[inst], t, dur, m, 0.12 * vol); }
  function sfx(name) {
    if (!SFX[name] || !ensure() || ctx.state !== 'running') return;
    if (!sfxBus) { sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55; sfxBus.connect(master); }
    SFX[name](ctx, sfxBus, ctx.currentTime + 0.01);
  }

  window.BGM = {
    play,
    stop: () => play(null),
    town: () => play('town'), field: () => play('field'),
    dungeon1: () => play('dungeon1'), dungeon2: () => play('dungeon2'), crypt: () => play('crypt'),
    // 게임 장면 키(지역 town/field, 층 b1/b2)로 고른다. 모르는 키면 지금 곡을 이어 간다.
    scene: (key) => { if (key == null) sceneSong = null; else if (SCENES[key]) sceneSong = SCENES[key]; else return; if (!fight) play(sceneSong); },
    // 전투: 시작하면 전투곡, 이기면 팡파레, 끝나면 그 장면의 곡으로 돌아간다
    battle: () => { if (fight !== 'victory') { fight = 'battle'; play('battle'); } },
    victory: () => { fight = 'victory'; play('victory'); },
    battleEnd: () => { fight = null; play(sceneSong); },
    // 시작 화면: 열려 있는 동안 테마곡, 닫으면 장면 곡으로
    title: () => { fight = 'title'; play('title'); },
    titleEnd: () => { if (fight === 'title') { fight = null; play(sceneSong); } },
    wokeBy: (e) => !!e && e === wakeEvent,
    toggle: () => setMuted(!muted),
    setVolume,
    get volume() { return volume; },
    get muted() { return muted; },
    get current() { return cur ? cur.name : null; },
    songs: Object.keys(SONGS),
    sfx, // 효과음: slash crit miss guard hit block dodge fire heal down step stepStone bump enterTown leaveTown enterDungeon leaveDungeon stairs
    render
  };
})();
