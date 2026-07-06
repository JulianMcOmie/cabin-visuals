import { doc, track, block, n, pulse, arp, hits, every } from './builder'
import type { ProjectDocument } from '../persistence/types'

// The template library. Each template is a complete v2 project document tuned
// around each instrument's actual pitch vocabulary (Stars 48=warp/57=pulse,
// BeatParticleKit GM-style drums at 36/38/39/42, DiamondLattice 25=neon
// palette / 39/40=spread/swell toggles, Square 37-40=movement, etc.) — not
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

// ---------------------------------------------------------------- Neon Drive
// Synthwave: purple starfield with a ground plane, cylinder shapes flying at
// the camera on an arp, a bass ring pulsing pitch-colored waves, camera punch.
const neonDrive: TemplateDef = {
  id: 'neon-drive',
  name: 'Neon Drive',
  description: 'Synthwave flight over a purple grid — arps fly at you, bass rings pulse.',
  bpm: 100,
  gradient: ['#7c3aed', '#ec4899'],
  document: doc({
    bpm: 100,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Night Sky',
        instrumentId: 'stars',
        color: '#7c3aed',
        params: { ground: 1, tint: 260, speed: 3, starCount: 1800, drift: 0.15, dotSize: 2.2 },
        stringParams: { bgColor: '#0b0518', groundColor: '#6d28d9' },
        blocks: [block(0, BARS, [
          n(0, 48, 0.5, 110), n(16, 48, 0.5, 110), n(32, 48, 0.5, 120), n(48, 48, 0.5, 110), // warp forward
          n(30, 57, 0.5, 100), n(62, 57, 0.5, 110), // radial pulse
          n(32, 59, 0.25, 100), // streak toggle
        ])],
      }),
      track({
        name: 'Neon Arp',
        instrumentId: 'cylinderFlight',
        color: '#ec4899',
        params: { speed: 14, spread: 2.5, baseHue: 0.85, hueStep: 0.05, saturation: 0.9, shapePitch: 48, segments: 12 },
        blocks: [block(0, BARS, arp([60, 64, 67, 71, 67, 64], 0.5, BEATS, { vel: 100 }))],
      }),
      track({
        name: 'Bass Ring',
        instrumentId: 'particleBassRing',
        color: '#f472b6',
        params: { colorMode: 1, whiteBackground: 0, innerRadius: 1.2, outerRadius: 2.6, dotSize: 7 },
        blocks: [block(0, BARS, every(8, BEATS, hits([
          [0, 36, 1.5, 110], [2, 36, 0.5, 90], [3, 43, 1, 100], [5, 41, 1.5, 100],
        ])))],
      }),
      track({
        name: 'Camera Punch',
        instrumentId: 'cameraControl',
        color: '#a78bfa',
        params: { punchAmount: 0.5, punchDecay: 0.4, posZ: 6 },
        blocks: [block(0, BARS, pulse(60, 2, BEATS, { vel: 70, dur: 0.1 }))],
      }),
    ],
  }),
}

// ---------------------------------------------------------------- Club Pulse
// Four-on-the-floor house: the particle drum kit plays a real beat, shells
// burst on downbeats, a hexagon of dots cycles with the kick.
const clubPulse: TemplateDef = {
  id: 'club-pulse',
  name: 'Club Pulse',
  description: 'Four-on-the-floor house kit — particle drums, bursting shells, cycling grid.',
  bpm: 124,
  gradient: ['#f59e0b', '#ef4444'],
  document: doc({
    bpm: 124,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Drum Kit',
        instrumentId: 'beatParticleKit',
        color: '#f59e0b',
        params: { colorMode: 1, detail: 2.5, dotSize: 8 },
        blocks: [block(0, BARS, [
          ...pulse(36, 1, BEATS, { vel: 120, dur: 0.2 }),          // kick, every beat
          ...pulse(42, 1, BEATS, { offset: 0.5, vel: 85, dur: 0.1 }), // offbeat hats
          ...pulse(38, 2, BEATS, { offset: 1, vel: 105, dur: 0.2 }),  // snare on 2 & 4
          ...pulse(39, 4, BEATS, { offset: 3, vel: 95, dur: 0.2 }),   // clap pickup
          ...pulse(48, 8, BEATS, { vel: 100, dur: 1 }),               // chord flash
        ])],
      }),
      track({
        name: 'Shell Bursts',
        instrumentId: 'icosahedronBurst',
        color: '#ef4444',
        params: { expansionSpeed: 6, maxSize: 9, baseHue: 0.55, hueStep: 0.12 },
        blocks: [block(0, BARS, [
          ...pulse(60, 4, BEATS, { vel: 110, dur: 0.3 }),
          ...pulse(64, 8, BEATS, { offset: 6, vel: 90, dur: 0.3 }),
        ])],
      }),
      track({
        name: 'Dot Cycle',
        instrumentId: 'circleGrid',
        color: '#fbbf24',
        params: { rows: 6, cols: 6, layout: 4, toggleMode: 1, baseHue: 0.6, spacing: 1.2, dotSize: 0.8 },
        blocks: [block(0, BARS, pulse(60, 1, BEATS, { vel: 90, dur: 0.2 }))],
      }),
    ],
  }),
}

