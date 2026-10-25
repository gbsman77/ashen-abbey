# 파티 3D 캐릭터 (로엔 · 세라 · 카일)

- 미리보기: 이 폴더의 index.html (models3d/*.json을 읽음)
- 바탕: KayKit Adventurers (CC0). 모두 같은 뼈대(41개 뼈)라 부품을 섞어 씀.
  - 로엔(전사) = Knight에서 투구를 벗기고 머리 갈색 + 삐친 머리 + 빨간 목도리 + 빨간 앞치마(금 문양). 무기 1H_Sword, Round_Shield
  - 카일(마법사) = Mage에서 모자를 벗기고 머리 짙은 청록 + 둥근 안경 + 빨간 목도리 + 남색 속옷 + 금테 두른 보라 망토와 두건(뒷머리 묶음은 지움). 무기 2H_Staff
  - 세라(사제) = Mage 몸(흰 옷, 금색 띠, 남색 망토) + Rogue 머리(짙은 갈색) + 땋은 머리 두 갈래 + 발목까지 오는 흰 치마(금테) + 남색 앞판·조끼. 무기 1H_Wand
- 동작 16개: Idle, Walking_A, Walking_B, Running_A, 1H_Melee_Attack_Chop, 1H_Melee_Attack_Slice_Diagonal, 2H_Melee_Attack_Chop,
  Spellcast_Shoot, Spellcast_Raise, Spellcasting, Hit_A, Death_A, Block, Cheer, Use_Item, Interact
- 무기는 메시 이름으로 켜고 끔 (모델 안에 Spellbook도 있음, 기본은 숨김).
- 파일: glb/ (원본), models/party.json (아티팩트용 base64 묶음). 저장소에는 models3d/<warrior|mage|priest>.json ({"<key>": base64 GLB}).
- 다시 만들기: `pip install bpy` 후 `python3 -I tools3d/build_party.py -- warrior out.glb` (KayKit 원본 glb 경로는 스크립트 맨 위 SRC).

