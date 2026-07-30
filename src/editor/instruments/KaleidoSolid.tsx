import { useEffect, useMemo, useRef } from 'react'
import { Mesh, MeshPhysicalMaterial, type IUniform } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import {
  FUNDAMENTAL_GEOMETRIES,
  FundamentalGeometryShape,
  normalizeFundamentalGeometry,
  type FundamentalGeometryId,
} from './FundamentalGeometry'
import { barrelTwist } from './kaleidoTwist'
import { paramDefault, type ObjectInstrumentDef } from './types'

/**
 * Kaleido Solid: a solid whose SURFACE is a live kaleidoscope.
 *
 * The pattern is generated in OBJECT space, so it is bolted to the surface -
 * it turns and travels with the mesh instead of sliding across it as the object
 * moves. Object space rather than UV space on purpose: a cube's UV seams would
 * tear the pattern into six unrelated tiles, and object space has no seams at
 * all, so one field works for every solid in the vocabulary.
 *
 * Nothing here is a preset or a baked image. The shards continuously grow and
 * shrink, drift within their cells, morph between 3 and 7 sides, and each one
 * cycles its own hue - so the surface never settles into a fixed texture.
 *
 * The field is injected into a MeshPhysicalMaterial rather than drawn with a raw
 * ShaderMaterial, so the scene's real lights, clearcoat and shadows still model
 * the form; the kaleidoscope supplies base colour and tints the emissive glow.
 */

// The field, shared verbatim by the material injection below and the settings
// panel's preview - so what the panel shows cannot drift from what renders.
export const KALEIDO_FIELD_GLSL = `
  uniform float uKBeat;
  uniform float uKFacets;
  uniform float uKScale;
  uniform float uKDrift;
  uniform float uKHue;
  uniform float uKTwist;

  #define KTAU 6.2831853
  #define KPI 3.14159265

  float kHash(float n) { return fract(sin(n * 127.1) * 43758.5453123); }
  mat2 kRot(float t) { float c = cos(t), s = sin(t); return mat2(c, -s, s, c); }

  /** Signed distance to a regular n-gon. n is deliberately continuous: sweeping
   *  it 3 to 7 morphs triangle through heptagon smoothly. */
  float kNgon(vec2 p, float n, float rad) {
    float an = KPI / n;
    float t = mod(atan(p.y, p.x) + an, 2.0 * an) - an;
    return length(p) * cos(t) - rad * cos(an);
  }

  vec3 kPalette(float h) {
    return 0.5 + 0.5 * cos(KTAU * (vec3(0.0, 0.33, 0.67) + h));
  }

  /** The kaleidoscope, evaluated for a direction in the solid's OWN space. */
  vec3 kaleidoField(vec3 objDir) {
    vec3 d = normalize(objDir);
    float phi = acos(clamp(d.y, -1.0, 1.0));   // 0 at the north pole, PI at the south
    float theta = atan(d.z, d.x);

    float n = max(2.0, floor(uKFacets + 0.5));
    float seg = KTAU / n;
    float halfSeg = seg * 0.5;

    float t = uKBeat * uKDrift;
    // Notes turn the barrel (uKTwist); Drift is the idle turn on top of it.
    float a = mod(theta + uKTwist + t * 0.15, seg);
    a = abs(a - halfSeg);                       // a == 0 and a == halfSeg are mirror lines

    float shapeScale = clamp(halfSeg / (KPI / 6.0), 0.35, 1.5);
    float pitch = 0.3 * shapeScale * clamp(uKScale, 0.15, 4.0);

    // Surface metric: a wedge's arc length at polar angle phi shrinks as sin(phi),
    // so folding that in keeps cells square right up to both poles instead of
    // crowding them into a smear at the south end.
    vec2 fp = vec2(a * sin(phi), phi);

    vec3 accum = kPalette(uKHue + 0.5) * 0.12;
    float cover = 0.0;
    float aa = 0.08 * pitch;

    float ringHere = floor(phi / pitch);
    for (int ro = -1; ro <= 1; ro++) {
      float ri = ringHere + float(ro);
      if (ri < 0.0) continue;
      float rMid = (ri + 0.5) * pitch;
      if (rMid > KPI) continue;

      // Cells per ring grow with radius so density stays even; a fixed count per
      // ring spreads over a growing arc and thins out to confetti.
      float cells = max(1.0, floor(halfSeg * sin(rMid) / pitch + 0.5));
      float cellHere = floor((a / max(0.0001, halfSeg)) * cells);

      for (int co = -1; co <= 1; co++) {
        // Cells past the wedge edge are kept, not skipped: those are the shards
        // straddling a mirror line, which the fold returns sliced.
        float ci = cellHere + float(co);
        float sa = kHash(ri * 7.31 + ci * 3.17 + 1.3);
        float sb = kHash(ri * 11.7 + ci * 5.91 + 7.7);
        float sc = kHash(ri * 3.93 + ci * 9.13 + 13.1);

        // MOVE - each shard wanders inside its own cell, radially and across the
        // wedge, so the 3x3 window still catches everything that can reach here.
        float rr = rMid + 0.3 * pitch * sin(t * (0.5 + 0.3 * sa) + sa * KTAU);
        float uu = (ci + 0.5) / cells + (0.34 / cells) * sin(t * (0.4 + 0.3 * sb) + sb * KTAU);
        vec2 c = vec2(halfSeg * uu * sin(rr), rr);

        // GROW - size swings hard and each shard runs its own cycle, so shapes
        // bloom and close rather than sitting at one size.
        float grow = 0.5 + 0.62 * sin(t * (0.6 + 0.5 * sc) + sc * KTAU);
        float rad = pitch * (0.3 + 0.22 * sa) * max(0.05, grow);
        float sides = 3.0 + 4.0 * (0.5 + 0.5 * sin(t * 0.35 + sc * KTAU));
        float rot = t * (0.35 + 0.4 * sc) + sc * KTAU;

        float dist = kNgon(kRot(rot) * (fp - c), sides, rad);
        float m = smoothstep(aa, -aa * 0.35, dist);

        // RECOLOUR - every shard travels the palette at its own rate, so the
        // surface keeps changing colour instead of holding a fixed scheme.
        vec3 shard = kPalette(uKHue + ri * 0.19 + ci * 0.11 + t * (0.1 + 0.14 * sc))
                   * (0.7 + 0.45 * sb);
        accum = mix(accum, shard, m * 0.92);
        cover = max(cover, m);
      }
    }

    // Mirror seams, only where there is glass: darkening the bare tint too turns
    // the solid into a spoked umbrella.
    float edge = min(a, halfSeg - a) / max(0.0001, halfSeg);
    accum *= mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.08, edge)), cover);
    return accum;
  }
`

