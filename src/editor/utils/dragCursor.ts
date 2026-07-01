// Shared cursor lock for drag gestures. While a drag is active we force one cursor
// for the entire document so it never flickers when the pointer outruns the dragged
// element or passes over something (a block, a note, the playhead) with its own
// cursor. One mechanism for every gesture: scrub, block move/resize, note edit, etc.
//
// Pairs with two rules in globals.css:
//  - body.cursor-locked  → forces --drag-cursor everywhere (from the moment of press).
//  - body.drag-moving    → also swallows pointer events on everything else, so a drag
//    can't collaterally hover/click/animate other UI. This is applied only once the
//    pointer has actually MOVED past a small threshold — several gestures lock on
//    pointerdown before a drag is confirmed, and suppressing pointer events during a
//    plain press would break the native click / double-click (the pointerup would
//    land on the element behind). No movement = a click, and it's left untouched.

const MOVE_THRESHOLD_PX = 3
let moveTracker: ((e: PointerEvent) => void) | null = null

export function lockCursor(cursor: string) {
  document.body.style.setProperty('--drag-cursor', cursor)
  document.body.classList.add('cursor-locked')
  document.body.style.userSelect = 'none'
  if (moveTracker) return
  let ox: number | null = null
  let oy: number | null = null
  moveTracker = (e: PointerEvent) => {
    if (ox === null) { ox = e.clientX; oy = e.clientY; return }
    if (Math.hypot(e.clientX - ox, e.clientY - (oy as number)) < MOVE_THRESHOLD_PX) return
    document.body.classList.add('drag-moving')
    if (moveTracker) { window.removeEventListener('pointermove', moveTracker); moveTracker = null }
  }
  window.addEventListener('pointermove', moveTracker)
}

export function unlockCursor() {
  document.body.classList.remove('cursor-locked')
  document.body.classList.remove('drag-moving')
  document.body.style.removeProperty('--drag-cursor')
  document.body.style.userSelect = ''
  if (moveTracker) { window.removeEventListener('pointermove', moveTracker); moveTracker = null }
}
