'use client'

import { memo, useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import { useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useInstantNavigation } from '../../components/instantNavigation'
import { ArrowLeftRight, Check, ChevronLeft, ChevronRight, Plus, Sparkles, Repeat } from 'lucide-react'
import { useLibraryDrag } from './useLibraryDrag'
import { useLoopBlockDrag } from './useLoopBlockDrag'
import { LOOP_PATTERNS, type LoopPattern } from './loops'
import { useUIStore, type LibraryTabId } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { listMoverOrSplitterDefinitions } from '../core/visualCopies/registry'
import { listCompositionInstruments } from '../core/directors'
import { canPreview } from './instrumentPreviewStore'
import { preloadInstrument } from '../instruments'
// The two preview components pull their own r3f Canvas + Bloom stack; they
// load after first paint so the shell doesn't wait on them. Both are memo'd
// AROUND the dynamic wrapper: the sidebar re-renders on tab clicks and on the
// droppable/ghost flips of a drag, and without the memo each of those walked
// the r3f preview canvas (the layer) and every visible card's loadable shell.
// The layer takes no props and a card's `item` is a module constant, so the
// memo bails them all out.
const InstrumentCardPreview = memo(dynamic(() => import('./InstrumentHoverPreview').then((m) => m.InstrumentCardPreview), { ssr: false }))
const InstrumentPreviewLayer = memo(dynamic(() => import('./InstrumentHoverPreview').then((m) => m.InstrumentPreviewLayer), { ssr: false }))
import { TEMPLATES, LISTED_TEMPLATES, LYRIC_STYLES, isLyricTemplateId } from '../../templates'
import { TemplatePreviewVideo } from '../../components/TemplatePreviewVideo'
import { TemplateSlideshowPreview } from '../../components/TemplateSlideshowPreview'
import { TemplateLyricPreview } from '../../components/TemplateLyricPreview'
import { track as trackEvent } from '../../analytics/analytics'
import { waitForSaved } from '../../persistence/autosave'
import { LoadingScreen } from '../../components/LoadingScreen'

/** What dragging an item creates. */
export type LibraryKind = 'object' | 'modulator' | 'mover' | 'splitter' | 'colorizer' | 'director' | 'switcher'

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
  scene: 'Shows one scene, full-frame, for the whole timeline. Add notes to its row and it shows only while one is held.',
  sceneSwitcher: 'Shows the most recently started scene row only while its MIDI note remains held.',
  cut: 'Partitions the frame between held scene rows, with straight or diagonal cuts.',
  radialCut: 'Partitions held scene rows into concentric rings from the center outward.',
  crop: 'Masks one scene into evenly spaced slices at any angle. Each held row shows its slice; the rest stays transparent.',
}

