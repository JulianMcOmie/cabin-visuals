'use client'

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Folder, Plus, Sparkles, LayoutTemplate, Repeat, Shapes } from 'lucide-react'
import { useLibraryDrag } from './useLibraryDrag'
import { useLoopBlockDrag } from './useLoopBlockDrag'
import { LOOP_PATTERNS, type LoopPattern } from './loops'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { listMoverOrSplitterDefinitions } from '../core/visualCopies/registry'
import { listCompositionInstruments } from '../core/directors'
import { canPreview, InstrumentCardPreview, InstrumentCardPreviewCanvas, InstrumentPreviewLayer } from './InstrumentHoverPreview'
import { TEMPLATES, LISTED_TEMPLATES, LYRIC_STYLES, isLyricTemplateId } from '../../templates'
import { TemplatePreviewVideo } from '../../components/TemplatePreviewVideo'
import { TemplateSlideshowPreview } from '../../components/TemplateSlideshowPreview'
import { TemplateLyricPreview } from '../../components/TemplateLyricPreview'
import { track as trackEvent } from '../../analytics/analytics'
import { waitForSaved } from '../../persistence/autosave'
import { LoadingScreen } from '../../components/LoadingScreen'

/** What dragging an item creates. */
export type LibraryKind = 'object' | 'modulator' | 'mover' | 'splitter' | 'colorizer' | 'director'

export interface InstrumentItem {
  id: string
  name: string
  /** One tooltip sentence: what it looks like and what notes do to it. */
  description: string
  icon: React.ReactNode
  kind: LibraryKind
}

const withKind = (kind: LibraryKind, items: Omit<InstrumentItem, 'kind'>[]): InstrumentItem[] =>
  items.map((i) => ({ ...i, kind }))

// Scene-wide instruments: the camera, full-frame media, and whole-scene
// effects. Ordinary object instruments - only the grouping differs. The
// folders below claim them by id (Camera → Impact, Video → Utility, ...).
const SCENE_INSTRUMENTS = withKind('object', [
  { id: 'cameraControl', name: 'Camera', description: 'Drives the scene camera - each note punches a dolly-in and a shake.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="3.5" width="7.5" height="5.5" rx="1" fill="none" stroke="#818cf8" strokeWidth="1" />
      <path d="M8.5 5.3 L11 4 V8.5 L8.5 7.2 Z" fill="none" stroke="#818cf8" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="4.5" cy="6.25" r="1.4" fill="none" stroke="#818cf8" strokeWidth="1" />
    </svg>
  )},
  { id: 'cameraOrbit', name: 'Camera Orbit', description: 'Circles the camera around a point it never stops looking at - hold a note to swing, tilt, or come home.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <ellipse cx="6" cy="7" rx="4.6" ry="2.1" fill="none" stroke="#818cf8" strokeWidth="1" />
      <circle cx="6" cy="7" r="1.1" fill="none" stroke="#818cf8" strokeWidth="1" />
      <rect x="8.2" y="1.6" width="3.2" height="2.6" rx="0.7" fill="none" stroke="#818cf8" strokeWidth="1" />
      <path d="M8.2 3 L7 5.9" fill="none" stroke="#818cf8" strokeWidth="0.9" strokeDasharray="1.4 1.1" />
    </svg>
  )},
  { id: 'video', name: 'Video', description: 'Plays your uploaded video clips full-frame - each note cuts to a clip.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="2.5" width="10" height="7" rx="1" fill="none" stroke="#f472b6" strokeWidth="1.1" />
      <path d="M5 4.8 L7.6 6 L5 7.2 Z" fill="#f472b6" />
    </svg>
  )},
  { id: 'photo', name: 'Photo', description: 'Shows your uploaded photos full-frame - each note cuts to a photo.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="2.5" width="10" height="7" rx="1" fill="none" stroke="#f472b6" strokeWidth="1.1" />
      <circle cx="4" cy="5" r="1" fill="#f472b6" />
      <path d="M2 8.5 L4.8 5.8 L6.5 7.2 L8 6 L10 8.5 Z" fill="#f472b6" />
    </svg>
  )},
  { id: 'textDisplay', name: 'Text Display', description: 'Shows words across the screen, advancing one per note.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <text x="6" y="9.5" fontSize="11" fontWeight="900" fontFamily="Arial Black, sans-serif" textAnchor="middle" fill="#818cf8">T</text>
    </svg>
  )},
  { id: 'oscilloscope', name: 'Oscilloscope', description: 'Draws the mixed audio output as a live full-screen waveform.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M0.5 6 H2.2 L3.2 2.5 L4.7 9.5 L6.2 4 L7.5 7.5 L8.7 5 H11.5" fill="none" stroke="#22d3ee" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )},
  { id: 'bassRipple', name: 'Bass Ripple', description: 'Warps the whole scene through a drifting noise field while its MIDI note is held.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M0.5 3.5 Q3 1.5 6 3.5 T11.5 3.5" fill="none" stroke="#a78bfa" strokeWidth="1" />
      <path d="M0.5 6 Q3 4 6 6 T11.5 6" fill="none" stroke="#a78bfa" strokeWidth="1" />
      <path d="M0.5 8.5 Q3 6.5 6 8.5 T11.5 8.5" fill="none" stroke="#a78bfa" strokeWidth="1" />
    </svg>
  )},
  { id: 'impactWarp', name: 'Impact Warp', description: 'Punches the whole scene on every MIDI hit — zoom slam, shockwave, sideways shove or torn slabs — then lets it recover.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="4" y="4" width="4" height="4" rx="0.5" fill="none" stroke="#ff6a00" strokeWidth="1.1" />
      <path d="M3.1 3.1 L0.8 0.8M8.9 3.1 L11.2 0.8M3.1 8.9 L0.8 11.2M8.9 8.9 L11.2 11.2" fill="none" stroke="#ff6a00" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )},
  { id: 'colorFilters', name: 'Color Filters', description: 'Applies scene-wide color remaps while its labeled MIDI notes are held.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="4.2" cy="4.5" r="3" fill="none" stroke="#22d3ee" strokeWidth="1" />
      <circle cx="7.8" cy="4.5" r="3" fill="none" stroke="#f472b6" strokeWidth="1" />
      <circle cx="6" cy="7.7" r="3" fill="none" stroke="#facc15" strokeWidth="1" />
    </svg>
  )},
  { id: 'strobe', name: 'Strobe', description: 'Flashes the whole scene on the beat grid — inverted, black or white — at the rate of whichever labeled MIDI row is held.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6.6 0.6 L2.6 6.4 H5.3 L4.6 11.4 L9.1 5.1 H6.2 Z" fill="#ffffff" />
    </svg>
  )},
])

