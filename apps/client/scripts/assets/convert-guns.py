# Converts the Quaternius Ultimate Guns pack (FBX) to one .glb per gun, and
# measures each gun's grip and muzzle (see ASSETS.md).
#
# Run it with Blender, headless:
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P apps/client/scripts/assets/convert-guns.py -- \
#     <pack FBX dir> <out dir> [Gun_1 Gun_2 ...]
#
# With no names it converts every .fbx in the folder. Next to the .glb files it
# writes guns.json: for each gun its triangle count and, in glTF coordinates
# (Y up, metres of the source file), its bounding box, its long axis, the grip
# (where the hand goes) and the muzzle (the barrel tip).
#
# Every gun in the pack lies along +X (barrel toward +X, top up). The muzzle is
# the +X end, at the height of the barrel there. The grip is only guessed (the
# centre of the lowest quarter of the gun), so GRIP overrides it per gun after
# checking the preview render (render-previews.py guns).
import bpy, sys, os, json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    raise SystemExit("usage: blender -b -P convert-guns.py -- <fbx dir> <out dir> [names...]")
SRC, OUT = argv[0], argv[1]
names = argv[2:] or sorted(f[:-4] for f in os.listdir(SRC) if f.lower().endswith(".fbx"))
os.makedirs(OUT, exist_ok=True)

# Where the hand closes on the handle (glTF x, y), read off each gun's
# bottom-edge profile and checked on the preview. The guess below is fine for
# pistols but lands on the magazine or the stock of the long guns.
GRIP = {
    "AssaultRifle_2": (-0.05, 0.0),
    "AssaultRifle2_1": (-0.2, 0.0),
    "Shotgun_ShortStock": (0.0, -0.05),
    "SniperRifle_1": (-0.4, -0.15),
    "SubmachineGun_1": (-0.15, 0.0),
    "Revolver_1": (-0.1, -0.1),
    "Pistol_6": (-0.13, -0.1),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    if hasattr(bpy.ops.wm, "fbx_import"):
        bpy.ops.wm.fbx_import(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)


def to_gltf(v):
    """Blender Z-up -> glTF Y-up (+Y forward becomes -Z)."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


report = {}
for name in names:
    reset()
    import_fbx(os.path.join(SRC, name + ".fbx"))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("skip", name, "(no mesh)")
        continue
    # One object per gun, transforms baked, so the .glb is a single node.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    gun = bpy.context.view_layer.objects.active
    gun.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o is not gun:
            bpy.data.objects.remove(o)
    gun.name = name

    verts = [gun.matrix_world @ v.co for v in gun.data.vertices]
    lo = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    hi = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    size = hi - lo
    # Long axis among the horizontal ones (the barrel is level in the pack).
    ax = 0 if size.x >= size.y else 1
    low = [v for v in verts if v.z < lo.z + size.z * 0.25]
    grip = sum(low, Vector()) / len(low)
    if name in GRIP:
        # glTF (x, y) = Blender (x, z); the handle is centred in depth.
        grip = Vector((GRIP[name][0], (lo.y + hi.y) / 2, GRIP[name][1]))
    end = hi[ax]
    tip = [v for v in verts if abs(v[ax] - end) < size[ax] * 0.03]
    muzzle = sum(tip, Vector()) / len(tip)
    muzzle[ax] = end
    tris = sum(len(p.vertices) - 2 for p in gun.data.polygons)

    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + ".glb"), export_format="GLB", use_selection=False,
                              export_apply=True, export_animations=False, export_skins=False)
    report[name] = {
        "tris": tris,
        "size": [round(size.x, 4), round(size.z, 4), round(size.y, 4)],
        "min": to_gltf(lo), "max": to_gltf(hi),
        "longAxis": "x" if ax == 0 else "z",
        "grip": to_gltf(grip), "muzzle": to_gltf(muzzle),
        "materials": [m.name for m in gun.data.materials],
    }
    print(name, report[name])

with open(os.path.join(OUT, "guns.json"), "w") as f:
    json.dump(report, f, indent=1)
