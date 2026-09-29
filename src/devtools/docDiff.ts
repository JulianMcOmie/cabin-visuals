import type { ProjectDocument } from '../persistence/types'

// A semantic diff between two project documents: scenes and tracks added or
// removed, notes added/removed per track (by content - beat, pitch, length,
// velocity - so a script that rewrites identical notes with fresh ids is "no
// change"), params changed, tempo. Shared by the `cabin` CLI (history/diff)
// and the editor's external-edit review (dev/useFileSync.ts). Pure: no I/O.

export interface NoteKey { beat: number; pitch: number; dur: number; vel: number }

export interface TrackDiff {
  sceneId: string
  scene: string
  trackId: string
  track: string
  change: 'added' | 'removed' | 'changed'
  notesAdded: NoteKey[]
  notesRemoved: NoteKey[]
  paramsChanged: string[]
}

export interface DocDiff {
  bpm?: [number, number]
  totalBars?: [number, number]
  scenesAdded: string[]
  scenesRemoved: string[]
  tracks: TrackDiff[]
}

type Doc = Pick<ProjectDocument, 'bpm' | 'beatsPerBar' | 'totalBars' | 'scenes' | 'sceneOrder'>
type AnyTrack = Doc['scenes'][string]['tracks'][string]

const r4 = (x: number) => Math.round(x * 1e4) / 1e4

export function noteKeys(track: AnyTrack, beatsPerBar: number): NoteKey[] {
  const out: NoteKey[] = []
  for (const b of track.blocks ?? []) {
    // looped blocks tile their notes; for diffing the pattern itself is enough
    for (const n of b.notes) out.push({ beat: r4(b.startBar * beatsPerBar + n.startBeat), pitch: n.pitch, dur: r4(n.durationBeats), vel: n.velocity })
  }
  return out
}

const keyOf = (n: NoteKey) => `${n.beat}|${n.pitch}|${n.dur}|${n.vel}`

function multisetDiff(a: NoteKey[], b: NoteKey[]): { added: NoteKey[]; removed: NoteKey[] } {
  const count = new Map<string, number>()
  for (const n of a) count.set(keyOf(n), (count.get(keyOf(n)) ?? 0) + 1)
  const added: NoteKey[] = []
  for (const n of b) {
    const k = keyOf(n)
    const c = count.get(k) ?? 0
    if (c > 0) count.set(k, c - 1)
    else added.push(n)
  }
  const removed: NoteKey[] = []
  const left = new Map(count)
  for (const n of a) {
    const k = keyOf(n)
    const c = left.get(k) ?? 0
    if (c > 0) { removed.push(n); left.set(k, c - 1) }
  }
  return { added, removed }
}

function paramDiff(a: AnyTrack, b: AnyTrack): string[] {
  const out: string[] = []
  const cmp = (x: Record<string, unknown> | undefined, y: Record<string, unknown> | undefined, prefix = '') => {
    const keys = new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])
    for (const k of keys) if (JSON.stringify(x?.[k]) !== JSON.stringify(y?.[k])) out.push(prefix + k)
  }
  cmp(a.params as Record<string, unknown>, b.params as Record<string, unknown>)
  cmp(a.stringParams as Record<string, unknown>, b.stringParams as Record<string, unknown>)
  if (a.instrumentId !== b.instrumentId) out.push('instrument')
  if (a.name !== b.name) out.push('name')
  if (!!a.muted !== !!b.muted) out.push('muted')
  return out
}

export function diffDocs(a: Doc, b: Doc): DocDiff {
  const d: DocDiff = { scenesAdded: [], scenesRemoved: [], tracks: [] }
  if (a.bpm !== b.bpm) d.bpm = [a.bpm, b.bpm]
  if (a.totalBars !== b.totalBars) d.totalBars = [a.totalBars, b.totalBars]
  for (const id of b.sceneOrder) if (!a.scenes[id] && b.scenes[id]) d.scenesAdded.push(b.scenes[id].name)
  for (const id of a.sceneOrder) if (!b.scenes[id] && a.scenes[id]) d.scenesRemoved.push(a.scenes[id].name)
  const sceneIds = new Set([...a.sceneOrder, ...b.sceneOrder])
  for (const sid of sceneIds) {
    const sa = a.scenes[sid], sb = b.scenes[sid]
    const scene = (sb ?? sa)?.name ?? sid
    const ids = new Set([...Object.keys(sa?.tracks ?? {}), ...Object.keys(sb?.tracks ?? {})])
    for (const tid of ids) {
      const ta = sa?.tracks[tid], tb = sb?.tracks[tid]
      if (ta && !tb) {
        d.tracks.push({ sceneId: sid, scene, trackId: tid, track: ta.name, change: 'removed', notesAdded: [], notesRemoved: noteKeys(ta, a.beatsPerBar), paramsChanged: [] })
      } else if (!ta && tb) {
        d.tracks.push({ sceneId: sid, scene, trackId: tid, track: tb.name, change: 'added', notesAdded: noteKeys(tb, b.beatsPerBar), notesRemoved: [], paramsChanged: [] })
      } else if (ta && tb) {
        const { added, removed } = multisetDiff(noteKeys(ta, a.beatsPerBar), noteKeys(tb, b.beatsPerBar))
        const params = paramDiff(ta, tb)
        if (added.length || removed.length || params.length) {
          d.tracks.push({ sceneId: sid, scene, trackId: tid, track: tb.name, change: 'changed', notesAdded: added, notesRemoved: removed, paramsChanged: params })
        }
      }
    }
  }
  return d
}

export function isEmptyDiff(d: DocDiff): boolean {
  return !d.bpm && !d.totalBars && !d.scenesAdded.length && !d.scenesRemoved.length && !d.tracks.length
}

/** A few lines a person (or model) can read. */
export function formatDiff(d: DocDiff, beatsPerBar = 4): string {
  if (isEmptyDiff(d)) return '(no changes)'
  const lines: string[] = []
  if (d.bpm) lines.push(`tempo ${d.bpm[0]} → ${d.bpm[1]} BPM`)
  if (d.totalBars) lines.push(`length ${d.totalBars[0]} → ${d.totalBars[1]} bars`)
  if (d.scenesAdded.length) lines.push(`+ scenes: ${d.scenesAdded.join(', ')}`)
  if (d.scenesRemoved.length) lines.push(`- scenes: ${d.scenesRemoved.join(', ')}`)
  const span = (ns: NoteKey[]) => {
    if (!ns.length) return ''
    const lo = Math.min(...ns.map((n) => n.beat)), hi = Math.max(...ns.map((n) => n.beat))
    return ` (bars ${Math.floor(lo / beatsPerBar)}–${Math.floor(hi / beatsPerBar)})`
  }
  for (const t of d.tracks) {
    const sign = t.change === 'added' ? '+' : t.change === 'removed' ? '-' : '~'
    const parts: string[] = []
    if (t.notesAdded.length) parts.push(`+${t.notesAdded.length} notes${span(t.notesAdded)}`)
    if (t.notesRemoved.length) parts.push(`-${t.notesRemoved.length} notes${span(t.notesRemoved)}`)
    if (t.paramsChanged.length) parts.push(`params: ${t.paramsChanged.join(', ')}`)
    lines.push(`${sign} ${t.scene}/${t.track}${parts.length ? `  ${parts.join(' · ')}` : ''}`)
  }
  return lines.join('\n')
}
