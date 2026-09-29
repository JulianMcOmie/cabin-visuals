import fs from 'fs'
import { Midi } from '@tonejs/midi'
import type { Cabin, NoteIn, SceneApi } from './api'

// Standard MIDI files in and out. Import maps each MIDI track (by name) onto a
// track in a scene - an existing one, or a new one of `instrument` - and places
// its notes in absolute beats (ticks / PPQ, like the editor's own importer:
// constant tempo, the file's tempo map ignored). Export writes one MIDI track
// per Cabin track so the arrangement round-trips through any DAW.

export interface ImportOpts {
  scene: SceneApi
  /** MIDI track name → Cabin track name (unlisted tracks keep their own name). */
  map?: Record<string, string>
  /** Only these MIDI track names. */
  only?: string[]
  /** Instrument for tracks that don't exist yet (default: midiRoll). */
  instrument?: string
  /** Shift everything by this many beats. */
  offset?: number
  /** Clear each target track over the imported span first. */
  replace?: boolean
}

export function importMidi(p: Cabin, file: string, opts: ImportOpts): string[] {
  const midi = new Midi(fs.readFileSync(file))
  const ppq = midi.header.ppq
  const report: string[] = []
  midi.tracks.forEach((mt, i) => {
    if (mt.notes.length === 0) return
    const name = mt.name?.trim() || `Track ${i + 1}`
    if (opts.only && !opts.only.includes(name)) return
    const target = opts.map?.[name] ?? name
    const track = opts.scene.find(target) ?? opts.scene.create(target, { instrument: opts.instrument ?? 'midiRoll' })
    const notes: NoteIn[] = mt.notes.map((n) => ({
      beat: n.ticks / ppq + (opts.offset ?? 0),
      pitch: n.midi,
      dur: Math.max(1 / 64, n.durationTicks / ppq),
      vel: Math.round(n.velocity * 127),
    }))
    if (opts.replace) {
      const from = Math.min(...notes.map((n) => n.beat))
      const to = Math.max(...notes.map((n) => n.beat + (n.dur ?? 0))) + 1e-6
      track.clear(from, to)
    }
    track.add(notes)
    report.push(`${name} → "${track.name}" (${notes.length} notes)`)
  })
  return report
}

export function exportMidi(p: Cabin, sceneNames: string[] | null, file: string): number {
  const midi = new Midi()
  midi.header.setTempo(p.bpm)
  const ppq = midi.header.ppq
  let count = 0
  const scenes = sceneNames ? sceneNames.map((n) => p.scene(n, { create: false })) : [...p.scenes(), p.main()]
  for (const scene of scenes) {
    for (const t of scene.tracks()) {
      const notes = t.notes()
      if (notes.length === 0) continue
      const mt = midi.addTrack()
      mt.name = scenes.length > 1 ? `${scene.name} · ${t.name}` : t.name
      for (const n of notes) {
        mt.addNote({ midi: Math.max(0, Math.min(127, n.pitch)), ticks: Math.round(n.beat * ppq), durationTicks: Math.max(1, Math.round(n.dur * ppq)), velocity: n.vel / 127 })
      }
      count++
    }
  }
  fs.writeFileSync(file, Buffer.from(midi.toArray()))
  return count
}
