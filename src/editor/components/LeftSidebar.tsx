'use client'

import { useState, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronRight, Plus, Ban, EyeOff, Replace, Sparkles, Info } from 'lucide-react'
import { useLibraryDrag } from './useLibraryDrag'
import { useEffectDrag } from './useEffectDrag'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { PLUGIN_LIST } from '../effects'
import { moverRegistry } from '../core/visual/movers/registry'
import type { TrackType } from '../types'

/** What dragging an item creates: an object/modulator instrument track, or an
 *  event-modifier child track (whose `id` is the modifier's track type). */
export type LibraryKind = 'object' | 'modulator' | 'modifier' | 'mover'

export interface InstrumentItem {
  id: string
  name: string
  icon: React.ReactNode
  kind: LibraryKind
}

const withKind = (kind: LibraryKind, items: Omit<InstrumentItem, 'kind'>[]): InstrumentItem[] =>
  items.map((i) => ({ ...i, kind }))

const OBJECT_INSTRUMENTS = withKind('object', [
  { id: 'cube', name: 'Cube', icon: <div className="w-3 h-3 border border-indigo-400 rounded-sm" /> },
  { id: 'swarm', name: 'Swarm', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#22d3ee">
        <circle cx="6" cy="1.5" r="0.8" /><circle cx="9.2" cy="2.8" r="0.8" /><circle cx="10.5" cy="6" r="0.8" />
        <circle cx="9.2" cy="9.2" r="0.8" /><circle cx="6" cy="10.5" r="0.8" /><circle cx="2.8" cy="9.2" r="0.8" />
        <circle cx="1.5" cy="6" r="0.8" /><circle cx="2.8" cy="2.8" r="0.8" />
      </g>
    </svg>
  )},
  { id: 'pointLight', name: 'Point Light', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="5" r="2.5" fill="#facc15" />
      <path d="M4.7 8.3 H7.3 M5 10 H7" stroke="#fde68a" strokeWidth="1" strokeLinecap="round" />
      <path d="M6 0.8 V1.8 M1.7 5 H2.7 M9.3 5 H10.3 M3 2 L3.7 2.7 M9 2 L8.3 2.7" stroke="#facc15" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  )},
  { id: 'circle', name: 'Circle', icon: <div className="w-3 h-3 border border-indigo-400 rounded-full" /> },
  { id: 'triangle', name: 'Triangle', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="6,1 11,11 1,11" fill="none" stroke="#818cf8" strokeWidth="1.2" />
    </svg>
  )},
  { id: 'icosahedronBurst', name: 'Icosahedron Burst', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6 1 L11 6 L6 11 L1 6 Z" fill="none" stroke="#22d3ee" strokeWidth="1.2" />
    </svg>
  )},
  { id: 'hexagonDots', name: 'Hexagon Dots', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="6,1 10.3,3.5 10.3,8.5 6,11 1.7,8.5 1.7,3.5" fill="none" stroke="#4ecdc4" strokeWidth="1.1" />
    </svg>
  )},
  { id: 'particleRiser', name: 'Particle Riser', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M4 11 Q4 6 6 1 Q8 6 8 11" fill="none" stroke="#a78bfa" strokeWidth="1.1" />
      <circle cx="6" cy="2" r="0.7" fill="#a78bfa" />
    </svg>
  )},
  { id: 'textDisplay', name: 'Text Display', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <text x="6" y="9.5" fontSize="11" fontWeight="900" fontFamily="Arial Black, sans-serif" textAnchor="middle" fill="#818cf8">T</text>
    </svg>
  )},
  { id: 'stars', name: 'Stars', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#fbbf24">
        <circle cx="6" cy="6" r="1.4" /><circle cx="2" cy="2.5" r="0.8" /><circle cx="10" cy="3" r="0.7" />
        <circle cx="3" cy="9.5" r="0.7" /><circle cx="9.5" cy="9" r="0.9" /><circle cx="1.5" cy="6" r="0.5" /><circle cx="11" cy="6.5" r="0.5" />
      </g>
    </svg>
  )},
  { id: 'particleBurst', name: 'Particle Burst', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#f59e0b">
        <circle cx="6" cy="6" r="1.4" /><circle cx="6" cy="1.5" r="0.8" /><circle cx="6" cy="10.5" r="0.8" /><circle cx="1.5" cy="6" r="0.8" /><circle cx="10.5" cy="6" r="0.8" />
        <circle cx="2.8" cy="2.8" r="0.7" /><circle cx="9.2" cy="2.8" r="0.7" /><circle cx="2.8" cy="9.2" r="0.7" /><circle cx="9.2" cy="9.2" r="0.7" />
      </g>
    </svg>
  )},
  { id: 'circleGrid', name: 'Circle Grid', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#14b8a6">
        <circle cx="3" cy="3" r="1.2" /><circle cx="6" cy="3" r="1.2" /><circle cx="9" cy="3" r="1.2" />
        <circle cx="3" cy="6" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="9" cy="6" r="1.2" />
        <circle cx="3" cy="9" r="1.2" /><circle cx="6" cy="9" r="1.2" /><circle cx="9" cy="9" r="1.2" />
      </g>
    </svg>
  )},
  { id: 'fractalTunnel', name: 'Fractal Tunnel', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="none" stroke="#8b5cf6" strokeWidth="1">
        <circle cx="6" cy="6" r="1.5" /><circle cx="6" cy="6" r="3.5" /><circle cx="6" cy="6" r="5.5" />
      </g>
    </svg>
  )},
  { id: 'neonPolar', name: 'Neon Polar', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M6 1 Q10 3 9 6 Q11 9 6 11 Q1 9 3 6 Q2 3 6 1 Z" fill="none" stroke="#22d3ee" strokeWidth="1" />
    </svg>
  )},
  { id: 'hopfFibration', name: 'Hopf Fibration', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#818cf8" strokeWidth="0.9">
      <ellipse cx="6" cy="6" rx="5" ry="2.2" /><ellipse cx="6" cy="6" rx="2.2" ry="5" /><circle cx="6" cy="6" r="4" />
    </svg>
  )},
  { id: 'particleStreams', name: 'Particle Streams', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#60a5fa">
        <circle cx="6" cy="6" r="1.3" /><circle cx="9" cy="4" r="0.8" /><circle cx="10.5" cy="3" r="0.5" /><circle cx="8.5" cy="8.5" r="0.8" /><circle cx="10" cy="10" r="0.5" />
        <circle cx="3" cy="4" r="0.8" /><circle cx="1.5" cy="3" r="0.5" /><circle cx="3.5" cy="8.5" r="0.8" /><circle cx="2" cy="10" r="0.5" />
      </g>
    </svg>
  )},
  { id: 'shapeFlight', name: 'Shape Flight', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#f59e0b" strokeWidth="1">
      <polygon points="6,1 10,6 6,11 2,6" /><polygon points="6,3.5 8,6 6,8.5 4,6" />
    </svg>
  )},
  { id: 'dotField', name: 'Dot Field', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#38bdf8">
        <circle cx="6" cy="6" r="1.1" /><circle cx="6" cy="2" r="0.8" /><circle cx="9.5" cy="4.5" r="0.8" /><circle cx="8.5" cy="8.5" r="0.8" /><circle cx="3.5" cy="8.5" r="0.8" /><circle cx="2.5" cy="4.5" r="0.8" />
      </g>
    </svg>
  )},
  { id: 'metronomeBalls', name: 'Metronome Balls', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="#94a3b8">
      <path d="M6 6 L10 3 M6 6 L2 3 M6 6 L3 10 M6 6 L9 10" stroke="#94a3b8" strokeWidth="0.6" fill="none" />
      <circle cx="6" cy="6" r="1" /><circle cx="10" cy="3" r="1" /><circle cx="2" cy="3" r="1" /><circle cx="3" cy="10" r="1" /><circle cx="9" cy="10" r="1" />
    </svg>
  )},
  { id: 'folderFlight', name: 'Folder Flight', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M1 3.5 L4.5 3.5 L5.5 2.5 L1 2.5 Z" fill="#f7d774" stroke="#d4a840" strokeWidth="0.3" />
      <rect x="1" y="3.5" width="9" height="6" rx="0.6" fill="#f7d774" stroke="#d4a840" strokeWidth="0.3" />
    </svg>
  )},
  { id: 'emojiDisplay', name: 'Emoji Display', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5.5" fill="#ffcc00" />
      <circle cx="4" cy="5" r="1" fill="#000" /><circle cx="8" cy="5" r="1" fill="#000" />
      <path d="M3.5 7.5 Q6 10 8.5 7.5" fill="none" stroke="#000" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )},
  { id: 'cameraControl', name: 'Camera', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="3.5" width="7.5" height="5.5" rx="1" fill="none" stroke="#818cf8" strokeWidth="1" />
      <path d="M8.5 5.3 L11 4 V8.5 L8.5 7.2 Z" fill="none" stroke="#818cf8" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="4.5" cy="6.25" r="1.4" fill="none" stroke="#818cf8" strokeWidth="1" />
    </svg>
  )},
  { id: 'windowsXp', name: 'Windows XP', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="1" width="10" height="10" rx="1.5" fill="#ECE9D8" stroke="#0054E3" />
      <rect x="1" y="1" width="10" height="3.2" rx="1.5" fill="#0058ee" />
    </svg>
  )},
  { id: 'crtScanlines', name: 'CRT Scanlines', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="2" width="10" height="8" rx="2" fill="none" stroke="#3aff8c" strokeWidth="1"/><line x1="3" y1="4.5" x2="9" y2="4.5" stroke="#3aff8c" strokeWidth="0.7" opacity="0.8"/><line x1="3" y1="6" x2="9" y2="6" stroke="#3aff8c" strokeWidth="0.7" opacity="0.5"/><line x1="3" y1="7.5" x2="9" y2="7.5" stroke="#3aff8c" strokeWidth="0.7" opacity="0.3"/></svg>
  )},
  { id: 'paddleBounce', name: 'Paddle Bounce', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="4" width="1.4" height="4" fill="#22d3ee"/><rect x="9.6" y="4" width="1.4" height="4" fill="#22d3ee"/><rect x="5" y="5" width="2" height="2" fill="#ffffff"/><rect x="3.6" y="6.4" width="1" height="1" fill="#ffffff" opacity="0.4"/></svg>
  )},
  { id: 'pixelBlast', name: 'Pixel Blast', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="5" y="5" width="2" height="2" fill="#ffec27"/><rect x="2" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="8.6" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="5.3" y="2" width="1.4" height="1.4" fill="#ff004d"/><rect x="5.3" y="8.6" width="1.4" height="1.4" fill="#ff004d"/><rect x="2.8" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="2.8" y="8.2" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="8.2" width="1" height="1" fill="#ffa300"/></svg>
  )},
  { id: 'pixelInvaders', name: 'Pixel Invaders', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2h1v1h4V2h1v1h1v2h1v3h-1v1h-1v1H8V9H4v1H3V9H2V8H1V5h1V3h1V2z" fill="#39ff14"/><rect x="4" y="5" width="1" height="1" fill="#04070a"/><rect x="7" y="5" width="1" height="1" fill="#04070a"/></svg>
  )},
  { id: 'scoreTicker', name: 'Score Ticker', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/><rect x="4.8" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/><rect x="8.6" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/></svg>
  )},
])

