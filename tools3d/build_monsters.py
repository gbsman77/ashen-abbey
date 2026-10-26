# 몬스터 3D 모델: 단순한 도형(바위·공·원기둥)을 뼈에 붙여 몬스터를 빚고, 동작을 손으로 키프레임해 GLB 로 내보낸다.
# 사람 모양 몬스터는 KayKit Adventurers / Skeletons (CC0) 몸을 다시 칠해 쓴다 (KAYKIT 폴더에 <이름>.glb).
# usage: python3 build_monsters.py -- <KayKit glb 폴더> <out 폴더> [이름 ...]   (이름 없으면 전부)
# 블렌더 좌표: Z 위, 몬스터 얼굴은 -Y 쪽 (glTF 로 나가면 +Z). 뼈는 모두 위(+Z)를 보게 세워서
#   뼈의 X 회전 + = 그 뼈 위쪽이 앞으로 숙음 (아래로 늘어진 팔은 뒤로), Y 회전 = 좌우로 돎, Z 회전 = 옆으로 기울어짐
# 동작 이름 (world3d.js MON3D 가 쓰는 것): Idle(되풀이) · Attack · Hit · Death · Cast(마법) · Breath(숨결)
import bpy, sys, os, math, random, bmesh
from mathutils import Vector, Euler

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(args[0]), os.path.abspath(args[1])
FPS = 30

def srgb(h): return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
def lin(h): return [(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in srgb(h)]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS

# ---------- 재질 ----------
MATS = {}
def mat(name, hexcol, rough=0.9, metal=0.0, emit=None, power=1.0, alpha=None, double=False):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*lin(hexcol), 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*lin(emit), 1); b.inputs['Emission Strength'].default_value = power
    if alpha is not None:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    m.use_backface_culling = not double
    MATS[name] = m
    return m

# ---------- 도형 ----------
def prim(kind, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), **kw):
    getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, rotation=[math.radians(a) for a in rot], **kw)
    o = bpy.context.active_object; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o
def rock(loc, size, seed, sub=1, jit=0.2, rot=(0, 0, 0)):
    # 울퉁불퉁한 바위 덩이: 이코스피어 꼭짓점을 흔든다
    o = prim('ico_sphere', loc, rot, size, subdivisions=sub, radius=1)
    r = random.Random(seed)
    for v in o.data.vertices: v.co *= 1 + r.uniform(-jit, jit)
    return o
def ball(loc, size, rot=(0, 0, 0), seg=16, rings=10):
    return prim('uv_sphere', loc, rot, size, segments=seg, ring_count=rings, radius=1)
def cyl(loc, r, depth, rot=(0, 0, 0), verts=8, r2=None, scale=(1, 1, 1)):
    if r2 is None: o = prim('cylinder', loc, rot, scale, radius=r, depth=depth, vertices=verts)
    else: o = prim('cone', loc, rot, scale, radius1=r, radius2=r2, depth=depth, vertices=verts)
    return o
def crystal(base, direction, length, r, seed=0):
    # 육각 기둥 + 뾰족한 끝. base 에서 direction 쪽으로 자란다
    d = Vector(direction).normalized()
    shaft = prim('cylinder', (0, 0, length * 0.35), radius=r, depth=length * 0.7, vertices=6)
    tip = prim('cone', (0, 0, length * 0.85), radius1=r, radius2=0, depth=length * 0.3, vertices=6)
    o = join([shaft, tip])
    o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    o.location = base
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
    return o
def tube(points, radii, verts=8):
    # 점들을 따라 굵기가 바뀌는 관 (꼬리·목·손가락)
    bm = bmesh.new(); rings = []
    pts = [Vector(p) for p in points]
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        q = Vector((0, 0, 1)).rotation_difference(d)
        ring = []
        for k in range(verts):
            a = 2 * math.pi * k / verts
            ring.append(bm.verts.new(p + q @ Vector((math.cos(a) * radii[i], math.sin(a) * radii[i], 0))))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(verts):
            bm.faces.new([rings[i][k], rings[i][(k + 1) % verts], rings[i + 1][(k + 1) % verts], rings[i + 1][k]])
    bm.faces.new(list(reversed(rings[0])))
    if radii[-1] > 1e-4: bm.faces.new(rings[-1])
    else: bmesh.ops.pointmerge(bm, verts=rings[-1], merge_co=pts[-1])
    me = bpy.data.meshes.new('tube'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('tube', me); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    return o
def sheet(points, thick=0.02):
    # 날개 막: 점들(볼록 다각형)을 이은 얇은 판
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in points]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('sheet'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('sheet', me); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    if thick:
        sol = o.modifiers.new('s', 'SOLIDIFY'); sol.thickness = thick; sol.offset = 0
        bpy.ops.object.modifier_apply(modifier='s')
    return o
def join(parts):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
    return parts[0]
def mirror_x(o):
    # 오른쪽(-X) 짝을 만든다
    c = o.copy(); c.data = o.data.copy(); bpy.context.collection.objects.link(c)
    c.scale = (-1, 1, 1); bpy.context.view_layer.objects.active = c
    bpy.ops.object.select_all(action='DESELECT'); c.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bm = bmesh.new(); bm.from_mesh(c.data); bmesh.ops.reverse_faces(bm, faces=bm.faces[:]); bm.to_mesh(c.data); bm.free()
    return c

# ---------- 뼈대 ----------
rig = None
def make_rig(bones):
    # bones: [(이름, 머리 위치, 부모)] - 뼈는 모두 머리에서 위로 0.12
    global rig
    arm = bpy.data.armatures.new('Rig'); rig = bpy.data.objects.new('Rig', arm)
    bpy.context.collection.objects.link(rig); bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, parent in bones:
        b = arm.edit_bones.new(name); b.head = head; b.tail = Vector(head) + Vector((0, 0, 0.12)); b.roll = 0
        if parent: b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones: pb.rotation_mode = 'XYZ'
    return rig
def attach(o, bone, m, smooth=False, name=None):
    o.data.materials.clear(); o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = smooth
    mw = o.matrix_world.copy()
    o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = bone
    bpy.context.view_layer.update()
    o.matrix_world = mw
    o.name = name or (bone + '_' + m.name)
    return o
def part(bone, m, objs, smooth=False, name=None):
    o = join(objs) if isinstance(objs, list) else objs
    return attach(o, bone, m, smooth, name)

# ---------- KayKit 사람 몸 다시 쓰기 ----------
def imp(name):
    before = set(bpy.data.objects); acts = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + '.glb'))
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]
def kay_start(base, keep):
    global rig
    reset(); MATS.clear()
    objs, _ = imp(base)
    rig = [o for o in objs if o.type == 'ARMATURE'][0]
    rig.data.pose_position = 'REST'
    for o in objs:
        if o.type == 'MESH' and o.name not in keep: bpy.data.objects.remove(o)
    return rig
def kay_borrow(base, part_name):
    # 다른 KayKit 캐릭터의 부품(머리·무기·방패)을 같은 뼈대로 옮겨 단다. 손에 든 것은 같은 뼈(handslot)에
    objs, acts = imp(base)
    p = [o for o in objs if o.name.startswith(part_name)][0]
    for o in objs:
        if o.type == 'ARMATURE': o.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    mw = p.matrix_world.copy(); pb = p.parent_bone if p.parent_type == 'BONE' else None
    p.parent = rig
    if pb: p.parent_type = 'BONE'; p.parent_bone = pb
    bpy.context.view_layer.update(); p.matrix_world = mw
    for o in objs:
        if o is not p: bpy.data.objects.remove(o)
    for a in acts: bpy.data.actions.remove(a)
    for m in p.modifiers:
        if m.type == 'ARMATURE': m.object = rig
    p.name = part_name
    return p
def kay_mesh(name): return bpy.data.objects[name]
def retex(objs, fn, tag):
    # 이 부품들이 쓰는 KayKit 색 칸 그림을 복사해 픽셀마다 fn(rgb 배열) 으로 다시 칠한다 (다른 부품은 그대로)
    import numpy as np
    done = {}
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if m is None: continue
            if m.name not in done:
                m2 = m.copy(); m2.name = m.name + '_' + tag
                tex = [n for n in m2.node_tree.nodes if n.type == 'TEX_IMAGE']
                if tex:
                    img = tex[0].image.copy(); img.name = tex[0].image.name + '_' + tag
                    W, H = img.size
                    px = np.array(img.pixels[:]).reshape(H, W, 4)
                    px[..., :3] = np.clip(fn(px[..., :3]), 0, 1)
                    img.pixels[:] = px.ravel()
                    if W > 512: img.scale(512, 512)
                    img.pack(); tex[0].image = img
                done[m.name] = m2
            slot.material = done[m.name]
def lum(c): return c @ [0.3, 0.59, 0.11]
def toward(c, hexcol, k=1.0):
    # 밝기는 두고 빛깔만 hexcol 쪽으로
    import numpy as np
    t = np.array(srgb(hexcol)); l = lum(c)[..., None]
    return c * (1 - k) + k * np.clip(t * l / max(lum(t), 1e-3), 0, 1)
