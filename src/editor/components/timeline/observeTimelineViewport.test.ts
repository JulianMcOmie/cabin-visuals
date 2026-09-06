import test from 'node:test'
import assert from 'node:assert/strict'
import { observeTimelineViewport } from './observeTimelineViewport'

test('blocks share a viewport observer and release it when the timeline unmounts', () => {
  const original = globalThis.IntersectionObserver
  const instances: FakeObserver[] = []
  class FakeObserver {
    observed = new Set<Element>()
    disconnected = false
    constructor(public callback: IntersectionObserverCallback, public options: IntersectionObserverInit) { instances.push(this) }
    observe(element: Element) { this.observed.add(element) }
    unobserve(element: Element) { this.observed.delete(element) }
    disconnect() { this.disconnected = true }
    send(target: Element, isIntersecting: boolean) {
      this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
  }
  globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver
  try {
    const root = {} as Element
    const a = { closest: () => root } as unknown as Element
    const b = { closest: () => root } as unknown as Element
    const changes: boolean[] = []
    const stopA = observeTimelineViewport(a, visible => changes.push(visible))
    const stopB = observeTimelineViewport(b, () => {})
    assert.equal(instances.length, 1)
    assert.equal(instances[0].options.root, root)
    assert.equal(instances[0].options.rootMargin, '200px')
    instances[0].send(a, true)
    instances[0].send(a, false)
    assert.deepEqual(changes, [true, false])
    stopA()
    instances[0].send(a, true) // a queued callback after unmount is ignored
    assert.deepEqual(changes, [true, false])
    assert.equal(instances[0].disconnected, false)
    stopB()
    assert.equal(instances[0].disconnected, true)
    const stopAgain = observeTimelineViewport(a, () => {})
    assert.equal(instances.length, 2)
    stopAgain()
  } finally { globalThis.IntersectionObserver = original }
})
