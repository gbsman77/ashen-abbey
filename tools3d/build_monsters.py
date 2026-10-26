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
    objs, acts = imp(base)
    p = [o for o in objs if o.name.startswith(part_name)][0]
    for o in objs:
        if o is not p: bpy.data.objects.remove(o)
    for a in acts: bpy.data.actions.remove(a)
    mw = p.matrix_world.copy(); p.parent = rig; p.matrix_world = mw
    for m in p.modifiers:
        if m.type == 'ARMATURE': m.object = rig
    p.name = part_name
    return p
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
# keys = {프레임: {뼈: (rx, ry, rz) 도, '뼈@': (x, y, z) 옮김}} - 어느 프레임에 안 적힌 뼈는 쉬는 자세(0)
def anim(name, keys):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data_create(); rig.animation_data.action = act
    chans = set()
    for pose in keys.values(): chans |= set(pose)
    for f in sorted(keys):
        pose = keys[f]
        for ch in chans:
            if ch.endswith('@'):
                x, y, z = pose.get(ch, (0, 0, 0)); pb = rig.pose.bones[ch[:-1]]; pb.location = (x, z, -y)   # 뼈 안 좌표 (Y 가 위)
                pb.keyframe_insert('location', frame=f)
            else:
                pb = rig.pose.bones[ch]; pb.rotation_euler = [math.radians(a) for a in pose.get(ch, (0, 0, 0))]
                pb.keyframe_insert('rotation_euler', frame=f)
    for pb in rig.pose.bones: pb.location = (0, 0, 0); pb.rotation_euler = (0, 0, 0)
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
def golem():
    reset(); MATS.clear()
    make_rig([('root', (0, 0, 0), None), ('hips', (0, 0, 0.95), 'root'), ('chest', (0, 0, 1.25), 'hips'),
              ('head', (0, -0.22, 1.85), 'chest'),
              ('arm.L', (0.82, 0, 1.78), 'chest'), ('fore.L', (1.0, -0.06, 1.18), 'arm.L'),
              ('arm.R', (-0.82, 0, 1.78), 'chest'), ('fore.R', (-1.0, -0.06, 1.18), 'arm.R'),
              ('leg.L', (0.38, 0, 0.9), 'hips'), ('leg.R', (-0.38, 0, 0.9), 'hips')])
    rk = mat('rock', 'b49c6a', 0.95); dk = mat('rock_dark', '8a7550', 0.95); cr = mat('crystal', '9ad8ff', 0.25, 0.1, emit='3d8cff', power=1.6)
    eye = mat('eye', '6cc4ff', 0.4, emit='2a9cff', power=3)
    n = [0]
    def R(loc, size, sub=1, jit=0.2):
        n[0] += 1; return rock(loc, size, n[0] * 7 + 1, sub, jit)
    # 다리·발
    for s, leg in ((1, 'leg.L'), (-1, 'leg.R')):
        part(leg, rk, [R((s * 0.4, 0, 0.66), (0.32, 0.32, 0.34)), R((s * 0.44, -0.08, 0.24), (0.38, 0.42, 0.26))])
        part(leg, dk, [R((s * 0.4, -0.3, 0.12), (0.12, 0.1, 0.1)), R((s * 0.55, -0.26, 0.12), (0.11, 0.1, 0.1)), R((s * 0.27, -0.27, 0.12), (0.1, 0.1, 0.09))])
    # 몸: 허리 덩이 + 큰 가슴 덩이 + 가슴판
    part('hips', dk, [R((0, 0.02, 1.0), (0.52, 0.42, 0.3))])
    part('chest', rk, [R((0, 0.06, 1.48), (0.78, 0.56, 0.5), 2, 0.12), R((0.3, -0.36, 1.55), (0.3, 0.16, 0.26)), R((-0.3, -0.36, 1.55), (0.3, 0.16, 0.26)),
                       R((0, -0.3, 1.2), (0.36, 0.2, 0.22))])
    part('chest', dk, [R((0, 0.36, 1.78), (0.5, 0.3, 0.26)), R((0.35, 0.3, 1.25), (0.22, 0.2, 0.2)), R((-0.35, 0.3, 1.25), (0.22, 0.2, 0.2))])
    # 머리: 어깨 사이에 묻혀 앞으로 나온 작은 바위, 눈썹 바위 아래 빛나는 눈
    part('head', rk, [R((0, -0.34, 1.92), (0.27, 0.25, 0.24)), R((0, -0.52, 1.83), (0.17, 0.1, 0.1))])
    part('head', dk, [R((0, -0.5, 2.02), (0.26, 0.09, 0.07))])
    part('head', eye, [ball((0.1, -0.55, 1.95), (0.05, 0.03, 0.035)), ball((-0.1, -0.55, 1.95), (0.05, 0.03, 0.035))], smooth=True)
    # 팔: 큰 어깨 바위, 윗팔, 아래팔, 큰 주먹
    for s, a, f in ((1, 'arm.L', 'fore.L'), (-1, 'arm.R', 'fore.R')):
        part(a, rk, [R((s * 0.86, 0.02, 1.8), (0.4, 0.38, 0.34), 2, 0.12), R((s * 0.98, -0.04, 1.36), (0.27, 0.27, 0.3))])
        part(f, rk, [R((s * 1.02, -0.08, 0.98), (0.3, 0.3, 0.3))])
        part(f, dk, [R((s * 1.05, -0.14, 0.52), (0.44, 0.42, 0.38), 2, 0.14)])
        part(f, rk, [R((s * (1.05 + 0.15 * k), -0.5, 0.48 + 0.06 * (k == 0)), (0.12, 0.12, 0.13)) for k in (-1, 0, 1)])
        # 수정: 어깨 위, 윗팔, 아래팔, 주먹
        part(a, cr, [crystal((s * 0.86, 0.0, 2.08), (s * 0.2, 0.05, 1), 0.48, 0.09), crystal((s * 1.08, 0.12, 1.98), (s * 0.8, 0.2, 0.8), 0.36, 0.07),
                     crystal((s * 0.7, -0.12, 2.06), (s * -0.1, -0.3, 1), 0.3, 0.06), crystal((s * 1.2, -0.05, 1.4), (s * 1, -0.2, 0.3), 0.26, 0.055)])
        part(f, cr, [crystal((s * 1.26, 0, 1.0), (s * 1, 0.2, 0.4), 0.24, 0.05), crystal((s * 1.38, -0.12, 0.62), (s * 1, -0.3, 0.3), 0.3, 0.06)])
    part('head', cr, [crystal((0.12, -0.25, 2.12), (0.3, 0.1, 1), 0.3, 0.06), crystal((-0.1, -0.22, 2.12), (-0.4, 0.2, 1), 0.24, 0.05)])
    part('chest', cr, [crystal((0.2, 0.42, 1.9), (0.3, 0.6, 1), 0.38, 0.07), crystal((-0.25, 0.45, 1.75), (-0.4, 0.7, 0.8), 0.32, 0.065),
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
    export('golem')

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

BUILD = dict(golem=golem, gravekeeper=gravekeeper, dragon=dragon)
for who in (args[2:] or list(BUILD)):
    BUILD[who]()