def skin_mask(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    return (r > 0.55) & (r > g) & (g > b) & (r - b > 0.12) & (r - b < 0.5) & (g > 0.4)
def flat(o, m):
    o.data.materials.clear(); o.data.materials.append(m)
def eyes_at(head, xs, z, m, size=(0.06, 0.03, 0.04), bone='head', dz=0.0):
    out = []
    for x in xs:
        y = surface(head, x, z)
        if y is None: continue
        out.append(attach(ball((x, y + 0.01, z + dz), size), bone, m, True))
    return out
def kay_actions(rename):
    # rename = {새 이름: KayKit 동작 이름}. 나머지 동작은 버린다
    keep = {v: k for k, v in rename.items()}
    for a in list(bpy.data.actions):
        if a.name in keep: a.name = '~' + keep[a.name]
        else: bpy.data.actions.remove(a)
    for a in bpy.data.actions: a.name = a.name[1:]; a.use_fake_user = True
    if rig.animation_data: rig.animation_data.action = None
    rig.data.pose_position = 'POSE'
def surface(o, x, z, y0=-2.0):
    # 앞(-Y)에서 쏜 광선이 처음 닿는 곳의 y (세계 좌표)
    inv = o.matrix_world.inverted()
    ok, loc, *_ = o.ray_cast(inv @ Vector((x, y0, z)), (inv.to_3x3() @ Vector((0, 1, 0))).normalized())
    return (o.matrix_world @ loc).y if ok else None
def stripe_mat(name, bands):
    # 띠 무늬 그림 한 줄 (bands = [(색, 칸 수)...]) 을 가로로 되풀이해 칠하는 재질. 잘게 나누지 않고 UV 로 띠를 그린다
    W = sum(n for _, n in bands)
    img = bpy.data.images.new(name, W, 2)
    px = []
    for _ in range(2):
        for col, n in bands: px += (srgb(col) + [1]) * n
    img.pixels[:] = px; img.pack()
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; b.inputs['Roughness'].default_value = 0.95
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Closest'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    return m
def wrap(o, m, period=0.2, tilt=0.35, extra=None):
    # 붕대: 면마다 가장 많이 매달린 뼈의 방향을 따라 띠 좌표를 UV 로 준다 (뼈마다 띠가 그 팔다리를 감는다)
    bm = bmesh.new(); bm.from_mesh(o.data)
    dl = bm.verts.layers.deform.verify()
    uvl = bm.loops.layers.uv.verify()
    names = {i: g.name for i, g in enumerate(o.vertex_groups)}
    M = o.matrix_world; RM = rig.matrix_world
    o.data.materials.clear(); o.data.materials.append(m)
    for f in bm.faces:
        w = {}
        for v in f.verts:
            for gi, wt in v[dl].items(): w[gi] = w.get(gi, 0) + wt
        bone = rig.data.bones.get(names.get(max(w, key=w.get), '')) if w else None
        f.smooth = False
        if extra:
            e = extra(M @ f.calc_center_median(), bone and bone.name)
            if e is not None:
                if e not in o.data.materials[:]: o.data.materials.append(e)
                f.material_index = list(o.data.materials).index(e); continue
        if bone is None: continue
        h = RM @ bone.head_local; ax = (RM.to_3x3() @ (bone.tail_local - bone.head_local)).normalized()
        side = ax.cross(Vector((0, 1, 0))); side = side.normalized() if side.length > 0.1 else Vector((1, 0, 0))
        for l in f.loops:
            c = M @ l.vert.co
            l[uvl].uv = (((c - h).dot(ax) + tilt * (c - h).dot(side)) / period + 0.37 * (len(bone.name) % 5), 0.5)
    bm.to_mesh(o.data); bm.free()

def skin(o, m, weights, smooth=False, name=None):
    # 휘는 부품 (날개 막): 꼭짓점마다 weights(세계 좌표) -> {뼈: 무게} 로 매단다
    o.data.materials.clear(); o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = smooth
    groups = {}
    for v in o.data.vertices:
        for b, w in weights(o.matrix_world @ v.co).items():
            if b not in groups: groups[b] = o.vertex_groups.new(name=b)
            groups[b].add([v.index], w, 'REPLACE')
    mw = o.matrix_world.copy(); o.parent = rig; o.matrix_world = mw
    mod = o.modifiers.new('arm', 'ARMATURE'); mod.object = rig
    o.name = name or ('skin_' + m.name)
    return o
def mesh(verts, faces, name='mesh', thick=0.0):
    me = bpy.data.meshes.new(name); me.from_pydata([Vector(v) for v in verts], [], faces); me.update()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o
    if thick:
        sol = o.modifiers.new('s', 'SOLIDIFY'); sol.thickness = thick; sol.offset = 0
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.ops.object.modifier_apply(modifier='s')
    return o

# ---------- 동작 ----------
# keys = {프레임: {뼈: (rx, ry, rz) 도, '뼈@': (x, y, z) 옮김, '뼈^': (sx, sy, sz) 크기}} - 어느 프레임에 안 적힌 뼈는 쉬는 자세(0, 크기 1)
def anim(name, keys):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    chans = set()
    for pose in keys.values(): chans |= set(pose)
    for f in sorted(keys):
        pose = keys[f]
        for ch in chans:
            if ch.endswith('^'):
                pb = rig.pose.bones[ch[:-1]]; pb.scale = pose.get(ch, (1, 1, 1)); pb.keyframe_insert('scale', frame=f)
            elif ch.endswith('@'):
                x, y, z = pose.get(ch, (0, 0, 0)); pb = rig.pose.bones[ch[:-1]]; pb.location = (x, z, -y)   # 뼈 안 좌표 (Y 가 위)
                pb.keyframe_insert('location', frame=f)
            else:
                pb = rig.pose.bones[ch]; pb.rotation_euler = [math.radians(a) for a in pose.get(ch, (0, 0, 0))]
                pb.keyframe_insert('rotation_euler', frame=f)
    for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    rig.animation_data.action = None
    return act
def loop(period, fn, n=4):
    # 되풀이 동작: fn(0..1) 이 그리는 자세를 n+1 개 키로 (처음과 끝이 같다)
    return {round(period * i / n): fn(i / n) for i in range(n + 1)}
S = lambda t, k=1: math.sin(2 * math.pi * t * k)

def export(name):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', export_animation_mode='ACTIONS',
                              export_apply=True, export_yup=True)
    print('DONE', name, len([o for o in bpy.data.objects if o.type == 'MESH']), 'parts', [a.name for a in bpy.data.actions])

# ======================================================================
# 돌 골렘 (광산 보스): 모래빛 바위 덩이 몸, 굵은 팔에 큰 주먹, 어깨·머리·팔에 푸른 수정, 푸르게 빛나는 눈
def golem(name='golem', crystals=True, rock_hex=('b49c6a', '8a7550'), eye_hex=('6cc4ff', '2a9cff')):
    reset(); MATS.clear()
    make_rig([('root', (0, 0, 0), None), ('hips', (0, 0, 0.95), 'root'), ('chest', (0, 0, 1.25), 'hips'),
              ('head', (0, -0.22, 1.85), 'chest'),
              ('arm.L', (0.82, 0, 1.78), 'chest'), ('fore.L', (1.0, -0.06, 1.18), 'arm.L'),
              ('arm.R', (-0.82, 0, 1.78), 'chest'), ('fore.R', (-1.0, -0.06, 1.18), 'arm.R'),
              ('leg.L', (0.38, 0, 0.9), 'hips'), ('leg.R', (-0.38, 0, 0.9), 'hips')])
    rk = mat('rock', rock_hex[0], 0.95); dk = mat('rock_dark', rock_hex[1], 0.95); cr = mat('crystal', '9ad8ff', 0.25, 0.1, emit='3d8cff', power=1.6)
    eye = mat('eye', eye_hex[0], 0.4, emit=eye_hex[1], power=3)
    def P(bone, m, objs, **kw):   # 수정 없는 골렘은 수정 조각을 버린다
        if m is cr and not crystals:
            for o in objs: bpy.data.objects.remove(o)
        else: part(bone, m, objs, **kw)
    n = [0]
    def R(loc, size, sub=1, jit=0.2):
        n[0] += 1; return rock(loc, size, n[0] * 7 + 1, sub, jit)
    # 다리·발
    for s, leg in ((1, 'leg.L'), (-1, 'leg.R')):
        P(leg, rk, [R((s * 0.4, 0, 0.66), (0.32, 0.32, 0.34)), R((s * 0.44, -0.08, 0.24), (0.38, 0.42, 0.26))])
        P(leg, dk, [R((s * 0.4, -0.3, 0.12), (0.12, 0.1, 0.1)), R((s * 0.55, -0.26, 0.12), (0.11, 0.1, 0.1)), R((s * 0.27, -0.27, 0.12), (0.1, 0.1, 0.09))])
    # 몸: 허리 덩이 + 큰 가슴 덩이 + 가슴판
    P('hips', dk, [R((0, 0.02, 1.0), (0.52, 0.42, 0.3))])
    P('chest', rk, [R((0, 0.06, 1.48), (0.78, 0.56, 0.5), 2, 0.12), R((0.3, -0.36, 1.55), (0.3, 0.16, 0.26)), R((-0.3, -0.36, 1.55), (0.3, 0.16, 0.26)),
                       R((0, -0.3, 1.2), (0.36, 0.2, 0.22))])
    P('chest', dk, [R((0, 0.36, 1.78), (0.5, 0.3, 0.26)), R((0.35, 0.3, 1.25), (0.22, 0.2, 0.2)), R((-0.35, 0.3, 1.25), (0.22, 0.2, 0.2))])
    # 머리: 어깨 사이에 묻혀 앞으로 나온 작은 바위, 눈썹 바위 아래 빛나는 눈
    P('head', rk, [R((0, -0.34, 1.92), (0.27, 0.25, 0.24)), R((0, -0.52, 1.83), (0.17, 0.1, 0.1))])
    P('head', dk, [R((0, -0.5, 2.02), (0.26, 0.09, 0.07))])
    P('head', eye, [ball((0.1, -0.55, 1.95), (0.05, 0.03, 0.035)), ball((-0.1, -0.55, 1.95), (0.05, 0.03, 0.035))], smooth=True)
    # 팔: 큰 어깨 바위, 윗팔, 아래팔, 큰 주먹
    for s, a, f in ((1, 'arm.L', 'fore.L'), (-1, 'arm.R', 'fore.R')):
        P(a, rk, [R((s * 0.86, 0.02, 1.8), (0.4, 0.38, 0.34), 2, 0.12), R((s * 0.98, -0.04, 1.36), (0.27, 0.27, 0.3))])
        P(f, rk, [R((s * 1.02, -0.08, 0.98), (0.3, 0.3, 0.3))])
        P(f, dk, [R((s * 1.05, -0.14, 0.52), (0.44, 0.42, 0.38), 2, 0.14)])
        P(f, rk, [R((s * (1.05 + 0.15 * k), -0.5, 0.48 + 0.06 * (k == 0)), (0.12, 0.12, 0.13)) for k in (-1, 0, 1)])
        # 수정: 어깨 위, 윗팔, 아래팔, 주먹
        P(a, cr, [crystal((s * 0.86, 0.0, 2.08), (s * 0.2, 0.05, 1), 0.48, 0.09), crystal((s * 1.08, 0.12, 1.98), (s * 0.8, 0.2, 0.8), 0.36, 0.07),
                     crystal((s * 0.7, -0.12, 2.06), (s * -0.1, -0.3, 1), 0.3, 0.06), crystal((s * 1.2, -0.05, 1.4), (s * 1, -0.2, 0.3), 0.26, 0.055)])
        P(f, cr, [crystal((s * 1.26, 0, 1.0), (s * 1, 0.2, 0.4), 0.24, 0.05), crystal((s * 1.38, -0.12, 0.62), (s * 1, -0.3, 0.3), 0.3, 0.06)])
    P('head', cr, [crystal((0.12, -0.25, 2.12), (0.3, 0.1, 1), 0.3, 0.06), crystal((-0.1, -0.22, 2.12), (-0.4, 0.2, 1), 0.24, 0.05)])
    P('chest', cr, [crystal((0.2, 0.42, 1.9), (0.3, 0.6, 1), 0.38, 0.07), crystal((-0.25, 0.45, 1.75), (-0.4, 0.7, 0.8), 0.32, 0.065),
                       crystal((0.42, -0.42, 1.5), (0.5, -1, 0.4), 0.22, 0.05)])
    # 동작
    anim('Idle', loop(60, lambda t: {'chest': (2 + 2 * S(t), 0, 0), 'head': (-2 * S(t), 3 * S(t, 1) * 0.5, 0), 'root@': (0, 0, -0.025 + 0.025 * S(t + 0.25)),
                                    'arm.L': (-3 - 3 * S(t), 0, 2 * S(t)), 'arm.R': (-3 - 3 * S(t + 0.1), 0, -2 * S(t)), 'fore.L': (-6, 0, 0), 'fore.R': (-6, 0, 0)}))
    up = {'chest': (-14, 0, 0), 'head': (-10, 0, 0), 'arm.L': (-160, 0, -12), 'arm.R': (-160, 0, 12), 'fore.L': (-25, 0, 0), 'fore.R': (-25, 0, 0), 'root@': (0, 0.1, 0)}
    slam = {'chest': (26, 0, 0), 'head': (8, 0, 0), 'arm.L': (-55, 0, 8), 'arm.R': (-55, 0, -8), 'fore.L': (-10, 0, 0), 'fore.R': (-10, 0, 0), 'root@': (0, -0.45, -0.12),
            'leg.L': (-18, 0, 0), 'leg.R': (14, 0, 0)}
    anim('Attack', {0: {}, 13: up, 19: slam, 26: slam, 40: {}})
    anim('Hit', {0: {}, 4: {'chest': (-14, 0, 6), 'head': (-14, 0, 0), 'root@': (0, 0.16, 0), 'arm.L': (8, 0, 10), 'arm.R': (8, 0, -10)}, 16: {}})
    anim('Death', {0: {}, 10: {'chest': (-12, 0, 0), 'arm.L': (-30, 0, 20), 'arm.R': (-30, 0, -20)},
                   34: {'root': (-82, 0, 0), 'root@': (0, 0.2, 0), 'chest': (8, 0, 0), 'head': (20, 0, 0), 'arm.L': (-110, 0, 40), 'arm.R': (-100, 0, -40), 'leg.L': (-20, 0, 0), 'leg.R': (-8, 0, 0)},
                   40: {'root': (-90, 0, 0), 'root@': (0, 0.2, -0.06), 'chest': (4, 0, 0), 'head': (24, 0, 0), 'arm.L': (-115, 0, 44), 'arm.R': (-105, 0, -44), 'leg.L': (-18, 0, 0), 'leg.R': (-6, 0, 0)}})
    export(name)
