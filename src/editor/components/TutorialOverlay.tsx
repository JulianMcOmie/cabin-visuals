'use client'

import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { useUIStore } from '../store/UIStore'
import { getPlaybackEngine } from '../core/playback'
import { track } from '../../analytics/analytics'

const DONE_KEY = 'cabin:tutorial:pulse-cube:v1'
// Set on every editor open: its absence is what "first time in the editor" means.
const VISITED_KEY = 'cabin:editor:visited'
// Session-scoped: keeps an in-progress tutorial alive across a reload in the
// same tab, without nagging forever in future sessions.
const ACTIVE_KEY = 'cabin:tutorial:pulse-cube:active'

/**
 * First-time-user tutorial: walk a brand-new user to their first pulsing
 * cube. Fully interactive - each step is DETECTED from the stores (no "Next"
 * button): it advances the moment the user actually adds the Cube, draws a
 * block, opens it, draws a note, and presses play.
 *
 * Presentation is a spotlight: the screen dims except for a cutout over the
 * element the current gesture targets (the dim is one huge box-shadow on the
 * cutout), with the instruction card sitting NEXT to the cutout. The whole
 * overlay is pointer-events:none (only the card is interactive), so every
 * gesture still lands on the real UI. The overlay NEVER hides during drags -
 * un-dimming and re-dimming the whole screen per gesture reads as the
 * tutorial flickering on and off. Instead the spotlight FOLLOWS the action:
 * the target re-measures on a fast interval, so the cutout tracks a block as
 * it's drawn or moved, and during the step-0 library drag it slides to the
 * drop zone (the track-label column).
 *
 * Shows on a person's FIRST editor open (no visited marker in this browser),
 * then never again: completing or skipping sets the done flag, and any other
 * editor use marks the browser as visited so the tutorial's moment has
 * passed. The decision is made ONCE per mount and then sticks - the
 * anonymous adoption flow swaps ?project= into the URL mid-tutorial, and
 * that must not re-evaluate (and hide) an engaged tutorial.
 */

const STEP_TEXTS: ReactNode[] = [
  <>Drag the <b className="text-[var(--text)]">Cube</b> into the track list</>,
  <><b className="text-[var(--text)]">Right-click</b> this lane to draw a block</>,
  <><b className="text-[var(--text)]">Double-click</b> the block to open it</>,
  <><b className="text-[var(--text)]">Right-click</b> between the purple lines to draw a few notes</>,
  <>Close the MIDI editor when you&apos;re done</>,
  <>Press <b className="text-[var(--text)]">play</b> - the cube pulses with every note</>,
]

const PAD = 6 // spotlight breathing room around the target
const CARD_W = 300
const CARD_H = 88
const GAP = 14

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

/** Place the card beside the cutout: right → left → below → above → inside. */
function cardStyle(r: DOMRect): CSSProperties {
  const W = window.innerWidth
  const H = window.innerHeight
  const midTop = clamp(r.top + r.height / 2 - CARD_H / 2, 8, H - CARD_H - 8)
  const midLeft = clamp(r.left + r.width / 2 - CARD_W / 2, 8, W - CARD_W - 8)
  if (r.right + GAP + CARD_W < W && r.height < H * 0.6) return { left: r.right + GAP, top: midTop }
  if (r.left - GAP - CARD_W > 0 && r.height < H * 0.6) return { left: r.left - GAP - CARD_W, top: midTop }
  if (r.bottom + GAP + CARD_H < H) return { top: r.bottom + GAP, left: midLeft }
  if (r.top - GAP - CARD_H > 0) return { top: r.top - GAP - CARD_H, left: midLeft }
  return { top: r.top + 16, left: midLeft }
}

function rectsDiffer(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return a !== b
  return (
    Math.abs(a.x - b.x) > 0.5 ||
    Math.abs(a.y - b.y) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  )
}