const DIRECTOR_ICON_COLORS: Record<string, string> = {
  scene: 'text-emerald-400',
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
  description: DIRECTOR_DESCRIPTIONS[d.id] ?? `Renders scene sources into the Composite with the ${d.name} layout.`,
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
  { id: 'cube', name: '3D Shape', description: 'A solid - cube, sphere, torus, prism and friends - with per-axis proportions and a metal / glass / unlit surface, swelling with every note.', icon: <div className="w-3 h-3 border border-indigo-400 rounded-sm" /> },
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
  { id: 'modSynth', name: 'Mod Synth', description: 'A synthesizer of visuals: every note spawns a copy whose size, position, color and opacity fly custom envelopes - ADSR, bezier or hand-drawn.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 10 L2.5 2.5 L4.5 7 L8 7 L11 10" fill="none" stroke="#f5b455" strokeWidth="1.1" strokeLinejoin="round" />
      <circle cx="2.5" cy="2.5" r="1.1" fill="#ffd9a0" />
      <circle cx="8" cy="7" r="1.1" fill="#f5b455" />
    </svg>
  )},
  { id: 'laserLine', name: 'Laser Line', description: 'A thin neon beam with a colored core and HDR edge bloom.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 6 H11" stroke="#22d3ee" strokeWidth="3" strokeLinecap="round" opacity="0.2" />
      <path d="M1 6 H11" stroke="#cffafe" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )},
  { id: 'wireframe', name: 'Wireframe', description: 'A thin-line shape - circles, platonic solids, torus knots, Möbius strips and friends - with adjustable color, glow and spin, pulsing with every note.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="none" stroke="#7dd3fc" strokeWidth="0.8">
        <path d="M6 1.2 L10.6 3.6 L10.6 8.4 L6 10.8 L1.4 8.4 L1.4 3.6 Z" />
        <path d="M1.4 3.6 L6 6 L10.6 3.6 M6 6 L6 10.8" />
      </g>
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
  { id: 'overlapShape', name: 'Overlap Shape', description: 'A flat one-color shape standing in 3D - where copies cross in the same plane, the overlap cuts out to transparency or flips to a second color.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path
        fillRule="evenodd"
        fill="#ff5470"
        fillOpacity="0.9"
        d="M0.6 6 a3.6 3.6 0 1 0 7.2 0 a3.6 3.6 0 1 0 -7.2 0 Z M4.2 6 a3.6 3.6 0 1 0 7.2 0 a3.6 3.6 0 1 0 -7.2 0 Z"
      />
    </svg>
  )},
  { id: 'overlapSolid', name: 'Overlap Solid', description: 'A one-color 3D solid - wherever copies share volume, the overlap punches a see-through window or flips to a second color.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path fill="#2dd4bf" fillOpacity="0.9" d="M4.2 6 a3.6 3.6 0 1 0 7.2 0 a3.6 3.6 0 1 0 -7.2 0 Z" />
      <path
        fillRule="evenodd"
        fill="#ff5470"
        fillOpacity="0.95"
        d="M0.6 6 a3.6 3.6 0 1 0 7.2 0 a3.6 3.6 0 1 0 -7.2 0 Z M4.2 6 a3.6 3.6 0 1 0 7.2 0 a3.6 3.6 0 1 0 -7.2 0 Z"
      />
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
  { id: 'midiRoll', name: 'Midi Roll', description: 'Your notes as a scrolling neon piano roll - bars glide past a center playhead where diamonds flare as they play.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="0.8" y="2" width="4.5" height="1.4" fill="none" stroke="#35e0e0" strokeWidth="0.7" />
      <rect x="6.5" y="4.6" width="4.5" height="1.4" fill="none" stroke="#35e0e0" strokeWidth="0.7" />
      <rect x="2.5" y="7.2" width="4" height="1.4" fill="none" stroke="#35e0e0" strokeWidth="0.7" />
      <path d="M6 5.3 L7 6.3 L6 7.3 L5 6.3 Z" fill="#67e8f9" />
    </svg>
  )},
  { id: 'starfield', name: 'Starfield', description: 'A full-frame field of drifting dots - Midi Roll’s old backdrop as its own layer, with density, drift and twinkle knobs.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="2.6" cy="3" r="1" fill="#e2e8f0" />
      <circle cx="8.6" cy="2.2" r="0.6" fill="#94a3b8" />
      <circle cx="5.4" cy="6.2" r="0.8" fill="#cbd5e1" />
      <circle cx="10.2" cy="8.2" r="1" fill="#e2e8f0" />
      <circle cx="3" cy="9.6" r="0.6" fill="#cfc39a" />
      <circle cx="7.2" cy="10" r="0.7" fill="#94a3b8" />
    </svg>
  )},
])

