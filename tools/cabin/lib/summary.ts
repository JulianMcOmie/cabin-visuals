import type { ProjectDocument } from '../../../src/persistence/types'
import type { Scene, Track } from '../../../src/editor/types'
import type { CabinMeta } from './project'
import { barBeat } from './time'

// Human-readable (and model-readable) views of a project: the whole tree, or
// one track's notes. Compact on purpose - this is what `cabin info` prints
// every iteration, so it must fit on a screen.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (p: number) => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

function trackLine(t: Track, depth: number, bpb: number): string {
  const kind = t.type === 'base'
    ? (t.instrumentId || '(none)')
    : t.type === 'mover' ? `mover:${t.moverId}`
      : t.type === 'splitter' ? `splitter:${t.splitterId}`
        : t.type === 'automation' ? `auto→${t.targetParam}`
          : t.type === 'ability' ? `ability:${t.abilityKey}`
            : t.type
  let notes = 0, lo = Infinity, hi = -Infinity, first = Infinity, last = -Infinity
  for (const b of t.blocks) {
    notes += b.notes.length * (b.loop ? 1 : 1)
    for (const n of b.notes) {
      lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch)
      const abs = b.startBar * bpb + n.startBeat
      first = Math.min(first, abs); last = Math.max(last, abs)
    }
  }
  const span = notes ? ` bars ${Math.floor(first / bpb)}–${Math.floor(last / bpb)}` : ''
  const pitches = notes ? ` pitch ${lo === hi ? lo : `${lo}-${hi}`}` : ''
  const loops = t.blocks.some((b) => b.loop) ? ' (looped)' : ''
  const flags = [t.muted ? 'muted' : '', t.solo ? 'solo' : ''].filter(Boolean).join(',')
  const params = Object.entries(t.params ?? {}).filter(([k]) => !k.startsWith('tf')).slice(0, 6).map(([k, v]) => `${k}=${+v.toFixed(3)}`)
  const strings = Object.entries(t.stringParams ?? {}).slice(0, 3).map(([k, v]) => `${k}=${v.length > 18 ? v.slice(0, 16) + '…' : v}`)
  const inputs = Object.entries(t.inputValues ?? {}).slice(0, 5).map(([k, v]) => `${k}=${+v.toFixed(3)}`)
  const settings = [...params, ...strings, ...inputs].join(' ')
  return `${'  '.repeat(depth)}- "${t.name}" [${kind}] ${notes} notes${span}${pitches}${loops}${flags ? ` {${flags}}` : ''}${settings ? `  ${settings}` : ''}`
}

function sceneTree(scene: Scene, bpb: number): string[] {
  const lines: string[] = []
  const walk = (id: string, depth: number) => {
    const t = scene.tracks[id]
    if (!t) return
    lines.push(trackLine(t, depth, bpb))
    for (const c of t.childIds) walk(c, depth + 1)
  }
  for (const r of scene.rootTrackIds) walk(r, 1)
  return lines
}

export function summarize(name: string, doc: ProjectDocument, meta: CabinMeta): string {
  const bpb = doc.beatsPerBar
  const secs = (doc.totalBars * bpb * 60) / doc.bpm
  const out: string[] = []
  out.push(`${name}: ${doc.bpm} BPM, ${bpb}/4, ${doc.totalBars} bars (${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')})`)
  const audio = Object.values(doc.audioTracks)
  for (const a of audio) for (const b of a.audioBlocks ?? []) out.push(`  audio "${a.name}": ${b.clipRef.split('/').pop()} from bar ${b.startBar} (${(b.trimEnd - b.trimStart).toFixed(1)}s)`)
  if (meta.sections?.length) out.push(`  sections: ${meta.sections.map((s) => `${s.name} ${s.from}-${s.to}`).join(' · ')}`)
  for (const id of doc.sceneOrder) {
    const s = doc.scenes[id]
    if (!s) continue
    const bg = s.backgroundGradient?.enabled ? `gradient ${s.backgroundGradient.from}→${s.backgroundGradient.to}` : s.backgroundTransparent ? 'transparent' : s.backgroundColor
    out.push(`${s.isMain ? 'COMPOSITE' : 'scene'} "${s.name}" (${bg})`)
    if (s.isMain) {
      for (const rid of s.rootTrackIds) {
        const t = s.tracks[rid]
        if (!t) continue
        out.push(trackLine(t, 1, bpb))
        for (const b of t.sceneBindings ?? []) out.push(`      row ${b.pitch} → "${doc.scenes[b.sceneId]?.name ?? '?'}"`)
        for (const c of t.childIds) if (s.tracks[c]) out.push(trackLine(s.tracks[c], 2, bpb))
      }
    } else {
      out.push(...sceneTree(s, bpb))
    }
  }
  if (meta.notes) out.push(`notes: ${meta.notes}`)
  return out.join('\n')
}

export function listNotes(t: Track, bpb: number, from = -Infinity, to = Infinity, pitchNames = false): string {
  const rows: Array<[number, number, string]> = []
  for (const b of t.blocks) {
    for (const n of b.notes) {
      const abs = b.startBar * bpb + n.startBeat
      if (abs < from || abs >= to) continue
      rows.push([abs, n.pitch, `${barBeat(abs, bpb).padEnd(10)} b${String(+abs.toFixed(3)).padEnd(9)} ${String(n.pitch).padStart(3)}${pitchNames ? ` ${noteName(n.pitch).padEnd(4)}` : ''} dur ${String(+n.durationBeats.toFixed(3)).padEnd(6)} vel ${n.velocity}${b.loop ? '  (loop pattern)' : ''}`])
    }
  }
  return rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((r) => r[2]).join('\n')
}