const DIRECTOR_DESCRIPTIONS: Record<string, string> = {
  sceneSwitcher: 'Shows the most recently started scene row only while its MIDI note remains held.',
  cut: 'Partitions the frame between held scene rows, with straight or diagonal cuts.',
  radialCut: 'Partitions held scene rows into concentric rings from the center outward.',
  crop: 'Masks one scene into evenly spaced slices at any angle. Each held row shows its slice; the rest stays transparent.',
}

const DIRECTOR_ICON_COLORS: Record<string, string> = {
  sceneSwitcher: 'text-indigo-400',
  cut: 'text-fuchsia-400',
  radialCut: 'text-cyan-400',
  crop: 'text-amber-400',
}

// Derived from the director registry, the same way MOVER_INSTRUMENTS below is
// derived from the mover registry - so registering a director is all it takes
// to make it reachable. (This list used to be hand-maintained, which meant a
// registered director simply never appeared in the menu.)
const DIRECTOR_INSTRUMENTS = withKind('director', listCompositionInstruments().map((d) => ({
  id: d.id,
  name: d.name,
  description: DIRECTOR_DESCRIPTIONS[d.id] ?? `Renders scene sources into Main with the ${d.name} layout.`,
  icon: <Sparkles size={12} className={DIRECTOR_ICON_COLORS[d.id] ?? 'text-indigo-400'} />,
})))

// Cut and Radial Cut are soft-deprecated: still fully working, but parked in a
// collapsed Extras folder below the curated list (Crop's angled slicing covers
// most of what they did). Same demote-don't-delete move as EXTRA_INSTRUMENTS.
const DIRECTOR_EXTRA_IDS = new Set(['cut', 'radialCut'])
const DIRECTOR_CORE = DIRECTOR_INSTRUMENTS.filter((d) => !DIRECTOR_EXTRA_IDS.has(d.id))
const DIRECTOR_EXTRAS = DIRECTOR_INSTRUMENTS.filter((d) => DIRECTOR_EXTRA_IDS.has(d.id))

