# Converts models of the Quaternius Ultimate Nature Pack (OBJ + MTL) to one
# .glb per model, for props.glb (see ASSETS.md and build-models.ts --nature).
#
# Run it with Blender, headless:
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P apps/client/scripts/assets/convert-nature.py -- \
#     <pack OBJ dir> <out dir> Name_1 Name_2 ...
#
# For each model:
# - the pieces are joined into one mesh named after the model;
# - it is moved up so its lowest point is on the ground (y = 0): some rocks
#   are modelled sunk 0.2-0.3 m into the ground, and props are placed by
#   their bounds or their origin, both expecting the base at y = 0;
# - every material gets flat, matte PBR values (metallic 0, roughness 0.9,
#   like the Toon Shooter kit's props) and keeps its colour, except the snow:
#   the pack's snow is slightly lilac, so it is recoloured to a neutral cool
#   white that matches the snowy maps' floor (Ironvale's 0xc6cfd8).
import bpy, sys, os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 3:
    raise SystemExit("usage: blender -b -P convert-nature.py -- <obj dir> <out dir> Name...")
SRC, OUT, names = argv[0], argv[1], argv[2:]
os.makedirs(OUT, exist_ok=True)

# Linear RGB. Ironvale's floor 0xc6cfd8 is (0.565, 0.624, 0.686) linear; the
# snow sits a touch brighter so it reads as snow on top of the floor.
SNOW = (0.60, 0.64, 0.70, 1.0)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


for name in names:
    reset()
    bpy.ops.wm.obj_import(filepath=os.path.join(SRC, name + ".obj"))
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low = min(v.co.z for v in obj.data.vertices)
    for v in obj.data.vertices:
        v.co.z -= low
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        if mat.name.split(".")[0] == "Snow":
            bsdf.inputs["Base Color"].default_value = SNOW
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.9
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.5
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, name + ".glb"),
        export_format="GLB",
        use_selection=False,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
    )
    print(f"{name}: lifted {-low:.3f} m")
