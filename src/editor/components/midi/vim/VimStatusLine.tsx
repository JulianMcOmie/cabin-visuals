'use client'

import type { MidiRow } from '../types'
import { TYPING_KEYS } from './keyMap'
import type { VimState } from './types'

/** Beats → the shortest honest name. Anything odd falls back to the number. */
export function beatLabel(beats: number): string {
  const named: [number, string][] = [
    [1 / 8, '1/32'],
    [1 / 6, '1/16T'],
    [1 / 4, '1/16'],
    [1 / 3, '1/8T'],
    [1 / 2, '1/8'],
    [2 / 3, '1/4T'],
    [1, '1/4'],
    [1.5, '1/4.'],
    [2, '1/2'],
    [3, '1/2.'],
    [4, 'bar'],
    [8, '2 bars'],
  ]
  for (const [value, label] of named) {
    if (Math.abs(value - beats) < 1e-4) return label
  }
  return `${Math.round(beats * 100) / 100}b`
}

/**
 * The readout. It is the mode's main teaching surface: it makes the invisible
 * state (where the cursor is, how big its step is, what mode you're in) visible,
 * and its right end carries only the keys that do something RIGHT NOW — so the
 * vocabulary arrives in the order you need it instead of as a wall.
 */
export function VimStatusLine({
  state,
  rows,
  beatsPerBar,
  stepBeats,
  selectedCount,
  accent,
  onExit,
}: {
  state: VimState
  rows: MidiRow[]
  beatsPerBar: number
  stepBeats: number
  selectedCount: number
  accent: string
  onExit: () => void
}) {
  const bar = Math.floor(state.cursorBeat / beatsPerBar) + 1
  const beatInBar = state.cursorBeat - (bar - 1) * beatsPerBar
  const row = rows[state.cursorRow]

  const hints =
    state.mode === 'draft'
      ? [['z x c v', 'nudge'], [state.draft?.kind === 'copy' ? 'n' : 'm', 'drop'], ['esc', 'cancel']]
      : state.mode === 'select'
        ? [['z x c v', 'shape'], ['note keys', 'rows'], ['m n', 'move copy'], ['r', 'repeat'], ['b', 'delete']]
        : state.staged.length > 0 || state.staging
          ? [['note keys', 'stage'], ['return', 'commit chord'], ['esc', 'clear']]
          : [['note keys', 'write'], ['z x c v', 'move'], ['space', 'rest'], ['tab', 'select']]

  const modeLabel =
    state.mode === 'draft' ? (state.draft?.kind === 'copy' ? 'COPY' : 'MOVE') : state.mode === 'select' ? 'SELECT' : 'VIM'

  return (
    <div className="flex h-6 flex-shrink-0 items-center gap-3 border-t border-zinc-800 bg-zinc-900/80 px-3 font-mono text-[10px] text-zinc-500">
      <button
        onClick={onExit}
        title="Leave midi vim (Esc)"
        className="rounded px-1.5 font-semibold tracking-[0.08em] transition-opacity hover:opacity-80"
        style={{ background: accent, color: '#0b0d12' }}
      >
        {modeLabel}
      </button>

      <span className="text-zinc-300">
        {bar}:{(Math.floor(beatInBar) + 1).toString()}
        <span className="text-zinc-600">.{Math.round((beatInBar % 1) * 100).toString().padStart(2, '0')}</span>
      </span>

      {row && <span className="max-w-[140px] truncate text-zinc-400">{row.noteLabel ?? row.label}</span>}

      <span>grid <span className="text-zinc-300">{beatLabel(stepBeats)}</span></span>
      <span>len <span className="text-zinc-300">{beatLabel(state.noteLengthBeats)}</span></span>

      {state.count && <span style={{ color: accent }}>×{state.count}</span>}
      {state.staged.length > 0 && <span style={{ color: accent }}>{state.staged.length} staged</span>}
      {state.staging && state.staged.length === 0 && <span style={{ color: accent }}>staging</span>}
      {state.mode === 'select' && <span style={{ color: accent }}>{selectedCount} notes</span>}

      <div className="flex-1" />

      <div className="hidden items-center gap-2.5 md:flex">
        {hints.map(([keys, what]) => (
          <span key={keys} className="whitespace-nowrap">
            <span className="text-zinc-400">{keys}</span> {what}
          </span>
        ))}
        <span className="whitespace-nowrap"><span className="text-zinc-400">?</span> keys</span>
      </div>
    </div>
  )
}

const SHEET: { title: string; items: [string, string][] }[] = [
  {
    title: 'Write',
    items: [
      [TYPING_KEYS.join(' '), 'the note keys — write and step on'],
      ['⌘ + note', 'move to that row without writing'],
      ['1-9 then note', 'write it that many times'],
      ['space', 'rest — step on without writing'],
      ['return', 'write the cursor’s own row'],
      ['⇧ + note', 'stage a chord note'],
      ['⇧ tap', 'latch staging, then return to commit'],
      ['( )', 'note length'],
    ],
  },
  {
    title: 'Move',
    items: [
      ['z x', 'left / right by one step'],
      ['c v', 'down / up one row'],
      ['⇧ z x', 'by the bar'],
      ['⇧ c v', 'by the octave'],
      ['/ \\', 'to the next / previous note'],
      ['[ ]', 'grid step'],
      ['- =', 'zoom'],
    ],
  },
  {
    title: 'Select & edit',
    items: [
      ['tab', 'start a region — z x c v shape it'],
      ['note keys', 'in a region: keep only those rows'],
      ['⇧ a', 'the whole block'],
      ['m / n', 'move / copy — nudge, then the same key drops it'],
      ['r', 'repeat the region after itself'],
      ['b', 'delete'],
      [', .', 'undo / redo'],
      ['esc', 'back one level, then out'],
    ],
  },
  {
    title: 'Transport',
    items: [
      ['⇧ space', 'play / pause'],
      ['⇧ return', 'back to the start'],
      ['⇧⇧', 'the way in, from anywhere in the roll'],
    ],
  },
]

/** The one place the whole vocabulary is written down, reached from a hint the
 *  status line shows constantly. */
export function VimKeySheet({ accent, onClose }: { accent: string; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-700 bg-[#0f1118] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>midi vim</h2>
          <span className="text-[11px] text-zinc-500">esc closes · esc again leaves the mode</span>
        </div>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SHEET.map((section) => (
            <section key={section.title}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500">{section.title}</h3>
              <dl className="space-y-1">
                {section.items.map(([keys, what]) => (
                  <div key={keys} className="flex gap-3 text-[11px]">
                    <dt className="w-[130px] flex-shrink-0 font-mono text-zinc-300">{keys}</dt>
                    <dd className="text-zinc-500">{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