// Every object instrument, icons and all. Partitioned below into the curated
// core list and the Extras back catalog - nothing is removed, only demoted.
const ALL_OBJECT_INSTRUMENTS = withKind('object', [
  { id: 'cube', name: '3D Shape', description: 'A solid - cube, sphere, tetrahedron and friends - that swells and glows with every note.', icon: <div className="w-3 h-3 border border-indigo-400 rounded-sm" /> },
  { id: 'kaleidoSolid', name: 'Kaleido Solid', description: 'A solid whose surface is a live kaleidoscope - shapes grow, drift and recolour, and every note twists the barrel.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5" fill="#0f766e" fillOpacity="0.35" stroke="#5eead4" strokeWidth="0.7" />
      <path d="M6 6 L6 1 A5 5 0 0 1 10.3 3.5 Z" fill="#fbbf24" fillOpacity="0.9" />
      <path d="M6 6 L10.3 8.5 A5 5 0 0 1 6 11 Z" fill="#f472b6" fillOpacity="0.9" />
      <path d="M6 6 L1.7 3.5 A5 5 0 0 1 6 1 Z" fill="#a78bfa" fillOpacity="0.75" />
    </svg>
  )},
  { id: 'laserSphere', name: 'Laser Sphere', description: 'A white-hot neon orb with HDR bloom and colored scene light.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="4.5" fill="#22d3ee" fillOpacity="0.18" stroke="#67e8f9" strokeWidth="0.8" />
      <circle cx="6" cy="6" r="2.2" fill="#cffafe" />
    </svg>
  )},
  { id: 'laserLine', name: 'Laser Line', description: 'A thin neon beam with a colored core and HDR edge bloom.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 6 H11" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" opacity="0.2" />
      <path d="M1 6 H11" stroke="#cffafe" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )},
  { id: 'icosahedronBurst', name: 'Icosahedron Burst', description: 'Each note spawns an expanding, fading wireframe shell.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6 1 L11 6 L6 11 L1 6 Z" fill="none" stroke="#22d3ee" strokeWidth="1.2" />
    </svg>
  )},
  { id: 'stars', name: 'Stars', description: 'A warp starfield - notes steer speed, drift, roll, and color.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#fbbf24">
        <circle cx="6" cy="6" r="1.4" /><circle cx="2" cy="2.5" r="0.8" /><circle cx="10" cy="3" r="0.7" />
        <circle cx="3" cy="9.5" r="0.7" /><circle cx="9.5" cy="9" r="0.9" /><circle cx="1.5" cy="6" r="0.5" /><circle cx="11" cy="6.5" r="0.5" />
      </g>
    </svg>
  )},
  { id: 'particleBurst', name: 'Particle Burst', description: 'Each note explodes particles outward - pitch picks the color.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#f59e0b">
        <circle cx="6" cy="6" r="1.4" /><circle cx="6" cy="1.5" r="0.8" /><circle cx="6" cy="10.5" r="0.8" /><circle cx="1.5" cy="6" r="0.8" /><circle cx="10.5" cy="6" r="0.8" />
        <circle cx="2.8" cy="2.8" r="0.7" /><circle cx="9.2" cy="2.8" r="0.7" /><circle cx="2.8" cy="9.2" r="0.7" /><circle cx="9.2" cy="9.2" r="0.7" />
      </g>
    </svg>
  )},
  { id: 'flashWall', name: 'Flash Wall', description: 'A screen-filling wall of light - each note flashes its own slice of the frame through an ADSR envelope.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="0.5" y="2" width="2.4" height="8" rx="0.6" fill="#8de1ff" fillOpacity="0.25" />
      <rect x="3.4" y="2" width="2.4" height="8" rx="0.6" fill="#8de1ff" fillOpacity="0.95" />
      <rect x="6.3" y="2" width="2.4" height="8" rx="0.6" fill="#8de1ff" fillOpacity="0.45" />
      <rect x="9.2" y="2" width="2.4" height="8" rx="0.6" fill="#8de1ff" fillOpacity="0.2" />
    </svg>
  )},
  { id: 'crop', name: 'Crop', description: 'Masks this scene into evenly spaced slices at any angle - each held row shows its slice, silence hides it. Check targets in its settings to mask specific instruments instead.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M3.2 1 H6.2 L4.4 11 H1.4 Z" fill="#fbbf24" fillOpacity="0.9" />
      <path d="M7.4 1 H10.4 L8.6 11 H5.6 Z" fill="#fbbf24" fillOpacity="0.35" />
    </svg>
  )},
  { id: 'waterDrop', name: 'Water Drop', description: 'Each note drops ink into water - pitch picks the height it spreads at.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6.5" r="2.4" fill="#2f8fff" fillOpacity="0.85" />
      <circle cx="2.4" cy="4.4" r="1.1" fill="#2f8fff" fillOpacity="0.5" />
      <circle cx="9.4" cy="8.4" r="1.2" fill="#2f8fff" fillOpacity="0.5" />
      <circle cx="9" cy="3.2" r="0.8" fill="#bff3ff" fillOpacity="0.8" />
      <circle cx="3.2" cy="9.4" r="0.7" fill="#bff3ff" fillOpacity="0.7" />
    </svg>
  )},
  { id: 'fractalTunnel', name: 'Fractal Tunnel', description: 'A fractal-flower tunnel - notes shift its hue and fire pulse rings.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="none" stroke="#8b5cf6" strokeWidth="1">
        <circle cx="6" cy="6" r="1.5" /><circle cx="6" cy="6" r="3.5" /><circle cx="6" cy="6" r="5.5" />
      </g>
    </svg>
  )},
  { id: 'neonPolar', name: 'Neon Polar', description: 'Drifting neon curves that jitter and speed up on held notes.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6 1 Q10 3 9 6 Q11 9 6 11 Q1 9 3 6 Q2 3 6 1 Z" fill="none" stroke="#22d3ee" strokeWidth="1" />
    </svg>
  )},
  { id: 'hopfFibration', name: 'Hopf Fibration', description: 'Nested neon tori of fibers - notes add layers, twist, and burst them.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#818cf8" strokeWidth="0.9">
      <ellipse cx="6" cy="6" rx="5" ry="2.2" /><ellipse cx="6" cy="6" rx="2.2" ry="5" /><circle cx="6" cy="6" r="4" />
    </svg>
  )},
  { id: 'shapeFlight', name: 'Shape Flight', description: 'Held notes stream spirograph shapes past the camera - pitch picks the shape.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#f59e0b" strokeWidth="1">
      <polygon points="6,1 10,6 6,11 2,6" /><polygon points="6,3.5 8,6 6,8.5 4,6" />
    </svg>
  )},
  { id: 'dotField', name: 'Dot Field', description: 'A field of dots rippled by notes - held bass notes shake it hardest.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#38bdf8">
        <circle cx="6" cy="6" r="1.1" /><circle cx="6" cy="2" r="0.8" /><circle cx="9.5" cy="4.5" r="0.8" /><circle cx="8.5" cy="8.5" r="0.8" /><circle cx="3.5" cy="8.5" r="0.8" /><circle cx="2.5" cy="4.5" r="0.8" />
      </g>
    </svg>
  )},
  { id: 'metronomeBalls', name: 'Metronome Balls', description: 'Pendulum lines of balls that swing and rotate on the beat.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="#94a3b8">
      <path d="M6 6 L10 3 M6 6 L2 3 M6 6 L3 10 M6 6 L9 10" stroke="#94a3b8" strokeWidth="0.6" fill="none" />
      <circle cx="6" cy="6" r="1" /><circle cx="10" cy="3" r="1" /><circle cx="2" cy="3" r="1" /><circle cx="3" cy="10" r="1" /><circle cx="9" cy="10" r="1" />
    </svg>
  )},
  { id: 'emojiDisplay', name: 'Emoji Display', description: 'A grid of emoji rearranged by notes - swaps, spins, and flips.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5.5" fill="#ffcc00" />
      <circle cx="4" cy="5" r="1" fill="#000" /><circle cx="8" cy="5" r="1" fill="#000" />
      <path d="M3.5 7.5 Q6 10 8.5 7.5" fill="none" stroke="#000" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )},
  { id: 'filmStock', name: 'Film Stock', description: 'A degraded-film background - grain, dust, flicker and vignette; notes fire burn flashes and scratches.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="1" width="10" height="10" rx="1" fill="#1a171b" stroke="#8a8590" strokeWidth="0.8" />
      <rect x="2.2" y="2.2" width="1" height="1" fill="#8a8590" /><rect x="8.8" y="2.2" width="1" height="1" fill="#8a8590" />
      <rect x="2.2" y="8.8" width="1" height="1" fill="#8a8590" /><rect x="8.8" y="8.8" width="1" height="1" fill="#8a8590" />
      <circle cx="5" cy="5.5" r="0.5" fill="#e8e4da" /><circle cx="7.5" cy="7" r="0.35" fill="#e8e4da" opacity="0.7" />
      <path d="M6.5 3 L6.2 4.6" stroke="#e8e4da" strokeWidth="0.4" opacity="0.6" />
    </svg>
  )},
  { id: 'filmGrain', name: 'Film Grain', description: 'An on-top film-wear overlay - grain, dust and vignette degrade everything beneath it.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="1" width="10" height="10" rx="1" fill="none" stroke="#8a8590" strokeWidth="0.8" strokeDasharray="2 1.2" />
      <g fill="#e8e4da">
        <circle cx="3.5" cy="4" r="0.5" /><circle cx="8" cy="3" r="0.4" /><circle cx="6" cy="6.5" r="0.55" />
        <circle cx="4" cy="8.5" r="0.4" /><circle cx="8.5" cy="8" r="0.5" /><circle cx="9.5" cy="5.5" r="0.3" />
      </g>
    </svg>
  )},
  { id: 'scribble', name: 'Scribble', description: 'Glowing hand-drawn pen strokes - notes draw swooshes, loops, and flourishes.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 8 Q4 11 6.5 8.5 Q9 6 7 5 Q5 4 6.5 2.5 Q8 1 11 3" fill="none" stroke="#87dcfb" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )},
  { id: 'filmCard', name: 'Film Card', description: 'Vintage intro/outro title cards - a paper playlist page or a glowing title over a waveform.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="2" width="10" height="8" rx="0.8" fill="#b5d9cc" stroke="#303820" strokeWidth="0.7" />
      <rect x="2.5" y="4.8" width="7" height="2.4" fill="none" stroke="#303820" strokeWidth="0.6" />
      <line x1="3.2" y1="6" x2="8.8" y2="6" stroke="#303820" strokeWidth="0.9" />
    </svg>
  )},
  { id: 'pixelBlast', name: 'Pixel Blast', description: 'Each note detonates chunky 8-bit particles - pitch sets position.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="5" y="5" width="2" height="2" fill="#ffec27"/><rect x="2" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="8.6" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="5.3" y="2" width="1.4" height="1.4" fill="#ff004d"/><rect x="5.3" y="8.6" width="1.4" height="1.4" fill="#ff004d"/><rect x="2.8" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="2.8" y="8.2" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="8.2" width="1" height="1" fill="#ffa300"/></svg>
  )},
  { id: 'wormhole', name: 'Wormhole', description: 'A flight down an endless noise-warped tunnel of points - each note lurches you forward.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5" fill="none" stroke="#22d3ee" strokeWidth="0.7" strokeOpacity="0.35" />
      <circle cx="6" cy="6" r="3.2" fill="none" stroke="#22d3ee" strokeWidth="0.8" strokeOpacity="0.65" />
      <circle cx="6" cy="6" r="1.5" fill="none" stroke="#a78bfa" strokeWidth="0.9" />
      <circle cx="6" cy="6" r="0.5" fill="#f0abfc" />
    </svg>
  )},
  { id: 'particleSphere', name: 'Particle Sphere', description: 'A shell of glowing dots wrapped on a sphere - notes poke and burst the shell apart, and it springs back.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
        const rad = (deg * Math.PI) / 180
        return <circle key={deg} cx={6 + Math.cos(rad) * 4.2} cy={6 + Math.sin(rad) * 4.2} r="0.9" fill="#f9a66c" />
      })}
      <circle cx="6" cy="6" r="1.1" fill="none" stroke="#f9a66c" strokeWidth="0.7" strokeOpacity="0.5" />
    </svg>
  )},
  { id: 'photoSlot', name: 'Photo Slot', description: 'A template photo slot: a region that cuts through your photo bank on MIDI, with a labeled placeholder color until you fill it.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="2.5" width="10" height="7" fill="#d800c8" stroke="#f4f4f4" strokeWidth="0.8" />
      <rect x="4.5" y="6" width="3" height="3.5" fill="#dc4a78" />
    </svg>
  )},
  { id: 'polyFx', name: 'Poly FX', description: 'Paper-edit overlay effects on MIDI rows: beam sweeps, union-jack pattern, flashes, streaks, and tabs.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 11 L11 1" stroke="#17c917" strokeWidth="2" />
      <path d="M1 1 L11 11" stroke="#9adfe0" strokeWidth="1.2" />
    </svg>
  )},
])