def rock_golem():
    # 자갈 골렘: 골렘과 같은 몸, 수정 없이 누런 자갈, 주황 눈
    golem('rock_golem', False, ('c2a26e', '94784c'), ('ffb040', 'ff8a10'))

# ======================================================================
# 타락한 묘지기 (묘지 보스): 붕대에 감긴 미라. 바바리안 몸 + 기사 머리를 붕대 빛으로 감고, 붉게 빛나는 눈, 늘어진 붕대 자락
def gravekeeper():
    kay_start('Barbarian', ['Barbarian_Body', 'Barbarian_ArmLeft', 'Barbarian_ArmRight', 'Barbarian_LegLeft', 'Barbarian_LegRight'])
    head = kay_borrow('Knight', 'Knight_Head')
    band = stripe_mat('bandage', [('5a4a34', 2), ('e2d4ae', 9), ('d6c6a0', 4), ('5a4a34', 2), ('c4b088', 8), ('b8a47c', 3)])
    L, Dk = mat('band', 'e0d2ac', 0.95), mat('gap', '3a2e22', 1.0)
    eyez = 1.24 + (1.66 - 1.24) * 0.8
    front = None
    # 머리가 큰 KayKit 비율을 조금 줄여 미라답게 (목 아래를 기준으로)
    hb = rig.matrix_world @ rig.data.bones['head'].head_local
    for v in head.data.vertices:
        w = head.matrix_world @ v.co; v.co = head.matrix_world.inverted() @ (hb + (w - hb) * 0.8)
    front = surface(head, 0, eyez)
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        wrap(o, band, period=0.2)
    eye = mat('eye', 'ff3a24', 0.4, emit='ff1a08', power=5)
    for x in (0.2, -0.2):
        y = surface(head, x, eyez) or front
        attach(ball((x, y + 0.03, eyez), (0.12, 0.05, 0.075)), 'head', Dk, True)   # 붕대 틈 사이로
        attach(ball((x, y - 0.0, eyez), (0.065, 0.035, 0.045)), 'head', eye, True)
    # 늘어진 붕대 자락 (허리 앞뒤, 팔꿈치)
    def strip(x, y, z, l, w, bone, ry=0):
        o = prim('cube', (x, y, z - l / 2), (8, ry, 0), (w / 2, 0.01, l / 2)); attach(o, bone, L)
    strip(0.13, -0.35, 0.6, 0.26, 0.06, 'hips', 6); strip(0.05, 0.35, 0.6, 0.24, 0.06, 'hips')
    kay_actions({'Idle': 'Unarmed_Idle', 'Attack': '2H_Melee_Attack_Chop', 'Hit': 'Hit_B', 'Death': 'Death_A', 'Cast': 'Spellcast_Summon'})
    export('gravekeeper')

