# Renders contact sheets of the character and gun packs, to choose skins and
# check guns by eye (see ASSETS.md). Headless Blender:
#
#   Blender -b -P apps/client/scripts/assets/render-previews.py -- chars <glTF dir> <out.png> [Name ...]
#   Blender -b -P apps/client/scripts/assets/render-previews.py -- guns <glb dir> <guns.json> <out.png> Name ...
#   Blender -b -P apps/client/scripts/assets/render-previews.py -- hold <glTF dir> <glb dir> <guns.json> <out.png> Character Gun ...
#   Blender -b -P apps/client/scripts/assets/render-previews.py -- ingame <glTF dir> <raw guns dir> <out.png> [Character gun ...]
#
# chars: every character in its Idle pose, seen like the game camera sees it
#   (orthographic, 45 degrees of yaw, 35.26 of pitch), all at the same scale on
#   a mid-grey map floor, with its name. Prints each one's height.
# guns: each gun from the side, with its grip (green) and muzzle (red) from
#   guns.json (written by convert-guns.py).
# hold: one character in a few candidate upper-body poses with each gun on its
#   right hand (Fist.R), to judge the gun hold.
# ingame: a few skins holding their guns the way the game does (character.ts):
#   scaled so the Idle-pose Head bone sits at HEAD_Y, legs in Idle, the rest in
#   Shoot_OneHanded at AIM_T, each gun at its GUN_SCALE with its grip from
#   GUN_MODELS (skins.ts) GRIP_ALONG up the fist, barrel straight ahead. Those
#   numbers are read from the sources. Game camera, a 1 m ring under each for
#   scale. Pairs are a pack character name and a game gun name (rifle, smg...);
#   with none it draws six. Blender can't read the meshopt game guns, so
#   <raw guns dir> is convert-guns.py's output (pack names, AssaultRifle_2.glb
#   ...). FACE=<degrees> turns the characters (default 15). For example:
#     ... -- ingame .packs/chars/glTF <convert-guns out> .previews/skins/in-game.png
import bpy, sys, os, json, math, re
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
MODE = argv[0]

CELL_W, CELL_H = 260, 330
# yard.ts floor by default; FLOOR=46505c (dockside) etc. to try another map.
_f = int(os.environ.get("FLOOR", "5f6570"), 16)
FLOOR = ((_f >> 16) / 255, (_f >> 8 & 255) / 255, (_f & 255) / 255)
# Pack gun name -> the game's file name (build-models.ts' GUNS_MAP).
GUNS_PACK_NAMES = {"AssaultRifle_2": "rifle", "Shotgun_ShortStock": "shotgun", "SniperRifle_1": "sniper",
                   "SubmachineGun_1": "smg", "Revolver_1": "revolver", "Pistol_6": "burst-pistol", "AssaultRifle2_1": "dmr"}
# character.ts' LOWER_BONES: the legs keep the Idle pose, the rest aims.
LOWER_BONES = {"Bone", "Body", "FootL", "FootR", "UpperLegL", "UpperLegR", "LowerLegL", "LowerLegR", "PoleTargetL", "PoleTargetR"}
PITCH = math.atan(1 / math.sqrt(2))
YAW = math.pi / 4