// The curated core: a few good shapes, kept deliberately short so the library
// reads as intentional. Everything else lives in the collapsed Extras section
// at the bottom - still available, out of the first impression.
// Circle and Triangle left the library outright - 3D Shape's geometry picker
// covers them (the instruments stay registered for old projects).
const CORE_OBJECT_IDS = new Set(['cube', 'kaleidoSolid', 'laserSphere', 'laserLine', 'shapeFlight', 'particleBurst'])
const OBJECT_INSTRUMENTS = ALL_OBJECT_INSTRUMENTS.filter((i) => CORE_OBJECT_IDS.has(i.id))

// The Instruments folder. These are object instruments like any other; what
// they share is that a note is a PERFORMANCE on them - each one spawns its own
// short-lived event rather than posing a standing shape - so they belong
// together rather than scattered through Objects and Extras.
const INSTRUMENT_FOLDER_IDS = new Set(['waterDrop', 'flashWall'])
const INSTRUMENT_FOLDER_ITEMS = ALL_OBJECT_INSTRUMENTS.filter((i) => INSTRUMENT_FOLDER_IDS.has(i.id))

// The in-scene Crop masks the whole scene while its rows are held - the
// sustained shape Rumble collects - but it is an object instrument outside the
// core pool, so the folder claims it directly (pick() cannot reach it).
const CROP_OBJECT_IDS = new Set(['crop'])
const CROP_OBJECT_ITEMS = ALL_OBJECT_INSTRUMENTS.filter((i) => CROP_OBJECT_IDS.has(i.id))

// Extras is the remainder: everything the curated folders above did not claim.
const EXTRA_INSTRUMENTS = ALL_OBJECT_INSTRUMENTS.filter(
  (i) => !CORE_OBJECT_IDS.has(i.id) && !INSTRUMENT_FOLDER_IDS.has(i.id) && !CROP_OBJECT_IDS.has(i.id),
)

// The registry defs carry no user-facing copy, so the tooltip sentences live here.
const MOVER_DESCRIPTIONS: Record<string, string> = {
  allMovers: 'Combines every distinct mover capability into one modular, collision-free MIDI lane.',
  forceFieldPush: 'Launches stackable radial pulses, anticipation-to-strike transitions, and a distance-shaped spiral pulse.',
  radialMotion: 'Nests three rings of copies inside each other and keeps every depth turning on its own - MIDI collapses, blooms, freezes or reverses any of them.',
  radial: 'Splits its object into N copies fanned around a circle - movers below it move each copy along its own axes.',
  symmetry: 'Folds its object across mirror lines through its own center - one line for a plain mirror image, more for a kaleidoscope.',
  impactPulse: "Punches its objects' size on every note - a snare's envelope, instant at the onset and gone again, with optional squash-and-stretch.",
  symmetricMotion: 'Moves a whole formation symmetrically about its own center - notes bloom it out, pull it in, turn it, or split it apart across an axis.',
  approach: 'Streams copies at the camera, each born far away at nothing and swelling as it arrives - an endless flight into the object.',
}

// Left the library outright - Motion's Step/Snap/Spin blocks are these exact
// movers (same pitches, same evaluators), so listing them is pure duplication.
// Same move as Circle/Triangle above: the definitions stay registered so old
// projects keep working.
const MOVER_REMOVED_IDS = new Set(['burst', 'rotateBurst', 'constantRotate'])

const ALL_MOVER_INSTRUMENTS = withKind('mover', listMoverOrSplitterDefinitions()
  .filter((d) => d.kind === 'mover' && !MOVER_REMOVED_IDS.has(d.id))
  .map((d) => ({
  id: d.id,
  name: d.label,
  description: MOVER_DESCRIPTIONS[d.id] ?? `Moves its object with the ${d.label} transform.`,
  icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#22d3ee" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6 H10" />
      <path d="M7 3 L10 6 L7 9" />
      <path d="M4 3 L2 6 L4 9" />
    </svg>
  ),
})))

// Single-behavior movers, soft-deprecated: each is one bank of the compound
// movers, so they park in a collapsed Mover Extras folder - demoted, not
// deleted, like the object and director Extras.
const MOVER_EXTRA_IDS = new Set([
  'orbitBurst', 'constantOrbit', 'translationOscillator',
])
const MOVER_INSTRUMENTS = ALL_MOVER_INSTRUMENTS.filter((d) => !MOVER_EXTRA_IDS.has(d.id))
const MOVER_EXTRA_INSTRUMENTS = ALL_MOVER_INSTRUMENTS.filter((d) => MOVER_EXTRA_IDS.has(d.id))

