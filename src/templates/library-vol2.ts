import { doc, track, block, pulse, arp, hits, every } from './builder'
import type { TemplateDef } from './library'

// Volume 2: the Retro Arcade theme template (sole survivor of the big agent
// batch). Its pattern is written against the instruments' exact pitch
// vocabularies (see docs/instrument-note-semantics.md) - pitch numbers here
// are commands, not arbitrary notes.

const BARS = 16
const BEATS = BARS * 4

// ----------------------------------------------------------------- Retro Arcade
export const retroArcade: TemplateDef = {
  id: 'retro-arcade',
  name: 'Retro Arcade',
  description: 'Invaders zapped in rhythm on a humming CRT while the score spins up.',
  bpm: 130,
  gradient: ['#39ff14', '#ff004d'],
  document: doc({
    bpm: 130,
    totalBars: BARS,
    tracks: [
      track({
        name: 'CRT', instrumentId: 'crtScanlines', color: '#3aff8c',
        blocks: [block(0, BARS, [
          ...pulse(60, 4, BEATS, { vel: 80, dur: 0.25 }),
          ...every(16, BEATS, hits([[15, 74, 0.5, 110]])), // static blip
        ])],
      }),
      track({
        name: 'Invaders', instrumentId: 'pixelInvaders', color: '#39ff14',
        blocks: [block(0, BARS, arp([60, 62, 64, 61, 63, 65], 1, BEATS, { vel: 100, dur: 0.25 }))],
      }),
      track({
        name: 'Pong', instrumentId: 'paddleBounce', color: '#22d3ee',
        blocks: [block(0, BARS, every(8, BEATS, hits([[0, 48, 0.5, 90], [4, 72, 0.5, 115]])))],
      }),
      track({
        name: 'Blasts', instrumentId: 'pixelBlast', color: '#ffec27',
        blocks: [block(0, BARS, every(4, BEATS, hits([[2, 55, 0.25, 105], [3.5, 67, 0.25, 85]])))],
      }),
      track({
        name: 'Score', instrumentId: 'scoreTicker', color: '#facc15',
        blocks: [block(0, BARS, every(8, BEATS, hits([[1, 64, 0.5, 90], [6, 76, 0.5, 115]])))],
      }),
    ],
  }),
}
