'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, Mic, Plus, X } from 'lucide-react'
import { track as trackEvent } from '../../analytics/analytics'
import { ensureFont } from '../core/visual/fonts'
import { isNumberParam } from '../instruments/types'
import { useProjectStore } from '../store/ProjectStore'
import { MAX_STYLE_LANES, laneIndexForPitch, resolveStyleLanes, styleLanePitch, trackLyricClips } from '../core/visual/lyricClips'
import type { LyricClipLayout, LyricLayoutKind, StyleLaneFx } from '../types'
import { placeTranscription } from '../utils/lyricPlacement'
import { firstAudioBlock, transcribeActiveSong, type TranscribePhase } from '../utils/transcribeSong'
import { ParamControl, ParamSlider, ParamToggle } from './ParameterControl'
import { ColorWheelPopover, useColorPopoverDismiss } from './colorWheel'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

// Bespoke settings for the Text Display instrument. Since the clips redesign
// the panel's subjects are the track's STYLE LANES (what each piano-roll row
// makes a word look like - rendered font cards, swatches plus a free colour
// wheel, size chips, no sliders) and its LYRIC CLIPS (the words + each clip's layout), then the
// animation controls grouped the way you think about them (Motion / Echo /
// Flight / Particles). Gated params (showIf) never reach this component -
// each group renders whatever of its members are present, so headers stay
// honest when a toggle is off.

function findParam(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numberOf(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

/** Preview families for the font select's option values - presentation-only
 *  mirrors of the instrument's internal FONT_STACKS. */
const FONT_PREVIEWS: Record<number, { family: string; short: string; load?: string }> = {
  0: { family: '"Arial Black", Impact, sans-serif', short: 'IMPACT' },
  1: { family: 'Georgia, "Times New Roman", serif', short: 'SERIF' },
  2: { family: '"Courier New", monospace', short: 'MONO' },
  3: { family: 'Arial, Helvetica, sans-serif', short: 'SANS' },
  4: { family: '"IM Fell English SC", Georgia, serif', short: 'FELL SC', load: 'IM Fell English SC' },
  5: { family: '"IM Fell English", Georgia, serif', short: 'FELL', load: 'IM Fell English' },
  6: { family: '"Playfair Display", Georgia, serif', short: 'DIDONE', load: 'Playfair Display' },
  7: { family: '"Bebas Neue", "Arial Narrow", sans-serif', short: 'POSTER', load: 'Bebas Neue' },
  8: { family: 'Righteous, "Arial Black", sans-serif', short: 'NEON', load: 'Righteous' },
  9: { family: '"Abril Fatface", Georgia, serif', short: 'NOIR', load: 'Abril Fatface' },
  10: { family: '"Comic Sans MS", "Chalkboard SE", cursive', short: 'COMIC' },
  11: { family: '"Brush Script MT", "Snell Roundhand", cursive', short: 'SCRIPT' },
  12: { family: '"Palatino Linotype", Palatino, "Book Antiqua", serif', short: 'PROPER' },
  13: { family: '"Times New Roman", Times, serif', short: 'NEWS' },
  14: { family: 'Consolas, "Lucida Console", Menlo, monospace', short: 'TERMINAL' },
  15: { family: '"Permanent Marker", "Comic Sans MS", cursive', short: 'MARKER', load: 'Permanent Marker' },
}

function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] select-none">{children}</span>
      {right}
    </div>
  )
}

/** A numeric param as the shared console slider; renders nothing if the param
 *  is absent (hidden by showIf) or not numeric. */
function BoundSlider({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <ParamSlider
      label={definition.label}
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      onChange={bound.setValue}
    />
  )
}

/** A boolean param as a labelled toggle row. */
function BoundToggleRow({ bound }: { bound: UserInterfaceParameter | undefined }) {
  if (!bound || typeof bound.value !== 'number') return null
  const on = bound.value >= 0.5
  return (
    <div className="mb-[13px] grid grid-cols-[100px_1fr] items-center gap-2.5">
      <span className="truncate text-[11px] text-[var(--text-3)]" title={bound.definition.label}>{bound.definition.label}</span>
      <div className="flex justify-end">
        <ParamToggle on={on} onChange={(v) => bound.setValue(v ? 1 : 0)} label={bound.definition.label} />
      </div>
    </div>
  )
}

