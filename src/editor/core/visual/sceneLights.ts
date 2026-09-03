// The scene-light registry: how Light TRACKS become actual THREE lights in
// every render pass.
//
// A Light track mounts an ordinary object occurrence (LightVisual), so its
// position rides the whole placement chain - canonical tf* transform,
// automation lanes, movers, splitters, groups - for free. But the mounted
// anchor deliberately holds NO THREE light of its own: an object mounts into
// exactly ONE pass scene (base / front / final-invert; or a ShaderWrapper's
// offscreen scene when the track carries effects), while its light must reach
// EVERY pass that renders geometry, exactly as the old hardcoded rig was
// replicated per pass. So the anchor registers here - a world-transform source
// plus a LightDesc the instrument's frame callback keeps current - and each
// pass owns a PassLightPool that mirrors every registered anchor into its own
// scene each frame.
//
// Purity: an anchor's world transform and its desc are both pure functions of
// the beat (the transform is composed by the engine, the desc is written by
// useInstrumentFrame), so mirroring them per frame keeps paused == frozen and
// scrub == playback == export.

import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  PointLight,
  RectAreaLight,
  Scene,
  SpotLight,
  Vector3,
} from 'three'

/** The TYPE select's stored values - append-only, saved in track params. */
export const LIGHT_TYPE_POINT = 0
export const LIGHT_TYPE_SPOT = 1
export const LIGHT_TYPE_DIRECTIONAL = 2
export const LIGHT_TYPE_AMBIENT = 3
export const LIGHT_TYPE_AREA = 4

/** What one Light occurrence contributes this frame. Written in place by the
 *  instrument's frame callback; read by every pass pool. `intensity` and
 *  `flat` arrive with the track/copy fade and the note flash already applied. */
export interface LightDesc {
  /** False while the occurrence is muted or faded out - the pool goes dark. */
  on: boolean
  type: number
  color: string
  /** Ambient type only: the hemisphere's ground color. */
  groundColor: string
  intensity: number
  /** Ambient type only: a flat AmbientLight riding along with the hemisphere. */
  flat: number
  distance: number
  decay: number
  /** Spot cone half-angle, degrees. */
  angleDeg: number
  penumbra: number
  /** Area type only: the emitting rectangle, world units. */
  width: number
  height: number
  /** Spot/directional: wish to cast; the pool still gates on the scene having
   *  a shadow-casting instrument (same economy as the old rig). */
  castShadow: boolean
  /** Spot/directional: the WORLD point the light aims at. */
  aimX: number
  aimY: number
  aimZ: number
}

export function defaultLightDesc(): LightDesc {
  return {
    on: false,
    type: LIGHT_TYPE_POINT,
    color: '#ffffff',
    groundColor: '#170921',
    intensity: 3,
    flat: 0,
    distance: 20,
    decay: 2,
    angleDeg: 45,
    penumbra: 0.35,
    width: 5,
    height: 5,
    castShadow: false,
    aimX: 0,
    aimY: 0,
    aimZ: 0,
  }
}

export interface LightAnchor {
  sceneId: string
  /** `trackId:copyIndex` - one entry per occurrence, so splitter copies each
   *  carry their own light. */
  key: string
  /** The mounted anchor group; its world matrix IS the light's placement. */
  object: Object3D
  desc: LightDesc
}

const registry = new Map<string, Map<string, LightAnchor>>()

export function registerLightAnchor(anchor: LightAnchor): () => void {
  let scene = registry.get(anchor.sceneId)
  if (!scene) {
    scene = new Map()
    registry.set(anchor.sceneId, scene)
  }
  scene.set(anchor.key, anchor)
  return () => {
    const bucket = registry.get(anchor.sceneId)
    if (bucket?.get(anchor.key) === anchor) {
      bucket.delete(anchor.key)
      if (bucket.size === 0) registry.delete(anchor.sceneId)
    }
  }
}

export function sceneHasLightAnchors(sceneId: string): boolean {
  return (registry.get(sceneId)?.size ?? 0) > 0
}