// Event modifiers — dropped into an object, they transform its note stream at resolve
// (their `id` is the track type). No instrument; edited as MIDI regions.
const MODIFIER_INSTRUMENTS = withKind('modifier', [
  { id: 'suppress', name: 'Suppress', icon: <Ban size={12} className="text-zinc-400" /> },
  { id: 'mute', name: 'Mute', icon: <EyeOff size={12} className="text-zinc-400" /> },
  { id: 'add', name: 'Add', icon: <Plus size={12} className="text-zinc-400" /> },
  { id: 'override', name: 'Override', icon: <Replace size={12} className="text-zinc-400" /> },
])

const MODULATOR_INSTRUMENTS = withKind('modulator', [
  { id: 'pulse', name: 'Pulse', icon: (
    <svg width="14" height="10" viewBox="0 0 14 10">
      <polyline points="0,5 3,5 4,1 5,9 6,5 10,5" fill="none" stroke="#818cf8" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )},
  { id: 'flip', name: 'Flip', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path d="M2 6 L6 2 L10 6" fill="none" stroke="#818cf8" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 6 L6 10 L10 6" fill="none" stroke="#818cf8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )},
  { id: 'colorShift', name: 'Color Shift', icon: (
    <div className="flex gap-0.5">
      <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
    </div>
  )},
])

const MOVER_INSTRUMENTS = withKind('mover', Object.values(moverRegistry).map((d) => ({
  id: d.id,
  name: d.label,
  icon: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#22d3ee" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6 H10" />
      <path d="M7 3 L10 6 L7 9" />
      <path d="M4 3 L2 6 L4 9" />
    </svg>
  ),
})))

