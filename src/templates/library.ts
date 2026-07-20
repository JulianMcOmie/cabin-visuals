import { doc, track, block, every, hits } from './builder'
import type { ProjectDocument } from '../persistence/types'

// The template library. Each template is a complete v2 project document tuned
// around each instrument's actual pitch vocabulary (DotField 36-47=bass shake,
// ShapeFlight ~52-64 spawns, CameraControl 36=punch/38=shake) - not arbitrary
// notes. All patterns are written out in full (no loop: true blocks).
// One full-frame instrument per template at most; positioned objects layer on top.

export interface TemplateDef {
  id: string
  name: string
  description: string
  bpm: number
  /** How the gallery card previews this template. 'video' (default) plays a
   *  captured clip of its real render; the 'animated*' values use bespoke
   *  canvas animations instead - Slideshow's real render is blank until the
   *  user adds photos, and the lyric templates read better as a live word-pop
   *  than a canned capture. 'animated*' templates are skipped by the
   *  preview-capture script. */
  cardPreview?: 'video' | 'animatedSlideshow' | 'animatedLyric'
  document: ProjectDocument
}

const BARS = 16
const BEATS = BARS * 4

// ------------------------------------------------------------------ Hyperspeed
// 172 BPM DnB: dot field shaking on a held-note bassline, spirograph shapes
// strafing past on 16th-note runs, camera punching with the kick/snare.
const hyperspeed: TemplateDef = {
  id: 'hyperspeed',
  name: 'Hyperspeed',
  description: 'DnB energy - a particle field shakes on the bass while shapes strafe past.',
  bpm: 120,
  document: doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Dot Field',
        instrumentId: 'dotField',
        color: '#38bdf8',
        params: { particleCount: 1200, dotSize: 7, intensity: 3, colorMode: 1, activeEffects: 4 },
        blocks: [block(0, BARS, every(8, BEATS, hits([ // bass shake range is 36-47
          [0, 38, 1.5, 120], [2, 38, 0.5, 90], [3.5, 41, 1, 110], [5, 36, 2, 120], [7.5, 43, 0.5, 100],
        ])))],
      }),
      track({
        name: 'Shape Runs',
        instrumentId: 'shapeFlight',
        color: '#f43f5e',
        params: { shapeMode: 0, speed: 32, spawnRate: 14, farZ: 60, baseHue: 0.55, hueStep: 0.1, glowAmount: 2, shapeSize: 0.5 },
        blocks: [block(0, BARS, every(4, BEATS, hits([
          [0, 57, 0.25, 110], [0.25, 60, 0.25, 90], [0.5, 64, 0.25, 100], [1, 52, 0.25, 95],
          [2, 57, 0.25, 110], [2.5, 62, 0.25, 90], [3, 55, 0.25, 95], [3.5, 59, 0.25, 100],
        ])))],
      }),
      track({
        name: 'Camera Kick',
        instrumentId: 'cameraControl',
        color: '#a78bfa',
        params: { punchAmount: 1, punchDecay: 0.3, shakeAmount: 3 },
        blocks: [block(0, BARS, every(4, BEATS, hits([ // two-step kick/snare
          [0, 36, 0.1, 120], [1, 38, 0.1, 100], [2.5, 36, 0.1, 110], [3, 38, 0.1, 100],
        ])))],
      }),
    ],
  }),
}

export const TEMPLATES: TemplateDef[] = [
  hyperspeed,
]
