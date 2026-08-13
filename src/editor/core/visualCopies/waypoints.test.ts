import test from 'node:test'
import assert from 'node:assert/strict'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { mergeDefinitionSettings } from './definitions'
import {
  WAYPOINT_BASE_PITCH,
  WAYPOINT_CURVE_BASE_PITCH,
  WAYPOINT_CURVE_FLOW,
  WAYPOINT_CURVE_POP,
  WAYPOINT_CURVE_GLIDE,
  WAYPOINT_CURVE_SNAP,
  WAYPOINT_CURVE_SPRING,
  WAYPOINT_LAYOUT_GRID,
  WAYPOINT_LAYOUT_LINE,
  WAYPOINT_LAYOUT_RING,
  buildWaypointSegments,
  evaluateWaypointOffset,
  waypointPositions,
  waypointsMidiRows,
  waypointsMover,
  type WaypointsSettings,
} from './waypoints'

const note = (beat: number, pitch: number, durationBeats = 0.25): ResolvedNote => ({
  beat,
  blockStartBeat: 0,
  blockEndBeat: 1024,
  pitch,
  velocity: 1,
  durationBeats,
})

function settings(overrides: Record<string, number> = {}): WaypointsSettings {
  return {
    ...(mergeDefinitionSettings(waypointsMover, undefined) as unknown as WaypointsSettings),
    ...overrides,
  }
}

const offsetAt = (notes: ResolvedNote[], s: WaypointsSettings, beat: number): [number, number] =>
  evaluateWaypointOffset(buildWaypointSegments(notes, s), s, beat)

test('layouts: centered fields with the requested count', () => {
  const ring = waypointPositions(settings({ layout: WAYPOINT_LAYOUT_RING, positions: 4, spread: 2 }))
  assert.equal(ring.length, 4)
  assert.ok(Math.abs(ring[0][0]) < 1e-9 && Math.abs(ring[0][1] - 2) < 1e-9) // position 1 at the ring's top
  assert.ok(Math.abs(ring[1][0] - 2) < 1e-9 && Math.abs(ring[1][1]) < 1e-9) // position 2 at the right

  // Line and grid are centered on the origin - the field surrounds the object.
  const line = waypointPositions(settings({ layout: WAYPOINT_LAYOUT_LINE, positions: 4, spread: 2 }))
  assert.deepEqual(line.map(([x]) => x), [-3, -1, 1, 3])
  const grid = waypointPositions(settings({ layout: WAYPOINT_LAYOUT_GRID, positions: 4, spread: 2 }))
  assert.deepEqual(grid, [[-1, 1], [1, 1], [-1, -1], [1, -1]])

  // Customs read the per-position params verbatim.
  const custom = waypointPositions(settings({ layout: 3, positions: 2, pos1X: 1, pos1Y: 1, pos2X: 4, pos2Y: -2 }))
  assert.deepEqual(custom, [[1, 1], [4, -2]])
})

test('rests on position 1 with an empty lane, at any beat', () => {
  const s = settings({ layout: WAYPOINT_LAYOUT_RING, positions: 4, spread: 2 })
  assert.deepEqual(offsetAt([], s, 0), offsetAt([], s, 17.3))
  assert.ok(Math.abs(offsetAt([], s, 0)[1] - 2) < 1e-9) // the ring's top
})

test('snap, flow and pop arrive exactly, through their bezier profiles', () => {
  // Line, 2 positions, spread 4: P1 x=-2, P2 x=+2 - a 4-unit move.
  const base = { layout: WAYPOINT_LAYOUT_LINE, positions: 2, spread: 4, travelBeats: 1 }
  const move = [note(0, WAYPOINT_BASE_PITCH + 1)]

  const snap = settings({ ...base, curve: WAYPOINT_CURVE_SNAP })
  // expo-out (0.16, 1, 0.3, 1): ~78% of the distance inside the first fifth.
  const fifth = (offsetAt(move, snap, 0.2)[0] + 2) / 4
  assert.ok(fifth > 0.7, `snap should front-load, covered ${fifth}`)
  assert.deepEqual(offsetAt(move, snap, 1), [2, 0])
  assert.deepEqual(offsetAt(move, snap, 9), [2, 0]) // holds

  const flow = settings({ ...base, curve: WAYPOINT_CURVE_FLOW })
  // The sheet curve gathers before it travels: slower off the line than Snap,
  // never overshooting, arriving exactly.
  const flowEarly = (offsetAt(move, flow, 0.1)[0] + 2) / 4
  const snapEarly = (offsetAt(move, snap, 0.1)[0] + 2) / 4
  assert.ok(flowEarly < snapEarly, `flow (${flowEarly}) should open softer than snap (${snapEarly})`)
  for (let b = 0; b <= 1; b += 0.005) assert.ok(offsetAt(move, flow, b)[0] <= 2 + 1e-6)
  assert.deepEqual(offsetAt(move, flow, 1), [2, 0])

  const pop = settings({ ...base, curve: WAYPOINT_CURVE_POP })
  // back-out (0.34, 1.56, 0.64, 1): pops past the target, no anticipation dip.
  let minX = Infinity
  let maxX = -Infinity
  for (let b = 0; b <= 1; b += 0.005) {
    const x = offsetAt(move, pop, b)[0]
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
  }
  assert.ok(maxX > 2.02, `should pop past the target, saw ${maxX}`)
  assert.ok(minX >= -2 - 1e-6, `back-out has no pull-back, saw ${minX}`)
  assert.deepEqual(offsetAt(move, pop, 1), [2, 0])
})