// ---------------------------------------------------------------- Deep Space
// Slow ambient drift: dense starfield, a Hopf fibration reshaping itself every
// two bars (add layer / Dehn twist / scale burst), a distant blue sun.
const deepSpace: TemplateDef = {
  id: 'deep-space',
  name: 'Deep Space',
  description: 'Ambient drift — a fibration folds itself in slow motion past a blue star.',
  bpm: 80,
  gradient: ['#1e3a8a', '#0e7490'],
  document: doc({
    bpm: 80,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Starfield',
        instrumentId: 'stars',
        color: '#38bdf8',
        params: { starCount: 2400, speed: 0.6, drift: 0.3, tint: 210, dotSize: 2.5 },
        stringParams: { bgColor: '#05060f' },
        blocks: [block(0, BARS, [
          n(0, 48, 0.5, 80),   // gentle warp in
          n(24, 56, 0.5, 70),  // tumble
          n(48, 57, 0.5, 90),  // radial pulse
          n(56, 58, 0.5, 100), // brake
        ])],
      }),
      track({
        name: 'Fibration',
        instrumentId: 'hopfFibration',
        color: '#818cf8',
        params: { coreWidth: 2, glowWidth: 12, fibersPerLayer: 12, rotationSpeed: 0.12, projScale: 1.8 },
        blocks: [block(0, BARS, hits([
          [0, 50, 1, 90],   // add torus layer
          [8, 55, 1, 90],   // Dehn twist
          [16, 57, 1, 100], // scale burst
          [24, 52, 1, 80],  // invert projection
          [32, 50, 1, 90],  // add layer
          [40, 55, 1, 95],  // Dehn twist
          [48, 58, 1, 90],  // hue rotation
          [56, 57, 1, 110], // scale burst
        ]))],
      }),
      track({
        name: 'Blue Star',
        instrumentId: 'sun',
        color: '#22d3ee',
        params: { size: 7, z: -18, baseHue: 0.62, intensity: 1.2, turbulence: 0.5, speed: 0.3, coronaSize: 0.6 },
        blocks: [block(0, BARS, [
          n(16, 48, 0.5, 70), n(48, 48, 0.5, 70), // white-hot flash
          n(32, 49, 0.5, 100),                    // color pulse
        ])],
      }),
    ],
  }),
}

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

