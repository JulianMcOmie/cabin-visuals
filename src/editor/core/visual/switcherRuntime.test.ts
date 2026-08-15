import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { Block, Track } from '../../types'
import type { MoverOrSplitterDefinition } from '../visualCopies/definitions'
import {
  SWITCHER_GATE,
  SWITCHER_LATCH,
  SWITCHER_SOLO,
  SWITCHER_TOGGLE,
} from '../visualCopies/switcher'
import {
  registerMoverOrSplitterDefinition,
  unregisterMoverOrSplitterDefinitionForTests,
} from '../visualCopies/registry'
import { computeAtBeat, getVisualCopies, setProject } from './VisualEngine'
import { getPriorVisualCopyCount, resolveProject, type ProjectSnapshot } from './resolve'
import { resolveVisualCopies } from '../visualCopies/resolveVisualCopies'

// The WIRING. A switcher splices its devices into the chain it sits in, so what
// has to be proven here is that the span lands in the right place, in the right
// order, that the lane can switch parts of it off, and that the mounted copy
// pool is sized for what the mode can actually reach. The mode arithmetic
// belongs to visualCopies/switcher.test.ts.

/** Translates +1 on X. LOCAL, like most movers. */
const shift: MoverOrSplitterDefinition<Record<string, never>> = {
  id: 'test.swShift',
  label: 'Shift',
  kind: 'mover',
  params: [],
  resolve() {
    return {
      apply: (c) => [{
        transform: c.transform.clone().multiply(new Matrix4().makeTranslation(1, 0, 0)),
        opacity: c.opacity,
        colorShift: { ...c.colorShift },
      }],
    }
  },
}

/** A quarter turn about Z, so composition ORDER is observable: spin-then-shift
 *  puts the object on +Y, shift-then-spin leaves it on +X. */
const spin: MoverOrSplitterDefinition<Record<string, never>> = {
  id: 'test.swSpin',
  label: 'Spin',
  kind: 'mover',
  params: [],
  resolve() {
    return {
      apply: (c) => [{
        transform: c.transform.clone().multiply(new Matrix4().makeRotationZ(Math.PI / 2)),
        opacity: c.opacity,
        colorShift: { ...c.colorShift },
      }],
    }
  },
}

function fanOut(id: string, n: number): MoverOrSplitterDefinition<Record<string, never>> {
  return {
    id,
    label: id,
    kind: 'splitter',
    params: [],
    resolve() {
      return {
        apply: (c) => Array.from({ length: n }, (_, i) => ({
          transform: c.transform.clone().multiply(new Matrix4().makeTranslation(i, 0, 0)),
          opacity: c.opacity,
          colorShift: { ...c.colorShift },
        })),
      }
    },
  }
}
const triple = fanOut('test.swTriple', 3)
const quint = fanOut('test.swQuint', 5)

for (const def of [shift, spin, triple, quint]) registerMoverOrSplitterDefinition(def)
test.after(() => {
  for (const def of [shift, spin, triple, quint]) unregisterMoverOrSplitterDefinitionForTests(def.id)
})

function track(partial: Partial<Track> & { id: string }): Track {
  return {
    name: partial.id,
    type: 'base',
    instrumentId: '',
    color: '#fff',
    muted: false,
    solo: false,
    blocks: [],
    childIds: [],
    ...partial,
  }
}

const device = (id: string, moverId: string, parentId: string, extra: Partial<Track> = {}): Track =>
  track({ id, type: 'mover', moverId, parentId, ...extra })

const splitter = (id: string, splitterId: string, parentId: string): Track =>
  track({ id, type: 'splitter', splitterId, parentId })

/** One block of held notes, each `[pitch, startBeat, durationBeats]`. */
function lane(notes: [number, number, number][]): Block[] {
  return [{
    id: 'blk',
    startBar: 0,
    durationBars: 8,
    loop: false,
    notes: notes.map(([pitch, startBeat, durationBeats], i) => ({
      id: `n${i}`, startBeat, durationBeats, pitch, velocity: 100,
    })),
  }]
}

function snapshot(tracks: Track[], rootTrackIds: string[]): ProjectSnapshot {
  return {
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    rootTrackIds,
    beatsPerBar: 4,
    bpm: 120,
  }
}

function chainOf(p: ProjectSnapshot, trackId: string) {
  const obj = resolveProject(p).objects.find((o) => o.trackId === trackId)
  assert.ok(obj, `object ${trackId} resolved`)
  return obj.moverAndSplitterChain
}

const copiesAt = (p: ProjectSnapshot, beat: number) =>
  resolveVisualCopies(chainOf(p, 'cube'), beat).map((c) => [...c.transform.elements])

/** The same two devices as plain chain siblings - the control every
 *  transparency assertion is measured against. */
const plain = () => snapshot([
  track({ id: 'cube', instrumentId: 'cube', childIds: ['a', 'b'] }),
  device('a', 'test.swSpin', 'cube'),
  device('b', 'test.swShift', 'cube'),
], ['cube'])