test('spring overshoots the target and settles (the aftershoot)', () => {
  const s = settings({ layout: WAYPOINT_LAYOUT_LINE, positions: 2, spread: 4, travelBeats: 1, curve: WAYPOINT_CURVE_SPRING, bounce: 0.6 })
  const move = [note(0, WAYPOINT_BASE_PITCH + 1)] // to x=2
  let maxX = -Infinity
  for (let b = 0; b <= 4; b += 0.01) maxX = Math.max(maxX, offsetAt(move, s, b)[0])
  assert.ok(maxX > 2.05, `expected overshoot past 2, saw ${maxX}`)
  const settled = offsetAt(move, s, 24)[0]
  assert.ok(Math.abs(settled - 2) < 1e-3, `expected settle at 2, saw ${settled}`)
})

test('glide carries velocity through a retarget (C1 continuity), never overshoots', () => {
  const s = settings({ layout: WAYPOINT_LAYOUT_LINE, positions: 2, spread: 4, travelBeats: 1, curve: WAYPOINT_CURVE_GLIDE })
  // Retarget mid-flight: to P2 (x=2) at 0, back to P1 (x=-2) at 0.3.
  const moves = [note(0, WAYPOINT_BASE_PITCH + 1), note(0.3, WAYPOINT_BASE_PITCH)]
  const h = 1e-4
  const before = (offsetAt(moves, s, 0.3)[0] - offsetAt(moves, s, 0.3 - h)[0]) / h
  const after = (offsetAt(moves, s, 0.3 + h)[0] - offsetAt(moves, s, 0.3)[0]) / h
  assert.ok(Math.abs(before - after) < 0.05 * Math.max(1, Math.abs(before)), `velocity jumped: ${before} -> ${after}`)

  // Single glide move never crosses past its target.
  const single = [note(0, WAYPOINT_BASE_PITCH + 1)]
  for (let b = 0; b <= 6; b += 0.01) {
    assert.ok(offsetAt(single, s, b)[0] <= 2 + 1e-9)
  }
})

test('curve rows latch for subsequent moves', () => {
  const s = settings({ layout: WAYPOINT_LAYOUT_LINE, positions: 2, spread: 4, travelBeats: 1, curve: WAYPOINT_CURVE_FLOW })
  // Latch Spring just before the move; the same phrase without the latch flows.
  const latched = [note(0, WAYPOINT_CURVE_BASE_PITCH + WAYPOINT_CURVE_SPRING), note(0.5, WAYPOINT_BASE_PITCH + 1)]
  let maxX = -Infinity
  for (let b = 0.5; b <= 4.5; b += 0.01) maxX = Math.max(maxX, offsetAt(latched, s, b)[0])
  assert.ok(maxX > 2.01, 'latched spring should overshoot')

  const unlatched = [note(0.5, WAYPOINT_BASE_PITCH + 1)]
  for (let b = 0.5; b <= 4.5; b += 0.01) {
    assert.ok(offsetAt(unlatched, s, b)[0] <= 2 + 1e-9, 'default flow must not overshoot')
  }
})

test('midi rows narrow to the position count, plus the five curve rows', () => {
  const rows = waypointsMidiRows(settings({ positions: 3 }))
  assert.deepEqual(rows.map((r) => r.pitch), [60, 61, 62, 54, 55, 56, 57, 58])
  assert.equal(rows[0].label, 'Position 1')
  assert.equal(rows[3].label, 'Curve · Snap')
})

test('applies as a LOCAL translation on the chain frame', () => {
  const s = settings({ layout: WAYPOINT_LAYOUT_LINE, positions: 2, spread: 4, travelBeats: 0.5, curve: WAYPOINT_CURVE_SNAP })
  const chain = waypointsMover.resolve({ settings: s, notes: [note(0, WAYPOINT_BASE_PITCH + 1)] })
  const seed = identityVisualCopy()
  seed.transform.makeRotationZ(Math.PI / 2) // chain frame: +x becomes +y
  const [copy] = chain.apply(seed, { beat: 5, index: 0, count: 1 })
  const e = copy.transform.elements
  // Translation lives in elements 12/13; a local +2 x under a 90° frame lands on +y.
  assert.ok(Math.abs(e[12]) < 1e-9 && Math.abs(e[13] - 2) < 1e-9, `got (${e[12]}, ${e[13]})`)
})
