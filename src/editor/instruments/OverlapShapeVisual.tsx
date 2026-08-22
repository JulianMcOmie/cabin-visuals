import { useEffect, useMemo, useRef } from 'react'
import {
  AlwaysDepth,
  AlwaysStencilFunc,
  Color,
  DoubleSide,
  EqualDepth,
  EqualStencilFunc,
  IncrementWrapStencilOp,
  InvertStencilOp,
  KeepStencilOp,
  LessEqualDepth,
  LessEqualStencilFunc,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  ReplaceStencilOp,
  Shape,
  ShaderMaterial,
  ShapeGeometry,
  Vector3,
  ZeroStencilOp,
  type Material,
  type Group,
  type Mesh,
} from 'three'
import { InstancedMesh2 } from '@three.ez/instanced-mesh'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { useInstancedCopyFrame } from '../core/visual/instancedFrame'
import { applyColorShiftToColor } from '../core/visual/instrumentColor'
import type { VisualCopy } from '../core/visualCopies/types'
import {
  OVERLAP_RAMP_GRADIENT,
  OVERLAP_SHAPE_OPTIONS,
  OVERLAP_SHAPE_PASSES,
  overlapShapeDepthColors,
  overlapShapeIndex,
  overlapShapePassActive,
  overlapShapePoints,
  overlapShapeScale,
  type OverlapShapePass,
} from './overlapShapeCore'
import { paramDefault, stringParamDefault } from './types'
import { overlapShapeInstrument } from './OverlapShape'

// The Overlap Shape visuals - the lazy half of ./OverlapShape (see that file
// for the def and the instrument's "why"; the pass recipe itself lives in
// ./overlapShapeCore.ts). Two render paths, exactly like CubeVisual:
// OverlapShapeVisual draws ONE occurrence (mounted per copy by ObjectRenderer),
// OverlapShapeInstanced draws every VisualCopy occurrence of a track through
// one InstancedMesh2 object per stencil pass.
//
// BOTH recipes are mounted at once and the frame makes one of them visible
// (`overlapShapePassActive`). The pass list IS the mesh list, so deriving it
// from the ORDERS param instead would mean re-rendering React whenever a knob
// moved - invariant 4 in the root guide. An idle pass costs a material and a
// (skipped) draw-list entry; the per-frame loops below skip the inactive ones
// outright, so a plain parity track pays nothing per copy for the counted
// fills hanging beside it.

function geometryFor(shape: number): ShapeGeometry {
  const points = overlapShapePoints(shape)
  const outline = new Shape()
  outline.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) outline.lineTo(points[i][0], points[i][1])
  outline.closePath()
  return new ShapeGeometry(outline)
}

/** One material per pass, configured straight from the pure pass spec. The
 *  color materials stay tone-map-free so "renders a single color" is literal.
 *  None of them declare FORCE_TRANSPARENT: at full opacity all seven live in
 *  the OPAQUE render list (renderOrder is honored there), and a track fade
 *  flips them transparent together, so the pass order survives either way. */
function materialFor(pass: OverlapShapePass): Material {
  // The depth-clear pass is the one that cannot be a stock material: writing
  // FAR depth (rather than the mesh's own plane) takes gl_FragDepth. Depth
  // test must stay ENABLED (a disabled test also disables depth writes in GL)
  // with func Always so the far value always lands where the stencil allows.
  const material = pass.depth === 'clear'
    ? new ShaderMaterial({
        vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'void main() { gl_FragDepth = 1.0; gl_FragColor = vec4(0.0); }',
      })
    : new MeshBasicMaterial({ toneMapped: false })
  material.side = DoubleSide
  material.colorWrite = pass.writesColor
  if (pass.depth === 'prepass') {
    material.depthWrite = true
    material.depthFunc = LessEqualDepth
  } else if (pass.depth === 'equal') {
    material.depthWrite = false
    material.depthFunc = EqualDepth
  } else if (pass.depth === 'clear') {
    material.depthWrite = true
    material.depthFunc = AlwaysDepth
  } else {
    material.depthWrite = false
    material.depthTest = false
  }
  const stencil = pass.stencil
  if (stencil) {
    material.stencilWrite = true
    material.stencilFunc = stencil.func === 'always'
      ? AlwaysStencilFunc
      : stencil.func === 'lequal' ? LessEqualStencilFunc : EqualStencilFunc
    material.stencilRef = stencil.ref
    material.stencilFuncMask = stencil.funcMask
    material.stencilFail = KeepStencilOp
    material.stencilZFail = KeepStencilOp
    material.stencilZPass = stencil.zPass === 'invert'
      ? InvertStencilOp
      : stencil.zPass === 'replace'
        ? ReplaceStencilOp
        // Wrap rather than saturate: the counted tally lives under a four-bit
        // write mask, where GL's saturating INCR would carry out of the field
        // anyway - so both ops wrap at 16 and only this one says so.
        : stencil.zPass === 'increment' ? IncrementWrapStencilOp : ZeroStencilOp
    material.stencilWriteMask = stencil.writeMask
  }
  return material
}

