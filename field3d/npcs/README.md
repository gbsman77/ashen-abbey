# 마을 사람 3D (12명)

- 미리보기: 이 폴더의 index.html (models3d/npc_*.json 을 읽음). 머리 위 작은 그림 = 지금 게임의 2D 그림.
- 바탕: KayKit Adventurers (CC0). 모두 같은 뼈대라 몸·머리를 섞고, 색 칸을 바꾸고, 단순한 소품을 뼈에 붙였다.
  - 문지기 = Knight 그대로(투구), 쇠색 + 창 / 나그네 = Rogue_Hooded(초록 두건·망토) + 창·봇짐
  - 아이·농부·여관 주인·장사꾼 = Rogue 몸 + Knight 머리. 아이 연두 옷·덥수룩한 머리(키 0.8), 농부 파란 옷·밀짚모자·괭이, 여관 주인 갈색 옷·흰 앞치마, 장사꾼 초록 망토·챙 모자·큰 봇짐
  - 아주머니 = Rogue 몸·머리, 주황 머리·빨간 치마·흰 앞치마
  - 장로 = Mage 몸(보라 긴 옷) + Rogue 머리(흰 머리) + 흰 수염 + 지팡이 / 신부 = Mage 몸(흰 긴 옷, 금색 영대) + 책
  - 약초 할머니 = Mage(쪽 진 머리만 회색) + 회색 치마·갈색 숄·바구니 / 은자 = Rogue_Hooded 갈색 + 수염·지팡이·봇짐
  - 대장장이 = Barbarian(모자 벗김) + 검은 머리·수염 + 가죽 앞치마
- 동작 3개: Idle, Walking_A, Interact
- 다시 만들기: `pip install bpy` 후 `python3 tools3d/build_npcs.py -- <KayKit glb 폴더> <출력 폴더> [이름...]`,
  나온 glb 를 base64 로 models3d/npc_<이름>.json ({"npc_<이름>": base64}) 에 넣는다.
