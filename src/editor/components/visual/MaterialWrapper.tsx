import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group, Mesh, Material, type IUniform } from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { getObjectState } from '../../core/visual/VisualEngine'
import { getEffect } from '../../effects'
import { effectiveEffectState } from '../../effects/automation'
import type { EffectInstance } from '../../types'

/**
 * Per-object MATERIAL effect chain: generates the target's SURFACE rather than
 * post-processing its output.
 *
 * Why this exists at all: a `shader` effect is a screen-space FBO pass, so its
 * pattern is anchored to the frame and slides across a moving object. Injecting
 * into the mesh's own material instead means the pattern is evaluated in object
 * space and therefore travels and turns WITH the mesh - the difference between a
 * window onto a kaleidoscope and a kaleidoscope painted on the thing.
 *
 * Deliberate choices:
 * - **Patch in place, then restore.** Cloning each material would look safer but
 *   breaks every instrument that mutates its own material per frame (Cube sets
 *   `mat.color`/`emissiveIntensity` on the ORIGINAL each frame); a clone would go
 *   stale instantly. So we set `onBeforeCompile` on the live material and put the
 *   previous one back on unmount. Instruments build their materials per-instance
 *   in JSX, so this does not leak across tracks.
 * - **Re-scan every frame, cheaply.** Instruments mount and swap meshes freely
 *   (geometry switches, bursts spawning fragments), so there is no single mount
 *   moment at which the mesh set is final. The traversal is a handful of nodes and
 *   only touches materials it has not already patched.
 * - Only three's built-in materials can be injected (the replace targets
 *   `#include <common>` and `vec4 diffuseColor = ...`). Instruments that draw with
 *   a raw ShaderMaterial simply do not match and are left alone - no crash, no
 *   effect. That limit is inherent to onBeforeCompile, not a bug here.
 */

/** Uniform name for a param key: `facets` → `uKFacets`. Shared with the plugin's GLSL. */
export function uniformName(key: string): string {
  return `uK${key.charAt(0).toUpperCase()}${key.slice(1)}`
}

const PATCHED = Symbol('kaleidoMaterialPatched')

type Patchable = Material & {
  [PATCHED]?: {
    instanceId: string
    previous: Material['onBeforeCompile'] | undefined
  }
}

export function MaterialWrapper({
  trackId,
  plugins,
  children,
}: {
  trackId: string
  plugins: EffectInstance[]
  children: ReactNode
}) {
  const groupRef = useRef<Group>(null)
  // One uniform set per effect INSTANCE, shared by every material it patches, so
  // a single write per frame updates the whole subtree.
  const uniformsRef = useRef<Map<string, Record<string, IUniform>>>(new Map())
  // Materials we have patched, so unmount can put them back exactly as found.
  const patchedRef = useRef<Set<Patchable>>(new Set())

  for (const inst of plugins) {
    if (uniformsRef.current.has(inst.id)) continue
    const plugin = getEffect(inst.pluginId)
    // uKTwist is always supplied: the shared field GLSL declares it (the
    // KaleidoSolid instrument drives it from its notes), and an effect that has no
    // such param still needs the uniform to exist rather than reading as undefined.
    const uniforms: Record<string, IUniform> = { uKBeat: { value: 0 }, uKTwist: { value: 0 } }
    for (const pd of plugin?.params ?? []) {
      uniforms[uniformName(pd.key)] = { value: inst.settings[pd.key] ?? (pd.type === undefined || pd.type === 'number' ? pd.default : 0) }
    }
    uniformsRef.current.set(inst.id, uniforms)
  }

  useEffect(() => () => {
    // Restore on unmount: hand every material back its original compile hook and
    // force a recompile, or the object keeps the pattern after the effect is gone.
    for (const material of patchedRef.current) {
      const record = material[PATCHED]
      if (!record) continue
      material.onBeforeCompile = record.previous ?? (() => {})
      delete material[PATCHED]
      material.needsUpdate = true
    }
    patchedRef.current.clear()
  }, [])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const state = getObjectState(trackId)
    const beat = getBeatOverride() ?? useTimeStore.getState().currentBeat

    // The LAST enabled material effect owns the surface. Stacking two generated
    // surfaces has no meaningful composition - one simply overwrites albedo - so
    // rather than pretend, the chain's final word wins (matching how a VisualCopy
    // `tint` replaces rather than accumulates).
    let active: { inst: EffectInstance; glsl: string; uniforms: Record<string, IUniform> } | null = null
    for (const inst of plugins) {
      const plugin = getEffect(inst.pluginId)
      const glsl = plugin?.materialField
      if (!glsl) continue
      const eff = effectiveEffectState(inst, state?.effectOverrides)
      if (!eff.enabled) continue
      const uniforms = uniformsRef.current.get(inst.id)
      if (!uniforms) continue
      uniforms.uKBeat.value = beat
      for (const pd of plugin?.params ?? []) {
        const u = uniforms[uniformName(pd.key)]
        if (u) u.value = eff.settings[pd.key] ?? u.value
      }
      active = { inst, glsl, uniforms }
    }

    group.traverse((node) => {
      if (!(node instanceof Mesh)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of materials as Patchable[]) {
        if (!material) continue
        if (!active) {
          // Effect turned off (or automated off) while mounted: undo the patch so
          // the object returns to its own appearance immediately.
          const record = material[PATCHED]
          if (record) {
            material.onBeforeCompile = record.previous ?? (() => {})
            delete material[PATCHED]
            material.needsUpdate = true
            patchedRef.current.delete(material)
          }
          continue
        }
        if (material[PATCHED]?.instanceId === active.inst.id) continue

        const previous = material[PATCHED]?.previous ?? material.onBeforeCompile
        const glsl = active.glsl
        const uniforms = active.uniforms
        material.onBeforeCompile = (shader, renderer) => {
          previous?.(shader, renderer)
          Object.assign(shader.uniforms, uniforms)
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vFxObjPos;')
            // begin_vertex seeds `transformed` from `position` - the last point at
            // which the vertex is still in the mesh's own space.
            .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFxObjPos = position;')
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nvarying vec3 vFxObjPos;\n${glsl}`)
            .replace(
              'vec4 diffuseColor = vec4( diffuse, opacity );',
              // Albedo is a REFLECTANCE: the field peaks near 1.0, and a near-white
              // albedo under a lit scene saturates the lit side to a pale wash.
              'vec3 fxSurf = kaleidoField(vFxObjPos);\n  vec4 diffuseColor = vec4( fxSurf * 0.5, opacity );',
            )
            // `emissive` already carries emissiveIntensity, so tinting it makes any
            // glow the instrument has follow the pattern instead of washing it out.
            .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * fxSurf;')
        }
        material[PATCHED] = { instanceId: active.inst.id, previous }
        material.needsUpdate = true
        patchedRef.current.add(material)
      }
    })
  })

  return <group ref={groupRef}>{children}</group>
}