/** The same two devices racked in a switcher. */
const racked = (mode: number, notes: [number, number, number][]) => snapshot([
  track({ id: 'cube', instrumentId: 'cube', childIds: ['sw'] }),
  track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['a', 'b'], params: { mode }, blocks: lane(notes) }),
  device('a', 'test.swSpin', 'sw'),
  device('b', 'test.swShift', 'sw'),
], ['cube'])

test('THE ANCHOR: Gate with every row held is identical to plain chain siblings', () => {
  // This is the property the whole design rests on. It catches splice-position
  // bugs, ordering bugs and gate-wrapper bugs in one assertion - if it ever
  // fails, the switcher has stopped being transparent and everything else here
  // is measuring the wrong thing.
  const held = racked(SWITCHER_GATE, [[60, 0, 8], [61, 0, 8]])
  assert.deepEqual(copiesAt(held, 4), copiesAt(plain(), 4))
})

test('an EMPTY lane is transparent too - wrapping devices changes nothing', () => {
  assert.deepEqual(copiesAt(racked(SWITCHER_GATE, []), 4), copiesAt(plain(), 4))
  assert.deepEqual(copiesAt(racked(SWITCHER_LATCH, []), 4), copiesAt(plain(), 4))
})

test('the span composes in CHILD order, not the order the notes were played', () => {
  const later = racked(SWITCHER_GATE, [[61, 0, 8], [60, 1, 8]])
  assert.deepEqual(copiesAt(later, 4), copiesAt(plain(), 4))
  // And that order is genuinely observable: spin-then-shift lands on +Y.
  const [m] = copiesAt(plain(), 4)
  assert.ok(Math.abs(m[12]) < 1e-9, 'x is ~0')
  assert.ok(Math.abs(m[13] - 1) < 1e-9, 'y is 1 - the shift rode the spin')
})

test('a row that is not playing contributes nothing', () => {
  const onlySpin = racked(SWITCHER_GATE, [[60, 0, 8]])
  const [m] = copiesAt(onlySpin, 4)
  assert.ok(Math.abs(m[12]) < 1e-9)
  assert.ok(Math.abs(m[13]) < 1e-9, 'the shift is switched off')

  const onlyShift = racked(SWITCHER_GATE, [[61, 0, 8]])
  const [s] = copiesAt(onlyShift, 4)
  assert.ok(Math.abs(s[12] - 1) < 1e-9, 'shift alone translates on x')
})

test('Solo runs one device at a time even when both rows are held', () => {
  const p = racked(SWITCHER_SOLO, [[60, 0, 8], [61, 2, 4]])
  const [held] = copiesAt(p, 1)
  assert.ok(Math.abs(held[12]) < 1e-9, 'only the spin, so no translation')
  const [newest] = copiesAt(p, 3)
  assert.ok(Math.abs(newest[12] - 1) < 1e-9, 'the newer row took over')
})

test('a device racked under a switcher does NOT route itself as a global mover', () => {
  // isChainChild has to know about switcher parents. If it did not, these
  // devices would fall through to the global pass and apply to every object
  // via `targets` (of which they have none), so the chain would come out empty.
  assert.equal(chainOf(racked(SWITCHER_GATE, []), 'cube').length, 2)
})

test('the switcher occupies its own slot: entries after it compose on top', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw', 'after'] }),
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['a'], params: { mode: SWITCHER_GATE }, blocks: lane([[60, 0, 8]]) }),
    device('a', 'test.swSpin', 'sw'),
    device('after', 'test.swShift', 'cube'),
  ], ['cube'])
  assert.equal(chainOf(p, 'cube').length, 2)
  const [m] = copiesAt(p, 4)
  assert.ok(Math.abs(m[13] - 1) < 1e-9, 'the trailing shift rode the switched-on spin')
})

test('a muted device in the rack never runs, and keeps its row', () => {
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw'] }),
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['a', 'b'], params: { mode: SWITCHER_GATE }, blocks: lane([[60, 0, 8], [61, 0, 8]]) }),
    device('a', 'test.swSpin', 'sw', { muted: true }),
    device('b', 'test.swShift', 'sw'),
  ], ['cube'])
  // Still two slots in the chain - the span does not shrink, so pitch 61 keeps
  // meaning the shift - but the muted one is permanently off.
  assert.equal(chainOf(p, 'cube').length, 2)
  const [m] = copiesAt(p, 4)
  assert.ok(Math.abs(m[12] - 1) < 1e-9, 'shift ran')
  assert.ok(Math.abs(m[13]) < 1e-9, 'the muted spin did not')
})

