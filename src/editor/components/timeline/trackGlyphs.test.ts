import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as React from 'react'

// trackGlyphs is a .tsx compiled with the CLASSIC JSX runtime by tsx (the repo
// tsconfig sets `jsx: preserve`, so there is no automatic-runtime import in the
// emitted module), which means it reaches for a global `React` at module scope.
// Setting it BEFORE the dynamic import below is what keeps this file loadable
// from `node --test`; a plain top-level `import` would evaluate the module
// first and die with "React is not defined".
;(globalThis as Record<string, unknown>).React = React

type FakeTrack = Record<string, unknown>

const load = () => import('./trackGlyphs')

/** The dashed-circle fallback: what a track with no mark of its own renders. */
async function anonymousMark() {
  const { trackGlyph } = await load()
  return trackGlyph({ type: 'base', instrumentId: 'no-such-instrument' } as never)
}

test('every registered instrument has a mark of its own', async () => {
  const { trackGlyph } = await load()
  const { INSTRUMENTS } = await import('../../instruments')
  const anon = await anonymousMark()
  const missing = Object.keys(INSTRUMENTS).filter(
    (id) => trackGlyph({ type: 'base', instrumentId: id } as never) === anon,
  )
  assert.deepEqual(missing, [], `instruments with no track-row mark: ${missing.join(', ')}`)
})

test('every mover, splitter and colorizer has a mark of its own', async () => {
  const { trackGlyph } = await load()
  const { listMoverOrSplitterDefinitions } = await import('../../core/visualCopies/registry')
  const anon = await anonymousMark()
  const missing = listMoverOrSplitterDefinitions()
    .filter((d) => {
      const track = (d.kind === 'splitter'
        ? { type: 'splitter', splitterId: d.id }
        : { type: 'mover', moverId: d.id }) as FakeTrack
      return trackGlyph(track as never) === anon
    })
    .map((d) => `${d.kind}:${d.id}`)
  assert.deepEqual(missing, [], `devices with no track-row mark: ${missing.join(', ')}`)
})

test('every composition instrument has a mark of its own', async () => {
  const { trackGlyph } = await load()
  const { listCompositionInstruments } = await import('../../core/directors')
  const anon = await anonymousMark()
  const missing = listCompositionInstruments()
    .filter((d) => trackGlyph({ type: 'base', instrumentId: d.id } as never, true) === anon)
    .map((d) => d.id)
  assert.deepEqual(missing, [], `composition instruments with no mark: ${missing.join(', ')}`)
})

// 3D Shape and Wireframe are the two instruments whose mark is not fixed: it
// follows the shape their own picker is on. Both vocabularies are APPEND-ONLY,
// so these guard the thing an append would otherwise break silently - a new
// entry inheriting some other shape's picture, or none at all.

test('every fundamental solid gets a distinct mark, and an unset geometry falls back to the cube', async () => {
  const { trackGlyph } = await load()
  const { FUNDAMENTAL_GEOMETRIES } = await import('../../instruments/FundamentalGeometry')
  const anon = await anonymousMark()
  const seen = new Map<unknown, string>()
  for (const { id } of FUNDAMENTAL_GEOMETRIES) {
    const mark = trackGlyph({ type: 'base', instrumentId: 'cube', stringParams: { geometry: id } } as never)
    assert.notEqual(mark, anon, `solid ${id} has no mark`)
    assert.equal(seen.get(mark), undefined, `solid ${id} shares its mark with ${seen.get(mark)}`)
    seen.set(mark, id)
  }
  assert.equal(seen.size, FUNDAMENTAL_GEOMETRIES.length)
  assert.equal(
    trackGlyph({ type: 'base', instrumentId: 'cube' } as never),
    trackGlyph({ type: 'base', instrumentId: 'cube', stringParams: { geometry: 'cube' } } as never),
  )
})

test('every wireframe shape gets a distinct mark', async () => {
  const { trackGlyph } = await load()
  const { WIREFRAME_SHAPES } = await import('../../instruments/wireframeCore')
  const anon = await anonymousMark()
  const seen = new Map<unknown, string>()
  WIREFRAME_SHAPES.forEach((shape, index) => {
    const mark = trackGlyph({ type: 'base', instrumentId: 'wireframe', params: { shape: index } } as never)
    assert.notEqual(mark, anon, `wireframe shape ${shape.id} has no mark`)
    assert.equal(seen.get(mark), undefined, `wireframe ${shape.id} shares its mark with ${seen.get(mark)}`)
    seen.set(mark, shape.id)
  })
  assert.equal(seen.size, WIREFRAME_SHAPES.length)
})

test('an out-of-range or missing wireframe shape index still resolves to a real mark', async () => {
  const { trackGlyph } = await load()
  const { WIREFRAME_SHAPES, WIREFRAME_DEFAULT_SHAPE } = await import('../../instruments/wireframeCore')
  const anon = await anonymousMark()
  const at = (shape: number | undefined) =>
    trackGlyph({ type: 'base', instrumentId: 'wireframe', params: shape === undefined ? {} : { shape } } as never)

  // Clamped exactly as the instrument clamps it, so the row cannot disagree
  // with the object on screen.
  assert.equal(at(-5), at(0))
  assert.equal(at(999), at(WIREFRAME_SHAPES.length - 1))
  assert.equal(at(3.4), at(3))
  assert.equal(at(undefined), at(WIREFRAME_DEFAULT_SHAPE))
  assert.notEqual(at(undefined), anon)
})
