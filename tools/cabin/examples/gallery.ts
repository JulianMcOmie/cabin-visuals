// A worked example of an edit script: builds a small gallery of the innuendo
// pack - three scenes and portal cuts between them - entirely from code.
//
//   ./cabin new gallery --bpm 148 --bars 24
//   ./cabin run gallery tools/cabin/examples/gallery.ts
//   ./cabin shot gallery --at 2,6,10.5,14,18 --sheet
//
// Everything is absolute beats: p.bar(n) is the downbeat of bar n (0-based).

import type { Cabin } from '../lib/api'

const F_SHARP_MINOR = [54, 56, 57, 59, 61, 62, 64, 66] // F#3 G#3 A3 B3 C#4 D4 E4 F#4
const ROOTS = [2, 11, 6, 1] // D, B, F#, C#: two bars each

export default function gallery(p: Cabin) {
  // a fresh project comes with an empty "Scene 1"; this gallery names its own
  if (p.scenes().some((s) => s.name === 'Scene 1')) p.removeScene('Scene 1')
  p.sections = [
    { name: 'signal', from: 0, to: 8 },
    { name: 'plate', from: 8, to: 16 },
    { name: 'pen', from: 16, to: 24 },
  ]

  // ---------------------------------------------------------------- Signal: the vocabulary
  const signal = p.scene('Signal', { background: '#05060a' })
  const line = signal.track('Hairline', { instrument: 'innuendo.hairline' })
  const orb = signal.track('Orb', { instrument: 'innuendo.orb', params: { radius: 0.8 } })
  const ring = signal.track('Steps', { instrument: 'innuendo.step-ring', params: { radius: 1.5 } })
  const stars = signal.track('Harmony', { instrument: 'innuendo.fifths', params: { radius: 2.3 } })
  const blades = signal.track('Snare', { instrument: 'innuendo.blades' })
  const voice = signal.track('Voice', { instrument: 'innuendo.glyphs', params: { size: 0.45 } })
  for (const t of [line, orb, ring, stars, blades, voice]) t.clear()
  line.add({ beat: 0, pitch: 72, dur: 0.5 })                          // draw on
  line.add({ beat: p.bar(1.5), pitch: 70, dur: p.bar(0.5) })          // curl, briefly
  for (let b = 0; b < 8; b++) {
    const bar = p.bar(b)
    for (let q = 0; q < 4; q++) {
      line.add({ beat: bar + q, pitch: q % 2 ? 62 : 60, vel: 90 })
      orb.add({ beat: bar + q, pitch: 60, vel: q === 0 ? 120 : 90 })
    }
    for (let s = 0; s < 16; s += 2) ring.add({ beat: bar + s / 4, pitch: 60, vel: s % 4 === 0 ? 110 : 70 })
    blades.hits([bar + 1, bar + 3], 60, 0.25, 100)
    orb.add({ beat: bar, pitch: 64 })                                  // next shape every bar
    const root = 48 + ROOTS[Math.floor(b / 2) % 4]
    stars.add([{ beat: bar, pitch: root, dur: 2 }, { beat: bar, pitch: root + 3, dur: 2 }, { beat: bar, pitch: root + 7, dur: 2 }])
    voice.add({ beat: bar + 0.5, pitch: F_SHARP_MINOR[(b * 3) % 8], dur: 1 })
    voice.add({ beat: bar + 2.5, pitch: F_SHARP_MINOR[(b * 3 + 4) % 8], dur: 1.2 })
  }

  // ---------------------------------------------------------------- Plate: Chladni sand in a kaleidoscope
  const plate = p.scene('Plate', { background: '#0b0c2a' })
  const sand = plate.track('Sand', { instrument: 'innuendo.chladni', params: { upright: true, size: 1.6, plate: 1 } })
  const fold = plate.track('Fold', { instrument: 'innuendo.mirror', params: { mode: 2, segments: 8, zoom: 1.9 } })
  sand.clear(); fold.clear()
  for (let b = 8; b < 16; b++) {
    const bar = p.bar(b)
    if (b % 2 === 0) sand.add({ beat: bar, pitch: 48 + ROOTS[((b - 8) / 2) % 4], dur: 0.5 })
    else sand.add({ beat: bar, pitch: 66, dur: 0.5 })                  // climb a harmonic on the second bar
    for (let q = 0; q < 4; q++) sand.add({ beat: bar + q, pitch: 62, vel: 70 })
    sand.add({ beat: bar + 2, pitch: 64, dur: 1.5, vel: 90 })            // shiver
    fold.hits([bar + 1, bar + 3], 60)
  }
  sand.add({ beat: p.bar(8), pitch: 60, vel: 127 })                      // the blast on the drop

  // ---------------------------------------------------------------- Pen: a melody drawing itself
  const penScene = p.scene('Pen', { background: '#000207' })
  const pen = penScene.track('Pen', { instrument: 'innuendo.pen', params: { phrase: 4 } })
  pen.clear()
  const melody = [0, 2, 4, 2, 5, 4, 2, 7, 6, 4, 2, 0, 4, 5, 7, 4]
  melody.forEach((deg, i) => pen.add({ beat: p.bar(16) + i * 2, pitch: F_SHARP_MINOR[deg], dur: 1.6, vel: 100 }))

  // ---------------------------------------------------------------- the Composite: portal cuts
  const cuts = p.main().track('Cuts', { instrument: 'innuendo.portal' })
  cuts.clear()
  cuts.cue(0, 'Signal', 1)
  cuts.cue(p.bar(8), 'Plate', 1)
  cuts.add([{ beat: p.bar(8), pitch: 47 }, { beat: p.bar(8), pitch: 38 }])  // warp through a square
  cuts.cue(p.bar(16), 'Pen', 1)
  cuts.add({ beat: p.bar(16), pitch: 36 })                                    // circle portal

  p.ensureBars(24)
}