// ---------------------------------------------------------- Sacred Geometry
// Slow kaleidoscope: a breathing diamond lattice driven by palette + toggle
// pitches, harmonograph curves jittering melodically, hexagon dot pulses.
const sacredGeometry: TemplateDef = {
  id: 'sacred-geometry',
  name: 'Sacred Geometry',
  description: 'A breathing kaleidoscope — lattice layers, harmonograph curves, slow pulses.',
  bpm: 90,
  gradient: ['#8b5cf6', '#22d3ee'],
  document: doc({
    bpm: 90,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Lattice',
        instrumentId: 'diamondLattice',
        color: '#8b5cf6',
        params: { colorScheme: 1, symmetry: 8, numLayers: 4, swingDeg: 45, rotSpeed: 15, breathAmount: 40, glowAmount: 40 },
        blocks: [block(0, BARS, [
          n(0, 25, 0.25, 100),                          // neon palette
          ...pulse(36, 2, BEATS, { vel: 110, dur: 0.2 }), // kick-driven arm swings
          n(16, 39, 0.25, 100),                          // spread toggle
          n(32, 40, 0.25, 100),                          // swell toggle
          n(48, 42, 0.25, 110),                          // spawn new layer
        ])],
      }),
      track({
        name: 'Harmonograph',
        instrumentId: 'neonPolar',
        color: '#7dd3fc',
        params: { speed: 1.2, cycles: 10, lineWidth: 2, complexity: 1.2, opacity: 0.85 },
        stringParams: { color: '#7dd3fc' },
        blocks: [block(0, BARS, arp([48, 53, 55, 58, 55, 53], 2, BEATS, { vel: 90, dur: 1.5 }))],
      }),
      track({
        name: 'Hex Pulse',
        instrumentId: 'hexagonDots',
        color: '#4ecdc4',
        params: { dotSpeed: 3, dotSize: 0.18 },
        blocks: [block(0, BARS, pulse(50, 2, BEATS, { offset: 1, vel: 90, dur: 0.3 }))],
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

// ----------------------------------------------------------------- Golden Hour
// Chill sunset: a warm sun over a dusk starfield, particle risers climbing on
// chord tones, soft hexagon pulses.
const goldenHour: TemplateDef = {
  id: 'golden-hour',
  name: 'Golden Hour',
  description: 'Sunset chill — risers climb chord tones past a warm, breathing sun.',
  bpm: 95,
  gradient: ['#f97316', '#fbbf24'],
  document: doc({
    bpm: 95,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Dusk Sky',
        instrumentId: 'stars',
        color: '#fb923c',
        params: { starCount: 1200, speed: 0.4, tint: 35, drift: 0.1, dotSize: 1.8 },
        stringParams: { bgColor: '#12060b' },
        blocks: [block(0, BARS, [])],
      }),
      track({
        name: 'Sun',
        instrumentId: 'sun',
        color: '#f97316',
        params: { size: 6, z: -12, baseHue: 0.06, intensity: 1.6, coronaSize: 0.8, turbulence: 0.9, speed: 0.4 },
        blocks: [block(0, BARS, [
          n(0, 48, 0.5, 60), n(32, 48, 0.5, 60),   // gentle flashes
          n(16, 49, 0.5, 90), n(48, 49, 0.5, 90),  // color pulses
        ])],
      }),
      track({
        name: 'Risers',
        instrumentId: 'particleRiser',
        color: '#fbbf24',
        params: { riseSpeed: 0.18, duration: 8, colorMode: 0, particleCount: 4000, startY: -5, endY: 5 },
        blocks: [block(0, BARS, every(16, BEATS, hits([
          [0, 48, 4, 90], [4, 52, 4, 80], [8, 55, 4, 85], [12, 60, 4, 95],
        ])))],
      }),
      track({
        name: 'Soft Pulse',
        instrumentId: 'hexagonDots',
        color: '#fde68a',
        params: { dotSpeed: 2.5, dotSize: 0.14 },
        blocks: [block(0, BARS, pulse(52, 4, BEATS, { offset: 2, vel: 70, dur: 0.5 }))],
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

// ------------------------------------------------------------------- Word Play
// Lyric-video starter: big text advancing word by word with bass pops, over a
// slow silk-symmetry weave.
const wordPlay: TemplateDef = {
  id: 'word-play',
  name: 'Word Play',
  description: 'Lyric-video starter — words advance on the beat over flowing silk curves.',
  bpm: 110,
  gradient: ['#e2e8f0', '#64748b'],
  document: doc({
    bpm: 110,
    totalBars: BARS,
    tracks: [
      track({
        name: 'Silk Weave',
        instrumentId: 'silkSymmetry',
        color: '#8b5cf6',
        params: { symmetryFolds: 8, lineCount: 12, globalSpeed: 0.25, baseHue: 0.65, hueRange: 0.25 },
        blocks: [block(0, BARS, pulse(60, 16, BEATS, { vel: 80, dur: 0.5 }))], // direction flips per phrase
      }),
      track({
        name: 'Lyrics',
        instrumentId: 'textDisplay',
        color: '#e2e8f0',
        params: { fontSize: 1.4, heightAmount: 0.3, onsetBounce: 0.12 },
        stringParams: { text: 'MAKE MUSIC YOU CAN SEE', color: '#ffffff', strokeColor: '#1e1b4b' },
        blocks: [block(0, BARS, [
          ...pulse(48, 4, BEATS, { vel: 100, dur: 0.3 }),            // next word each bar
          ...pulse(47, 8, BEATS, { offset: 2, vel: 110, dur: 0.3 }), // bass pop punch
        ])],
      }),
    ],
  }),
}

export const TEMPLATES: TemplateDef[] = [
  neonDrive,
  clubPulse,
  deepSpace,
  hyperspeed,
  goldenHour,
  sacredGeometry,
  retroDesktop,
  minimalPulse,
  wordPlay,
]
