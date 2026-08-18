'use client'

/**
 * /dev/timeline-zoom-lab — quieting the timeline's width/height sliders (the
 * zoom pill at the right of the scene bar, SceneTabs.tsx).
 *
 * Tyler's brief, after a first round of six wholesale redesigns was rejected:
 * the shipped control is RIGHT, it is just slightly too NOISY. So nothing here
 * restructures it — every look below is the same pill-and-two-sliders anatomy
 * with the ink dialled down. The one thing genuinely in question is the ICONS:
 * their INTENT is correct (something has to say which axis is which, and say it
 * at rest), but lucide's `UnfoldHorizontal`/`UnfoldVertical` at 11px /
 * strokeWidth 2 are ~6 strokes each of arrowheads and centre bars, which is a
 * large share of the control's total ink.
 *
 * Counting the chrome the shipped version spends on two numbers: a capsule
 * surface, a divider, two 11px bordered thumbs, two dense icons, two tracks.
 * Ten marks. The presets below spend between four and eight.
 *
 * The EXPLORER at the bottom is the actual deliverable — every axis of the
 * design is a toggle, so the combination can be found rather than guessed at.
 * It prints its own settings as a line you can hand back.
 *
 * OUTCOME: Tyler kept the sliders exactly as shipped and took ONE change — the
 * `glyph` cue. That is live in SceneTabs.tsx now (BeatWidthGlyph /
 * RowHeightGlyph); everything else on this page stayed a prototype.
 *
 * Throwaway prototype: local state only, no stores, no engine. The shipped
 * control is a native `<input type="range">` and gets keyboard support for
 * free; these re-implement drag + arrow keys by hand so they feel real.
 */

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { UnfoldHorizontal, UnfoldVertical } from 'lucide-react'
import { clamp01 } from '@/editor/utils/math'

/* ------------------------------------------------------------------ */
/* The two values, and the log mapping the real control uses.          */
/* ------------------------------------------------------------------ */

/** Horizontal zoom: timeline pixels per beat (UIStore.tracksPixelsPerBeat). */
const PPB = { min: 2, max: 100, initial: 24 }
/** Vertical zoom: track row height in px (UIStore.tracksRowHeight). */
const ROW = { min: 28, max: 200, initial: 44 }

/** Zoom is multiplicative, so the track is logarithmic: 4 → 8 px/beat is the
 *  same gesture as 40 → 80. (Same reasoning as the shipped ZoomSlider.) */
const toNorm = (value: number, { min, max }: { min: number; max: number }) =>
  clamp01(Math.log(value / min) / Math.log(max / min))
const fromNorm = (t: number, { min, max }: { min: number; max: number }) =>
  Math.round(min * Math.exp(clamp01(t) * Math.log(max / min)))

function useZoomPair() {
  const [ppb, setPpb] = useState(PPB.initial)
  const [row, setRow] = useState(ROW.initial)
  return {
    ppb,
    row,
    h: toNorm(ppb, PPB),
    v: toNorm(row, ROW),
    setH: (t: number) => setPpb(fromNorm(t, PPB)),
    setV: (t: number) => setRow(fromNorm(t, ROW)),
    nudgeH: (dir: -1 | 1) => setPpb((p) => fromNorm(toNorm(p, PPB) + dir * 0.025, PPB)),
    nudgeV: (dir: -1 | 1) => setRow((r) => fromNorm(toNorm(r, ROW) + dir * 0.025, ROW)),
  }
}

type Pair = ReturnType<typeof useZoomPair>

/* ------------------------------------------------------------------ */
/* Drag plumbing                                                       */
/* ------------------------------------------------------------------ */

function useDragBox(onDrag: (tx: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const apply = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    onDrag(clamp01((clientX - r.left) / Math.max(1, r.width)))
  }
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    apply(e.clientX)
    const controller = new AbortController()
    window.addEventListener('pointermove', (ev) => apply(ev.clientX), { signal: controller.signal })
    window.addEventListener('pointerup', () => controller.abort(), { signal: controller.signal })
  }
  return { ref, onPointerDown }
}

function arrowKeys(nudge: (dir: -1 | 1) => void) {
  return (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(-1) }
  }
}

