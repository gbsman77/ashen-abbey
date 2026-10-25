# usage: build.py -- warrior|mage|priest out.glb
import bpy, sys, math
import numpy as np
from mathutils import Vector, Matrix, Euler
who, out = sys.argv[sys.argv.index('--')+1:][:2]
SRC = '/tmp/claude-0/-home-user-ashen-abbey/47813459-df41-5d0e-955b-d7c7f717782f/scratchpad/src/'
KEEP_ACTIONS = ['Idle','Walking_A','Walking_B','Running_A','1H_Melee_Attack_Chop','1H_Melee_Attack_Slice_Diagonal',
  '2H_Melee_Attack_Chop','Spellcast_Shoot','Spellcast_Raise','Spellcasting','Hit_A','Death_A','Block','Cheer','Use_Item','Interact']

bpy.ops.wm.read_factory_settings(use_empty=True)
def imp(name):
    before = set(bpy.data.objects); acts = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=SRC + name + '.glb')
    return [o for o in bpy.data.objects if o not in before], [a for a in bpy.data.actions if a not in acts]

base = {'warrior': 'Knight', 'mage': 'Mage', 'priest': 'Mage'}[who]
objs, _ = imp(base)
rig = [o for o in objs if o.type == 'ARMATURE'][0]
rig.data.pose_position = 'REST'
keep = {
 'warrior': ['Knight_ArmLeft','Knight_ArmRight','Knight_Body','Knight_Cape','Knight_Head','Knight_LegLeft','Knight_LegRight','1H_Sword','Round_Shield'],
 'mage':    ['Mage_ArmLeft','Mage_ArmRight','Mage_Body','Mage_Cape','Mage_Head','Mage_LegLeft','Mage_LegRight','2H_Staff','Spellbook'],
 'priest':  ['Mage_ArmLeft','Mage_ArmRight','Mage_Body','Mage_Cape','Mage_LegLeft','Mage_LegRight','1H_Wand','Spellbook'],
}[who]
for o in objs:
    if o.type == 'MESH' and o.name not in keep: bpy.data.objects.remove(o)

if who == 'priest':
    objs2, acts2 = imp('Rogue')
    head = bpy.data.objects['Rogue_Head']
    for o in objs2:
        if o is not head: bpy.data.objects.remove(o)
    for a in acts2: bpy.data.actions.remove(a)
    mw = head.matrix_world.copy(); head.parent = rig; head.matrix_world = mw
    for m in head.modifiers:
        if m.type == 'ARMATURE': m.object = rig
    # drop the earring (cell c3r0)
    import bmesh
    bm = bmesh.new(); bm.from_mesh(head.data); uvl = bm.loops.layers.uv[0]
    kill = []
    for f in bm.faces:
        u = sum(l[uvl].uv.x for l in f.loops)/len(f.loops); v = sum(l[uvl].uv.y for l in f.loops)/len(f.loops)
        if int(u*8) == 3 and 3-int(v*4) == 0: kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(head.data); bm.free()

# ---- recolour texture cells (8 columns x 4 rows, row 0 at top) ----
def srgb(h): return np.array([int(h[i:i+2], 16)/255 for i in (0, 2, 4)])
def recolor(img, cells):
    W, H = img.size
    px = np.array(img.pixels[:]).reshape(H, W, 4)
    cw, ch = W//8, H//4
    for (c, r), hexcol in cells.items():
        y0 = (3-r)*ch; blk = px[y0:y0+ch, c*cw:(c+1)*cw, :3]
        lum = blk @ np.array([.3, .59, .11]); ref = np.median(lum)
        t = srgb(hexcol)
        px[y0:y0+ch, c*cw:(c+1)*cw, :3] = np.clip(t[None, None, :] * (lum/ref)[..., None], 0, 1)
    img.pixels[:] = px.ravel()
    img.pack()
RECOLOR = {
 'warrior': {'knight_texture': {(1,0): '5e3b25'}},
 'mage':    {'mage_texture': {(1,0): '24474a', (2,1): '4a3266'}},
 'priest':  {'mage_texture': {(0,1): 'efe9da', (2,1): '2f4a7d', (5,0): 'a8884a', (4,0): 'a8884a', (7,1): '3a3550', (3,2): '8a6248'},
             'rogue_texture': {(1,0): '6e4630'}},
}[who]
for name, cells in RECOLOR.items(): recolor(bpy.data.images[name], cells)