function ColorWell({ bound, label, dimmed }: { bound: UserInterfaceParameter | undefined; label: string; dimmed: boolean }) {
  if (!bound || typeof bound.value !== 'string') return null
  return (
    <label className={`flex cursor-pointer items-center gap-2 transition-opacity ${dimmed ? 'opacity-35' : ''}`}>
      <span
        className="relative h-6 w-10 flex-shrink-0 overflow-hidden rounded border border-[var(--border-strong)]"
        style={{ background: bound.value }}
      >
        <input
          type="color"
          aria-label={bound.definition.label}
          value={bound.value}
          onChange={(event) => bound.setValue(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </span>
      <span className="text-[10px] text-[var(--text-3)]">{label}</span>
    </label>
  )
}

// ── Style lanes: pitch = lane = look ────────────────────────────────────────

// Eight one-click looks, not the vocabulary: the chip after them opens the
// shared wheel, so a lane's colour is ANY colour. The presets stay because
// most lanes want white or one of the accents and a wheel is a worse way to
// ask for white.
const LANE_COLOR_SWATCHES = ['#ffffff', '#facc15', '#f472b6', '#38bdf8', '#4ade80', '#f87171', '#c084fc', '#9aa1ab']
const LANE_SIZE_CHIPS = [0.55, 0.8, 1, 1.45, 2.1]
const LANE_FX: StyleLaneFx[] = ['shake', 'rainbow', 'outline']

/**
 * The swatch row's last chip: the lane's colour, picked freely. It reads as
 * SELECTED exactly when the current colour is not one of the presets - the same
 * white ring the presets wear - so the row always shows one lit chip and the
 * lit one is always the colour in force.
 *
 * The wheel opens DOWNWARD (`edge="bottom"`): the thing you judge a lane colour
 * against is the live name preview at the TOP of this card, and the default
 * upward popover would cover it.
 *
 * It sits FIRST in the row, not last, and that is a clipping constraint rather
 * than a taste call. Both hosts clip - the roll's sidecar is `w-[236px]
 * overflow-y-auto`, and a box that scrolls on one axis scrolls on both - and
 * the row WRAPS, so a trailing chip has no predictable x to open from: hugging
 * either edge puts the 158px popover outside one host or the other. Pinned to
 * the row's start with `align="left"` it always opens inward.
 */
function LaneColorSwatch({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = useState(false)
  const hostRef = useColorPopoverDismiss(open, () => setOpen(false))
  const custom = !LANE_COLOR_SWATCHES.includes(value.toLowerCase())
  return (
    <div ref={hostRef} className="relative">
      <button
        data-testid="lane-color-custom"
        onClick={() => setOpen((o) => !o)}
        aria-label="Custom lane color"
        aria-expanded={open}
        aria-pressed={custom}
        title={`Custom color${custom ? ` ${value}` : ''}`}
        className={`flex h-6 w-6 cursor-pointer items-center justify-center rounded border-2 ${custom ? 'border-white' : 'border-transparent'}`}
        style={{ background: 'conic-gradient(#f00, #ff0 60deg, #0f0 120deg, #0ff 180deg, #00f 240deg, #f0f 300deg, #f00 360deg)' }}
      >
        {/* The picked colour sits in the middle of the wheel once it IS the
            lane's colour, so the chip is a swatch and an invitation at once. */}
        {custom && (
          <span className="h-3 w-3 rounded-full border border-black/40" style={{ background: value }} />
        )}
      </button>
      {open && (
        <ColorWheelPopover
          value={value}
          onChange={onChange}
          align="left"
          edge="bottom"
          testId="lane-color-wheel"
        />
      )}
    </div>
  )
}

function StyleLanesSection({ trackId }: { trackId: string }) {
  const trackSlice = useProjectStore((s) => s.tracks[trackId])
  const stored = trackSlice?.styleLanes
  const addStyleLane = useProjectStore((s) => s.addStyleLane)
  const removeStyleLane = useProjectStore((s) => s.removeStyleLane)
  const lanes = resolveStyleLanes(stored)
  // How many word notes each lane carries. Shown per row and used to pick the
  // lane the panel opens on: a transcribed track puts every word on PLAIN,
  // and opening on TITLE (lane 0) had users restyling an empty lane and
  // seeing nothing change on screen.
  const usage = useMemo(() => {
    const counts = new Array<number>(lanes.length).fill(0)
    for (const b of trackSlice?.blocks ?? []) {
      for (const n of b.notes) {
        const i = laneIndexForPitch(n.pitch, lanes.length)
        if (i >= 0) counts[i]++
      }
    }
    return counts
  }, [trackSlice, lanes.length])
  const busiest = usage.reduce((best, c, i) => (c > usage[best] ? i : best), 0)
  // null = follow the busiest lane; a click pins an explicit choice.
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const open = Math.min(openIndex ?? busiest, lanes.length - 1)
  const lane = lanes[open]

  return (
    <div className="mb-3">
      <SectionLabel
        right={lanes.length < MAX_STYLE_LANES ? (
          <button
            onClick={() => addStyleLane(trackId)}
            title="Add a style lane (a new piano-roll row)"
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
          ><Plus size={11} /></button>
        ) : undefined}
      >STYLE LANES</SectionLabel>
      {/* The lane list IS the roll's gutter: each row rendered in its own look,
          so what you click here is exactly what a note at that height wears. */}
      <div className="mb-2 overflow-hidden rounded border border-[var(--border)]">
        {lanes.map((l, i) => {
          const preview = FONT_PREVIEWS[l.font]
          const active = i === open
          const count = usage[i] ?? 0
          return (
            <button
              key={i}
              onClick={() => setOpenIndex(i)}
              aria-pressed={active}
              title={count > 0 ? `${count} word${count === 1 ? '' : 's'} on this lane` : 'No words on this lane yet'}
              className={`group flex h-8 w-full cursor-pointer items-center justify-between px-2.5 text-left ${active ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-app)] hover:bg-[var(--bg-panel)]'}`}
            >
              <span
                className={`truncate text-[13px] leading-none ${count === 0 ? 'opacity-50' : ''}`}
                style={{ fontFamily: preview?.family, color: l.color, fontSize: `${Math.min(17, 10 + l.size * 3.5)}px` }}
              >{l.name}</span>
              <span className="flex items-center gap-2">
                {/* The word count is what tells you which lane your lyrics
                    actually wear - restyling an empty lane changes nothing. */}
                {count > 0 && (
                  <span className="rounded-full bg-[var(--accent)]/15 px-1.5 py-px font-mono text-[9px] text-[var(--accent)]">
                    {count} {count === 1 ? 'word' : 'words'}
                  </span>
                )}
                <span className="font-mono text-[9px] text-[var(--text-muted)]">row {styleLanePitch(i)}</span>
                {active && lanes.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); removeStyleLane(trackId, i); setOpenIndex(null) }}
                    title="Remove this lane (its notes become orphans)"
                    className="flex h-4 w-4 items-center justify-center rounded text-[var(--text-muted)] hover:text-[#d68383]"
                  ><X size={10} /></span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      {lane && <StyleLaneEditorCard trackId={trackId} laneIndex={open} />}
    </div>
  )
}

/** One lane's style editor - the card the panel embeds AND the piano roll's
 *  sidecar opens (click a lane row in the gutter). Everything rendered, no
 *  sliders: font cards, swatches, size chips, fx chips, in-place name. */
export function StyleLaneEditorCard({ trackId, laneIndex, frameless }: { trackId: string; laneIndex: number; frameless?: boolean }) {
  const stored = useProjectStore((s) => s.tracks[trackId]?.styleLanes)
  const updateStyleLane = useProjectStore((s) => s.updateStyleLane)
  const lanes = resolveStyleLanes(stored)
  const lane = lanes[Math.min(laneIndex, lanes.length - 1)]
  const open = Math.min(laneIndex, lanes.length - 1)
  useEffect(() => {
    for (const preview of Object.values(FONT_PREVIEWS)) {
      if (preview.load) ensureFont(preview.load)
    }
  }, [])
  if (!lane) return null
  const previewFamily = FONT_PREVIEWS[lane.font]?.family
  const outline = lane.fx?.includes('outline')
  return (
    <div className={frameless ? 'p-2' : 'p-1'}>
      {/* The look IS the name field: the lane's name rendered exactly as a
          word on this lane renders (font, color, size, outline) - select the
          text and type to rename the lane. */}
      <div className="mb-2 flex h-16 items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-black focus-within:border-[var(--border-strong)]">
        <input
          value={lane.name}
          onChange={(e) => updateStyleLane(trackId, open, { name: e.target.value.toUpperCase() })}
          aria-label="Lane name"
          spellCheck={false}
          className="w-full bg-transparent text-center leading-none outline-none"
          style={{
            fontFamily: previewFamily,
            fontSize: `${Math.round(14 + lane.size * 11)}px`,
            fontWeight: 900,
            ...(outline
              ? { WebkitTextStroke: `1.5px ${lane.color}`, color: 'transparent', caretColor: lane.color }
              : { color: lane.color, caretColor: lane.color }),
          }}
        />
      </div>
      <div className="mb-2 grid grid-cols-4 gap-1">
        {Object.entries(FONT_PREVIEWS).map(([value, preview]) => {
          const v = Number(value)
          const active = lane.font === v
          return (
            <button
              key={value}
              onClick={() => updateStyleLane(trackId, open, { font: v })}
              aria-pressed={active}
              title={preview.short}
              className={`flex cursor-pointer flex-col items-center gap-0.5 rounded border py-1.5 ${active
                ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text)]'
                : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
            >
              <span className="text-[15px] leading-none" style={{ fontFamily: preview.family }}>Ag</span>
              <span className="text-[7px] font-semibold tracking-[0.08em]">{preview.short}</span>
            </button>
          )
        })}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <LaneColorSwatch
          value={lane.color}
          onChange={(hex) => updateStyleLane(trackId, open, { color: hex })}
        />
        {LANE_COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            onClick={() => updateStyleLane(trackId, open, { color: c })}
            aria-label={`Lane color ${c}`}
            aria-pressed={lane.color.toLowerCase() === c}
            className={`h-6 w-6 cursor-pointer rounded border-2 ${lane.color.toLowerCase() === c ? 'border-white' : 'border-transparent'}`}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="mb-2 flex items-end gap-1.5">
        {LANE_SIZE_CHIPS.map((v) => (
          <button
            key={v}
            onClick={() => updateStyleLane(trackId, open, { size: v })}
            aria-pressed={Math.abs(lane.size - v) < 0.01}
            title={`${v}×`}
            className={`flex cursor-pointer items-end rounded border px-1.5 py-0.5 leading-none text-[var(--text)] ${Math.abs(lane.size - v) < 0.01 ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)]' : 'border-[var(--border)] bg-[var(--bg-app)]'}`}
            style={{ fontSize: `${8 + v * 7}px` }}
          >Aa</button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LANE_FX.map((fx) => {
          const on = lane.fx?.includes(fx) ?? false
          return (
            <button
              key={fx}
              onClick={() => {
                const next = on ? (lane.fx ?? []).filter((f) => f !== fx) : [...(lane.fx ?? []), fx]
                updateStyleLane(trackId, open, { fx: next })
              }}
              aria-pressed={on}
              className={`cursor-pointer rounded border px-2 py-0.5 text-[10px] capitalize ${on
                ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text)]'
                : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
            >{fx}</button>
          )
        })}
      </div>
    </div>
  )
}

// ── Lyric clips: the words + each clip's layout ─────────────────────────────

const LAYOUT_CARDS: { kind: LyricLayoutKind; label: string; dots: [number, number][]; r?: number }[] = [
  { kind: 'one', label: 'One at a time', dots: [[22, 14]], r: 3.5 },
  { kind: 'row', label: 'Row', dots: [[8, 14], [17, 14], [26, 14], [35, 14]] },
  { kind: 'stack', label: 'Paragraph', dots: [[13, 10], [22, 10], [31, 10], [17, 18], [26, 18]] },
  { kind: 'scatter', label: 'Scatter', dots: [[10, 9], [30, 7], [20, 16], [34, 19], [13, 21]] },
  { kind: 'grid', label: 'Grid', dots: [[15, 9], [29, 9], [15, 19], [29, 19]] },
  { kind: 'circle', label: 'Circle', dots: Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2 - Math.PI / 2; return [22 + 9 * Math.cos(a), 14 + 9 * Math.sin(a)] as [number, number] }) },
]

function GrowingTextarea({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Auto-expand: pasted verses are common, a scrollbar inside a 3-row box is not.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
      spellCheck={false}
      aria-label={ariaLabel}
      className="w-full resize-none overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-app)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--accent)]"
    />
  )
}

/** One clip's editor - words + its layout (the per-clip word formation:
 *  one / row / paragraph / scatter / grid / circle). Embedded per clip in the
 *  panel's list AND shown alone in the piano roll's sidecar when a clip is
 *  selected in the sections strip. */
export function LyricClipEditorCard({ trackId, clipId }: { trackId: string; clipId: string }) {
  // Clips are derived from the track's clip NOTES, so subscribe to the track
  // slice (stable across foreign edits) and derive - a selector returning a
  // freshly built clip would hand zustand a new object every render.
  const trackSlice = useProjectStore((s) => s.tracks[trackId])
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const clip = useMemo(
    () => (trackSlice ? trackLyricClips(trackSlice.blocks, beatsPerBar).find((c) => c.id === clipId) : undefined),
    [trackSlice, beatsPerBar, clipId],
  )
  const updateLyricClip = useProjectStore((s) => s.updateLyricClip)
  if (!clip) return null
  const setLayout = (layout: LyricClipLayout) => updateLyricClip(trackId, clip.id, { layout })
  return (
    <div>
      <GrowingTextarea
        value={clip.words.join(' ')}
        onChange={(v) => updateLyricClip(trackId, clip.id, { words: v.split(/\s+/).filter(Boolean) })}
        ariaLabel="Clip words"
      />
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        {LAYOUT_CARDS.map((cardDef) => {
          const active = (clip.layout?.kind ?? 'one') === cardDef.kind
          return (
            <button
              key={cardDef.kind}
              onClick={() => setLayout(cardDef.kind === 'grid' ? { kind: 'grid', cols: clip.layout?.cols ?? 2 } : { kind: cardDef.kind })}
              aria-pressed={active}
              title={cardDef.label}
              className={`flex cursor-pointer flex-col items-center rounded border py-1 ${active
                ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text)]'
                : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
            >
              <svg width="44" height="24" viewBox="0 0 44 28">
                {cardDef.dots.map((d, i) => <circle key={i} cx={d[0].toFixed(1)} cy={d[1].toFixed(1)} r={cardDef.r ?? 2.4} fill="currentColor" />)}
              </svg>
              <span className="text-[7px] font-semibold tracking-[0.06em]">{cardDef.label.toUpperCase()}</span>
            </button>
          )
        })}
      </div>
      {clip.layout?.kind === 'grid' && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[9px] text-[var(--text-muted)]">Columns</span>
          {[2, 3, 4].map((c) => (
            <button
              key={c}
              onClick={() => setLayout({ kind: 'grid', cols: c })}
              aria-pressed={(clip.layout?.cols ?? 2) === c}
              className={`cursor-pointer rounded border px-2 py-0.5 text-[10px] ${(clip.layout?.cols ?? 2) === c
                ? 'border-[var(--accent-muted)] bg-[var(--bg-elevated)] text-[var(--text)]'
                : 'border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)]'}`}
            >{c}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function LyricClipsSection({ trackId }: { trackId: string }) {
  const trackSlice = useProjectStore((s) => s.tracks[trackId])
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const clips = useMemo(
    () => (trackSlice ? trackLyricClips(trackSlice.blocks, beatsPerBar) : undefined),
    [trackSlice, beatsPerBar],
  )
  const addLyricClip = useProjectStore((s) => s.addLyricClip)
  const removeLyricClip = useProjectStore((s) => s.removeLyricClip)
  const sliceLyricsIntoClips = useProjectStore((s) => s.sliceLyricsIntoClips)
  const [paste, setPaste] = useState('')
  const ordered = [...(clips ?? [])].sort((a, b) => a.startBeat - b.startBeat)
  // Clips are collapsed by default - a transcribed song is dozens of them,
  // and a column of open editors buried every setting below. A collapsed
  // row still shows the phrase, so the list reads as the lyric sheet.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const allOpen = ordered.length > 0 && ordered.every((c) => expanded.has(c.id))

  return (
    <div className="mt-1 border-t border-[var(--border-subtle)] pt-3">
      <SectionLabel
        right={(
          <span className="flex items-center gap-1">
            {ordered.length > 1 && (
              <button
                onClick={() => setExpanded(allOpen ? new Set() : new Set(ordered.map((c) => c.id)))}
                className="h-5 cursor-pointer rounded border border-[var(--border)] px-1.5 text-[9px] text-[var(--text-muted)] hover:text-[var(--text)]"
              >{allOpen ? 'Collapse all' : 'Expand all'}</button>
            )}
            <button
              onClick={() => {
                const last = ordered[ordered.length - 1]
                addLyricClip(trackId, {
                  startBeat: last ? last.startBeat + last.durationBeats : 0,
                  durationBeats: beatsPerBar,
                  words: [],
                  layout: last?.layout ?? { kind: 'one' },
                })
              }}
              title="Add a lyric clip"
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            ><Plus size={11} /></button>
          </span>
        )}
      >LYRIC CLIPS{ordered.length > 0 ? ` · ${ordered.length}` : ''}</SectionLabel>
      {ordered.length > 0 && (
        <div className="mb-2 overflow-hidden rounded border border-[var(--border)]">
          {ordered.map((clip) => {
            const isOpen = expanded.has(clip.id)
            const bar = Math.floor(clip.startBeat / beatsPerBar) + 1
            const phrase = clip.words.join(' ')
            return (
              <div key={clip.id} className="border-b border-[var(--border-subtle)] last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggle(clip.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(clip.id) } }}
                  className={`group flex min-h-7 w-full cursor-pointer items-center gap-1.5 px-1.5 py-1 text-left ${isOpen ? 'bg-[var(--bg-elevated)]' : 'bg-[var(--bg-app)] hover:bg-[var(--bg-panel)]'}`}
                >
                  <ChevronRight
                    size={11}
                    className={`flex-shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  />
                  <span className="w-7 flex-shrink-0 font-mono text-[9px] text-[var(--text-muted)]">b{bar}</span>
                  <span
                    className={`min-w-0 flex-1 text-[11px] leading-snug ${phrase ? 'text-[var(--text)]' : 'italic text-[var(--text-muted)]'} ${isOpen ? '' : 'truncate'}`}
                    title={phrase || undefined}
                  >{phrase || 'empty clip'}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeLyricClip(trackId, clip.id) }}
                    title="Remove this clip"
                    className="flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded text-transparent group-hover:text-[var(--text-muted)] hover:!text-[#d68383]"
                  ><X size={10} /></button>
                </div>
                {isOpen && (
                  <div className="bg-[var(--bg-panel)] px-2 pb-2 pt-1">
                    <LyricClipEditorCard trackId={trackId} clipId={clip.id} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {/* Paste a verse → one line becomes one clip, laid down the timeline. */}
      <GrowingTextarea value={paste} onChange={setPaste} ariaLabel="Paste lyrics, one line per clip" />
      <button
        onClick={() => { if (paste.trim()) { sliceLyricsIntoClips(trackId, paste); setPaste('') } }}
        disabled={!paste.trim()}
        className={`mt-1 h-6 w-full rounded border text-[10px] font-medium ${paste.trim()
          ? 'cursor-pointer border-[var(--accent-muted)] bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'
          : 'cursor-default border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)]'}`}
      >↓ Slice into clips (one line each)</button>
      <p className="mb-1 mt-1 text-[9px] leading-relaxed text-[var(--text-muted)]">
        A note sings the next word of the clip under it · <span className="font-mono">syl|la|bles</span> · <span className="font-mono">!kept together!</span>
      </p>
    </div>
  )
}

/**
 * Transcribe the project's song straight onto THIS track - the Lyric Video
 * setup screen's pipeline (upload → Scribe → forced alignment), reachable from
 * any Text Display track without going through a template. The words replace
 * this track's sheet and notes in one undoable step.
 */
function TranscribeButton({ trackId }: { trackId: string }) {
  const hasSong = useProjectStore((s) =>
    s.rootTrackIds.some((id) => {
      const t = s.tracks[id]
      return t?.type === 'audio' && !!t.audioBlocks?.length
    }),
  )
  const [phase, setPhase] = useState<TranscribePhase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runningRef = useRef(false)
  // Selecting another track unmounts this panel mid-flight; the pipeline keeps
  // running (its result still lands in the store) but must not set state after.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const run = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setError(null)
    setPhase({ kind: 'uploading', progress: 0 })
    try {
      const timing = await transcribeActiveSong((next) => { if (aliveRef.current) setPhase(next) })
      // Fresh read: the pipeline waits out the decode, which writes the
      // detected BPM and the first-beat trim these beats are measured against.
      const block = firstAudioBlock()
      if (!block) throw new Error('The song went away mid-transcription - try again.')
      const { bpm, beatsPerBar } = useProjectStore.getState()
      const words = placeTranscription(timing, block, bpm, beatsPerBar, true)
      const id = useProjectStore.getState().addLyricTrack(words, timing, trackId)
      if (!id) throw new Error('No usable words found in the song.')
      trackEvent('lyrics_applied', { source: 'aligned', where: 'text_display_panel', words: words.length })
    } catch (err) {
      if (aliveRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      runningRef.current = false
      if (aliveRef.current) setPhase(null)
    }
  }

  const working = phase !== null
  const status = phase?.kind === 'uploading'
    ? `Uploading song - syncing the beat grid${phase.progress > 0 ? ` (${Math.round(phase.progress * 100)}%)` : ''}`
    : phase?.kind === 'transcribing'
      ? 'Transcribing - listening for the words'
      : phase?.kind === 'aligning'
        ? 'Aligning - timing every word to where it’s sung'
        : null

  return (
    <>
      <button
        onClick={() => void run()}
        disabled={working || !hasSong}
        aria-busy={working}
        title={hasSong
          ? 'Transcribe the song and write its words onto this track'
          : 'Add a song to the timeline first'}
        className={`mb-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded border text-[11px] font-medium ${
          working || !hasSong
            ? 'cursor-default border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-muted)]'
            : 'cursor-pointer border-[var(--accent-muted)] bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25'
        }`}
      >
        <Mic size={12} />
        {working ? 'Transcribing…' : error ? 'Try again' : 'Transcribe song'}
      </button>
      {status && (
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
            {phase?.kind === 'uploading' && phase.progress > 0 ? (
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] transition-[width] duration-200"
                style={{ width: `${Math.round(Math.max(0.02, Math.min(1, phase.progress)) * 100)}%` }}
              />
            ) : (
              <span className="absolute inset-y-0 w-1/3 rounded-full bg-[var(--accent)] motion-safe:animate-[lyric-progress-sweep_1.2s_ease-in-out_infinite]" />
            )}
          </span>
        </div>
      )}
      <p className={`mb-3 mt-1 text-[9px] leading-relaxed ${error ? 'text-[#d68383]' : 'text-[var(--text-muted)]'}`}>
        {error ?? status ?? (hasSong
          ? 'Writes the song’s words and their timing onto this track, replacing what is here.'
          : 'Add a song to the timeline to transcribe it onto this track.')}
      </p>
    </>
  )
}

export const TextDisplayUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ targetId, parameters }) => {
  // The template faces are lazy-loaded; kick them off so the specimen buttons
  // (and the lyric-sheet preview) render in the real face, not the fallback.
  useEffect(() => {
    for (const preview of Object.values(FONT_PREVIEWS)) {
      if (preview.load) ensureFont(preview.load)
    }
  }, [])
  // Word-by-word vs whole-lines display, for EVERY Text Display track. The
  // active side is the instrument's own Advance By param; transcribed tracks
  // additionally get their notes + sheet regrouped from the sung timing.
  const hasTiming = useProjectStore((s) => !!s.tracks[targetId]?.lyricTiming?.length)
  const storedGrouping = useProjectStore((s) => s.tracks[targetId]?.lyricGrouping)
  const setLyricGrouping = useProjectStore((s) => s.setLyricGrouping)
  const lyricGrouping: 'words' | 'lines' = storedGrouping ?? 'words'
  const colorMode = findParam(parameters, 'colorMode')
  const invertBehind = numberOf(colorMode) >= 0.5

  const placed = new Set([
    'fontSize', 'sizeMode', 'strokeWidth', 'shadow', 'opacity',
    'colorMode', 'strokeColor', 'hue', 'rainbowEnabled', 'rainbowCycleLength',
    'posX', 'posY', 'posMode', 'scatterSpread',
    'onsetBounce', 'zoomFlash', 'sustain', 'releaseDuration',
    'delayTaps', 'delayTime', 'delayScaleFalloff', 'delayOpacityFalloff', 'pingPongEnabled', 'pingPongWidth',
    'flightEnabled', 'flightSpeed', 'flightMaxDepth', 'flightDrift', 'flightTumble', 'flightSubdivRate',
    'particleEnabled', 'particleCount', 'particleSize', 'particleGlow', 'particleOpaque', 'particleMorphBeats',
    'particleFillGap', 'particleStagger', 'particleVariation', 'particlePulse',
    'particleField', 'fieldDepth', 'fieldDrift', 'fieldDensity',
  ])
  const leftovers = parameters.filter((bound) => !placed.has(bound.definition.key))

  return (
    <section data-testid="text-display-user-interface" className="mb-3 px-2">
      {/* --- The looks each piano-roll row wears, then the words --- */}
      <StyleLanesSection trackId={targetId} />
      <LyricClipsSection trackId={targetId} />

      {/* --- Lyrics: how the words hit the screen --- */}
      <div className="mt-1 border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>LYRICS</SectionLabel>
        {/* The words can come from the song itself - no template required. */}
        <TranscribeButton trackId={targetId} />
        <div className="grid grid-cols-2 overflow-hidden rounded border border-[var(--border)]">
          {([
            { id: 'words', label: 'Word by word' },
            { id: 'lines', label: 'Whole lines' },
          ] as const).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setLyricGrouping(targetId, id)}
              aria-pressed={lyricGrouping === id}
              className={`h-7 text-[11px] font-medium cursor-pointer ${
                lyricGrouping === id
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'bg-[var(--bg-app)] text-[var(--text-3)] hover:text-[var(--text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mb-3 mt-1 text-[9px] leading-relaxed text-[var(--text-muted)]">
          {lyricGrouping === 'lines'
            ? hasTiming
              ? 'One line per note, grouped from the sung timing. Edit line breaks freely.'
              : 'Each line of the sheet shows whole - one note advance per line.'
            : hasTiming
              ? 'One word per note, timed to the singing.'
              : 'One word per note advance.'}
        </p>
      </div>

      {/* --- Type: the glyph sliders (fonts live on the style lanes) --- */}
      <BoundSlider bound={findParam(parameters, 'fontSize')} />
      {(() => {
        // Directly under the Size slider, for the same reason posMode sits under
        // the placement sliders: it decides whether automating Size resizes every
        // word live or latches each word at its onset.
        const mode = findParam(parameters, 'sizeMode')
        if (!mode || typeof mode.value !== 'number') return null
        return (
          <ParamControl
            param={mode.definition}
            numValue={mode.value}
            strValue={undefined}
            onNum={mode.setValue}
          />
        )
      })()}
      <BoundSlider bound={findParam(parameters, 'strokeWidth')} />
      <BoundSlider bound={findParam(parameters, 'shadow')} />
      <BoundSlider bound={findParam(parameters, 'opacity')} />

      {/* --- Color --- */}
      <div className="mt-1 border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>COLOR</SectionLabel>
        {colorMode && colorMode.definition.type === 'select' && (
          <div className="mb-2.5 flex rounded border border-[var(--border)] p-0.5">
            {colorMode.definition.options.map((option) => {
              const active = Math.round(numberOf(colorMode)) === option.value
              return (
                <button
                  key={option.value}
                  onClick={() => colorMode.setValue(option.value)}
                  aria-pressed={active}
                  className={`flex-1 rounded-[2px] py-1 text-[10px] cursor-pointer ${active
                    ? 'bg-[var(--bg-elevated)] text-[var(--text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-3)]'}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        )}
        <div className="mb-3 flex items-center gap-5" title={invertBehind ? 'Colors are ignored while inverting what is behind the text' : undefined}>
          <ColorWell bound={findParam(parameters, 'strokeColor')} label="Stroke" dimmed={invertBehind} />
        </div>
        <BoundSlider bound={findParam(parameters, 'hue')} />
        <BoundToggleRow bound={findParam(parameters, 'rainbowEnabled')} />
        <BoundSlider bound={findParam(parameters, 'rainbowCycleLength')} />
      </div>

      {/* --- Placement: where on the frame the words land. Right-click either
              slider to automate it - that is how words get moved per line or
              along a path, and the reason these are params not an effect. --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>PLACEMENT</SectionLabel>
        <BoundSlider bound={findParam(parameters, 'posX')} />
        <BoundSlider bound={findParam(parameters, 'posY')} />
        {(() => {
          // Belongs directly under the two sliders it modifies - it decides whether
          // they move every word live or latch per word, and reading it at the
          // bottom of the panel with the generic leftovers gives no hint of that.
          const mode = findParam(parameters, 'posMode')
          if (!mode || typeof mode.value !== 'number') return null
          return (
            <ParamControl
              param={mode.definition}
              numValue={mode.value}
              strValue={undefined}
              onNum={mode.setValue}
            />
          )
        })()}
      </div>

      {/* --- Motion --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>MOTION</SectionLabel>
        <BoundSlider bound={findParam(parameters, 'onsetBounce')} />
        <BoundSlider bound={findParam(parameters, 'zoomFlash')} />
        <BoundToggleRow bound={findParam(parameters, 'sustain')} />
        <BoundSlider bound={findParam(parameters, 'releaseDuration')} />
        <BoundSlider bound={findParam(parameters, 'scatterSpread')} />
      </div>

      {/* --- Echo (delay taps) - children appear once taps >= 1 --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        <SectionLabel>ECHO</SectionLabel>
        <BoundSlider bound={findParam(parameters, 'delayTaps')} />
        <BoundSlider bound={findParam(parameters, 'delayTime')} />
        <BoundSlider bound={findParam(parameters, 'delayScaleFalloff')} />
        <BoundSlider bound={findParam(parameters, 'delayOpacityFalloff')} />
        <BoundToggleRow bound={findParam(parameters, 'pingPongEnabled')} />
        <BoundSlider bound={findParam(parameters, 'pingPongWidth')} />
      </div>

      {/* --- Flight - the toggle lives in the header, sliders appear with it --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        {(() => {
          const flight = findParam(parameters, 'flightEnabled')
          return (
            <SectionLabel
              right={flight && typeof flight.value === 'number'
                ? <ParamToggle on={flight.value >= 0.5} onChange={(v) => flight.setValue(v ? 1 : 0)} label="Flight mode" />
                : undefined}
            >
              FLIGHT
            </SectionLabel>
          )
        })()}
        <BoundSlider bound={findParam(parameters, 'flightSpeed')} />
        <BoundSlider bound={findParam(parameters, 'flightMaxDepth')} />
        <BoundSlider bound={findParam(parameters, 'flightDrift')} />
        <BoundSlider bound={findParam(parameters, 'flightTumble')} />
        <BoundSlider bound={findParam(parameters, 'flightSubdivRate')} />
      </div>

      {/* --- Particle words - words become a morphing particle cloud; the
              sliders appear with the toggle (showIf) --- */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
        {(() => {
          const particle = findParam(parameters, 'particleEnabled')
          return (
            <SectionLabel
              right={particle && typeof particle.value === 'number'
                ? <ParamToggle on={particle.value >= 0.5} onChange={(v) => particle.setValue(v ? 1 : 0)} label="Particle words" />
                : undefined}
            >
              PARTICLES
            </SectionLabel>
          )
        })()}
        {/* Field Mode sits directly under the particle toggle: it changes what
            the particles ARE (an ambient screen the words condense out of), so
            it reads before the shared sliders that tune either behavior. */}
        <BoundToggleRow bound={findParam(parameters, 'particleField')} />
        <BoundSlider bound={findParam(parameters, 'fieldDepth')} />
        <BoundSlider bound={findParam(parameters, 'fieldDrift')} />
        <BoundSlider bound={findParam(parameters, 'fieldDensity')} />
        <BoundSlider bound={findParam(parameters, 'particleCount')} />
        <BoundSlider bound={findParam(parameters, 'particleSize')} />
        <BoundSlider bound={findParam(parameters, 'particleGlow')} />
        <BoundToggleRow bound={findParam(parameters, 'particleOpaque')} />
        <BoundSlider bound={findParam(parameters, 'particleMorphBeats')} />
        <BoundToggleRow bound={findParam(parameters, 'particleFillGap')} />
        <BoundSlider bound={findParam(parameters, 'particleStagger')} />
        <BoundSlider bound={findParam(parameters, 'particleVariation')} />
        <BoundSlider bound={findParam(parameters, 'particlePulse')} />
      </div>

      {/* Anything the layout does not know about still gets a control. */}
      {leftovers.length > 0 && (
        <div className="border-t border-[var(--border-subtle)] pt-3">
          {leftovers.map((bound) => {
            const numeric = typeof bound.value === 'number'
            return (
              <ParamControl
                key={bound.definition.key}
                param={bound.definition}
                numValue={numeric ? (bound.value as number) : undefined}
                strValue={numeric ? undefined : (bound.value as string)}
                onNum={bound.setValue}
                onStr={bound.setValue}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}
