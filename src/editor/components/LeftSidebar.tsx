'use client'

import { useState, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronRight, Plus, Sparkles, Info, LayoutTemplate, Repeat } from 'lucide-react'
import { useLibraryDrag } from './useLibraryDrag'
import { useEffectDrag } from './useEffectDrag'
import { useLoopBlockDrag } from './useLoopBlockDrag'
import { LOOP_PATTERNS, type LoopPattern } from './loops'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { PLUGIN_LIST } from '../effects'
import { listMoverOrSplitterDefinitions } from '../core/visualCopies/registry'
import { canPreview, setInstrumentPreview, InstrumentPreviewLayer } from './InstrumentHoverPreview'
import { TEMPLATES } from '../../templates'
import { track as trackEvent } from '../../analytics/analytics'
import { waitForSaved } from '../../persistence/autosave'
import { LoadingScreen } from '../../components/LoadingScreen'

/** What dragging an item creates. */
export type LibraryKind = 'object' | 'modulator' | 'mover' | 'splitter' | 'director'

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
  { id: 'cube', name: 'Cube', description: 'A cube that swells and glows with every note.', icon: <div className="w-3 h-3 border border-indigo-400 rounded-sm" /> },
  { id: 'pointLight', name: 'Point Light', description: 'A colored light that flares brighter with each note.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="5" r="2.5" fill="#facc15" />
      <path d="M4.7 8.3 H7.3 M5 10 H7" stroke="#fde68a" strokeWidth="1" strokeLinecap="round" />
      <path d="M6 0.8 V1.8 M1.7 5 H2.7 M9.3 5 H10.3 M3 2 L3.7 2.7 M9 2 L8.3 2.7" stroke="#facc15" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  )},
  { id: 'circle', name: 'Circle', description: 'A sphere that swells and glows with every note.', icon: <div className="w-3 h-3 border border-indigo-400 rounded-full" /> },
  { id: 'triangle', name: 'Triangle', description: 'A tetrahedron that swells and glows with every note.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="6,1 11,11 1,11" fill="none" stroke="#818cf8" strokeWidth="1.2" />
    </svg>
  )},
  { id: 'icosahedronBurst', name: 'Icosahedron Burst', description: 'Each note spawns an expanding, fading wireframe shell.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6 1 L11 6 L6 11 L1 6 Z" fill="none" stroke="#22d3ee" strokeWidth="1.2" />
    </svg>
  )},
  { id: 'hexagonDots', name: 'Hexagon Dots', description: 'Each note spawns a spinning ring of dots drifting toward the camera.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="6,1 10.3,3.5 10.3,8.5 6,11 1.7,8.5 1.7,3.5" fill="none" stroke="#4ecdc4" strokeWidth="1.1" />
    </svg>
  )},
  { id: 'particleRiser', name: 'Particle Riser', description: 'Each note launches a rising column of particles.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M4 11 Q4 6 6 1 Q8 6 8 11" fill="none" stroke="#a78bfa" strokeWidth="1.1" />
      <circle cx="6" cy="2" r="0.7" fill="#a78bfa" />
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
  { id: 'circleGrid', name: 'Circle Grid', description: 'A grid of glowing dots whose pattern steps forward with each note.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#14b8a6">
        <circle cx="3" cy="3" r="1.2" /><circle cx="6" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" />
        <circle cx="3" cy="6" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
        <circle cx="3" cy="9" r="1.2" /><circle cx="6" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
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
  { id: 'particleStreams', name: 'Particle Streams', description: 'Each note bursts particle strings rushing toward the camera.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#60a5fa">
        <circle cx="6" cy="6" r="1.3" /><circle cx="9" cy="4" r="0.8" /><circle cx="10.5" cy="3" r="0.5" /><circle cx="8.5" cy="8.5" r="0.8" /><circle cx="10" cy="10" r="0.5" />
        <circle cx="3" cy="4" r="0.8" /><circle cx="1.5" cy="3" r="0.5" /><circle cx="3.5" cy="8.5" r="0.8" /><circle cx="2" cy="10" r="0.5" />
      </g>
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
  { id: 'folderFlight', name: 'Folder Flight', description: 'Each note pops a folder icon that tumbles away into depth.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 3.5 L4.5 3.5 L5.5 2.5 L1 2.5 Z" fill="#f7d774" stroke="#d4a840" strokeWidth="0.3" />
      <rect x="1" y="3.5" width="9" height="6" rx="0.6" fill="#f7d774" stroke="#d4a840" strokeWidth="0.3" />
    </svg>
  )},
  { id: 'emojiDisplay', name: 'Emoji Display', description: 'A grid of emoji rearranged by notes - swaps, spins, and flips.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5.5" fill="#ffcc00" />
      <circle cx="4" cy="5" r="1" fill="#000" /><circle cx="8" cy="5" r="1" fill="#000" />
      <path d="M3.5 7.5 Q6 10 8.5 7.5" fill="none" stroke="#000" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )},
  { id: 'windowsXp', name: 'Windows XP', description: 'A Windows XP desktop - notes spawn windows, swap wallpaper, and shake the screen.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="1" width="10" height="10" rx="1.5" fill="#ECE9D8" stroke="#0054E3" />
      <rect x="1" y="1" width="10" height="3.2" rx="1.5" fill="#0058ee" />
    </svg>
  )},
  { id: 'crtScanlines', name: 'CRT Scanlines', description: "A retro CRT that flashes in each note's pitch color.", icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="2" width="10" height="8" rx="2" fill="none" stroke="#3aff8c" strokeWidth="1"/><line x1="3" y1="4.5" x2="9" y2="4.5" stroke="#3aff8c" strokeWidth="0.7" opacity="0.8"/><line x1="3" y1="6" x2="9" y2="6" stroke="#3aff8c" strokeWidth="0.7" opacity="0.5"/><line x1="3" y1="7.5" x2="9" y2="7.5" stroke="#3aff8c" strokeWidth="0.7" opacity="0.3"/></svg>
  )},
  { id: 'paddleBounce', name: 'Paddle Bounce', description: 'A Pong rally crossing once per beat - notes smash the ball faster.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="4" width="1.4" height="4" fill="#22d3ee"/><rect x="9.6" y="4" width="1.4" height="4" fill="#22d3ee"/><rect x="5" y="5" width="2" height="2" fill="#ffffff"/><rect x="3.6" y="6.4" width="1" height="1" fill="#ffffff" opacity="0.4"/></svg>
  )},
  { id: 'pixelBlast', name: 'Pixel Blast', description: 'Each note detonates chunky 8-bit particles - pitch sets position.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="5" y="5" width="2" height="2" fill="#ffec27"/><rect x="2" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="8.6" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="5.3" y="2" width="1.4" height="1.4" fill="#ff004d"/><rect x="5.3" y="8.6" width="1.4" height="1.4" fill="#ff004d"/><rect x="2.8" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="2.8" y="8.2" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="8.2" width="1" height="1" fill="#ffa300"/></svg>
  )},
  { id: 'pixelInvaders', name: 'Pixel Invaders', description: 'Marching pixel invaders - each note fires the cannon at one.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2h1v1h4V2h1v1h1v2h1v3h-1v1h-1v1H8V9H4v1H3V9H2V8H1V5h1V3h1V2z" fill="#39ff14"/><rect x="4" y="5" width="1" height="1" fill="#04070a"/><rect x="7" y="5" width="1" height="1" fill="#04070a"/></svg>
  )},
  { id: 'scoreTicker', name: 'Score Ticker', description: 'A giant pixel score that ticks up as notes play.', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/><rect x="4.8" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/><rect x="8.6" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/></svg>
  )},
])

