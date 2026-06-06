'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface InstrumentItem {
  id: string
  name: string
  icon: React.ReactNode
}

const SOURCE_INSTRUMENTS: InstrumentItem[] = [
  { id: 'cube', name: 'Cube', icon: <div className="w-3 h-3 border border-indigo-400 rounded-sm" /> },
  { id: 'circle', name: 'Circle', icon: <div className="w-3 h-3 border border-indigo-400 rounded-full" /> },
  { id: 'triangle', name: 'Triangle', icon: (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <polygon points="6,1 11,11 1,11" fill="none" stroke="#818cf8" strokeWidth="1.2" />
    </svg>
  )},
]

const MODIFIER_INSTRUMENTS: InstrumentItem[] = [
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
      <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
      <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
      <div className="w-1.5 h-1.5 rounded-full bg-pink-400" />
    </div>
  )},
]

function Section({ title, items }: { title: string; items: InstrumentItem[] }) {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors select-none"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {title}
      </button>
      {open && (
        <div>
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2.5 px-4 py-1.5 cursor-pointer hover:bg-zinc-800/60 transition-colors select-none"
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

  return (
    <div className="flex flex-col h-full border-r border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="px-3 pt-2 pb-1.5 border-b border-zinc-800">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2">
          Library
        </div>
        <div className="flex gap-0.5 bg-zinc-900 rounded p-0.5">
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
            <Section title="Source" items={SOURCE_INSTRUMENTS} />
            <Section title="Modifier" items={MODIFIER_INSTRUMENTS} />
          </>
        )}
        {tab === 'effects' && (
          <p className="text-xs text-zinc-600 text-center mt-8 px-3">No effects available</p>
        )}
      </div>
    </div>
  )
}