// The curated core: a few good shapes, kept deliberately short so the library
// reads as intentional. Everything else lives in the collapsed Extras section
// at the bottom - still available, out of the first impression.
// Circle and Triangle left the library outright - 3D Shape's geometry picker
// covers them (the instruments stay registered for old projects).
const CORE_OBJECT_IDS = new Set(['cube', 'modSynth', 'laserLine', 'wireframe', 'particleBurst', 'overlapShape'])
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
  waypoints: 'Lay out positions (line, grid, ring, or custom) - each MIDI row sends the object to its position, and curve rows switch how it travels (linear, ease, or spring physics with overshoot).',
  mover: 'The fundamental mover: translate, rotate or orbit its objects, with notes bursting, holding or oscillating the motion - one lane, seven rows.',
  physics: 'Notes are values on a lane and real mechanics join them: gravity, a spring or drag, with the launch solved so the object lands on each value exactly on the beat - or crests there, or is simply kicked and left to bounce.',
  allMovers: 'Combines every distinct mover capability into one modular, collision-free MIDI lane.',
  forceFieldPush: 'Launches stackable radial pulses, anticipation-to-strike transitions, and a distance-shaped spiral pulse.',
  radialMotion: 'Nests three rings of copies inside each other and keeps every depth turning on its own - MIDI collapses, blooms, freezes or reverses any of them.',
  radial: 'Splits its object into N copies fanned around a circle - movers below it move each copy along its own axes.',
  line: 'Marches N copies back into depth - or along any axis you aim - with sizes ramping step by step, the original object staying put.',
  symmetry: 'Folds its object across mirror lines through its own center - one line for a plain mirror image, more for a kaleidoscope.',
  impactPulse: "Punches its objects' size on every note - a snare's envelope, instant at the onset and gone again, with optional squash-and-stretch.",
  symmetricMotion: 'Moves a whole formation symmetrically about its own center - notes bloom it out, pull it in, turn it, or split it apart across an axis.',
  approach: 'Streams copies at the camera, each born far away at nothing and swelling as it arrives - an endless flight into the object.',
  contour: "Sculpts a formation along the camera's depth axis: each copy's distance follows a surface of its own x/y - a cone to start.",
}

// Retired outright by the 2026-08 mover consolidation: the unified Mover's
// (translate | rotate | orbit) x (burst | constant | oscillate) matrix IS
// these six, and persistence UPGRADES[12] rewrites old saves onto it, so the
// ids are gone from the registry too. Kept as a guard in case one is ever
// re-registered for a transition period.
const MOVER_REMOVED_IDS = new Set([
  'burst', 'rotateBurst', 'orbitBurst',
  'constantRotate', 'constantOrbit', 'translationOscillator',
])

