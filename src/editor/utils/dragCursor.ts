// Shared cursor lock for drag gestures. While a drag is active we force one cursor
// for the entire document so it never flickers when the pointer outruns the dragged
// element or passes over something (a block, a note, the playhead) with its own
// cursor. One mechanism for every gesture: scrub, block move/resize, note edit, etc.
//
// Pairs with two rules in globals.css:
//  - body.cursor-locked  → forces --drag-cursor everywhere.
//  - body.drag-moving    → also swallows pointer events on everything else, so a drag
//    can't collaterally hover/click/animate other UI.
// BOTH are applied only once the pointer has actually MOVED past a small threshold,
// never on the press itself. Two reasons: several gestures lock on pointerdown before
// a drag is confirmed, and suppressing pointer events during a plain press would break
// the native click / double-click (the pointerup would land on the element behind).
// And each `body.<class> *` rule invalidates the style of EVERY element in the
// document when the class flips - ~70ms per flip on a 50-track project - which a
// plain click paid twice (press + release) for a cursor nobody saw. A press is left
// completely untouched now: no class, no inline style, so the click's own handlers
// (and PostHog's autocapture, which reads getComputedStyle up the ancestor chain)
// never force that recalc. Three pixels of travel is too little for the pointer to
// outrun the element and flicker before the lock lands.

const MOVE_THRESHOLD_PX = 3
let moveTracker: ((e: PointerEvent) => void) | null = null

// Lucide Repeat2, rendered as a compact high-contrast cursor for the timeline's
// loop-only edge zone. The hotspot sits at the icon's center.
const LOOP_CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="6" fill="#000" stroke="#fff" stroke-width="1.5"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/></g></svg>`
export const LOOP_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(LOOP_CURSOR_SVG)}") 8 8, default`

let pendingCursor = ''
let moving = false

function applyLock(cursor: string) {
  document.body.style.setProperty('--drag-cursor', cursor)
  document.body.classList.add('cursor-locked', 'drag-moving')
  document.body.style.userSelect = 'none'
  moving = true
}

export function lockCursor(cursor: string) {
  // Already moving (a re-lock mid-gesture with a new cursor): apply directly.
  if (moving) { applyLock(cursor); return }
  pendingCursor = cursor
  if (moveTracker) return
  let ox: number | null = null
  let oy: number | null = null
  moveTracker = (e: PointerEvent) => {
    if (ox === null) { ox = e.clientX; oy = e.clientY; return }
    if (Math.hypot(e.clientX - ox, e.clientY - (oy as number)) < MOVE_THRESHOLD_PX) return
    applyLock(pendingCursor)
    if (moveTracker) { window.removeEventListener('pointermove', moveTracker); moveTracker = null }
  }
  window.addEventListener('pointermove', moveTracker)
}

export function unlockCursor() {
  document.body.classList.remove('cursor-locked')
  document.body.classList.remove('drag-moving')
  document.body.style.removeProperty('--drag-cursor')
  document.body.style.userSelect = ''
  moving = false
  if (moveTracker) { window.removeEventListener('pointermove', moveTracker); moveTracker = null }
}
