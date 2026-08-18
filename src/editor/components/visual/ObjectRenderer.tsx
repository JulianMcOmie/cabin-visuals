import { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Matrix4 } from 'three'
import { getInstrument } from '../../instruments'
import { InstrumentPending } from '../../instruments/lazyInstrument'
import { isFullFrameTrack } from '../../instruments/types'
import { getObjectState, getVisualCopy } from '../../core/visual/VisualEngine'
import { composeScreenAnchor } from '../../core/visual/screenAnchor'
import { applyMaterialOpacity } from '../../core/visual/animatedOpacity'
import { InstrumentCopyContext } from '../../core/visual/instrumentColor'
import { useProjectStore } from '../../store/ProjectStore'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { composePostMoverScale, evaluatePostMoverScale } from '../../core/visual/postMoverScale'
import { useTimeStore } from '../../store/TimeStore'
import { TransformWrapper } from './TransformWrapper'
import { ShaderWrapper } from './ShaderWrapper'
import { MaterialWrapper } from './MaterialWrapper'

/**
 * Renders ONE OCCURRENCE of one object: the placement group carries the object's
 * world transform (composed with ancestors by the engine), then the Scale effect,
 * then this occurrence's VisualCopy transform. Other transform effects wrap the
 * instrument component inside it and continue to operate in the object's own frame.
 * The instrument component (code Cube or spec renderer) draws the mesh at local origin.
 * This component never resolves copy logic - it pulls exactly the one copy it was
 * given by index and does not know sibling occurrences exist.
 */
const _composed = new Matrix4()

// Every mounted COPY of a track runs the selectors below on every store
// write - hundreds of copies × 60 writes/s during a drag. The answers depend
// only on (state, scene, track), so compute each once per published state and
// let every copy of the same track read the memo. WeakMap-keyed on the state
// object, so old states are collected as the store moves on.
const perStateCache = new WeakMap<object, Map<string, string>>()
function perStateOnce(state: object, key: string, compute: () => string): string {
  let bucket = perStateCache.get(state)
  if (!bucket) { bucket = new Map(); perStateCache.set(state, bucket) }
  const hit = bucket.get(key)
  if (hit !== undefined) return hit
  const value = compute()
  bucket.set(key, value)
  return value
}