// `parentGate` definitions (Bypass) are deliberately absent from the library:
// they only mean anything nested under a device, and the library's one gesture
// is dragging onto an object. They are added from a mover/splitter track's
// context menu instead, the same way ability lanes are.
const ALL_MOVER_INSTRUMENTS = withKind('mover', listMoverOrSplitterDefinitions()
  .filter((d) => d.kind === 'mover' && !MOVER_REMOVED_IDS.has(d.id) && !d.parentGate)
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

const MOVER_INSTRUMENTS = ALL_MOVER_INSTRUMENTS

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


// A card for a CONTAINER, not an instrument or a device: it lands empty and
// whatever you drop into it becomes a row of its lane. Its own kind, because
// `makeTrack` has to build a `switcher` track rather than reach for either
// registry.
const SWITCHER_ITEMS = withKind('switcher', [
  {
    id: 'switcher',
    name: 'Switcher',
    description: 'A rack with one MIDI row per track inside it - play a row to switch that instrument, group or device on. Mutually exclusive or several at once.',
    icon: (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" strokeWidth="1.1" strokeLinecap="round">
        <path d="M1.5 3h3" stroke="#f0abfc" />
        <path d="M7.5 3h3" stroke="#52525b" />
        <circle cx="6" cy="3" r="1.5" fill="none" stroke="#f0abfc" />
        <path d="M1.5 9h3" stroke="#52525b" />
        <path d="M7.5 9h3" stroke="#52525b" />
        <circle cx="6" cy="9" r="1.5" fill="none" stroke="#52525b" />
      </svg>
    ),
  },
])

export const ALL_LIBRARY_ITEMS: InstrumentItem[] = [
  ...SCENE_INSTRUMENTS,
  ...DIRECTOR_INSTRUMENTS,
  ...ALL_OBJECT_INSTRUMENTS,
  ...ALL_MOVER_INSTRUMENTS,
  ...COLORIZER_INSTRUMENTS,
  ...SPLITTER_INSTRUMENTS,
  ...SWITCHER_ITEMS,
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
// id. Every item must be claimed by a folder below - an unclaimed id renders
// nowhere, so filing a new instrument into a folder is part of adding it.
// (Modulators are retired from the library - movers replace them; their code
// stays until existing projects are migrated off ports.)

const SCENE_ITEM_POOL: InstrumentItem[] = [
  ...SCENE_INSTRUMENTS,
  ...OBJECT_INSTRUMENTS,
  ...MOVER_INSTRUMENTS,
  ...COLORIZER_INSTRUMENTS,
  ...SPLITTER_INSTRUMENTS,
  ...SWITCHER_ITEMS,
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
const UTILITY_IDS = ['video', 'photo', 'textDisplay', 'oscilloscope', 'switcher']
const COLOR_IDS = [...COLORIZER_INSTRUMENTS.map((i) => i.id), 'colorFilters']

const IMPACT_IDS = [...IMPULSE_IDS, ...RUMBLE_IDS]
// The back catalog, declared on the definitions themselves (`legacy`) rather
// than listed here: the same flag is what keeps them out of the track context
// menu's add-a-device lists, which have no Extras drawer to demote them into.
const LEGACY_MOVER_IDS = new Set(
  listMoverOrSplitterDefinitions().filter((d) => d.legacy).map((d) => d.id),
)
// Everything else that moves lives under Motion - the compound movers at its
// top level, the single-behavior ones in its Extras subfolder.
const MOTION_ITEMS = MOVER_INSTRUMENTS.filter((m) => !IMPACT_IDS.includes(m.id))

// The scene library's root, in shelf order. Extras folders keep holding
// exactly what they held before the folder pass - demoted, never deleted -
// but they now sit INSIDE the folder they belong to rather than at the root.
const SCENE_FOLDERS: LibraryFolder[] = [
  // The strikes sit at Impact's root (an Impulse subfolder used to hold them
  // and was Impact's only content - one extra click for nothing).
  {
    id: 'impact',
    title: 'Impact',
    description: 'One sharp hit per note - camera punches and shockwaves that strike, then decay.',
    items: pick(IMPULSE_IDS),
  },
  { id: 'rumble', title: 'Rumble', description: 'Continuous shaking, warping or masking while the note is held.', items: [...pick(RUMBLE_IDS), ...CROP_OBJECT_ITEMS] },
  { id: 'splitters', title: 'Splitters', description: 'Splitters render their objects several times, giving each copy its own reference frame - movers BELOW a splitter move every copy along its own axes.', items: SPLITTER_INSTRUMENTS },
  {
    id: 'motion',
    title: 'Motion',
    description: 'Movers move, spin, scale, or fade objects - add them under tracks (or drag them onto tracks) and drive them with notes.',
    // The legacy compound movers (All Movers, Motion) are demoted - never
    // deleted - into the Extras shelf; the unified Mover supersedes them.
    items: MOTION_ITEMS.filter((m) => !LEGACY_MOVER_IDS.has(m.id)),
    subfolders: [
      {
        id: 'motion-extras',
        title: 'Extras',
        description: 'The legacy compound movers - all fully working, superseded by Mover.',
        items: MOTION_ITEMS.filter((m) => LEGACY_MOVER_IDS.has(m.id)),
      },
    ],
  },
  { id: 'objects', title: 'Objects', description: 'Object instruments are visual objects that render in the 3D scene - for example, cubes or spheres.', items: OBJECT_INSTRUMENTS },
  { id: 'instruments', title: 'Instruments', description: 'Played rather than posed: every note spawns its own short-lived event instead of changing a standing shape.', items: INSTRUMENT_FOLDER_ITEMS },
  { id: 'color', title: 'Color', description: 'Recoloring: the Colorizer flashes its objects toward a picked color; Color Filters remap the whole scene.', items: pick(COLOR_IDS) },
  { id: 'utility', title: 'Utility', description: 'Full-frame media and readouts - video clips, photos, word display, the audio waveform - plus the Switcher rack.', items: pick(UTILITY_IDS) },
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

// A preview card has a MAX size: one column until the pane is wide enough for
// two ~212px cards, then two per row (never more). Below the threshold the
// single card grows to fill; above it the pair grow together. The @container
// is the grid's own wrapper so the query reads this column's width, not the
// whole sidebar's. `@[448px]` is content-box: 2×212 + 8 gap + 16 padding —
// kept a literal string so Tailwind's scanner emits the rule. Sized against
// the pane's 30%-of-window cap: it engages at ~1550px windows dragged wide.
function ItemGrid({ items, onItemPointerDown, onItemDoubleClick }: { items: InstrumentItem[] } & ItemHandlers) {
  return (
    <div className="@container">
    <div className="grid grid-cols-1 gap-2 px-2 @[448px]:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.id}
          data-instrument-id={item.id}
          onPointerDown={(e) => onItemPointerDown(e, item)}
          onDoubleClick={() => onItemDoubleClick(item)}
          // Hovering a card is intent: fetch its (lazy) visual so a drop mounts
          // it without a chunk round-trip. No-op for non-instrument items.
          onPointerEnter={() => { void preloadInstrument(item.id) }}
          title={item.description}
          className="group min-w-0 cursor-default select-none overflow-hidden rounded-md"
        >
          {/* Borderless like the template cards: the preview's own pixels carry
              the card's edge, with the app background behind the ids that
              render an icon or nameplate instead of a full frame. */}
          <div className="relative aspect-video bg-[var(--bg-app)]">
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
    </div>
  )
}

/** Logic-style drill-down browser. Every folder is a plain row you click
 *  into; a sticky back row returns one level; instrument cards appear only at
 *  the level that holds them. `rootItems` lets a view keep items at the very
 *  top level (the Main scene's directors) without a folder to click through.
 *  Memoized: the sidebar re-renders on every droppable/ghost flip of a drag,
 *  and this subtree (cards, previews) is by far its heaviest part. The folder
 *  trees are module constants and both handlers are stable (useCallback), so
 *  the memo holds across those flips. */
const FolderBrowser = memo(function FolderBrowser({ folders, rootItems = [], onItemPointerDown, onItemDoubleClick }: { folders: LibraryFolder[]; rootItems?: InstrumentItem[] } & ItemHandlers) {
  // The trail of entered folders, root-first. The folder trees are module
  // constants, so a held reference can never go stale.
  const [path, setPath] = useState<LibraryFolder[]>([])
  const current = path[path.length - 1]
  const folderRows = (current ? current.subfolders ?? [] : folders)
    // An empty folder is a dead-end click - hide it until it has contents.
    .filter((f) => f.items.length > 0 || (f.subfolders?.length ?? 0) > 0)
  const items = current ? current.items : rootItems

  return (
    <div className="flex min-h-full flex-col">
      {/* The way back, at the top of the list (right under the library
          header): whole trail as a breadcrumb, click = up one level. Sticky
          so it stays in reach while the list scrolls. */}
      {current ? (
        <button
          type="button"
          onClick={() => setPath(path.slice(0, -1))}
          aria-label={`Back to ${path[path.length - 2]?.title ?? 'the library'}`}
          className="sticky top-0 z-20 flex h-[30px] w-full flex-shrink-0 cursor-pointer select-none items-center gap-2.5 bg-[var(--bg-shell)] px-3 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_8%,var(--bg-shell))]"
        >
          <ChevronLeft size={12} className="flex-shrink-0 text-[var(--text-muted)]" />
          <span className="min-w-0 truncate text-[13px] text-[var(--text)]">
            {path.map((folder) => folder.title).join(' / ')}
          </span>
        </button>
      ) : null}
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
            className="mx-2 flex h-[30px] cursor-default select-none items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-2)]">{folder.title}</span>
            <ChevronRight size={12} className="flex-shrink-0 text-[var(--text-muted)]" />
          </div>
        ))}
      </div>
    </div>
  )
})

type LibraryTab = LibraryTabId

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
  const { go } = useInstantNavigation()
  const projectId = useSearchParams().get('project')
  // Covers the editor while the applied template autosaves before handing
  // off to /lyric-setup (which re-hydrates the project from its row).
  const [leaving, setLeaving] = useState(false)

  if (activeIsMain) {
    return (
      <p className="px-3 pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
        Templates apply inside a visual scene - switch off the Composite to use one.
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
        go(projectId ? `/lyric-setup?project=${projectId}` : '/lyric-setup')
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

/* The three library-tab marks. Drawn here rather than taken from lucide
 * because the shipped set (Shapes / Repeat / LayoutTemplate) had two glyphs
 * sharing one silhouette at 13px - small outlined rectangles - so Instruments
 * and Templates could only be told apart by hovering. These three differ by
 * OUTER SHAPE, which is the only thing that survives the icon-only fallback:
 * a hexagon, a wide rounded pane, a frame with a horizon.
 *
 * Instruments and Loops are duotone on one rule: a dim plane at ~0.38-0.55
 * with the load-bearing part lit at full. The tab row rests at --text-muted,
 * and a plane much below 0.38 of that disappears into --bg-shell entirely -
 * that opacity is the first thing to check if these ever look hollow. */
const TAB_ICON_SIZE = 13

/** A cube by its three faces - the library's first instrument, and the shape
 *  the mover previews ghost. */
function CubeMark() {
  return (
    <svg width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden className="flex-shrink-0">
      <path d="M12 2.2 21 7.4 12 12.6 3 7.4Z" />
      <path d="M2.6 8.6 11.4 13.7v8.1L2.6 16.7Z" opacity="0.55" />
      <path d="M21.4 8.6 12.6 13.7v8.1l8.8-5.1Z" opacity="0.33" />
    </svg>
  )
}

/** A MIDI block: dim pane, lit notes - the same contrast the timeline draws a
 *  resting clip with (near-black pane, neon notes; see midiBlockPalette). */
function BlockMark() {
  return (
    <svg width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} viewBox="0 0 24 24" fill="currentColor" aria-hidden className="flex-shrink-0">
      <rect x="2" y="4.5" width="20" height="15" rx="3" opacity="0.38" />
      <rect x="5" y="7.6" width="7" height="2.6" rx="1.3" />
      <rect x="13" y="11" width="6" height="2.6" rx="1.3" />
      <rect x="7.5" y="14.4" width="5" height="2.6" rx="1.3" />
    </svg>
  )
}

/** A framed composition - horizon and an object already placed, which is what
 *  applying a template gives you. Stroked at lucide's weight on purpose: it
 *  keeps one outlined mark in the row against the two duotone ones. */
function FramedSceneMark() {
  return (
    <svg
      width={TAB_ICON_SIZE} height={TAB_ICON_SIZE} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden className="flex-shrink-0"
    >
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <path d="M2.5 15.5h19" />
      <circle cx="9" cy="10.5" r="2.5" />
    </svg>
  )
}

const LIBRARY_TABS: { id: LibraryTab; label: string; Mark: () => ReactElement }[] = [
  { id: 'instruments', label: 'Instruments', Mark: CubeMark },
  { id: 'loops', label: 'Loops', Mark: BlockMark },
  { id: 'templates', label: 'Templates', Mark: FramedSceneMark },
]

export function LeftSidebar() {
  const [tab, setTab] = useState<LibraryTab>('instruments')
  // The empty scene's action list can ask for a tab (see UIStore.libraryRequest);
  // App opens the pane, this switches what's inside it.
  const libraryRequest = useUIStore((s) => s.libraryRequest)
  useEffect(() => {
    if (libraryRequest) setTab(libraryRequest.tab)
  }, [libraryRequest])
  const { startLibraryDrag, ghostRef, ghostName } = useLibraryDrag()
  const { startLoopBlockDrag, ghostRef: loopGhostRef, ghostName: loopGhostName } = useLoopBlockDrag()
  const [loopHover, setLoopHover] = useState<{ pattern: LoopPattern; left: number; top: number } | null>(null)
  // Over a valid drop slot → show a "+" on the ghost to signal "release to add".
  const droppable = useUIStore((s) => !!s.trackDrop && (s.trackDrop.line != null || s.trackDrop.intoId != null))
  // The swap-in-place target's current name, for the ghost's "Replace X" text.
  // Selected as a STRING so the per-pointermove trackDrop identity churn during
  // a drag doesn't re-render the whole library while hovering one row.
  const replaceOldName = useUIStore((s) => s.trackDrop?.replace?.oldName ?? null)
  // Double-click converts the selected track to the item (no-op if nothing selected).
  const setTrackInstrument = useProjectStore((s) => s.setTrackInstrument)
  const setTrackMover = useProjectStore((s) => s.setTrackMover)
  const wrapTracksInSwitcher = useProjectStore((s) => s.wrapTracksInSwitcher)
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  // Stable (the deps are store actions): it is FolderBrowser's memo contract -
  // an inline closure here would re-render every card on each sidebar render.
  const onItemDoubleClick = useCallback((item: InstrumentItem) => {
    const selectedTrackId = useUIStore.getState().selectedTrackId
    if (!selectedTrackId) return
    // Composition instruments (the 'director' library kind) go through the
    // same conversion as any instrument - setTrackInstrument seeds their
    // scene bindings when the Main scene is active.
    // A rack is a CONTAINER, so double-click WRAPS the selection rather than
    // converting it - converting would destroy the very track you meant to put
    // in the rack. (Word Formation set the precedent for a card that adds
    // around/under the selection instead of replacing it.)
    if (item.kind === 'switcher') {
      const id = wrapTracksInSwitcher([selectedTrackId])
      if (id) useUIStore.getState().setSelectedTrackId(id)
    }
    else if (item.kind === 'mover' || item.kind === 'splitter' || item.kind === 'colorizer') setTrackMover(selectedTrackId, item.id, item.name)
    else setTrackInstrument(selectedTrackId, item.id, item.name)
  }, [wrapTracksInSwitcher, setTrackMover, setTrackInstrument])

  // No border-r on the root: the PanelResizeHandle beside this panel already
  // draws a 1px --border line, and having both made the library's divider twice
  // the width of every other divider in the editor.
  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--bg-shell)]">
      {/* One warm preview canvas for all sections' hover popups. */}
      <InstrumentPreviewLayer />
      {/* All live 3D cards share this renderer, avoiding browser WebGL-context
          exhaustion when several two-column sections are visible. */}
      {/* One header row: LIBRARY (the landing preview's mono-caps voice) on the
          left, the three section tabs across from it - fill appears only on
          hover / selection.

          The row is a @container with ONE threshold, and the collapse order is
          deliberate: the LABELS go first, and LIBRARY only gives ground after
          they already have (at the very bottom of the range it ellipsizes rather
          than disappearing). An earlier version dropped the caption first, in
          the band where labelled tabs fit alone - the tabs do name the panel, so
          it reads fine in isolation - but the caption vanishing while the tabs
          are still fully dressed looks like a bug mid-drag, and it means two
          different things disappear on the way down instead of one.

          The number is MEASURED in Hanken Grotesk, not guessed: the three pills
          lay out at 320px alongside the caption, including this row's 20px of
          padding. It reads 310 because a container query sizes against the
          CONTENT box - the padding is already subtracted out - so labels appear
          at a sidebar width of ~330, ~10px clear of the measurement. Re-measure
          if the UI font or a tab's name changes; a fourth tab would blow past
          the default width entirely. (The sidebar is 8-30% of the window, so
          ~115-430px, and a 1280-wide window at the 25% default lands at 320 -
          just under the threshold, so that size shows icons.) */}
      <div className="@container relative z-10 flex flex-shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] py-1.5 pl-3 pr-2">
        {/* The caption never leaves on its own - it only gives ground after the
            labels already have. min-w-0 + truncate covers the very bottom of the
            range, where at the panel's 8% minimum there isn't room for the
            caption AND three 24px targets: it ellipsizes rather than shoving the
            tabs, which without this squeeze to ~9px with the icons overhanging. */}
        <span className="min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] select-none">Library</span>
        <div className="flex flex-shrink-0 items-center gap-1">
          {LIBRARY_TABS.map(({ id, label, Mark }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={label}
              aria-label={label}
              aria-pressed={tab === id}
              className={`flex h-6 w-6 flex-shrink-0 items-center justify-center gap-1.5 rounded-md transition-colors cursor-pointer @[310px]:w-auto @[310px]:px-1.5 ${
                tab === id
                  ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] hover:text-[var(--text-2)]'
              }`}
            >
              <Mark />
              <span className="hidden truncate text-[11px] font-medium @[310px]:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div data-library-scroll className={`timeline-scrollbar relative z-10 flex-1 overflow-y-auto ${tab === 'instruments' ? '' : 'pb-4'}`}>
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
                className="flex items-center gap-2.5 h-[26px] px-3 cursor-default hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] transition-colors select-none"
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
          {replaceOldName ? (
            <>
              <ArrowLeftRight size={13} className="text-[var(--accent)]" strokeWidth={2.5} />
              <span className="text-[var(--text-3)]">Replace {replaceOldName} —</span>
            </>
          ) : (
            droppable && <Plus size={13} className="text-[var(--accent)]" strokeWidth={2.5} />
          )}
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