/** Sphere shows the mandala most clearly, so it is the shape the instrument
 *  arrives as. Must match the `geometry` param default below AND the initial
 *  `visible` flag on the meshes. */
const DEFAULT_GEOMETRY: FundamentalGeometryId = 'sphere'

export const kaleidoSolidInstrument: ObjectInstrumentDef = {
  id: 'kaleidoSolid',
  name: 'Kaleido Solid',
  kind: 'object',
  userInterfaceRenderer: 'kaleidoSolid',
  // Position and size are the canonical track transform (core/transform.ts), so
  // these are behaviour only. Four knobs on purpose - everything else that makes
  // the surface live is derived in the shader.
  params: [
    { key: 'geometry', label: 'Geometry', type: 'string', default: DEFAULT_GEOMETRY },
    // Floored in the shader: automation lanes interpolate continuously and a
    // fractional wedge count tears the fold at the wrap seam.
    { key: 'facets', label: 'Facets', min: 2, max: 16, step: 1, default: 6 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, step: 0.05, default: 1 },
    { key: 'drift', label: 'Drift', min: 0, max: 2, step: 0.05, default: 0.6 },
    { key: 'hue', label: 'Hue', min: 0, max: 6.28, step: 0.05, default: 0 },
  ],
  // A note flicks the kaleidoscope's barrel: the pattern lurches to a new
  // arrangement and settles. Pitch picks the coarse size of the flick.
  midiRows: [
    { pitch: 76, label: 'Twist · hard', emphasized: true },
    { pitch: 68, label: 'Twist · strong' },
    { pitch: 60, label: 'Twist · medium' },
    { pitch: 52, label: 'Twist · soft' },
    { pitch: 44, label: 'Twist · nudge' },
  ],
  component: KaleidoSolid,
}