# ======================================================================
# 잿빛 용 (마지막 보스): 검은 비늘, 붉은 날개 막을 활짝 편 날개, 등·꼬리의 가시, 붉게 달아오른 가슴과 입속, 붉은 눈, 굽은 뿔
def dragon():
    reset(); MATS.clear()
    B = {
        'root': ((0, 0, 0), None), 'body': ((0, 0.25, 0.95), 'root'), 'chest': ((0, -0.3, 1.15), 'body'),
        'neck1': ((0, -0.62, 1.5), 'chest'), 'neck2': ((0, -0.78, 1.88), 'neck1'), 'head': ((0, -0.86, 2.2), 'neck2'), 'jaw': ((0, -0.96, 2.14), 'head'),
        'tail1': ((0, 0.75, 0.9), 'body'), 'tail2': ((0, 1.2, 0.62), 'tail1'), 'tail3': ((0, 1.62, 0.4), 'tail2'), 'tail4': ((0, 2.0, 0.26), 'tail3'),
    }
    for s_, k in ((1, 'L'), (-1, 'R')):
        B['wing.' + k] = ((s_ * 0.28, -0.12, 1.55), 'chest'); B['wing2.' + k] = ((s_ * 0.95, 0.0, 2.15), 'wing.' + k)
        B['fleg.' + k] = ((s_ * 0.36, -0.42, 1.0), 'chest'); B['rleg.' + k] = ((s_ * 0.4, 0.42, 0.88), 'body')
    make_rig([(n, h, p) for n, (h, p) in B.items()])
    sc = mat('scale', '38302f', 0.65); sd = mat('scale_dark', '1e1819', 0.75); sp = mat('spike', '6a2420', 0.55)
    mem = mat('membrane', '8e1a16', 0.8, emit='3a0604', power=1, double=True); bone_ = mat('wingbone', '231d1f', 0.7)
    belly = mat('belly', '6a1a10', 0.6, emit='ff3a10', power=1.4); claw = mat('claw', 'd6cbb8', 0.5)
    eye = mat('eye', 'ff5a20', 0.3, emit='ff2a08', power=7); mouth = mat('mouth', 'ff6a20', 0.5, emit='ff3a08', power=3)
    def spikes(pts, bone, size=1.0):
        for (x, y, z), h in pts:
            attach(cyl((x, y, z + h * size * 0.45), 0.06 * size, h * size, rot=(-25, 0, 0), verts=4, r2=0.0), bone, sp)
    # 몸통: 앞이 들린 큰 알 모양 + 가슴, 달아오른 배
    part('body', sc, [ball((0, 0.25, 0.98), (0.54, 0.76, 0.5), (-18, 0, 0), 14, 9)])
    part('chest', sc, [ball((0, -0.32, 1.28), (0.5, 0.5, 0.56), (-30, 0, 0), 14, 9)])
    part('chest', belly, [ball((0, -0.56, 1.16), (0.34, 0.2, 0.46), (-30, 0, 0), 12, 8)])
    part('body', belly, [ball((0, 0.05, 0.72), (0.3, 0.42, 0.16), (-10, 0, 0), 12, 8)])
    # 목·머리
    part('neck1', sc, [tube([(0, -0.5, 1.4), (0, -0.66, 1.62), (0, -0.76, 1.9)], [0.24, 0.2, 0.17], 10)])
    part('neck2', sc, [tube([(0, -0.76, 1.86), (0, -0.84, 2.06), (0, -0.88, 2.24)], [0.17, 0.15, 0.14], 10)])
    part('neck2', belly, [ball((0, -0.86, 1.98), (0.1, 0.06, 0.2), (-20, 0, 0), 10, 6)])
    part('head', sc, [ball((0, -0.9, 2.3), (0.2, 0.24, 0.17), (0, 0, 0), 12, 8),
                      tube([(0, -1.0, 2.28), (0, -1.2, 2.24), (0, -1.36, 2.2)], [0.15, 0.12, 0.08], 8)])
    part('head', sd, [ball((s_ * 0.1, -1.04, 2.38), (0.09, 0.14, 0.05), (10, 0, s_ * 20), 8, 6) for s_ in (1, -1)])   # 눈두덩
    part('head', claw, [cyl((s_ * 0.06, -1.3, 2.13), 0.022, 0.08, rot=(180, 0, 0), verts=4, r2=0) for s_ in (1, -1)] +
                       [cyl((s_ * 0.1, -1.17, 2.14), 0.02, 0.07, rot=(180, 0, 0), verts=4, r2=0) for s_ in (1, -1)])   # 윗니
    for s_ in (1, -1):
        attach(tube([(s_ * 0.12, -0.82, 2.36), (s_ * 0.2, -0.7, 2.5), (s_ * 0.24, -0.52, 2.56), (s_ * 0.22, -0.38, 2.5)], [0.06, 0.045, 0.03, 0.0], 6), 'head', sp)   # 뿔
        attach(tube([(s_ * 0.17, -0.86, 2.26), (s_ * 0.26, -0.76, 2.28), (s_ * 0.32, -0.66, 2.22)], [0.035, 0.02, 0.0], 5), 'head', sp)
        attach(ball((s_ * 0.115, -1.1, 2.33), (0.04, 0.03, 0.022), (0, 0, s_ * -25), 8, 6), 'head', eye, True)
    part('jaw', sc, [tube([(0, -0.94, 2.12), (0, -1.12, 2.1), (0, -1.3, 2.08)], [0.11, 0.09, 0.05], 8)])
    part('jaw', mouth, [ball((0, -1.08, 2.15), (0.07, 0.17, 0.03), (0, 0, 0), 8, 5)])
    part('jaw', claw, [cyl((s_ * 0.06, -1.22, 2.14), 0.018, 0.06, verts=4, r2=0) for s_ in (1, -1)])
    # 머리를 크게 (머리 뼈 자리를 기준으로)
    pv = Vector(B['head'][0])
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and o.parent_bone in ('head', 'jaw')]:
        M = o.matrix_world; Mi = M.inverted()
        for v in o.data.vertices: v.co = Mi @ (pv + (M @ v.co - pv) * 1.35)
    # 꼬리: 마디마다 굵기가 줄고 끝은 화살촉
    T = [(0, 0.62, 0.95), (0, 1.0, 0.7), (0, 1.42, 0.48), (0, 1.82, 0.32), (0, 2.25, 0.22)]
    R_ = [0.26, 0.2, 0.15, 0.1, 0.05]
    for i in range(4):
        part('tail%d' % (i + 1), sc, [tube([T[i], T[i + 1]], [R_[i], R_[i + 1]], 9)])
    part('tail4', sp, [mesh([(0, 2.2, 0.24), (0.16, 2.36, 0.22), (0, 2.6, 0.18), (-0.16, 2.36, 0.22)], [(0, 1, 2, 3)], 'tip', 0.04)])
    # 등·목·꼬리 가시
    spikes([((0, -0.62, 1.78), 0.16), ((0, -0.72, 2.08), 0.13)], 'neck1')
    spikes([((0, -0.84, 2.4), 0.12)], 'head')
    spikes([((0, -0.3, 1.74), 0.2), ((0, -0.05, 1.5), 0.2)], 'chest')
    spikes([((0, 0.25, 1.42), 0.2), ((0, 0.55, 1.28), 0.17)], 'body')
    for i, (x, y, z) in enumerate(T[1:4]): spikes([((x, y, z + R_[i + 1] - 0.02), 0.14 - 0.03 * i)], 'tail%d' % (i + 2))
    # 다리: 굵은 넓적다리, 정강이, 발톱 셋
    for s_, k in ((1, 'L'), (-1, 'R')):
        for leg, (x, y, z), big in (('fleg.' + k, (s_ * 0.38, -0.42, 1.0), 0.85), ('rleg.' + k, (s_ * 0.42, 0.42, 0.85), 1.0)):
            part(leg, sc, [ball((x + s_ * 0.06, y, z - 0.1), (0.22 * big, 0.3 * big, 0.36 * big), (-20, 0, 0), 10, 7),
                           tube([(x + s_ * 0.08, y + 0.04, z - 0.32), (x + s_ * 0.08, y - 0.02, 0.32), (x + s_ * 0.08, y - 0.08, 0.1)], [0.16 * big, 0.12 * big, 0.11 * big], 8)])
            part(leg, sd, [ball((x + s_ * 0.08, y - 0.14, 0.08), (0.17, 0.22, 0.09), (0, 0, 0), 8, 6)])
            part(leg, claw, [cyl((x + s_ * 0.08 + d, y - 0.36, 0.06), 0.04, 0.17, rot=(80, 0, d * 50), verts=4, r2=0) for d in (-0.1, 0, 0.1)])
    # 날개: 팔뼈(어깨→팔꿈치→손목→손가락 셋)와 그 사이 붉은 막. 막은 팔꿈치 안쪽은 wing, 바깥은 wing2 에 매달려 휜다
    for s_, k in ((1, 'L'), (-1, 'R')):
        sh, el, wr = (s_ * 0.28, -0.12, 1.6), (s_ * 0.95, 0.0, 2.15), (s_ * 1.5, 0.12, 2.6)
        tips = [(s_ * 2.45, 0.3, 2.95), (s_ * 2.55, 0.42, 2.15), (s_ * 2.15, 0.5, 1.4)]
        root_ = (s_ * 0.3, 0.5, 1.25)
        part('wing.' + k, bone_, [tube([sh, el], [0.07, 0.055], 6)])
        part('wing2.' + k, bone_, [tube([el, wr], [0.055, 0.045], 6)] + [tube([wr, t], [0.035, 0.012], 5) for t in tips] +
             [cyl((s_ * 1.55, 0.08, 2.72), 0.035, 0.18, rot=(0, s_ * -30, 0), verts=4, r2=0)])
        V = [sh, el, wr] + tips + [root_]
        # 막 (부채꼴): 손목-손가락 사이 둘, 마지막 손가락-몸통, 몸통-팔꿈치-어깨. 손가락 사이는 안쪽으로 조금 파인 가장자리
        mids = [((tips[0][0] + tips[1][0]) / 2 - s_ * 0.18, 0.36, (tips[0][2] + tips[1][2]) / 2), ((tips[1][0] + tips[2][0]) / 2 - s_ * 0.2, 0.46, (tips[1][2] + tips[2][2]) / 2 - 0.05),
                ((tips[2][0] + root_[0]) / 2 + s_ * 0.05, 0.5, (tips[2][2] + root_[2]) / 2 - 0.2)]
        V += mids   # 7, 8, 9
        F = [(2, 3, 7), (2, 7, 4), (2, 4, 8), (2, 8, 5), (2, 5, 9), (2, 9, 6), (2, 6, 1), (1, 6, 0)]
        if s_ < 0: F = [tuple(reversed(f)) for f in F]
        o = mesh(V, F, 'membrane', 0.025)
        def wts(c, k=k):
            t = max(0.0, min(1.0, (abs(c.x) - 0.95) / 0.55))   # 팔꿈치(0) → 손목(1)
            return {'wing.' + k: 1 - t, 'wing2.' + k: t}
        skin(o, mem, wts)
    # 동작
    def wing(a, b=0.0, fold=0.0):
        # a = 날개 들어올림(도), b = 앞뒤로 젖힘, fold = 바깥 마디 접힘
        return {'wing.L': (b, 0, a), 'wing.R': (b, 0, -a), 'wing2.L': (0, fold, -fold * 0.5), 'wing2.R': (0, -fold, fold * 0.5)}
    def pose(**kw):
        d = {}
        for k_, v in kw.items(): d.update(v) if isinstance(v, dict) else d.__setitem__(k_.replace('_at', '@').replace('_', '.'), v)
        return d
    anim('Idle', loop(72, lambda t: {**wing(6 + 10 * S(t), 0, 6 + 6 * S(t + 0.15)), 'chest': (2 * S(t), 0, 0), 'neck1': (-3 + 3 * S(t + 0.1), 4 * S(t, 1) * 0.5, 0),
                                    'neck2': (3 * S(t + 0.2), 0, 0), 'head': (-3 * S(t + 0.3), 0, 0), 'jaw': (4 + 4 * S(t + 0.4), 0, 0),
                                    'tail2': (0, 8 * S(t), 0), 'tail3': (0, 12 * S(t - 0.1), 0), 'tail4': (0, 16 * S(t - 0.2), 0), 'root@': (0, 0, 0.02 * S(t))}, 6))
    rear = {**wing(30, 10, 20), 'chest': (-14, 0, 0), 'neck1': (-22, 0, 0), 'neck2': (-10, 0, 0), 'head': (-14, 0, 0), 'jaw': (8, 0, 0), 'root@': (0, 0.12, 0)}
    bite = {**wing(-6, -10, 0), 'chest': (16, 0, 0), 'neck1': (32, 0, 0), 'neck2': (18, 0, 0), 'head': (10, 0, 0), 'jaw': (38, 0, 0), 'root@': (0, -0.55, -0.05),
            'fleg.L': (-25, 0, 0), 'fleg.R': (-15, 0, 0), 'tail2': (0, 0, 0), 'tail3': (-8, 0, 0)}
    shut = dict(bite, jaw=(0, 0, 0))
    anim('Attack', {0: {}, 12: rear, 18: bite, 22: shut, 30: shut, 44: {}})
    up = {**wing(36, 14, 24), 'chest': (-18, 0, 0), 'neck1': (-28, 0, 0), 'neck2': (-20, 0, 0), 'head': (-24, 0, 0), 'jaw': (20, 0, 0), 'root@': (0, 0.16, 0.04)}
    blow = {**wing(4, -14, 6), 'chest': (10, 0, 0), 'neck1': (22, 0, 0), 'neck2': (14, 0, 0), 'head': (2, 0, 0), 'jaw': (42, 0, 0), 'root@': (0, -0.3, 0)}
    blow2 = dict(blow, head=(6, 4, 0), jaw=(46, 0, 0))
    anim('Breath', {0: {}, 16: up, 22: blow, 34: blow2, 44: blow, 60: {}})
    anim('Hit', {0: {}, 4: {**wing(22, 12, 14), 'chest': (-16, 0, 6), 'neck1': (-16, 0, 0), 'head': (-18, 0, 0), 'jaw': (18, 0, 0), 'root@': (0, 0.18, 0)}, 16: {}})
    anim('Death', {0: {}, 10: {**wing(34, 10, 20), 'chest': (-18, 0, 0), 'neck1': (-26, 0, 0), 'head': (-22, 0, 0), 'jaw': (30, 0, 0)},
                   34: {**wing(-38, 0, -10), 'root': (0, 0, -6), 'root@': (0, 0, -0.42), 'chest': (16, 0, 0), 'neck1': (44, 0, 10), 'neck2': (20, 0, 0), 'head': (24, 0, 0), 'jaw': (12, 0, 0),
                        'fleg.L': (-40, 0, 0), 'fleg.R': (-40, 0, 0), 'rleg.L': (-20, 0, 25), 'rleg.R': (-20, 0, -25), 'tail2': (14, 0, 0), 'tail3': (8, 0, 0)},
                   44: {**wing(-44, 0, -12), 'root': (0, 0, -8), 'root@': (0, 0, -0.48), 'chest': (20, 0, 0), 'neck1': (52, 0, 12), 'neck2': (24, 0, 0), 'head': (30, 0, 0), 'jaw': (10, 0, 0),
                        'fleg.L': (-42, 0, 0), 'fleg.R': (-42, 0, 0), 'rleg.L': (-22, 0, 28), 'rleg.R': (-22, 0, -28), 'tail2': (16, 0, 0), 'tail3': (10, 0, 0)}})
    export('dragon')