const SPLITTER_INSTRUMENTS = withKind('splitter', listMoverOrSplitterDefinitions()
  .filter((d) => d.kind === 'splitter')
  .map((d) => ({
    id: d.id,
    name: d.label,
    description: MOVER_DESCRIPTIONS[d.id] ?? `Splits its object into copies with the ${d.label} layout.`,
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#f472b6" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="6" r="1.4" />
        <path d="M6 4.6 V1.5" />
        <path d="M7.2 6.8 L9.9 8.3" />
        <path d="M4.8 6.8 L2.1 8.3" />
      </svg>
    ),
  })))

const COLORIZER_INSTRUMENTS = withKind('colorizer', listMoverOrSplitterDefinitions()
  .filter((d) => d.kind === 'colorizer')
  .map((d) => ({
    id: d.id,
    name: d.label,
    description: d.id === 'calmHueRotate'
      ? 'Every note flashes its objects toward a color you pick - velocity sets how hard, an attack/release envelope shapes the hit, and Stagger rolls it across split copies.'
      : `Changes its object's color with the ${d.label} colorizer.`,
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" strokeWidth="1.2" strokeLinecap="round">
        <path d="M6 1 A5 5 0 0 1 11 6" stroke="#22d3ee" />
        <path d="M11 6 A5 5 0 0 1 6 11" stroke="#a78bfa" />
        <path d="M6 11 A5 5 0 0 1 1 6" stroke="#f472b6" />
        <path d="M1 6 A5 5 0 0 1 6 1" stroke="#facc15" />
      </svg>
    ),
  })))

// Every library item, flat. The instrument-preview capture page iterates this
// to know what can be clipped - the picker arrays above stay the single source
// of what exists in the library.
export const ALL_LIBRARY_ITEMS: InstrumentItem[] = [
  ...SCENE_INSTRUMENTS,
  ...DIRECTOR_INSTRUMENTS,
  ...ALL_OBJECT_INSTRUMENTS,
  ...ALL_MOVER_INSTRUMENTS,
  ...COLORIZER_INSTRUMENTS,
  ...SPLITTER_INSTRUMENTS,
]

/** A library folder: a row you click into, holding items and/or subfolders. */
interface LibraryFolder {
  id: string
  title: string
  /** One tooltip sentence: what belongs in this folder. */
  description: string
  items: InstrumentItem[]
  subfolders?: LibraryFolder[]
}

// ——— Folder assignments ———
// Items are defined once in the arrays above; the folders claim them here by
// id. Anything no folder claims falls through to Unsorted, so a newly added
// instrument is never invisible - it just waits there until it's given a home.
// (Modulators are retired from the library - movers replace them; their code
// stays until existing projects are migrated off ports.)

const SCENE_ITEM_POOL: InstrumentItem[] = [
  ...SCENE_INSTRUMENTS,
  ...OBJECT_INSTRUMENTS,
  ...MOVER_INSTRUMENTS,
  ...COLORIZER_INSTRUMENTS,
  ...SPLITTER_INSTRUMENTS,
]

const pick = (ids: readonly string[]): InstrumentItem[] =>
  ids.flatMap((id) => SCENE_ITEM_POOL.filter((i) => i.id === id))

// Impact is notes hitting the scene itself, split by envelope: Impulse
// strikes once per note and decays; Rumble warps for as long as it's held.
// Visibility rides with Impulse - its ADSR window is exactly that shape.
const IMPULSE_IDS = ['impactWarp', 'cameraControl', 'meteorImpact', 'forceFieldPush', 'impactScatter', 'impactPulse', 'visibility']
// Both of the odd ones here file by ENVELOPE, which is what the Impact split is
// for. Strobe sits in Rumble rather than Color because it is scene-wide and
// sustained - it keeps flashing for exactly as long as the note is held. Camera
// Orbit sits here rather than beside Camera in Impulse for the same reason:
// holding a row to swing the rig is the held shape, not a strike that decays.
const RUMBLE_IDS = ['bassRipple', 'waveTerrain', 'strobe', 'cameraOrbit']
const UTILITY_IDS = ['video', 'photo', 'textDisplay']
const COLOR_IDS = [...COLORIZER_INSTRUMENTS.map((i) => i.id), 'colorFilters']

const IMPACT_IDS = [...IMPULSE_IDS, ...RUMBLE_IDS]
// Everything else that moves lives under Motion - the compound movers at its
// top level, the single-behavior ones in its Extras subfolder.
const MOTION_ITEMS = MOVER_INSTRUMENTS.filter((m) => !IMPACT_IDS.includes(m.id))

const CLAIMED_IDS = new Set([
  ...IMPACT_IDS,
  ...UTILITY_IDS,
  ...COLOR_IDS,
  ...OBJECT_INSTRUMENTS.map((i) => i.id),
  ...INSTRUMENT_FOLDER_IDS,
  ...MOTION_ITEMS.map((i) => i.id),
  ...MOVER_EXTRA_INSTRUMENTS.map((i) => i.id),
  ...SPLITTER_INSTRUMENTS.map((i) => i.id),
])
const UNSORTED_ITEMS = SCENE_ITEM_POOL.filter((i) => !CLAIMED_IDS.has(i.id))

