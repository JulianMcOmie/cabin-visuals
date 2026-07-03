import type { ProjectDocument } from './types'
import { emptyDocument } from './types'
import type { Track, AudioBlock, EffectInstance } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'

/** Bump when the document shape changes, and append the matching step below. */
export const CURRENT_VERSION = 2

type UpgradeStep = (doc: Record<string, unknown>) => Record<string, unknown>

// vN → vN+1, keyed by N. Append-only: a shipped step is never edited, so any
// old blob can walk the chain to the current shape. Each step is pure — it
// returns a new object and never mutates its input.
const UPGRADES: Record<number, UpgradeStep> = {}

// ── v1 → v2 ──────────────────────────────────────────────────────────────────
// Three shape changes that shipped together with the audio-track feature:
//  1. audioClip (single global descriptor) → audioClips (catalog keyed by ref)
//  2. a v1 clip was hard-pinned to beat 0 — reproduce that exactly by
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