/** One solid per track, its surface generated by KALEIDO_FIELD_GLSL. */
export function KaleidoSolid({ trackId }: { trackId: string }) {
  const meshRefs = useRef<Record<FundamentalGeometryId, Mesh | null>>({
    cube: null,
    tetrahedron: null,
    octahedron: null,
    dodecahedron: null,
    icosahedron: null,
    sphere: null,
  })

  // One uniform object set, shared by the single material below. Mutating
  // `.value` per frame never triggers a React render, per the engine's rule.
  const uniforms = useRef<Record<string, IUniform>>({
    uKBeat: { value: 0 },
    uKFacets: { value: paramDefault(kaleidoSolidInstrument, 'facets') },
    uKScale: { value: paramDefault(kaleidoSolidInstrument, 'scale') },
    uKDrift: { value: paramDefault(kaleidoSolidInstrument, 'drift') },
    uKHue: { value: paramDefault(kaleidoSolidInstrument, 'hue') },
    uKTwist: { value: 0 },
  })

  // One material for all six meshes (only one is ever visible), so switching
  // geometry cannot switch appearance.
  const material = useMemo(() => {
    const mat = new MeshPhysicalMaterial({
      color: '#ffffff',
      metalness: 0.05,
      roughness: 0.46,
      // Kept low deliberately: the field already supplies vivid colour, and a
      // strong clearcoat/emissive on top clips the lit side and the grazing rim
      // to white, which reads as a blown-out blob rather than glass.
      clearcoat: 0.3,
      clearcoatRoughness: 0.3,
      envMapIntensity: 0.7,
      emissive: '#ffffff',
      emissiveIntensity: 0.16,
    })
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms.current)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vKObj;')
        // begin_vertex is where `transformed` is seeded from `position`, i.e. the
        // last point at which position is still in the solid's own space.
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vKObj = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vKObj;\n${KALEIDO_FIELD_GLSL}`)
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          // Scaled to leave the lights headroom: the field peaks near 1.0, and a
          // near-white albedo under this scene's ambient + directional + two point
          // lights saturates the lit hemisphere to pale wash. Albedo is a
          // REFLECTANCE, so it belongs well below 1.
          'vec3 kSurf = kaleidoField(vKObj);\n  vec4 diffuseColor = vec4( kSurf * 0.5, opacity );',
        )
        // `emissive` already carries emissiveIntensity, so tinting it by the field
        // makes the glow follow the shards instead of washing them flat white.
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * kSurf;')
    }
    return mat
  }, [])

  useEffect(() => () => { material.dispose() }, [material])

  useInstrumentFrame(trackId, (state) => {
    // Tracks are created without stringParams populated, so an unset value must
    // fall back to THIS instrument's default. normalizeFundamentalGeometry's own
    // fallback is 'cube' (right for the 3D Shape instrument, wrong here), which
    // otherwise silently renders a cube while the panel reports a sphere.
    const geometry = normalizeFundamentalGeometry(state.stringParams.geometry ?? DEFAULT_GEOMETRY)
    const mesh = meshRefs.current[geometry]
    // Bail rather than half-update: a silent partial pass would leave the solid
    // stale until the next input change, which may never come while paused.
    if (!mesh) return false
    for (const option of FUNDAMENTAL_GEOMETRIES) {
      const candidate = meshRefs.current[option.id]
      if (candidate) candidate.visible = option.id === geometry
    }

    const u = uniforms.current
    u.uKBeat.value = state.beat
    u.uKFacets.value = state.params.facets ?? paramDefault(kaleidoSolidInstrument, 'facets')
    u.uKScale.value = state.params.scale ?? paramDefault(kaleidoSolidInstrument, 'scale')
    u.uKDrift.value = state.params.drift ?? paramDefault(kaleidoSolidInstrument, 'drift')
    u.uKHue.value = state.params.hue ?? paramDefault(kaleidoSolidInstrument, 'hue')
    u.uKTwist.value = barrelTwist(state.notes, state.beat)
  })

  return (
    <group>
      {FUNDAMENTAL_GEOMETRIES.map(({ id }) => (
        <mesh
          key={id}
          ref={(el) => { meshRefs.current[id] = el }}
          visible={id === DEFAULT_GEOMETRY}
          material={material}
          castShadow
          receiveShadow
        >
          <FundamentalGeometryShape geometry={id} />
        </mesh>
      ))}
    </group>
  )
}