// The scene library's root, in shelf order. Extras folders keep holding
// exactly what they held before the folder pass - demoted, never deleted -
// but they now sit INSIDE the folder they belong to rather than at the root.
const SCENE_FOLDERS: LibraryFolder[] = [
  {
    id: 'impact',
    title: 'Impact',
    description: 'Notes hitting the scene itself - camera punches, shockwaves, and sustained rumble.',
    items: [],
    subfolders: [
      { id: 'impulse', title: 'Impulse', description: 'One sharp hit per note - strikes, then decays.', items: pick(IMPULSE_IDS) },
      { id: 'rumble', title: 'Rumble', description: 'Continuous shaking, warping or masking while the note is held.', items: [...pick(RUMBLE_IDS), ...CROP_OBJECT_ITEMS] },
    ],
  },
  { id: 'splitters', title: 'Splitters', description: 'Splitters render their objects several times, giving each copy its own reference frame - movers BELOW a splitter move every copy along its own axes.', items: SPLITTER_INSTRUMENTS },
  {
    id: 'motion',
    title: 'Motion',
    description: 'Movers move, spin, scale, or fade objects - add them under tracks (or drag them onto tracks) and drive them with notes.',
    items: MOTION_ITEMS,
    subfolders: [
      { id: 'motion-extras', title: 'Extras', description: 'Single-behavior movers, still fully working - the compound movers above cover the same ground in one track.', items: MOVER_EXTRA_INSTRUMENTS },
    ],
  },
  { id: 'objects', title: 'Objects', description: 'Object instruments are visual objects that render in the 3D scene - for example, cubes or spheres.', items: OBJECT_INSTRUMENTS },
  { id: 'instruments', title: 'Instruments', description: 'Played rather than posed: every note spawns its own short-lived event instead of changing a standing shape.', items: INSTRUMENT_FOLDER_ITEMS },
  { id: 'color', title: 'Color', description: 'Recoloring: the Colorizer flashes its objects toward a picked color; Color Filters remap the whole scene.', items: pick(COLOR_IDS) },
  { id: 'utility', title: 'Utility', description: 'Full-frame media and text - video clips, photos, and word display.', items: pick(UTILITY_IDS) },
  { id: 'unsorted', title: 'Unsorted', description: 'Not yet filed into a folder above - fully working, just awaiting a home.', items: UNSORTED_ITEMS },
  { id: 'extras', title: 'Extras', description: 'The back catalog: older object instruments, all still fully working - just outside the curated folders above.', items: EXTRA_INSTRUMENTS },
]

// The Main scene's library: the curated directors ARE the root view (no
// folder to click through first), with the soft-deprecated ones one level in.
const MAIN_ROOT_ITEMS = DIRECTOR_CORE
const MAIN_FOLDERS: LibraryFolder[] = [
  { id: 'director-extras', title: 'Extras', description: "Older directors, still fully working - Crop's angled slicing covers most of what Cut and Radial Cut did.", items: DIRECTOR_EXTRAS },
]

interface ItemHandlers {
  onItemPointerDown: (e: ReactPointerEvent, item: InstrumentItem) => void
  onItemDoubleClick: (item: InstrumentItem) => void
}