# ======================================================================
# 사람 모양 몬스터: KayKit 몸에 다른 캐릭터의 무기·방패를 쥐여 주고 색을 다시 칠한다
SKEL_KEEP = lambda base, *extra: [base + '_' + p for p in ('ArmLeft', 'ArmRight', 'Body', 'Head', 'Jaw', 'Eyes', 'LegLeft', 'LegRight') + extra]

def skeleton():
    # 해골 병사: 녹슨 칼과 나무 둥근 방패, 푸르게 빛나는 눈
    kay_start('Skeleton_Warrior', SKEL_KEEP('Skeleton_Warrior'))
    flat(kay_mesh('Skeleton_Warrior_Eyes'), mat('eye', '7ad0ff', 0.4, emit='3aa8ff', power=5))
    sw = kay_borrow('Knight', '1H_Sword'); sh = kay_borrow('Barbarian', 'Barbarian_Round_Shield')
    retex([sw], lambda c: toward(c, '9a6a48', 0.7), 'rust')
    retex([o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith('Skeleton')], lambda c: toward(c, 'e0d0b0', 0.35), 'bone')
    kay_actions({'Idle': 'Idle_Combat', 'Attack': '1H_Melee_Attack_Chop', 'Hit': 'Hit_A', 'Death': 'Death_C_Skeletons'})
    export('skeleton')

def bone_knight():
    # 뼈 기사: 쇠 투구를 쓴 해골, 곧은 칼과 금 십자가 붉은 방패, 보랏빛 눈
    kay_start('Skeleton_Warrior', SKEL_KEEP('Skeleton_Warrior', 'Helmet'))
    flat(kay_mesh('Skeleton_Warrior_Eyes'), mat('eye', 'c08aff', 0.4, emit='9a4aff', power=5))
    kay_borrow('Knight', '1H_Sword'); shd = kay_borrow('Knight', 'Badge_Shield')
    import numpy as np
    def red(c):
        sat = c.max(-1) - c.min(-1); gold = (c[..., 0] > c[..., 2] + 0.2) & (c[..., 1] > c[..., 2] + 0.1)
        return np.where((gold & (sat > 0.25))[..., None], c, toward(c, 'b02a24', 0.85))
    retex([shd], red, 'red')
    retex([kay_mesh('Skeleton_Warrior_Helmet')], lambda c: toward(c, 'a8b0b8', 0.5), 'steel')
    kay_actions({'Idle': 'Idle_Combat', 'Attack': '1H_Melee_Attack_Slice_Diagonal', 'Hit': 'Block_Hit', 'Death': 'Death_C_Skeletons'})
    export('bone_knight')

def miner():
    # 광부의 망령: 푸르스름하게 비치는 해골 광부, 노란 안전모와 등, 곡괭이 대신 낡은 도끼, 다리 대신 흐르는 꼬리
    kay_start('Skeleton_Minion', SKEL_KEEP('Skeleton_Minion')[:6])
    ghost = mat('ghost', 'b8c8ff', 0.6, emit='5a6aff', power=0.8, alpha=0.78)
    for o in [o for o in bpy.data.objects if o.type == 'MESH']: flat(o, ghost)
    flat(kay_mesh('Skeleton_Minion_Eyes'), mat('eye', 'e8f4ff', 0.4, emit='9ac8ff', power=6))
    attach(cyl((0, 0.02, 0.22), 0.34, 0.5, verts=10, r2=0.05, rot=(180, 0, 0)), 'hips', ghost)   # 꼬리 (위가 넓은 원뿔을 뒤집어)
    head = kay_mesh('Skeleton_Minion_Head')
    zt = max((head.matrix_world @ v.co).z for v in head.data.vertices)
    hat = mat('hat', 'e8b830', 0.5); lampm = mat('lamp', 'fff4c0', 0.3, emit='ffe080', power=6)
    attach(ball((0, 0, zt - 0.12), (0.5, 0.5, 0.36), seg=14, rings=8), 'head', hat)
    attach(cyl((0, -0.06, zt - 0.2), 0.58, 0.04, verts=14), 'head', hat)
    attach(cyl((0, -0.5, zt - 0.02), 0.09, 0.08, rot=(90, 0, 0), verts=10), 'head', lampm)
    ax = kay_borrow('Barbarian', '1H_Axe')
    retex([ax], lambda c: toward(c, '8a8070', 0.5), 'pick')
    kay_actions({'Idle': 'Idle_B', 'Attack': '1H_Melee_Attack_Chop', 'Hit': 'Hit_B', 'Death': 'Death_A'})
    export('miner')

def fallen_monk():
    # 타락한 수도사: 보랏빛 두건 옷, 그늘진 얼굴에 붉은 눈, 금빛 지팡이
    kay_start('Mage', ['Mage_ArmLeft', 'Mage_ArmRight', 'Mage_Body', 'Mage_LegLeft', 'Mage_LegRight'])
    head = kay_borrow('Rogue_Hooded', 'Rogue_Head_Hooded'); staff = kay_borrow('Mage', '2H_Staff')
    import numpy as np
    def robe(c):
        sat = c.max(-1) - c.min(-1); gold = (c[..., 0] > c[..., 2] + 0.25) & (c[..., 1] > c[..., 2] + 0.15) & (sat > 0.3)
        out = toward(c, '5a2a7a', 0.9)
        out = np.where(gold[..., None], c, out)
        return np.where(skin_mask(c)[..., None], c * 0.12, out)
    retex([o for o in bpy.data.objects if o.type == 'MESH' and o is not staff], robe, 'monk')
    retex([staff], lambda c: toward(c, 'c89a40', 0.6), 'gold')
    eyes_at(head, (0.17, -0.17), 1.62, mat('eye', 'ff4030', 0.3, emit='ff1a08', power=6), (0.06, 0.03, 0.035))
    kay_actions({'Idle': 'Idle', 'Attack': 'Spellcast_Shoot', 'Hit': 'Hit_A', 'Death': 'Death_B'})
    export('fallen_monk')

def ghoul():
    # 구울: 푸르죽죽한 살갗, 찢긴 갈색 누더기, 누렇게 빛나는 눈, 긴 손톱
    kay_start('Barbarian', ['Barbarian_Body', 'Barbarian_ArmLeft', 'Barbarian_ArmRight', 'Barbarian_LegLeft', 'Barbarian_LegRight'])
    head = kay_borrow('Knight', 'Knight_Head')
    import numpy as np
    def rot(c):
        return np.where(skin_mask(c)[..., None], toward(c, '8aa868', 0.9), toward(c * 0.8, '6a4a2a', 0.8))
    retex([o for o in bpy.data.objects if o.type == 'MESH'], rot, 'ghoul')
    hb = rig.matrix_world @ rig.data.bones['head'].head_local
    for v in head.data.vertices:   # 머리를 조금 줄이고 앞으로 숙인 듯 낮춘다
        w = head.matrix_world @ v.co; v.co = head.matrix_world.inverted() @ (hb + (w - hb) * 0.85 + Vector((0, -0.04, -0.06)))
    ez = 1.24 + (1.66 - 1.24) * 0.85 - 0.06
    eyes_at(head, (0.19, -0.19), ez, mat('eye', 'ffd040', 0.3, emit='ffb000', power=5), (0.07, 0.03, 0.05))
    cl = mat('claw', 'e8e0c8', 0.5)
    for side, bone, x in (('l', 'hand.l', 0.86), ('r', 'hand.r', -0.86)):
        s_ = 1 if side == 'l' else -1
        for k in (-1, 0, 1):
            attach(cyl((x + s_ * 0.09, -0.06 + k * 0.07, 1.06), 0.025, 0.2, rot=(0, s_ * 90, 0), verts=4, r2=0), bone, cl)
    kay_actions({'Idle': 'Unarmed_Idle', 'Attack': '2H_Melee_Attack_Slice', 'Hit': 'Hit_A', 'Death': 'Death_A'})
    export('ghoul')

