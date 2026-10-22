// 던전 데이터: 맵, 아이템, 사건을 여기서만 정의한다. 엔진(engine.js)은 이 구조만 읽는다.
//
// 맵 기호
//   #  벽            .  통로
//   +  문 (지나갈 수 있음)
//   =  잠긴 문 (floor.locks 에 필요한 아이템 정의)
//   그 밖의 글자(a~z, <, > 등)  사건 칸. floor.events 에 같은 글자로 정의
//
// 방향: 0=북 1=동 2=남 3=서
//
// 사건(event)
//   name      미니맵·로그에 쓰는 이름
//   trigger   'step' 밟으면 발생 / 'search' 그 칸에서 [조사]해야 발생
//   hint      search 사건 칸을 밟았을 때 보여줄 한 줄
//   once      true 이면 effects 의 {done:true} 이후 다시 발생하지 않음
//   mark      'stairs-down' | 'stairs-up' 미니맵에 표시
//   prop      3D 소품 { type, vanish, glow }
//             type: backpack | well | ghost | bones | runes | altar | fountain | stairs-down | stairs-up
//             vanish: once 사건이 끝나면 소품을 치움 / glow: 사건이 끝나기 전까지 반짝임
//             barrier: '아이템' 그 아이템이 없으면 계단 앞에 푸른 결계를 그림
//   start     시작 페이지 id, 또는 [{when, page}] 목록 (위에서부터 첫 조건 일치)
//   pages     { id: { title, text, effects, choices:[{label, when, effects, next}] } }
//
// 조건(when): { has:'아이템', lacks:'아이템', flag:'플래그', noflag:'플래그' }
// 효과(effects): {give}, {take}, {flag}, {unflag}, {hp:+-n}, {done:true},
//                {warp:{floor,x,y,dir}}, {spin:true}, {log:'문장'}, {end:'win'},
//                {heal:'all'} 파티 전원 체력·마력 회복, {battle:'몬스터 id'} 고정 전투 (이기면 사건 완료)
//                {warp:{area,x,y,dir}} 지상(필드·마을)으로 이동, {gold:+-n} 금화, {save:true} 기록
//                {stat:{member,atk,def,hp,mp}} 파티원(member 번째, 0부터) 능력치를 영구히 올림
// 조건(when) 추가: { gold: n } 금화 n 이상 / { nogold: n } 금화 n 미만
//   hp 효과는 살아 있는 파티원 한 명에게 무작위로 적용된다.
//
// 전투
//   party.members  파티원. cls 전사·사제·마법사, spells 는 spells 표의 id
//                  face 이름으로 portraits/<face>.png 얼굴 그림을 찾고, 없으면 직업 문양을 보여준다
//   monsters       적. count:[최소,최대] 무리 수, magic:true 면 방어력 무시, boss:true 면 도망 불가
//                  sprite 이름으로 monsters/<sprite>.png 그림을 찾고, 없으면 기본 그림을 그린다
//                  tint: 0xRRGGBB 면 같은 그림을 그 빛깔로 물들여 다른 몬스터처럼 쓴다
//                  acts: n 한 라운드에 n 번 움직임 (보스) / breath: { name, chance, power:[최소,최대] }
//                  그 확률로 파티 전원에게 방어력을 무시하는 숨결 공격
//   spells         power 는 Lv1 기준. 레벨이 하나 오를 때마다 1씩 세진다
//   floors.*.encounters  { rate: 걸음마다 조우 확률, table: [몬스터 id...] }
//   floors.*.tint / fog  벽·바닥·천장 빛깔과 안개 빛깔 (0xRRGGBB, 없으면 기본 잿빛 수도원)
//   floors.*.music / areas.*.music  배경음악 장면 이름 (없으면 층·지역 이름. music.js 의 SCENES)

