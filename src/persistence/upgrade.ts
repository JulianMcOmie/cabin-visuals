import type { ProjectDocument } from './types'
import { emptyDocument } from './types'
import { DEFAULT_SCENE_BACKGROUND, type Scene, type Track, type AudioBlock, type EffectInstance, type VideoPad } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'

/** Bump when the document shape changes, and append the matching step below. */
export const CURRENT_VERSION = 12

type UpgradeStep = (doc: Record<string, unknown>) => Record<string, unknown>

// vN → vN+1, keyed by N. Append-only: a shipped step is never edited, so any
// old blob can walk the chain to the current shape. Each step is pure - it
// returns a new object and never mutates its input.
const UPGRADES: Record<number, UpgradeStep> = {}

// ── v1 → v2 ──────────────────────────────────────────────────────────────────
// Three shape changes that shipped together with the audio-track feature:
//  1. audioClip (single global descriptor) → audioClips (catalog keyed by ref)
//  2. a v1 clip was hard-pinned to beat 0 - reproduce that exactly by
//     synthesizing an audio track (top of the root tracks) holding one block
//     at bar 0 trimmed to the full clip, so old saves keep sounding identical
//  3. track.visualPlugins → track.effects (the plugins/ → effects/ rename)
UPGRADES[1] = (doc) => {
  const { audioClip, ...rest } = doc as {
    audioClip?: AudioClip | null
    tracks?: Record<string, Track & { visualPlugins?: EffectInstance[] }>
    rootTrackIds?: string[]
  } & Record<string, unknown>

  // 3 · visualPlugins → effects on every track.
  let tracks: Record<string, Track> = {}
  for (const [id, t] of Object.entries(rest.tracks ?? {})) {
    const { visualPlugins, ...track } = t
    tracks[id] = visualPlugins ? ({ ...track, effects: visualPlugins } as Track) : (track as Track)
  }

  // 1 + 2 · the clip enters the catalog and becomes a bar-0 block.
  const audioClips: Record<string, AudioClip> = audioClip ? { [audioClip.ref]: audioClip } : {}
  let rootTrackIds = rest.rootTrackIds ?? []
  if (audioClip) {
    const trackId = crypto.randomUUID()
    const block: AudioBlock = {
      id: crypto.randomUUID(),
      clipRef: audioClip.ref,
      startBar: 0,
      trimStart: 0,
      trimEnd: audioClip.duration,
    }
    const audioTrack: Track = {
      id: trackId,
      name: audioClip.fileName,
      type: 'audio',
      instrumentId: '',
      color: '#38bdf8',
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
      audioBlocks: [block],
    }
    tracks = { ...tracks, [trackId]: audioTrack }
    rootTrackIds = [trackId, ...rootTrackIds]
  }

  return { ...rest, tracks, rootTrackIds, audioClips }
}

// ── v2 → v3 ──────────────────────────────────────────────────────────────────
// The dimension → mover rename: track type 'dimension' becomes 'mover' and
// dimensionId becomes moverId. Everything else on those tracks (inputValues,
// depth, envelope, midiMode, weight, opMode) is unchanged.
UPGRADES[2] = (doc) => {
  const rest = doc as { tracks?: Record<string, Track & { dimensionId?: string }> } & Record<string, unknown>
  const tracks: Record<string, Track> = {}
  for (const [id, t] of Object.entries(rest.tracks ?? {})) {
    if ((t.type as string) === 'dimension') {
      const { dimensionId, ...track } = t
      tracks[id] = { ...track, type: 'mover', moverId: dimensionId } as Track
    } else {
      tracks[id] = t as Track
    }
  }
  return { ...rest, tracks }
}