export function ObjectRenderer({
  sceneId,
  trackId,
  instrumentId,
  visualCopyIndex,
  maskSourceIds,
}: {
  sceneId: string
  trackId: string
  instrumentId: string
  visualCopyIndex: number
  /** Crop tracks masking this object (ObjectListEntry.maskSourceIds): forces
   *  the ShaderWrapper path so the mask pass has the object's pixels isolated,
   *  even with no shader effects of its own. */
  maskSourceIds?: readonly string[]
}) {
  const def = getInstrument(instrumentId)
  const groupRef = useRef<Group>(null)
  const ownEffects = useProjectStore((s) => s.scenes[sceneId]?.tracks[trackId]?.effects)
  // Ancestor GROUP tracks broadcast their effect chains to member objects. A
  // merged array can't be identity-stable across foreign edits, so this
  // subscribes to a FINGERPRINT (settings included - knob drags must repaint)
  // and merges via getState in the memo below; no group ancestors = the empty
  // string and the own-effects array passes through untouched.
  const groupFxFingerprint = useProjectStore((s) => perStateOnce(s, `gfx|${sceneId}|${trackId}`, () => {
    const tracks = s.scenes[sceneId]?.tracks
    let out = ''
    for (let cur = tracks?.[trackId]?.parentId; cur != null; cur = tracks?.[cur]?.parentId) {
      const t = tracks?.[cur]
      if (t?.type === 'group' && t.effects?.length) out += JSON.stringify(t.effects)
    }
    return out
  }))
  const plugins = useMemo(() => {
    const own = ownEffects ?? []
    if (!groupFxFingerprint) return own
    const tracks = useProjectStore.getState().scenes[sceneId]?.tracks
    // Own chain first, then nearest group outward: a group's effects wrap
    // OUTSIDE the member's own (the group applies after its members).
    const merged = [...own]
    for (let cur = tracks?.[trackId]?.parentId; cur != null; cur = tracks?.[cur]?.parentId) {
      const t = tracks?.[cur]
      if (t?.type === 'group' && t.effects?.length) merged.push(...t.effects)
    }
    return merged
  }, [ownEffects, groupFxFingerprint, sceneId, trackId])
  // Shader instances whose 'enabled' is automated must stay MOUNTED while their
  // checkbox is off - the automation lane can switch them on mid-project. A
  // stable string of automated instance ids keeps the selector reference-clean.
  const fxEnabledAutomated = useProjectStore((s) => perStateOnce(s, `fxa|${sceneId}|${trackId}`, () => {
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
  }))
  const shaderInstances = plugins.filter(
    (p) => (p.enabled || fxEnabledAutomated.includes(p.id)) && getEffect(p.pluginId)?.category === 'shader',
  )
  const scaleInstances = plugins.filter((plugin) => plugin.pluginId === 'scale')
  // Material effects generate the target's SURFACE and deform effects move its
  // VERTICES, so both must sit innermost - closest to the meshes - and both apply
  // on the full-frame and normal paths. They share one wrapper because they share
  // one `onBeforeCompile` hook: two patchers wrapping the same material would
  // compile differently depending on which mounted first.
  // Kept mounted while an automated 'enabled' is off, same as shader instances.
  const materialInstances = plugins.filter((p) => {
    if (!p.enabled && !fxEnabledAutomated.includes(p.id)) return false
    const category = getEffect(p.pluginId)?.category
    return category === 'material' || category === 'deform'
  })

  // Full-frame can be a per-track MODE (Oscilloscope's "Fit to screen"), so the
  // params record is a real dependency here: flipping the mode swaps which of
  // the two branches at the bottom of this component renders. Only instruments
  // that declare `fullFrameParam` subscribe, so nothing else pays for it.
  const modeParams = useProjectStore((s) => def?.fullFrameParam
    ? s.scenes[sceneId]?.tracks[trackId]?.params
    : undefined)
  const isFullFrame = isFullFrameTrack(def, modeParams)
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
    const fade = state ? state.opacity * (visualCopy?.opacity ?? 1) : 0
    // Fully hidden = fully absent. An opacity-0 mesh still writes depth, so a
    // "hidden" object would otherwise carve its invisible silhouette out of
    // anything drawn behind it (the visibility-mover ghost-wall artifact).
    g.visible = !!state && !state.blackedOut && fade > 0.001
    if (state) applyMaterialOpacity(g, fade)
    if (isFullFrame) {
      // Camera-facing screen anchor (see core/visual/screenAnchor.ts): the
      // occurrence's VisualCopy transform applies inside screen space, so an
      // identity copy pins the viewport-filling plane exactly as before and
      // translated/scaled copies move as screen-space layers.
      composeScreenAnchor(camera.position, camera.quaternion, visualCopy?.transform, _composed)
      _composed.decompose(g.position, g.quaternion, g.scale)
    } else if (state) {
      const beat = getBeatOverride() ?? useTimeStore.getState().currentBeat
      const effectScale = evaluatePostMoverScale(scaleInstances, state.effectOverrides, beat)
      composePostMoverScale(state.world, visualCopy?.transform, effectScale, _composed)
      _composed.decompose(g.position, g.quaternion, g.scale)
      // The instrument's size lives OUTSIDE the world matrix (see VisualEngine):
      // it scales the mesh itself, applied inside the mover/copy layout, so
      // movers and child tracks work in unscaled placement space.
      g.scale.multiplyScalar(state.meshScale)
    }
  })

  if (!def) return null
  const Component = def.component
  // Per-object Suspense: the component is a lazy chunk (instruments/lazyInstrument.ts).
  // One instrument's fetch must never blank the others, and the wrappers around
  // this only traverse per frame, so a late-arriving mesh is picked up as it lands.
  const bare = (
    <InstrumentCopyContext.Provider value={instrumentCopyContext}>
      <Suspense fallback={<InstrumentPending />}>
        <Component trackId={trackId} />
      </Suspense>
    </InstrumentCopyContext.Provider>
  )
  const instrument = materialInstances.length > 0
    ? <MaterialWrapper trackId={trackId} plugins={materialInstances}>{bare}</MaterialWrapper>
    : bare

  // A routed crop mask needs the object's pixels isolated, which is exactly
  // what the shader path provides - so masked objects take it even with no
  // shader effects of their own.
  const needsShaderPath = shaderInstances.length > 0 || (maskSourceIds?.length ?? 0) > 0

  // Full-frame instruments (viewport-filling planes) skip the placement transform and
  // the transform effect chain; shaders may still post-process them.
  if (isFullFrame) {
    // No visualCopyIndex on the wrapper: the screen anchor inside the offscreen
    // scene (this group's useFrame) already composes the copy transform.
    const frame = <group ref={groupRef}>{instrument}</group>
    return needsShaderPath
      ? <ShaderWrapper trackId={trackId} plugins={shaderInstances} postMoverScalePlugins={[]} maskSourceIds={maskSourceIds}>{frame}</ShaderWrapper>
      : frame
  }

  const content = (
    <TransformWrapper trackId={trackId} plugins={plugins}>
      {instrument}
    </TransformWrapper>
  )

  // Shader path: the object is rendered offscreen with the same world × Scale ×
  // copy order and drawn back as a post-processed full-frame overlay, so there
  // is no in-scene placement group here.
  if (needsShaderPath) {
    return (
      <ShaderWrapper
        trackId={trackId}
        visualCopyIndex={visualCopyIndex}
        plugins={shaderInstances}
        postMoverScalePlugins={scaleInstances}
        maskSourceIds={maskSourceIds}
      >
        {content}
      </ShaderWrapper>
    )
  }

  return <group ref={groupRef}>{content}</group>
}
