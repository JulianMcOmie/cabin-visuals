// The registry behind Shift-hover in the visualizer: every mounted object
// occurrence registers its ROOT group (the placement group ObjectRenderer /
// InstancedObjectRenderer own, or a ShaderWrapper's offscreen holder) tagged
// with its scene and track. Objects live in offscreen portaled scenes rendered
// to targets, so r3f's own pointer events never see them - the picker raycasts
// these roots by hand instead (CanvasHoverPicker), and the highlight pass in
// VisualScene re-renders exactly these roots into its mask.

import { Object3D, Raycaster, Scene } from 'three'
import type { Track } from '../../types'
import { resolveTrackDisplayColor } from '../../utils/trackDisplayColor'
import { bestHit, type HitPass, type RankedHit } from './hoverPickCore'

export interface HoverTarget {
  sceneId: string
  trackId: string
  object: Object3D
  /** A viewport-filling plane - lowest pick priority (hoverPickCore). */
  fullFrame: boolean
}

const targets = new Set<HoverTarget>()

export function registerHoverTarget(target: HoverTarget): () => void {
  targets.add(target)
  return () => { targets.delete(target) }
}

export function hoverTargetsForTrack(trackId: string): HoverTarget[] {
  const out: HoverTarget[] = []
  for (const t of targets) if (t.trackId === trackId) out.push(t)
  return out
}

function ancestorHidden(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o.visible === false) return true
  return false
}

/** The Scene an object ultimately hangs from (a pass scene, or a ShaderWrapper
 *  rig scene). */
export function rootSceneOf(object: Object3D): Scene | null {
  let o: Object3D | null = object
  while (o && !(o as Scene).isScene) o = o.parent
  return (o as Scene | null) ?? null
}

/**
 * Raycast the registered roots of one scene with an already-aimed raycaster
 * and return the track the pointer means (hoverPickCore's ranking), or null.
 * `passOf` says which render pass a root's scene is (front/invert beat base);
 * roots in scenes it does not know (ShaderWrapper rigs) count as base.
 */
export function pickHoverTarget(
  raycaster: Raycaster,
  sceneId: string,
  passOf: (scene: Scene | null) => HitPass | undefined,
): RankedHit | null {
  const hits: RankedHit[] = []
  for (const target of targets) {
    if (target.sceneId !== sceneId || ancestorHidden(target.object)) continue
    const intersections = raycaster.intersectObject(target.object, true)
    let nearest = Infinity
    for (const hit of intersections) {
      if (ancestorHidden(hit.object)) continue
      if (hit.distance < nearest) nearest = hit.distance
    }
    if (nearest === Infinity) continue
    hits.push({
      trackId: target.trackId,
      distance: nearest,
      pass: passOf(rootSceneOf(target.object)) ?? 'base',
      fullFrame: target.fullFrame,
    })
  }
  return bestHit(hits)
}

// ── The glow colour ─────────────────────────────────────────────────────────
// resolveTrackDisplayColor is pure in the track, so cache by track reference:
// the highlight pass asks every frame and a store write mints a new ref.
const colorCache = new WeakMap<Track, string>()
export function hoverGlowColor(track: Track): string {
  let hex = colorCache.get(track)
  if (!hex) {
    hex = resolveTrackDisplayColor(track)
    colorCache.set(track, hex)
  }
  return hex
}