def guardian():
    # 저주받은 갑옷 (living_armor): 속이 빈 검붉은 갑옷, 뿔 달린 투구 안에 붉은 눈, 큰 양손 칼
    kay_start('Knight', ['Knight_ArmLeft', 'Knight_ArmRight', 'Knight_Body', 'Knight_LegLeft', 'Knight_LegRight', 'Knight_Helmet', 'Knight_Head'])
    sw = kay_borrow('Knight', '2H_Sword')
    head = kay_mesh('Knight_Head')
    import numpy as np
    def armor(c):
        sat = c.max(-1) - c.min(-1); gold = (c[..., 0] > c[..., 2] + 0.25) & (c[..., 1] > c[..., 2] + 0.12) & (sat > 0.3)
        return np.where(gold[..., None], toward(c, 'e0a030', 0.6), toward(c * 0.9, '9a2a20', 0.85))
    retex([o for o in bpy.data.objects if o.type == 'MESH' and o is not sw and o is not head], armor, 'cursed')
    retex([sw], lambda c: np.where((c.max(-1) - c.min(-1) > 0.25)[..., None], c, toward(c, 'c8c0c0', 0.3)), 'blade')
    ez = 1.66
    eye = mat('eye', 'ff3a20', 0.3, emit='ff1a08', power=7)
    y = surface(head, 0, ez)
    flat(head, mat('void', '0a0606', 1.0))   # 투구 속은 텅 빈 어둠
    for x in (0.16, -0.16): attach(ball((x, (y or -0.5) - 0.01, ez), (0.07, 0.03, 0.04)), 'head', eye, True)
    hm = kay_mesh('Knight_Helmet'); zt = max((hm.matrix_world @ v.co).z for v in hm.data.vertices)
    horn = mat('horn', '2a1a18', 0.6)
    for s_ in (1, -1):
        attach(tube([(s_ * 0.42, -0.05, zt - 0.3), (s_ * 0.62, -0.08, zt - 0.12), (s_ * 0.68, -0.1, zt + 0.12), (s_ * 0.6, -0.12, zt + 0.3)], [0.1, 0.075, 0.045, 0.0], 8), 'head', horn)
    kay_actions({'Idle': '2H_Melee_Idle', 'Attack': '2H_Melee_Attack_Chop', 'Hit': 'Hit_B', 'Death': 'Death_B'})
    export('guardian')

# ======================================================================
# 네발 짐승 (뿔토끼·쥐·늑대): 늑대 모양을 기준으로 길이(sy)·높이(sz)·굵기(sr)를 바꾸고 귀·꼬리·뿔을 고른다
def quad(name, fur, dark, belly, eye, sy=1.0, sz=1.0, sr=1.0, head=1.0, ears='point', tail='bushy', horn=False, teeth=True, pink='e8a0a0'):
    reset(); MATS.clear()
    T = lambda x, y, z: (x * sr, y * sy, z * sz)
    make_rig([('root', (0, 0, 0), None), ('body', T(0, 0.25, 0.55), 'root'), ('chest', T(0, -0.2, 0.6), 'body'),
              ('neck', T(0, -0.4, 0.75), 'chest'), ('head', T(0, -0.55, 0.85), 'neck'), ('jaw', T(0, -0.68, 0.78), 'head'),
              ('tail', T(0, 0.58, 0.62), 'body'), ('fl.L', T(0.15, -0.3, 0.52), 'chest'), ('fl.R', T(-0.15, -0.3, 0.52), 'chest'),
              ('rl.L', T(0.16, 0.4, 0.5), 'body'), ('rl.R', T(-0.16, 0.4, 0.5), 'body')])
    F, Dk, Bl = mat('fur', fur, 0.95), mat('fur_dark', dark, 0.95), mat('belly', belly, 0.95)
    E_ = mat('eye', eye, 0.3, emit=eye, power=4); W = mat('tooth', 'f4f0e4', 0.5); N = mat('nose', '2a2222', 0.6); Pk = mat('pink', pink, 0.8)
    def B(c, r, rot=(0, 0, 0), m=F, bone='body', seg=10, rings=7):
        return attach(ball(T(*c), (r[0] * sr, r[1] * sy, r[2] * sz), rot, seg, rings), bone, m)
    def tb(pts, radii, m=F, bone='body', v=8):
        return attach(tube([T(*p) for p in pts], [r * sr for r in radii], v), bone, m)
    B((0, 0.2, 0.58), (0.24, 0.42, 0.24)); B((0, -0.22, 0.62), (0.27, 0.3, 0.3), bone='chest')
    B((0, 0.05, 0.71), (0.19, 0.44, 0.12), m=Dk); B((0, -0.25, 0.47), (0.17, 0.24, 0.12), m=Bl, bone='chest')
    B((0, -0.42, 0.75), (0.21, 0.2, 0.23), bone='neck')
    # 머리 (head 배로 키운다)
    hv = Vector(T(0, -0.55, 0.85))
    hp = []
    hp.append(B((0, -0.6, 0.87), (0.16, 0.17, 0.15), bone='head'))
    hp.append(tb([(0, -0.66, 0.84), (0, -0.84, 0.8)], [0.09, 0.055], bone='head'))
    hp.append(B((0, -0.86, 0.81), (0.035, 0.03, 0.03), m=N, bone='head', seg=8, rings=5))
    hp.append(tb([(0, -0.64, 0.76), (0, -0.82, 0.75)], [0.06, 0.035], bone='jaw'))
    if teeth:
        for x in (0.03, -0.03): hp.append(attach(cyl(T(x, -0.81, 0.775), 0.012, 0.045, rot=(180, 0, 0), verts=4, r2=0), 'head', W))
    for x in (0.075, -0.075): hp.append(B((x, -0.72, 0.9), (0.03, 0.02, 0.026), m=E_, bone='head', seg=8, rings=5))
    for sx_ in (1, -1):
        if ears == 'point':
            hp.append(attach(cyl(T(sx_ * 0.09, -0.54, 1.0), 0.06 * sr, 0.15 * sz, rot=(-10, sx_ * 15, 0), verts=4, r2=0), 'head', Dk))
        elif ears == 'round':
            hp.append(B((sx_ * 0.11, -0.54, 0.98), (0.07, 0.025, 0.07), m=Pk, bone='head'))
        elif ears == 'long':
            hp.append(B((sx_ * 0.07, -0.5, 1.12), (0.05, 0.03, 0.17), (-12, sx_ * 10, 0), bone='head'))
            hp.append(B((sx_ * 0.07, -0.525, 1.12), (0.03, 0.012, 0.13), (-12, sx_ * 10, 0), m=Pk, bone='head'))
    if horn:
        hp.append(attach(cyl(T(0, -0.67, 0.99), 0.035, 0.2, rot=(-40, 0, 0), verts=6, r2=0), 'head', mat('horn', 'e8c050', 0.4, 0.3)))
    for o in hp:
        M = o.matrix_world; Mi = M.inverted()
        for v in o.data.vertices: v.co = Mi @ (hv + (M @ v.co - hv) * head)
    # 다리
    for sx_, k in ((1, 'L'), (-1, 'R')):
        x = sx_ * 0.15
        tb([(x, -0.3, 0.56), (x, -0.32, 0.26), (x, -0.34, 0.05)], [0.075, 0.05, 0.045], bone='fl.' + k)
        B((x, -0.38, 0.03), (0.05, 0.075, 0.035), m=Dk, bone='fl.' + k)
        B((x * 1.05, 0.38, 0.47), (0.09, 0.15, 0.17), bone='rl.' + k)
        tb([(x, 0.42, 0.38), (x, 0.5, 0.2), (x, 0.46, 0.05)], [0.07, 0.05, 0.045], bone='rl.' + k)
        B((x, 0.4, 0.03), (0.05, 0.08, 0.035), m=Dk, bone='rl.' + k)
    if tail == 'bushy':
        tb([(0, 0.58, 0.62), (0, 0.78, 0.56), (0, 0.95, 0.42)], [0.06, 0.09, 0.02], bone='tail', v=7)
        B((0, 0.93, 0.44), (0.05, 0.06, 0.06), m=Dk, bone='tail')
    elif tail == 'thin':
        tb([(0, 0.58, 0.58), (0, 0.85, 0.45), (0, 1.15, 0.3), (0, 1.4, 0.32)], [0.04, 0.03, 0.02, 0.005], m=Pk, bone='tail', v=6)
    elif tail == 'puff':
        B((0, 0.62, 0.62), (0.1, 0.1, 0.1), m=Bl, bone='tail')
    leg = lambda a, b, c, d: {'fl.L': (a, 0, 0), 'fl.R': (b, 0, 0), 'rl.L': (c, 0, 0), 'rl.R': (d, 0, 0)}
    anim('Idle', loop(48, lambda t: {'chest': (2 * S(t), 0, 0), 'neck': (-3 + 3 * S(t + 0.2), 4 * S(t, 1) * 0.6, 0), 'head': (3 * S(t + 0.3), 0, 0),
                                    'jaw': (5 + 5 * S(t), 0, 0), 'tail': (5 * S(t), 18 * S(t, 2), 0), 'root@': (0, 0, 0.01 * S(t))}, 8))
    crouch = {**leg(-15, -15, 20, 20), 'body': (-6, 0, 0), 'chest': (8, 0, 0), 'neck': (-10, 0, 0), 'root@': (0, 0.12, -0.06), 'jaw': (10, 0, 0)}
    leap = {**leg(-60, -50, 40, 35), 'body': (12, 0, 0), 'neck': (-8, 0, 0), 'head': (8, 0, 0), 'jaw': (40, 0, 0), 'root@': (0, -0.6, 0.18), 'tail': (-20, 0, 0)}
    bite = {**leg(-20, -10, 10, 10), 'neck': (14, 0, 0), 'head': (12, 0, 0), 'jaw': (4, 0, 0), 'root@': (0, -0.55, 0)}
    anim('Attack', {0: {}, 8: crouch, 14: leap, 19: bite, 30: {}})
    anim('Hit', {0: {}, 4: {'chest': (-10, 0, 8), 'neck': (-16, 0, 0), 'head': (-10, 0, 0), 'jaw': (20, 0, 0), 'root@': (0, 0.14, 0), **leg(15, 10, -10, -10)}, 15: {}})
    anim('Death', {0: {}, 8: {'neck': (-20, 0, 0), 'jaw': (25, 0, 0), 'root@': (0, 0.05, 0.05)},
                   22: {'root': (0, 0, 84), 'root@': (0, 0, 0.12 * sz), **leg(-20, 10, -15, 15), 'neck': (20, 0, 0), 'head': (10, 0, 0), 'jaw': (18, 0, 0), 'tail': (0, 0, 30)},
                   26: {'root': (0, 0, 90), 'root@': (0, 0, 0.1 * sz), **leg(-22, 12, -18, 18), 'neck': (24, 0, 0), 'head': (12, 0, 0), 'jaw': (15, 0, 0), 'tail': (0, 0, 34)}})
    export(name)