function ItemGrid({ items, onItemPointerDown, onItemDoubleClick }: { items: InstrumentItem[] } & ItemHandlers) {
  return (
    <div className="grid grid-cols-1 gap-2 px-2">
      {items.map((item) => (
        <div
          key={item.id}
          data-instrument-id={item.id}
          onPointerDown={(e) => onItemPointerDown(e, item)}
          onDoubleClick={() => onItemDoubleClick(item)}
          title={item.description}
          className="group min-w-0 cursor-default select-none overflow-hidden rounded-md"
        >
          <div className="relative aspect-video">
            {canPreview(item)
              ? <InstrumentCardPreview item={item} />
              : (
                <span className="absolute inset-0 flex items-center justify-center [&_svg]:h-8 [&_svg]:w-8">
                  {item.icon}
                </span>
              )}
            <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/90 via-black/35 to-black/5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <span
                className="min-w-0 truncate px-2 pb-1.5 text-xs font-medium text-white"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.75)' }}
              >
                {item.name}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Logic-style drill-down browser. Every folder is a plain row you click
 *  into; a sticky back row returns one level; instrument cards appear only at
 *  the level that holds them. `rootItems` lets a view keep items at the very
 *  top level (the Main scene's directors) without a folder to click through. */
function FolderBrowser({ folders, rootItems = [], onItemPointerDown, onItemDoubleClick }: { folders: LibraryFolder[]; rootItems?: InstrumentItem[] } & ItemHandlers) {
  // The trail of entered folders, root-first. The folder trees are module
  // constants, so a held reference can never go stale.
  const [path, setPath] = useState<LibraryFolder[]>([])
  const current = path[path.length - 1]
  const folderRows = (current ? current.subfolders ?? [] : folders)
    // An empty folder is a dead-end click - hide it until it has contents.
    .filter((f) => f.items.length > 0 || (f.subfolders?.length ?? 0) > 0)
  const items = current ? current.items : rootItems

  return (
    <div>
      {/* The location row is always present so entering a folder swaps its
          label instead of inserting a row above the list (which made the whole
          menu jump down). Same size and metrics as the folder rows - depth
          reads from the ‹ chevron and position, not from bolder type. */}
      {current ? (
        <button
          type="button"
          onClick={() => setPath(path.slice(0, -1))}
          aria-label={`Back to ${path[path.length - 2]?.title ?? 'the library'}`}
          className="sticky top-0 z-20 flex h-[30px] w-full cursor-pointer select-none items-center gap-2.5 bg-[var(--bg-shell)] px-3 text-xs text-[var(--text)] transition-colors hover:bg-[var(--bg-elevated)]"
        >
          <ChevronLeft size={12} className="flex-shrink-0 text-[var(--text-muted)]" />
          <span className="min-w-0 truncate">{current.title}</span>
        </button>
      ) : (
        <div className="sticky top-0 z-20 flex h-[30px] select-none items-center bg-[var(--bg-shell)] px-3 text-xs text-[var(--text-muted)]">
          Library
        </div>
      )}
      {items.length > 0 && (
        <div className="mt-1">
          <ItemGrid items={items} onItemPointerDown={onItemPointerDown} onItemDoubleClick={onItemDoubleClick} />
        </div>
      )}
      {/* Folder rows sit BELOW any cards: the only level that mixes them is
          the Main root, where the deprecated Extras must not lead. */}
      <div className={items.length > 0 ? 'mt-2' : ''}>
        {folderRows.map((folder) => (
          <div
            key={folder.id}
            onClick={() => setPath([...path, folder])}
            title={folder.description}
            className="flex h-[30px] cursor-default select-none items-center gap-2.5 px-3 transition-colors hover:bg-[var(--bg-elevated)]"
          >
            <Folder size={12} className="flex-shrink-0 text-[var(--text-muted)]" />
            <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-2)]">{folder.title}</span>
            <ChevronRight size={12} className="flex-shrink-0 text-[var(--text-muted)]" />
          </div>
        ))}
      </div>
    </div>
  )
}

type LibraryTab = 'instruments' | 'loops' | 'templates'

/** Hover popup for a loop row: the pattern as a mini piano roll - one lane
 *  per used row, notes as bars (velocity = brightness), beat gridlines. */
function LoopPatternPopup({ pattern, left, top }: { pattern: LoopPattern; left: number; top: number }) {
  const beats = pattern.bars * 4
  const rowCount = Math.max(1, ...pattern.notes.map(([, , , row]) => (row ?? 0) + 1))
  const height = Math.max(44, Math.min(96, rowCount * 22))
  const clampedTop = Math.max(8, Math.min(top - 8, window.innerHeight - height - 40))
  return (
    <div
      className="pointer-events-none fixed z-[90] w-[228px] rounded border border-[var(--border)] bg-[var(--bg-canvas)] p-2 shadow-xl shadow-black/60"
      style={{ left, top: clampedTop }}
    >
      <div
        className="relative w-full overflow-hidden rounded-[3px] bg-[#101013]"
        style={{
          height,
          backgroundImage: `repeating-linear-gradient(to right, rgba(255,255,255,0.09) 0 1px, transparent 1px ${100 / beats}%)`,
        }}
      >
        {pattern.notes.map(([b, dur, vel, row], i) => (
          <div
            key={i}
            className="absolute rounded-[2px] bg-[var(--accent)]"
            style={{
              left: `${(b / beats) * 100}%`,
              width: `max(3px, ${(dur / beats) * 100}%)`,
              top: `${((row ?? 0) / rowCount) * 100 + 1.5}%`,
              height: `${100 / rowCount - 8}%`,
              opacity: 0.35 + ((vel ?? 100) / 127) * 0.65,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[10px] text-[var(--text-3)]">{pattern.name}</span>
        <span className="font-mono text-[9px] text-[var(--text-muted)]">{pattern.bars} bar{pattern.bars !== 1 ? 's' : ''}</span>
      </div>
    </div>
  )
}

// The Templates tab: double-click switches the current project onto that
// template (visual tracks replaced, audio + its detected BPM kept). One undo
// step, but still a big swap - confirm first.
function TemplatesTab() {
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const applyTemplate = useProjectStore((s) => s.applyTemplate)
  // Which template this project is on - marks the current card.
  // The ACTIVE scene's template wins (multi-scene projects wear one per
  // scene); older documents only carry the project-level marker.
  const appliedTemplateId = useProjectStore((s) => s.scenes[s.activeSceneId]?.appliedTemplateId ?? s.appliedTemplateId)
  // A lyric project is offered lyric STYLES and nothing else - switching one
  // onto Slideshow would throw the transcription away. Detected by the applied
  // template, or by the Lyrics-track contract for projects that predate it.
  const hasLyricsTrack = useProjectStore((s) => s.rootTrackIds.some((id) => {
    const t = s.tracks[id]
    return t?.type === 'base' && t.instrumentId === 'textDisplay' && t.name === 'Lyrics'
  }))
  const isLyricProject = isLyricTemplateId(appliedTemplateId) || hasLyricsTrack
  const shown = isLyricProject ? LYRIC_STYLES : LISTED_TEMPLATES
  const router = useRouter()
  const projectId = useSearchParams().get('project')
  // Covers the editor while the applied template autosaves before handing
  // off to /lyric-setup (which re-hydrates the project from its row).
  const [leaving, setLeaving] = useState(false)

  if (activeIsMain) {
    return (
      <p className="px-3 pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Templates apply inside a visual scene - switch off Main to use one.
      </p>
    )
  }

  const apply = (tpl: (typeof TEMPLATES)[number]) => {
    if (!window.confirm(`Switch this project's tracks to “${tpl.name}”? Your song stays; the visual tracks are replaced (undoable).`)) return
    // Transcribed already? applyTemplate carries the Lyrics track's words over
    // (styling from the template), so the setup flow would be redundant.
    const before = useProjectStore.getState()
    const alreadyTranscribed = before.rootTrackIds.some((id) => {
      const t = before.tracks[id]
      return t?.type === 'base' && t.instrumentId === 'textDisplay' && t.name === 'Lyrics' && !!t.lyricTiming
    })
    applyTemplate(tpl.document)
    trackEvent('template_applied', { template: tpl.id })
    // Anything pointing at the replaced tracks is stale now.
    const ui = useUIStore.getState()
    ui.setEditingBlock(null)
    ui.setSelectedTrackId(null)
    ui.setSelectedBlockIds(new Set())
    // Lyric templates continue on their setup route (song → transcribe →
    // align) - after the applied tracks have saved, since that page
    // re-hydrates the project from its row.
    if (tpl.lyricFlow && !alreadyTranscribed) {
      setLeaving(true)
      void (async () => {
        if (projectId) await waitForSaved()
        router.push(projectId ? `/lyric-setup?project=${projectId}` : '/lyric-setup')
      })()
    }
  }

  return (
    <div className="pt-1">
      {leaving && <LoadingScreen />}
      <p className="px-3 pt-2 pb-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
        {isLyricProject
          ? 'Double-click a style to restyle this lyric video. Your song and words stay.'
          : 'Double-click a template to switch this project onto it. Your song stays.'}
      </p>
      {/* Same structure as the instrument sections: always a single column,
          cards borderless with the name riding a hover gradient. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-2 px-2">
          {shown.map((tpl) => (
            <TemplateCard
              key={tpl.id}
              tpl={tpl}
              label={isLyricProject ? tpl.styleName ?? tpl.name : tpl.name}
              onApply={() => apply(tpl)}
              selected={tpl.id === appliedTemplateId}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// Double-click to apply, template or lyric style alike: this is the EDITOR, so
// the project already has work in it that the swap replaces. The single-click
// picker belongs to the one moment where that is not true - the style step at
// the end of lyric setup, where there is nothing yet to lose.
function TemplateCard({ tpl, onApply, selected = false, label }: {
  tpl: (typeof TEMPLATES)[number]
  onApply: () => void
  /** This is the template the project is currently on. */
  selected?: boolean
  /** Overrides the displayed name (lyric projects show style names). */
  label?: string
}) {
  return (
    <div
      onDoubleClick={onApply}
      title={tpl.description}
      className={`group min-w-0 cursor-default select-none overflow-hidden rounded-md ${
        selected ? 'ring-2 ring-[var(--accent)]' : ''
      }`}
    >
      {/* True 16:9 box: capture clips are 640×360, so they fit exactly -
          never stretched, never cropped. */}
      <div className="relative aspect-video bg-[var(--bg-app)]">
        {tpl.cardPreview === 'animatedSlideshow'
          ? <TemplateSlideshowPreview />
          : tpl.cardPreview === 'animatedLyric'
            ? <TemplateLyricPreview templateId={tpl.previewTemplateId ?? tpl.id} />
            : <TemplatePreviewVideo id={tpl.id} />}
        {/* The instrument cards' name treatment: a bottom gradient that
            reveals on hover - held visible on the current template so its
            marking never hides. */}
        <div className={`pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/90 via-black/35 to-black/5 transition-opacity duration-150 ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          <span
            className="flex min-w-0 items-center gap-1 truncate px-2 pb-1.5 text-xs font-medium text-white"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.75)' }}
          >
            {selected && <Check size={10} strokeWidth={3} className="flex-shrink-0 text-[var(--accent)]" />}
            {label ?? tpl.name}
          </span>
        </div>
      </div>
    </div>
  )
}

export function LeftSidebar() {
  const [tab, setTab] = useState<LibraryTab>('instruments')
  const { startLibraryDrag, ghostRef, ghostName } = useLibraryDrag()
  const { startLoopBlockDrag, ghostRef: loopGhostRef, ghostName: loopGhostName } = useLoopBlockDrag()
  const [loopHover, setLoopHover] = useState<{ pattern: LoopPattern; left: number; top: number } | null>(null)
  // Over a valid drop slot → show a "+" on the ghost to signal "release to add".
  const droppable = useUIStore((s) => !!s.trackDrop && (s.trackDrop.line != null || s.trackDrop.intoId != null))
  // Double-click converts the selected track to the item (no-op if nothing selected).
  const setTrackInstrument = useProjectStore((s) => s.setTrackInstrument)
  const setTrackMover = useProjectStore((s) => s.setTrackMover)
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const onItemDoubleClick = (item: InstrumentItem) => {
    const selectedTrackId = useUIStore.getState().selectedTrackId
    if (!selectedTrackId) return
    // Composition instruments (the 'director' library kind) go through the
    // same conversion as any instrument - setTrackInstrument seeds their
    // scene bindings when the Main scene is active.
    if (item.kind === 'mover' || item.kind === 'splitter' || item.kind === 'colorizer') setTrackMover(selectedTrackId, item.id, item.name)
    else setTrackInstrument(selectedTrackId, item.id, item.name)
  }

  // No border-r on the root: the PanelResizeHandle beside this panel already
  // draws a 1px --border line, and having both made the library's divider twice
  // the width of every other divider in the editor.
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--bg-shell)]">
      {/* One warm preview canvas for all sections' hover popups. */}
      <InstrumentPreviewLayer />
      {/* All live 3D cards share this renderer, avoiding browser WebGL-context
          exhaustion when several two-column sections are visible. */}
      {tab === 'instruments' && <InstrumentCardPreviewCanvas />}
      {/* @container so the tabs show icon-only when the (resizable) sidebar is
          narrow, and icon + label once there's room for the text. The 320px
          threshold is the width where all three labels fit inside the pills'
          px-2 padding without truncating - below it, labels would ellipsize. */}
      <div className="@container relative z-10 flex flex-shrink-0 items-center gap-1 px-2 py-1.5">
        {([
          { id: 'instruments', label: 'Instruments', Icon: Shapes },
          { id: 'loops', label: 'Loops', Icon: Repeat },
          { id: 'templates', label: 'Templates', Icon: LayoutTemplate },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={label}
            className={`flex-1 min-w-0 h-6 flex items-center justify-center gap-1.5 rounded-full px-2 text-[11px] transition-colors cursor-pointer ${
              tab === id
                ? 'bg-[var(--bg-elevated)] text-[var(--text)] font-semibold'
                : 'bg-transparent text-[var(--text-muted)] font-medium hover:bg-white/[0.05] hover:text-[var(--text-2)]'
            }`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <span className="hidden @[320px]:inline truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="timeline-scrollbar relative z-10 flex-1 overflow-y-auto pb-4">
        {tab === 'instruments' && (
          // Keyed: the scene/Main views are different folder trees rendered in
          // the same slot - remount so a drill-down path into one never
          // carries over into the other.
          <FolderBrowser
            key={activeIsMain ? 'main' : 'scene'}
            folders={activeIsMain ? MAIN_FOLDERS : SCENE_FOLDERS}
            rootItems={activeIsMain ? MAIN_ROOT_ITEMS : undefined}
            onItemPointerDown={startLibraryDrag}
            onItemDoubleClick={onItemDoubleClick}
          />
        )}
        {tab === 'loops' && (
          <div className="pt-1">
            <p className="px-3 pt-2 pb-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
              Drag a loop onto a track - it lands as a repeating MIDI block at that bar.
            </p>
            {LOOP_PATTERNS.map((pattern) => (
              <div
                key={pattern.id}
                onPointerDown={(e) => { setLoopHover(null); startLoopBlockDrag(e, pattern) }}
                onMouseEnter={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setLoopHover({ pattern, left: rect.right + 8, top: rect.top })
                }}
                onMouseLeave={() => setLoopHover(null)}
                title={pattern.description}
                className="flex items-center gap-2.5 h-[26px] px-3 cursor-default hover:bg-[var(--bg-elevated)] transition-colors select-none"
              >
                <span className="flex-shrink-0 flex items-center justify-center w-3.5">
                  <Repeat size={12} className="text-emerald-400" />
                </span>
                <span className="text-xs text-[var(--text-2)] truncate">{pattern.name}</span>
              </div>
            ))}
            {loopHover && <LoopPatternPopup pattern={loopHover.pattern} left={loopHover.left} top={loopHover.top} />}
          </div>
        )}
        {tab === 'templates' && <TemplatesTab />}
      </div>

      {/* Floating ghost while dragging a library item into the track list. Centered
          on the cursor (translate -50%/-50%); left/top are set imperatively, so
          re-renders never reset its position. */}
      {ghostName && (
        <div
          ref={ghostRef}
          // z above the tutorial dim (z-[100]) - mid-drag the tutorial keeps its
          // spotlight up, and the carried item must stay bright on top of it.
          className="fixed z-[120] pointer-events-none flex items-center gap-1.5 px-3 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text)] shadow-lg shadow-black/40"
          style={{ left: 0, top: 0, height: 28, transform: 'translate(-50%, -50%)' }}
        >
          {droppable && <Plus size={13} className="text-[var(--accent)]" strokeWidth={2.5} />}
          {ghostName}
        </div>
      )}

      {/* Ghost while dragging a loop pattern onto a track lane. */}
      {loopGhostName && (
        <div
          ref={loopGhostRef}
          className="fixed z-[120] pointer-events-none flex items-center gap-1.5 px-3 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text)] shadow-lg shadow-black/40"
          style={{ left: 0, top: 0, height: 28, transform: 'translate(-50%, -50%)' }}
        >
          <Repeat size={12} className="text-emerald-400" />
          {loopGhostName}
        </div>
      )}

    </div>
  )
}