function Section({ title, description, items, onItemPointerDown, onItemDoubleClick }: { title: string; description: string; items: InstrumentItem[]; onItemPointerDown: (e: ReactPointerEvent, item: InstrumentItem) => void; onItemDoubleClick: (item: InstrumentItem) => void }) {
  const [open, setOpen] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
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
        {/* Caps section row — clicking the label still collapses/expands the list. */}
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
              onPointerDown={(e) => onItemPointerDown(e, item)}
              onDoubleClick={() => onItemDoubleClick(item)}
              title={`Drag ${item.name} into the track list to add it, or double-click to set the selected track's instrument`}
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

type LibraryTab = 'instruments' | 'effects'

export function LeftSidebar() {
  const [tab, setTab] = useState<LibraryTab>('instruments')
  const { startLibraryDrag, ghostRef, ghostName } = useLibraryDrag()
  const { startEffectDrag, ghostRef: effectGhostRef, ghostName: effectGhostName } = useEffectDrag()
  // Over a valid drop slot → show a "+" on the ghost to signal "release to add".
  const droppable = useUIStore((s) => !!s.trackDrop && (s.trackDrop.line != null || s.trackDrop.intoId != null))
  // Double-click converts the selected track to the item (no-op if nothing selected).
  const setTrackInstrument = useProjectStore((s) => s.setTrackInstrument)
  const setTrackModifier = useProjectStore((s) => s.setTrackModifier)
  const setTrackMover = useProjectStore((s) => s.setTrackMover)
  const onItemDoubleClick = (item: InstrumentItem) => {
    const selectedTrackId = useUIStore.getState().selectedTrackId
    if (!selectedTrackId) return
    if (item.kind === 'modifier') setTrackModifier(selectedTrackId, item.id as TrackType, item.name)
    else if (item.kind === 'mover') setTrackMover(selectedTrackId, item.id, item.name)
    else setTrackInstrument(selectedTrackId, item.id, item.name)
  }

  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden">
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
          className={`flex-1 h-7 text-[11px] transition-colors cursor-pointer ${
            tab === 'effects'
              ? 'bg-[var(--bg-app)] text-[var(--text)] font-semibold shadow-[inset_0_-2px_0_var(--accent)]'
              : 'bg-transparent text-[var(--text-muted)] font-medium hover:text-[var(--text-2)]'
          }`}
        >
          Effects
        </button>
      </div>

      <div className="flex-1 overflow-y-auto timeline-scrollbar pb-4">
        {tab === 'instruments' && (
          <>
            <Section title="Object" description="An Object instrument is a visual object that renders in the 3D scene — a shape whose notes drive its pulse. Drag one onto the tracks to add it." items={OBJECT_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Modulator" description="A Modulator instrument drives an object's internal ports (energy, scale, hue) from its own notes. Route it to one or more objects to animate them." items={MODULATOR_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Mover" description="A Mover is a child transform row. Its inputs can be edited, automated, or driven by modulators." items={MOVER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Modifier" description="A Modifier instrument is a child of an object that reshapes its parent's notes before they play — suppress, mute, add, or override. Has no visual of its own." items={MODIFIER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
          </>
        )}
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
          className="fixed z-50 pointer-events-none flex items-center gap-1.5 px-3 rounded border border-[var(--border)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text)] shadow-lg shadow-black/40"
          style={{ left: 0, top: 0, height: 28, transform: 'translate(-50%, -50%)' }}
        >
          {droppable && <Plus size={13} className="text-[var(--accent)]" strokeWidth={2.5} />}
          {ghostName}
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