# ---- accessories, rigidly parented to a bone ----
def mat(name, hexcol, rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    lin = [(c/12.92 if c <= 0.04045 else ((c+0.055)/1.055)**2.4) for c in srgb(hexcol)]
    b.inputs['Base Color'].default_value = (*lin, 1); b.inputs['Roughness'].default_value = rough
    return m
def attach(o, bone, m):
    o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    mw = o.matrix_world.copy()
    o.parent = rig; o.parent_type = 'BONE'; o.parent_bone = bone
    bpy.context.view_layer.update()
    o.matrix_world = mw
def prim(kind, loc, rot=(0,0,0), scale=(1,1,1), **kw):
    getattr(bpy.ops.mesh, 'primitive_' + kind + '_add')(location=loc, rotation=rot, **kw)
    o = bpy.context.active_object; o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o
def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
    parts[0].name = name; parts[0].data.name = name
    return parts[0]

def scarf(hexcol):
    m = mat('scarf', hexcol)
    ring = prim('torus', (0, -0.01, 1.255), scale=(1.0, 0.92, 1.25), major_radius=0.27, minor_radius=0.075, major_segments=24, minor_segments=8)
    knot = prim('uv_sphere', (0.13, -0.27, 1.22), scale=(0.08, 0.06, 0.07), segments=10, ring_count=6)
    tail = prim('cube', (0.17, -0.3, 1.08), rot=(math.radians(8), math.radians(-12), 0), scale=(0.07, 0.025, 0.13))
    attach(join([ring, knot, tail], 'Scarf'), 'chest', m)
def glasses():
    m = mat('glasses', '3b2a20', 0.5)
    parts = []
    for s in (1, -1):
        parts.append(prim('torus', (s*0.2, -0.47, 1.6), rot=(math.radians(90), 0, 0), major_radius=0.105, minor_radius=0.014, major_segments=20, minor_segments=6))
        parts.append(prim('cube', (s*0.385, -0.25, 1.62), scale=(0.012, 0.21, 0.012)))
    parts.append(prim('cylinder', (0, -0.47, 1.62), rot=(0, math.radians(90), 0), radius=0.012, depth=0.2, vertices=6))
    attach(join(parts, 'Glasses'), 'head', m)
def braids(hexcol):
    m = mat('braid', hexcol); tie = mat('braid_tie', 'f2efe6')
    for s in (1, -1):
        beads = []
        for i in range(6):
            t = i/5
            beads.append(prim('uv_sphere', (s*(0.43 - 0.05*t), -0.12 - 0.12*t, 1.5 - 0.42*t), scale=(0.085 - 0.02*t, 0.08 - 0.02*t, 0.07), segments=10, ring_count=6))
        b = join(beads, 'Braid_' + ('L' if s > 0 else 'R')); attach(b, 'head', m)
        tt = prim('cylinder', (s*0.38, -0.25, 1.03), radius=0.045, depth=0.05, vertices=10); tt.name = 'BraidTie_' + ('L' if s > 0 else 'R')
        attach(tt, 'head', tie)
TUFTS = [(0.0,-0.36,2.12,-60,0),(0.22,-0.33,2.1,-55,30),(-0.22,-0.34,2.08,-55,-30),(0.12,-0.12,2.3,-25,15),(-0.14,-0.1,2.3,-25,-20),
         (0.0,0.15,2.32,20,0),(0.38,-0.12,1.98,-10,70),(-0.38,-0.12,1.98,-10,-70),(0.3,0.25,2.1,35,40),(-0.3,0.25,2.1,35,-40)]
def tufts(hexcol, size=1.0, n=10):
    m = mat('tufts', hexcol)
    parts = []
    for (x, y, z, rx, ry) in TUFTS[:n]:
        parts.append(prim('cone', (x, y, z), rot=(math.radians(rx), math.radians(ry), 0), radius1=0.12*size, depth=0.3*size, vertices=5))
    attach(join(parts, 'HairTufts'), 'head', m)

if who == 'warrior': scarf('b8322c'); tufts('5e3b25')
if who == 'mage': scarf('a8322e'); glasses()
if who == 'priest': braids('6e4630')

# ---- trim animations, export ----
for a in list(bpy.data.actions):
    if a.name not in KEEP_ACTIONS: bpy.data.actions.remove(a)
rig.data.pose_position = 'POSE'
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name == 'Icosphere': bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='ACTIONS', export_image_format='AUTO')
print('DONE', who, [o.name for o in bpy.data.objects if o.type=='MESH'])