def wolf(): quad('wolf', '9a9aa0', '5e5e66', 'cfcac4', 'ffa020', sy=1.05, sz=1.0, sr=1.05)
def rat(): quad('rat', 'c8beb2', '9a9084', 'e8ded2', 'ff3020', sy=0.85, sz=0.62, sr=1.0, head=1.15, ears='round', tail='thin', pink='f0a8a8')   # 밝게: 굴 쥐는 빛깔을 곱한다
def horn_rabbit(): quad('horn_rabbit', 'f2ece0', 'ddd4c4', 'fffaf0', 'ff2a20', sy=0.55, sz=0.56, sr=1.3, head=1.55, ears='long', tail='puff', horn=True, teeth=False)

# ======================================================================
# 나는 짐승 (동굴 박쥐·묘지 까마귀): 몸은 땅 위에 떠 있고 날개를 퍼덕인다
def flyer(name, body, wing, eye, crow=False):
    reset(); MATS.clear()
    make_rig([('root', (0, 0, 0), None), ('body', (0, 0, 1.0), 'root'), ('head', (0, -0.14, 1.12), 'body'),
              ('wing.L', (0.1, 0, 1.08), 'body'), ('wing2.L', (0.45, 0.02, 1.18), 'wing.L'),
              ('wing.R', (-0.1, 0, 1.08), 'body'), ('wing2.R', (-0.45, 0.02, 1.18), 'wing.R')])
    Bm, Wm = mat('body', body, 0.8), mat('wing', wing, 0.8, double=True)
    E_ = mat('eye', eye, 0.3, emit=eye, power=5); W = mat('fang', 'f4f0e4', 0.5)
    if crow:
        attach(ball((0, 0.05, 1.0), (0.16, 0.26, 0.16), (-15, 0, 0)), 'body', Bm)
        attach(ball((0, -0.2, 1.14), (0.12, 0.13, 0.12)), 'head', Bm)
        attach(cyl((0, -0.38, 1.12), 0.05, 0.2, rot=(90, 0, 0), verts=5, r2=0), 'head', mat('beak', 'c8b890', 0.5))
        for x in (0.075, -0.075): attach(ball((x, -0.29, 1.18), (0.025, 0.02, 0.025)), 'head', E_, True)
        attach(mesh([(0, 0.25, 0.95), (0.14, 0.62, 0.86), (0.05, 0.66, 0.84), (0, 0.62, 0.85), (-0.05, 0.66, 0.84), (-0.14, 0.62, 0.86)], [(0, 1, 2, 3), (0, 3, 4, 5)], 'tail', 0.03), 'body', Wm)
        for x in (0.06, -0.06):
            attach(tube([(x, 0.0, 0.86), (x, -0.02, 0.72)], [0.02, 0.015], 5), 'body', mat('leg', '3a3430', 0.6))
            for d in (-0.03, 0, 0.03): attach(cyl((x + d, -0.06, 0.71), 0.012, 0.08, rot=(80, 0, d * 300), verts=4, r2=0), 'body', mat('leg', '3a3430', 0.6))
    else:
        attach(ball((0, 0, 1.0), (0.17, 0.17, 0.2)), 'body', Bm)
        attach(ball((0, -0.1, 1.18), (0.14, 0.13, 0.13)), 'head', Bm)
        for sx_ in (1, -1):
            attach(cyl((sx_ * 0.1, -0.08, 1.36), 0.07, 0.22, rot=(-10, sx_ * 22, 0), verts=4, r2=0), 'head', Wm)
            attach(ball((sx_ * 0.06, -0.22, 1.2), (0.03, 0.02, 0.028)), 'head', E_, True)
            attach(cyl((sx_ * 0.03, -0.22, 1.1), 0.012, 0.05, rot=(180, 0, 0), verts=4, r2=0), 'head', W)
            for d in (-0.03, 0.03): attach(cyl((sx_ * 0.07 + d, 0.02, 0.8), 0.012, 0.07, rot=(180, 0, 0), verts=4, r2=0), 'body', W)
        attach(ball((0, -0.17, 1.15), (0.04, 0.03, 0.03)), 'head', mat('nose', '4a2a3a', 0.6))
    # 날개: 박쥐는 막, 까마귀는 들쭉날쭉한 깃 끝
    for s_, k in ((1, 'L'), (-1, 'R')):
        sh, el, wr = (s_ * 0.1, 0.0, 1.08), (s_ * 0.45, 0.02, 1.2), (s_ * 0.72, 0.04, 1.26)
        if crow:
            tips = [(s_ * 1.1, 0.12, 1.2), (s_ * 1.05, 0.22, 1.08), (s_ * 0.95, 0.3, 0.98), (s_ * 0.8, 0.34, 0.92), (s_ * 0.62, 0.34, 0.9), (s_ * 0.42, 0.3, 0.9), (s_ * 0.2, 0.22, 0.93)]
            notch = [(s_ * 1.0, 0.16, 1.14), (s_ * 0.92, 0.24, 1.04), (s_ * 0.8, 0.28, 0.98), (s_ * 0.66, 0.29, 0.96), (s_ * 0.5, 0.27, 0.96), (s_ * 0.32, 0.22, 0.98)]
            V = [sh, el, wr]
            ring = [wr]
            for i in range(len(tips)):
                ring.append(tips[i])
                if i < len(notch): ring.append(notch[i])
            V = [sh, el] + ring
            F = [(1, i, i + 1) for i in range(2, len(V) - 1)] + [(0, 1, len(V) - 1)]
        else:
            tips = [(s_ * 1.1, 0.06, 1.42), (s_ * 1.12, 0.08, 1.05), (s_ * 0.8, 0.08, 0.78)]
            mids = [(s_ * 0.98, 0.06, 1.22), (s_ * 0.88, 0.07, 0.95), (s_ * 0.45, 0.05, 0.86)]
            V = [sh, el, wr, tips[0], mids[0], tips[1], mids[1], tips[2], mids[2], (s_ * 0.12, 0.03, 0.92)]
            F = [(2, 3, 4), (2, 4, 5), (2, 5, 6), (2, 6, 7), (2, 7, 8), (1, 2, 8), (1, 8, 9), (0, 1, 9)]
            for t in tips: attach(tube([wr, t], [0.018, 0.006], 4), 'wing2.' + k, Bm)
        if s_ < 0: F = [tuple(reversed(f)) for f in F]
        o = mesh(V, F, 'wing', 0.012)
        skin(o, Wm, lambda c, k=k: {'wing.' + k: 1 - max(0.0, min(1.0, (abs(c.x) - 0.45) / 0.3)), 'wing2.' + k: max(0.0, min(1.0, (abs(c.x) - 0.45) / 0.3))})
    flap = lambda a, f=0: {'wing.L': (0, 0, a), 'wing.R': (0, 0, -a), 'wing2.L': (0, 0, f), 'wing2.R': (0, 0, -f)}
    anim('Idle', loop(16, lambda t: {**flap(-10 + 38 * S(t), 18 * S(t - 0.1)), 'body': (6 * S(t + 0.2), 0, 0), 'head': (-5 * S(t + 0.3), 0, 0), 'root@': (0, 0, 0.06 * S(t - 0.25))}, 8))
    anim('Attack', {0: {**flap(30, 10)}, 8: {**flap(40, 20), 'body': (-20, 0, 0), 'root@': (0, 0.15, 0.15)}, 14: {**flap(-30, -10), 'body': (30, 0, 0), 'head': (20, 0, 0), 'root@': (0, -0.7, -0.35)},
                    20: {**flap(10, 0), 'body': (10, 0, 0), 'root@': (0, -0.5, -0.2)}, 30: {**flap(30, 10)}})
    anim('Hit', {0: {}, 4: {**flap(50, 30), 'body': (-20, 0, 10), 'root@': (0, 0.15, 0.1)}, 14: {}})
    anim('Death', {0: {}, 6: {**flap(55, 30), 'body': (-20, 0, 0)}, 20: {**flap(-40, -20), 'body': (40, 0, 70), 'root@': (0, 0, -0.75)},
                   26: {**flap(-50, -25), 'body': (40, 0, 85), 'root@': (0, 0, -0.85)}})
    export(name)
