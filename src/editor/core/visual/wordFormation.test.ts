import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  CYCLE_CLEAR,
  CYCLE_HOLD,
  CYCLE_SCROLL,
  FILL_CENTER,
  FILL_COLUMN,
  FILL_ROW,
  FILL_SPIRAL,
  MAX_FORMATION_SLOTS,
  activeFormation,
  countOnsets,
  formationSeats,
  formationSlots,
  orderFormationSlots,
  seatWords,
  type ResolvedWordFormation,
} from './wordFormation'

const grid = (columns: number, rows: number, extra: Record<string, number> = {}) => ({
  columns, rows, depth: 1, spacing: 2, radius: 2, tilt: 0, ...extra,
})

test('a 2x2 grid is four slots centered on the origin', () => {
  const slots = formationSlots(grid(2, 2))
  assert.equal(slots.length, 4)
  assert.deepEqual(
    slots.map((s) => [s.x, s.y]),
    [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  )
  // Centered: the slots sum to the origin, so the arrangement grows around the
  // instrument's placement rather than off one corner of it.
  assert.equal(slots.reduce((a, s) => a + s.x, 0), 0)
  assert.equal(slots.reduce((a, s) => a + s.y, 0), 0)
})

test('counts clamp, and the slot list truncates at the pool budget', () => {
  assert.equal(formationSlots(grid(0, 0)).length, 1)
  assert.equal(formationSlots(grid(99, 99)).length, MAX_FORMATION_SLOTS)
  assert.equal(formationSlots({ ...grid(8, 8), depth: 8 }).length, MAX_FORMATION_SLOTS)
})

test('a column ring lays slots on a circle of the given radius', () => {
  const slots = formationSlots(grid(6, 1, { columnsRing: 1, radius: 3 }))
  assert.equal(slots.length, 6)
  for (const s of slots) assert.ok(Math.abs(Math.hypot(s.x, s.y) - 3) < 1e-9)
  // First slot at the top: a ring that starts anywhere else reads as rotated.
  assert.ok(Math.abs(slots[0].x) < 1e-9 && Math.abs(slots[0].y - 3) < 1e-9)
})

test('rings nest rather than intersect', () => {
  // Columns-ring + rows-ring is a torus. If the inner ring took the full radius
  // it would pass through the outer one and the tube would read as a tangle.
  const slots = formationSlots(grid(4, 4, { columnsRing: 1, rowsRing: 1, radius: 2 }))
  assert.equal(slots.length, 16)
  const spread = slots.map((s) => Math.hypot(s.x, s.y, s.z))
  assert.ok(Math.max(...spread) > Math.min(...spread), 'a torus is not a sphere')
  assert.ok(Math.min(...spread) > 0.1, 'no slot collapses onto the origin')
})

test('tilt rakes the arrangement about X without moving it sideways', () => {
  const flat = formationSlots(grid(3, 3))
  const raked = formationSlots(grid(3, 3, { tilt: 45 }))
  assert.deepEqual(raked.map((s) => s.x), flat.map((s) => s.x))
  assert.ok(raked.some((s) => Math.abs(s.z) > 0.5), 'a raked grid leaves the z=0 plane')
})

test('fill orders reseat the same slots, never add or drop one', () => {
  const slots = formationSlots(grid(3, 3))
  for (const fill of [FILL_ROW, FILL_COLUMN, FILL_CENTER, FILL_SPIRAL]) {
    const seats = orderFormationSlots(slots, fill)
    assert.equal(seats.length, slots.length)
    assert.equal(new Set(seats).size, slots.length, `fill ${fill} duplicated a slot`)
  }
})

test('row fill runs left to right, column fill runs top to bottom', () => {
  const rowFirst = formationSeats({ ...grid(3, 2), fill: FILL_ROW })
  assert.deepEqual(rowFirst.slice(0, 3).map((s) => s.col), [0, 1, 2])
  const colFirst = formationSeats({ ...grid(3, 2), fill: FILL_COLUMN })
  assert.deepEqual(colFirst.slice(0, 2).map((s) => s.row), [0, 1])
})

test('center-out starts in the middle of an odd grid', () => {
  const seats = formationSeats({ ...grid(3, 3), fill: FILL_CENTER })
  assert.equal(seats[0].col, 1)
  assert.equal(seats[0].row, 1)
  // and ends at a corner
  const last = seats[seats.length - 1]
  assert.ok((last.col === 0 || last.col === 2) && (last.row === 0 || last.row === 2))
})

test('clear cycles: the word after the last slot starts a fresh frame', () => {
  const seats = formationSeats(grid(2, 2))
  const shown = (k: number) => seatWords(seats, CYCLE_CLEAR, k, k).map((p) => p.wordIndex)
  assert.deepEqual(shown(1), [0])
  assert.deepEqual(shown(4), [0, 1, 2, 3])
  assert.deepEqual(shown(5), [4], 'the fifth word is alone on a cleared frame')
  assert.deepEqual(shown(8), [4, 5, 6, 7])
})

test('scroll keeps the arrangement full and pushes the oldest word out', () => {
  const seats = formationSeats(grid(2, 2))
  const at = (k: number) => seatWords(seats, CYCLE_SCROLL, k, k)
  assert.deepEqual(at(4).map((p) => p.wordIndex), [0, 1, 2, 3])
  assert.deepEqual(at(5).map((p) => p.wordIndex), [1, 2, 3, 4], 'word 0 fell out')
  assert.deepEqual(at(6).map((p) => p.wordIndex), [2, 3, 4, 5])
  // The seat a word occupies does not move under it: word 4 sits where word 0
  // stood, which is what makes the marquee read as one arrangement.
  const seatOf = (k: number, wordIndex: number) =>
    at(k).find((p) => p.wordIndex === wordIndex)?.slot
  assert.equal(seatOf(5, 4), seats[0])
  assert.equal(seatOf(6, 5), seats[1])
})

test('hold freezes on the words it caught', () => {
  const seats = formationSeats(grid(2, 2))
  const shown = (k: number) => seatWords(seats, CYCLE_HOLD, k, k).map((p) => p.wordIndex)
  assert.deepEqual(shown(3), [0, 1, 2])
  assert.deepEqual(shown(4), [0, 1, 2, 3])
  assert.deepEqual(shown(9), [0, 1, 2, 3], 'later words do not disturb a held frame')
})

test('carry over re-seats the words already on screen instead of starting empty', () => {
  const seats = formationSeats(grid(2, 2))
  // 10 words have passed; this arrangement came in 2 words ago.
  const fresh = seatWords(seats, CYCLE_CLEAR, 10, 2).map((p) => p.wordIndex)
  const carried = seatWords(seats, CYCLE_CLEAR, 10, 10).map((p) => p.wordIndex)
  assert.deepEqual(fresh, [8, 9], 'without carry the new formation starts from its own note')
  assert.deepEqual(carried, [8, 9], 'with carry the fill position keeps counting')
  // The distinction shows up at a boundary: 12 words in a 4-slot arrangement is
  // a full frame when the count carries, and the run's own third word when not.
  assert.equal(seatWords(seats, CYCLE_CLEAR, 12, 12).length, 4)
  assert.equal(seatWords(seats, CYCLE_CLEAR, 12, 3).length, 3)
})

test('age marks the newest word 0 so a trail can fade behind it', () => {
  const seats = formationSeats(grid(2, 2))
  const placed = seatWords(seats, CYCLE_CLEAR, 3, 3)
  assert.deepEqual(placed.map((p) => p.age), [2, 1, 0])
  assert.equal(placed[placed.length - 1].wordIndex, 2)
})

test('an empty arrangement or an unplayed lane seats nothing', () => {
  assert.deepEqual(seatWords([], CYCLE_CLEAR, 5, 5), [])
  assert.deepEqual(seatWords(formationSeats(grid(2, 2)), CYCLE_CLEAR, 0, 0), [])
})

const lane = (trackId: string, onsets: number[]): ResolvedWordFormation =>
  ({ trackId, settings: grid(2, 2), onsets })

test('the lane whose note started most recently owns the beat', () => {
  const lanes = [lane('a', [0, 24]), lane('b', [8]), lane('c', [16])]
  assert.equal(activeFormation(lanes, 4)?.lane.trackId, 'a')
  assert.equal(activeFormation(lanes, 8)?.lane.trackId, 'b')
  assert.equal(activeFormation(lanes, 15.9)?.lane.trackId, 'b')
  assert.equal(activeFormation(lanes, 16)?.lane.trackId, 'c')
  assert.equal(activeFormation(lanes, 30)?.lane.trackId, 'a', 'a plays again at 24')
  assert.equal(activeFormation(lanes, 4)?.startBeat, 0)
  assert.equal(activeFormation(lanes, 30)?.startBeat, 24)
})

test('before any formation note there is no arrangement', () => {
  assert.equal(activeFormation([lane('a', [8])], 4), null)
  assert.equal(activeFormation([], 4), null)
  assert.equal(activeFormation([lane('a', [])], 4), null)
})

test('a shared onset goes to the later lane', () => {
  const lanes = [lane('a', [8]), lane('b', [8])]
  assert.equal(activeFormation(lanes, 10)?.lane.trackId, 'b')
})

test('onset counting splits the stream at the formation start', () => {
  const onsets = [0, 1, 2, 3, 4, 5]
  assert.deepEqual(countOnsets(onsets, 3.5, 2), { total: 4, inRun: 2 })
  assert.deepEqual(countOnsets(onsets, 100, 0), { total: 6, inRun: 6 })
  assert.deepEqual(countOnsets(onsets, -1, 0), { total: 0, inRun: 0 })
  // The onset exactly ON the formation's start beat belongs to the run.
  assert.deepEqual(countOnsets(onsets, 2, 2), { total: 3, inRun: 1 })
})
