import { useEffect, useMemo, useRef } from 'react'
import {
  AlwaysDepth,
  AlwaysStencilFunc,
  DoubleSide,
  EqualDepth,
  EqualStencilFunc,
  InvertStencilOp,
  KeepStencilOp,
  LessEqualDepth,
  MeshBasicMaterial,
  ReplaceStencilOp,
  Shape,
  ShaderMaterial,
  ShapeGeometry,
  ZeroStencilOp,
  type Material,
  type Group,
  type Mesh,
} from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import {
  OVERLAP_SHAPE_OPTIONS,
  OVERLAP_SHAPE_PASSES,
  overlapShapeIndex,
  overlapShapePoints,
  overlapShapeScale,
  type OverlapShapePass,
} from './overlapShapeCore'
import { paramDefault, type MidiRowDef, type ObjectInstrumentDef, type ParamDef } from './types'

// OVERLAP SHAPE - a flat 2D shape standing in 3D space, painted one pure color.
// Wherever copies of it cross IN THE SAME PLANE (equal depth from the camera -
// splitter copies, mover-driven passes, even another Overlap Shape track), the
// overlap region flips: a clean cutout to whatever is behind, or a second
// picked color. Shapes at different depths just occlude like any solid.
//
// The whole mechanism is the five-pass stencil recipe in overlapShapeCore.ts
// (see the essay there); this file maps that pure spec onto three.js materials
// and the instrument def. It depends on the scene render target carrying a
// stencil buffer (VisualScene / ShaderWrapper enable one); on a context
// without stencil it degrades to a plain single-color shape.

export const DEFAULT_OVERLAP_SHAPE_BASE_COLOR = '#ff5470'
export const DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR = '#2dd4bf'

export const OVERLAP_MODE = { cutOut: 0, color: 1 } as const

const PARAMS: ParamDef[] = [
  {
    key: 'shape',
    label: 'Shape',
    type: 'select',
    options: OVERLAP_SHAPE_OPTIONS.map(({ value, label }) => ({ value, label })),
    default: 0,
  },
  { key: 'size', label: 'Size', min: 0.1, max: 6, step: 0.05, default: 1.2 },
  { key: 'pulse', label: 'Note Pulse', min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: 'baseColor', label: 'Color', type: 'color', default: DEFAULT_OVERLAP_SHAPE_BASE_COLOR },
  {
    key: 'overlapMode',
    label: 'Overlap',
    type: 'select',
    options: [
      { value: OVERLAP_MODE.cutOut, label: 'Cut out' },
      { value: OVERLAP_MODE.color, label: 'Color' },
    ],
    default: OVERLAP_MODE.cutOut,
  },
  {
    key: 'overlapColor',
    label: 'Overlap Color',
    type: 'color',
    default: DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR,
    showIf: 'overlapMode=1',
  },
]

// The basic-shapes pulse vocabulary: notes swell the shape, pitch = strength.
const MIDI_ROWS: MidiRowDef[] = [
  { pitch: 76, label: 'Pulse · max', emphasized: true },
  { pitch: 68, label: 'Pulse · strong' },
  { pitch: 60, label: 'Pulse · medium' },
  { pitch: 52, label: 'Pulse · soft' },
  { pitch: 44, label: 'Pulse · gentle' },
  { pitch: 36, label: 'Pulse · faint' },
]

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
    material.stencilFunc = stencil.func === 'always' ? AlwaysStencilFunc : EqualStencilFunc
    material.stencilRef = stencil.ref
    material.stencilFuncMask = stencil.funcMask
    material.stencilFail = KeepStencilOp
    material.stencilZFail = KeepStencilOp
    material.stencilZPass = stencil.zPass === 'invert'
      ? InvertStencilOp
      : stencil.zPass === 'replace' ? ReplaceStencilOp : ZeroStencilOp
    material.stencilWriteMask = stencil.writeMask
  }
  return material
}

const OVERLAP_PASS_INDEX = OVERLAP_SHAPE_PASSES.findIndex((p) => p.name === 'overlap')
const BASE_PASS_INDEX = OVERLAP_SHAPE_PASSES.findIndex((p) => p.name === 'base')

function OverlapShapeVisual({ trackId }: { trackId: string }) {
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

    // These already carry any Colorizer shift (useInstrumentFrame applies
    // applyColorShiftToInstrumentParams over declared color params). The two
    // fill passes are the only MeshBasicMaterials with a visible color.
    ;(materials[BASE_PASS_INDEX] as MeshBasicMaterial).color.set(
      state.stringParams.baseColor || DEFAULT_OVERLAP_SHAPE_BASE_COLOR,
    )
    ;(materials[OVERLAP_PASS_INDEX] as MeshBasicMaterial).color.set(
      state.stringParams.overlapColor || DEFAULT_OVERLAP_SHAPE_OVERLAP_COLOR,
    )
    // Cut-out mode simply never mounts the overlap fill: the even-covered
    // region stays undrawn, so the scene behind shows through.
    const overlapMesh = meshRefs.current[OVERLAP_PASS_INDEX]
    if (overlapMesh) overlapMesh.visible = par('overlapMode') >= 0.5

    group.scale.setScalar(overlapShapeScale(par('size'), state.energy, par('pulse')))
  })

  return (
    <group ref={groupRef}>
      {OVERLAP_SHAPE_PASSES.map((pass, i) => (
        <mesh
          key={pass.name}
          ref={(mesh) => { meshRefs.current[i] = mesh }}
          renderOrder={pass.renderOrder}
          material={materials[i]}
        />
      ))}
    </group>
  )
}

export const overlapShapeInstrument: ObjectInstrumentDef = {
  id: 'overlapShape',
  name: 'Overlap Shape',
  kind: 'object',
  // Two color params, so the automatic single-color identity doesn't apply:
  // the track follows the shape's own fill.
  identityColor: { param: 'baseColor' },
  userInterfaceRenderer: 'overlapShape',
  params: PARAMS,
  midiRows: MIDI_ROWS,
  component: OverlapShapeVisual,
}