def cave_bat(): flyer('cave_bat', '6a3a58', 'a2486e', 'ff3a20')
def grave_crow(): flyer('grave_crow', '2a2632', '33303c', 'b080ff', crow=True)

# ======================================================================
# 풀빛 슬라임: 반짝이는 초록 물방울, 까만 눈에 하얀 빛, 웃는 입. 몸 뼈 하나를 늘이고 줄여 통통 튄다
def slime():
    reset(); MATS.clear()
    make_rig([('root', (0, 0, 0), None), ('body', (0, 0, 0), 'root')])
    G = mat('slime', '78d040', 0.22, emit='2a6a10', power=0.4)
    o = ball((0, 0, 0.36), (0.52, 0.5, 0.4), seg=20, rings=12)
    for v in o.data.vertices: v.co.z = max(v.co.z, -0.33)
    attach(o, 'body', G, True)
    attach(ball((0.18, -0.2, 0.62), (0.07, 0.05, 0.04), (0, 20, 0)), 'body', mat('shine', 'f0ffe0', 0.2, emit='c8ffa0', power=1), True)
    attach(ball((-0.25, -0.1, 0.55), (0.04, 0.03, 0.025)), 'body', MATS['shine'], True)
    for x in (0.16, -0.16):
        attach(ball((x, -0.43, 0.42), (0.075, 0.04, 0.095)), 'body', mat('eye', '182014', 0.3), True)
        attach(ball((x + 0.025, -0.47, 0.46), (0.022, 0.012, 0.022)), 'body', MATS['shine'], True)
    attach(tube([(0.1, -0.44, 0.3), (0.05, -0.47, 0.27), (0, -0.475, 0.26), (-0.05, -0.47, 0.27), (-0.1, -0.44, 0.3)], [0.015, 0.018, 0.018, 0.018, 0.015], 5), 'body', mat('mouth', '1a3a10', 0.5), True)
    anim('Idle', loop(40, lambda t: {'body^': (1 + 0.04 * S(t), 1 + 0.04 * S(t), 1 - 0.06 * S(t))}, 8))
    anim('Attack', {0: {}, 8: {'body^': (1.25, 1.25, 0.7)}, 14: {'body^': (0.85, 0.85, 1.3), 'root@': (0, -0.45, 0.45)}, 20: {'body^': (1.25, 1.25, 0.72), 'root@': (0, -0.6, 0)},
                    26: {'body^': (0.95, 0.95, 1.08), 'root@': (0, -0.3, 0)}, 34: {}})
    anim('Hit', {0: {}, 3: {'body^': (1.3, 1.3, 0.65), 'root@': (0, 0.1, 0)}, 8: {'body^': (0.9, 0.9, 1.15)}, 14: {}})
    anim('Death', {0: {}, 6: {'body^': (0.85, 0.85, 1.25)}, 22: {'body^': (1.7, 1.7, 0.08)}})
    export('slime')

# ======================================================================
# 정령 (광석 정령·원혼·혼불): 해골 얼굴이 비치는 하얀 불꽃. 빛깔은 몬스터마다 곱해서 바꾼다 (tint)
def wisp():
    reset(); MATS.clear()
    make_rig([('root', (0, 0, 0), None), ('core', (0, 0, 0.85), 'root'), ('tipA', (0.05, 0.04, 1.3), 'core'), ('tipB', (-0.1, 0.02, 1.15), 'core')])
    Fm = mat('flame', 'e8eeff', 0.4, emit='b8c8ff', power=2.2, alpha=0.82)
    In = mat('inner', 'ffffff', 0.4, emit='ffffff', power=3)
    Hole = mat('hole', '101830', 0.8)
    attach(tube([(0, 0, 0.42), (0, 0, 0.55), (0, 0, 0.8), (0, 0, 1.05), (0, 0, 1.3)], [0.06, 0.26, 0.34, 0.3, 0.16], 12), 'core', Fm, True)
    attach(tube([(0.0, 0.02, 1.25), (0.08, 0.04, 1.5), (0.12, 0.06, 1.75)], [0.15, 0.08, 0.0], 8), 'tipA', Fm, True)
    attach(tube([(-0.12, 0.02, 1.1), (-0.25, 0.05, 1.3), (-0.3, 0.08, 1.48)], [0.1, 0.05, 0.0], 8), 'tipB', Fm, True)
    attach(tube([(0.15, 0.03, 1.05), (0.26, 0.06, 1.25), (0.28, 0.08, 1.4)], [0.08, 0.04, 0.0], 8), 'tipA', Fm, True)
    attach(ball((0, 0.02, 0.8), (0.18, 0.18, 0.24)), 'core', In, True)
    for x in (0.11, -0.11): attach(ball((x, -0.3, 0.95), (0.075, 0.04, 0.085)), 'core', Hole, True)
    attach(ball((0, -0.32, 0.76), (0.09, 0.035, 0.07)), 'core', Hole, True)
    for x in (0.045, -0.045, 0.0): attach(cyl((x, -0.34, 0.81), 0.02, 0.06, rot=(180, 0, 0), verts=4, r2=0), 'core', In)
    anim('Idle', loop(36, lambda t: {'core^': (1 + 0.04 * S(t, 2), 1 + 0.04 * S(t, 2), 1 + 0.06 * S(t)), 'tipA': (10 * S(t), 0, 12 * S(t + 0.2)), 'tipB': (-8 * S(t + 0.3), 0, -14 * S(t + 0.1)),
                                    'root@': (0, 0, 0.06 * S(t)), 'core': (0, 8 * S(t, 1), 0)}, 9))
    anim('Attack', {0: {}, 8: {'core^': (1.15, 1.15, 0.85), 'root@': (0, 0.12, 0)}, 14: {'core^': (0.85, 0.85, 1.25), 'root@': (0, -0.65, 0.05), 'core': (25, 0, 0), 'tipA': (40, 0, 0), 'tipB': (40, 0, 0)},
                    22: {'root@': (0, -0.45, 0), 'core': (10, 0, 0)}, 32: {}})
    anim('Hit', {0: {}, 4: {'core^': (1.25, 1.25, 0.8), 'root@': (0, 0.15, 0), 'tipA': (-30, 0, 0), 'tipB': (-30, 0, 0)}, 14: {}})
    anim('Death', {0: {}, 8: {'core^': (1.3, 1.3, 1.3)}, 26: {'core^': (0.05, 0.05, 0.05), 'root@': (0, 0, 0.5)}})
    export('wisp')

# ======================================================================
# 가고일: 돌빛 KayKit 몸 + 뒤로 펼친 박쥐 날개, 굽은 뿔, 붉게 빛나는 눈
def gargoyle():
    kay_start('Barbarian', ['Barbarian_Body', 'Barbarian_ArmLeft', 'Barbarian_ArmRight', 'Barbarian_LegLeft', 'Barbarian_LegRight'])
    head = kay_borrow('Knight', 'Knight_Head')
    retex([o for o in bpy.data.objects if o.type == 'MESH'], lambda c: toward(c * 0.95 + 0.04, '9a9a98', 0.95), 'stone')
    hb = rig.matrix_world @ rig.data.bones['head'].head_local
    for v in head.data.vertices:
        w = head.matrix_world @ v.co; v.co = head.matrix_world.inverted() @ (hb + (w - hb) * 0.85)
    ez = 1.24 + (1.66 - 1.24) * 0.85
    eyes_at(head, (0.19, -0.19), ez, mat('eye', 'ff5a40', 0.3, emit='ff2a10', power=5), (0.07, 0.03, 0.05))
    zt = max((head.matrix_world @ v.co).z for v in head.data.vertices)
    St, Wm = mat('stone_dark', '6a6a6c', 0.9), mat('wing', '7a7a7e', 0.9, double=True)
    for s_ in (1, -1):
        attach(tube([(s_ * 0.3, -0.1, zt - 0.25), (s_ * 0.42, -0.02, zt - 0.05), (s_ * 0.4, 0.12, zt + 0.12), (s_ * 0.3, 0.26, zt + 0.16)], [0.08, 0.06, 0.035, 0.0], 7), 'head', St)
        sh, el, wr = (s_ * 0.22, 0.3, 1.0), (s_ * 0.62, 0.42, 1.45), (s_ * 0.95, 0.5, 1.75)
        tips = [(s_ * 1.45, 0.55, 1.72), (s_ * 1.5, 0.6, 1.2), (s_ * 1.15, 0.58, 0.72)]
        mids = [(s_ * 1.3, 0.56, 1.45), (s_ * 1.25, 0.58, 0.98), (s_ * 0.6, 0.48, 0.75)]
        V = [sh, el, wr, tips[0], mids[0], tips[1], mids[1], tips[2], mids[2], (s_ * 0.22, 0.32, 0.72)]
        F = [(2, 3, 4), (2, 4, 5), (2, 5, 6), (2, 6, 7), (2, 7, 8), (1, 2, 8), (1, 8, 9), (0, 1, 9)]
        if s_ < 0: F = [tuple(reversed(f)) for f in F]
        attach(mesh(V, F, 'wing', 0.02), 'chest', Wm)
        attach(tube([sh, el, wr], [0.05, 0.04, 0.03], 6), 'chest', St)
        for t in tips: attach(tube([wr, t], [0.03, 0.008], 5), 'chest', St)
    kay_actions({'Idle': 'Unarmed_Idle', 'Attack': 'Unarmed_Melee_Attack_Punch_A', 'Hit': 'Hit_A', 'Death': 'Death_A'})
    export('gargoyle')

BUILD = dict(golem=golem, gravekeeper=gravekeeper, dragon=dragon, skeleton=skeleton, bone_knight=bone_knight, miner=miner,
             fallen_monk=fallen_monk, ghoul=ghoul, guardian=guardian, rock_golem=rock_golem, wolf=wolf, rat=rat, horn_rabbit=horn_rabbit,
             cave_bat=cave_bat, grave_crow=grave_crow, slime=slime, wisp=wisp, gargoyle=gargoyle)
for who in (args[2:] or list(BUILD)):
    BUILD[who]()
