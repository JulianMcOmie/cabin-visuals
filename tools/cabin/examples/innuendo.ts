// underscores - INNUENDO (I Get U), rebuilt in Cabin from its analysis: every
// note below is placed from what the song actually does (Demucs stems → onsets,
// pitch, harmony), onto the innuendo code-instrument pack, scene by scene, with
// portal cuts on the Composite. Re-run it after changing anything - it clears
// what it writes.
//
//   ./cabin new innuendo --audio innuendo.m4a
//   ./cabin analyze innuendo                       (148 BPM, bar 0 = first downbeat)
//   ./cabin run innuendo tools/cabin/examples/innuendo.ts
//   ./cabin shot innuendo --at 2,10,26,30,82,100,114 --sheet
//
// The recipe is the point: pick a scene per section, filter the analysis
// (strong kicks on the 8th grid, snares with real crack, the sung line with its
// pitch, chord roots from the bass), and write it as MIDI onto the rows each
// instrument understands. All absolute beats; p.bar(n) = downbeat of bar n.

import type { Cabin, NoteIn, SceneApi, TrackApi, TrackSpec } from '../lib/api'


const SECTIONS: Array<[string, number, number]> = [
  ['intro', 0, 4], ['verse1', 4, 24], ['ah1', 24, 28], ['chorus1', 28, 40], ['ah2', 40, 44],
  ['verse2', 44, 60], ['ah3', 60, 64], ['chorus2', 64, 76], ['ah4', 76, 80], ['bridge', 80, 92],
  ['ah5', 92, 96], ['poster', 96, 108], ['ah6', 108, 112], ['finale', 112, 124], ['ah7', 124, 128], ['outro', 128, 131],
]

// Which scene plays each section, and how the portal dives into it.
const SHAPE = { circle: 36, triangle: 37, square: 38, pentagon: 39, hexagon: 40, octagon: 42, dodecagon: 44 }
const WARP = 47, HARD = 45
const PLAN: Record<string, { scene: string; style: number[] }> = {
  intro: { scene: 'Thread', style: [HARD] },
  verse1: { scene: 'Signal', style: [SHAPE.hexagon] },
  chorus1: { scene: 'Plate', style: [SHAPE.square, WARP] },
  verse2: { scene: 'Signal', style: [SHAPE.hexagon] },
  chorus2: { scene: 'Plate', style: [SHAPE.square, WARP] },
  bridge: { scene: 'Tunnel', style: [SHAPE.circle] },
  poster: { scene: 'Hyperspace', style: [SHAPE.dodecagon, WARP] },
  finale: { scene: 'Finale', style: [SHAPE.hexagon, WARP] },
  outro: { scene: 'Thread', style: [SHAPE.triangle] },
}
const planFor = (name: string) => PLAN[name] ?? { scene: 'Pen', style: [SHAPE.circle] } // every "ah" → the Pen

const ROOT = 6 // F# minor

