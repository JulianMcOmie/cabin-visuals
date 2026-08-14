import { useEffect, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Group, Mesh, Material, type IUniform } from 'three'
import { useTimeStore } from '../../store/TimeStore'
import { getBeatOverride } from '../../core/visual/beatOverride'
import { getObjectState } from '../../core/visual/VisualEngine'
import { getEffect } from '../../effects'
import { effectiveEffectState } from '../../effects/automation'
import { instanceSuffix, uniformName } from '../../effects/uniforms'
import { subdivideAttributes, type SubdivisionAttribute } from '../../effects/deform/subdivideCore'
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

export { uniformName } from '../../effects/uniforms'

const PATCHED = Symbol('kaleidoMaterialPatched')
const TESSELLATED = Symbol('deformTessellated')

type Patchable = Material & {
  [PATCHED]?: {
    /** Fingerprint of everything injected into this material: the surface
     *  instance plus every stacked deformer. A material is re-patched when the
     *  fingerprint moves, so adding a second deformer recompiles and removing
     *  one puts the shorter chain back. */
    signature: string
    previous: Material['onBeforeCompile'] | undefined
  }
}

type Tessellatable = Mesh & {
  [TESSELLATED]?: {
    /** The instrument's own geometry, handed back untouched on restore. */
    original: BufferGeometry
    /** The clone we made, so it can be disposed rather than leaked. */
    generated: BufferGeometry
    detail: number
  }
}

/** Attributes worth carrying through subdivision. `position` and `normal` are
 *  load-bearing; `uv` keeps a Texturizer or Kaleido Skin sitting on the same
 *  object from smearing. Anything else (tangents, colors, instrument-private
 *  attributes) is dropped deliberately - interpolating an attribute we do not
 *  understand is worse than not having it. */
const SUBDIVIDED_ATTRIBUTES = ['position', 'normal', 'uv'] as const

/**
 * A subdivided copy of `source`, or null when there is nothing to do.
 *
 * Non-indexed first: subdivision splits edges per TRIANGLE, and a shared index
 * buffer would have neighbouring faces disagree about where their common edge's
 * midpoint went.
 */
function tessellate(source: BufferGeometry, detail: number): BufferGeometry | null {
  if (detail <= 0) return null
  const flat = source.index ? source.toNonIndexed() : source
  const present = SUBDIVIDED_ATTRIBUTES.filter((name) => flat.getAttribute(name))
  if (!present.includes('position')) return null

  const inputs: SubdivisionAttribute[] = present.map((name) => {
    const attribute = flat.getAttribute(name)
    return { array: new Float32Array(attribute.array), itemSize: attribute.itemSize }
  })
  const outputs = subdivideAttributes(inputs, detail)
  if (outputs === inputs) {
    if (flat !== source) flat.dispose()
    return null
  }

  const geometry = new BufferGeometry()
  present.forEach((name, i) => {
    geometry.setAttribute(name, new BufferAttribute(outputs[i].array, outputs[i].itemSize))
  })
  // The deformer moves vertices arbitrarily, so the source geometry's bounding
  // volumes are wrong for it no matter what we compute here. A generous sphere
  // keeps a deformed object from being frustum-culled the moment its centre
  // leaves the frame while its bent limb is still on screen.
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  if (geometry.boundingSphere) geometry.boundingSphere.radius *= 2
  if (flat !== source) flat.dispose()
  return geometry
}

