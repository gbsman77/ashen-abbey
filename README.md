# 잿빛 수도원 (던전 탐험 프로토타입)

숲속나라의 마을과 들판은 옛 드래곤 퀘스트처럼 위에서 내려다보는 도트 화면으로, 잿빛 수도원 안은 위저드리식 1인칭 격자 던전(Three.js 3D, 횃불 조명, 안개, 그림자)으로 그린다. Three.js는 CDN(three@0.158.0)에서 불러온다.

흐름: 마을 로엘에서 시작 → 장로에게 이야기를 듣고 → 들판의 길과 다리를 지나 북쪽 산의 수도원으로 → 지하 1·2층을 풀고 제단의 수수께끼로 엔딩. 수도원 입구 칸(지하 1층 1,1)을 다시 밟으면 들판으로 나간다. 여관(10닢)에서 회복, 성당에서 기록.

- `index.html` 화면 구성과 스타일
- `world3d.js` 3D로 보기 (화면 오른쪽 위 3D 단추, V 키). 지상 지도를 그대로 읽어 3D로 세운다 (지금은 마을 로엘 바깥만, 집 안·들판은 2D). 걷기·사건·저장은 engine.js 격자 그대로. 파티 모델은 맨 위 `PARTY3D`, 마을 소품은 `models3d/town.json` (KayKit CC0, `tools3d/pack_town.mjs`로 묶음)
- `engine.js` 이동, 3D 렌더링, 미니맵, 사건 처리 (콘텐츠 없음). 주소 끝에 `#debug`를 붙이면 콘솔에서 `dungeon.warp(층 또는 지역, x, y, 방향)` 사용 가능 (지역: field, town)
- `data.js` 맵·아이템·사건 데이터. 새 층이나 사건은 여기만 고치면 된다. 기호와 사건 형식은 파일 맨 위 주석 참고.

무기: data.js `weapons` 표(직업·공격·주문 위력·값). 대장간 대장장이가 판다. 아이콘은 `weapons/<id>.png`를 넣으면 교체(없으면 코드 도트), 요청서 weapons/GEMINI_무기_요청서.md.
적 그림: `monsters/` 폴더에 `<sprite>.png`를 넣으면 교체된다. 규격은 monsters/README.md.
지상 타일·사람 그림: `world/` 폴더. 규격은 world/README.md.
로컬 실행: `index.html`을 브라우저로 열기.
전투: 걸음마다 층별 확률로 무작위 조우(data.js의 encounters), 파티 3인(전사·사제·마법사)이 차례제로 공격·방어·주문·도망. 보스는 지하 2층 제단 앞.
조작: 던전에서는 W/S 전진·후퇴, A/D 90° 회전, Q/E 옆걸음. 지상에서는 W/A/S/D·방향키로 위·왼쪽·아래·오른쪽으로 걷는다. F·Space 조사(지상에서는 마주 본 사람에게 말 걸기), 1~9 선택지.
배경음악: `music.js`가 실제 악기 녹음(`instruments/`)을 Web Audio로 연주하는 오리지널 곡 (시작 화면·마을·들판·지하 1층·지하 2층·묘지·전투·승리 팡파레). 피아노·현악·관악·합창·하프·팀파니·타이코에 홀 잔향을 입히고, 곡에 필요한 악기 파일만 그때그때 불러온다. engine.js의 draw()가 `BGM.scene(지역 또는 층)`을 불러 장면이 바뀌면 곡이 바뀐다. 전투가 시작되면 전투곡, 이기면 승리 팡파레가 나오고 전투가 끝나면 원래 곡으로 돌아간다(BGM.battle/victory/battleEnd). 첫 클릭·키 입력부터 소리가 나고, M 키나 오른쪽 아래 ♪ 버튼으로 끄고 켜며, 옆의 막대로 음량을 조절한다 (설정은 브라우저에 기억). 미리 듣기 녹음은 `music-preview/`.

효과음: 같은 `music.js`의 `BGM.sfx(이름)`. 전투(공격·급소·헛침·방어·적의 공격·막음·피함·불꽃 주문·회복 주문), 발소리(지상 step, 던전 stepStone), 벽 부딪힘, 장소 이동(enterTown·leaveTown·enterDungeon·leaveDungeon·stairs).

화면 전환: `transition.js`의 `Curtain.run`. 마을↔들판은 동그랗게 닫혔다 열리고, 수도원 드나들기와 층 이동은 어두워졌다가 장소 이름이 뜬다. engine.js의 warpTo가 부른다.

악기 녹음 출처: FluidR3_GM 사운드폰트 (Frank Wen, Creative Commons Attribution 3.0, https://creativecommons.org/licenses/by/3.0/), gleitz/midi-js-soundfonts 에서 미리 렌더된 mp3를 세 반음 간격으로 추려 씀.
