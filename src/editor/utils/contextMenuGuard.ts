// A right-button draw gesture (blocks on the timeline, notes in the MIDI
// editor) that ends OUTSIDE the drawing surface still fires `contextmenu` on
// release - the lane's own onContextMenu preventDefault never sees it, so the
// browser menu pops over the app. Swallow exactly the one release that belongs
// to the drag that just ended; the timeout keeps a missing event (some
// platforms fire contextmenu on press, not release) from eating a later,
// legitimate right-click.
export function suppressNextContextMenu(windowMs = 300): void {
  const suppress = (e: MouseEvent) => e.preventDefault()
  window.addEventListener('contextmenu', suppress, { capture: true })
  setTimeout(() => window.removeEventListener('contextmenu', suppress, { capture: true }), windowMs)
}
