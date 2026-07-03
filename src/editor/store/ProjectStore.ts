import { create } from 'zustand'
import { getEffect } from '../effects'
import type { Track, TrackType, Block, Note, AudioBlock, EffectInstance, InterpolationMode } from '../types'

export const MIN_BPM = 20
export const MAX_BPM = 300

// Deep-clone with fresh IDs at every level (used by paste + alt-drag duplicate).
const cloneNote = (n: Note): Note => ({ ...n, id: crypto.randomUUID() })
export const cloneBlock = (b: Block): Block => ({
  ...b,
  id: crypto.randomUUID(),
  notes: b.notes.map(cloneNote),
})
export const cloneTrack = (t: Track): Track => ({
  ...t,
  id: crypto.randomUUID(),
  blocks: t.blocks.map(cloneBlock),
  childIds: [],
})

interface ProjectState {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  // Project-level musical settings. Here (not TimeStore) so they're part of the
  // undoable document; currentBeat/isPlaying stay in TimeStore (ephemeral transport).
  bpm: number
  beatsPerBar: number
  totalBars: number
  addTrack: (track: Track, atIndex?: number) => void
  addBlock: (trackId: string, block: Block) => void
  addBlocks: (trackId: string, blocks: Block[]) => void
  addNote: (trackId: string, blockId: string, note: Note) => void
  updateBlockNotes: (trackId: string, blockId: string, notes: Note[]) => void
  updateBlock: (trackId: string, blockId: string, updates: Partial<Block>) => void
  moveBlock: (fromTrackId: string, blockId: string, toTrackId: string) => void
  deleteBlock: (trackId: string, blockId: string) => void
  deleteBlocks: (blockIds: Set<string>) => void
  deleteTrack: (trackId: string) => void
  /** Returns the new copy's id (for selection), or null if the source vanished. */
  insertTrackCopy: (srcId: string, index: number) => string | null
  reorderRootTracks: (orderedIds: string[]) => void
  /** Re-parent a track: parentId=null makes it a root. `index` positions it among
   *  its new siblings (root list or the parent's childIds). No-op on a cycle. */
  setTrackParent: (trackId: string, parentId: string | null, index?: number) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
  setTrackStringParam: (trackId: string, key: string, value: string) => void
  setTrackInstrument: (trackId: string, instrumentId: string, name?: string) => void
  /** Convert a track into an event modifier of the given type (no instrument). */
  setTrackModifier: (trackId: string, type: TrackType, name: string) => void
  /** Add an `automation` child track under `parentId`, driving the given param over
   *  time. No-op if one already automates that param. */
  addAutomationTrack: (parentId: string, paramKey: string, paramLabel: string) => void
  /** Add an `ability` child track under `parentId` for one of the parent instrument's
   *  abilities (opt-in). No-op if that ability already has a track. */
  addAbilityTrack: (parentId: string, abilityKey: string, abilityLabel: string) => void
  /** Set an automation track's interpolation mode between keyframes. */
  setTrackInterpolation: (trackId: string, mode: InterpolationMode) => void
  setTrackTargets: (trackId: string, targets: Track['targets']) => void
  setTrackTags: (trackId: string, tags: string[]) => void
  /** Create the audio track (top of the root tracks) holding one block at bar 0
   *  spanning the whole clip. The AudioBar's load path; one audio track for now.
   *  Returns the new track's id (for selection). */
  addAudioTrack: (clip: { ref: string; fileName: string; duration: number }) => string
  addAudioBlock: (trackId: string, block: AudioBlock) => void
  updateAudioBlock: (trackId: string, blockId: string, updates: Partial<AudioBlock>) => void
  deleteAudioBlock: (trackId: string, blockId: string) => void
  // Visual effects (plugins) on a track.
  addEffect: (trackId: string, pluginId: string) => void
  removeEffect: (trackId: string, instanceId: string) => void
  setEffectSetting: (trackId: string, instanceId: string, key: string, value: number) => void
  toggleEffect: (trackId: string, instanceId: string) => void
  setBpm: (bpm: number) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  tracks: {},
  rootTrackIds: [],
  bpm: 120,
  beatsPerBar: 4,
  totalBars: 32,