/** Every coverage depth's colour for this frame, indexed by depth - 1. The
 *  ramp (or the per-depth picks) is resolved ONCE per frame rather than per
 *  pass, and `state.stringParams` already carries any Colorizer shift -
 *  useInstrumentFrame applies it over the declared colour params, all six of
 *  them, so shifting the ramp's ends shifts every stop between them. Absent
 *  values fall back to the SCHEMA, never a repeated literal. */
function depthColorsOf(state: { params: Record<string, number>; stringParams: Record<string, string> }): string[] {
  const par = (key: string) => state.params[key] ?? paramDefault(overlapShapeInstrument, key)
  return overlapShapeDepthColors(
    par('overlapOrders'),
    par('overlapColorMode') === OVERLAP_RAMP_GRADIENT,
    (key) => state.stringParams[key] || stringParamDefault(overlapShapeInstrument, key),
  )
}

/** The colour a fill pass paints with: its declared coverage depth, held at the
 *  deepest the ramp reaches (the same hold its stencil gate performs). */
function fillHexOf(depthColors: string[], pass: OverlapShapePass): string {
  return depthColors[Math.min(pass.order ?? 1, depthColors.length) - 1]
}

/** Which recipe is live, from the two params that pick it. */
function passGate(par: (key: string) => number) {
  return { overlapOn: par('overlapMode') >= 0.5, orders: par('overlapOrders') }
}

export function OverlapShapeVisual({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const meshRefs = useRef<(Mesh | null)[]>([])
  const shapeRef = useRef(-1)
  const geometries = useMemo(() => OVERLAP_SHAPE_OPTIONS.map((o) => geometryFor(o.value)), [])
  const materials = useMemo(() => OVERLAP_SHAPE_PASSES.map(materialFor), [])
  useEffect(() => () => {
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
  }, [geometries, materials])

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group || meshRefs.current.length < OVERLAP_SHAPE_PASSES.length) return false
    // Fallbacks read the SCHEMA, never a repeated literal (this dir's guide).
    const par = (key: string) => state.params[key] ?? paramDefault(overlapShapeInstrument, key)

    const shape = overlapShapeIndex(par('shape'))
    if (shape !== shapeRef.current) {
      shapeRef.current = shape
      for (const mesh of meshRefs.current) {
        if (mesh) mesh.geometry = geometries[shape]
      }
    }

    // One recipe draws, the other stands down - and inside the live one,
    // cut-out withholds the overlap fill (the even-covered region stays
    // undrawn, so the scene behind shows through) and a fill deeper than the
    // last colour stands down so that depth holds the colour above it.
    const gate = passGate(par)
    const depthColors = depthColorsOf(state)
    OVERLAP_SHAPE_PASSES.forEach((pass, i) => {
      const mesh = meshRefs.current[i]
      if (!mesh) return
      const active = overlapShapePassActive(pass, gate)
      mesh.visible = active
      if (active && pass.writesColor) {
        ;(materials[i] as MeshBasicMaterial).color.set(fillHexOf(depthColors, pass))
      }
    })

    group.scale.setScalar(overlapShapeScale(par('size'), state.energy, par('pulse')))
  })

  return (
    <group ref={groupRef}>
      {OVERLAP_SHAPE_PASSES.map((pass, i) => (
        <mesh
          key={`${pass.name}${pass.order ?? ''}`}
          ref={(mesh) => { meshRefs.current[i] = mesh }}
          renderOrder={pass.renderOrder}
          material={materials[i]}
        />
      ))}
    </group>
  )
}