const sliderAria = (label: string, value: number, unit: string, { min, max }: { min: number; max: number }) => ({
  role: 'slider' as const,
  tabIndex: 0,
  'aria-label': label,
  'aria-valuemin': min,
  'aria-valuemax': max,
  'aria-valuenow': value,
  'aria-valuetext': `${value} ${unit}`,
})

/* ------------------------------------------------------------------ */
/* The design space                                                    */
/* ------------------------------------------------------------------ */

/** Every axis of the look, so a combination can be dialled rather than guessed. */
type Look = {
  /** The grouping surface. `pill` is shipped; `soft` squares it to the radius
   *  the design guide asks for; `none` removes the only capsule in that row. */
  surface: 'pill' | 'soft' | 'none'
  /** The hairline between the two axes. */
  divider: boolean
  /** Track thickness in px. Shipped is 4. */
  trackH: 2 | 3 | 4
  /** Track length in px. Shipped is 64. */
  trackW: 48 | 56 | 64
  /** Shipped is `round11` — 11px, with a border. */
  thumb: 'round11' | 'round8' | 'bar' | 'dot' | 'none'
  /** What says which axis is which. See CUE_NOTES for what each one costs. */
  cue: 'lucide' | 'lucideLight' | 'glyph' | 'letters' | 'texture' | 'none'
  /** The mono number. Shipped shows none at all. */
  readout: 'none' | 'hover' | 'always'
}

const CUE_NOTES: Record<Look['cue'], string> = {
  lucide: 'Shipped: UnfoldHorizontal / UnfoldVertical, 11px, strokeWidth 2. ~6 strokes each — arrowheads plus a centre bar.',
  lucideLight: 'The same glyphs at 10px / strokeWidth 1.25 in --text-faint. Same intent, roughly a third of the ink, no redesign.',
  glyph: 'Two hairlines whose GAP is the quantity: | | for beat width, ≡ for row height. Depicts what changes rather than the gesture, and axis-aligned strokes stay crisp at 10px where arrowheads go muddy.',
  letters: 'W / H in 9px mono — the app already speaks in mono readouts, so this adds no new vocabulary at all. Least pictorial, most literal.',
  texture: 'No cue beside the track: the TRACK says it. Width is one rule scored by vertical ticks (bar lines); height is two stacked rules (track rows). Two fewer marks than any icon, and it draws the thing being zoomed.',
  none: 'Nothing. Included only to see how much the cue is actually carrying — the axes become guessable from order alone.',
}

/* ------------------------------------------------------------------ */
/* Cue glyphs                                                          */
/* ------------------------------------------------------------------ */

/** `| |` — the GAP between two uprights is a beat's width. */
function WidthGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1v8M8.5 1v8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

/** `≡` — the GAP between two rules is a track row's height. */
function HeightGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1 1.5h8M1 8.5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function Cue({ kind, axis }: { kind: Look['cue']; axis: 'h' | 'v' }) {
  if (kind === 'none' || kind === 'texture') return null
  const wrap = (node: ReactNode, dim: boolean) => (
    <span className={`flex-shrink-0 transition-colors ${dim ? 'text-[var(--text-faint)]' : 'text-[var(--text-muted)]'} group-hover/axis:text-[var(--text-3)]`}>
      {node}
    </span>
  )
  if (kind === 'lucide') {
    return wrap(axis === 'h' ? <UnfoldHorizontal size={11} strokeWidth={2} /> : <UnfoldVertical size={11} strokeWidth={2} />, false)
  }
  if (kind === 'lucideLight') {
    return wrap(axis === 'h' ? <UnfoldHorizontal size={10} strokeWidth={1.25} /> : <UnfoldVertical size={10} strokeWidth={1.25} />, true)
  }
  if (kind === 'letters') {
    return wrap(<span className="font-mono text-[9px] leading-none">{axis === 'h' ? 'W' : 'H'}</span>, true)
  }
  // Not dimmed: this is the cue that shipped, and it wears the icon slot's own
  // --text-muted there. Keeping the lab in step with SceneTabs.
  return wrap(axis === 'h' ? <WidthGlyph /> : <HeightGlyph />, false)
}

/* ------------------------------------------------------------------ */
/* Track + thumb                                                       */
/* ------------------------------------------------------------------ */