// ── v3 → v4 ──────────────────────────────────────────────────────────────────
// The Video instrument's pad model: each track's `videoRefs: string[]` (whole
// uploaded files as clips) became `videoPads: VideoPad[]` — (source ref,
// in-point) pairs. Old clips were whole-source, so each ref maps to a pad at
// in-point 0 and keeps playing identically. The videoClips source catalog is
// unchanged.
UPGRADES[3] = (doc) => {
  const rest = doc as { tracks?: Record<string, Track & { videoRefs?: string[] }> } & Record<string, unknown>
  const tracks: Record<string, Track> = {}
  for (const [id, t] of Object.entries(rest.tracks ?? {})) {
    const { videoRefs, ...track } = t
    if (videoRefs && videoRefs.length > 0) {
      const videoPads: VideoPad[] = videoRefs.map((ref) => ({ ref, inPoint: 0 }))
      tracks[id] = { ...track, videoPads } as Track
    } else {
      tracks[id] = track as Track
    }
  }
  return { ...rest, tracks }
}

// ── v4 → v5 ──────────────────────────────────────────────────────────────────
// The single global visual track forest becomes Scene 1. Main is an empty scene
// of the same shape, ready for director tracks. Audio remains project-global and
// is projected into every scene's editor view; it never participates in visual
// scene ownership or director switching.
UPGRADES[4] = (doc) => {
  const rest = doc as {
    tracks?: Record<string, Track>
    rootTrackIds?: string[]
  } & Record<string, unknown>
  const tracks = rest.tracks ?? {}
  const roots = rest.rootTrackIds ?? []
  const audioTracks: Record<string, Track> = {}
  const visualTracks: Record<string, Track> = {}
  for (const [id, track] of Object.entries(tracks)) {
    if (track.type === 'audio') audioTracks[id] = track
    else visualTracks[id] = track
  }
  const audioRootTrackIds = roots.filter((id) => audioTracks[id])
  const rootTrackIds = roots.filter((id) => visualTracks[id])
  const mainId = crypto.randomUUID()
  const firstSceneId = crypto.randomUUID()
  const scenes: Record<string, Scene> = {
    [mainId]: { id: mainId, name: 'Main', isMain: true, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
    [firstSceneId]: { id: firstSceneId, name: 'Scene 1', isMain: false, backgroundColor: DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false, tracks: visualTracks, rootTrackIds },
  }
  const project = { ...rest }
  delete project.tracks
  delete project.rootTrackIds
  return {
    ...project,
    scenes,
    sceneOrder: [mainId, firstSceneId],
    activeSceneId: firstSceneId,
    audioTracks,
    audioRootTrackIds,
  }
}

// ── v5 → v6 ──────────────────────────────────────────────────────────────────
// Scene backgrounds become an explicit scene-level parameter. Old scenes adopt
// the new black default rather than depending on a renderer-owned clear color.
UPGRADES[5] = (doc) => {
  const rest = doc as { scenes?: Record<string, Omit<Scene, 'backgroundColor'> & { backgroundColor?: string }> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(rest.scenes ?? {})) {
    scenes[id] = { ...scene, backgroundColor: scene.backgroundColor ?? DEFAULT_SCENE_BACKGROUND, backgroundTransparent: false }
  }
  return { ...rest, scenes }
}

// ── v6 → v7 ──────────────────────────────────────────────────────────────────
// Event modifiers were retired. Remove their tracks while promoting any nested
// children to the nearest surviving parent, so unrelated user tracks are kept.
UPGRADES[6] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const modifierTypes = new Set(['add', 'mute', 'suppress', 'override'])
  const scenes: Record<string, Scene> = {}

  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const removed = new Set(Object.values(scene.tracks)
      .filter((track) => modifierTypes.has(track.type as string))
      .map((track) => track.id))
    const promote = (trackId: string, seen = new Set<string>()): string[] => {
      if (seen.has(trackId)) return []
      if (!removed.has(trackId)) return [trackId]
      seen.add(trackId)
      return (scene.tracks[trackId]?.childIds ?? []).flatMap((childId) => promote(childId, seen))
    }

    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      if (removed.has(trackId)) continue
      let parentId = track.parentId
      while (parentId && removed.has(parentId)) parentId = scene.tracks[parentId]?.parentId
      const { parentId: _oldParentId, ...trackWithoutParent } = track
      void _oldParentId
      tracks[trackId] = {
        ...trackWithoutParent,
        ...(parentId ? { parentId } : {}),
        childIds: track.childIds.flatMap((childId) => promote(childId)),
      }
    }
    scenes[sceneId] = {
      ...scene,
      tracks,
      rootTrackIds: scene.rootTrackIds.flatMap((trackId) => promote(trackId)),
    }
  }

  return { ...rest, scenes }
}

