import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeDefinitionSettings } from './definitions'
import { MOVER_OR_SPLITTER_DEFINITIONS } from './library'
import { resolveVisualCopies } from './resolveVisualCopies'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_PARAM } from './splitterSize'
import { Matrix4 } from 'three'

/** The layout splitters wearing the SHARED knob - identity, not shape: they all
 *  reference the one exported ParamDef, so the knob cannot drift apart. */
const SHARED = MOVER_OR_SPLITTER_DEFINITIONS.filter((def) => def.params.includes(SPLITTER_SIZE_PARAM))

/** The two depth splitters whose `size` means something else on purpose:
 *  Duplicate Trail's is the size at the FAR end of the trail and Approach's is
 *  the size on ARRIVAL, both apparent-size treatments that divide the camera's
 *  shrink out. A third bespoke `size` should be a deliberate decision, which is
 *  what the stray test below forces. */
const BESPOKE_SIZE = new Set(['duplicateTrail', 'approach'])

test('every layout splitter declares the one shared size param', () => {
  assert.deepEqual(SHARED.map((def) => def.id).sort(), [
    'grid',
    'line',
    'parametricPattern',
    'polyhedron',
    'radial',
    'symmetry',
    'tunnel',
  ])
})

test('no other definition invents its own size param', () => {
  const strays = MOVER_OR_SPLITTER_DEFINITIONS.filter((def) =>
    def.params.some((param) => param.key === 'size')
    && !def.params.includes(SPLITTER_SIZE_PARAM)
    && !BESPOKE_SIZE.has(def.id),
  )
  assert.deepEqual(strays.map((def) => def.id), [])
})

test('the default is neutral and an absent key resolves identically to 1', () => {
  assert.equal(SPLITTER_SIZE_PARAM.default, 1)
  for (const def of SHARED) {
    const settings = mergeDefinitionSettings(def, undefined)
    assert.equal(settings.size, 1, `${def.id} default`)
    // A save written before the knob existed has no `size` key at all. It must
    // resolve to the exact matrices it always did - that is what makes this a
    // no-upgrade change.
    const withoutSize: Record<string, number | string> = { ...settings }
    delete withoutSize.size
    const at1 = resolveVisualCopies([def.resolve({ settings: settings as any, notes: [] })], 0)
    const absent = resolveVisualCopies([def.resolve({ settings: withoutSize as any, notes: [] })], 0)
    assert.deepEqual(
      absent.map((copy) => [...copy.transform.elements]),
      at1.map((copy) => [...copy.transform.elements]),
      `${def.id} with no stored size`,
    )
  }
})

test('size scales every layout splitter uniformly without moving a copy', () => {
  for (const def of SHARED) {
    const base = mergeDefinitionSettings(def, undefined)
    const plain = resolveVisualCopies([def.resolve({ settings: base as any, notes: [] })], 0)
    const scaled = resolveVisualCopies([
      def.resolve({ settings: { ...base, size: 2 } as any, notes: [] }),
    ], 0)
    assert.equal(scaled.length, plain.length, `${def.id} copy count`)
    scaled.forEach((copy, slot) => {
      const e = copy.transform.elements
      const before = plain[slot].transform.elements
      // Position column untouched: the layout's own knobs still own it.
      for (const index of [12, 13, 14]) {
        assert.ok(Math.abs(e[index] - before[index]) < 1e-9, `${def.id} slot ${slot} moved`)
      }
      // ...and each basis column is exactly twice as long.
      for (const column of [0, 4, 8]) {
        const scale = Math.hypot(e[column], e[column + 1], e[column + 2])
        const was = Math.hypot(before[column], before[column + 1], before[column + 2])
        assert.ok(Math.abs(scale - was * 2) < 1e-9, `${def.id} slot ${slot} column ${column}`)
      }
    })
  }
})

test('splitterSize clamps to a positive ratio; the neutral path is untouched', () => {
  assert.equal(splitterSize(undefined), 1)
  assert.equal(splitterSize(0), SPLITTER_SIZE_PARAM.min)
  assert.equal(splitterSize(-4), SPLITTER_SIZE_PARAM.min)
  assert.equal(splitterSize(2.5), 2.5)
  // Exactly the same object back at 1, so no definition pays for the knob it
  // is not using.
  const slot = new Matrix4().makeTranslation(1, 2, 3)
  assert.equal(applySplitterSize(slot, 1), slot)
  assert.deepEqual([...applySplitterSize(slot, 1).elements], [...new Matrix4().makeTranslation(1, 2, 3).elements])
})
