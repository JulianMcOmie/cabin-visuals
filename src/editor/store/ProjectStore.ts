import { create } from 'zustand'
import { getPlugin } from '../plugins'
import type { Track, TrackType, Block, Note, PluginInstance } from '../types'

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

// Block reads/writes are polymorphic over "which list": the track's own `blocks`, or
// one of its ability lanes (`lanes[laneKey]`). These two helpers localise that choice
// so every block action stays a one-liner.
const laneBlocks = (track: Track, laneKey?: string): Block[] =>
  laneKey ? track.lanes?.[laneKey] ?? [] : track.blocks
const withLaneBlocks = (track: Track, laneKey: string | undefined, blocks: Block[]): Track =>
  laneKey ? { ...track, lanes: { ...track.lanes, [laneKey]: blocks } } : { ...track, blocks }

interface ProjectState {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  // Project-level musical settings. Here (not TimeStore) so they're part of the
  // undoable document; currentBeat/isPlaying stay in TimeStore (ephemeral transport).
  bpm: number
  beatsPerBar: number
  totalBars: number
  addTrack: (track: Track, atIndex?: number) => void
  // `laneKey` targets an ability lane (`track.lanes[laneKey]`) instead of the track's
  // own `blocks`. Omit it for the main track lane.
  addBlock: (trackId: string, block: Block, laneKey?: string) => void
  addBlocks: (trackId: string, blocks: Block[]) => void
  addNote: (trackId: string, blockId: string, note: Note, laneKey?: string) => void
  updateBlockNotes: (trackId: string, blockId: string, notes: Note[], laneKey?: string) => void
  updateBlock: (trackId: string, blockId: string, updates: Partial<Block>, laneKey?: string) => void
  moveBlock: (fromTrackId: string, blockId: string, toTrackId: string) => void
  deleteBlock: (trackId: string, blockId: string, laneKey?: string) => void
  deleteBlocks: (blockIds: Set<string>) => void
  deleteTrack: (trackId: string) => void
  insertTrackCopy: (srcId: string, index: number) => void
  reorderRootTracks: (orderedIds: string[]) => void
  /** Re-parent a track: parentId=null makes it a root. `index` positions it among
   *  its new siblings (root list or the parent's childIds). No-op on a cycle. */
  setTrackParent: (trackId: string, parentId: string | null, index?: number) => void
  toggleMute: (trackId: string) => void
  toggleSolo: (trackId: string) => void
  setTrackParam: (trackId: string, key: string, value: number) => void
  setTrackInstrument: (trackId: string, instrumentId: string, name?: string) => void
  /** Convert a track into an event modifier of the given type (no instrument). */
  setTrackModifier: (trackId: string, type: TrackType, name: string) => void
  /** Add an `automation` child track under `parentId`, driving the given param over
   *  time. No-op if one already automates that param. */
  addAutomationTrack: (parentId: string, paramKey: string, paramLabel: string) => void
  setTrackTargets: (trackId: string, targets: Track['targets']) => void
  setTrackTags: (trackId: string, tags: string[]) => void
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
      if (atIndex == null || atIndex < 0 || atIndex > rootTrackIds.length) rootTrackIds.push(track.id)
      else rootTrackIds.splice(atIndex, 0, track.id)
      return { tracks, rootTrackIds }
    }),

  addBlock: (trackId, block, laneKey) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: withLaneBlocks(track, laneKey, [...laneBlocks(track, laneKey), block]),
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

  addNote: (trackId, blockId, note, laneKey) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: withLaneBlocks(track, laneKey, laneBlocks(track, laneKey).map((b) =>
            b.id === blockId ? { ...b, notes: [...b.notes, note] } : b
          )),
        },
      }
    }),

  updateBlockNotes: (trackId, blockId, notes, laneKey) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: withLaneBlocks(track, laneKey, laneBlocks(track, laneKey).map((b) =>
            b.id === blockId ? { ...b, notes } : b
          )),
        },
      }
    }),

  updateBlock: (trackId, blockId, updates, laneKey) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: withLaneBlocks(track, laneKey, laneBlocks(track, laneKey).map((b) =>
            b.id === blockId ? { ...b, ...updates } : b
          )),
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

  deleteBlock: (trackId, blockId, laneKey) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: withLaneBlocks(track, laneKey, laneBlocks(track, laneKey).filter((b) => b.id !== blockId)),
        },
      }
    }),

  deleteBlocks: (blockIds) =>
    set((s) => {
      const tracks: Record<string, Track> = {}
      for (const [id, t] of Object.entries(s.tracks)) {
        const blocks = t.blocks.filter((b) => !blockIds.has(b.id))
        let changed = blocks.length !== t.blocks.length
        // Also purge from any ability lanes, so a selected lane block deletes too.
        let lanes = t.lanes
        if (lanes) {
          let lanesChanged = false
          const next: Record<string, Block[]> = {}
          for (const [key, laneBlk] of Object.entries(lanes)) {
            const filtered = laneBlk.filter((b) => !blockIds.has(b.id))
            if (filtered.length !== laneBlk.length) lanesChanged = true
            next[key] = filtered
          }
          if (lanesChanged) { lanes = next; changed = true }
        }
        tracks[id] = changed ? { ...t, blocks, lanes } : t
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
  insertTrackCopy: (srcId, index) =>
    set((s) => {
      const src = s.tracks[srcId]
      if (!src) return s
      const copy = cloneTrack(src)
      const rootTrackIds = [...s.rootTrackIds]
      const i = Math.max(0, Math.min(rootTrackIds.length, index))
      rootTrackIds.splice(i, 0, copy.id)
      return { tracks: { ...s.tracks, [copy.id]: copy }, rootTrackIds }
    }),

  reorderRootTracks: (orderedIds) =>
    set({ rootTrackIds: orderedIds }),

  setTrackParent: (trackId, parentId, index) =>
    set((s) => {
      const child = s.tracks[trackId]
      if (!child) return s
      if (parentId === trackId) return s
      if (parentId != null && !s.tracks[parentId]) return s
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
        const i = index == null ? rootTrackIds.length : Math.max(0, Math.min(rootTrackIds.length, index))
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

  addEffect: (trackId, pluginId) =>
    set((s) => {
      const track = s.tracks[trackId]
      const plugin = getPlugin(pluginId)
      if (!track || !plugin) return s
      const settings: Record<string, number> = {}
      for (const p of plugin.params) settings[p.key] = p.default
      const instance: PluginInstance = { id: crypto.randomUUID(), pluginId, enabled: true, settings }
      return { tracks: { ...s.tracks, [trackId]: { ...track, visualPlugins: [...(track.visualPlugins ?? []), instance] } } }
    }),

  removeEffect: (trackId, instanceId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.visualPlugins) return s
      return { tracks: { ...s.tracks, [trackId]: { ...track, visualPlugins: track.visualPlugins.filter((e) => e.id !== instanceId) } } }
    }),

  setEffectSetting: (trackId, instanceId, key, value) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.visualPlugins) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, visualPlugins: track.visualPlugins.map((e) => e.id === instanceId ? { ...e, settings: { ...e.settings, [key]: value } } : e) },
        },
      }
    }),

  toggleEffect: (trackId, instanceId) =>
    set((s) => {
      const track = s.tracks[trackId]
      if (!track?.visualPlugins) return s
      return {
        tracks: {
          ...s.tracks,
          [trackId]: { ...track, visualPlugins: track.visualPlugins.map((e) => e.id === instanceId ? { ...e, enabled: !e.enabled } : e) },
        },
      }
    }),

  setBpm: (bpm) => set({ bpm: Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm))) }),
}))
