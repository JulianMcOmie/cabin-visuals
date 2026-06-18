// Shared cursor lock for drag gestures. While a drag is active we force one cursor
// for the entire document so it never flickers when the pointer outruns the dragged
// element or passes over something (a block, a note, the playhead) with its own
// cursor. One mechanism for every gesture: scrub, block move/resize, note edit.
//
// Pairs with the `body.cursor-locked` rule in globals.css, which reads --drag-cursor.

export function lockCursor(cursor: string) {
  document.body.style.setProperty('--drag-cursor', cursor)
  document.body.classList.add('cursor-locked')
  document.body.style.userSelect = 'none'
}

export function unlockCursor() {
  document.body.classList.remove('cursor-locked')
  document.body.style.removeProperty('--drag-cursor')
  document.body.style.userSelect = ''
}
