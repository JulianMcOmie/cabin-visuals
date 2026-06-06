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

export function LeftSidebar() {
  return (
    <div className="w-48 flex-shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-950 overflow-y-auto">
      <div className="px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Instruments</span>
      </div>
      <Section title="Source" items={SOURCE_INSTRUMENTS} />
      <Section title="Modifier" items={MODIFIER_INSTRUMENTS} />
    </div>
  )
}
