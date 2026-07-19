'use client'

import { useState, type KeyboardEvent } from 'react'
import { isNumberParam } from '../instruments/types'
import { ParamControl, ParamSlider } from './ParameterControl'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Emoji Display settings: the space-separated emoji string becomes a tactile
// chip grid - click a chip to remove it, type in the add box to append (spaces
// split into multiple). The grid's own gap and padding lean into the spread and
// padding params so the palette itself hints at the layout. Grid and motion
// sliders live in their own labelled groups below.

function find(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((p) => p.definition.key === key)
}

function num(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function SliderRow({ bound, label }: { bound?: UserInterfaceParameter; label?: string }) {
  if (!bound || !isNumberParam(bound.definition) || typeof bound.value !== 'number') return null
  const d = bound.definition
  return <ParamSlider label={label ?? d.label} value={bound.value} min={d.min} max={d.max} step={d.step} onChange={bound.setValue} />
}

function parseEmojis(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

function EmojiPalette({ bound, spread, padding }: { bound: UserInterfaceParameter; spread: number; padding: number }) {
  const [draft, setDraft] = useState('')
  if (typeof bound.value !== 'string') return null
  const emojis = parseEmojis(bound.value)

  const removeAt = (index: number) => {
    const next = emojis.filter((_, i) => i !== index)
    bound.setValue(next.join(' '))
  }

  const append = () => {
    const added = parseEmojis(draft)
    if (added.length === 0) return
    bound.setValue([...emojis, ...added].join(' '))
    setDraft('')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    append()
  }

  return (
    <div className="mb-1 rounded-[3px] border border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2 py-1">
        <span className="text-[9px] font-semibold tracking-[0.09em] text-[var(--text-muted)] select-none">PALETTE</span>
        <span className="font-mono text-[9px] tabular-nums text-[var(--text-muted)]">{emojis.length}</span>
      </div>
      {/* gap/padding wink at the spread/padding params */}
      <div
        className="flex max-h-[132px] flex-wrap overflow-y-auto"
        style={{ gap: `${Math.round(3 + spread * 4)}px`, padding: `${Math.round(6 + padding * 40)}px` }}
      >
        {emojis.length === 0 && (
          <span className="text-[10px] text-[var(--text-muted)]">No emojis yet - add some below</span>
        )}
        {emojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            title="Click to remove"
            aria-label={`Remove ${emoji}`}
            onClick={() => removeAt(i)}
            className="group relative flex h-7 w-7 items-center justify-center rounded-[3px] border border-[var(--border)] bg-[var(--bg-app)] text-[15px] leading-none transition-colors hover:border-[var(--border-strong)] cursor-pointer"
          >
            <span className="transition-opacity group-hover:opacity-30">{emoji}</span>
            <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-[11px] text-[var(--text-2)] opacity-0 transition-opacity group-hover:opacity-100">×</span>
          </button>
        ))}
      </div>
      <div className="flex gap-1 border-t border-[var(--border-subtle)] p-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Add emojis…"
          aria-label="Add emojis (space-separated)"
          className="h-6 min-w-0 flex-1 rounded-[2px] border border-[var(--border)] bg-[var(--bg-app)] px-2 text-[12px] text-[var(--text-2)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
        />
        <button
          onClick={append}
          disabled={parseEmojis(draft).length === 0}
          className="h-6 rounded-[2px] border border-[var(--border)] bg-[var(--bg-elevated)] px-2 text-[10px] font-semibold tracking-[0.05em] text-[var(--text-3)] transition-colors hover:text-[var(--text)] disabled:opacity-30 disabled:hover:text-[var(--text-3)] cursor-pointer disabled:cursor-default"
        >
          ADD
        </button>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mb-1.5 mt-3 text-[9px] font-semibold tracking-[0.09em] text-[var(--text-muted)] select-none">{children}</p>
  )
}

function Leftovers({ parameters, placed }: { parameters: readonly UserInterfaceParameter[]; placed: readonly string[] }) {
  const placedSet = new Set(placed)
  const rest = parameters.filter((p) => !placedSet.has(p.definition.key))
  if (rest.length === 0) return null
  return (
    <div className="mt-3 border-t border-[var(--border)] pt-3">
      {rest.map((p) => {
        const numeric = typeof p.value === 'number'
        return (
          <ParamControl
            key={p.definition.key}
            param={p.definition}
            numValue={numeric ? (p.value as number) : undefined}
            strValue={numeric ? undefined : (p.value as string)}
            onNum={p.setValue}
            onStr={p.setValue}
          />
        )
      })}
    </div>
  )
}

export const EmojiDisplayUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const emojis = find(parameters, 'emojis')
  const fontSize = find(parameters, 'fontSize')
  const opacity = find(parameters, 'opacity')
  const moveSpeed = find(parameters, 'moveSpeed')
  const padding = find(parameters, 'padding')
  const spread = find(parameters, 'spread')
  const placed = ['emojis', 'fontSize', 'opacity', 'moveSpeed', 'padding', 'spread']

  return (
    <section data-testid="emojidisplay-user-interface">
      {emojis && <EmojiPalette bound={emojis} spread={num(spread, 1)} padding={num(padding, 0.1)} />}

      <SectionLabel>GRID</SectionLabel>
      <SliderRow bound={fontSize} label="Size" />
      <SliderRow bound={padding} label="Padding" />
      <SliderRow bound={spread} label="Spread" />

      <SectionLabel>MOTION</SectionLabel>
      <SliderRow bound={moveSpeed} label="Move Speed" />
      <SliderRow bound={opacity} label="Opacity" />

      <Leftovers parameters={parameters} placed={placed} />
    </section>
  )
}