test('the copy ceiling is the PRODUCT under Gate and the MAX under Solo', () => {
  const rack = (mode: number) => snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw'] }),
    // No notes at beat 0, so beat 0 - the beat the structural probe samples -
    // is the case that must not be allowed to size the pool on its own.
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['t', 'q'], params: { mode }, blocks: lane([[60, 8, 2]]) }),
    splitter('t', 'test.swTriple', 'sw'),
    splitter('q', 'test.swQuint', 'sw'),
  ], ['cube'])

  setProject(rack(SWITCHER_GATE))
  computeAtBeat(1)
  assert.equal(getVisualCopies('cube').length, 15, 'Gate can run both splitters at once')

  setProject(rack(SWITCHER_SOLO))
  computeAtBeat(1)
  assert.equal(getVisualCopies('cube').length, 5, 'Solo runs at most one, so the ceiling is the largest')
})

test('a switcher whose beat-0 subset is empty still mounts its full pool', () => {
  // The bug bypass.ts describes, one rack over: probe at beat 0 sees nothing
  // running, and without the variant publication the pool would be sized at 1
  // and overflow on every later frame.
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw'] }),
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['t'], params: { mode: SWITCHER_SOLO }, blocks: lane([[60, 8, 2]]) }),
    splitter('t', 'test.swTriple', 'sw'),
  ], ['cube'])
  setProject(p)
  computeAtBeat(1)
  const idle = getVisualCopies('cube')
  assert.equal(idle.length, 3, 'the pool stays mounted')
  assert.equal(idle.filter((c) => c.opacity > 0).length, 1, 'padded with hidden copies')
  computeAtBeat(9)
  assert.equal(getVisualCopies('cube').filter((c) => c.opacity > 0).length, 3)
})

test('a downstream lane sizes its rows against the whole span', () => {
  // getPriorVisualCopyCount walks childIds counting chain entries. A walk that
  // counted a switcher as ONE entry would hand the visibility lane the wrong
  // prefix and its MIDI rows would address copies that are not there.
  const p = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw', 'vis'] }),
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['t', 'q'], params: { mode: SWITCHER_GATE }, blocks: lane([]) }),
    splitter('t', 'test.swTriple', 'sw'),
    splitter('q', 'test.swQuint', 'sw'),
    device('vis', 'visibility', 'cube'),
  ], ['cube'])
  assert.equal(getPriorVisualCopyCount('vis', p), 15)
})

test('a tf automation lane weaves against the whole span, not against one slot', () => {
  // weaveTfAutomationLanes counts the entries ABOVE each lane and mirrors the
  // slot across the chain. A walk that advanced by one per child would land the
  // delta in the wrong place - silently, and only when a splitter below makes it
  // visible - so this is pinned as transparency again: a lane above a rack of
  // two devices must compose exactly as it does above those two as siblings.
  const rotLane = (parentId: string) => track({
    id: 'auto', type: 'automation', parentId, targetParam: 'tfRotZ',
    interpolation: 'linear',
    // Pitch 84 is the top of the automation span, so the lane is emphatically
    // not inert - an inert lane would make this test pass vacuously.
    blocks: lane([[84, 0, 8]]),
  })
  const plainWeave = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['a', 'b', 'auto', 't'] }),
    device('a', 'test.swSpin', 'cube'),
    device('b', 'test.swShift', 'cube'),
    rotLane('cube'),
    splitter('t', 'test.swTriple', 'cube'),
  ], ['cube'])
  const rackedWeave = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw', 'auto', 't'] }),
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['a', 'b'], params: { mode: SWITCHER_GATE }, blocks: lane([]) }),
    device('a', 'test.swSpin', 'sw'),
    device('b', 'test.swShift', 'sw'),
    rotLane('cube'),
    splitter('t', 'test.swTriple', 'cube'),
  ], ['cube'])

  const noLane = snapshot([
    track({ id: 'cube', instrumentId: 'cube', childIds: ['sw', 't'] }),
    track({ id: 'sw', type: 'switcher', parentId: 'cube', childIds: ['a', 'b'], params: { mode: SWITCHER_GATE }, blocks: lane([]) }),
    device('a', 'test.swSpin', 'sw'),
    device('b', 'test.swShift', 'sw'),
    splitter('t', 'test.swTriple', 'cube'),
  ], ['cube'])
  assert.notDeepEqual(copiesAt(rackedWeave, 4), copiesAt(noLane, 4), 'the lane really does something')

  assert.equal(chainOf(rackedWeave, 'cube').length, chainOf(plainWeave, 'cube').length)
  assert.deepEqual(copiesAt(rackedWeave, 4), copiesAt(plainWeave, 4))
})

test('Toggle survives the round trip through the chain', () => {
  const p = racked(SWITCHER_TOGGLE, [[61, 0, 1], [61, 4, 1]])
  const [on] = copiesAt(p, 2)
  assert.ok(Math.abs(on[12] - 1) < 1e-9, 'latched on by the first tap')
  const [off] = copiesAt(p, 6)
  assert.ok(Math.abs(off[12]) < 1e-9, 'the second tap turned it off')
})