// ── v7 → v8 ──────────────────────────────────────────────────────────────────
// Scene render targets may now preserve a transparent background. Existing
// projects stay visually identical by remaining opaque.
UPGRADES[7] = (doc) => {
  const rest = doc as { scenes?: Record<string, Omit<Scene, 'backgroundTransparent'> & { backgroundTransparent?: boolean }> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(rest.scenes ?? {})) {
    scenes[id] = { ...scene, backgroundTransparent: scene.backgroundTransparent ?? false }
  }
  return { ...rest, scenes }
}

// ── v8 → v9 ──────────────────────────────────────────────────────────────────
// Cube/Circle/Triangle used to expose Base Color as a numeric 0–360 hue. Store
// the equivalent concrete color so the editor can use a native color picker.
UPGRADES[8] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const shapeIds = new Set(['cube', 'circle', 'triangle'])
  const hueToHex = (hue: number) => {
    const h = ((hue % 360) + 360) % 360
    const saturation = 0.65
    const lightness = 0.6
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1))
    const m = lightness - chroma / 2
    let r = 0, g = 0, b = 0
    if (h < 60) { r = chroma; g = x } else if (h < 120) { r = x; g = chroma }
    else if (h < 180) { g = chroma; b = x } else if (h < 240) { g = x; b = chroma }
    else if (h < 300) { r = x; b = chroma } else { r = chroma; b = x }
    const hex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      if (!shapeIds.has(track.instrumentId) || track.stringParams?.baseColor) {
        tracks[trackId] = track
        continue
      }
      const { baseHue, ...params } = track.params ?? {}
      tracks[trackId] = {
        ...track,
        params,
        stringParams: {
          ...track.stringParams,
          baseColor: hueToHex(baseHue ?? 240),
        },
      }
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v9 → v10 ─────────────────────────────────────────────────────────────────
// World-space instruments' transform params move to the canonical track
// transform keys (src/editor/core/transform.ts): position → tfX/tfY/tfZ and
// size → tfSize (a multiplier of the instrument's natural size, so world sizes
// divide by the 1.6 reference). Automation/envelope children retarget with
// their parent. See docs/track-transform-panel.md.
const TRANSFORM_KEY_MIGRATIONS: Record<string, Record<string, { to: string; scale?: number }>> = {
  cube: {
    baseXPosition: { to: 'tfX' },
    baseYPosition: { to: 'tfY' },
    baseZPosition: { to: 'tfZ' },
    baseSize: { to: 'tfSize', scale: 1 / 1.6 },
  },
  circle: {
    baseXPosition: { to: 'tfX' },
    baseYPosition: { to: 'tfY' },
    baseZPosition: { to: 'tfZ' },
    baseSize: { to: 'tfSize', scale: 1 / 1.6 },
  },
  triangle: {
    baseXPosition: { to: 'tfX' },
    baseYPosition: { to: 'tfY' },
    baseZPosition: { to: 'tfZ' },
    baseSize: { to: 'tfSize', scale: 1 / 1.6 },
  },
  // laserSphere keeps its own `size` param (the bespoke panel's SIZE knob binds
  // to it - see LaserSphereUserInterface), so only its position migrates.
  laserSphere: { x: { to: 'tfX' }, y: { to: 'tfY' }, z: { to: 'tfZ' } },
  laserLine: { x: { to: 'tfX' }, y: { to: 'tfY' }, z: { to: 'tfZ' } },
  particleSphere: { x: { to: 'tfX' }, y: { to: 'tfY' }, z: { to: 'tfZ' }, size: { to: 'tfSize', scale: 1 / 1.6 } },
}

