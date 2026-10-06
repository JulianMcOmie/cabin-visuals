import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY, setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { gradientStops } from '../utils/oklch'
import { ringInnerRadius, easeLife, ringGradientT, ringOpacity, ringsFromNotes, RING_SIDES, RINGS_MAX, type Ring } from './expandingRingsCore'
import { expandingRingsInstrument } from './ExpandingRings'
import { paramDefault, stringParamDefault } from './types'

const GRADIENT_STEPS = 64
/** Older (larger) rings sit slightly behind newer ones so filled rings nest. */
const DEPTH_PER_LIFE = 0.05

/** A unit polygon band: outer verts on the unit polygon, inner verts the same
 *  directions scaled by a ratio rewritten per frame (setInnerRatio), so every
 *  ring can have its own width. Interleaved [outer_k, inner_k]. */
function buildGeometry(shape: number): BufferGeometry {
  const sides = RING_SIDES[Math.min(RING_SIDES.length - 1, Math.max(0, Math.round(shape)))]
  // Even-sided polygons start half a step round so they sit flat, not on a corner.
  const start = Math.PI / 2 + (sides % 2 === 0 && sides < 64 ? Math.PI / sides : 0)
  const positions = new Float32Array((sides + 1) * 2 * 3)
  const index: number[] = []
  for (let k = 0; k <= sides; k++) {
    const angle = start + (k / sides) * Math.PI * 2
    positions[k * 6] = Math.cos(angle)
    positions[k * 6 + 1] = Math.sin(angle)
    if (k < sides) {
      const o = k * 2
      index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(index)
  setInnerRatio(geometry, 0)
  return geometry
}

function setInnerRatio(geometry: BufferGeometry, ratio: number) {
  const attr = geometry.getAttribute('position') as BufferAttribute
  const a = attr.array as Float32Array
  for (let k = 0; k < a.length / 6; k++) {
    a[k * 6 + 3] = a[k * 6] * ratio
    a[k * 6 + 4] = a[k * 6 + 1] * ratio
  }
  attr.needsUpdate = true
}

export function ExpandingRingsVisual({ trackId }: { trackId: string }) {
  const rig = useMemo(() => {
    const group = new Group()
    group.name = 'Expanding Rings'
    const meshes = Array.from({ length: RINGS_MAX }, () => {
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
      material.userData[FORCE_TRANSPARENT_KEY] = true
      const mesh = new Mesh(buildGeometry(0), material)
      mesh.visible = false
      group.add(mesh)
      return mesh
    })
    return { group, shape: 0, meshes, radii: [] as number[], rings: [] as Ring[], stops: [] as string[], stopsKey: '' }
  }, [])
  useEffect(() => () => {
    rig.meshes.forEach(m => { m.geometry.dispose(); (m.material as MeshBasicMaterial).dispose() })
  }, [rig])

  useInstrumentFrame(trackId, state => {
    const num = (key: string) => state.params[key] ?? paramDefault(expandingRingsInstrument, key)
    rig.group.visible = !state.blackedOut
    if (!rig.group.visible) return

    const shape = num('shape')
    if (shape !== rig.shape) {
      rig.shape = shape
      rig.meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.geometry = buildGeometry(shape) })
    }
    const colorA = state.stringParams.colorA || stringParamDefault(expandingRingsInstrument, 'colorA')
    const colorB = state.stringParams.colorB || stringParamDefault(expandingRingsInstrument, 'colorB')
    const stopsKey = `${colorA}|${colorB}`
    if (stopsKey !== rig.stopsKey) {
      rig.stops = gradientStops(colorA, colorB, GRADIENT_STEPS)
      rig.stopsKey = stopsKey
    }

    const count = Math.max(1, Math.min(RINGS_MAX, Math.round(num('rings'))))
    const rings = ringsFromNotes(state.notes, state.beat, num('period'), count, num('release') >= 0.5, rig.rings)
    const curve = num('curve')
    const reach = num('reach')
    const fade = num('fade')
    const colorMode = num('colorMode')
    const rotation = num('rotation') * Math.PI / 180
    const widthMode = num('widthMode')
    const width = num('thickness') * reach
    // Radii first: Fill needs each ring's next-newer neighbour.
    rig.radii.length = rings.length
    for (let i = 0; i < rings.length; i++) rig.radii[i] = easeLife(rings[i].life, curve) * reach
    rig.meshes.forEach((mesh, i) => {
      const ring = i < rings.length ? rings[i] : undefined
      const eased = ring ? easeLife(ring.life, curve) : 0
      const opacity = ring ? ringOpacity(ring.life, fade) : 0
      mesh.visible = opacity > 0.001 && eased > 0
      if (!mesh.visible || !ring) return
      const t = Math.min(1, Math.max(0, ringGradientT(colorMode, ring.spawn, eased, count)))
      const material = mesh.material as MeshBasicMaterial
      material.color.set(rig.stops[Math.round(t * (GRADIENT_STEPS - 1))])
      setAnimatedOpacity(material, opacity)
      const outer = Math.max(1e-4, eased * reach)
      const inner = ringInnerRadius(widthMode, outer, i > 0 ? rig.radii[i - 1] : 0, width, eased)
      setInnerRatio(mesh.geometry, inner / outer)
      mesh.scale.setScalar(outer)
      mesh.position.z = -ring.life * DEPTH_PER_LIFE
      mesh.rotation.z = rotation
    })
  })
  return <primitive object={rig.group} />
}
