import { doc, track, block, n, pulse, arp, hits, every } from './builder'
import type { ProjectDocument } from '../persistence/types'

// The template library. Each template is a complete v2 project document tuned
// around each instrument's actual pitch vocabulary (Stars 48=warp/57=pulse,
// WindowsXP 36-59=window-spawn melody, DotField 36-47=bass shake, etc.) — not
// arbitrary notes. All patterns are written out in full (Block.loop is inert).
// One full-frame instrument per template at most; positioned objects layer on top.

export interface TemplateDef {
  id: string
  name: string
  description: string
  bpm: number
  /** Gallery card backdrop. */
  gradient: [string, string]
  document: ProjectDocument
}

const BARS = 16
const BEATS = BARS * 4

// ------------------------------------------------------------- Retro Desktop
// Windows XP nostalgia: windows spawn to a melody, file icons rain while
// folders fly past, the screen shakes at the phrase turnarounds.
const retroDesktop: TemplateDef = {
  id: 'retro-desktop',
  name: 'Retro Desktop',
  description: 'XP nostalgia — windows pop to the melody, folders fly, the screen shakes.',
  bpm: 120,
  gradient: ['#0058ee', '#3a9d3f'],
  document: doc({
    bpm: 120,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Desktop',
        instrumentId: 'windowsXp',
        color: '#38bdf8',
        params: { driftSpeed: 600, springAnim: 1, spawnX: 0.6 },
        blocks: [block(0, BARS, [
          n(0, 26, 0.25, 100), // wallpaper tint
          ...every(16, BEATS, hits([ // window-spawn melody (36-59 range)
            [0, 48, 0.5], [2, 52, 0.5], [4, 55, 0.5], [6, 52, 0.5],
            [8, 57, 0.5], [10, 55, 0.5], [12, 52, 0.5], [14, 48, 0.5],
          ])),
          ...every(16, BEATS, hits([[4, 64, 3], [12, 67, 3]])), // held icon rains
          n(30, 72, 0.25, 120), n(62, 72, 0.25, 120),           // screen shake
        ])],
      }),
      track({
        name: 'Folder Flight',
        instrumentId: 'folderFlight',
        color: '#f7d774',
        params: { speed: 22, iconScale: 1.6, ySpread: 5, tumble: 1.5 },
        blocks: [block(0, BARS, arp([60, 62, 64, 65, 67, 69, 71, 69], 1, BEATS, { vel: 100 }))],
      }),
    ],
  }),
}

// ------------------------------------------------------------------ Hyperspeed
// 172 BPM DnB: dot field shaking on a held-note bassline, spirograph shapes
// strafing past on 16th-note runs, camera punching with the kick/snare.
const hyperspeed: TemplateDef = {
  id: 'hyperspeed',
  name: 'Hyperspeed',
  description: 'DnB energy — a particle field shakes on the bass while shapes strafe past.',
  bpm: 172,
  gradient: ['#06b6d4', '#f43f5e'],
  document: doc({
    bpm: 172,
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

// --------------------------------------------------------------- Minimal Pulse
// Stripped-back techno: metronome ball patterns nudged by the kick, and a
// single cube that shatters on the off-beats via its ability lane.
const minimalPulse: TemplateDef = {
  id: 'minimal-pulse',
  name: 'Minimal Pulse',
  description: 'Stripped techno — metronome geometry and one cube that shatters on cue.',
  bpm: 126,
  gradient: ['#334155', '#94a3b8'],
  document: doc({
    bpm: 126,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Metronome',
        instrumentId: 'metronomeBalls',
        color: '#94a3b8',
        params: { balls: 28, speed: 2.2, dotSize: 2.2 },
        blocks: [block(0, BARS, [
          n(0, 60, 0.25, 100),                            // midnight palette
          ...pulse(48, 4, BEATS, { vel: 100, dur: 0.2 }),  // fg pattern nudge
          ...pulse(50, 8, BEATS, { offset: 4, vel: 90, dur: 0.2 }), // bg flower nudge
          n(32, 56, 0.25, 110),                            // invert swap
        ])],
      }),
      track({
        name: 'Cube',
        instrumentId: 'cube',
        color: '#6366f1',
        params: { baseSize: 2, spinSpeed: 0.8, baseHue: 200 },
        blocks: [block(0, BARS, [])],
        children: [
          {
            name: 'Shatter',
            instrumentId: '',
            type: 'ability',
            abilityKey: 'shatter',
            color: '#f472b6',
            blocks: [block(0, BARS, pulse(60, 4, BEATS, { offset: 2, vel: 115, dur: 0.5 }))],
          },
        ],
      }),
    ],
  }),
}

export const TEMPLATES: TemplateDef[] = [
  hyperspeed,
  retroDesktop,
  minimalPulse,
]