window.DUNGEON = {
  title: '잿빛 수도원',
  intro: [
    '삼 년 전, 왕실 탐험대가 숲속나라 북쪽 잿빛 수도원으로 떠난 뒤 돌아오지 않았다.',
    '수도원의 정문은 그날 이후 굳게 잠겼다. 당신의 일행은 숲속 마을 로엘에 막 도착했다. 장로를 찾아가 이야기를 들어 보자.'
  ],
  party: {
    name: '탐험대',
    members: [
      { name: '로엔', cls: '전사',   face: 'warrior', hp: 32, mp: 0,  atk: 7, def: 3, grow: { hp: 6, mp: 0 }, spells: [] },
      { name: '세라', cls: '사제',   face: 'priest',  hp: 22, mp: 8,  atk: 4, def: 2, grow: { hp: 4, mp: 2 }, spells: ['heal'] },
      { name: '카일', cls: '마법사', face: 'mage',    hp: 17, mp: 10, atk: 3, def: 1, grow: { hp: 3, mp: 3 }, spells: ['fire'] }
    ]
  },

  spells: {
    heal: { name: '치유', mp: 2, target: 'ally', power: [10, 16] },
    fire: { name: '화염', mp: 3, target: 'all',  power: [7, 12] }
  },

  monsters: {
    // 들판 (Lv 1~3)
    slime:       { name: '풀빛 슬라임', sprite: 'slime',       hp: 5,   atk: 3,  def: 0, exp: 3,   gold: 3,   count: [1, 3] },
    horn_rabbit: { name: '뿔토끼',      sprite: 'horn_rabbit', hp: 7,   atk: 4,  def: 0, exp: 4,   gold: 3,   count: [1, 3] },
    rat:         { name: '거대 쥐',     sprite: 'rat',         hp: 6,   atk: 4,  def: 0, exp: 4,   gold: 2,   count: [2, 3] },
    wolf:        { name: '들늑대',      sprite: 'wolf',        hp: 13,  atk: 6,  def: 1, exp: 8,   gold: 5,   count: [1, 2] },
    // 옛 광산 (Lv 3~6)
    cave_bat:    { name: '동굴 박쥐',   sprite: 'cave_bat',    hp: 9,   atk: 6,  def: 0, exp: 5,   gold: 4,   count: [2, 4] },
    cave_rat:    { name: '굴 쥐',       sprite: 'rat',         hp: 11,  atk: 6,  def: 1, exp: 5,   gold: 4,   count: [2, 3], tint: 0xc8a070 },
    rock_golem:  { name: '자갈 골렘',   sprite: 'rock_golem',  hp: 22,  atk: 8,  def: 5, exp: 11,  gold: 10,  count: [1, 2] },
    miner:       { name: '광부의 망령', sprite: 'miner',       hp: 17,  atk: 8,  def: 2, exp: 10,  gold: 9,   count: [1, 3] },
    ore_wisp:    { name: '광석 정령',   sprite: 'wisp',        hp: 14,  atk: 7,  def: 1, exp: 9,  gold: 9,   count: [1, 2], magic: true, tint: 0xffc860 },
    golem:       { name: '돌 골렘',     sprite: 'golem',       hp: 120, atk: 12, def: 6, exp: 120, gold: 80,  count: [1, 1], boss: true, acts: 2 },
    // 수도사 묘지 (Lv 6~9)
    grave_crow:  { name: '묘지 까마귀', sprite: 'grave_crow',  hp: 15,  atk: 10, def: 1, exp: 8,  gold: 6,   count: [2, 4] },
    skeleton:    { name: '해골 병사',   sprite: 'skeleton',    hp: 24,  atk: 11, def: 4, exp: 12,  gold: 10,  count: [1, 3] },
    ghoul:       { name: '구울',        sprite: 'ghoul',       hp: 34,  atk: 12, def: 3, exp: 15,  gold: 12,  count: [1, 2] },
    shade:       { name: '원혼',        sprite: 'wisp',        hp: 22,  atk: 10, def: 1, exp: 13,  gold: 12,  count: [1, 2], magic: true, tint: 0xb080ff },
    bone_knight: { name: '뼈 기사',     sprite: 'bone_knight', hp: 40,  atk: 13, def: 6, exp: 20,  gold: 16,  count: [1, 2] },
    gravekeeper: { name: '타락한 묘지기', sprite: 'gravekeeper', hp: 270, atk: 16, def: 6, exp: 180, gold: 120, count: [1, 1], boss: true, acts: 2 },
    // 잿빛 수도원 (Lv 9~14, 가장 강하다)
    fallen_monk: { name: '타락한 수도사', sprite: 'fallen_monk', hp: 36, atk: 15, def: 4, exp: 18,  gold: 16,  count: [1, 3], magic: true },
    gargoyle:    { name: '가고일',      sprite: 'gargoyle',    hp: 48,  atk: 16, def: 9, exp: 22,  gold: 20,  count: [1, 2] },
    soul_flame:  { name: '혼불',        sprite: 'wisp',        hp: 30,  atk: 14, def: 2, exp: 16,  gold: 14,  count: [1, 3], magic: true, tint: 0x60d8ff },
    living_armor: { name: '저주받은 갑옷', sprite: 'guardian', hp: 62,  atk: 18, def: 10, exp: 28, gold: 26,  count: [1, 2] },
    dragon:      { name: '잿빛 용',     sprite: 'dragon',      hp: 380, atk: 20, def: 9, exp: 800, gold: 400, count: [1, 1], boss: true, acts: 2,
                   breath: { name: '잿빛 숨결', chance: 0.3, power: [12, 18] } }
  },
  // 새 게임은 마을에서 시작한다. dungeon 은 수도원에 처음 들어갔을 때 서는 곳
  start: { area: 'town', x: 8, y: 12, dir: 1, gold: 30 },
  dungeon: { floor: 'b1', x: 1, y: 1, dir: 1 },

  items: {
    journal:    { name: '젖은 일지 조각', desc: '"우물 바닥에서 무언가 반짝였다."' },
    rusty_key:  { name: '녹슨 열쇠',     desc: '동쪽 봉인된 방의 열쇠.' },
    amulet:     { name: '은빛 부적',     desc: '푸른 결계에 닿으면 빛난다.' },
    mine_key:   { name: '광부장의 열쇠', desc: '옛 광산 갱도 차단문의 열쇠.' },
    starlight_ore: { name: '별빛 광석',  desc: '밤하늘처럼 빛나는 돌. 대장장이가 반길 것 같다.' },
    bone_key:   { name: '뼈 열쇠',       desc: '묘지 아래층 철문의 열쇠.' },
    abbey_key:  { name: '수도원 정문 열쇠', desc: '묘지기가 지니고 있던 커다란 쇠 열쇠.' },
    silver_key: { name: '은 열쇠',       desc: '수도원 서고 철창의 열쇠.' }
  },

  // 지상(위에서 내려다보는 화면). 지형 기호
  //   .  풀밭   ,  꽃밭   :  길   T  숲(조우가 잦다)   =  다리(가로)   |  다리(세로)
  //   F  깊은 숲   ^  산   ~  물   t  나무   R  지붕   W  벽   w  연못   (F ^ ~ t R W w 는 지나갈 수 없다)
  //   마을:  p 돌길  y 밭  (걸을 수 있음) / f 울타리  h 덤불  o 분수  u 우물  k 노점  l 가로등  v 통
  //          C 성당 지붕  G 성당 돌벽 (지나갈 수 없음)
  //   집 안: _ 마루  r 깔개 (걸을 수 있음) / I 벽  q 탁자  B 침대  K 계산대  J 선반  O 화덕
  //          e 긴 의자  Q 제단  P 화분 (지나갈 수 없음). 계산대·노점·제단 너머 사람과는 말할 수 있다
  //   indoor: true 인 지역은 집 안 (바깥을 검게 칠한다)
  //   그 밖의 글자는 events 에 같은 글자로 정의한 사건 칸
  // 지상 사건의 추가 필드
  //   go      밟자마자 곧바로 이동 (마을 출입구 등) — warp 와 같은 모양
  //   solid   true 면 그 칸으로 들어가지 못하고, 부딪치거나 마주 보고 [조사]하면 사건이 열린다 (사람·문)
  //   npc     사람 그림 이름 (world/npc_<이름>.png) / door: true 면 벽에 문을 그린다
  //   icon    필드 위 건물 그림 이름 (world/<이름>.png): town · abbey · mine · shrine · crypt · chest · sign · mat
  //   iconDone  once 사건이 끝난 뒤 그림 (예: chest_open)
  //   wander  사람이 제자리에서 이 칸 수만큼 돌아다님 / face  처음 바라보는 방향
  //   ground  사건 칸 바닥으로 깔 지형 기호 (기본은 지역의 ground)
  areas: {
    field: {
      name: '숲속나라 · 들판',
      ground: '.',
      map: [
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
        'F..TTTTTTT...~~..,...^^^^^^^^^^^^^......^^^^^^^F',
        'F.FFFFFTTTTT.~~...,.^^^^^^^^^^^^^^^....^^^^^^^^F',
        'FFFFFFFFTTTT..~~....^^^^^^^A^^^^^^^.,.^^^^^^^^^F',
        'FFFFFFFFTTTTT.~~....^^^^^^.:.^^^^^^...^^^^^^^^^F',
        'FFFFFFFFTTTTT.~~.....^^^^^^:^^^^^^....^^^^^^^^^F',
        'FTFFFFFTTTTTT.~~......^^^^^:^^^^^.....^^^^^^^^^F',
        'FTTTTTTTTTTTT..~~,.........:,..TTTTT..^^^^^^^^^F',
        'FTTTTTTTTTT....~~..........:..TTTTTTT.^...^^^^^F',
        'F..TTTTTT......~~......,...:..TTTTTTT.^::M^^^^^F',
        'F............,.~~..,,..t...:..TTTTTTT.H:..^^^^^F',
        'F............t.~~..........:...TTTTT...:^^^^^^^F',
        'F..............~~..........:...........:.^^^^^^F',
        'F..............~~..........:...........:,,.....F',
        'F...V::::::::::==:::::::::::::::::::::::.......F',
        'F........:......~~......:.s..............t.....F',
        'F........:......~~..t...:..,..................,F',
        'F....,...:,.....~~......:...............t......F',
        'F........:......~~.TTTTT:......................F',
        'F.....TTTTT.T..,~~TTTTTT:TT...........,........F',
        'F..TTTTTTTTTT....~~TTTTT:::............t....t..F',
        'F.TTTTTTTTTTTTT..~~TTTTTTT:...,~~~~~~~....TTTTTF',
        'FTTTTTcTTTTTTTTT.~~TTTTTT.:,.~~~~~~~~~~,.TTTTTTF',
        'F.TTTTTTTTTTTTTT.~~~~~~~~~|~~~~~~~~~~~~~TTTTTTTF',
        'FFFFFFFTTTTTTTTT.~~~~~~~~~|~~~~~~~~~~~~~TTTTTTTF',
        'FFFFFFFFFTTTTTTT.~~.......:..~~~~~~~~~~~TTTTTTTF',
        'FFFFFFFFFTTTTTT..~~..,....::::~~~~~~~~~~TTTTTTTF',
        'FFFFFFFFFTTTTTT.,~~..........:.~~~~~~~.TTTTTFFFF',
        'FFFFFFFFFTTTTT...~~..........:.........TTTTFFFFF',
        'FFFFFFFFFTTT...,.~~..........S...t,.....TTTFFFFF',
        'FFFFFFFF.D.,.....~~...,t.....,......,...TTTFFFFF',
        'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'
      ],
      encounters: { rate: 0.06, forest: 1.8, path: 0.4, table: ['slime', 'slime', 'horn_rabbit', 'horn_rabbit', 'rat', 'wolf'] },
      events: {
        V: { name: '숲속 마을 로엘', trigger: 'step', icon: 'town', go: { area: 'town', x: 1, y: 12, dir: 1 } },
        s: { name: '갈림길 안내판', trigger: 'step', solid: true, icon: 'sign', start: 'start', pages: { start: { title: '갈림길 안내판', text: '← 숲속 마을 로엘\n↑ 잿빛 수도원 (북쪽 산길, 정문이 잠김)\n→ 옛 광산 (동쪽 끝, 지금은 문을 닫음)\n↓ 별빛 사당 (호숫가)\n↙ 수도사 묘지 (남서쪽 숲 깊은 곳)' } } },
        H: {
          name: '광산 앞 은자', trigger: 'step', solid: true, npc: 'hermit', face: 2, start: [{ when: { has: 'starlight_ore' }, page: 'ore' }, { page: 'start' }],
          pages: {
            start: {
              title: '광산 앞 은자',
              text: '"옛 광산에 들어가려고? 광부들이 별빛 광석을 너무 깊이 캐다가 돌 골렘을 깨웠다네. 그 뒤로 아무도 나오지 못했지."',
              choices: [
                { label: '별빛 광석이 뭔지 묻는다', next: 'ore_q' },
                { label: '물러난다' }
              ]
            },
            ore_q: {
              title: '광산 앞 은자',
              text: '"밤하늘처럼 빛나는 돌이지. 마을 대장장이라면 그걸로 좋은 검을 벼릴 수 있을 걸세. 갱도 차단문 열쇠는 광부장이 늘 품에 지니고 다녔다네."'
            },
            ore: {
              title: '광산 앞 은자',
              text: '"그 빛… 정말 골렘을 쓰러뜨렸구먼! 어서 마을 대장간으로 가져가게."'
            }
          }
        },
        M: {
          name: '옛 광산', trigger: 'step', icon: 'mine',
          start: 'start',
          pages: {
            start: {
              title: '옛 광산',
              text: '바위산 기슭에 버팀목으로 받친 갱도 입구가 입을 벌리고 있다. 안쪽에서 차가운 바람과 함께 희미한 쇳소리가 들린다.',
              choices: [
                { label: '안으로 들어간다', effects: [{ warp: { floor: 'm1', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 들어가지 않는다' }
              ]
            }
          }
        },
        S: {
          name: '별빛 사당', trigger: 'step', solid: true, icon: 'shrine', start: 'start',
          pages: {
            start: {
              title: '별빛 사당',
              text: '호숫가에 이끼 낀 작은 돌 사당이 서 있다. 받침돌 위의 물그릇에 별빛이 고여 있다.',
              choices: [
                { label: '두 손을 모으고 물을 마신다', next: 'pray', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            pray: { title: '별빛 사당', text: '서늘한 물이 몸속을 돌자 피로가 씻은 듯 사라진다.' }
          }
        },
        c: {
          name: '숲속의 상자', trigger: 'step', solid: true, icon: 'chest', iconDone: 'chest_open', ground: 'T', once: true,
          start: 'start',
          pages: { start: { title: '숲속의 상자', text: '덤불 깊숙이 이끼 덮인 상자가 숨어 있었다. 금화 25닢이 들어 있다!', effects: [{ gold: 25 }, { done: true }] } }
        },
        A: {
          name: '잿빛 수도원', trigger: 'step', icon: 'abbey',
          start: [
            { when: { flag: 'abbey_open' }, page: 'start' },
            { when: { has: 'abbey_key', flag: 'forged' }, page: 'unlock' },
            { when: { has: 'abbey_key' }, page: 'chained' },
            { page: 'locked' }
          ],
          pages: {
            locked: {
              title: '잿빛 수도원',
              text: '산허리에 잿빛 돌로 지은 수도원이 웅크리고 있다. 정문은 커다란 쇠 자물쇠로 잠겨 있고, 그 위로 검은 사슬이 몇 겹이나 감겨 있다.\n장로라면 무언가 알고 있을지도 모른다.'
            },
            chained: {
              title: '잿빛 수도원',
              text: '정문 열쇠가 자물쇠에 꼭 맞는다. 하지만 검은 사슬이 문을 붙들고 놓아주지 않는다. 로엔의 검으로 내리쳐 봐도 불똥만 튈 뿐이다.\n"평범한 쇠로는 안 되겠어. 대장장이에게 물어보자."'
            },
            unlock: {
              title: '잿빛 수도원',
              text: '별빛 무늬가 떠오른 검을 내리치자 검은 사슬이 유리처럼 부서져 내린다. 정문 열쇠를 돌리자 묵직한 소리와 함께 문이 열린다.',
              effects: [{ flag: 'abbey_open' }, { take: 'abbey_key' }],
              choices: [
                { label: '안으로 들어간다', effects: [{ warp: { floor: 'b1', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 들어가지 않는다' }
              ]
            },
            start: {
              title: '잿빛 수도원',
              text: '열린 정문 안쪽으로 지하로 내려가는 계단이 보인다. 수도원은 다섯 층 아래까지 이어져 있다고 한다.',
              choices: [
                { label: '안으로 들어간다', effects: [{ warp: { floor: 'b1', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 들어가지 않는다' }
              ]
            }
          }
        },
        D: {
          name: '수도사 묘지', trigger: 'step', icon: 'crypt',
          start: 'start',
          pages: {
            start: {
              title: '수도사 묘지',
              text: '빽빽한 숲 한가운데, 이끼 덮인 묘비들 사이로 지하 납골당 입구가 뚫려 있다. 축축한 바람에서 흙과 촛농 냄새가 난다.',
              choices: [
                { label: '안으로 들어간다', effects: [{ warp: { floor: 'c1', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 들어가지 않는다' }
              ]
            }
          }
        }
      }
    },
    town: {
      name: '숲속 마을 로엘',
      ground: '.',
      map: [
        'tttttttttttttttttttttttttttttttttt',
        't............CCCCCCCCC...........t',
        't.RRRRRRRR.t.CCCCCCCCCt.RRRRRRRR.t',
        't.RRRRRRRR...CCCCCCCCC..RRRRRRRR.t',
        't.RRRRRRRR.t.GGGG3GGGG..RRRRRRRR.t',
        't.WWW1WWWW......l:l.....WWW2WWWW.t',
        't.P..:...P.......:......vv.:...v.t',
        't.,,,:::::::::::::.....t...:.....t',
        't.,,,:.,,,....i..:::::::::::.hhh.t',
        't....:..d....lkpppppkl.....:.....t',
        't....:....t..ppppppppp.,,,.:....tt',
        't.gh.:h..h...ppppppppp.....:.....t',
        'X::::::::::::ppppopppp::x::::::::t',
        't.s........c.ppppppppp.......www.t',
        't........u...ppppppmpp.,,,..wwww.t',
        'tt.....,,,,..lpppppppl.......www.t',
        't.......fffff....:..........,,,,.t',
        't.RRRRRRyyyyfRRRR:..RRRRRR.......t',
        't.RRRRRRyyyyfRRRR:..RRRRRRffffff.t',
        't.WW4WWWyyyyfWW5W:..WW6WWWfyyyyy.t',
        't...:...yyyyfvv:.::::::...fyyyyy.t',
        't...:...ffff...:.:........fyyzyy.t',
        't...::::::::::::::t......tfyyyyy.t',
        't................................t',
        'tttttttttttttttttttttttttttttttttt'
      ],
      events: {
        X: { name: '마을 출구', trigger: 'step', go: { area: 'field', x: 5, y: 14, dir: 1 } },
        '1': { name: '장로의 집', trigger: 'step', door: true, ground: 'W', go: { area: 'elder_house', x: 6, y: 7, dir: 0 } },
        '2': { name: '여관 "졸린 부엉이"', trigger: 'step', door: true, ground: 'W', go: { area: 'inn', x: 7, y: 8, dir: 0 } },
        '3': { name: '작은 성당', trigger: 'step', door: true, ground: 'G', go: { area: 'church', x: 6, y: 9, dir: 0 } },
        '4': { name: '약초 할머니의 집', trigger: 'step', door: true, ground: 'W', go: { area: 'granny_house', x: 4, y: 6, dir: 0 } },
        '5': { name: '대장간', trigger: 'step', door: true, ground: 'W', go: { area: 'smithy', x: 5, y: 6, dir: 0 } },
        '6': { name: '농부의 집', trigger: 'step', door: true, ground: 'W', go: { area: 'home', x: 4, y: 6, dir: 0 } },
        s: { name: '안내판', trigger: 'step', solid: true, icon: 'sign', start: 'start', pages: { start: { title: '안내판', text: '숲속 마을 로엘\n북쪽: 작은 성당 · 북서쪽: 장로의 집 · 북동쪽: 여관 "졸린 부엉이"\n남쪽: 약초 할머니의 집 · 대장간 · 농부의 집' } } },
        g: { name: '문지기', trigger: 'step', solid: true, npc: 'guard', ground: '.', face: 1, start: 'start', pages: { start: { title: '문지기', text: '"마을 밖 풀숲에는 슬라임과 뿔토끼가 자주 나온다. 숲 깊은 곳에는 들늑대도 어슬렁거리니 길을 따라가는 게 좋아."' } } },
        c: { name: '아이', trigger: 'step', solid: true, npc: 'child', ground: '.', wander: 2, start: 'start', pages: { start: { title: '아이', text: '"수도원 우물에 손을 넣으면 뭔가가 문대! 그리고 남서쪽 숲 묘지에는 밤마다 푸른 불이 떠다닌대."' } } },
        d: { name: '꼬마', trigger: 'step', solid: true, npc: 'child', ground: '.', wander: 2, start: 'start', pages: { start: { title: '꼬마', text: '"농부 아저씨네 집 구석에 상자가 있는데, 아저씨는 맨날 잊어버려!"' } } },
        m: { name: '나그네', trigger: 'step', solid: true, npc: 'traveler', ground: 'p', wander: 1, start: 'start', pages: { start: { title: '나그네', text: '"동쪽 다리를 건너면 북쪽 산으로 길이 이어지지. 수도원 앞에서 다쳤다면 무리하지 말고 돌아와 여관에서 쉬게."' } } },
        i: { name: '장사꾼', trigger: 'step', solid: true, npc: 'merchant', ground: '.', start: 'start', pages: { start: { title: '장사꾼', text: '"물건은 탐험대가 떠나기 전에 몽땅 사 갔다오. 대신 소문 하나 공짜로 주지. 수도원은 지하 5층까지 있는데, 3층 서고는 은 열쇠로 잠겨 있다더군."' } } },
        x: { name: '빨래하던 아주머니', trigger: 'step', solid: true, npc: 'woman', ground: ':', wander: 2, start: 'start', pages: { start: { title: '빨래하던 아주머니', text: '"성당 신부님께 가면 여정을 기록해 주신다우. 먼 길 떠나기 전엔 꼭 들르구려."' } } },
        z: { name: '농부', trigger: 'step', solid: true, npc: 'farmer', ground: 'y', wander: 1, start: 'start', pages: { start: { title: '농부', text: '"올해 감자는 알이 굵어. 그나저나 우리 집 상자에 뭘 넣어 뒀더라…"' } } }
      }
    },
    elder_house: {
      name: '장로의 집', indoor: true,
      ground: '_',
      map: [
        'IIIIIIIIIIIII',
        'IJJ__O___JJPI',
        'I___________I',
        'I_qq___rrr__I',
        'I_qq___rEr__I',
        'I______rrr_BI',
        'Iv_________BI',
        'IP_v_______PI',
        'IIIIIIXIIIIII'
      ],
      events: {
        X: { name: '밖으로', trigger: 'step', icon: 'mat', ground: '_', go: { area: 'town', x: 5, y: 6, dir: 2 } },
        E: {
          name: '장로 하르벤', trigger: 'step', solid: true, npc: 'elder', ground: 'r',
          start: [{ when: { flag: 'abbey_open' }, page: 'open' }, { when: { flag: 'quest' }, page: 'again' }, { page: 'start' }],
          pages: {
            start: {
              title: '장로 하르벤',
              text: '"먼 길 오느라 고생했네. 삼 년 전 왕실 탐험대가 북쪽 산의 잿빛 수도원으로 들어간 뒤 소식이 끊겼지. 그날 밤 수도원 정문이 저절로 잠기고 검은 사슬이 감겼다네.\n정문 열쇠는 문지기 수도사가 지녔는데, 그는 남서쪽 숲의 수도사 묘지에 묻혔지. 사슬은 평범한 쇠로는 끊을 수 없으니 대장장이와 의논해 보게. 얼마 안 되지만 노잣돈이라도 받게."',
              effects: [{ flag: 'quest' }, { gold: 30 }]
            },
            again: { title: '장로 하르벤', text: '"열쇠는 남서쪽 숲의 수도사 묘지에, 사슬을 끊을 별빛 광석은 동쪽 옛 광산에 있을 걸세. 수도사들은 침묵을 맹세했다고 들었네. 그 안에서 무엇을 보든 서두르지 말게."' },
            open: { title: '장로 하르벤', text: '"정문을 열었다니! 수도원은 다섯 층 아래까지 이어져 있다더군. 가장 깊은 곳의 제단을 조심하게. 옛 노래로는 그 밑에 잿빛 용이 잠들어 있다더군."' }
          }
        }
      }
    },
    inn: {
      name: '여관 "졸린 부엉이"', indoor: true,
      ground: '_',
      map: [
        'IIIIIIIIIIIIIII',
        'IJJO__JJIB_B_BI',
        'I___N___I_____I',
        'IKKKKKK_______I',
        'I_____________I',
        'I_qq___qq__q__I',
        'I_____a_______I',
        'Ir_____qq___PvI',
        'I_____________I',
        'IIIIIIIXIIIIIII'
      ],
      events: {
        X: { name: '밖으로', trigger: 'step', icon: 'mat', ground: '_', go: { area: 'town', x: 27, y: 6, dir: 2 } },
        N: {
          name: '여관 주인', trigger: 'step', solid: true, npc: 'innkeeper', ground: '_',
          start: 'start',
          pages: {
            start: {
              title: '여관 "졸린 부엉이"',
              text: '"어서 오세요. 하룻밤 묵으면 10닢입니다. 푹 자고 나면 다친 몸도 낫지요."',
              choices: [
                { label: '묵는다 (10닢)', when: { gold: 10 }, next: 'sleep', effects: [{ gold: -10 }, { heal: 'all' }] },
                { label: '묵는다 (10닢)', when: { nogold: 10 }, next: 'poor' },
                { label: '그냥 둘러본다' }
              ]
            },
            sleep: { title: '여관 "졸린 부엉이"', text: '따뜻한 침대에서 하룻밤을 보냈다. 아침 햇살에 기운이 돌아온다.' },
            poor: { title: '여관 "졸린 부엉이"', text: '"돈이 모자라시네요. 숲에서 슬라임이라도 잡아 오시겠어요?"' }
          }
        },
        a: { name: '손님', trigger: 'step', solid: true, npc: 'traveler', ground: '_', wander: 2, start: 'start', pages: { start: { title: '손님', text: '"이 집 버섯 스튜는 숲속나라 제일이야. 수도원 안에서 길을 잃으면 벽을 따라 걸어 보게."' } } }
      }
    },
    church: {
      name: '작은 성당', indoor: true,
      ground: '_',
      map: [
        'IIIIIIIIIIIII',
        'IP____Y____PI',
        'I____QQQ____I',
        'I___________I',
        'I_eee_r_eee_I',
        'I_____r_____I',
        'I_eee_r_eee_I',
        'I_____r_____I',
        'I_eee_r_eee_I',
        'I_a___r_____I',
        'IIIIIIXIIIIII'
      ],
      events: {
        X: { name: '밖으로', trigger: 'step', icon: 'mat', ground: '_', go: { area: 'town', x: 17, y: 5, dir: 2 } },
        Y: {
          name: '신부', trigger: 'step', solid: true, npc: 'priest', ground: '_',
          start: 'start',
          pages: {
            start: {
              title: '작은 성당',
              text: '촛불 아래 신부가 고개를 든다.\n"여행자여, 지금까지의 여정을 기록하겠습니까?"',
              choices: [
                { label: '기록한다', next: 'saved', effects: [{ save: true }] },
                { label: '그만둔다' }
              ]
            },
            saved: { title: '작은 성당', text: '"신의 가호가 함께하기를."' }
          }
        },
        a: { name: '기도하는 여인', trigger: 'step', solid: true, npc: 'woman', ground: '_', wander: 1, start: 'start', pages: { start: { title: '기도하는 여인', text: '"신부님은 탐험대가 떠나기 전날 밤 그들을 축복해 주셨어요. 무사히 돌아오길 매일 빌고 있답니다."' } } }
      }
    },
    granny_house: {
      name: '약초 할머니의 집', indoor: true,
      ground: '_',
      map: [
        'IIIIIIIIII',
        'IJJ_O__PJI',
        'I________I',
        'I_qq__a__I',
        'I_qq_____I',
        'Iv_____B_I',
        'IP_____B_I',
        'IIIIXIIIII'
      ],
      events: {
        X: { name: '밖으로', trigger: 'step', icon: 'mat', ground: '_', go: { area: 'town', x: 4, y: 20, dir: 2 } },
        a: {
          name: '약초 할머니', trigger: 'step', solid: true, npc: 'granny', ground: '_',
          start: 'start',
          pages: {
            start: {
              title: '약초 할머니',
              text: '"수도원? 거기 수도사들은 평생 입을 열지 않았지. 그들이 지킨 것은 깨지기 쉬운 것이야. 말 한마디에도 깨지는.\n지쳐 보이는구나. 약초차 한 잔 하겠니?"',
              choices: [
                { label: '마신다', next: 'tea', effects: [{ heal: 'all' }] },
                { label: '괜찮습니다' }
              ]
            },
            tea: { title: '약초 할머니', text: '쌉싸름한 차가 몸을 데운다. 기운이 돌아왔다.' }
          }
        }
      }
    },
    smithy: {
      name: '대장간', indoor: true,
      ground: '_',
      map: [
        'IIIIIIIIIII',
        'IOO_JJJ_vvI',
        'I_a_______I',
        'IKKKKK____I',
        'I_________I',
        'I_v_____q_I',
        'I_______q_I',
        'IIIIIXIIIII'
      ],
      events: {
        X: { name: '밖으로', trigger: 'step', icon: 'mat', ground: '_', go: { area: 'town', x: 15, y: 20, dir: 2 } },
        a: {
          name: '대장장이', trigger: 'step', solid: true, npc: 'smith', ground: '_',
          start: [{ when: { flag: 'forged' }, page: 'after' }, { when: { has: 'starlight_ore' }, page: 'ore' }, { page: 'start' }],
          pages: {
            start: { title: '대장장이', text: '"탐험대 대장의 검도 내가 벼렸지. 골렘은 돌덩이라 칼보다 마법이 잘 듣는다네.\n수도원 정문의 검은 사슬? 그건 별빛 광석으로 벼린 검이 아니면 못 끊어. 동쪽 옛 광산에서 광석을 캐 오게. 돌 골렘이 지키고 있다지만."' },
            ore: {
              title: '대장장이',
              text: '"이, 이건 별빛 광석이 아닌가! 이 정도면 로엔의 검을 제대로 벼릴 수 있겠어."',
              choices: [
                { label: '검을 벼려 달라고 한다', next: 'forged', effects: [{ take: 'starlight_ore' }, { stat: { member: 0, atk: 3 } }, { flag: 'forged' }] },
                { label: '나중에 하겠다' }
              ]
            },
            forged: { title: '대장장이', text: '망치 소리가 한참 울린 뒤, 로엔의 검날에 별빛 무늬가 떠올랐다.\n"자, 이 검이라면 수도원 정문의 검은 사슬도 끊을 수 있을 걸세."' },
            after: { title: '대장장이', text: '"그 검, 잘 쓰고 있나? 별빛 무늬가 흐려지면 언제든 들르게."' }
          }
        }
      }
    },
    home: {
      name: '농부의 집', indoor: true,
      ground: '_',
      map: [
        'IIIIIIIIII',
        'IJJ_O_P_BI',
        'I_______BI',
        'I_qq_____I',
        'I_qq__a__I',
        'I________I',
        'Ix______PI',
        'IIIIXIIIII'
      ],
      events: {
        X: { name: '밖으로', trigger: 'step', icon: 'mat', ground: '_', go: { area: 'town', x: 22, y: 20, dir: 2 } },
        a: { name: '농부의 아내', trigger: 'step', solid: true, npc: 'woman', ground: '_', wander: 1, start: 'start', pages: { start: { title: '농부의 아내', text: '"남편은 밭에 나갔어요. 상자요? 아, 그거 저도 몰라요. 열어 보셔도 돼요."' } } },
        x: {
          name: '낡은 상자', trigger: 'step', solid: true, icon: 'chest', iconDone: 'chest_open', ground: '_', once: true,
          start: 'start',
          pages: { start: { title: '낡은 상자', text: '삐걱 소리와 함께 뚜껑이 열렸다. 금화 15닢이 들어 있다!', effects: [{ gold: 15 }, { done: true }] } }
        }
      }
    }
  },

  floors: {
    b1: {
      name: '지하 1층 · 회랑',
      map: [
        '################',
        '#x..#.....#....#',
        '#.#.#.###.#.##.#',
        '#.#...#a#...#..#',
        '#.#####.#####.##',
        '#...+...#...b..#',
        '###.#.#.#.###.##',
        '#c..#.#...#....#',
        '#####.#####.#=##',
        '#h..+.....#.#..#',
        '#.#.#####.#.#d.#',
        '#.#.....#...#..#',
        '#.#####.########',
        '#e....#.....f..#',
        '#.###.#.###.##>#',
        '################'
      ],
      encounters: { rate: 0.09, table: ['fallen_monk', 'soul_flame', 'fallen_monk', 'gargoyle'] },
      locks: {
        '=': { item: 'rusty_key', locked: '굳게 잠긴 문이다. 열쇠 구멍이 녹슬어 있다.', open: '녹슨 열쇠로 문을 열었다.' }
      },
      events: {
        a: {
          name: '버려진 배낭', trigger: 'step', once: true,
          prop: { type: 'backpack', vanish: true, glow: true },
          start: 'start',
          pages: {
            start: {
              title: '버려진 배낭',
              text: '막다른 벽 아래 찢어진 배낭이 놓여 있다. 안에서 젖은 일지 한 장이 나온다.\n\n"…우물 바닥에서 무언가 반짝였다. 대장은 그것이 동쪽 방의 열쇠라고 했다…"',
              choices: [{ label: '일지를 챙긴다', effects: [{ give: 'journal' }, { done: true }] }]
            }
          }
        },
        b: {
          name: '오래된 우물', trigger: 'search', once: true,
          prop: { type: 'well', glow: true },
          hint: '발밑 어딘가에서 물 떨어지는 소리가 들린다.',
          start: [{ when: { has: 'journal' }, page: 'known' }, { page: 'start' }],
          pages: {
            start: {
              title: '오래된 우물',
              text: '돌로 쌓은 우물이다. 바닥은 보이지 않는다.',
              choices: [
                { label: '손을 넣어 더듬어 본다', next: 'bitten' },
                { label: '그만둔다' }
              ]
            },
            bitten: {
              title: '오래된 우물',
              text: '차가운 물속에서 무언가가 손가락을 문다! 아무것도 건지지 못했다.',
              effects: [{ hp: -2 }]
            },
            known: {
              title: '오래된 우물',
              text: '일지에 적힌 대로 우물 벽의 틈을 더듬자, 녹슨 열쇠 하나가 손에 걸린다.',
              choices: [{ label: '열쇠를 챙긴다', effects: [{ give: 'rusty_key' }, { done: true }] }]
            }
          }
        },
        c: {
          name: '유령 수도사', trigger: 'step',
          prop: { type: 'ghost' },
          start: 'start',
          pages: {
            start: {
              title: '유령 수도사',
              text: '희미한 형체가 앞을 가로막는다.\n"…서약을 깨뜨린 자는 아래로 내려갈 수 없다…"',
              choices: [
                { label: '탐험대에 대해 묻는다', next: 'party', effects: [{ flag: 'heard_party' }] },
                { label: '서약에 대해 묻는다', next: 'oath', effects: [{ flag: 'heard_oath' }] },
                { label: '물러난다' }
              ]
            },
            party: {
              title: '유령 수도사',
              text: '"그들은 결계를 넘으려 했다. 대장만이 은빛 부적을 지닌 채 동쪽의 잠긴 방에 남았지."',
              choices: [{ label: '다른 것을 묻는다', next: 'start' }, { label: '물러난다' }]
            },
            oath: {
              title: '유령 수도사',
              text: '"우리는 단 하나를 지켰다. 입을 여는 순간 깨지는 것을."',
              choices: [{ label: '다른 것을 묻는다', next: 'start' }, { label: '물러난다' }]
            }
          }
        },
        d: {
          name: '탐험대장의 유골', trigger: 'step', once: true,
          prop: { type: 'bones', glow: true },
          start: 'start',
          pages: {
            start: {
              title: '봉인된 방',
              text: '갑옷 차림의 유골이 벽에 기대 앉아 있다. 뼈만 남은 손이 은빛 부적을 쥐고 있다.',
              choices: [{ label: '부적을 거둔다', next: 'note', effects: [{ give: 'amulet' }, { flag: 'found_captain' }] }]
            },
            note: {
              title: '봉인된 방',
              text: '유골 옆 벽에 긁어 쓴 글씨가 있다.\n"아래 제단의 물음에 답하지 못했다. 수도사들의 서약을 알아야 한다."',
              effects: [{ done: true }]
            }
          }
        },
        h: {
          name: '회복의 샘', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '회복의 샘',
              text: '벽의 사자 머리에서 맑은 물이 흘러나온다. 물에서 희미한 빛이 난다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: {
              title: '회복의 샘',
              text: '차가운 물이 목을 타고 내려가자 상처가 아물고 기운이 돌아온다.'
            }
          }
        },
        e: {
          name: '벽의 글귀', trigger: 'search',
          prop: { type: 'runes' },
          hint: '벽면에 무언가 새겨져 있는 것 같다.',
          start: 'start',
          pages: {
            start: {
              title: '벽의 글귀',
              text: '이끼를 걷어내자 오래된 글귀가 드러난다.\n"말하는 자에게 문은 열리지 않는다."',
              effects: [{ flag: 'read_wall' }]
            }
          }
        },
        f: {
          name: '회전 함정', trigger: 'step',
          start: 'start',
          pages: {
            start: {
              title: '덜컥!',
              text: '발밑의 바닥이 소리를 내며 돌아간다. 방향 감각을 잃었다.',
              effects: [{ spin: true }]
            }
          }
        },
        x: {
          name: '수도원 입구', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '수도원 입구',
              text: '바깥으로 이어지는 돌계단이다. 틈새로 숲 냄새가 스며든다.',
              choices: [
                { label: '밖으로 나간다', effects: [{ warp: { area: 'field', x: 27, y: 4, dir: 2 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        '>': {
          name: '내려가는 계단', trigger: 'step', mark: 'stairs-down',
          prop: { type: 'stairs-down', barrier: 'amulet' },
          start: [{ when: { has: 'amulet' }, page: 'open' }, { page: 'sealed' }],
          pages: {
            sealed: {
              title: '내려가는 계단',
              text: '아래로 이어지는 계단을 푸른 결계가 막고 있다. 손을 대자 차갑게 밀려난다.'
            },
            open: {
              title: '내려가는 계단',
              text: '은빛 부적이 빛나자 푸른 결계가 물러난다.',
              choices: [
                { label: '내려간다', effects: [{ warp: { floor: 'b2', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 머문다' }
              ]
            }
          }
        }
      }
    },

    b2: {
      name: '지하 2층 · 무덤방',
      map: [
        '############',
        '#<...#.....#',
        '#.##.#.###.#',
        '#.#..+...#.#',
        '#.#.####.#.#',
        '#...#h...#.#',
        '###.#.####.#',
        '#t..#......#',
        '#.###.####.#',
        '#.....#e...#',
        '#.#####.##>#',
        '############'
      ],
      encounters: { rate: 0.1, table: ['fallen_monk', 'gargoyle', 'soul_flame', 'living_armor'] },
      locks: {},
      events: {
        '<': {
          name: '올라가는 계단', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '올라가는 계단',
              text: '지하 1층 회랑으로 이어지는 계단이다.',
              choices: [
                { label: '올라간다', effects: [{ warp: { floor: 'b1', x: 14, y: 13, dir: 0 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        h: {
          name: '성수 대야', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '성수 대야',
              text: '돌 대야에 맑은 물이 고여 있다. 수면에 촛불 빛이 어른거린다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: { title: '성수 대야', text: '차가운 성수가 몸을 씻어 내리자 상처가 아문다.' }
          }
        },
        t: {
          name: '이름 없는 석관', trigger: 'search', once: true,
          prop: { type: 'bones', glow: true },
          hint: '석관 뚜껑이 조금 어긋나 있다.',
          start: 'start',
          pages: { start: { title: '이름 없는 석관', text: '뚜껑을 밀어내자 수도복 자락 사이에서 금화 20닢이 굴러 나온다.', effects: [{ gold: 20 }, { done: true }] } }
        },
        e: {
          name: '묘비의 글귀', trigger: 'search',
          prop: { type: 'runes' },
          hint: '바닥 돌판에 글씨가 새겨져 있다.',
          start: 'start',
          pages: { start: { title: '묘비의 글귀', text: '"여기 잠든 형제들은 끝까지 입을 열지 않았다. 아래층 서고의 열쇠는 사서 형제가 지녔다."' } }
        },
        '>': {
          name: '내려가는 계단', trigger: 'step', mark: 'stairs-down',
          prop: { type: 'stairs-down' },
          start: 'start',
          pages: {
            start: {
              title: '내려가는 계단',
              text: '더 깊은 곳에서 종이 넘어가는 소리가 들린다.',
              choices: [
                { label: '내려간다', effects: [{ warp: { floor: 'b3', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 머문다' }
              ]
            }
          }
        }
      }
    },

    b3: {
      name: '지하 3층 · 서고',
      map: [
        '##############',
        '#<....#......#',
        '#.###.#.####.#',
        '#.#k#...#....#',
        '#.#.#####.##.#',
        '#...#.....#..#',
        '###.#.###.#.##',
        '#...#...#.#..#',
        '#.#####.#.##.#',
        '#.....#.#..#=#',
        '#####.#.##.#.#',
        '#h....#e...#.#',
        '#.#####.##f#>#',
        '##############'
      ],
      encounters: { rate: 0.1, table: ['gargoyle', 'living_armor', 'fallen_monk', 'soul_flame'] },
      locks: {
        '=': { item: 'silver_key', locked: '책장 사이를 은빛 철창이 가로막고 있다. 작은 열쇠 구멍이 있다.', open: '은 열쇠로 철창을 열었다.' }
      },
      events: {
        '<': {
          name: '올라가는 계단', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '올라가는 계단',
              text: '지하 2층 무덤방으로 이어지는 계단이다.',
              choices: [
                { label: '올라간다', effects: [{ warp: { floor: 'b2', x: 10, y: 9, dir: 0 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        k: {
          name: '사서 수도사의 책상', trigger: 'step', once: true,
          prop: { type: 'backpack', vanish: true, glow: true },
          start: 'start',
          pages: {
            start: {
              title: '사서 수도사의 책상',
              text: '먼지 쌓인 책상 위에 펼쳐진 장부와 은 열쇠 하나가 놓여 있다.\n"침묵의 서약은 마지막 제단에서 시험받는다."',
              choices: [{ label: '열쇠를 챙긴다', effects: [{ give: 'silver_key' }, { done: true }] }]
            }
          }
        },
        h: {
          name: '잉크 샘', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '잉크 샘',
              text: '벽에 붙은 작은 샘에서 물이 똑똑 떨어진다. 사서들이 손을 씻던 곳이다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: { title: '잉크 샘', text: '물이 손끝부터 차갑게 스며들며 기운이 돌아온다.' }
          }
        },
        e: {
          name: '서고의 경고문', trigger: 'search',
          prop: { type: 'runes' },
          hint: '책장 옆 판자에 글씨가 있다.',
          start: 'start',
          pages: { start: { title: '서고의 경고문', text: '"이 아래는 종지기의 방. 바닥이 도는 곳을 조심하라."' } }
        },
        f: {
          name: '회전 함정', trigger: 'step',
          start: 'start',
          pages: { start: { title: '덜컥!', text: '발밑의 바닥이 돌아간다. 방향 감각을 잃었다.', effects: [{ spin: true }] } }
        },
        '>': {
          name: '내려가는 계단', trigger: 'step', mark: 'stairs-down',
          prop: { type: 'stairs-down' },
          start: 'start',
          pages: {
            start: {
              title: '내려가는 계단',
              text: '아래에서 낮은 종소리가 울린다.',
              choices: [
                { label: '내려간다', effects: [{ warp: { floor: 'b4', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 머문다' }
              ]
            }
          }
        }
      }
    },

    b4: {
      name: '지하 4층 · 종지기의 방', music: 'b2',
      map: [
        '############',
        '#<.....#...#',
        '#.####.#.#.#',
        '#.#..#...#.#',
        '#.#.##.###.#',
        '#...#..f...#',
        '###.#.####.#',
        '#c..#.#..#.#',
        '#.###.#.##.#',
        '#.....#h...#',
        '#.#####.##>#',
        '############'
      ],
      encounters: { rate: 0.11, table: ['living_armor', 'soul_flame', 'gargoyle', 'fallen_monk'] },
      locks: {},
      events: {
        '<': {
          name: '올라가는 계단', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '올라가는 계단',
              text: '지하 3층 서고로 이어지는 계단이다.',
              choices: [
                { label: '올라간다', effects: [{ warp: { floor: 'b3', x: 12, y: 11, dir: 0 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        c: {
          name: '종지기의 유령', trigger: 'step',
          prop: { type: 'ghost' },
          start: 'start',
          pages: {
            start: {
              title: '종지기의 유령',
              text: '깨진 종 옆에서 희미한 형체가 고개를 든다.\n"…제단은 하나만 묻는다. 우리가 평생 지킨 것을…"',
              choices: [{ label: '고개를 숙인다' }]
            }
          }
        },
        f: {
          name: '울리는 바닥', trigger: 'step', once: true,
          start: 'start',
          pages: { start: { title: '데엥—', text: '발밑에서 종이 울리자 머리가 울린다!', effects: [{ hp: -4 }, { done: true }] } }
        },
        h: {
          name: '종지기의 물항아리', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '종지기의 물항아리',
              text: '깨진 종 아래 물항아리에 맑은 물이 남아 있다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: { title: '종지기의 물항아리', text: '물을 마시자 울리던 머리가 맑아진다.' }
          }
        },
        '>': {
          name: '내려가는 계단', trigger: 'step', mark: 'stairs-down',
          prop: { type: 'stairs-down' },
          start: 'start',
          pages: {
            start: {
              title: '내려가는 계단',
              text: '가장 깊은 곳, 제단으로 이어지는 계단이다.',
              choices: [
                { label: '내려간다', effects: [{ warp: { floor: 'b5', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 머문다' }
              ]
            }
          }
        }
      }
    },

    b5: {
      name: '지하 5층 · 제단', music: 'b2',
      map: [
        '########',
        '#<.....#',
        '#.####.#',
        '#.#z.#.#',
        '#.#..+g#',
        '#.####.#',
        '#......#',
        '########'
      ],
      encounters: { rate: 0.1, table: ['living_armor', 'gargoyle', 'soul_flame'] },
      locks: {},
      events: {
        g: {
          name: '잿빛 용', trigger: 'step', once: true,
          start: 'start',
          pages: {
            start: {
              title: '잿빛 용',
              text: '제단으로 가는 문 앞에 쌓인 잿더미가 꿈틀거린다. 재를 털고 거대한 날개가 펼쳐진다. 수도원 아래 잠들어 있던 잿빛 용이 금빛 눈을 뜬다.\n"…시끄럽구나. 서약을 모르는 자는 제단에 닿을 수 없다."',
              choices: [{ label: '맞서 싸운다', effects: [{ battle: 'dragon' }] }]
            }
          }
        },
        '<': {
          name: '올라가는 계단', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '올라가는 계단',
              text: '지하 4층으로 이어지는 계단이다.',
              choices: [
                { label: '올라간다', effects: [{ warp: { floor: 'b4', x: 10, y: 9, dir: 0 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        z: {
          name: '검은 제단', trigger: 'step',
          prop: { type: 'altar' },
          start: 'start',
          pages: {
            start: {
              title: '검은 제단',
              text: '검은 제단 위로 글자가 떠오른다.\n"입을 여는 순간 깨지는 것은 무엇인가?"',
              choices: [
                { label: '"침묵"', next: 'win' },
                { label: '"유리"', next: 'wrong' },
                { label: '"약속"', next: 'wrong' },
                { label: '대답하지 않고 물러난다' }
              ]
            },
            wrong: {
              title: '검은 제단',
              text: '제단에서 검은 불꽃이 솟구친다!',
              effects: [{ hp: -6 }]
            },
            win: {
              title: '봉인이 풀리다',
              text: '용이 쓰러지자, 수도원에 다시 완전한 고요가 내려앉는다.\n제단이 소리 없이 갈라지고, 그 아래 석실에 탐험대원들이 잠들어 있다.\n그들은 살아 있었다. 침묵의 서약 속에 갇힌 채로.',
              effects: [{ end: 'win' }]
            }
          }
        }
      }
    },
    // ----- 수도사 묘지 (들판 남서쪽 숲, 수도원 정문 열쇠가 있는 곳) -----
    c1: {
      name: '수도사 묘지 · 납골당', tint: 0xa0b898, fog: 0x050a06, music: 'crypt',
      map: [
        '##############',
        '#x...#.......#',
        '#.##.#.#####.#',
        '#.#a.#.#h..#.#',
        '#.####.#.#.#.#',
        '#......+.#...#',
        '####.###.#####',
        '#e...#...#...#',
        '#.##.#.###.#.#',
        '#.#..#.....#.#',
        '#.#.########.#',
        '#.#....f...#=#',
        '#.####.###.#>#',
        '##############'
      ],
      encounters: { rate: 0.1, table: ['grave_crow', 'grave_crow', 'skeleton', 'ghoul', 'shade'] },
      locks: {
        '=': { item: 'bone_key', locked: '해골 문양이 새겨진 철문이 잠겨 있다.', open: '뼈 열쇠를 꽂자 철문이 삐걱이며 열렸다.' }
      },
      events: {
        x: {
          name: '묘지 입구', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '묘지 입구',
              text: '숲으로 올라가는 이끼 낀 계단이다.',
              choices: [
                { label: '밖으로 나간다', effects: [{ warp: { area: 'field', x: 10, y: 30, dir: 1 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        a: {
          name: '열린 관', trigger: 'step', once: true,
          prop: { type: 'bones', glow: true },
          start: 'start',
          pages: {
            start: {
              title: '열린 관',
              text: '뚜껑이 부서진 관 속에 누운 유골이 뼈로 깎은 열쇠를 쥐고 있다.\n관 옆면에 글씨가 있다. "수도원 가장 깊은 곳에 잿빛 용이 잠들어 있다. 우리의 침묵이 그 잠을 지켜 왔다."',
              choices: [{ label: '열쇠를 챙긴다', effects: [{ give: 'bone_key' }, { done: true }] }]
            }
          }
        },
        h: {
          name: '촛농 샘', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '촛농 샘',
              text: '녹아내린 촛농 사이로 맑은 물이 솟는 작은 샘이다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: { title: '촛농 샘', text: '미지근한 물인데도 몸이 따뜻해진다.' }
          }
        },
        e: {
          name: '묘비의 낙서', trigger: 'search',
          prop: { type: 'runes' },
          hint: '묘비 뒤쪽에 무언가 긁혀 있다.',
          start: 'start',
          pages: { start: { title: '묘비의 낙서', text: '"푸른 불은 마법으로 쫓아라. 구울은 느리지만 질기다."' } }
        },
        f: {
          name: '무너진 무덤', trigger: 'step', once: true,
          start: 'start',
          pages: { start: { title: '쿵!', text: '발밑의 무덤이 꺼지며 뼈 무더기 속으로 미끄러졌다!', effects: [{ hp: -3 }, { done: true }] } }
        },
        '>': {
          name: '묘지 아래로 내려가는 계단', trigger: 'step', mark: 'stairs-down',
          prop: { type: 'stairs-down' },
          start: 'start',
          pages: {
            start: {
              title: '묘지 아래로 내려가는 계단',
              text: '철문 너머로 차가운 바람이 올라온다.',
              choices: [
                { label: '내려간다', effects: [{ warp: { floor: 'c2', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 머문다' }
              ]
            }
          }
        }
      }
    },

    c2: {
      name: '수도사 묘지 · 문지기의 방', tint: 0x9080b0, fog: 0x07040c, music: 'crypt',
      map: [
        '##########',
        '#<.......#',
        '#.######.#',
        '#.#h...#.#',
        '#.#.##.#.#',
        '#...#..#.#',
        '###.#.##.#',
        '#...#....#',
        '######g###',
        '#....k...#',
        '##########'
      ],
      encounters: { rate: 0.11, table: ['ghoul', 'shade', 'skeleton', 'bone_knight'] },
      locks: {},
      events: {
        '<': {
          name: '올라가는 계단', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '올라가는 계단',
              text: '납골당으로 이어지는 계단이다.',
              choices: [
                { label: '올라간다', effects: [{ warp: { floor: 'c1', x: 12, y: 11, dir: 0 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        h: {
          name: '정화의 대야', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '정화의 대야',
              text: '은으로 테를 두른 대야에 물이 가득하다. 이곳만은 공기가 맑다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: { title: '정화의 대야', text: '몸에 붙은 묘지의 냉기가 씻겨 나간다.' }
          }
        },
        g: {
          name: '타락한 묘지기', trigger: 'step', once: true,
          start: 'start',
          pages: {
            start: {
              title: '타락한 묘지기',
              text: '녹슨 갑옷을 입은 거구가 쇠 열쇠 꾸러미를 흔들며 일어선다. 투구 틈에서 초록 불빛이 새어 나온다.\n"…문은… 열리지… 않는다…"',
              choices: [{ label: '맞서 싸운다', effects: [{ battle: 'gravekeeper' }] }]
            }
          }
        },
        k: {
          name: '문지기의 열쇠', trigger: 'step', once: true,
          prop: { type: 'backpack', vanish: true, glow: true },
          start: 'start',
          pages: {
            start: {
              title: '문지기의 열쇠',
              text: '쓰러진 묘지기 뒤편, 돌 받침 위에 커다란 쇠 열쇠가 놓여 있다. 손잡이에 수도원 문장이 새겨져 있다.',
              choices: [{ label: '열쇠를 챙긴다', effects: [{ give: 'abbey_key' }, { done: true }] }]
            }
          }
        }
      }
    },
    // ----- 옛 광산 (들판 동쪽 끝, 고르지 않아도 되는 곁가지 던전) -----
    // tint: 벽·바닥·천장 빛깔 / fog: 안개 빛깔 / music: 배경음악 장면 (music.js)
    m1: {
      name: '옛 광산 · 갱도', tint: 0xd8b48a, fog: 0x0c0804, music: 'b1',
      map: [
        '################',
        '#x...#....#....#',
        '#.##.#.##.#.##.#',
        '#.#a.#.#h.#..#.#',
        '#.####.####.##.#',
        '#......+.......#',
        '#.####.#.####.##',
        '#.#e...#.#..f..#',
        '#.#.####.#.###.#',
        '#.#......#...#.#',
        '#.######.###.#.#',
        '#........#...#.#',
        '####.#####.#.#.#',
        '#....#.....#=#.#',
        '#.##...###.#>#.#',
        '################'
      ],
      encounters: { rate: 0.1, table: ['cave_bat', 'cave_bat', 'cave_rat', 'miner', 'rock_golem'] },
      locks: {
        '=': { item: 'mine_key', locked: '두꺼운 나무 차단문이 쇠사슬로 묶여 있다. "광부장 외 출입 금지"', open: '광부장의 열쇠로 쇠사슬을 풀었다.' }
      },
      events: {
        x: {
          name: '광산 입구', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '광산 입구',
              text: '바깥 빛이 새어 드는 비탈길이다.',
              choices: [
                { label: '밖으로 나간다', effects: [{ warp: { area: 'field', x: 40, y: 9, dir: 3 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        a: {
          name: '광부장의 유골', trigger: 'step', once: true,
          prop: { type: 'bones', glow: true },
          start: 'start',
          pages: {
            start: {
              title: '광부장의 유골',
              text: '곡괭이를 끌어안은 유골이 갱도 벽에 기대어 있다. 허리춤에서 묵직한 열쇠가 달랑거린다.',
              choices: [{ label: '열쇠를 챙긴다', next: 'note', effects: [{ give: 'mine_key' }] }]
            },
            note: {
              title: '광부장의 유골',
              text: '유골 곁에 수첩이 떨어져 있다.\n"차단문 너머 깊은 굴에서 별빛 광석이 쏟아졌다. 그런데 바위가 일어나 걷기 시작했다…"',
              effects: [{ done: true }]
            }
          }
        },
        h: {
          name: '지하수 웅덩이', trigger: 'step',
          prop: { type: 'fountain' },
          start: 'start',
          pages: {
            start: {
              title: '지하수 웅덩이',
              text: '바위틈에서 맑은 지하수가 솟아 작은 웅덩이를 이루고 있다.',
              choices: [
                { label: '물을 마신다', next: 'drink', effects: [{ heal: 'all' }] },
                { label: '지나간다' }
              ]
            },
            drink: { title: '지하수 웅덩이', text: '얼음처럼 차가운 물이 정신을 번쩍 들게 한다. 기운이 돌아왔다.' }
          }
        },
        e: {
          name: '광부들의 낙서', trigger: 'search',
          prop: { type: 'runes' },
          hint: '버팀목에 칼로 긁은 자국이 있다.',
          start: 'start',
          pages: {
            start: {
              title: '광부들의 낙서',
              text: '버팀목에 삐뚤빼뚤한 글씨가 새겨져 있다.\n"골렘은 느리다. 먼저 치고, 다치면 바로 치유하라. — 막내 광부"'
            }
          }
        },
        f: {
          name: '무너지는 천장', trigger: 'step', once: true,
          start: 'start',
          pages: {
            start: {
              title: '우르르!',
              text: '머리 위 버팀목이 부러지며 돌 부스러기가 쏟아진다!',
              effects: [{ hp: -3 }, { done: true }]
            }
          }
        },
        '>': {
          name: '깊은 굴로 내려가는 비탈', trigger: 'step', mark: 'stairs-down',
          prop: { type: 'stairs-down' },
          start: 'start',
          pages: {
            start: {
              title: '깊은 굴',
              text: '아래쪽 어둠 속에서 푸르스름한 빛이 반짝인다.',
              choices: [
                { label: '내려간다', effects: [{ warp: { floor: 'm2', x: 1, y: 1, dir: 1 } }] },
                { label: '아직 머문다' }
              ]
            }
          }
        }
      }
    },

    m2: {
      name: '옛 광산 · 별빛 굴', tint: 0xa8bce8, fog: 0x04060e, music: 'b2',
      map: [
        '##########',
        '#<.....#.#',
        '####.#.#.#',
        '#....#...#',
        '#.####.###',
        '#......#o#',
        '###.##.#.#',
        '#...#..g.#',
        '#.#...##.#',
        '##########'
      ],
      encounters: { rate: 0.1, table: ['rock_golem', 'miner', 'ore_wisp', 'cave_bat'] },
      locks: {},
      events: {
        '<': {
          name: '올라가는 비탈', trigger: 'step', mark: 'stairs-up',
          prop: { type: 'stairs-up' },
          start: 'start',
          pages: {
            start: {
              title: '올라가는 비탈',
              text: '갱도로 이어지는 비탈길이다.',
              choices: [
                { label: '올라간다', effects: [{ warp: { floor: 'm1', x: 12, y: 12, dir: 0 } }] },
                { label: '머문다' }
              ]
            }
          }
        },
        g: {
          name: '돌 골렘', trigger: 'step', once: true,
          start: 'start',
          pages: {
            start: {
              title: '돌 골렘',
              text: '벽인 줄 알았던 바위가 갈라지며 일어선다. 가슴팍에 박힌 광석이 푸르게 맥박친다.',
              choices: [{ label: '맞서 싸운다', effects: [{ battle: 'golem' }] }]
            }
          }
        },
        o: {
          name: '별빛 광맥', trigger: 'step', once: true,
          prop: { type: 'runes', glow: true },
          start: 'start',
          pages: {
            start: {
              title: '별빛 광맥',
              text: '굴 끝 벽면 가득 밤하늘 같은 광석이 박혀 반짝인다. 골렘이 지키던 것이 바로 이것이었다.',
              choices: [{ label: '광석을 캐낸다', effects: [{ give: 'starlight_ore' }, { done: true }] }]
            }
          }
        }
      }
    }
  }
};
