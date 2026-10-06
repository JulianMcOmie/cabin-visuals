'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MIN_BPM, MAX_BPM } from '../store/ProjectStore'
import { tapTempoBpm } from '../utils/tapTempo'
import { HandTapIcon, MetronomeIcon } from './TransportIcons'

const PANEL_WIDTH = 232
// Below this much room above the opener, the panel drops under it instead.
const MIN_ROOM_ABOVE = 220
// One dot per tap, grouped like beats in a bar, GROUPS_PER_ROW bars to a row.
const GROUP = 4
const GROUPS_PER_ROW = 4
// The dot area is a fixed two rows (32 taps) and shows the newest two beyond
// that. Fixed, because anything that grows above the Tap button moves the
// button out from under a pointer that is mid-rhythm.
const VISIBLE_ROWS = 2
// What the readout shows after ONE tap, when there is a beat but no interval
// yet. A fixed number, not the project's tempo - the tapper reads nothing from
// the project and writes nothing to it.
const DEFAULT_BPM = 120

type Anchor = { top: number; bottom: number; right: number }

// Every animation here is decoration on top of a state that is already
// correct, so skipping them all is a complete reduced-motion story.
const motionOk = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Tap tempo, opened from the metronome beside the tempo readout.
 *
 * Four things and no more: the BPM, a dot per tap (in fours), Reset, Tap.
 * It is a MEASURING tool, deliberately not wired to the project - tapping only
 * moves the popover's own readout and nothing here writes the tempo. A tapper
 * that rewrites bpm on every tap re-anchors the audio you are tapping along to,
 * mid-tap.
 *
 * Space is left alone on purpose - it stays play/pause, because the whole point
 * is tapping along to the song that is playing. T taps instead.
 */
export function TapTempo() {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setAnchor(null), [])

  const toggle = () => {
    if (anchor) return close()
    const r = openerRef.current!.getBoundingClientRect()
    setAnchor({ top: r.top, bottom: r.bottom, right: r.right })
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={toggle}
        // Enter must not bubble to the transport keys' window listener (same
        // guard as BpmControl / PlaybackRateControl).
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.stopPropagation()
        }}
        aria-label="Tap tempo"
        aria-expanded={anchor !== null}
        title="Tap tempo"
        className={`flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent active:scale-[0.92] focus-visible:outline-1 focus-visible:outline-[var(--accent)] ${
          anchor ? 'text-[var(--accent)]' : 'text-[var(--text-3)] hover:text-[var(--accent-hover)]'
        }`}
      >
        <MetronomeIcon />
      </button>
      {anchor && <TapTempoPanel anchor={anchor} opener={openerRef} onClose={close} />}
    </>
  )
}

/** A tap. Pops in once, on mount; `fresh` is the newest one, lit. */
function TapDot({ fresh }: { fresh: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (!motionOk()) return
    ref.current?.animate([{ transform: 'scale(0.2)' }, { transform: 'scale(1)' }], {
      duration: 200,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    })
  }, [])
  return (
    <span ref={ref} className={`h-1.5 w-1.5 rounded-full ${fresh ? 'bg-[var(--accent)]' : 'bg-white/25'}`} />
  )
}

