import {
  Color, DataTexture, Group, Material, Mesh, MeshPhysicalMaterial, MeshToonMaterial,
  NearestFilter, RedFormat, type Texture,
} from 'three'
import { BASE_OPACITY_KEY, FORCE_TRANSPARENT_KEY } from '../../core/visual/animatedOpacity'
import type { VisualEffect } from '../types'
import { FINISH, FINISH_OPTIONS, resolveFinish, toonSteps, type OriginalLook } from './texturizerCore'

// Texturizer: re-materials whatever the instrument drew. Each frame it walks the
// wrapped group, swaps every convertible mesh material for a cached
// MeshPhysicalMaterial (or MeshToonMaterial for the Toon finish) derived from the
// original, and drives its lighting response from the finish knobs. The original
// material is never mutated and is restored when the effect is disabled/removed,
// so the instrument's own look is always one toggle away.
//
// Liveness: instruments animate their ORIGINAL materials (colour flashes,
// setAnimatedOpacity), usually via a ref captured before our swap. A per-frame
// dirty-check mirrors those channels (colour / opacity base / map) onto the
// active material, while instruments that resolve `mesh.material` fresh each
// frame simply write to ours - both paths stay live.

/** Source materials we know how to re-light. Shader/points/line/sprite
 *  materials keep their own look (a laser is already its own material). */
function isConvertible(m: Material): boolean {
  const t = m as Material & Record<string, boolean | undefined>
  return !!(t.isMeshBasicMaterial || t.isMeshStandardMaterial || t.isMeshPhysicalMaterial
    || t.isMeshLambertMaterial || t.isMeshPhongMaterial || t.isMeshToonMaterial)
}

interface MaterialSwap {
  original: Material
  phys: MeshPhysicalMaterial
  toon: MeshToonMaterial | null
  look: OriginalLook
  // Last-seen values of the original's live channels (dirty-check mirror).
  lastColor: number
  lastOpacityBase: number
  lastMap: Texture | null
  // USE_* define fingerprint; a change needs a program recompile (needsUpdate).
  lastDefineKey: string
  // What WE last wrote to emissiveIntensity - distinguishes our value from a
  // fresh instrument write (note flashes), which must survive the finish.
  lastAppliedEmissive: number | null
}

interface MeshSwap {
  originals: Material[]
  wasArray: boolean
  swaps: MaterialSwap[]
}

const meshSwaps = new WeakMap<Mesh, MeshSwap>()
const WHITE = new Color(0xffffff)

// Toon gradient maps, one per band count (2-5), built once and shared.
const gradientCache = new Map<number, DataTexture>()
function getGradientMap(steps: number): DataTexture {
  let tex = gradientCache.get(steps)
  if (!tex) {
    const data = new Uint8Array(steps)
    for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255)
    tex = new DataTexture(data, steps, 1, RedFormat)
    tex.minFilter = NearestFilter
    tex.magFilter = NearestFilter
    tex.needsUpdate = true
    gradientCache.set(steps, tex)
  }
  return tex
}

type LooseMaterial = Material & {
  isMeshBasicMaterial?: boolean
  fog?: boolean
  color?: Color
  map?: Texture | null
  metalness?: number
  roughness?: number
  envMapIntensity?: number
  emissive?: Color
  emissiveIntensity?: number
  normalMap?: Texture | null
  alphaMap?: Texture | null
}

/** Shared appearance channels copied both at swap time and by the live mirror. */
function copyCommon(from: LooseMaterial, to: MeshPhysicalMaterial | MeshToonMaterial): void {
  if (from.color) to.color.copy(from.color)
  if ('map' in from) { to.map = from.map ?? null }
  to.transparent = from.transparent
  to.opacity = from.opacity
  to.side = from.side
  to.blending = from.blending
  to.depthWrite = from.depthWrite
  to.depthTest = from.depthTest
  to.alphaTest = from.alphaTest
  to.toneMapped = from.toneMapped
  to.vertexColors = from.vertexColors
  to.fog = from.fog ?? true
  if (from.alphaMap) to.alphaMap = from.alphaMap
  // The mover-opacity pass composes onto these keys; carry them over so a fade
  // in flight doesn't snap when the swap happens.
  if (typeof from.userData[BASE_OPACITY_KEY] === 'number') {
    to.userData[BASE_OPACITY_KEY] = from.userData[BASE_OPACITY_KEY]
  }
  if (from.userData[FORCE_TRANSPARENT_KEY]) to.userData[FORCE_TRANSPARENT_KEY] = true
}

function buildSwap(original: Material): MaterialSwap {
  const o = original as LooseMaterial
  const unlit = !!o.isMeshBasicMaterial
  const phys = new MeshPhysicalMaterial()
  copyCommon(o, phys)
  phys.wireframe = (o as { wireframe?: boolean }).wireframe ?? false
  if (o.normalMap) phys.normalMap = o.normalMap
  const look: OriginalLook = {
    unlit,
    metalness: o.metalness ?? 0,
    roughness: o.roughness ?? 1,
    envMapIntensity: unlit ? 0 : o.envMapIntensity ?? 1,
  }
  return {
    original, phys, toon: null, look,
    lastColor: o.color ? o.color.getHex() : -1,
    lastOpacityBase: (o.userData[BASE_OPACITY_KEY] as number | undefined) ?? o.opacity,
    lastMap: o.map ?? null,
    lastDefineKey: '',
    lastAppliedEmissive: null,
  }
}

/** Mirror the original's live channels onto the active material(s) - but only
 *  when the ORIGINAL changed, so instruments that write to `mesh.material`
 *  directly (and therefore to ours) are never overwritten with stale values. */