export function TutorialOverlay() {
  const tracks = useProjectStore((s) => s.tracks)
  const isPlaying = useTimeStore((s) => s.isPlaying)
  const editingBlock = useUIStore((s) => s.editingBlock)
  const libraryDragging = useUIStore((s) => s.libraryDragging)
  const tracksLabelWidth = useUIStore((s) => s.tracksLabelWidth)

  const [engaged, setEngaged] = useState<boolean | null>(null)
  const [celebrating, setCelebrating] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  // Step 0 only: where the curved drag arrow lands (the track-list drop zone).
  const [dropRect, setDropRect] = useState<DOMRect | null>(null)

  // One-shot eligibility decision (see doc comment).
  useEffect(() => {
    if (engaged !== null) return
    const done = !!localStorage.getItem(DONE_KEY)
    const firstOpen = !localStorage.getItem(VISITED_KEY)
    const inProgressThisSession = !!sessionStorage.getItem(ACTIVE_KEY)
    localStorage.setItem(VISITED_KEY, '1')
    const engage = !done && (firstOpen || inProgressThisSession)
    if (engage) sessionStorage.setItem(ACTIVE_KEY, '1')
    setEngaged(engage)
  }, [engaged])

  // Progress, derived live from the document. The notes step wants at least
  // TWO notes (one note isn't a rhythm), and the MIDI editor must be CLOSED
  // again before the play step - reopening it drops back to the close step.
  const cube = Object.values(tracks).find((t) => t.instrumentId === 'cube')
  const firstBlock = cube?.blocks[0]
  const hasNotes = !!cube && cube.blocks.reduce((n, b) => n + b.notes.length, 0) >= 2
  const pianoRollOpen = !!editingBlock
  const step =
    !cube ? 0
    : !firstBlock ? 1
    : !hasNotes && !pianoRollOpen ? 2
    : !hasNotes ? 3
    : pianoRollOpen ? 4
    : 5

  // The current gesture's on-screen target.
  const targetSelector =
    step === 0 ? '[data-instrument-id="cube"]'
    : step === 1 ? `[data-track-lane="${cube?.id}"]`
    : step === 2 ? `[data-block-id="${firstBlock?.id}"]`
    : step === 3 ? '[data-midi-block-region]'
    : step === 4 ? '[data-midi-close]'
    : '[data-tutorial-play]'

  // Completion: they pressed play, and the playhead has traveled PAST their
  // block - they've seen every note pulse. Auto-pause so the moment lands,
  // then show the final prompt.
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const blockEndBeat = firstBlock ? (firstBlock.startBar + firstBlock.durationBars) * beatsPerBar : null
  useEffect(() => {
    if (!engaged || celebrating || step !== 5 || blockEndBeat === null) return
    const unsub = useTimeStore.subscribe((s) => {
      if (!s.isPlaying || s.currentBeat < blockEndBeat) return
      getPlaybackEngine().pause()
      useTimeStore.getState().setIsPlaying(false)
      setCelebrating(true)
    })
    return unsub
  }, [engaged, celebrating, step, blockEndBeat])
  useEffect(() => {
    if (!celebrating) return
    localStorage.setItem(DONE_KEY, 'done')
    sessionStorage.removeItem(ACTIVE_KEY)
    track('tutorial_completed')
  }, [celebrating])

  // Track the target's rect (layout moves: panel resize, scroll, zoom).
  // A LAYOUT effect: when a step completes, the new target must be measured
  // BEFORE the browser paints - with a plain effect the first painted frame
  // still shows the PREVIOUS step's cutout (a visible flash back to the old
  // spotlight the instant the cube lands).
  useLayoutEffect(() => {
    if (!engaged || celebrating) return
    const measure = () => {
      const el = document.querySelector(targetSelector)
      if (el instanceof HTMLElement) {
        const r = el.getBoundingClientRect()
        // Clamp to the viewport - a timeline lane is wider than the screen.
        const left = Math.max(r.left, 0)
        const top = Math.max(r.top, 0)
        let right = Math.min(r.right, window.innerWidth)
        const bottom = Math.min(r.bottom, window.innerHeight)
        // The draw-a-block step spotlights just the lane's first two bars -
        // a full-width strip reads as "anywhere", and anywhere is wrong.
        if (targetSelector.startsWith('[data-track-lane')) {
          const twoBars = useUIStore.getState().tracksPixelsPerBeat * useProjectStore.getState().beatsPerBar * 2
          right = Math.min(right, r.left + twoBars)
        }
        const next = right > left && bottom > top ? new DOMRect(left, top, right - left, bottom - top) : null
        setRect((prev) => (rectsDiffer(prev, next) ? next : prev))
      } else {
        setRect(null)
      }
      // The drag arrow's destination: the track list (label column).
      if (targetSelector === '[data-instrument-id="cube"]') {
        const sc = document.querySelector('[data-tracks-scroll]')
        const next = sc instanceof HTMLElement ? sc.getBoundingClientRect() : null
        setDropRect((prev) => (rectsDiffer(prev, next) ? next : prev))
      } else {
        setDropRect(null)
      }
    }
    measure()
    // Fast enough that the cutout visibly FOLLOWS a block being drawn/moved.
    const iv = setInterval(measure, 100)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearInterval(iv)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [engaged, celebrating, targetSelector])

  // While the Cube is being carried in (step 0's library drag), the spotlight
  // slides from the Cube item to the drop zone (the track-label column) so
  // the dim guides the drag instead of fighting it.
  const dropZoneSpot =
    libraryDragging && step === 0 && dropRect
      ? new DOMRect(dropRect.left, dropRect.top, Math.min(tracksLabelWidth + 8, dropRect.width), dropRect.height)
      : null

  if (!engaged) return null

  const skip = () => {
    localStorage.setItem(DONE_KEY, 'done')
    sessionStorage.removeItem(ACTIVE_KEY)
    track('tutorial_skipped', { step })
    setEngaged(false)
  }

  const card = (style: CSSProperties, content: ReactNode) => (
    <div
      className="pointer-events-auto fixed z-[110] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.6)] transition-[left,top] duration-150 ease-out"
      style={{ width: CARD_W, ...style }}
    >
      {content}
    </div>
  )

  const stepContent = (
    <>
      <div className="mb-2 flex items-center gap-1.5">
        {STEP_TEXTS.map((_, i) => (
          <span
            key={i}
            className={
              i < step
                ? 'h-1.5 w-1.5 rounded-full bg-[var(--accent)]'
                : i === step
                  ? 'h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]'
                  : 'h-1.5 w-1.5 rounded-full border border-[var(--border-strong)]'
            }
          />
        ))}
        <button
          onClick={skip}
          className="ml-auto cursor-pointer text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-2)]"
        >
          Skip
        </button>
      </div>
      <div className="text-[13px] leading-snug text-[var(--text-2)]">{STEP_TEXTS[step]}</div>
    </>
  )

  if (celebrating) {
    return card(
      { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 380 },
      <div className="flex flex-col items-center gap-3 py-1 text-center">
        <span className="text-[13px] leading-snug text-[var(--text-2)]">
          <span className="font-semibold text-[var(--accent)]">You have the basics!</span> Experiment with
          dragging in other instruments and adding notes to them
        </span>
        <button
          onClick={() => setEngaged(false)}
          className="cursor-pointer rounded bg-[var(--accent)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          Start creating
        </button>
      </div>,
    )
  }

  // While their creation plays, get out of the way entirely - no dim, no
  // card. The pass-the-block watcher above ends the tutorial.
  if (step === 5 && isPlaying) return null

  // Mid-drag the spotlight sits on the drop zone; otherwise on the gesture target.
  const spot = dropZoneSpot ?? rect

  if (!spot) {
    // Target not on screen (yet) - no dim, just the instruction.
    return card({ bottom: 16, left: '50%', transform: 'translateX(-50%)' }, stepContent)
  }

  // Step 0's curved drag arrow: from the Cube's cutout down into the track
  // list, bulging right so it reads as a "pick up and carry" motion. Once the
  // drag is live the ghost IS the motion - the arrow stands down.
  let arrowPath: string | null = null
  let arrowEnd: { x: number; y: number } | null = null
  if (!dropZoneSpot && dropRect && rect) {
    const sx = rect.x + rect.width / 2 + PAD
    const sy = rect.bottom + PAD + 4
    const ex = dropRect.left + 72
    const ey = dropRect.top + 30
    const bulge = Math.min(150, Math.max(70, (ey - sy) * 0.45))
    arrowPath = `M ${sx} ${sy} C ${sx + bulge} ${sy + (ey - sy) * 0.25}, ${ex + bulge} ${ey - (ey - sy) * 0.3}, ${ex + 10} ${ey - 6}`
    arrowEnd = { x: ex + 10, y: ey - 6 }
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]">
      {/* The cutout: its oversized shadow is the screen dim. Position/size
          transition so the spotlight GLIDES as its target grows or moves
          (drawing a block, carrying the drag) instead of jumping per measure. */}
      <div
        className="fixed rounded-lg"
        style={{
          left: spot.x - PAD,
          top: spot.y - PAD,
          width: spot.width + PAD * 2,
          height: spot.height + PAD * 2,
          boxShadow: '0 0 0 200vmax rgba(4, 4, 6, 0.66)',
          transition: 'left 120ms ease-out, top 120ms ease-out, width 120ms ease-out, height 120ms ease-out',
        }}
      >
        <div
          className="absolute inset-0 rounded-lg border border-[var(--accent)]/70"
          style={{ animation: 'tutorial-pulse 1.6s ease-in-out infinite' }}
        />
      </div>
      {arrowPath && arrowEnd && (
        <svg className="fixed inset-0 h-full w-full" style={{ filter: 'drop-shadow(0 0 6px rgba(53,167,230,0.5))' }}>
          <defs>
            <marker id="tutorial-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          <path
            d={arrowPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="7 7"
            markerEnd="url(#tutorial-arrowhead)"
          />
        </svg>
      )}
      {card(cardStyle(spot), stepContent)}
    </div>
  )
}
