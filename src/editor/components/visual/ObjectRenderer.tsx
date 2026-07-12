import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Matrix4, Vector3 } from 'three'
import { getInstrument } from '../../instruments'
import { getObjectState, getVisualCopy } from '../../core/visual/VisualEngine'
import { applyMaterialOpacity } from '../../core/visual/animatedOpacity'
import { applyMaterialHueShift } from '../../core/visual/animatedColor'
import type { ObjectState } from '../../core/visual/types'
import { useProjectStore } from '../../store/ProjectStore'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import { TransformWrapper } from './TransformWrapper'
import { CloneWrapper } from './CloneWrapper'
import { ShaderWrapper } from './ShaderWrapper'

/**
 * Renders ONE OCCURRENCE of one object: the placement group carries the object's
 * world transform (composed with ancestors by the engine) times this occurrence's
 * VisualCopy transform, plus the mute blackout; the object's transform effects
 * wrap the instrument component inside it, so they operate in the object's own frame.
 * The instrument component (code Cube or spec renderer) draws the mesh at local origin.
 * This component never resolves copy logic - it pulls exactly the one copy it was
 * given by index and does not know sibling occurrences exist.
 */
const _camForward = new Vector3()
const _composed = new Matrix4()

function stateHasVaryingElementOpacity(state: ObjectState): boolean {
  if (state.elementCount <= 1) return false
  const first = state.elementOpacities[0] ?? 1
  for (let i = 1; i < state.elementCount; i++) {
    if (Math.abs((state.elementOpacities[i] ?? 1) - first) > 0.0001) return true
  }
  return false
}

export function ObjectRenderer({
  trackId,
  instrumentId,
  visualCopyIndex,
}: {
  trackId: string
  instrumentId: string
  visualCopyIndex: number
}) {
  const def = getInstrument(instrumentId)
  const groupRef = useRef<Group>(null)
  const plugins = useProjectStore((s) => s.tracks[trackId]?.effects) ?? []
  // Shader instances whose 'enabled' is automated must stay MOUNTED while their
  // checkbox is off - the automation lane can switch them on mid-project. A
  // stable string of automated instance ids keeps the selector reference-clean.
  const fxEnabledAutomated = useProjectStore((s) => {
    const t = s.tracks[trackId]
    if (!t) return ''
    const ids: string[] = []
    for (const cid of t.childIds) {
      const c = s.tracks[cid]
      const target = c?.type === 'automation' ? parseFxTarget(c.targetParam) : null
      if (target?.key === 'enabled') ids.push(target.instanceId)
    }
    return ids.sort().join(',')
  })
  const shaderInstances = plugins.filter(
    (p) => (p.enabled || fxEnabledAutomated.includes(p.id)) && getEffect(p.pluginId)?.category === 'shader',
  )

  const isFullFrame = !!def?.fullFrame
  // NOTE: the per-track "In front" switch is applied a level up - VisualScene
  // mounts on-top tracks into a second, depth-cleared render pass (drei Hud).

  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    const state = getObjectState(trackId)
    // This occurrence's copy: transform composes with placement, opacity
    // multiplies, color shift adds. A missing copy (pre-first-resolve) renders
    // as identity so the single-object path never flickers.
    const visualCopy = getVisualCopy(trackId, visualCopyIndex)
    g.visible = !state?.blackedOut
    if (state && instrumentId !== 'swarm' && !stateHasVaryingElementOpacity(state)) {
      applyMaterialOpacity(g, state.opacity * (visualCopy?.opacity ?? 1))
    }
    // The Color mover's output - object-level, so it applies to every
    // instrument (ensembles included) as one tint - plus this copy's shift.
    if (state) {
      applyMaterialHueShift(
        g,
        state.hueShift + (visualCopy?.colorShift.hue ?? 0),
        state.satShift + (visualCopy?.colorShift.saturation ?? 0),
        state.lightShift + (visualCopy?.colorShift.lightness ?? 0),
      )
    }
    if (isFullFrame) {
      // A full-frame instrument is a SCREEN: pinned dead-ahead of the camera and
      // parallel to it, at the same distance r3f's `viewport` sizing assumes
      // (camera → origin), so a viewport-sized plane fills the frame exactly.
      // Without this the plane stands at the world origin and the (pitched)
      // camera views it at an angle - 2D instruments read as a tilted backdrop.
      // (The VisualCopy transform does not apply here yet - the camera-facing
      // screen anchor lands in the full-frame commit.)
      const dist = camera.position.length()
      camera.getWorldDirection(_camForward)
      g.position.copy(camera.position).addScaledVector(_camForward, dist)
      g.quaternion.copy(camera.quaternion)
    } else if (state) {
      if (visualCopy) {
        _composed.multiplyMatrices(state.world, visualCopy.transform)
        _composed.decompose(g.position, g.quaternion, g.scale)
      } else {
        state.world.decompose(g.position, g.quaternion, g.scale)
      }
    }
  })

  if (!def) return null
  const Component = def.component

  // Full-frame instruments (viewport-filling planes) skip the placement transform and the
  // transform/clone effect chain; shaders may still post-process them.
  if (isFullFrame) {
    const frame = <group ref={groupRef}><Component trackId={trackId} /></group>
    return shaderInstances.length > 0
      ? <ShaderWrapper trackId={trackId} visualCopyIndex={visualCopyIndex} plugins={shaderInstances}>{frame}</ShaderWrapper>
      : frame
  }

  const content = (
    <CloneWrapper trackId={trackId} plugins={plugins}>
      <TransformWrapper trackId={trackId} plugins={plugins}>
        <Component trackId={trackId} />
      </TransformWrapper>
    </CloneWrapper>
  )

  // Shader path: the object is rendered offscreen (with its world transform composed
  // with this occurrence's copy transform) and drawn back as a post-processed
  // full-frame overlay - so no in-scene placement group here.
  if (shaderInstances.length > 0) {
    return <ShaderWrapper trackId={trackId} visualCopyIndex={visualCopyIndex} plugins={shaderInstances}>{content}</ShaderWrapper>
  }

  return <group ref={groupRef}>{content}</group>
}