function restoreGeometry(mesh: Tessellatable) {
  const record = mesh[TESSELLATED]
  if (!record) return
  mesh.geometry = record.original
  record.generated.dispose()
  delete mesh[TESSELLATED]
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
  // Meshes whose geometry we swapped for a subdivided clone, same contract.
  const tessellatedRef = useRef<Set<Tessellatable>>(new Set())

  for (const inst of plugins) {
    if (uniformsRef.current.has(inst.id)) continue
    const plugin = getEffect(inst.pluginId)
    // Deformers stack within one program, so their uniforms are namespaced per
    // instance; a surface field is the only one of its kind in the shader and
    // keeps the bare names its GLSL was written against.
    const suffix = plugin?.vertexField ? instanceSuffix(inst.id) : ''
    // uKTwist is always supplied: the shared field GLSL declares it (the
    // KaleidoSolid instrument drives it from its notes), and an effect that has no
    // such param still needs the uniform to exist rather than reading as undefined.
    const uniforms: Record<string, IUniform> = { uKBeat: { value: 0 }, uKTwist: { value: 0 } }
    for (const pd of plugin?.params ?? []) {
      uniforms[uniformName(pd.key, suffix)] = { value: inst.settings[pd.key] ?? (pd.type === undefined || pd.type === 'number' ? pd.default : 0) }
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
    // Geometry swaps are restored the same way, and the clones disposed - a
    // leaked BufferGeometry holds GPU buffers for the life of the context.
    for (const mesh of tessellatedRef.current) restoreGeometry(mesh)
    tessellatedRef.current.clear()
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
    // Deformers are the opposite case: twist THEN bend is a real composition, so
    // every enabled one is kept and they are applied in chain order.
    const deformers: { glsl: string; suffix: string; uniforms: Record<string, IUniform> }[] = []
    let detail = 0
    for (const inst of plugins) {
      const plugin = getEffect(inst.pluginId)
      if (!plugin) continue
      const isDeform = !!plugin.vertexField
      if (!plugin.materialField && !isDeform) continue
      const eff = effectiveEffectState(inst, state?.effectOverrides)
      if (!eff.enabled) continue
      const uniforms = uniformsRef.current.get(inst.id)
      if (!uniforms) continue
      const suffix = isDeform ? instanceSuffix(inst.id) : ''
      uniforms.uKBeat.value = beat
      for (const pd of plugin.params) {
        const u = uniforms[uniformName(pd.key, suffix)]
        if (u) u.value = eff.settings[pd.key] ?? u.value
      }
      if (plugin.vertexField) {
        deformers.push({ glsl: plugin.vertexField(suffix), suffix, uniforms })
        // Stacked deformers share ONE tessellation, at the highest level any of
        // them asks for: subdividing twice would square the triangle count for
        // no extra fidelity, since they all deform the same vertices.
        const asked = plugin.subdivideParam ? eff.settings[plugin.subdivideParam] : 0
        if (typeof asked === 'number') detail = Math.max(detail, Math.round(asked))
      } else if (plugin.materialField) {
        active = { inst, glsl: plugin.materialField, uniforms }
      }
    }

    // One string describing everything that must end up in the program. The
    // material is re-patched when this moves, which covers adding, removing,
    // reordering and disabling any of it.
    const signature = active || deformers.length > 0
      ? `${active?.inst.id ?? '-'}|${deformers.map((d) => d.suffix).join(',')}`
      : ''

    // Deformers move vertices, so they need vertices to move: a boxGeometry has
    // eight. The swap happens here rather than in the plugin because only the
    // wrapper knows the mesh set, and it must be undone exactly like the
    // material patch (see subdivideCore.ts for the whole argument).
    group.traverse((node) => {
      if (!(node instanceof Mesh)) return
      const mesh = node as Tessellatable
      const wanted = deformers.length > 0 ? detail : 0
      const current = mesh[TESSELLATED]
      if (current?.detail === wanted) return
      // Always restore first: the original is what the next level subdivides
      // from, so re-subdividing our own clone would compound the count.
      restoreGeometry(mesh)
      tessellatedRef.current.delete(mesh)
      if (wanted <= 0) return
      const original = mesh.geometry
      const generated = tessellate(original, wanted)
      if (!generated) return
      mesh.geometry = generated
      mesh[TESSELLATED] = { original, generated, detail: wanted }
      tessellatedRef.current.add(mesh)
    })

    group.traverse((node) => {
      if (!(node instanceof Mesh)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      for (const material of materials as Patchable[]) {
        if (!material) continue
        if (!signature) {
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
        if (material[PATCHED]?.signature === signature) continue

        const previous = material[PATCHED]?.previous ?? material.onBeforeCompile
        const surface = active
        const chain = deformers.slice()
        material.onBeforeCompile = (shader, renderer) => {
          previous?.(shader, renderer)
          if (surface) Object.assign(shader.uniforms, surface.uniforms)
          for (const deform of chain) Object.assign(shader.uniforms, deform.uniforms)

          if (chain.length > 0) {
            // uKBeat is declared ONCE for the whole vertex stage - every chunk
            // reads it and GLSL rejects a redeclaration.
            const declarations = `#include <common>\nuniform float uKBeat;\n${chain.map((d) => d.glsl).join('\n')}`
            // Applied in chain order, each on the previous one's output, so
            // twist-then-bend bends the twisted shape rather than the original.
            // The normal is re-derived from the LAST deformer against the
            // position it was handed, which is right for the common one-entry
            // case and a good approximation for a stack.
            const body = chain
              .map((d, i) => i === chain.length - 1
                ? `  vec3 fxPrev${i} = fxPos;\n  fxPos = fxApply${d.suffix}(fxPos, fxNrm);\n  fxNrm = fxDeformNormal${d.suffix}(fxPrev${i}, fxNrm, fxPos);`
                : `  fxPos = fxApply${d.suffix}(fxPos, fxNrm);`)
              .join('\n')
            // UNLIT materials (MeshBasicMaterial and friends) have no
            // `beginnormal_vertex` chunk at all, and a `.replace` that finds
            // nothing silently does nothing - which would leave `transformed =
            // fxPos` referencing an undeclared variable and fail the whole
            // program to compile. So the normal path is taken only when the
            // chunk is actually there, and an unlit mesh gets a position-only
            // deform (it has no shading to get wrong).
            const lit = shader.vertexShader.includes('#include <beginnormal_vertex>')
            shader.vertexShader = shader.vertexShader.replace('#include <common>', declarations)
            if (lit) {
              shader.vertexShader = shader.vertexShader
                // beginnormal_vertex seeds `objectNormal` from `normal`; overwrite
                // it here, BEFORE the morph/skin includes and the world transform,
                // so the rest of the pipeline lights the deformed surface.
                .replace(
                  '#include <beginnormal_vertex>',
                  `#include <beginnormal_vertex>\n  vec3 fxPos = position;\n  vec3 fxNrm = objectNormal;\n${body}\n  objectNormal = fxNrm;`,
                )
                // begin_vertex seeds `transformed` from `position` - the last point
                // at which the vertex is still in the mesh's own space.
                .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = fxPos;')
            } else {
              // The radial direction stands in for the surface normal so Inflate
              // still means something on an unlit mesh; every other operation
              // ignores the argument.
              shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>\n  vec3 fxPos = position;\n  vec3 fxNrm = normalize(position + vec3(1e-6));\n${body}\n  transformed = fxPos;`,
              )
            }
          }

          if (surface) {
            shader.vertexShader = shader.vertexShader
              .replace('#include <common>', '#include <common>\nvarying vec3 vFxObjPos;')
              // The surface field reads the UNDEFORMED position on purpose: the
              // pattern is painted on the mesh's own material space, so it
              // travels with the surface as it bends instead of sliding over it.
              .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFxObjPos = position;')
            shader.fragmentShader = shader.fragmentShader
              .replace('#include <common>', `#include <common>\nvarying vec3 vFxObjPos;\n${surface.glsl}`)
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
        }
        material[PATCHED] = { signature, previous }
        material.needsUpdate = true
        patchedRef.current.add(material)
      }
    })
  })

  return <group ref={groupRef}>{children}</group>
}
