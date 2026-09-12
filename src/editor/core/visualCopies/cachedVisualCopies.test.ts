import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import { createVisualCopyEvaluator, resolveVisualCopies, type CopyClocks } from './resolveVisualCopies'
import { splitterWithChildChain } from './splitterChildChain'
import { gridSplitter } from './library'
import { mergeDefinitionSettings } from './definitions'
import type { MoverOrSplitter, VisualCopy } from './types'

function positions(copies: VisualCopy[]) { return copies.map(copy => copy.transform.elements.slice(12, 15)) }
function staticGrid(copies = 4) {
  return gridSplitter.resolve({ settings: { ...mergeDefinitionSettings(gridSplitter, undefined), columns: copies, rows: 1, spacing: 2 } as never, notes: [] })
}

test('complete static chains reuse outputs across beats, invalidate in-place placement and chain edits', () => {
  const evaluate = createVisualCopyEvaluator()
  let calls = 0
  const layout = staticGrid()
  const entry: MoverOrSplitter = { ...layout, apply(copy, context) { calls++; return layout.apply(copy, context) } }
  const chain = [entry]
  const world = new Matrix4()
  const first = evaluate(chain, 0, world)
  assert.equal(evaluate(chain, 17, world), first)
  assert.equal(calls, 1)
  world.makeTranslation(3, 2, 1)
  assert.notEqual(evaluate(chain, 17, world), first)
  assert.equal(calls, 2)
  chain[0] = staticGrid(2)
  assert.equal(evaluate(chain, 17, world).length, 2)
  chain[0].apply = copy => [copy]
  assert.equal(evaluate(chain, 17, world).length, 1)
})

test('static prefixes feed changing copy-specific suffixes without redoing expansion', () => {
  const evaluate = createVisualCopyEvaluator()
  let layoutCalls = 0
  const grid = staticGrid(4)
  const prefix: MoverOrSplitter = { ...grid, apply(copy, context) { layoutCalls++; return grid.apply(copy, context) } }
  const animated: MoverOrSplitter = {
    cachePolicy: 'beat',
    apply(copy, context) {
      assert.equal(context.formation!.length, 4)
      return [{ ...copy, transform: copy.transform.clone().multiply(new Matrix4().makeTranslation(context.index * context.beat, context.count, 0)) }]
    },
  }
  const chain = [prefix, animated]
  const initial = evaluate(chain, 0)
  const later = evaluate(chain, 2)
  assert.equal(layoutCalls, 1)
  assert.notDeepEqual(positions(initial), positions(later))
  assert.equal(evaluate(chain, 2), later)
  assert.deepEqual(later, resolveVisualCopies([grid, animated], 2))
  assert.deepEqual(evaluate(chain, 0), initial)
})

test('unknown entries remain fresh and framed prefixes are never folded before later steps', () => {
  const evaluate = createVisualCopyEvaluator()
  let calls = 0
  const unknown: MoverOrSplitter = { apply(copy) { calls++; return [copy] } }
  evaluate([unknown], 0); evaluate([unknown], 0)
  assert.equal(calls, 2)
  const rotate: MoverOrSplitter = { cachePolicy: 'static', apply(copy) {
    return [{ ...copy, transform: copy.transform.clone().multiply(new Matrix4().makeRotationZ(Math.PI / 2)) }]
  } }
  const nested = splitterWithChildChain(staticGrid(2), [rotate])
  const chain = [nested, staticGrid(2)]
  const actual = evaluate(chain, 0)
  assert.deepEqual(actual, resolveVisualCopies(chain, 0))
  assert.equal(evaluate(chain, 4), actual)
})

test('same-beat cached emitter results restore every clock channel and invalidate clock routing', () => {
  const evaluate = createVisualCopyEvaluator()
  const emitter: MoverOrSplitter = {
    cachePolicy: 'beat', emitsCopyClocks: true,
    apply: copy => [copy],
    applyFramed: copy => [{ visualCopy: copy, beatOffset: 2, birthBeat: 5 }],
  }
  const timed: MoverOrSplitter = { cachePolicy: 'beat', apply(copy, context) {
    return [{ ...copy, transform: copy.transform.clone().makeTranslation(context.beat, context.birthBeat ?? 0, 0) }]
  } }
  const chain = [emitter, timed]
  const clocks: CopyClocks = { beatOffsets: null, birthBeats: null, checkpoints: null }
  const first = evaluate(chain, 7, undefined, clocks)
  const secondClocks: CopyClocks = { beatOffsets: null, birthBeats: null, checkpoints: null }
  assert.equal(evaluate(chain, 7, undefined, secondClocks), first)
  assert.deepEqual(secondClocks, { beatOffsets: [2], birthBeats: [5], checkpoints: [[2]] })
  assert.deepEqual(positions(first), [[5, 5, 0]])
  timed.clockSkipEmitters = 1
  assert.deepEqual(positions(evaluate(chain, 7)), [[7, 5, 0]])
  assert.deepEqual(evaluate(chain, 8), resolveVisualCopies(chain, 8))
})
