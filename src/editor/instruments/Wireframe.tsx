import { useContext, useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { AdditiveBlending, Color, Group, Vector2 } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY, setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { getVisualCopy } from '../core/visual/VisualEngine'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { paramDefault, type ObjectInstrumentDef } from './types'
import {
  WIREFRAME_DEFAULT_SHAPE,
  WIREFRAME_SHAPES,
  wireframeDetailStep,
  wireframeGeometry,
  wireframeIsFlat,
  wireframeSegmentPositions,
  wireframeSpinAngle,
} from './wireframeCore'

const DEFAULT_COLOR = '#7dd3fc'
const WHITE = new Color(1, 1, 1)
// Solids sit under a fixed presentation tilt so a cube reads as a cube rather
// than a square; flat shapes stay face-on and turn in their own plane.
const SOLID_TILT = 0.45

export const wireframeInstrument: ObjectInstrumentDef = {
  id: 'wireframe',
  name: 'Wireframe',
  kind: 'object',
  userInterfaceRenderer: 'wireframe',
  params: [
    {
      key: 'shape', label: 'Shape', type: 'select', default: WIREFRAME_DEFAULT_SHAPE,
      options: WIREFRAME_SHAPES.map((shape, index) => ({ value: index, label: shape.name })),
    },
    { key: 'color', label: 'Color', type: 'color', default: DEFAULT_COLOR },
    { key: 'size', label: 'Size', min: 0.05, max: 8, step: 0.01, curve: 2, default: 1 },
    { key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'weight', label: 'Weight', min: 0.5, max: 6, step: 0.1, default: 1.5 },
    { key: 'detail', label: 'Detail', min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: 'spin', label: 'Spin', min: -1, max: 1, step: 0.01, default: 0.25 },
  ],
  midiRows: [
    { pitch: 76, label: 'Pulse · max', emphasized: true },
    { pitch: 68, label: 'Pulse · strong' },
    { pitch: 60, label: 'Pulse · medium' },
    { pitch: 52, label: 'Pulse · soft' },
    { pitch: 44, label: 'Pulse · gentle' },
    { pitch: 36, label: 'Pulse · faint' },
  ],
  // SIZE is the instance's own scale (a mesh property - movers and children
  // keep working in unscaled units); notes swell it via the energy pulse.
  localTransform: ({ params, energy }) => ({
    scale: (params.size ?? paramDefault(wireframeInstrument, 'size')) * (1 + energy * 0.18),
  }),
  component: Wireframe,
}

/** A shape drawn as thin lines: one crisp pass whose HDR color feeds the scene
 *  bloom, plus a wider additive underlay that thickens with GLOW. */
export function Wireframe({ trackId }: { trackId: string }) {
  const groupRef = useRef<Group>(null)
  const copyContext = useContext(InstrumentCopyContext)
  const baseColor = useRef(new Color()).current
  const size = useThree((three) => three.size)
  const dpr = useThree((three) => three.viewport.dpr)

  // Geometry and materials are imperative (invisible to r3f auto-dispose):
  // the SHAPE/DETAIL params reach only the frame callback, which swaps the
  // shared geometry's positions when their cached key moves (Cube's pattern).
  const lines = useMemo(() => {
    const resolution = new Vector2(1, 1)
    const geometry = new LineSegmentsGeometry()
    const coreMaterial = new LineMaterial({
      color: 0xffffff, linewidth: 1.5, transparent: true, resolution, worldUnits: false,
    })
    coreMaterial.toneMapped = false
    const glowMaterial = new LineMaterial({
      color: 0xffffff, linewidth: 4, transparent: true, depthWrite: false, resolution, worldUnits: false,
    })
    glowMaterial.blending = AdditiveBlending
    // Additive underlay must stay in the transparent queue even at full track
    // opacity, or the opacity wrapper flips it opaque and it turns into a
    // solid ribbon.
    glowMaterial.userData[FORCE_TRANSPARENT_KEY] = true
    const core = new LineSegments2(geometry, coreMaterial)
    const glow = new LineSegments2(geometry, glowMaterial)
    // Positions are swapped imperatively; skip stale-bounds culling entirely.
    core.frustumCulled = false
    glow.frustumCulled = false
    glow.renderOrder = -1
    return { geometry, coreMaterial, glowMaterial, core, glow, resolution }
  }, [])

  useEffect(() => {
    const group = groupRef.current
    if (group) group.add(lines.glow, lines.core)
    return () => {
      group?.remove(lines.glow, lines.core)
      lines.geometry.dispose()
      lines.coreMaterial.dispose()
      lines.glowMaterial.dispose()
    }
  }, [lines])

  useEffect(() => {
    lines.resolution.set(Math.max(1, size.width * dpr), Math.max(1, size.height * dpr))
  }, [lines, size, dpr])

  const builtKey = useRef('')

  useInstrumentFrame(trackId, (state) => {
    const group = groupRef.current
    if (!group) return false

    const shape = state.params.shape ?? paramDefault(wireframeInstrument, 'shape')
    const detail = state.params.detail ?? paramDefault(wireframeInstrument, 'detail')
    const glow = state.params.glow ?? paramDefault(wireframeInstrument, 'glow')
    const weight = state.params.weight ?? paramDefault(wireframeInstrument, 'weight')
    const spin = state.params.spin ?? paramDefault(wireframeInstrument, 'spin')

    const detailStep = wireframeDetailStep(detail)
    const key = `${Math.round(shape)}:${detailStep}`
    if (key !== builtKey.current) {
      lines.geometry.setPositions(wireframeSegmentPositions(wireframeGeometry(shape, detailStep)))
      builtKey.current = key
    }

    const flatShape = wireframeIsFlat(shape)
    const angle = wireframeSpinAngle(state.beat, spin)
    if (flatShape) group.rotation.set(0, 0, angle)
    else group.rotation.set(SOLID_TILT, angle, 0)

    // Fade computed from engine state THIS frame (see LaserLine): the HDR
    // color must die with the envelope, or the bloom halo holds full blaze
    // until the last stretch of a fade and then snaps off.
    const copyOpacity = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex)?.opacity ?? 1 : 1
    const fade = Math.max(0, Math.min(1, state.opacity * copyOpacity))
    const flare = 1 + state.energy * 1.2

    baseColor.set(state.stringParams.color || DEFAULT_COLOR)
    lines.coreMaterial.color.copy(baseColor)
      .lerp(WHITE, 0.1 + glow * 0.15)
      .multiplyScalar((1 + glow * 2.5 * flare) * fade)
    lines.coreMaterial.linewidth = weight
    // Alpha fades ride the opacity wrapper (LineMaterial honors
    // Material.opacity); only the BASE values are written here, and the HDR
    // colors above carry the fade so bloom dies with the envelope.
    setAnimatedOpacity(lines.coreMaterial, 1)

    lines.glowMaterial.color.copy(baseColor).multiplyScalar(fade)
    lines.glowMaterial.linewidth = weight * (2 + glow * 5)
    setAnimatedOpacity(lines.glowMaterial, glow * 0.28)
    lines.glow.visible = glow > 0.01
  })

  return <group ref={groupRef} />
}
