import { useEffect, useMemo } from 'react'
import { DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY, setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { gradientStops } from '../utils/oklch'
import { easeLife, ringGradientT, ringOpacity, ringsAt, RING_SIDES, RINGS_MAX, type Ring } from './expandingRingsCore'
import { expandingRingsInstrument } from './ExpandingRings'
import { paramDefault, stringParamDefault } from './types'

const GRADIENT_STEPS = 64
/** Older (larger) rings sit slightly behind newer ones so filled rings nest. */
const DEPTH_PER_LIFE = 0.05

function buildGeometry(shape: number, thickness: number): RingGeometry {
  const sides = RING_SIDES[Math.min(RING_SIDES.length - 1, Math.max(0, Math.round(shape)))]
  // Even-sided polygons start half a step round so they sit flat, not on a corner.
  const start = Math.PI / 2 + (sides % 2 === 0 && sides < 64 ? Math.PI / sides : 0)
  return new RingGeometry(1 - Math.min(1, Math.max(0.01, thickness)), 1, sides, 1, start)
}

export function ExpandingRingsVisual({ trackId }: { trackId: string }) {
  const rig = useMemo(() => {
    const group = new Group()
    group.name = 'Expanding Rings'
    const geometry = buildGeometry(0, 0.08)
    const meshes = Array.from({ length: RINGS_MAX }, () => {
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
      material.userData[FORCE_TRANSPARENT_KEY] = true
      const mesh = new Mesh(geometry, material)
      mesh.visible = false
      group.add(mesh)
      return mesh
    })
    return { group, geometry, geometryKey: '', meshes, rings: [] as Ring[], stops: [] as string[], stopsKey: '' }
  }, [])
  useEffect(() => () => {
    rig.geometry.dispose()
    rig.meshes.forEach(m => (m.material as MeshBasicMaterial).dispose())
  }, [rig])

  useInstrumentFrame(trackId, state => {
    const num = (key: string) => state.params[key] ?? paramDefault(expandingRingsInstrument, key)
    rig.group.visible = !state.blackedOut
    if (!rig.group.visible) return

    const geometryKey = `${num('shape')}|${num('thickness')}`
    if (geometryKey !== rig.geometryKey) {
      const previous = rig.geometry
      rig.geometry = buildGeometry(num('shape'), num('thickness'))
      rig.geometryKey = geometryKey
      rig.meshes.forEach(mesh => { mesh.geometry = rig.geometry })
      previous.dispose()
    }
    const colorA = state.stringParams.colorA || stringParamDefault(expandingRingsInstrument, 'colorA')
    const colorB = state.stringParams.colorB || stringParamDefault(expandingRingsInstrument, 'colorB')
    const stopsKey = `${colorA}|${colorB}`
    if (stopsKey !== rig.stopsKey) {
      rig.stops = gradientStops(colorA, colorB, GRADIENT_STEPS)
      rig.stopsKey = stopsKey
    }

    const count = Math.max(1, Math.min(RINGS_MAX, Math.round(num('rings'))))
    const rings = ringsAt(state.beat, num('period'), count, rig.rings)
    const curve = num('curve')
    const reach = num('reach')
    const fade = num('fade')
    const colorMode = num('colorMode')
    const rotation = num('rotation') * Math.PI / 180
    rig.meshes.forEach((mesh, i) => {
      const ring = i < count ? rings[i] : undefined
      const eased = ring ? easeLife(ring.life, curve) : 0
      const opacity = ring ? ringOpacity(ring.life, fade) : 0
      mesh.visible = opacity > 0.001 && eased > 0
      if (!mesh.visible || !ring) return
      const t = Math.min(1, Math.max(0, ringGradientT(colorMode, ring.spawn, eased, count)))
      const material = mesh.material as MeshBasicMaterial
      material.color.set(rig.stops[Math.round(t * (GRADIENT_STEPS - 1))])
      setAnimatedOpacity(material, opacity)
      mesh.scale.setScalar(Math.max(1e-4, eased * reach))
      mesh.position.z = -ring.life * DEPTH_PER_LIFE
      mesh.rotation.z = rotation
    })
  })
  return <primitive object={rig.group} />
}