/** Deterministic iteration order (mount order is resolve-dependent). */
function sortedAnchors(sceneId: string): LightAnchor[] {
  const bucket = registry.get(sceneId)
  if (!bucket) return []
  return [...bucket.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** True when any ancestor is hidden - ObjectRenderer flips the placement group
 *  invisible for muted/faded occurrences, and the light must go dark with it. */
function anchorHidden(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (o.visible === false) return true
  }
  return false
}

const _up = new Vector3()

/** One mirrored light set per anchor, owned by a PassLightPool. Only the
 *  active type's objects exist; a type switch rebuilds the slot. */
interface Slot {
  type: number
  light: PointLight | SpotLight | DirectionalLight | RectAreaLight | null
  hemi: HemisphereLight | null
  flat: AmbientLight | null
  target: Object3D | null
}

function disposeSlot(scene: Scene, slot: Slot) {
  for (const o of [slot.light, slot.hemi, slot.flat, slot.target]) {
    if (!o) continue
    scene.remove(o)
    if ('dispose' in o && typeof (o as { dispose?: () => void }).dispose === 'function') {
      ;(o as { dispose: () => void }).dispose()
    }
  }
}

function buildSlot(scene: Scene, type: number): Slot {
  const slot: Slot = { type, light: null, hemi: null, flat: null, target: null }
  switch (type) {
    case LIGHT_TYPE_SPOT: {
      const light = new SpotLight()
      // Same shadow economy the old rig's key light paid for.
      light.shadow.mapSize.set(1024, 1024)
      light.shadow.bias = -0.0004
      light.shadow.normalBias = 0.035
      slot.light = light
      slot.target = new Object3D()
      light.target = slot.target
      break
    }
    case LIGHT_TYPE_DIRECTIONAL: {
      const light = new DirectionalLight()
      // Byte-for-byte the old key light's shadow frustum.
      light.shadow.mapSize.set(1024, 1024)
      light.shadow.camera.left = -10
      light.shadow.camera.right = 10
      light.shadow.camera.top = 10
      light.shadow.camera.bottom = -10
      light.shadow.camera.near = 0.1
      light.shadow.camera.far = 30
      light.shadow.bias = -0.0004
      light.shadow.normalBias = 0.035
      slot.light = light
      slot.target = new Object3D()
      light.target = slot.target
      break
    }
    case LIGHT_TYPE_AMBIENT:
      slot.hemi = new HemisphereLight()
      slot.flat = new AmbientLight()
      break
    case LIGHT_TYPE_AREA:
      slot.light = new RectAreaLight()
      break
    default:
      slot.light = new PointLight()
  }
  for (const o of [slot.light, slot.hemi, slot.flat, slot.target]) if (o) scene.add(o)
  return slot
}

/**
 * The mirrored light set for ONE render pass scene. VisualScene owns three per
 * mounted scene (base / front / invert); each ShaderWrapper owns one for its
 * offscreen rig. `sync` is called once per frame before the pass renders.
 */
export class PassLightPool {
  private slots = new Map<string, Slot>()
  constructor(private scene: Scene) {}

  sync(sceneId: string, allowShadows: boolean) {
    const anchors = sortedAnchors(sceneId)
    const seen = new Set<string>()
    for (const anchor of anchors) {
      seen.add(anchor.key)
      const desc = anchor.desc
      let slot = this.slots.get(anchor.key)
      if (slot && slot.type !== desc.type) {
        disposeSlot(this.scene, slot)
        slot = undefined
      }
      if (!slot) {
        slot = buildSlot(this.scene, desc.type)
        this.slots.set(anchor.key, slot)
      }
      const live = desc.on && !anchorHidden(anchor.object)
      if (slot.light) slot.light.visible = live
      if (slot.hemi) slot.hemi.visible = live
      if (slot.flat) slot.flat.visible = live
      if (!live) continue

      anchor.object.updateWorldMatrix(true, false)
      switch (desc.type) {
        case LIGHT_TYPE_AMBIENT: {
          const hemi = slot.hemi!
          hemi.color.set(desc.color)
          hemi.groundColor.set(desc.groundColor)
          hemi.intensity = desc.intensity
          // A hemisphere light's direction is its normalized position: use the
          // anchor's world UP, so rotating the track tilts the sky axis and an
          // unrotated track is byte-identical to the old <hemisphereLight />.
          _up.set(0, 1, 0).transformDirection(anchor.object.matrixWorld)
          if (_up.lengthSq() < 1e-8) _up.set(0, 1, 0)
          hemi.position.copy(_up)
          slot.flat!.color.set(desc.color)
          slot.flat!.intensity = desc.flat
          break
        }
        case LIGHT_TYPE_AREA: {
          const light = slot.light as RectAreaLight
          light.color.set(desc.color)
          light.intensity = desc.intensity
          light.width = desc.width
          light.height = desc.height
          light.position.setFromMatrixPosition(anchor.object.matrixWorld)
          anchor.object.getWorldQuaternion(light.quaternion)
          break
        }
        case LIGHT_TYPE_SPOT: {
          const light = slot.light as SpotLight
          light.color.set(desc.color)
          light.intensity = desc.intensity
          light.distance = desc.distance
          light.decay = desc.decay
          light.angle = (Math.max(1, Math.min(90, desc.angleDeg)) * Math.PI) / 180
          light.penumbra = desc.penumbra
          light.position.setFromMatrixPosition(anchor.object.matrixWorld)
          slot.target!.position.set(desc.aimX, desc.aimY, desc.aimZ)
          light.castShadow = desc.castShadow && allowShadows
          break
        }
        case LIGHT_TYPE_DIRECTIONAL: {
          const light = slot.light as DirectionalLight
          light.color.set(desc.color)
          light.intensity = desc.intensity
          light.position.setFromMatrixPosition(anchor.object.matrixWorld)
          slot.target!.position.set(desc.aimX, desc.aimY, desc.aimZ)
          light.castShadow = desc.castShadow && allowShadows
          break
        }
        default: {
          const light = slot.light as PointLight
          light.color.set(desc.color)
          light.intensity = desc.intensity
          light.distance = desc.distance
          light.decay = desc.decay
          light.position.setFromMatrixPosition(anchor.object.matrixWorld)
        }
      }
    }
    // Occurrences that unmounted since last frame.
    for (const [key, slot] of this.slots) {
      if (!seen.has(key)) {
        disposeSlot(this.scene, slot)
        this.slots.delete(key)
      }
    }
  }

  dispose() {
    for (const slot of this.slots.values()) disposeSlot(this.scene, slot)
    this.slots.clear()
  }
}

// ── The Matte finish's key-light direction ──────────────────────────────────
// posterShading's lambert used a baked constant; it now follows the scene's
// first DIRECTIONAL light track. The per-scene Vector3 is handed out by
// REFERENCE (materials hold it as their uniform value), so a refresh reaches
// every poster material with no per-material bookkeeping.

/** The historical baked direction - the fallback wherever no directional
 *  light track shines (and the value panel previews keep). Never mutated. */
export const DEFAULT_POSTER_LIGHT_DIR = new Vector3(0.55, 0.8, 0.6).normalize()

const posterDirs = new Map<string, Vector3>()
const _posterPos = new Vector3()

/** The shared, live direction vector for a scene (or the frozen default when
 *  the caller has no scene - previews, panels). */
export function posterLightDir(sceneId: string | null): Vector3 {
  if (!sceneId) return DEFAULT_POSTER_LIGHT_DIR
  let vec = posterDirs.get(sceneId)
  if (!vec) {
    vec = DEFAULT_POSTER_LIGHT_DIR.clone()
    posterDirs.set(sceneId, vec)
  }
  return vec
}

/** Recompute a scene's poster direction from its first live directional light
 *  anchor. Called once per frame per scene before its passes render. */
export function refreshPosterLightDir(sceneId: string) {
  const vec = posterLightDir(sceneId)
  for (const anchor of sortedAnchors(sceneId)) {
    const desc = anchor.desc
    if (desc.type !== LIGHT_TYPE_DIRECTIONAL || !desc.on || anchorHidden(anchor.object)) continue
    anchor.object.updateWorldMatrix(true, false)
    _posterPos.setFromMatrixPosition(anchor.object.matrixWorld)
    _posterPos.x -= desc.aimX
    _posterPos.y -= desc.aimY
    _posterPos.z -= desc.aimZ
    if (_posterPos.lengthSq() > 1e-6) {
      vec.copy(_posterPos.normalize())
      return
    }
  }
  vec.copy(DEFAULT_POSTER_LIGHT_DIR)
}
