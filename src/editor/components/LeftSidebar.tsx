'use client'

import { useState, useRef, useEffect, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronDown, ChevronRight, Plus, Ban, EyeOff, Replace, Sparkles, Info } from 'lucide-react'
import { useLibraryDrag } from './useLibraryDrag'
import { useEffectDrag } from './useEffectDrag'
import { useUIStore } from '../store/UIStore'
import { useProjectStore } from '../store/ProjectStore'
import { PLUGIN_LIST } from '../plugins'
import type { TrackType } from '../types'

/** What dragging an item creates: an object/modulator instrument track, or an
 *  event-modifier child track (whose `id` is the modifier's track type). */
export type LibraryKind = 'object' | 'modulator' | 'modifier'

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
  { id: 'cylinderFlight', name: 'Cylinder Flight', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <ellipse cx="6" cy="3" rx="3.5" ry="1.3" fill="none" stroke="#ec4899" strokeWidth="1.1" />
      <path d="M2.5 3 V9 M9.5 3 V9" stroke="#ec4899" strokeWidth="1.1" />
      <path d="M2.5 9 A3.5 1.3 0 0 0 9.5 9" fill="none" stroke="#ec4899" strokeWidth="1.1" />
    </svg>
  )},
  { id: 'sun', name: 'Sun', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="2.5" fill="none" stroke="#ff9d00" strokeWidth="1.2" />
      <path d="M6 0.5V2 M6 10V11.5 M0.5 6H2 M10 6H11.5 M2.3 2.3L3.3 3.3 M8.7 8.7L9.7 9.7 M9.7 2.3L8.7 3.3 M3.3 8.7L2.3 9.7" stroke="#ff9d00" strokeWidth="1" strokeLinecap="round" />
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
  { id: 'square', name: 'Square', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="#8B00FF" strokeWidth="1.2" />
      <path d="M2.5 6 H9.5" stroke="#8B00FF" strokeWidth="1" />
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
  { id: 'silkSymmetry', name: 'Silk Symmetry', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="none" stroke="#8b5cf6" strokeWidth="1">
        <circle cx="6" cy="6" r="4.5" /><path d="M6 1.5 Q9 6 6 10.5 Q3 6 6 1.5" /><path d="M1.5 6 Q6 9 10.5 6 Q6 3 1.5 6" />
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
  { id: 'diamondLattice', name: 'Diamond Lattice', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="6,1 9,6 6,11 3,6" fill="none" stroke="#ec4899" strokeWidth="1.2" />
      <polygon points="6,3.5 7.5,6 6,8.5 4.5,6" fill="none" stroke="#ec4899" strokeWidth="1" />
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
  { id: 'particleBassRing', name: 'Particle Bass Ring', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <g fill="#f472b6">
        <circle cx="6" cy="1.5" r="0.8" /><circle cx="9.2" cy="2.8" r="0.8" /><circle cx="10.5" cy="6" r="0.8" /><circle cx="9.2" cy="9.2" r="0.8" /><circle cx="6" cy="10.5" r="0.8" /><circle cx="2.8" cy="9.2" r="0.8" /><circle cx="1.5" cy="6" r="0.8" /><circle cx="2.8" cy="2.8" r="0.8" />
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
  { id: 'beatParticleKit', name: 'Beat Particle Kit', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect width="12" height="12" rx="2" fill="#e2e8f0" />
      <circle cx="4" cy="7" r="2.4" fill="#111827" /><circle cx="8.4" cy="4.6" r="1.5" fill="#111827" /><circle cx="9" cy="8.6" r="0.9" fill="#111827" />
    </svg>
  )},
  { id: 'cameraControl', name: 'Camera', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <rect x="1" y="3.5" width="7.5" height="5.5" rx="1" fill="none" stroke="#818cf8" strokeWidth="1" />
      <path d="M8.5 5.3 L11 4 V8.5 L8.5 7.2 Z" fill="none" stroke="#818cf8" strokeWidth="1" strokeLinejoin="round" />
      <circle cx="4.5" cy="6.25" r="1.4" fill="none" stroke="#818cf8" strokeWidth="1" />
    </svg>
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
      <div className="flex items-center px-3 py-1.5 text-xs font-medium text-zinc-400 select-none">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 hover:text-zinc-200 transition-colors"
        >
          {title}
          {open ? <ChevronDown size={11} className="text-zinc-500" /> : <ChevronRight size={11} className="text-zinc-500" />}
        </button>
        <div className="flex-1" />
        <div
          className="relative flex items-center"
          onMouseEnter={openAfterDelay}
          onMouseLeave={cancelHover}
        >
          <button
            className={`transition-colors ${infoOpen ? 'text-zinc-300' : 'text-zinc-600 hover:text-zinc-300'}`}
            aria-label={`About ${title}`}
          >
            <Info size={12} />
          </button>
          {infoOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-40 w-52 p-2.5 rounded border border-zinc-700 bg-[#202024] text-[11px] font-normal leading-relaxed text-zinc-300 shadow-lg shadow-black/50">
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
              onPointerDown={(e) => onItemPointerDown(e, item)}
              onDoubleClick={() => onItemDoubleClick(item)}
              title={`Drag ${item.name} into the track list to add it, or double-click to set the selected track's instrument`}
              className="flex items-center gap-2.5 px-4 py-1.5 cursor-default hover:bg-zinc-800/60 transition-colors select-none"
            >
              <span className="flex-shrink-0 flex items-center justify-center w-4">
                {item.icon}
              </span>
              <span className="text-xs text-zinc-300">{item.name}</span>
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
  const onItemDoubleClick = (item: InstrumentItem) => {
    const selectedTrackId = useUIStore.getState().selectedTrackId
    if (!selectedTrackId) return
    if (item.kind === 'modifier') setTrackModifier(selectedTrackId, item.id as TrackType, item.name)
    else setTrackInstrument(selectedTrackId, item.id, item.name)
  }

  return (
    <div className="flex flex-col h-full border-r border-zinc-800 bg-[#1e1e21] overflow-hidden">
      <div className="px-3 pt-2 pb-1.5 border-b border-zinc-800">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2">
          Library
        </div>
        <div className="flex gap-0.5 bg-zinc-800 rounded p-0.5">
          <button
            onClick={() => setTab('instruments')}
            className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${
              tab === 'instruments'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Instruments
          </button>
          <button
            onClick={() => setTab('effects')}
            className={`flex-1 py-1 text-[11px] font-medium rounded transition-colors ${
              tab === 'effects'
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Effects
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'instruments' && (
          <>
            <Section title="Object" description="An Object instrument is a visual object that renders in the 3D scene — a shape whose notes drive its pulse. Drag one onto the tracks to add it." items={OBJECT_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Modulator" description="A Modulator instrument drives an object's internal ports (energy, scale, hue) from its own notes. Route it to one or more objects to animate them." items={MODULATOR_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
            <Section title="Modifier" description="A Modifier instrument is a child of an object that reshapes its parent's notes before they play — suppress, mute, add, or override. Has no visual of its own." items={MODIFIER_INSTRUMENTS} onItemPointerDown={startLibraryDrag} onItemDoubleClick={onItemDoubleClick} />
          </>
        )}
        {tab === 'effects' && (
          <div>
            {PLUGIN_LIST.map((plugin) => (
              <div
                key={plugin.id}
                onPointerDown={(e) => startEffectDrag(e, plugin)}
                title={`Drag ${plugin.name} onto a track's Effects panel`}
                className="flex items-center gap-2.5 px-4 py-1.5 cursor-default hover:bg-zinc-800/60 transition-colors select-none"
              >
                <span className="flex-shrink-0 flex items-center justify-center w-4">
                  <Sparkles size={12} className="text-zinc-400" />
                </span>
                <span className="text-xs text-zinc-300">{plugin.name}</span>
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
          className="fixed z-50 pointer-events-none flex items-center gap-1.5 px-3 rounded border border-zinc-700 bg-[#202024] text-xs font-medium text-white shadow-lg shadow-black/40"
          style={{ left: 0, top: 0, height: 28, transform: 'translate(-50%, -50%)' }}
        >
          {droppable && <Plus size={13} className="text-green-400" strokeWidth={2.5} />}
          {ghostName}
        </div>
      )}

      {/* Ghost while dragging an effect onto the Track Editor's Effects panel. */}
      {effectGhostName && (
        <div
          ref={effectGhostRef}
          className="fixed z-50 pointer-events-none flex items-center gap-1.5 px-3 rounded border border-zinc-700 bg-[#202024] text-xs font-medium text-white shadow-lg shadow-black/40"
          style={{ left: 0, top: 0, height: 28, transform: 'translate(-50%, -50%)' }}
        >
          <Sparkles size={12} className="text-zinc-400" />
          {effectGhostName}
        </div>
      )}
    </div>
  )
}
