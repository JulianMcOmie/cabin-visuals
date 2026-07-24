'use client'

import { useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Check, ChevronRight, Plus, Sparkles, CircleHelp, LayoutTemplate, Repeat, Shapes } from 'lucide-react'
import { useLibraryDrag } from './useLibraryDrag'
import { useLoopBlockDrag } from './useLoopBlockDrag'
import { LOOP_PATTERNS, type LoopPattern } from './loops'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { listMoverOrSplitterDefinitions } from '../core/visualCopies/registry'
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

// The essentials most projects reach for first - surfaced above the object list.
// They are ordinary object instruments; only the grouping differs.
const MAIN_INSTRUMENTS = withKind('object', [
  { id: 'cameraControl', name: 'Camera', description: 'Drives the scene camera - each note punches a dolly-in and a shake.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="3.5" width="7.5" height="5.5" rx="1" fill="none" stroke="#818cf8" strokeWidth="1" />
      <path d="M8.5 5.3 L11 4 V8.5 L8.5 7.2 Z" fill="none" stroke="#818cf8" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="4.5" cy="6.25" r="1.4" fill="none" stroke="#818cf8" strokeWidth="1" />
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
  { id: 'colorFilters', name: 'Color Filters', description: 'Applies scene-wide color remaps while its labeled MIDI notes are held.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="4.2" cy="4.5" r="3" fill="none" stroke="#22d3ee" strokeWidth="1" />
      <circle cx="7.8" cy="4.5" r="3" fill="none" stroke="#f472b6" strokeWidth="1" />
      <circle cx="6" cy="7.7" r="3" fill="none" stroke="#facc15" strokeWidth="1" />
    </svg>
  )},
])

const DIRECTOR_INSTRUMENTS = withKind('director', [
  { id: 'sceneSwitcher', name: 'Scene Switcher', description: 'Shows the most recently started scene row only while its MIDI note remains held.', icon: <Sparkles size={12} className="text-indigo-400" /> },
  { id: 'cut', name: 'Cut', description: 'Partitions the frame between held scene rows, with straight or diagonal cuts.', icon: <Sparkles size={12} className="text-fuchsia-400" /> },
  { id: 'radialCut', name: 'Radial Cut', description: 'Partitions held scene rows into concentric rings from the center outward.', icon: <Sparkles size={12} className="text-cyan-400" /> },
])

// Every object instrument, icons and all. Partitioned below into the curated
// core list and the Extras back catalog - nothing is removed, only demoted.
const ALL_OBJECT_INSTRUMENTS = withKind('object', [
  { id: 'cube', name: '3D Shape', description: 'A solid - cube, sphere, tetrahedron and friends - that swells and glows with every note.', icon: <div className="w-3 h-3 border border-indigo-400 rounded-sm" /> },
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
])

// The curated core: a few good shapes, kept deliberately short so the library
// reads as intentional. Everything else lives in the collapsed Extras section
// at the bottom - still available, out of the first impression.
// Circle and Triangle left the library outright - 3D Shape's geometry picker
// covers them (the instruments stay registered for old projects).
const CORE_OBJECT_IDS = new Set(['cube', 'laserSphere', 'laserLine', 'shapeFlight', 'particleBurst'])
const OBJECT_INSTRUMENTS = ALL_OBJECT_INSTRUMENTS.filter((i) => CORE_OBJECT_IDS.has(i.id))
const EXTRA_INSTRUMENTS = ALL_OBJECT_INSTRUMENTS.filter((i) => !CORE_OBJECT_IDS.has(i.id))

// The registry defs carry no user-facing copy, so the tooltip sentences live here.
const MOVER_DESCRIPTIONS: Record<string, string> = {
  burst: 'Steps its object a burst in a cardinal direction per note - steps accumulate, velocity scales distance.',
  radial: 'Splits its object into N copies fanned around a circle - movers below it move each copy along its own axes.',
}

const MOVER_INSTRUMENTS = withKind('mover', listMoverOrSplitterDefinitions()
  .filter((d) => d.kind === 'mover')
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
      ? 'Turns hue calmly with signed MIDI, optionally spreading the amount across splitter-copy indices.'
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
  ...MAIN_INSTRUMENTS,
  ...DIRECTOR_INSTRUMENTS,
  ...ALL_OBJECT_INSTRUMENTS,
  ...MOVER_INSTRUMENTS,
  ...COLORIZER_INSTRUMENTS,
  ...SPLITTER_INSTRUMENTS,
]