/** Rename one track's params through an instrument's migration map. Exported for
 *  the template builder, which constructs tracks without passing through the
 *  document upgrade chain. */
export function migrateTransformParams(
  instrumentId: string,
  params: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const map = TRANSFORM_KEY_MIGRATIONS[instrumentId]
  if (!map || !params) return params
  let changed = false
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(params)) {
    const m = map[key]
    if (m) {
      out[m.to] = m.scale !== undefined ? value * m.scale : value
      changed = true
    } else {
      out[key] = value
    }
  }
  return changed ? out : params
}

UPGRADES[9] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      let next = track
      const params = migrateTransformParams(track.instrumentId, track.params)
      if (params !== track.params) next = { ...next, params }
      // Automation/envelope children target the parent's params by key.
      if ((track.type === 'automation' || track.type === 'envelope') && track.targetParam && track.parentId) {
        const parent = scene.tracks[track.parentId]
        const m = parent ? TRANSFORM_KEY_MIGRATIONS[parent.instrumentId]?.[track.targetParam] : undefined
        if (m) next = { ...next, targetParam: m.to }
      }
      tracks[trackId] = next
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v10 → v11 ────────────────────────────────────────────────────────────────
// The Oscilloscope stopped being a fixed full-frame instrument and became a real
// object in the scene (a positioned, depth-sorted, billboarding panel), with the
// old viewport-pinned overlay kept as its "Fit to screen" placement mode. New
// scopes default to In scene; every scope that already exists was authored
// against the pinned look, so it is pinned explicitly here. `fitToScreen` also
// decides the on-top pass (isOnTopTrack), so this one param restores the whole
// of the previous behaviour - nothing already made changes.
UPGRADES[10] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      tracks[trackId] = track.instrumentId === 'oscilloscope'
        ? { ...track, params: { ...track.params, fitToScreen: 1 } }
        : track
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v11 → v12 ────────────────────────────────────────────────────────────────
// Directors de-specialized: a director is now an ordinary base track whose
// instrumentId names a composition instrument (core/directors). The former
// directorId moves into instrumentId; sceneBindings, params, blocks and child
// automation lanes carry over untouched (their targetParam keys - opacity +
// the def's params - are unchanged). Directors only ever lived in scenes
// (never audioTracks), and a directorId-less director track can only be the
// pre-first-UI Scene Switcher, so that is the fallback id.
UPGRADES[11] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      if ((track.type as string) !== 'director') {
        tracks[trackId] = track
        continue
      }
      const { directorId, ...kept } = track as Track & { directorId?: string }
      tracks[trackId] = { ...kept, type: 'base', instrumentId: directorId ?? 'sceneSwitcher' }
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

/**
 * Bring a raw blob (any past version) up to the current document shape.
 * The rest of the app only ever sees CURRENT_VERSION documents.
 */
export function upgradeDocument(raw: unknown): ProjectDocument {
  // Not a document at all (null, pre-versioned, corrupt) → start fresh rather
  // than crash the editor on open.
  if (raw === null || typeof raw !== 'object') return emptyDocument()
  let doc = raw as Record<string, unknown>
  if (typeof doc.schemaVersion !== 'number') return emptyDocument()

  while ((doc.schemaVersion as number) < CURRENT_VERSION) {
    const step = UPGRADES[doc.schemaVersion as number]
    if (!step) throw new Error(`No upgrade step from document version ${doc.schemaVersion}`)
    doc = { ...step(doc), schemaVersion: (doc.schemaVersion as number) + 1 }
  }
  return doc as unknown as ProjectDocument
}
