import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Matrix4 } from 'three'
import { getInstrument } from '../../instruments'
import { getObjectState, getVisualCopy } from '../../core/visual/VisualEngine'
import { composeScreenAnchor } from '../../core/visual/screenAnchor'
import { applyMaterialOpacity } from '../../core/visual/animatedOpacity'
import { InstrumentCopyContext } from '../../core/visual/instrumentColor'
import { useProjectStore } from '../../store/ProjectStore'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import { TransformWrapper } from './TransformWrapper'
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
const _composed = new Matrix4()

export function ObjectRenderer({
  sceneId,
  trackId,
  instrumentId,
  visualCopyIndex,
}: {
  sceneId: string
  trackId: string
  instrumentId: string
  visualCopyIndex: number
}) {
  const def = getInstrument(instrumentId)
  const groupRef = useRef<Group>(null)
  const plugins = useProjectStore((s) => s.scenes[sceneId]?.tracks[trackId]?.effects) ?? []
  // Shader instances whose 'enabled' is automated must stay MOUNTED while their
  // checkbox is off - the automation lane can switch them on mid-project. A
  // stable string of automated instance ids keeps the selector reference-clean.
  const fxEnabledAutomated = useProjectStore((s) => {
    const sceneTracks = s.scenes[sceneId]?.tracks
    const t = sceneTracks?.[trackId]
    if (!t) return ''
    const ids: string[] = []
    for (const cid of t.childIds) {
      const c = sceneTracks?.[cid]
      const target = c?.type === 'automation' ? parseFxTarget(c.targetParam) : null
      if (target?.key === 'enabled') ids.push(target.instanceId)
    }
    return ids.sort().join(',')
  })
  const shaderInstances = plugins.filter(
    (p) => (p.enabled || fxEnabledAutomated.includes(p.id)) && getEffect(p.pluginId)?.category === 'shader',
  )

  const isFullFrame = !!def?.fullFrame
  const instrumentCopyContext = useMemo(() => ({
    visualCopyIndex,
    colorParams: (def?.params ?? []).flatMap((param) => param.type === 'color'
      ? [{ key: param.key, defaultColor: param.default }]
      : []),
  }), [def, visualCopyIndex])
  // NOTE: the per-track "In front" switch is applied a level up - VisualScene
  // mounts on-top tracks into a second, depth-cleared render pass (drei Hud).

  useFrame(({ camera }) => {
    const g = groupRef.current
    if (!g) return
    const state = getObjectState(trackId)
    // This occurrence's copy: transform composes with placement and opacity
    // multiplies. Color shifts are applied earlier, to the instrument's own
    // declared color params by useInstrumentFrame.
    const visualCopy = getVisualCopy(trackId, visualCopyIndex)
    g.visible = !!state && !state.blackedOut
    if (state) applyMaterialOpacity(g, state.opacity * (visualCopy?.opacity ?? 1))
    // TEMP diagnostic (dev only): `__fadeDebug` in the console shows what the
    // placement wrapper applied per occurrence this frame, plus what the
    // materials under it actually hold AFTER the apply and whether the group
    // is attached to a live scene. Remove once visibility on lasers is
    // confirmed fixed.
    if (process.env.NODE_ENV !== 'production') {
      let materialCount = 0
      let firstMaterial: { opacity: number; transparent: boolean } | null = null
      g.traverse((o) => {
        const m = (o as unknown as { material?: { opacity: number; transparent: boolean } | { opacity: number; transparent: boolean }[] }).material
        if (!m) return
        materialCount++
        const mat = Array.isArray(m) ? m[0] : m
        firstMaterial ??= { opacity: mat.opacity, transparent: mat.transparent }
      })
      let root: { parent: unknown; type: string } = g as unknown as { parent: never; type: string }
      while (root.parent) root = root.parent as { parent: unknown; type: string }
      const w = window as unknown as { __fadeDebug?: Record<string, unknown> }
      ;(w.__fadeDebug ??= {})[`${sceneId}:${trackId}:${visualCopyIndex}`] = {
        stateOpacity: state?.opacity,
        copyOpacity: visualCopy?.opacity,
        copyMissing: !visualCopy,
        stateMissing: !state,
        blackedOut: state?.blackedOut ?? null,
        groupVisible: g.visible,
        materialCount,
        firstMaterial,
        rootType: root.type,
      }
    }
    if (isFullFrame) {
      // Camera-facing screen anchor (see core/visual/screenAnchor.ts): the
      // occurrence's VisualCopy transform applies inside screen space, so an
      // identity copy pins the viewport-filling plane exactly as before and
      // translated/scaled copies move as screen-space layers.
      composeScreenAnchor(camera.position, camera.quaternion, visualCopy?.transform, _composed)
      _composed.decompose(g.position, g.quaternion, g.scale)
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
  const instrument = (
    <InstrumentCopyContext.Provider value={instrumentCopyContext}>
      <Component trackId={trackId} />
    </InstrumentCopyContext.Provider>
  )

  // Full-frame instruments (viewport-filling planes) skip the placement transform and
  // the transform effect chain; shaders may still post-process them.
  if (isFullFrame) {
    // No visualCopyIndex on the wrapper: the screen anchor inside the offscreen
    // scene (this group's useFrame) already composes the copy transform.
    const frame = <group ref={groupRef}>{instrument}</group>
    return shaderInstances.length > 0
      ? <ShaderWrapper trackId={trackId} plugins={shaderInstances}>{frame}</ShaderWrapper>
      : frame
  }

  const content = (
    <TransformWrapper trackId={trackId} plugins={plugins}>
      {instrument}
    </TransformWrapper>
  )

  // Shader path: the object is rendered offscreen (with its world transform composed
  // with this occurrence's copy transform) and drawn back as a post-processed
  // full-frame overlay - so no in-scene placement group here.
  if (shaderInstances.length > 0) {
    return <ShaderWrapper trackId={trackId} visualCopyIndex={visualCopyIndex} plugins={shaderInstances}>{content}</ShaderWrapper>
  }

  return <group ref={groupRef}>{content}</group>
}