def srgb_to_linear(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = CELL_W, CELL_H
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (*srgb_to_linear((0.75, 0.78, 0.85)), 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(40), math.radians(15), math.radians(30))
    sc.collection.objects.link(sun)
    return sc


def floor(sc, size=20, color=FLOOR):
    bpy.ops.mesh.primitive_plane_add(size=size)
    p = bpy.context.active_object
    m = bpy.data.materials.new("floor")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb_to_linear(color), 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1
    p.data.materials.append(m)


def iso_camera(sc, target, scale):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = scale
    d = 30
    # three's (x, y, z) offset -> Blender (x, -z, y).
    off = Vector((math.sin(YAW) * math.cos(PITCH) * d, -math.cos(YAW) * math.cos(PITCH) * d, math.sin(PITCH) * d))
    cam.location = target + off
    cam.rotation_euler = (-off).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def label(sc, cam, text, y):
    """A name in camera space, near the bottom of the frame."""
    cu = bpy.data.curves.new("t", "FONT")
    cu.body = text
    cu.align_x = "CENTER"
    cu.size = cam.data.ortho_scale * 0.065
    t = bpy.data.objects.new("t", cu)
    mat = bpy.data.materials.new("t")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs[0].default_value = (1, 1, 1, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs[0])
    cu.materials.append(mat)
    t.parent = cam
    t.location = (0, y * cam.data.ortho_scale, -5)
    sc.collection.objects.link(t)
    # A dark strip behind the text.
    bpy.ops.mesh.primitive_plane_add(size=1)
    bg = bpy.context.active_object
    bg.parent = cam
    bg.scale = (cam.data.ortho_scale, cam.data.ortho_scale * 0.1, 1)
    bg.location = (0, (y + 0.02) * cam.data.ortho_scale, -5.1)
    m2 = bpy.data.materials.new("bg")
    m2.use_nodes = True
    m2.node_tree.nodes.clear()
    e2 = m2.node_tree.nodes.new("ShaderNodeEmission")
    e2.inputs[0].default_value = (0.02, 0.02, 0.03, 1)
    o2 = m2.node_tree.nodes.new("ShaderNodeOutputMaterial")
    m2.node_tree.links.new(e2.outputs[0], o2.inputs[0])
    bg.data.materials.append(m2)


def render_cell(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    bpy.data.images.remove(img)
    return px


def sheet(cells, out, cols):
    rows = math.ceil(len(cells) / cols)
    h, w = cells[0].shape[:2]
    big = np.ones((rows * h, cols * w, 4), dtype=np.float32) * np.array([0.1, 0.1, 0.12, 1], dtype=np.float32)
    for i, c in enumerate(cells):
        r = rows - 1 - i // cols  # Blender images start at the bottom
        big[r * h:(r + 1) * h, (i % cols) * w:(i % cols + 1) * w] = c
    img = bpy.data.images.new("sheet", cols * w, rows * h, alpha=True)
    img.pixels = big.ravel()
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    print("wrote", out)


def import_character(path, action="Idle", frame=None):
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    set_action(arm, action, frame)
    return arm


def set_action(arm, action, frame=None):
    act = bpy.data.actions.get(action) or next((a for a in bpy.data.actions if a.name.startswith(action)), None)
    if act is None:
        raise KeyError(action)
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(arm.animation_data, "action_slot") and act.slots:
        arm.animation_data.action_slot = act.slots[0]
    f0, f1 = act.frame_range
    bpy.context.scene.frame_set(int(f0 if frame is None else f0 + (f1 - f0) * frame))


def mesh_bounds():
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in bpy.context.scene.objects:
        if o.type != "MESH" or o.name in ("Plane",) or o.name.startswith("Plane"):
            continue
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        for v in me.vertices:
            w = e.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        e.to_mesh_clear()
    return lo, hi


def attach_gun(arm, glb, info, bone="Fist.R", scale=1.0):
    """Parents a gun to the hand bone, grip on the bone's tip, barrel along the forearm."""
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    gun = next(o for o in bpy.context.scene.objects if o not in before and o.type == "MESH")
    g = Vector(info["grip"])
    # glTF (x, y, z) -> Blender (x, -z, y)
    grip = Vector((g.x, -g.z, g.y))
    gun.data.transform(Matrix.Translation(-grip))
    gun.scale = (scale, scale, scale)
    gun.parent = arm
    gun.parent_type = "BONE"
    gun.parent_bone = bone
    # Bone space: Y runs along the bone. The gun's barrel (+X) goes along it,
    # its top (+Z) toward the bone's -Z (the back of the hand, a guess to check).
    gun.matrix_parent_inverse = Matrix.Identity(4)
    b = arm.data.bones[bone]
    gun.location = (0, -b.length, 0)  # parented to the tail; back to the head of the fist
    gun.rotation_euler = (0, 0, math.radians(90))
    return gun


if MODE == "chars":
    src, out = argv[1], argv[2]
    names = argv[3:] or sorted(f[:-5] for f in os.listdir(src) if f.endswith(".gltf"))
    cells, sizes = [], {}
    tmp = os.path.join(os.path.dirname(out), "_cell.png")
    for n in names:
        sc = reset()
        import_character(os.path.join(src, n + ".gltf"))
        lo, hi = mesh_bounds()
        sizes[n] = {"height": round(hi.z - lo.z, 3), "width": round(max(hi.x - lo.x, hi.y - lo.y), 3)}
        floor(sc)
        cam = iso_camera(sc, Vector((0, 0, 1.6)), 5.0)
        label(sc, cam, n.replace("_", " "), -0.46)
        cells.append(render_cell(sc, tmp))
        print("cell", n, sizes[n])
    os.remove(tmp)
    sheet(cells, out, 8)
    json.dump(sizes, open(out[:-4] + ".json", "w"), indent=1)

elif MODE == "guns":
    src, info_path, out = argv[1], argv[2], argv[3]
    info = json.load(open(info_path))
    cells = []
    tmp = os.path.join(os.path.dirname(out), "_cell.png")
    CELL_W, CELL_H = 520, 300
    for n in filter(None, argv[4:]):
        sc = reset()
        bpy.ops.import_scene.gltf(filepath=os.path.join(src, n + ".glb"))
        i = info[n]
        for key, col in (("grip", (0, 1, 0)), ("muzzle", (1, 0, 0))):
            p = Vector(i[key])
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=(p.x, -p.z, p.y))
            m = bpy.data.materials.new(key)
            m.use_nodes = True
            m.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (*col, 1)
            m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 3
            bpy.context.active_object.data.materials.append(m)
        mn, mx = Vector(i["min"]), Vector(i["max"])
        c = (mn + mx) / 2
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 8
        cam.location = (c.x, -30, c.y)
        cam.rotation_euler = (math.radians(90), 0, 0)
        sc.collection.objects.link(cam)
        sc.camera = cam
        label(sc, cam, f"{n}  ({i['tris']} tris, {i['size'][0]:.1f} long)", -0.24)
        cells.append(render_cell(sc, tmp))
    os.remove(tmp)
    sheet(cells, out, 2)

elif MODE == "hold":
    src, gdir, info_path, out, char = argv[1], argv[2], argv[3], argv[4], argv[5]
    info = json.load(open(info_path))
    guns = argv[6:]
    poses = [("Idle", 0.0), ("Shoot_OneHanded", 0.35), ("Run_Carry", 0.25), ("Run", 0.25)]
    cells = []
    tmp = os.path.join(os.path.dirname(out), "_cell.png")
    for gname in guns:
        for action, f in poses:
            sc = reset()
            arm = import_character(os.path.join(src, char + ".gltf"), action, f)
            attach_gun(arm, os.path.join(gdir, gname + ".glb"), info[gname], scale=float(os.environ.get("GUN_SCALE", "0.35")))
            floor(sc)
            cam = iso_camera(sc, Vector((0, 0, 1.6)), 5.0)
            label(sc, cam, f"{action} + {gname}", -0.46)
            cells.append(render_cell(sc, tmp))
    os.remove(tmp)
    sheet(cells, out, len(poses))

elif MODE == "ingame":
    src, gdir, out = argv[1], argv[2], argv[3]
    pairs = argv[4:] or ["Soldier_Male", "rifle", "Cowboy_Female", "revolver", "Ninja_Sand", "smg",
                         "Knight_Golden_Male", "shotgun", "Chef_Female", "burst-pistol", "Zombie_Male", "sniper"]
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
    # The game's numbers, read from its sources so this follows them.
    ch = open(os.path.join(root, "apps/client/src/character.ts")).read()
    num = lambda name: float(re.search(rf"const {name} = (-?[\d.]+)", ch).group(1))
    HEAD_Y, GRIP_ALONG, GRIP_UP, AIM_T = (num(n) for n in ("HEAD_Y", "GRIP_ALONG", "GRIP_UP", "AIM_T"))
    GUN_SCALE = [float(x) for x in re.search(r"const GUN_SCALE = \[([^\]]+)\]", ch).group(1).split(",")]
    sk = open(os.path.join(root, "packages/shared/src/skins.ts")).read()
    models = re.findall(r'file: "guns/([\w-]+)\.glb", grip: \[([^\]]+)\]', sk)
    GUN_FILES = {v: k for k, v in GUNS_PACK_NAMES.items()}
    cells = []
    tmp = os.path.join(os.path.dirname(os.path.abspath(out)), "_cell.png")
    CELL_W, CELL_H = 360, 400
    for char, gname in zip(pairs[::2], pairs[1::2]):
        w = next(i for i, (f, _) in enumerate(models) if f == gname)
        grip = Vector(float(x) for x in models[w][1].split(","))
        sc = reset()
        bpy.ops.import_scene.gltf(filepath=os.path.join(src, char + ".gltf"), bone_heuristic="BLENDER")
        arm = next(o for o in sc.objects if o.type == "ARMATURE")
        # Scale: the Head bone at HEAD_Y in the Idle pose.
        set_action(arm, "Idle", 0)
        head = (arm.matrix_world @ arm.pose.bones["Head"].matrix).translation.z
        scale = HEAD_Y / head
        # The game's pose: legs in Idle, the rest in Shoot_OneHanded at AIM_T (frame 0).
        lower = {b.name for b in arm.pose.bones if b.name.replace(".", "") in LOWER_BONES}
        pose = {}
        for action, keep in (("Shoot_OneHanded", lambda n: n not in lower), ("Idle", lambda n: n in lower)):
            set_action(arm, action, AIM_T if action != "Idle" else 0)
            for b in arm.pose.bones:
                if keep(b.name):
                    pose[b.name] = b.matrix_basis.copy()
        arm.animation_data.action = None
        for b in arm.pose.bones:
            b.matrix_basis = pose[b.name]
        bpy.context.view_layer.update()
        # The grip point: GRIP_ALONG along the fist bone from its head, GRIP_UP
        # up (unscaled model units); the barrel straight ahead (-Y), top up.
        fist = arm.matrix_world @ arm.pose.bones["Fist.R"].matrix
        along = fist.to_3x3() @ Vector((0, 1, 0))
        at = fist.translation + along.normalized() * GRIP_ALONG + Vector((0, 0, GRIP_UP))
        before = set(sc.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(gdir, GUN_FILES[gname] + ".glb"))
        gun = next(o for o in sc.objects if o not in before and o.type == "MESH")
        gun.parent = None
        gun.data.transform(Matrix.Translation(-Vector((grip.x, -grip.z, grip.y))))
        s = GUN_SCALE[w] * scale
        gun.matrix_world = Matrix.Translation(at * scale) @ Matrix.Rotation(-math.pi / 2, 4, "Z") @ Matrix.Scale(s, 4)
        arm.scale = (scale,) * 3
        # Face three-quarters to the right of the camera, as when aiming across the screen.
        pivot = bpy.data.objects.new("pivot", None)
        sc.collection.objects.link(pivot)
        for o in (arm, gun):
            o.parent = pivot
        pivot.rotation_euler = (0, 0, math.radians(float(os.environ.get("FACE", "15"))))
        floor(sc)
        # A 1 m ring on the floor, for scale.
        bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.012, location=(0, 0, 0.005))
        rm = bpy.data.materials.new("ring")
        rm.use_nodes = True
        rm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (1, 0.85, 0.1, 1)
        bpy.context.active_object.data.materials.append(rm)
        cam = iso_camera(sc, Vector((0, 0, 0.8)), 2.8)
        label(sc, cam, f"{char.replace('_', ' ')} + {gname}", -0.44)
        cells.append(render_cell(sc, tmp))
        print("cell", char, gname, "scale", round(scale, 4), "gun", s)
    os.remove(tmp)
    sheet(cells, out, 3)