function Thumb({ kind, norm }: { kind: Look['thumb']; norm: number }) {
  if (kind === 'none') return null
  const style: CSSProperties = { left: `calc(${norm * 100}% - var(--half))` }
  if (kind === 'round11') {
    return (
      <div
        className="pointer-events-none absolute top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full border border-[var(--border-strong)] bg-[var(--text-2)] transition-colors group-hover/axis:bg-[var(--text)]"
        style={{ ...style, ['--half' as string]: '5.5px' }}
      />
    )
  }
  if (kind === 'round8') {
    // No border: on a light circle the ring is a second mark for one value.
    return (
      <div
        className="pointer-events-none absolute top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full bg-[var(--text-3)] transition-colors group-hover/axis:bg-[var(--text-2)]"
        style={{ ...style, ['--half' as string]: '4px' }}
      />
    )
  }
  if (kind === 'dot') {
    return (
      <div
        className="pointer-events-none absolute top-1/2 h-[4px] w-[4px] -translate-y-1/2 rounded-full bg-[var(--text-2)] transition-colors group-hover/axis:bg-[var(--text)]"
        style={{ ...style, ['--half' as string]: '2px' }}
      />
    )
  }
  // ParamHueSlider's marker — the app's other established thumb, and the one
  // that doesn't eat a sixth of a short track.
  return (
    <div
      className="pointer-events-none absolute top-1/2 h-[9px] w-[2px] -translate-y-1/2 rounded-[1px] bg-[var(--text-2)] transition-colors group-hover/axis:bg-[var(--text)]"
      style={{ ...style, ['--half' as string]: '1px' }}
    />
  )
}

/** The rule itself. Under `texture` the two axes draw differently on purpose:
 *  the width track is scored into columns, the height track IS two rows. */