function Section({ title, description, items, onItemPointerDown, onItemDoubleClick, defaultOpen = true }: { title: string; description: string; items: InstrumentItem[]; onItemPointerDown: (e: ReactPointerEvent, item: InstrumentItem) => void; onItemDoubleClick: (item: InstrumentItem) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="@container">
      <div className="flex items-center gap-1 px-3 pt-3 pb-1 select-none">
        {/* Caps section row - clicking the label still collapses/expands the list. */}
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex items-center text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)] transition-colors cursor-pointer hover:text-[var(--text-2)]"
        >
          {title}
        </button>
        <TooltipPrimitive.Provider delayDuration={250} skipDelayDuration={100}>
          <TooltipPrimitive.Root>
            <TooltipPrimitive.Trigger asChild>
              <button
                type="button"
                className="flex size-3.5 flex-shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--border-strong)] transition-colors hover:text-[var(--text-2)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] data-[state=delayed-open]:text-[var(--text-2)] data-[state=instant-open]:text-[var(--text-2)]"
                aria-label={`About ${title}`}
              >
                <CircleHelp size={11} aria-hidden="true" />
              </button>
            </TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipPrimitive.Content
                side="right"
                align="start"
                sideOffset={8}
                collisionPadding={8}
                avoidCollisions
                sticky="always"
                className="z-[100] max-h-[calc(100vh-1rem)] w-52 max-w-[calc(100vw-1rem)] overflow-y-auto rounded border border-[var(--border)] bg-[var(--bg-elevated)] p-2.5 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-[var(--text-2)] shadow-lg shadow-black/50"
              >
                {description}
              </TooltipPrimitive.Content>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
          aria-expanded={open}
          className="ml-auto flex size-4 flex-shrink-0 cursor-pointer items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)]"
        >
          <ChevronRight
            size={10}
            className={`transition-transform ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </div>
      {open && (
        <div className="grid grid-cols-1 gap-2 px-2 @[176px]:grid-cols-2">
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
      )}
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
  const appliedTemplateId = useProjectStore((s) => s.appliedTemplateId)
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
      {/* Same preview treatment as the projects-page template gallery, sized
          for the sidebar: one card per template, its real render (or bespoke
          animation) looping above the name. */}
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
      className={`mx-2 mb-2 cursor-default select-none overflow-hidden rounded-md border bg-[var(--bg-app)] transition-colors ${
        selected
          ? 'border-[var(--accent)]'
          : 'border-[var(--border)] hover:border-[rgba(53,167,230,0.6)]'
      }`}
    >
      {/* True 16:9 box: capture clips are 640×360, so they fit exactly -
          never stretched, never cropped. */}
      <div className="relative aspect-video bg-[var(--bg-app)]">
        {tpl.cardPreview === 'animatedSlideshow'
          ? <TemplateSlideshowPreview />
          : tpl.cardPreview === 'animatedLyric'
            ? <TemplateLyricPreview templateId={tpl.id} />
            : <TemplatePreviewVideo id={tpl.id} />}
      </div>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <LayoutTemplate size={11} className="flex-shrink-0 text-[var(--text-3)]" />
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-2)]">{label ?? tpl.name}</span>
        {selected && (
          <span className="flex flex-shrink-0 items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--accent)]">
            <Check size={10} strokeWidth={3} />
            Current
          </span>
        )}
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
  const setTrackDirector = useProjectStore((s) => s.setTrackDirector)
  const activeIsMain = useProjectStore((s) => !!s.scenes[s.activeSceneId]?.isMain)
  const onItemDoubleClick = (item: InstrumentItem) => {
    const selectedTrackId = useUIStore.getState().selectedTrackId
    if (!selectedTrackId) return
    if (item.kind === 'director') setTrackDirector(selectedTrackId, item.id, item.name)
    else if (item.kind === 'mover' || item.kind === 'splitter' || item.kind === 'colorizer') setTrackMover(selectedTrackId, item.id, item.name)
    else setTrackInstrument(selectedTrackId, item.id, item.name)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--bg-panel)]">
      {/* One warm preview canvas for all sections' hover popups. */}
      <InstrumentPreviewLayer />
      {/* All live 3D cards share this renderer, avoiding browser WebGL-context
          exhaustion when several two-column sections are visible. */}
      {tab === 'instruments' && <InstrumentCardPreviewCanvas />}
      {/* @container so the tabs show icon-only when the (resizable) sidebar is
          narrow, and icon + label once there's room for the text. */}
      <div className="@container relative z-10 flex flex-shrink-0 border-b border-[var(--border)]">
        {([
          { id: 'instruments', label: 'Instruments', Icon: Shapes },
          { id: 'loops', label: 'Loops', Icon: Repeat },
          { id: 'templates', label: 'Templates', Icon: LayoutTemplate },
        ] as const).map(({ id, label, Icon }, i, arr) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            title={label}
            className={`flex-1 h-7 flex items-center justify-center gap-1.5 text-[11px] transition-colors cursor-pointer ${
              i < arr.length - 1 ? 'border-r border-[var(--border)]' : ''
            } ${
              tab === id
                ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold'
                : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
            }`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <span className="hidden @[224px]:inline truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="timeline-scrollbar relative z-10 flex-1 overflow-y-auto pb-4">
        {tab === 'instruments' && (
          <>
            {activeIsMain ? (
              <Section title="Directors" description="Director instruments render and composite one or more visual scenes into Main." items={DIRECTOR_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            ) : <>
            <Section title="Main" description="Scene-wide essentials: Camera, Video, Photo, Text, Oscilloscope, and MIDI-driven Color Filters." items={MAIN_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Objects" description="Object instruments are visual objects that render in the 3D scene - for example, cubes or spheres." items={OBJECT_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            {/* Modulators are retired from the library (movers replace them);
                the code stays until existing projects are migrated off ports. */}
            <Section title="Movers" description="Movers move, spin, scale, or fade objects - add them under tracks (or drag them onto tracks) and drive them with notes." items={MOVER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Colorizers" description="Colorizers change objects' material colors in ordered mover/splitter chains, driven by their own MIDI rows." items={COLORIZER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Splitters" description="Splitters render their objects several times, giving each copy its own reference frame - movers BELOW a splitter move every copy along its own axes." items={SPLITTER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Extras" description="The back catalog: older object instruments, all still fully working - just outside the curated core list above." items={EXTRA_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} defaultOpen={false} />
            </>}
          </>
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