function syncLive(swap: MaterialSwap): void {
  const o = swap.original as LooseMaterial
  if (o.color) {
    const hex = o.color.getHex()
    if (hex !== swap.lastColor) {
      swap.lastColor = hex
      swap.phys.color.setHex(hex)
      swap.toon?.color.setHex(hex)
    }
  }
  const base = (o.userData[BASE_OPACITY_KEY] as number | undefined) ?? o.opacity
  if (base !== swap.lastOpacityBase) {
    swap.lastOpacityBase = base
    swap.phys.userData[BASE_OPACITY_KEY] = base
    if (swap.toon) swap.toon.userData[BASE_OPACITY_KEY] = base
  }
  const map = o.map ?? null
  if (map !== swap.lastMap) {
    swap.lastMap = map
    swap.phys.map = map
    swap.phys.needsUpdate = true
    if (swap.toon) { swap.toon.map = map; swap.toon.needsUpdate = true }
  }
}

function applyTexturizer(root: Group, settings: Record<string, number>): void {
  const finish = settings.finish ?? 0
  const amount = settings.amount ?? 1
  const rough = settings.rough ?? 0.25
  const glow = settings.glow ?? 0
  // Fully backed off = fully out of the way: hand the original materials back.
  if (amount < 0.005) { restoreTexturizer(root); return }

  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return
    let rec = meshSwaps.get(mesh)
    if (rec) {
      // The instrument replaced its own material since we swapped (some swap
      // materials as a mode change). Drop ours and rebuild from the new one.
      const current = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const known = rec.swaps.some((s) => s.phys === current || s.toon === current || s.original === current)
      if (!known) { disposeSwaps(mesh, rec); rec = undefined }
    }
    if (!rec) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (mats.length === 0 || !mats.every((m) => m && isConvertible(m))) return
      rec = {
        originals: mats,
        wasArray: Array.isArray(mesh.material),
        swaps: mats.map(buildSwap),
      }
      meshSwaps.set(mesh, rec)
    }

    const actives: Material[] = []
    for (const swap of rec.swaps) {
      syncLive(swap)
      const target = resolveFinish(finish, amount, rough, glow, swap.look)
      const isToon = finish === FINISH.toon
      if (isToon && !swap.toon) {
        const toon = new MeshToonMaterial()
        copyCommon(swap.original as LooseMaterial, toon)
        toon.color.setHex(swap.lastColor === -1 ? 0xffffff : swap.lastColor)
        swap.toon = toon
      }
      const phys = swap.phys
      phys.metalness = target.metalness
      phys.roughness = target.roughness
      phys.envMapIntensity = target.envMapIntensity
      phys.specularIntensity = target.specularIntensity
      phys.sheen = target.sheen
      phys.sheenRoughness = target.sheenRoughness
      if (target.sheen > 0) phys.sheenColor.copy(phys.color).lerp(WHITE, 0.5)
      phys.transmission = target.transmission
      phys.thickness = target.thickness
      phys.ior = target.ior
      phys.emissive.copy(phys.color)
      phys.emissiveMap = phys.map
      // The finish is the emissive FLOOR. Instruments animate emissiveIntensity
      // for note flashes (Cube, spec instruments) by writing mesh.material -
      // i.e. this material - each frame; a value we didn't write means the
      // instrument spoke since our last pass, and its flash rides on top.
      phys.emissiveIntensity = phys.emissiveIntensity !== swap.lastAppliedEmissive
        ? Math.max(phys.emissiveIntensity, target.emissiveIntensity)
        : target.emissiveIntensity
      swap.lastAppliedEmissive = phys.emissiveIntensity
      // Sheen/transmission/emissiveMap flip USE_* defines; three only rebuilds
      // the program when told, so fingerprint the define-driving state.
      const defineKey = `${target.sheen > 0}|${target.transmission > 0}|${!!phys.map}|${target.emissiveIntensity > 0}`
      if (defineKey !== swap.lastDefineKey) {
        swap.lastDefineKey = defineKey
        phys.needsUpdate = true
      }
      if (isToon && swap.toon) {
        const grad = getGradientMap(toonSteps(rough))
        if (swap.toon.gradientMap !== grad) { swap.toon.gradientMap = grad; swap.toon.needsUpdate = true }
        actives.push(swap.toon)
      } else {
        actives.push(phys)
      }
    }
    const nextMaterial = rec.wasArray ? actives : actives[0]
    if (mesh.material !== nextMaterial) {
      // Array identity differs every frame; only reassign when membership changed.
      const currentMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const same = currentMats.length === actives.length && currentMats.every((m, i) => m === actives[i])
      if (!same) mesh.material = nextMaterial
    }
  })
}

function disposeSwaps(mesh: Mesh, rec: MeshSwap): void {
  for (const swap of rec.swaps) {
    swap.phys.dispose()
    swap.toon?.dispose()
  }
  meshSwaps.delete(mesh)
}

/** Hand every swapped mesh its original material back and drop (dispose) ours.
 *  Idempotent and cheap once restored - it runs every frame while disabled. */
export function restoreTexturizer(root: Group): void {
  root.traverse((obj) => {
    const mesh = obj as Mesh
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return
    const rec = meshSwaps.get(mesh)
    if (!rec) return
    mesh.material = rec.wasArray ? rec.originals : rec.originals[0]
    disposeSwaps(mesh, rec)
  })
}

export const texturizerPlugin: VisualEffect = {
  id: 'texturizer',
  name: 'Texturizer',
  category: 'material',
  params: [
    { key: 'finish', label: 'Finish', type: 'select', options: [...FINISH_OPTIONS], default: 0 },
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'rough', label: 'Roughness', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'glow', label: 'Glow', min: 0, max: 3, step: 0.05, default: 0 },
  ],
  applyMaterial: applyTexturizer,
  restoreMaterial: restoreTexturizer,
}