export default function build(p: Cabin) {
  const a = p.analysis()
  const bar = (n: number) => p.bar(n)
  const inBars = <T extends { beat: number }>(list: T[], from: number, to: number) =>
    list.filter((h) => h.beat >= bar(from) - 1e-6 && h.beat < bar(to) - 1e-6)
  const sectionsOf = (scene: string) => SECTIONS.filter(([name]) => planFor(name).scene === scene)
  const vel = (v: number, lo = 40, hi = 127) => Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, v)))
  const onGrid = (beat: number, div: number) => Math.abs(beat * div - Math.round(beat * div)) < 0.02

  // The song's material, filtered once (lib/analysis.ts: strong-for-their-bar
  // drums, a pitch for every sung onset, chord changes held until they change).
  const kicks = a.strongest('kick', 0.6, 0.25, 2)
  const snares = a.strongest('snare', 0.75, 0.3, 2)
  const hats = a.hat.filter((h) => h.v >= 0.15)
  const sung = a.sung(0.2, ROOT)
  const register = (pitch: number | null) => (pitch === null ? 62 : pitch < 61 ? 60 : pitch < 67 ? 62 : 64)
  const changes = a.chordChanges()

  p.sections = SECTIONS.map(([name, from, to]) => ({ name, from, to }))
  // the song's shared lanes (Kick, Snare, Hat, Bass, Vocal, Other, Root, Chord) for ctx.lane()
  p.lanesFromAnalysis({ replace: true })
  if (p.scenes().some((s) => s.name === 'Scene 1')) p.removeScene('Scene 1')
  // get-or-create (the spec is re-applied), then wipe its notes: the script owns these tracks
  const fresh = (scene: SceneApi, name: string, spec: TrackSpec): TrackApi => {
    const t = scene.track(name, spec)
    t.clear()
    return t
  }

  // ---------------------------------------------------------------- Thread: intro + outro - a single line
  {
    const s = p.scene('Thread', { background: '#000000' })
    const line = fresh(s, 'Line', { instrument: 'innuendo.hairline', params: { width: 1.1, amp: 1.2 } })
    const ring = fresh(s, 'Steps', { instrument: 'innuendo.step-ring', params: { radius: 1.9, ghost: 0.05, playhead: false } })
    line.add({ beat: 0, pitch: 72, dur: 0.5 })
    for (const h of inBars(a.kick, 0, 4)) if (h.v > 0.5) line.add({ beat: h.beat, pitch: 60, vel: vel(h.v) })
    for (const h of inBars(a.vocal, 0, 4)) line.add({ beat: h.beat, pitch: register(h.pitch), vel: vel(h.v, 60) })
    ring.add(inBars(hats, 0, 4).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 30, 110) })))
    // outro: draw on again, then curl into a circle and hold it
    line.add([{ beat: bar(128), pitch: 72, dur: 0.5 }, { beat: bar(128) + 1, pitch: 70, dur: bar(3) - 1 }])
  }

  // ---------------------------------------------------------------- Signal: the verses - the vocabulary
  {
    const s = p.scene('Signal', { background: '#05060a' })
    const line = fresh(s, 'Hairline', { instrument: 'innuendo.hairline', params: { width: 1.04 } })
    const orb = fresh(s, 'Orb', { instrument: 'innuendo.orb', params: { radius: 0.8, spin: 0.25 } })
    const ring = fresh(s, 'Steps', { instrument: 'innuendo.step-ring', params: { radius: 1.5 } })
    const stars = fresh(s, 'Harmony', { instrument: 'innuendo.fifths', params: { radius: 2.3, key: ROOT } })
    const blades = fresh(s, 'Snare', { instrument: 'innuendo.blades', params: { count: 3 } })
    const voice = fresh(s, 'Voice', { instrument: 'innuendo.glyphs', params: { size: 0.45, key: ROOT } })
    for (const [name, from, to] of sectionsOf('Signal')) {
      line.add({ beat: bar(from), pitch: 72, dur: 0.5 })
      for (const h of inBars(a.vocal, from, to)) line.add({ beat: h.beat, pitch: register(h.pitch), vel: vel(h.v, 60) })
      orb.add(inBars(kicks, from, to).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 60) })))
      for (let b = from; b < to; b += 4) orb.add({ beat: bar(b), pitch: 64 })                   // next shape every phrase
      orb.add({ beat: bar(from), pitch: 62, vel: 127 })                                            // scatter on the way in
      ring.add(inBars(hats, from, to).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 40) })))
      for (const c of changes.filter((c) => c.beat >= bar(from) && c.beat < bar(to))) {
        stars.add(c.tones.map((pc) => ({ beat: c.beat, pitch: 60 + pc, dur: Math.max(1, c.end - c.beat), vel: 95 })))
      }
      // synth/keys onsets flare their pitch class between the chord changes
      stars.add(inBars(a.other, from, to).filter((h) => h.v > 0.3).map((h) => ({ beat: h.beat, pitch: 72 + h.pc, dur: 0.5, vel: vel(h.v, 40, 100) })))
      voice.add(inBars(sung, from, to).map((h) => ({ beat: h.beat, pitch: Math.round(h.pitch), dur: Math.max(0.35, h.dur), vel: vel(h.v, 60) })))
      if (name === 'verse2') blades.add(inBars(snares, from, to).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 60) })))
    }
  }

  // ---------------------------------------------------------------- Pen: every "ah" - the voice drawing
  {
    const s = p.scene('Pen', { background: '#000207' })
    const pen = fresh(s, 'Pen', { instrument: 'innuendo.pen', params: { phrase: 4, key: ROOT, size: 1.35, speed: 2.3 } })
    for (const [, from, to] of sectionsOf('Pen')) {
      pen.add(inBars(sung, from, to).map((h) => ({ beat: h.beat, pitch: Math.round(h.pitch), dur: Math.max(0.3, h.dur), vel: vel(h.v, 70) })))
    }
  }

  // ---------------------------------------------------------------- Plate: the choruses - sand on the chords
  {
    const s = p.scene('Plate', { background: '#0b0c2a' })
    const sand = fresh(s, 'Sand', { instrument: 'innuendo.chladni', params: { upright: true, size: 1.6, plate: 0, grains: 140000, alpha: 0.32, settle: 1.1 } })
    const fold = fresh(s, 'Fold', { instrument: 'innuendo.mirror', params: { mode: 2, segments: 8, zoom: 1.9 } })
    const FOLDS = [6, 8, 12, 8]
    for (const [, from, to] of sectionsOf('Plate')) {
      for (const c of changes.filter((c) => c.beat >= bar(from) && c.beat < bar(to))) {
        sand.add({ beat: c.beat, pitch: 48 + c.root, dur: Math.max(0.5, c.end - c.beat - 0.05) })
      }
      sand.add({ beat: bar(from), pitch: 60, vel: 85 })                                          // the blast on the drop
      // a soft re-scatter at each later phrase start (a blast throws EVERY grain: often = noise)
      for (const h of inBars(kicks, from, to)) if (h.beat > bar(from) && onGrid((h.beat - bar(from)) / (4 * p.beatsPerBar), 1)) sand.add({ beat: h.beat, pitch: 60, vel: 55 })
      sand.add(inBars(snares, from, to).map((h) => ({ beat: h.beat, pitch: 62, vel: vel(h.v, 30, 80) })))
      for (let b = from; b < to; b += 4) {
        if (b + 2 < to && (b - from) % 8 === 4) sand.add({ beat: bar(b + 3), pitch: 66, dur: 0.5 }) // a harmonic climb, once in a while
        sand.add({ beat: bar(b + 3) + 2, pitch: 64, dur: 2, vel: 90 })                            // shiver into the next phrase
        fold.add({ beat: bar(b), pitch: 48 + FOLDS[((b - from) / 4) % FOLDS.length] - 2, dur: bar(4) - 0.01 })
      }
      // the fold turns on the backbeat and ripples on each bar's first kick
      for (const h of inBars(snares, from, to)) if (onGrid(h.beat, 1) && Math.round(h.beat) % 2 === 1) fold.add({ beat: h.beat, pitch: 60 })
      for (const h of inBars(kicks, from, to)) if (onGrid(h.beat / p.beatsPerBar, 1)) fold.add({ beat: h.beat, pitch: 62, vel: vel(h.v) })
    }
  }

  // ---------------------------------------------------------------- Tunnel + Hyperspace: bridge and poster - fly the score
  const tunnelNotes = (from: number, to: number): NoteIn[] => [
    ...inBars(kicks, from, to).map((h) => ({ beat: h.beat, pitch: 36, vel: vel(h.v, 60) })),
    ...inBars(snares, from, to).map((h) => ({ beat: h.beat, pitch: 38, vel: vel(h.v, 50) })),
    ...inBars(hats, from, to).filter((h) => onGrid(h.beat, 2)).map((h) => ({ beat: h.beat, pitch: 42, vel: vel(h.v, 30) })),
    ...inBars(sung, from, to).map((h) => ({ beat: h.beat, pitch: Math.round(h.pitch), dur: Math.max(0.3, h.dur), vel: vel(h.v, 60) })),
    ...inBars(a.bass, from, to).filter((h) => h.pitch !== null).map((h) => ({ beat: h.beat, pitch: 48 + (Math.round(h.pitch!) % 12), dur: Math.max(0.5, h.dur), vel: vel(h.v, 50) })),
  ]
  {
    const s = p.scene('Tunnel', { background: '#01030a' })
    const t = fresh(s, 'Score', { instrument: 'innuendo.tunnel', params: { speed: 1.9, ahead: 9, bend: 0.8, twist: 0.05, key: ROOT } })
    for (const [, from, to] of sectionsOf('Tunnel')) t.add(tunnelNotes(from, to))
  }
  {
    const s = p.scene('Hyperspace', { background: '#07020a' })
    const t = fresh(s, 'Score', {
      instrument: 'innuendo.tunnel', params: { speed: 3.1, ahead: 7, bend: 1.3, twist: -0.12, ribs: 0.24, rails: 18, key: ROOT, gain: 1.15 },
      strings: { color: '#ff5ad1', melody: '#ffd08a', hot: '#ffffff' },
    })
    const blades = fresh(s, 'Blades', { instrument: 'innuendo.blades', params: { radial: 8, count: 1, start: 1.8, travel: 3.5, length: 0.6 }, strings: { color: '#ff8a5b' } })
    // the camera + grade, played by the shared Kick/Snare lanes (p.lanesFromAnalysis)
    s.track('Rig', { instrument: 'innuendo.rig', params: { distance: 5, sway: 0.7, push: 1.1, roll: 0.3, aberration: 6, bloom: 0.7 } })
    for (const [, from, to] of sectionsOf('Hyperspace')) {
      t.add(tunnelNotes(from, to))
      blades.add(inBars(snares, from, to).filter((h) => h.v > 0.55).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 60) })))
    }
  }

  // ---------------------------------------------------------------- Finale: everything at once, folded
  {
    const s = p.scene('Finale', { background: '#040208' })
    const orb = fresh(s, 'Orb', { instrument: 'innuendo.orb', params: { radius: 1.15, points: 14000, spin: 0.5, ringReach: 5 } })
    const ring = fresh(s, 'Steps', { instrument: 'innuendo.step-ring', params: { radius: 2.05, reach: 0.6 } })
    const stars = fresh(s, 'Harmony', { instrument: 'innuendo.fifths', params: { radius: 3.1, key: ROOT, sparks: 16 } })
    const blades = fresh(s, 'Blades', { instrument: 'innuendo.blades', params: { radial: 6, count: 1, start: 2.4, travel: 2.8 } })
    const voice = fresh(s, 'Voice', { instrument: 'innuendo.glyphs', params: { size: 0.55, key: ROOT, echoes: 4 } })
    const fold = fresh(s, 'Fold', { instrument: 'innuendo.mirror', params: { mode: 1, zoom: 1.2, mix: 1 } })
    for (const [, from, to] of sectionsOf('Finale')) {
      orb.add(inBars(kicks, from, to).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 70) })))
      for (let b = from; b < to; b += 2) orb.add({ beat: bar(b), pitch: 64 })
      orb.add({ beat: bar(from), pitch: 62, vel: 127 })
      ring.add(inBars(hats, from, to).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 40) })))
      for (const c of changes.filter((c) => c.beat >= bar(from) && c.beat < bar(to))) {
        stars.add(c.tones.map((pc) => ({ beat: c.beat, pitch: 60 + pc, dur: Math.max(1, c.end - c.beat), vel: 110 })))
      }
      blades.add(inBars(snares, from, to).map((h) => ({ beat: h.beat, pitch: 60, vel: vel(h.v, 70) })))
      voice.add(inBars(sung, from, to).map((h) => ({ beat: h.beat, pitch: Math.round(h.pitch), dur: Math.max(0.35, h.dur), vel: vel(h.v, 70) })))
      for (const h of inBars(snares, from, to)) if (onGrid(h.beat / 2, 1)) fold.add({ beat: h.beat, pitch: 60 })
    }
  }

  // ---------------------------------------------------------------- the Composite: a portal into every section
  const cuts = p.main().track('Cuts', { instrument: 'innuendo.portal', params: { beats: 2, warpBeats: 4 } })
  cuts.clear()
  for (const [name, from, to] of SECTIONS) {
    const plan = planFor(name)
    cuts.cue(bar(from), plan.scene, bar(to - from))
    cuts.add(plan.style.map((pitch) => ({ beat: bar(from), pitch })))
  }
  p.ensureBars(131)
}

