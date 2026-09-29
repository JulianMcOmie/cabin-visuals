import { useEffect, useState } from 'react'
import { useProjectStore } from '../store/ProjectStore'

// The song's analysis (cabin analyze → projects/<file>/analysis/analysis.json)
// as the song strip draws it: energy per beat and chord-root changes, in
// PROJECT beats through the song's audio block (so moving the song in the
// editor moves the curve with it). Dev `?file=` sessions only.

interface RawAnalysis {
  fps: number
  tempo: { period: number; phase: number }
  harmony: Array<{ b: number }>
  env: Record<string, number[]>
}

export interface SongAnalysis {
  /** Mean mix energy per beat, 0..1 (index = project beat). */
  energy: Float32Array
  /** Where the bass root changes: [beat, pitch class | -1]. */
  chords: Array<[number, number]>
}

const cache = new Map<string, Promise<RawAnalysis | null>>()

async function load(file: string): Promise<RawAnalysis | null> {
  const files = `/api/dev/projects/${encodeURIComponent(file)}/files`
  try {
    const meta = await fetch(`${files}/cabin.json`, { cache: 'no-store' })
    const rel = meta.ok ? ((await meta.json()) as { analysis?: string }).analysis : undefined
    const r = await fetch(`${files}/${(rel ?? 'analysis/analysis.json').split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
    return r.ok ? ((await r.json()) as RawAnalysis) : null
  } catch {
    return null
  }
}

export function useSongAnalysis(file: string | null): SongAnalysis | null {
  const [raw, setRaw] = useState<RawAnalysis | null>(null)
  const placement = useProjectStore((s) => {
    for (const t of Object.values(s.audioTracks)) for (const b of t.audioBlocks ?? []) return `${b.startBar}|${b.trimStart}`
    return '0|0'
  })
  const bpm = useProjectStore((s) => s.bpm)
  const bpb = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  useEffect(() => {
    if (!file) { setRaw(null); return }
    let p = cache.get(file)
    if (!p) cache.set(file, p = load(file))
    let live = true
    void p.then((r) => { if (live) setRaw(r) })
    return () => { live = false }
  }, [file])
  const [song, setSong] = useState<SongAnalysis | null>(null)
  useEffect(() => {
    if (!raw) { setSong(null); return }
    const [startBar, trimStart] = placement.split('|').map(Number)
    const spb = 60 / bpm
    const secOf = (beat: number) => trimStart + (beat - startBar * bpb) * spb
    const beats = totalBars * bpb
    const mix = raw.env.mix ?? []
    const energy = new Float32Array(beats)
    for (let b = 0; b < beats; b++) {
      const i0 = Math.max(0, Math.floor(secOf(b) * raw.fps)), i1 = Math.min(mix.length, Math.ceil(secOf(b + 1) * raw.fps))
      let s = 0
      for (let i = i0; i < i1; i++) s += mix[i]
      energy[b] = i1 > i0 ? s / (i1 - i0) / 1000 : 0
    }
    const chords: Array<[number, number]> = []
    let prev = -2
    raw.harmony.forEach((h, i) => {
      if (h.b === prev) return
      prev = h.b
      const sec = raw.tempo.phase + i * raw.tempo.period
      chords.push([startBar * bpb + (sec - trimStart) / spb, h.b])
    })
    setSong({ energy, chords })
  }, [raw, placement, bpm, bpb, totalBars])
  return song
}
