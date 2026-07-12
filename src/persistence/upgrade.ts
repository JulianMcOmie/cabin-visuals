import type { ProjectDocument } from './types'
import { emptyDocument } from './types'
import type { Scene, Track, AudioBlock, EffectInstance, VideoPad } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'

/** Bump when the document shape changes, and append the matching step below. */
export const CURRENT_VERSION = 5

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
    [mainId]: { id: mainId, name: 'Main', isMain: true, tracks: {}, rootTrackIds: [] },
    [firstSceneId]: { id: firstSceneId, name: 'Scene 1', isMain: false, tracks: visualTracks, rootTrackIds },
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
