import { useEffect, useMemo } from 'react'
import { Group, LessEqualDepth, Mesh, type MeshBasicMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { radialSweepFraction } from '../core/visualCopies/library'
import { geometryFor, materialFor } from './OverlapShapeVisual'
import { OVERLAP_SHAPE_PASSES, overlapShapeDepthColors, overlapShapeIndex, overlapShapePassActive } from './overlapShapeCore'
import { BLOOM_MAX_COPIES, resolveBloom } from './radialBloomCore'
import { radialBloomInstrument } from './RadialBloom'
import { paramDefault, stringParamDefault } from './types'

export function RadialBloomVisual({ trackId }: { trackId: string }) {
  const rig = useMemo(() => {
    const group = new Group()
    group.name = 'Radial Bloom'
    const geometry = geometryFor(0)
    const materials = OVERLAP_SHAPE_PASSES.map(pass => {
      const material = materialFor(pass)
      // Rotated coplanar copies interpolate depth with slightly different
      // rounding. Reserve a tiny depth margin in the prepass so the shared
      // stencil recipe stays solid even when viewed obliquely.
      if (pass.depth === 'prepass') {
        material.polygonOffset = true
        material.polygonOffsetFactor = 1
        material.polygonOffsetUnits = 1
      } else if (pass.depth === 'equal') material.depthFunc = LessEqualDepth
      return material
    })
    const passes = OVERLAP_SHAPE_PASSES.map((pass, p) => Array.from({ length: BLOOM_MAX_COPIES }, () => {
      const mesh = new Mesh(geometry, materials[p])
      mesh.renderOrder = pass.renderOrder
      mesh.visible = false
      group.add(mesh)
      return mesh
    }))
    return { group, geometry, shape: 0, materials, passes }
  }, [])
  useEffect(() => () => {
    rig.geometry.dispose()
    rig.materials.forEach(m => m.dispose())
  }, [rig])

  useInstrumentFrame(trackId, state => {
    const num = (key: string) => state.params[key] ?? paramDefault(radialBloomInstrument, key)
    const bloom = resolveBloom(state.notes, state.beat, {
      attackBeats: num('attackBeats'), decayBeats: num('decayBeats'),
      sustainLevel: num('sustainLevel'), releaseBeats: num('releaseBeats'),
    })
    rig.group.visible = bloom.opacity > 0.001 && !state.blackedOut
    if (!rig.group.visible) return
    const colors = overlapShapeDepthColors(num('overlapOrders'), num('overlapColorMode') === 0,
      key => state.stringParams[key] || stringParamDefault(radialBloomInstrument, key))
    const shape = overlapShapeIndex(num('shape'))
    if (shape !== rig.shape) {
      const previous = rig.geometry
      rig.geometry = geometryFor(shape)
      rig.shape = shape
      // Swap every pass together, including inactive slots. Retire the old
      // GPU bindings rather than retaining geometry across shape switches.
      rig.passes.forEach(meshes => meshes.forEach(mesh => { mesh.geometry = rig.geometry }))
      previous.dispose()
    }
    const size = Math.max(0.001, num('size')) * (1 + num('pulse') * bloom.opacity)
    const rotation = num('rotation') * Math.PI / 180
    const radius = bloom.copies === 1 ? 0 : num('radius')
    OVERLAP_SHAPE_PASSES.forEach((pass, p) => {
      const active = overlapShapePassActive(pass, { overlapOn: num('overlapMode') >= 0.5, orders: num('overlapOrders') })
      const material = rig.materials[p]
      // All stencil passes stay in the same render list throughout the ADSR.
      setAnimatedOpacity(material, bloom.opacity)
      material.transparent = bloom.opacity < 0.999
      if (pass.writesColor) (material as MeshBasicMaterial).color.set(colors[Math.min(pass.order ?? 1, colors.length) - 1])
      rig.passes[p].forEach((mesh, i) => {
        mesh.visible = active && i < bloom.copies
        if (!mesh.visible) return
        const angle = rotation + radialSweepFraction(i, bloom.copies, 360) * Math.PI * 2
        mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)
        mesh.rotation.set(0, 0, angle)
        mesh.scale.setScalar(size)
      })
    })
  })
  return <primitive object={rig.group} />
}