// ── Instanced path ──────────────────────────────────────────────────────────
// ONE mount per track drawing every VisualCopy occurrence: a splitter's 360
// coplanar shapes are one InstancedMesh2 draw per stencil pass instead
// of 360 mounted components × a mesh each. The parity look survives untouched
// because it never depended on per-copy mounts - it depends on renderOrder
// interleaving the passes ACROSS occurrences (every copy's depth prepass
// before any copy's parity pass, and so on), and one instanced mesh per pass
// holding every copy IS that interleaving. Within one pass the copies' mutual
// order can't change the pixels: depth is a LessEqual min, mark/cleanup are
// idempotent writes, parity is a commutative invert, the counted tally is a
// commutative increment, and the DONE/BASE bits - or, in the counted recipe,
// zeroing the tally as the fill lands - mean a contested pixel takes exactly
// one fill whichever copy rasterizes first. The only tie is WHICH copy's
// (color-shifted) fill wins, and instances draw in copy order, so that stays
// deterministic.
//
// Kept pixel-faithful to the per-copy path above:
// - Fill colors reproduce useInstrumentFrame's string-param shift exactly:
//   same active-shift threshold, same applyColorShiftToColor math, and the
//   same 8-bit hex quantization the string path rounds through.
//
// - copyFillColor below quantizes via setHex(getHex()) because that IS the
//   `'#' + getHexString()` round trip without the string allocation.
// - The placement matrix rides the same decompose→compose rounding the
//   per-copy path takes through its group's position/quaternion/scale.

/** The instanced counterpart of materialFor: the stock materials instance
 *  through the library's patched chunks automatically; only the depth-clear
 *  ShaderMaterial needs its vertex shader taught to read the matrices texture
 *  (mirroring three's own project_vertex order so its footprint agrees with
 *  the sibling passes). */
function instancedMaterialFor(pass: OverlapShapePass): Material {
  const material = materialFor(pass)
  if (pass.depth === 'clear') {
    ;(material as ShaderMaterial).vertexShader = /* glsl */ `
      #include <instanced_pars_vertex>
      void main() {
        vec4 mvPosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING_INDIRECT
          mvPosition = getInstancedMatrix() * mvPosition;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      }
    `
  }
  return material
}

/** The copy's fill color, matching the per-copy path bit for bit: the shift
 *  only applies past the same threshold useInstrumentFrame gates on, and the
 *  result rounds through 8-bit hex exactly as the string-param path does. */
function copyFillColor(
  out: Color,
  sourceHex: string,
  shift: Readonly<VisualCopy['colorShift']> | undefined,
  scratchTint: Color,
): Color {
  out.set(sourceHex)
  const active = shift && (
    Math.abs(shift.hue) + Math.abs(shift.saturation) + Math.abs(shift.lightness) > 0.0001
    || (shift.tint !== null && shift.tintAmount > 0.0001)
  )
  if (active) {
    applyColorShiftToColor(out, shift, scratchTint)
    out.setHex(out.getHex())
  }
  return out
}

const _mat = new Matrix4()
const _scaleM = new Matrix4()
const _pos = new Vector3()
const _quat = new Quaternion()
const _scl = new Vector3()
const _fill = new Color()
const _tint = new Color()