  addTrack: (track, atIndex) =>
    set((s) => {
      const tracks = { ...s.tracks, [track.id]: track }
      // Nested under a parent: insert into the parent's childIds at atIndex.
      if (track.parentId) {
        const parent = tracks[track.parentId]
        if (parent) {
          const childIds = [...parent.childIds]
          const i = atIndex == null || atIndex < 0 || atIndex > childIds.length ? childIds.length : atIndex
          childIds.splice(i, 0, track.id)
          tracks[track.parentId] = { ...parent, childIds }
        }
        return { tracks }
      }
      const rootTrackIds = [...s.rootTrackIds]
      // Never above the pinned audio track at root index 0.
      const min = track.type !== 'audio' && s.tracks[rootTrackIds[0]]?.type === 'audio' ? 1 : 0
      if (atIndex == null || atIndex < 0 || atIndex > rootTrackIds.length) rootTrackIds.push(track.id)
      else rootTrackIds.splice(Math.max(min, atIndex), 0, track.id)
      return { tracks, rootTrackIds }
    }),

  addBlock: (trackId, block) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: [...track.blocks, block] },
        },
      }
    }),

  addBlocks: (trackId, blocks) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || blocks.length === 0) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: [...track.blocks, ...blocks] },
        },
      }
    }),

  addNote: (trackId, blockId, note) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.map((b) =>
            b.id === blockId ? { ...b, notes: [...b.notes, note] } : b
          ) },
        },
      }
    }),

  updateBlockNotes: (trackId, blockId, notes) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.map((b) =>
            b.id === blockId ? { ...b, notes } : b
          ) },
        },
      }
    }),

  updateBlock: (trackId, blockId, updates) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.map((b) =>
            b.id === blockId ? { ...b, ...updates } : b
          ) },
        },
      }
    }),

  moveBlock: (fromTrackId, blockId, toTrackId) =>
    set((s) => {
      if (fromTrackId === toTrackId) return s
      const fromTrack = s.tracks[fromTrackId]
      const toTrack = s.tracks[toTrackId]
      if (!fromTrack || !toTrack) return s
      const block = fromTrack.blocks.find((b) => b.id === blockId)
      if (!block) return s
      return {
        tracks: {
          ...s.tracks,
          [fromTrackId]: {
            ...fromTrack,
            blocks: fromTrack.blocks.filter((b) => b.id !== blockId),
          },
          [toTrackId]: {
            ...toTrack,
            blocks: [...toTrack.blocks, block],
          },
        },
      }
    }),

  deleteBlock: (trackId, blockId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, blocks: track.blocks.filter((b) => b.id !== blockId) },
        },
      }
    }),

  deleteBlocks: (blockIds) =>
    set((s) => {
      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        const blocks = t.blocks.filter((b) => !blockIds.has(b.id))
        let next = blocks.length !== t.blocks.length ? { ...t, blocks } : t
        // Audio blocks share the selection model, so a selected one deletes too.
        if (t.audioBlocks?.some((b) => blockIds.has(b.id))) {
          next = { ...next, audioBlocks: t.audioBlocks.filter((b) => !blockIds.has(b.id)) }
        }
        tracks[id] = next
      }
      return { tracks }
    }),

  deleteTrack: (trackId) =>
    set((s) => {
      const target = s.tracks[trackId]
      if (!target) return s
      // The deleted node's children take its place — promoted to its parent (or root).
      const promoted = target.childIds ?? []
      const parentId = target.parentId

      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        if (id === trackId) continue
        let nt = t
        if (promoted.includes(id)) nt = { ...nt, parentId }
        if (id === parentId) {
          const idx = nt.childIds.indexOf(trackId)
          const childIds = nt.childIds.filter((c) => c !== trackId)
          childIds.splice(idx < 0 ? childIds.length : idx, 0, ...promoted)
          nt = { ...nt, childIds }
        }
        // Drop any track-scoped routings that pointed at the deleted track.
        if (nt.targets?.some((r) => r.scope.kind === 'track' && r.scope.id === trackId)) {
          nt = { ...nt, targets: nt.targets.filter((r) => !(r.scope.kind === 'track' && r.scope.id === trackId)) }
        }
        tracks[id] = nt
      }

      // If the deleted track was a root, its promoted children take its slot.
      let rootTrackIds = s.rootTrackIds
      if (parentId == null) {
        const idx = rootTrackIds.indexOf(trackId)
        rootTrackIds = rootTrackIds.filter((id) => id !== trackId)
        if (promoted.length) rootTrackIds.splice(idx < 0 ? rootTrackIds.length : idx, 0, ...promoted)
      }
      return { tracks, rootTrackIds }
    }),

  // Insert an identical copy of a track at a given root index (Alt-drag commit).
  // The original is left untouched.
  insertTrackCopy: (srcId, index) => {
    let newId: string | null = null
    set((s) => {
      const src = s.tracks[srcId]
      if (!src) return s
      const copy = cloneTrack(src)
      newId = copy.id
      const rootTrackIds = [...s.rootTrackIds]
      const i = Math.max(0, Math.min(rootTrackIds.length, index))
      rootTrackIds.splice(i, 0, copy.id)
      return { tracks: { ...s.tracks, [copy.id]: copy }, rootTrackIds }
    })
    return newId
  },

  reorderRootTracks: (orderedIds) =>
    set({ rootTrackIds: orderedIds }),

  setTrackParent: (trackId, parentId, index) =>
    set((s) => {
      const child = s.tracks[trackId]
      if (!child) return s
      if (parentId === trackId) return s
      if (parentId != null && !s.tracks[parentId]) return s
      // The audio track is pinned at the top: it never moves, and nothing nests
      // under it (the UI blocks both; this is the backstop).
      if (child.type === 'audio') return s
      if (parentId != null && s.tracks[parentId].type === 'audio') return s
      // Cycle guard: the new parent must not sit inside trackId's own subtree.
      for (let cur: string | undefined = parentId ?? undefined; cur != null; cur = s.tracks[cur]?.parentId) {
        if (cur === trackId) return s
      }

      const tracks = { ...s.tracks }
      let rootTrackIds = [...s.rootTrackIds]

      // Detach from current location.
      const oldParentId = child.parentId
      if (oldParentId != null) {
        const op = tracks[oldParentId]
        if (op) tracks[oldParentId] = { ...op, childIds: op.childIds.filter((c) => c !== trackId) }
      } else {
        rootTrackIds = rootTrackIds.filter((id) => id !== trackId)
      }

      // Attach to the new location at `index` (default: end of the sibling list).
      tracks[trackId] = { ...child, parentId: parentId ?? undefined }
      if (parentId != null) {
        const np = tracks[parentId]
        const childIds = np.childIds.filter((c) => c !== trackId)
        const i = index == null ? childIds.length : Math.max(0, Math.min(childIds.length, index))
        childIds.splice(i, 0, trackId)
        tracks[parentId] = { ...np, childIds }
      } else {
        // Never above the pinned audio track at root index 0.
        const min = tracks[rootTrackIds[0]]?.type === 'audio' ? 1 : 0
        const i = index == null ? rootTrackIds.length : Math.max(min, Math.min(rootTrackIds.length, index))
        rootTrackIds.splice(i, 0, trackId)
      }
      return { tracks, rootTrackIds }
    }),

  toggleMute: (trackId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: { ...s.tracks, [trackId]: { ...track, muted: !track.muted } },
      }
    }),

  toggleSolo: (trackId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: { ...s.tracks, [trackId]: { ...track, solo: !track.solo } },
      }
    }),

  setTrackParam: (trackId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, params: { ...track.params, [key]: value } },
        },
      }
    }),

  setTrackStringParam: (trackId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, stringParams: { ...track.stringParams, [key]: value } },
        },
      }
    }),

  // Swap a track's instrument (double-click in the library). Params are instrument-
  // specific, so they reset to the new instrument's defaults rather than carrying
  // stale keys across; the track is renamed to match (tracks are named after their
  // instrument), unless a name isn't supplied.
  setTrackInstrument: (trackId, instrumentId, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track || track.instrumentId === instrumentId) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, instrumentId, params: {}, name: name ?? track.name },
        },
      }
    }),

  // Convert to an event modifier: set the type, drop the instrument + params.
  setTrackModifier: (trackId, type, name) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, type, instrumentId: '', params: {}, name },
        },
      }
    }),

  addAutomationTrack: (parentId, paramKey, paramLabel) =>
    set((s) => {
      const parent = s.tracks[parentId]
      if (!parent) return s
      // One automation lane per param — don't stack duplicates.
      const exists = parent.childIds.some((cid) => {
        const c = s.tracks[cid]
        return c?.type === 'automation' && c.targetParam === paramKey
      })
      if (exists) return s
      const id = crypto.randomUUID()
      const track: Track = {
        id,
        name: paramLabel,
        type: 'automation',
        instrumentId: '',
        targetParam: paramKey,
        interpolation: 'linear',
        color: parent.color,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        parentId,
      }
      return {
        tracks: {
          ...s.tracks,
          [id]: track,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      }
    }),

  addAbilityTrack: (parentId, abilityKey, abilityLabel) =>
    set((s) => {
      const parent = s.tracks[parentId]
      if (!parent) return s
      // One ability track per ability — don't stack duplicates.
      const exists = parent.childIds.some((cid) => {
        const c = s.tracks[cid]
        return c?.type === 'ability' && c.abilityKey === abilityKey
      })
      if (exists) return s
      const id = crypto.randomUUID()
      const track: Track = {
        id,
        name: abilityLabel,
        type: 'ability',
        instrumentId: '',
        abilityKey,
        color: parent.color,
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        parentId,
      }
      return {
        tracks: {
          ...s.tracks,
          [id]: track,
          [parentId]: { ...parent, childIds: [...parent.childIds, id] },
        },
      }
    }),

  setTrackInterpolation: (trackId, mode) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, interpolation: mode } } }
    }),

  setTrackTargets: (trackId, targets) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, targets } } }
    }),

  setTrackTags: (trackId, tags) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, tags } } }
    }),

  addAudioTrack: (clip) => {
    const id = crypto.randomUUID()
    set((s) => {
      const track: Track = {
        id,
        name: clip.fileName,
        type: 'audio',
        instrumentId: '',
        color: '#38bdf8',
        muted: false,
        solo: false,
        blocks: [],
        childIds: [],
        audioBlocks: [{
          id: crypto.randomUUID(),
          clipRef: clip.ref,
          startBar: 0,
          trimStart: 0,
          trimEnd: clip.duration,
        }],
      }
      // Top of the track rows — the backing track leads the arrangement.
      return { tracks: { ...s.tracks, [id]: track }, rootTrackIds: [id, ...s.rootTrackIds] }
    })
    return id
  },

  addAudioBlock: (trackId, block) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (track?.type !== 'audio') return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, audioBlocks: [...(track.audioBlocks ?? []), block] },
        },
      }
    }),

  updateAudioBlock: (trackId, blockId, updates) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.audioBlocks) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: {
            ...track,
            audioBlocks: track.audioBlocks.map((b) => (b.id === blockId ? { ...b, ...updates } : b)),
          },
        },
      }
    }),

  deleteAudioBlock: (trackId, blockId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.audioBlocks) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, audioBlocks: track.audioBlocks.filter((b) => b.id !== blockId) },
        },
      }
    }),

  addEffect: (trackId, pluginId) =>
    set((s) => {
      const track = s.tracks[trackId]
      const plugin = getEffect(pluginId)
      if (!track || !plugin) return s
      const settings: Record<string, number> = {}
      for (const p of plugin.params) if (typeof p.default === 'number') settings[p.key] = p.default
      const instance: EffectInstance = { id: crypto.randomUUID(), pluginId, enabled: true, settings }
      return { tracks: { ...s.tracks, [trackId]: { ...track, effects: [...(track.effects ?? []), instance] } } }
    }),

  removeEffect: (trackId, instanceId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, effects: track.effects.filter((e) => e.id !== instanceId) } } }
    }),

  setEffectSetting: (trackId, instanceId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, effects: track.effects.map((e) => e.id === instanceId ? { ...e, settings: { ...e.settings, [key]: value } } : e) },
        },
      }
    }),

  toggleEffect: (trackId, instanceId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.effects) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, effects: track.effects.map((e) => e.id === instanceId ? { ...e, enabled: !e.enabled } : e) },
        },
      }
    }),

  setBpm: (bpm) => set({ bpm: Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm))) }),
}))
