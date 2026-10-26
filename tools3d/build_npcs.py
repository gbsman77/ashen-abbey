# 마을 사람 3D 모델: KayKit Adventurers (CC0) 몸·머리를 섞고, 색 칸을 바꾸고, 소품을 뼈에 붙여 만든다.
# usage: python3 build_npcs.py -- <KayKit glb 폴더> <out 폴더> [이름 ...]
# 이름: child elder farmer granny guard hermit innkeeper merchant priest smith traveler woman (없으면 전부)
import bpy, sys, os, math, bmesh
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(args[0]), os.path.abspath(args[1])
KEEP_ACTIONS = ['Idle', 'Walking_A', 'Interact']
TEX = 512   # 색 칸 그림은 매끈한 그러데이션이라 512 로 줄여도 같다

def srgb(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])

# ---------- 불러오기 ----------
def imp(name):
    before = set(bpy.data.objects); acts = set(bpy.data.actions); imgs = set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + '.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    for i in bpy.data.images:
        if i not in imgs: i.name = name.lower() + '_tex'
    return new, [a for a in bpy.data.actions if a not in acts]

def start(base, keep):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs, _ = imp(base)
    rig = [o for o in objs if o.type == 'ARMATURE'][0]
    rig.data.pose_position = 'REST'
    for o in objs:
        if o.type == 'MESH' and o.name not in keep: bpy.data.objects.remove(o)
    return rig

def borrow(rig, base, part):
    # 다른 KayKit 사람의 머리 같은 부품을 같은 뼈대로 옮겨 단다
    objs, acts = imp(base)
    p = [o for o in objs if o.name.startswith(part)][0]
    for o in objs:
        if o is not p: bpy.data.objects.remove(o)
    for a in acts: bpy.data.actions.remove(a)
    mw = p.matrix_world.copy(); p.parent = rig; p.matrix_world = mw
    for m in p.modifiers:
        if m.type == 'ARMATURE': m.object = rig
    p.name = part
    return p