export function OverlapShapeInstanced({ trackId }: { trackId: string }) {
  const rig = useMemo(() => {
    const meshes = OVERLAP_SHAPE_PASSES.map((pass) => {
      const mesh = new InstancedMesh2(geometryFor(0), instancedMaterialFor(pass))
      mesh.renderOrder = pass.renderOrder
      // Give every stock-material pass a colors texture up front (the fills
      // write real per-instance color/fade into theirs; the others never
      // touch the prefilled 1s and write no color anyway). This is not
      // cosmetic: the library's program cache keys on the texture's presence,
      // so without it the EqualDepth passes would compile a different program
      // from the fills - and equal-depth only holds between identical
      // programs rasterizing identical matrices.
      if (pass.depth !== 'clear') mesh.setOpacityAt(0, 1)
      return mesh
    })
    return { meshes, shape: 0 }
  }, [])

  useEffect(() => () => {
    for (const mesh of rig.meshes) {
      mesh.geometry.dispose()
      ;(mesh.material as Material).dispose()
      mesh.dispose()
    }
  }, [rig])

  useInstancedCopyFrame(trackId, (f) => {
    const { state, copies } = f
    const { meshes } = rig
    const count = Math.max(1, copies.length)
    if (meshes[0].instancesCount !== count) {
      for (const mesh of meshes) {
        mesh.clearInstances()
        mesh.addInstances(count, () => {})
      }
    }

    const par = (key: string) => state.params[key] ?? paramDefault(overlapShapeInstrument, key)

    const shape = overlapShapeIndex(par('shape'))
    if (shape !== rig.shape) {
      rig.shape = shape
      for (const mesh of meshes) {
        // InstancedMesh2 attaches its SHARED `instanceIndex` GL buffer
        // attribute to whatever geometry it holds; dispose the old geometry
        // with it still attached and three deletes the shared buffer - the
        // new geometry then draws NOTHING until a reload (CubeVisual's
        // documented trap). Detach first, then dispose what this geometry
        // owns. Each mesh keeps its OWN ShapeGeometry: sharing one across
        // the seven meshes would make each steal the previous one's
        // instanceIndex attribute (the library clones with a warning).
        const old = mesh.geometry
        old.deleteAttribute('instanceIndex')
        old.dispose()
        mesh.geometry = geometryFor(shape)
        mesh.geometry.computeBoundingSphere()
      }
    }

    // The live recipe's passes, resolved once: everything below - matrices,
    // per-instance visibility, fills - runs over THESE meshes only, so the
    // idle recipe costs nothing per copy. (Cut-out withholding the overlap
    // fill is the same gate, exactly as the per-copy path leaves that mesh
    // invisible.)
    const gate = passGate(par)
    const depthColors = depthColorsOf(state)
    const active: { mesh: InstancedMesh2; hex: string | null }[] = []
    for (let p = 0; p < OVERLAP_SHAPE_PASSES.length; p++) {
      const pass = OVERLAP_SHAPE_PASSES[p]
      const on = overlapShapePassActive(pass, gate)
      meshes[p].visible = on && !state.blackedOut
      if (on) {
        active.push({ mesh: meshes[p], hex: pass.writesColor ? fillHexOf(depthColors, pass) : null })
      }
    }

    const s = overlapShapeScale(par('size'), state.energy, par('pulse'))
    _scaleM.makeScale(s, s, s)

    let anyFaded = false
    for (let i = 0; i < count; i++) {
      const fade = f.copyFade(i)
      const visible = fade > 0.001
      for (const { mesh } of active) mesh.setVisibilityAt(i, visible)
      if (!visible) continue
      if (fade < 0.999) anyFaded = true
      f.composeCopyMatrix(i, _mat)
      // The per-copy path lands this matrix on a group's position/quaternion/
      // scale and three recomposes it; ride the same decompose→compose
      // rounding so both paths rasterize identical vertices.
      _mat.decompose(_pos, _quat, _scl)
      _mat.compose(_pos, _quat, _scl)
      // The size/pulse swell is a child-group scale in the per-copy path -
      // multiplied after placement, exactly as here.
      _mat.multiply(_scaleM)
      const shift = copies[i]?.colorShift
      const opacity = Math.min(1, fade)
      for (const { mesh, hex } of active) {
        mesh.setMatrixAt(i, _mat)
        if (hex === null) continue
        mesh.setColorAt(i, copyFillColor(_fill, hex, shift, _tint))
        mesh.setOpacityAt(i, opacity)
      }
    }
    // Mirror applyMaterialOpacity's rule: any mid-fade copy flips the whole
    // pass stack into the transparent list TOGETHER (renderOrder is honored in
    // both lists, so the pass order survives the move). The idle recipe comes
    // along - it is one `visible` flag away from drawing again.
    for (const mesh of meshes) (mesh.material as Material).transparent = anyFaded
  })

  return (
    <>
      {rig.meshes.map((mesh, i) => (
        <primitive key={OVERLAP_SHAPE_PASSES[i].name} object={mesh} />
      ))}
    </>
  )
}