function TrackRule({ look, norm, axis }: { look: Look; norm: number; axis: 'h' | 'v' }) {
  const textured = look.cue === 'texture'

  if (textured && axis === 'v') {
    const each = Math.max(1.5, (look.trackH - 1.5) / 2)
    return (
      <div className="flex w-full flex-col justify-center gap-[1.5px]">
        {[0, 1].map((i) => (
          <div key={i} className="relative w-full overflow-hidden rounded-full bg-[var(--border)]" style={{ height: each }}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent-muted)]" style={{ width: `${norm * 100}%` }} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="relative w-full overflow-hidden rounded-full bg-[var(--border)]" style={{ height: look.trackH }}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent-muted)]" style={{ width: `${norm * 100}%` }} />
      {textured && [0.25, 0.5, 0.75].map((t) => (
        <div key={t} className="absolute inset-y-0 w-px bg-[var(--bg-app)]" style={{ left: `${t * 100}%` }} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The control                                                         */
/* ------------------------------------------------------------------ */

const SURFACE: Record<Look['surface'], string> = {
  pill: 'h-6 gap-2.5 rounded-full bg-white/[0.03] px-2.5 transition-colors hover:bg-white/[0.06]',
  soft: 'h-6 gap-2.5 rounded-[4px] bg-white/[0.03] px-2.5 transition-colors hover:bg-white/[0.06]',
  none: 'h-6 gap-4',
}

function ZoomControl({ look, pair }: { look: Look; pair: Pair }) {
  const dragH = useDragBox(pair.setH)
  const dragV = useDragBox(pair.setV)

  const axis = (
    kind: 'h' | 'v',
    drag: ReturnType<typeof useDragBox>,
    label: string,
    norm: number,
    nudge: (d: -1 | 1) => void,
    value: number,
    unit: string,
    range: { min: number; max: number },
  ) => (
    <div className="group/axis flex items-center gap-1.5" title={label}>
      <Cue kind={look.cue} axis={kind} />
      <div className="relative flex items-center" style={{ width: look.trackW }}>
        <div
          ref={drag.ref}
          onPointerDown={drag.onPointerDown}
          onKeyDown={arrowKeys(nudge)}
          {...sliderAria(label, value, unit, range)}
          className="relative flex h-4 w-full cursor-ew-resize items-center rounded-sm outline-none focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
        >
          <TrackRule look={look} norm={norm} axis={kind} />
          <Thumb kind={look.thumb} norm={norm} />
        </div>
        {look.readout === 'hover' && (
          // Sits ON the rule so appearing never reflows the tab bar beside it.
          <span className="pointer-events-none absolute -top-[4px] left-0 font-mono text-[9.5px] leading-none tabular-nums text-[var(--text-muted)] opacity-0 transition-opacity duration-150 group-hover/axis:opacity-100">
            {value}
          </span>
        )}
      </div>
      {look.readout === 'always' && (
        // Fixed width + tabular figures: the control must not jitter as the
        // number goes from two digits to three mid-drag.
        <span className="w-[19px] flex-shrink-0 text-right font-mono text-[9.5px] leading-none tabular-nums text-[var(--text-muted)]">
          {value}
        </span>
      )}
    </div>
  )

  return (
    <div className={`flex flex-shrink-0 items-center ${SURFACE[look.surface]}`}>
      {axis('h', dragH, 'Horizontal zoom - beat width', pair.h, pair.nudgeH, pair.ppb, 'pixels per beat', PPB)}
      {look.divider && <div className="h-3 w-px flex-shrink-0 bg-[var(--border)]" aria-hidden="true" />}
      {axis('v', dragV, 'Vertical zoom - track height', pair.v, pair.nudgeV, pair.row, 'pixels per row', ROW)}
    </div>
  )
}

/** How many marks a look spends — the number the whole exercise is about. */
function inkCount(look: Look): number {
  let n = 2 // the two tracks
  if (look.surface !== 'none') n += 1
  if (look.divider) n += 1
  if (look.thumb !== 'none') n += 2
  if (look.cue !== 'none' && look.cue !== 'texture') n += 2
  if (look.readout === 'always') n += 2
  return n
}

const describe = (l: Look) =>
  `surface:${l.surface} · divider:${l.divider ? 'on' : 'off'} · track:${l.trackH}×${l.trackW} · thumb:${l.thumb} · cue:${l.cue} · readout:${l.readout}`

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

const CURRENT: Look = { surface: 'pill', divider: true, trackH: 4, trackW: 64, thumb: 'round11', cue: 'lucide', readout: 'none' }

const PRESETS: { id: string; name: string; note: string; look: Look }[] = [
  {
    id: '00',
    name: 'Current — reference',
    note: 'The shipped control, so everything below is judged against it and not against memory.',
    look: CURRENT,
  },
  {
    id: '1',
    name: 'Quieted',
    note: 'Nothing removed, everything dialled down: 3px track, an 8px borderless thumb, the same icons at strokeWidth 1.25 in --text-faint. The lowest-risk answer to "slightly too noisy" — same anatomy, same affordances, about half the ink.',
    look: { surface: 'pill', divider: true, trackH: 3, trackW: 64, thumb: 'round8', cue: 'lucideLight', readout: 'hover' },
  },
  {
    id: '2',
    name: 'Quieted + gap glyphs',
    note: 'Preset 1 with the arrows swapped for the two-hairline glyphs — | | for beat width, ≡ for row height. Same job, but it depicts the quantity instead of the gesture, and axis-aligned strokes stay crisp at 10px.',
    look: { surface: 'pill', divider: true, trackH: 3, trackW: 64, thumb: 'round8', cue: 'glyph', readout: 'hover' },
  },
  {
    id: '3',
    name: 'Thin + current',
    note: 'The hairline treatment inside the shipped shell: 2px rule, no thumb, no divider, light icons. The fill is the value. This is the literal combination you asked for.',
    look: { surface: 'pill', divider: false, trackH: 2, trackW: 64, thumb: 'none', cue: 'lucideLight', readout: 'hover' },
  },
  {
    id: '4',
    name: 'Thin + a dot',
    note: 'Preset 3 with a 4px dot put back. A thumbless rule reads as an indicator rather than a control; a dot is the smallest mark that says "grab me" and still leaves the rule quiet.',
    look: { surface: 'pill', divider: false, trackH: 2, trackW: 64, thumb: 'dot', cue: 'glyph', readout: 'hover' },
  },
  {
    id: '5',
    name: 'The track is the cue',
    note: 'No glyphs at all — the width track is one rule scored into columns, the height track is two stacked rows. The cue costs zero extra marks because it is drawn in ink the control was already spending, and it depicts the timeline itself.',
    look: { surface: 'pill', divider: true, trackH: 4, trackW: 56, thumb: 'dot', cue: 'texture', readout: 'hover' },
  },
  {
    id: '6',
    name: 'Mono',
    note: 'W and H in 9px mono. No pictogram to decode and no new vocabulary — the app labels things in mono everywhere else. Squared surface per the design guide, numbers always on.',
    look: { surface: 'soft', divider: false, trackH: 3, trackW: 56, thumb: 'bar', cue: 'letters', readout: 'always' },
  },
]

/* ------------------------------------------------------------------ */
/* The faked scene bar the options are judged in                       */
/* ------------------------------------------------------------------ */

const SCENES = ['Main', 'Intro', 'Chorus', 'Outro']

/** SceneTabs' real markup, minus the stores — the control has to be judged
 *  against the display italic type it sits beside, not on a blank page. */
function SceneBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[64px] items-center gap-8 overflow-hidden border-t border-[rgba(255,255,255,0.06)] bg-[var(--bg-app)]/85 px-6 select-none">
      {SCENES.map((name, index) => {
        const active = index === 2
        return (
          <div
            key={name}
            className={`flex flex-shrink-0 items-baseline gap-2.5 border-b-2 pb-1 ${active ? 'border-[var(--accent)]' : 'border-transparent'}`}
          >
            <span className={`font-mono text-[10.5px] leading-none ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className={`max-w-44 truncate text-[22px] italic leading-none [font-family:var(--font-display)] ${active ? 'text-[var(--accent)]' : 'text-[rgba(233,237,244,0.32)]'}`}>
              {name}
            </span>
          </div>
        )
      })}
      <span className="flex-shrink-0 pb-1 text-[17px] italic leading-none [font-family:var(--font-display)] text-[var(--text-muted)]">
        + new scene
      </span>
      <div className="ml-auto flex min-w-0 items-center">{children}</div>
    </div>
  )
}

function PresetRow({ id, name, note, look }: { id: string; name: string; note: string; look: Look }) {
  const pair = useZoomPair()
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-baseline gap-3 px-1">
        <span className="font-mono text-[11px] leading-none text-[var(--accent)]">{id}</span>
        <span className="text-[13px] font-medium leading-none text-[var(--text)]">{name}</span>
        <span className="ml-auto font-mono text-[10px] leading-none text-[var(--text-faint)]">{inkCount(look)} marks</span>
      </div>
      <p className="mb-3 max-w-[74ch] px-1 text-[12px] leading-relaxed text-[var(--text-3)]">{note}</p>
      {/* A sliver of the viewport above the bar: the strip sits on that seam,
          and the options read differently against it than against a flat page. */}
      <div className="overflow-hidden rounded-md border border-[var(--border-subtle)]">
        <div className="h-8 bg-[var(--bg-canvas)]" />
        <SceneBar><ZoomControl look={look} pair={pair} /></SceneBar>
      </div>
      <p className="mt-1.5 px-1 font-mono text-[10px] leading-none text-[var(--text-faint)]">{describe(look)}</p>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* The explorer                                                        */
/* ------------------------------------------------------------------ */

function Segmented<K extends string>({ label, options, value, onChange }: {
  label: string
  options: readonly K[]
  value: K
  onChange: (v: K) => void
}) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-center gap-3">
      <span className="text-[11px] text-[var(--text-3)]">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`cursor-pointer rounded-[3px] border px-2 py-[3px] font-mono text-[10px] leading-none transition-colors ${
              value === o
                ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                : 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            {String(o)}
          </button>
        ))}
      </div>
    </div>
  )
}

function Explorer() {
  const pair = useZoomPair()
  const [look, setLook] = useState<Look>(PRESETS[2].look)
  const set = <K extends keyof Look>(key: K, value: Look[K]) => setLook((l) => ({ ...l, [key]: value }))

  return (
    <section className="mt-12 border-t border-[var(--border-subtle)] pt-8">
      <h2 className="mb-2 px-1 text-[13px] font-medium text-[var(--text)]">Build it</h2>
      <p className="mb-5 max-w-[74ch] px-1 text-[12px] leading-relaxed text-[var(--text-3)]">
        Every axis of the design is a toggle. Dial the combination you want, then hand me back the
        line printed under the bar and I&apos;ll ship exactly that.
      </p>

      <div className="overflow-hidden rounded-md border border-[var(--border-subtle)]">
        <div className="h-8 bg-[var(--bg-canvas)]" />
        <SceneBar><ZoomControl look={look} pair={pair} /></SceneBar>
      </div>

      <div className="mt-1.5 flex items-baseline gap-3 px-1">
        <p className="font-mono text-[10px] leading-none text-[var(--accent)]">{describe(look)}</p>
        <span className="ml-auto font-mono text-[10px] leading-none text-[var(--text-faint)]">{inkCount(look)} marks</span>
      </div>

      <div className="mt-5 grid gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-5">
        <Segmented label="surface" options={['pill', 'soft', 'none'] as const} value={look.surface} onChange={(v) => set('surface', v)} />
        <Segmented label="divider" options={['on', 'off'] as const} value={look.divider ? 'on' : 'off'} onChange={(v) => set('divider', v === 'on')} />
        <Segmented label="track h" options={['2', '3', '4'] as const} value={String(look.trackH) as '2' | '3' | '4'} onChange={(v) => set('trackH', Number(v) as Look['trackH'])} />
        <Segmented label="track w" options={['48', '56', '64'] as const} value={String(look.trackW) as '48' | '56' | '64'} onChange={(v) => set('trackW', Number(v) as Look['trackW'])} />
        <Segmented label="thumb" options={['round11', 'round8', 'bar', 'dot', 'none'] as const} value={look.thumb} onChange={(v) => set('thumb', v)} />
        <Segmented label="cue" options={['lucide', 'lucideLight', 'glyph', 'letters', 'texture', 'none'] as const} value={look.cue} onChange={(v) => set('cue', v)} />
        <Segmented label="readout" options={['none', 'hover', 'always'] as const} value={look.readout} onChange={(v) => set('readout', v)} />
        <p className="mt-1 max-w-[74ch] border-t border-[var(--border-subtle)] pt-3 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          <span className="font-mono text-[10px] text-[var(--text-3)]">cue:{look.cue}</span> — {CUE_NOTES[look.cue]}
        </p>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */

export default function TimelineZoomLab() {
  const strip = useZoomPair()

  return (
    <div className="min-h-screen bg-[var(--bg-shell)] px-8 py-10 text-[var(--text-2)]">
      <div className="mx-auto max-w-[900px]">
        <h1 className="mb-2 text-[26px] italic leading-none [font-family:var(--font-display)] text-[var(--text)]">
          timeline width / height
        </h1>
        <p className="mb-3 max-w-[74ch] text-[12.5px] leading-relaxed text-[var(--text-3)]">
          Same control, less ink. Nothing here restructures the shipped pill-and-two-sliders — the
          brief is that it is right, just slightly noisy. All of them are live; drag them.
        </p>
        <p className="mb-8 max-w-[74ch] text-[12.5px] leading-relaxed text-[var(--text-muted)]">
          The shipped version spends ten marks on two numbers: a capsule, a divider, two bordered
          11px thumbs, two dense icons, two tracks. The presets spend four to eight. The icons keep
          their job in every one — something has to say which axis is which, at rest — but the job
          turns out to be doable in one or two strokes, or in the track itself.
        </p>

        {PRESETS.map((p) => <PresetRow key={p.id} {...p} />)}

        <section className="mt-12 border-t border-[var(--border-subtle)] pt-8">
          <h2 className="mb-2 px-1 text-[13px] font-medium text-[var(--text)]">Resting weight, side by side</h2>
          <p className="mb-4 max-w-[74ch] px-1 text-[12px] leading-relaxed text-[var(--text-3)]">
            Same values in every row, no hover — so what differs is only how much ink each one
            spends when nobody is looking at it.
          </p>
          <div className="grid grid-cols-[110px_1fr_auto] items-center gap-x-6 gap-y-5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-6 py-6">
            {PRESETS.map((p) => (
              <div key={p.id} className="contents">
                <span className="font-mono text-[10px] text-[var(--text-muted)]">{p.id} {p.name.split(' —')[0].toLowerCase()}</span>
                <div className="flex items-center"><ZoomControl look={p.look} pair={strip} /></div>
                <span className="font-mono text-[10px] text-[var(--text-faint)]">{inkCount(p.look)}</span>
              </div>
            ))}
          </div>
        </section>

        <Explorer />

        <p className="mt-10 px-1 text-[11px] leading-relaxed text-[var(--text-faint)]">
          Prototype only — local state, no stores. Nothing on this page is wired to the editor.
        </p>
      </div>
    </div>
  )
}