# ---------- 색 칸 (8칸 x 4줄, 0줄이 위) ----------
free = {}   # 그림 이름 → 아직 안 쓴 칸 (4줄은 어느 KayKit 사람도 안 쓴다)
def img_of(o): return o.data.materials[0].node_tree.nodes['Image Texture'].image if 'Image Texture' in o.data.materials[0].node_tree.nodes else \
    [n for n in o.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE'][0].image
def pixels(img):
    W, H = img.size
    return np.array(img.pixels[:]).reshape(H, W, 4)
def tint(px, src, dst, hexcol, W, H):
    cw, ch = W // 8, H // 4
    (sc, sr), (dc, dr) = src, dst
    blk = px[(3 - sr) * ch:(4 - sr) * ch, sc * cw:(sc + 1) * cw, :3]
    lum = blk @ np.array([.3, .59, .11]); ref = max(np.median(lum), 1e-3)
    t = srgb(hexcol)
    px[(3 - dr) * ch:(4 - dr) * ch, dc * cw:(dc + 1) * cw, :3] = np.clip(t[None, None, :] * (lum / ref)[..., None], 0, 1)
def recolor(img, cells):
    # 그 칸을 쓰는 모든 부품의 색이 바뀐다
    px = pixels(img); W, H = img.size
    for cell, hexcol in cells.items(): tint(px, cell, cell, hexcol, W, H)
    img.pixels[:] = px.ravel()
def paint(o, cell, hexcol):
    # 이 부품의 이 칸만 빈 칸으로 옮겨 칠한다 (같은 칸을 쓰는 다른 부품은 그대로)
    img = img_of(o)
    f = free.setdefault(img.name, [(c, 3) for c in range(8)])
    dst = f.pop(0)
    px = pixels(img); W, H = img.size
    tint(px, cell, dst, hexcol, W, H); img.pixels[:] = px.ravel()
    uv = o.data.uv_layers[0].data
    du, dv = (dst[0] - cell[0]) / 8, (cell[1] - dst[1]) / 4
    for p in o.data.polygons:
        u = sum(uv[i].uv.x for i in p.loop_indices) / p.loop_total; v = sum(uv[i].uv.y for i in p.loop_indices) / p.loop_total
        if (int(u * 8) % 8, 3 - int((v % 1) * 4)) == tuple(cell):
            for i in p.loop_indices: uv[i].uv.x += du; uv[i].uv.y += dv
def cut(o, test):
    M = o.matrix_world
    bm = bmesh.new(); bm.from_mesh(o.data)
    kill = [f for f in bm.faces if test(M @ f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(o.data); bm.free()
def cut_cell(o, cell):
    uvl = None
    bm = bmesh.new(); bm.from_mesh(o.data); uvl = bm.loops.layers.uv[0]
    kill = []
    for f in bm.faces:
        u = sum(l[uvl].uv.x for l in f.loops) / len(f.loops); v = sum(l[uvl].uv.y for l in f.loops) / len(f.loops)
        if (int(u * 8) % 8, 3 - int((v % 1) * 4)) == tuple(cell): kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(o.data); bm.free()

# ---------- 소품: 단순한 도형을 뼈에 붙인다 ----------
rig = None
def mat(name, hexcol, rough=0.85, double=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    lin = [(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in srgb(hexcol)]
    b.inputs['Base Color'].default_value = (*lin, 1); b.inputs['Roughness'].default_value = rough
    m.use_backface_culling = not double
    return m
def attach(o, bone, m, name=None, smooth=True):
    o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = smooth
    mw = o.matrix_world.copy()
    o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = bone
    bpy.context.view_layer.update()
    o.matrix_world = mw
    if name: o.name = name; o.data.name = name
    return o
def prim(kind, loc, rot=(0, 0, 0), scale=(1, 1, 1), **kw):
    getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, rotation=rot, **kw)
    o = bpy.context.active_object; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o
def join(parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
    return parts[0]
def cone(z_top, r_top, z_bot, r_bot, verts=28, y=0.0):
    o = prim('cone', (0, y, (z_top + z_bot) / 2), radius1=r_bot, radius2=r_top, depth=z_top - z_bot, vertices=verts, end_fill_type='NOTHING')
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return o
def cut_front(o, half_deg):
    bm = bmesh.new(); bm.from_mesh(o.data)
    kill = [f for f in bm.faces if math.degrees(abs(math.atan2(f.calc_center_median().x, -f.calc_center_median().y))) < half_deg]
    bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(o.data); bm.free()
    return o

# 손에 든 물건은 Idle 동작으로 선 자세에서 세워 붙인다 (T자세에서 붙이면 서 있을 때 앞으로 눕는다)
def posed(fn):
    def run(*a, **kw):
        act = bpy.data.actions.get('Idle')
        if not rig.animation_data: rig.animation_data_create()
        rig.animation_data.action = act
        try: rig.animation_data.action_slot = act.slots[0]
        except Exception: pass
        rig.data.pose_position = 'POSE'; bpy.context.scene.frame_set(1); bpy.context.view_layer.update()
        out = fn(*a, **kw)
        rig.data.pose_position = 'REST'; rig.animation_data.action = None; bpy.context.view_layer.update()
        return out
    return run
def hand(bone='handslot.r'):
    return rig.matrix_world @ rig.pose.bones[bone].head
@posed
def pole(top, hexcol, r=0.035, name='Pole', bone='handslot.r', tip=None, knob=None, blade=None):
    # 땅에서 top 높이까지 곧게 선 막대, 손이 쥔 곳에 붙는다
    h = hand(bone); bot = 0.04
    parts = [(prim('cylinder', (h.x, h.y, (top + bot) / 2), radius=r, depth=top - bot, vertices=8), mat(name, hexcol))]
    if tip: parts.append((prim('cone', (h.x, h.y, top + 0.11), radius1=r * 2, depth=0.24, vertices=6), mat(name + '_tip', tip, 0.4)))
    if knob: parts.append((prim('uv_sphere', (h.x, h.y, top), radius=r * 2.2, segments=10, ring_count=6), mat(name + '_knob', knob)))
    if blade: parts.append((prim('cube', (h.x, h.y - 0.13, top - 0.05), rot=(math.radians(-25), 0, 0), scale=(0.03, 0.22, 0.09)), mat(name + '_blade', blade, 0.5)))
    for i, (o, m) in enumerate(parts): attach(o, bone, m, name + str(i), smooth=i == 0)
@posed
def basket(hexcol, fill):
    h = hand('handslot.l')
    b = prim('cylinder', (h.x, h.y, h.z - 0.22), radius=0.22, depth=0.22, vertices=14, end_fill_type='TRIFAN')
    attach(b, 'handslot.l', mat('basket', hexcol), 'Basket')
    g = prim('uv_sphere', (h.x, h.y, h.z - 0.13), scale=(0.2, 0.2, 0.07), segments=10, ring_count=6)
    attach(g, 'handslot.l', mat('herbs', fill), 'Herbs')
    hd = prim('torus', (h.x, h.y, h.z - 0.13), rot=(0, math.radians(90), 0), major_radius=0.2, minor_radius=0.018, major_segments=16, minor_segments=5)
    attach(hd, 'handslot.l', mat('basket', hexcol), 'BasketHandle')

def skirt(hexcol, top=0.62, rt=0.37, bot=0.12, rb=0.52, trim=None):
    s = cone(top, rt, bot, rb); attach(s, 'hips', mat('skirt', hexcol, double=True), 'Skirt')
    if trim: attach(prim('torus', (0, 0, bot + 0.01), major_radius=rb, minor_radius=0.022, major_segments=28, minor_segments=6), 'hips', mat('skirt_trim', trim), 'SkirtTrim')
def apron(hexcol, bib=1.05, waist=0.62, bot=0.2, w=0.34, y=-0.4, skirt_y=None):
    # 가슴받이(가슴뼈) + 치마(엉덩이뼈) 두 장
    m = mat('apron', hexcol)
    attach(prim('cube', (0, y + 0.01, (bib + waist) / 2), scale=(w * 0.75, 0.012, (bib - waist) / 2)), 'chest', m, 'ApronBib', smooth=False)
    sy = y if skirt_y is None else skirt_y
    attach(prim('cube', (0, sy - 0.01, (waist + bot) / 2), scale=(w, 0.012, (waist - bot) / 2)), 'hips', m, 'Apron', smooth=False)
def backpack(hexcol, roll=None, big=1.0):
    b = prim('cube', (0, 0.42 + 0.06 * big, 0.95), scale=(0.27 * big, 0.13 * big, 0.3 * big)); attach(b, 'chest', mat('pack', hexcol), 'Pack', smooth=False)
    if roll:
        r = prim('cylinder', (0, 0.44 + 0.06 * big, 0.95 + 0.33 * big), rot=(0, math.radians(90), 0), radius=0.11 * big, depth=0.7 * big, vertices=12)
        attach(r, 'chest', mat('roll', roll), 'Bedroll')
def brim_hat(hexcol, band, z=1.98, brim=0.85, crown=0.56, h=0.36, name='Hat'):
    b = prim('cylinder', (0, 0.02, z), radius=brim, depth=0.05, vertices=28)
    c = prim('cone', (0, 0.02, z + h / 2), radius1=crown, radius2=crown * 0.8, depth=h, vertices=24)
    attach(join([b, c]), 'head', mat(name, hexcol), name)
    if band: attach(prim('cone', (0, 0.02, z + 0.07), radius1=crown + 0.012, radius2=crown * 0.95 + 0.012, depth=0.1, vertices=24, end_fill_type='NOTHING'), 'head', mat(name + '_band', band, double=True), name + 'Band')
def beard(hexcol, length=0.35, w=0.28, z=1.3, y=-0.42):
    m = mat('beard', hexcol)
    b = prim('uv_sphere', (0, y, z - length * 0.4), scale=(w, 0.16, length), segments=14, ring_count=8)
    mu = prim('uv_sphere', (0, y - 0.1, 1.42), scale=(0.22, 0.08, 0.07), segments=12, ring_count=6)
    attach(join([b, mu]), 'head', m, 'Beard')
TUFTS = [(0.0,-0.36,2.12,-60,0),(0.22,-0.33,2.1,-55,30),(-0.22,-0.34,2.08,-55,-30),(0.12,-0.12,2.3,-25,15),(-0.14,-0.1,2.3,-25,-20),
         (0.0,0.15,2.32,20,0),(0.38,-0.12,1.98,-10,70),(-0.38,-0.12,1.98,-10,-70),(0.3,0.25,2.1,35,40),(-0.3,0.25,2.1,35,-40)]
def mop(hexcol, n=14, seed=3, r=0.17):
    # 덥수룩한 머리: 머리 위쪽에 둥근 덩어리를 흩어 붙인다
    rnd = np.random.default_rng(seed); parts = []
    for i in range(n):
        a = rnd.uniform(0, 2 * math.pi); up = rnd.uniform(0.25, 1.0)
        x, y = math.sin(a) * 0.48 * (1 - up * 0.45), math.cos(a) * 0.46 * (1 - up * 0.45)
        if y < -0.25 and up < 0.6: up = 0.6   # 얼굴은 가리지 않는다
        parts.append(prim('uv_sphere', (x, y + 0.05, 1.72 + up * 0.5), radius=r * rnd.uniform(0.8, 1.2), segments=8, ring_count=5))
    attach(join(parts), 'head', mat('mop', hexcol), 'HairMop')
def tufts(hexcol, size=1.0, n=10, dz=0.0):
    parts = [prim('cone', (x, y, z + dz), rot=(math.radians(rx), math.radians(ry), 0), radius1=0.12 * size, depth=0.3 * size, vertices=5)
             for (x, y, z, rx, ry) in TUFTS[:n]]
    attach(join(parts), 'head', mat('tufts', hexcol), 'HairTufts')
def shawl(hexcol, z_top=1.28, r_top=0.33, z_bot=0.82, r_bot=0.58, front=25):
    o = cut_front(cone(z_top, r_top, z_bot, r_bot), front); attach(o, 'chest', mat('shawl', hexcol, double=True), 'Shawl')
def heights(o):
    vs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return min(v.z for v in vs), max(v.z for v in vs)

# ---------- 사람마다 ----------
SKIN = 'f2c09a'
def child():
    global rig
    rig = start('Rogue', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_LegLeft', 'Rogue_LegRight'])
    h = borrow(rig, 'Knight', 'Knight_Head')
    recolor(img_of(h), {(1, 0): '7a4a2a'})
    b = bpy.data.objects['Rogue_Body']
    recolor(img_of(b), {(0, 1): '6f8a3e', (1, 1): '5b7232', (3, 2): '6b4a2e'})
    mop('7a4a2a', seed=1)
def elder():
    global rig
    rig = start('Mage', ['Mage_ArmLeft', 'Mage_ArmRight', 'Mage_Body', 'Mage_LegLeft', 'Mage_LegRight'])
    h = borrow(rig, 'Rogue', 'Rogue_Head')
    cut_cell(h, (3, 0))   # 귀걸이
    recolor(img_of(h), {(1, 0): 'e8e4dc'})
    recolor(img_of(bpy.data.objects['Mage_Body']), {(0, 1): '6a3f86', (3, 0): '8a6a3a', (5, 0): '7a5636', (4, 0): 'c9a24a'})
    skirt('6a3f86', trim='4b2b62')
    beard('e8e4dc', length=0.42, w=0.27)
    pole(1.75, '6b4426', r=0.04, name='Staff', knob='5a3a20')
def farmer():
    global rig
    rig = start('Rogue', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_LegLeft', 'Rogue_LegRight'])
    h = borrow(rig, 'Knight', 'Knight_Head')
    recolor(img_of(h), {(1, 0): '5a3a22'})
    b = bpy.data.objects['Rogue_Body']
    recolor(img_of(b), {(0, 1): '4f7fb5', (1, 1): '3d6798', (3, 2): '7a5634'})
    brim_hat('d8b25c', '9b7a3a', z=1.9, h=0.5, crown=0.58, name='StrawHat')
    pole(1.75, '8a6a44', name='Hoe', blade='9aa0a8')
def granny():
    global rig
    rig = start('Mage', ['Mage_ArmLeft', 'Mage_ArmRight', 'Mage_Body', 'Mage_Head', 'Mage_LegLeft', 'Mage_LegRight'])
    h = bpy.data.objects['Mage_Head']
    paint(h, (1, 0), 'c9c6c0')   # 머리카락(쪽 진 머리)만 회색
    recolor(img_of(bpy.data.objects['Mage_Body']), {(0, 1): '6c6f78', (3, 0): '7a5636', (5, 0): '7a5636', (4, 0): '8b6b45'})
    skirt('5c5f68')
    shawl('9a6b3e')
    basket('b88a4e', '6b8f3a')
def guard():
    global rig
    rig = start('Knight', ['Knight_ArmLeft', 'Knight_ArmRight', 'Knight_Body', 'Knight_Head', 'Knight_Helmet', 'Knight_LegLeft', 'Knight_LegRight'])
    recolor(img_of(bpy.data.objects['Knight_Body']), {(3, 0): '9aa1ab', (7, 0): '6d737c', (0, 1): '5a3a28', (2, 1): '6b4a2e', (7, 1): '4a3326'})
    pole(2.5, '6b4426', name='Spear', tip='b8bec6')
def hermit():
    global rig
    rig = start('Rogue_Hooded', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_Head_Hooded', 'Rogue_LegLeft', 'Rogue_LegRight'])
    recolor(img_of(bpy.data.objects['Rogue_Body']), {(0, 1): '6e5038', (1, 1): '7e5c3e', (3, 2): '5a4030', (6, 0): '4a3426'})
    skirt('6e5038', top=0.66, bot=0.08, rb=0.5)
    beard('b8b2a6', length=0.38, w=0.24)
    pole(1.3, '5a3a20', name='Cane', knob='4a2e18')
    backpack('7a5634', roll='9a8a6a')
def innkeeper():
    global rig
    rig = start('Rogue', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_LegLeft', 'Rogue_LegRight'])
    h = borrow(rig, 'Knight', 'Knight_Head')
    recolor(img_of(h), {(1, 0): '7a4a2a'})
    recolor(img_of(bpy.data.objects['Rogue_Body']), {(0, 1): '8a5a36', (1, 1): '7a4e2e', (3, 2): '5a4030'})
    tufts('7a4a2a', size=0.9)
    apron('efe9dc', bot=0.16)
def merchant():
    global rig
    rig = start('Rogue', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_Cape', 'Rogue_LegLeft', 'Rogue_LegRight'])
    h = borrow(rig, 'Knight', 'Knight_Head')
    recolor(img_of(h), {(1, 0): '4a3020'})
    recolor(img_of(bpy.data.objects['Rogue_Body']), {(0, 1): '3e6a3a', (1, 1): '2f5a34', (3, 2): '6b4a2e'})
    brim_hat('4a3628', '2e2018', brim=0.8, name='Hat')
    backpack('8a5a2e', roll='a0784a', big=1.25)
def priest():
    global rig
    rig = start('Mage', ['Mage_ArmLeft', 'Mage_ArmRight', 'Mage_Body', 'Mage_LegLeft', 'Mage_LegRight', 'Spellbook'])
    h = borrow(rig, 'Knight', 'Knight_Head')
    recolor(img_of(h), {(1, 0): '7a4a2a'})
    recolor(img_of(bpy.data.objects['Mage_Body']), {(0, 1): 'f1ebdc', (3, 0): 'c9a24a', (5, 0): 'c9a24a', (4, 0): 'e6dfcf', (2, 2): '6b4a2e'})
    recolor(img_of(bpy.data.objects['Spellbook']), {(5, 1): '6b3a22', (1, 2): '6b3a22'})
    skirt('f1ebdc', top=0.62, bot=0.06, rb=0.5, trim='c9a24a')
    for s in (1, -1):
        st = prim('cube', (s * 0.12, -0.4, 1.0), rot=(0, math.radians(s * 8), 0), scale=(0.045, 0.012, 0.26))
        attach(st, 'chest', mat('stole', 'c9a24a'), 'Stole' + ('L' if s > 0 else 'R'))
def smith():
    global rig
    rig = start('Barbarian', ['Barbarian_ArmLeft', 'Barbarian_ArmRight', 'Barbarian_Body', 'Barbarian_Head', 'Barbarian_LegLeft', 'Barbarian_LegRight'])
    recolor(img_of(bpy.data.objects['Barbarian_Head']), {(1, 0): '2e2622'})
    recolor(img_of(bpy.data.objects['Barbarian_Body']), {(0, 1): '7c6a52', (1, 1): '8a7a62', (2, 1): '5a4030', (7, 1): '4a3426', (3, 2): '4a3a30'})
    mop('3e3028', seed=5, r=0.16)
    apron('6b4428', bot=0.18, w=0.38, y=-0.42)
def traveler():
    global rig
    rig = start('Rogue_Hooded', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_Cape', 'Rogue_Head_Hooded', 'Rogue_LegLeft', 'Rogue_LegRight'])
    recolor(img_of(bpy.data.objects['Rogue_Body']), {(1, 1): '5f7a3e', (0, 1): '6e7a52', (3, 2): '6b5a40'})
    pole(2.3, '6b4426', name='Spear', tip='b8bec6')
    backpack('7a5634', roll='8a9a6a')
def woman():
    global rig
    rig = start('Rogue', ['Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_Body', 'Rogue_Head', 'Rogue_LegLeft', 'Rogue_LegRight'])
    h = bpy.data.objects['Rogue_Head']
    cut_cell(h, (3, 0))   # 귀걸이
    recolor(img_of(h), {(1, 0): 'c0562a'})
    recolor(img_of(bpy.data.objects['Rogue_Body']), {(0, 1): 'b8322c', (1, 1): '9c2a26', (3, 2): '6b4a2e'})
    skirt('b8322c', top=0.62, bot=0.1, rb=0.48)
    apron('f2efe6', bib=1.0, bot=0.14, w=0.3, y=-0.4, skirt_y=-0.47)

NPCS = dict(child=child, elder=elder, farmer=farmer, granny=granny, guard=guard, hermit=hermit, innkeeper=innkeeper,
            merchant=merchant, priest=priest, smith=smith, traveler=traveler, woman=woman)
for who in (args[2:] or list(NPCS)):
    free.clear()
    NPCS[who]()
    for a in list(bpy.data.actions):
        if a.name not in KEEP_ACTIONS: bpy.data.actions.remove(a)
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.startswith('Icosphere'): bpy.data.objects.remove(o)
    for i in bpy.data.images:
        if i.size[0] > TEX: i.scale(TEX, TEX)
        i.pack()
    rig.data.pose_position = 'POSE'
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, who + '.glb'), export_format='GLB', export_animation_mode='ACTIONS', export_image_format='AUTO')
    print('DONE', who, sorted(o.name for o in bpy.data.objects if o.type == 'MESH'))