function TapTempoPanel({
  anchor,
  opener,
  onClose,
}: {
  anchor: Anchor
  opener: React.RefObject<HTMLButtonElement | null>
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const flashRef = useRef<HTMLSpanElement>(null)
  const tapsRef = useRef<number[]>([])
  const [count, setCount] = useState(0)
  const [raw, setRaw] = useState<number | null>(null)

  const opensUp = anchor.top >= MIN_ROOM_ABOVE

  // Always whole: nearly every song is on an integer tempo, and a tapped
  // "119.6" is 120 with human hands on it.
  const value = raw === null ? null : Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(raw)))

  const tap = useCallback((timeStamp: number) => {
    tapsRef.current.push(timeStamp)
    setCount(tapsRef.current.length)
    setRaw(tapTempoBpm(tapsRef.current))
    // Instant on, fade out: the hit has to read on the beat, so nothing eases IN.
    if (motionOk()) {
      flashRef.current?.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' })
    }
  }, [])

  const reset = () => {
    tapsRef.current = []
    setCount(0)
    setRaw(null)
  }

  // Grows out of the opener's corner.
  useLayoutEffect(() => {
    if (!motionOk()) return
    panelRef.current?.animate(
      [{ opacity: 0, transform: `translateY(${opensUp ? 4 : -4}px) scale(0.97)` }, { opacity: 1, transform: 'none' }],
      { duration: 130, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
  }, [opensUp])

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node
      if (panelRef.current?.contains(target)) return
      // The opener toggles the panel itself - let its click handler win.
      if (opener.current?.contains(target)) return
      onClose()
    }
    // Capture phase: T / Escape belong to the panel while it is open, ahead of
    // the editor's own window listeners. Space is NOT claimed - see TapTempo.
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      if (ev.key === 'Escape') onClose()
      else if (ev.key.toLowerCase() === 't') {
        if (!ev.repeat) tap(ev.timeStamp)
      } else return
      ev.preventDefault()
      ev.stopPropagation()
    }
    // Deferred so the opener click that mounted the panel doesn't instantly close it.
    const id = setTimeout(() => window.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(id)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, opener, tap])

  // Hangs off the opener's right edge; anchored by `bottom` when it opens
  // upward so its height never has to be estimated.
  const right = Math.max(8, window.innerWidth - anchor.right)
  const position = opensUp
    ? { right, bottom: window.innerHeight - anchor.top + 8 }
    : { right, top: anchor.bottom + 8 }

  // Whole rows scroll off the top once the area is full; a dot keeps its slot
  // (and its key, so it does not re-pop) for as long as it is on screen.
  const perRow = GROUP * GROUPS_PER_ROW
  const firstTap = Math.max(0, Math.ceil(count / perRow) - VISIBLE_ROWS) * perRow
  const groups: number[][] = []
  for (let i = firstTap; i < count; i++) {
    if ((i - firstTap) % GROUP === 0) groups.push([])
    groups[groups.length - 1].push(i)
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Tap tempo"
      className="fixed z-[70] rounded-xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] p-3.5 shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      style={{ ...position, width: PANEL_WIDTH, transformOrigin: opensUp ? 'bottom right' : 'top right' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* 1. The BPM - the answer, so the biggest thing here. Before the first
          tap the slot holds the prompt instead, in the display serif the
          editor's other empty states speak in. The first tap swaps in the
          number at DEFAULT_BPM, dimmed; the second lights it with a real
          measurement. Same box throughout, so nothing below it moves. */}
      <div className="flex h-10 items-end" aria-live="polite">
        {count === 0 ? (
          <span className="flex items-center gap-2 pb-0.5 text-[var(--text-3)] select-none">
            <HandTapIcon size={22} />
            <span className="text-[26px] italic leading-none [font-family:var(--font-display)]">Tap to the beat</span>
          </span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span
              className={`font-mono text-[40px] leading-[0.8] tracking-[-0.03em] tabular-nums ${
                value === null ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'
              }`}
            >
              {value ?? DEFAULT_BPM}
            </span>
            <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] leading-none text-[var(--text-muted)] select-none">
              BPM
            </span>
          </span>
        )}
      </div>

      {/* 2. One dot per tap, in fours; the newest is lit. Left-anchored slots,
          so a dot never slides sideways once it has landed. The rows centre in
          the reserved band, so a single row sits evenly between the number and
          the buttons instead of hugging the number. */}
      <div
        className="mt-2.5 flex h-[18px] flex-wrap content-center gap-x-2.5 gap-y-1.5"
        role="img"
        aria-label={`${count} ${count === 1 ? 'tap' : 'taps'}`}
      >
        {groups.map((group) => (
          <span key={group[0]} className="flex gap-1">
            {group.map((i) => (
              <TapDot key={i} fresh={i === count - 1} />
            ))}
          </span>
        ))}
      </div>

      {/* 3 + 4. Reset (secondary) and Tap (primary). Tap fires on pointerdown,
          not click: click lands on RELEASE, which would time how long you held
          the button rather than when you hit it. */}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={count === 0}
          className="h-11 cursor-pointer rounded-lg border-0 bg-white/[0.07] px-3.5 text-[12px] font-medium text-[var(--text-2)] hover:bg-white/[0.12] hover:text-[var(--text)] active:scale-[0.97] disabled:cursor-default disabled:text-[var(--text-muted)] disabled:hover:bg-white/[0.07] disabled:active:scale-100 focus-visible:outline-1 focus-visible:outline-[var(--accent)]"
        >
          Reset
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            tap(e.timeStamp)
          }}
          aria-keyshortcuts="T"
          className="relative flex h-11 flex-1 cursor-pointer select-none items-center justify-center overflow-hidden rounded-lg border-0 bg-[var(--accent)] text-[13px] font-semibold text-[var(--on-accent)] outline-none hover:bg-[var(--accent-hover)] active:scale-[0.97] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <span ref={flashRef} className="pointer-events-none absolute inset-0 bg-white opacity-0" />
          <span className="relative">Tap</span>
          <kbd className="absolute right-2.5 flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-black/10 font-mono text-[10px] font-medium text-[var(--on-accent)]/60">
            T
          </kbd>
        </button>
      </div>
    </div>,
    document.body,
  )
}
