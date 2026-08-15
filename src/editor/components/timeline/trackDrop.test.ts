import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '../../types'
import { flattenVisualRows } from './trackTree'
import { computeDropTarget, INDENT_PX, LABEL_BASE_PX, rowIndentPx } from './trackDrop'

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id, name: id, type: 'base', instrumentId: 'cube', color: '#fff',
  muted: false, solo: false, blocks: [], childIds: [], ...extra,
})

const ROW = 40
/** Pointer X that reads as nesting depth `d` (the label indent for that depth). */
const xAt = (d: number) => LABEL_BASE_PX + d * INDENT_PX

/** A → B → C grandchild chain, then root sibling D. Rows: A(0) B(1) C(2) D(0). */
function grandchildForest() {
  const tracks: Record<string, Track> = {
    A: track('A', { childIds: ['B'] }),
    B: track('B', { type: 'mover', moverId: 'orbit', inputValues: {}, parentId: 'A', childIds: ['C'] }),
    C: track('C', { parentId: 'B' }),
    D: track('D'),
  }
  const rootTrackIds = ['A', 'D']
  const rows = flattenVisualRows(tracks, rootTrackIds, undefined)
  return { tracks, rootTrackIds, rows }
}

const drop = (
  forest: ReturnType<typeof grandchildForest>,
  clientX: number,
  clientY: number,
  excludeSubtree?: Set<string>,
) =>
  computeDropTarget({
    ...forest, listTop: 0, listLeft: 0, rowHeight: ROW, clientX, clientY, excludeSubtree,
  })

test('the boundary after a grandchild reaches every depth via pointer X', () => {
  const f = grandchildForest()
  // y=115: bottom quarter of C (row 2) - the boundary between C and D (top=120).
  const y = 115

  // X at C's indent → sibling of the grandchild, after C.
  assert.deepEqual(drop(f, xAt(2), y), {
    parentId: 'B', index: 1, line: { top: 120, left: rowIndentPx(2) }, intoId: null,
  })
  // One step left → uncle level: after B inside A.
  assert.deepEqual(drop(f, xAt(1), y), {
    parentId: 'A', index: 1, line: { top: 120, left: rowIndentPx(1) }, intoId: null,
  })
  // Far left → root level: after A, before D.
  assert.deepEqual(drop(f, 0, y), {
    parentId: null, index: 1, line: { top: 120, left: 0 }, intoId: null,
  })
  // One step deeper than C → C's first child (great-grandchild).
  assert.deepEqual(drop(f, xAt(3), y), {
    parentId: 'C', index: 0, line: { top: 120, left: rowIndentPx(3) }, intoId: null,
  })
  // X clamps to the valid range on both sides.
  assert.equal(drop(f, xAt(9), y)?.parentId, 'C')
  // The same boundary via D's top quarter behaves identically.
  assert.deepEqual(drop(f, xAt(1), 122), drop(f, xAt(1), y))
})

test('the indicator wears the row-divider geometry, not the raw indent step', () => {
  // A divider below a row starts at the NEXT row's bracket, one indent step past
  // the label's base padding. A drop line drawn at `depth * INDENT_PX` instead
  // lands 4px off every real line it is supposed to preview.
  assert.equal(rowIndentPx(0), 0)
  assert.equal(rowIndentPx(1), LABEL_BASE_PX)
  assert.equal(rowIndentPx(2), LABEL_BASE_PX + INDENT_PX)
})

test('below the last row un-nests to any level, not just root', () => {
  const f = grandchildForest()
  const y = 999
  // Far left → append at root (the old fixed behavior).
  assert.deepEqual(drop(f, 0, y), {
    parentId: null, index: 2, line: { top: 4 * ROW, left: 0 }, intoId: null,
  })
  // Indented one step → first child of the last row (D).
  assert.deepEqual(drop(f, xAt(1), y), {
    parentId: 'D', index: 0, line: { top: 4 * ROW, left: rowIndentPx(1) }, intoId: null,
  })
})

test('a first-child drop draws the same straight line as any other', () => {
  const f = grandchildForest()
  // Boundary between A and its shown child B: the divider there is B's bracket
  // CORNER, but the indicator stays a plain rule at the landing depth - a bending
  // one read as a hook hanging off the row above. deepEqual also pins the absence
  // of any bend flag on the line.
  assert.deepEqual(drop(f, xAt(1), 45), {
    parentId: 'A', index: 0, line: { top: ROW, left: rowIndentPx(1) }, intoId: null,
  })
  // Collapsing A hides B, so the same X now means "A's first child" with nothing
  // between them - same landing, same line.
  const collapsed = { ...f, rows: flattenVisualRows(f.tracks, f.rootTrackIds, new Set(['A'])) }
  assert.deepEqual(drop(collapsed, xAt(1), 45), {
    parentId: 'A', index: 0, line: { top: ROW, left: rowIndentPx(1) }, intoId: null,
  })
})

test('a middle-band hover still nests into the row (append)', () => {
  const f = grandchildForest()
  // y=60: middle of B's row - X plays no part here.
  assert.deepEqual(drop(f, 500, 60), { parentId: 'B', index: undefined, line: null, intoId: 'B' })
})

test('dragged subtree is excluded: depths inside it fall back shallower', () => {
  const f = grandchildForest()
  const dragging = new Set(['B', 'C'])
  // Hovering a dragged row itself is a dead zone.
  assert.equal(drop(f, xAt(2), 90, dragging), null)
  // At the C/D boundary, depth 2-3 would land inside the dragged subtree; a deep X
  // falls back to B's own current slot inside A.
  assert.deepEqual(drop(f, xAt(3), 122, dragging), {
    parentId: 'A', index: 0, line: { top: 120, left: rowIndentPx(1) }, intoId: null,
  })
  // Root level stays reachable, with B's subtree not counted among the siblings.
  assert.deepEqual(drop(f, 0, 122, dragging), {
    parentId: null, index: 1, line: { top: 120, left: 0 }, intoId: null,
  })
})

test('nothing drops above, between, or under the pinned audio tracks', () => {
  const f = grandchildForest()
  f.tracks.AU = track('AU', { type: 'audio', instrumentId: '', audioBlocks: [] } as Partial<Track>)
  f.rootTrackIds = ['AU', 'A', 'D']
  f.rows = flattenVisualRows(f.tracks, f.rootTrackIds, undefined)

  // Top edge of the audio row → lands right below the pinned block.
  assert.deepEqual(drop(f, 0, 2), {
    parentId: null, index: 1, line: { top: ROW, left: 0 }, intoId: null,
  })
  // A deep X below the audio row can't nest into it: falls back to a root drop.
  assert.deepEqual(drop(f, xAt(1), 38), {
    parentId: null, index: 1, line: { top: ROW, left: 0 }, intoId: null,
  })
})

test('automation lanes are not nest targets at any depth', () => {
  const f = grandchildForest()
  f.tracks.E = track('E', { type: 'automation', targetParam: 'tfScale', parentId: 'C' } as Partial<Track>)
  f.tracks.C = { ...f.tracks.C, childIds: ['E'] }
  f.rows = flattenVisualRows(f.tracks, f.rootTrackIds, undefined)

  // Rows: A B C E(3) D. Middle of E's row is an edge drop, never a nest.
  assert.equal(drop(f, xAt(3), 3 * ROW + 20)?.intoId, null)
  // Below E, a deeper-still X falls back to E's sibling level (child of C).
  assert.deepEqual(drop(f, xAt(4), 4 * ROW - 2)?.parentId, 'C')
})