// The curated core: a few good shapes, kept deliberately short so the library
// reads as intentional. Everything else lives in the collapsed Extras section
// at the bottom - still available, out of the first impression.
const CORE_OBJECT_IDS = new Set(['cube', 'circle', 'triangle', 'shapeFlight', 'particleBurst'])
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

function Section({ title, description, items, onItemPointerDown, onItemDoubleClick, defaultOpen = true }: { title: string; description: string; items: InstrumentItem[]; onItemPointerDown: (e: ReactPointerEvent, item: InstrumentItem) => void; onItemDoubleClick: (item: InstrumentItem) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [infoOpen, setInfoOpen] = useState(false)
  // Hover preview: after a short dwell on a row, aim the shared preview layer
  // (one warm canvas for the whole sidebar - see InstrumentPreviewLayer).
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enterRow = (e: React.MouseEvent, item: InstrumentItem) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(
      () => setInstrumentPreview({ item, anchor: { left: rect.right, top: rect.top } }),
      100,
    )
  }
  const leaveRow = () => {
    if (previewTimer.current) clearTimeout(previewTimer.current)
    setInstrumentPreview(null)
  }
  useEffect(() => () => { if (previewTimer.current) clearTimeout(previewTimer.current) }, [])
  // Show the info popup after a short hover dwell; hide immediately on leave.
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const openAfterDelay = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => setInfoOpen(true), 250)
  }
  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setInfoOpen(false)
  }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current) }, [])

  return (
    <div>
      <div className="flex items-center justify-between px-3 pt-3 pb-1 select-none">
        {/* Caps section row - clicking the label still collapses/expands the list. */}
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)] hover:text-[var(--text-2)] transition-colors cursor-pointer"
        >
          {title}
          {!open && <ChevronRight size={10} className="text-[var(--text-muted)]" />}
        </button>
        <div
          className="relative flex items-center"
          onMouseEnter={openAfterDelay}
          onMouseLeave={cancelHover}
        >
          <button
            className={`transition-colors cursor-pointer ${infoOpen ? 'text-[var(--text-2)]' : 'text-[var(--border-strong)] hover:text-[var(--text-2)]'}`}
            aria-label={`About ${title}`}
          >
            <Info size={11} />
          </button>
          {infoOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-40 w-52 p-2.5 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] font-normal normal-case tracking-normal leading-relaxed text-[var(--text-2)] shadow-lg shadow-black/50">
              {description}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div>
          {items.map((item) => (
            <div
              key={item.id}
              data-instrument-id={item.id}
              onPointerDown={(e) => { leaveRow(); onItemPointerDown(e, item) }}
              onDoubleClick={() => onItemDoubleClick(item)}
              onMouseEnter={(e) => enterRow(e, item)}
              onMouseLeave={leaveRow}
              title={canPreview(item) ? undefined : item.description}
              className="flex items-center gap-2.5 h-[26px] px-3 cursor-default hover:bg-[var(--bg-elevated)] transition-colors select-none"
            >
              <span className="flex-shrink-0 flex items-center justify-center w-3.5">
                {item.icon}
              </span>
              <span className="text-xs text-[var(--text-2)] truncate">{item.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type LibraryTab = 'instruments' | 'effects' | 'loops' | 'templates'

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
    applyTemplate(tpl.document)
    trackEvent('template_applied', { template: tpl.id })
    // Anything pointing at the replaced tracks is stale now.
    const ui = useUIStore.getState()
    ui.setEditingBlock(null)
    ui.setSelectedTrackId(null)
    ui.setSelectedBlockIds(new Set())
    // The Lyric Video template continues on its own setup route (song →
    // transcribe → align) - after the applied tracks have saved, since that
    // page re-hydrates the project from its row.
    if (tpl.id === 'lyricVideo') {
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
        Double-click a template to switch this project onto it. Your song stays.
      </p>
      {TEMPLATES.map((tpl) => (
        <div
          key={tpl.id}
          onDoubleClick={() => apply(tpl)}
          title={tpl.description}
          className="flex items-center gap-2.5 h-[26px] px-3 cursor-default hover:bg-[var(--bg-elevated)] transition-colors select-none"
        >
          <span className="flex-shrink-0 flex items-center justify-center w-3.5">
            <LayoutTemplate size={12} className="text-[var(--text-3)]" />
          </span>
          <span className="text-xs text-[var(--text-2)] truncate">{tpl.name}</span>
        </div>
      ))}
    </div>
  )
}

export function LeftSidebar() {
  const [tab, setTab] = useState<LibraryTab>('instruments')
  const { startLibraryDrag, ghostRef, ghostName } = useLibraryDrag()
  const { startEffectDrag, ghostRef: effectGhostRef, ghostName: effectGhostName } = useEffectDrag()
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
    else if (item.kind === 'mover' || item.kind === 'splitter') setTrackMover(selectedTrackId, item.id, item.name)
    else setTrackInstrument(selectedTrackId, item.id, item.name)
  }

  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
      {/* One warm preview canvas for all sections' hover popups. */}
      <InstrumentPreviewLayer />
      <div className="h-8 flex-shrink-0 flex items-center px-3 border-b border-[var(--border)] text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)] select-none">
        LIBRARY
      </div>
      <div className="flex flex-shrink-0 border-b border-[var(--border)]">
        <button
          onClick={() => setTab('instruments')}
          className={`flex-1 h-7 text-[11px] border-r border-[var(--border)] transition-colors cursor-pointer ${
            tab === 'instruments'
              ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
              : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
          }`}
        >
          Instruments
        </button>
        <button
          onClick={() => setTab('effects')}
          className={`flex-1 h-7 text-[11px] border-r border-[var(--border)] transition-colors cursor-pointer ${
            tab === 'effects'
              ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
              : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
          }`}
        >
          Effects
        </button>
        <button
          onClick={() => setTab('loops')}
          className={`flex-1 h-7 text-[11px] border-r border-[var(--border)] transition-colors cursor-pointer ${
            tab === 'loops'
              ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
              : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
          }`}
        >
          Loops
        </button>
        <button
          onClick={() => setTab('templates')}
          className={`flex-1 h-7 text-[11px] transition-colors cursor-pointer ${
            tab === 'templates'
              ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
              : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
          }`}
        >
          Templates
        </button>
      </div>

      <div className="flex-1 overflow-y-auto timeline-scrollbar pb-4">
        {tab === 'instruments' && (
          <>
            {activeIsMain ? (
              <Section title="Director" description="Director instruments render and composite one or more visual scenes into Main." items={DIRECTOR_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            ) : <>
            <Section title="Main" description="Scene-wide essentials: Camera, Video, Photo, Text, Oscilloscope, and MIDI-driven Color Filters." items={MAIN_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Object" description="An Object instrument is a visual object that renders in the 3D scene - for example, a cube or sphere." items={OBJECT_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            {/* Modulators are retired from the library (movers replace them);
                the code stays until existing projects are migrated off ports. */}
            <Section title="Mover" description="A Mover moves, spins, scales, or fades any object - add one under a track (or drag onto one) and drive it with notes." items={MOVER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Splitter" description="A Splitter renders its object several times, giving each copy its own reference frame - movers BELOW the splitter move every copy along its own axes." items={SPLITTER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
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
        {tab === 'effects' && (
          <div className="pt-1">
            {PLUGIN_LIST.map((plugin) => (
              <div
                key={plugin.id}
                onPointerDown={(e) => startEffectDrag(e, plugin)}
                title={`Drag ${plugin.name} onto a track's Effects panel`}
                className="flex items-center gap-2.5 h-[26px] px-3 cursor-default hover:bg-[var(--bg-elevated)] transition-colors select-none"
              >
                <span className="flex-shrink-0 flex items-center justify-center w-3.5">
                  <Sparkles size={12} className="text-zinc-400" />
                </span>
                <span className="text-xs text-[var(--text-2)] truncate">{plugin.name}</span>
              </div>
            ))}
          </div>
        )}
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

      {/* Ghost while dragging an effect onto the Track Editor's Effects panel. */}
      {effectGhostName && (
        <div
          ref={effectGhostRef}
          className="fixed z-50 pointer-events-none flex items-center gap-1.5 px-3 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text)] shadow-lg shadow-black/40"
          style={{ left: 0, top: 0, height: 28, transform: 'translate(-50%, -50%)' }}
        >
          <Sparkles size={12} className="text-zinc-400" />
          {effectGhostName}
        </div>
      )}
    </div>
  )
}
