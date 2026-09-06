// Keep timeline note DOM stable for scrolling and gestures, but run its
// activity animation only near the lane viewport. One observer per scroller,
// never a layout read or a React subscription on every scroll frame.
interface ViewportObserver {
  observer: IntersectionObserver
  callbacks: Map<Element, (visible: boolean) => void>
}
const observers = new Map<Element | null, ViewportObserver>()

export function observeTimelineViewport(element: Element, callback: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true)
    return () => {}
  }
  const root = element.closest('[data-tracks-scroll]')
  let entry = observers.get(root)
  if (!entry) {
    const callbacks = new Map<Element, (visible: boolean) => void>()
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) callbacks.get(e.target)?.(e.isIntersecting)
    }, { root, rootMargin: '200px' })
    entry = { observer, callbacks }
    observers.set(root, entry)
  }
  entry.callbacks.set(element, callback)
  entry.observer.observe(element)
  return () => {
    entry.callbacks.delete(element)
    entry.observer.unobserve(element)
    if (entry.callbacks.size === 0) {
      entry.observer.disconnect()
      observers.delete(root)
    }
  }
}
