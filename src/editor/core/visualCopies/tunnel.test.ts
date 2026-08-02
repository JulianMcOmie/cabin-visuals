import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { identityVisualCopy } from './identityVisualCopy'
import { mergeDefinitionSettings } from './definitions'
import { getMoverOrSplitterDefinition } from './registry'
import { resolveVisualCopies } from './resolveVisualCopies'
import {
  TUNNEL_CAMERA_MUTE_PITCH,
  TUNNEL_FORWARD_PITCH,
  TUNNEL_ORIGIN_X_PITCHES,
  TUNNEL_ORIGIN_Y_PITCHES,
  TUNNEL_REVERSE_PITCH,
  TUNNEL_SYNC_DETENTS,
  evaluateTunnelTravel,
  tunnelBaseSpeed,
  tunnelSyncDetentIndex,
  tunnelSyncDetentLabel,
  isTunnelCameraMuteActive,
  tunnelCameraMuteZone,
  tunnelCounts,
  tunnelOriginLookup,
  tunnelSlotPlacement,
  tunnelSplitter,
  type TunnelSettings,
} from './tunnel'
import type { VisualCopy } from './types'

const DEFAULTS = mergeDefinitionSettings(tunnelSplitter, undefined) as unknown as TunnelSettings

function settings(overrides: Partial<TunnelSettings> = {}): TunnelSettings {
  return { ...DEFAULTS, ...overrides }
}

function note(beat: number, pitch: number, durationBeats = 1, velocity = 1): ResolvedNote {
  return { beat, blockStartBeat: 0, blockEndBeat: 1024, pitch, velocity, durationBeats }
}

function positionOf(copy: VisualCopy): [number, number, number] {
  const e = copy.transform.elements
  const r = (n: number) => Math.round(n * 1e9) / 1e9 || 0
  return [r(e[12]), r(e[13]), r(e[14])]
}

function copiesAt(config: TunnelSettings, beat: number, notes: ResolvedNote[] = []): VisualCopy[] {
  return resolveVisualCopies([tunnelSplitter.resolve({ settings: config, notes })], beat)
}

test('tunnel is registered as a splitter with a ring-per-slice default layout', () => {
  const def = getMoverOrSplitterDefinition('tunnel')
  assert.equal(def?.kind, 'splitter')
  assert.equal(def?.label, 'Tunnel')
  assert.equal(DEFAULTS.copiesPerRing, 6)
  assert.equal(DEFAULTS.rings, 8)
  assert.equal(copiesAt(settings(), 0).length, 6 * 8)
})

test('the default fade band sits entirely behind the default camera at z = 5', () => {
  // A fade-out in FRONT of the camera reads as copies dimming out in your face.
  assert.equal(DEFAULTS.nearEnd - DEFAULTS.fadeDistance >= 5, true)
})

test('copy count is structural: notes and beat never change it', () => {
  const config = settings()
  const notes = [note(0, TUNNEL_FORWARD_PITCH, 4), note(2, TUNNEL_REVERSE_PITCH, 4)]
  for (const beat of [0, 0.5, 3, 17.25, 1000]) {
    assert.equal(copiesAt(config, beat, notes).length, 48)
  }
})

test('slot counts clamp to the tunnel copy budget, shedding rings first', () => {
  assert.deepEqual(tunnelCounts(settings({ copiesPerRing: 32, rings: 64 })), { copiesPerRing: 32, rings: 8 })
  assert.deepEqual(tunnelCounts(settings({ copiesPerRing: 0.4, rings: 0 })), { copiesPerRing: 1, rings: 1 })
  assert.equal(copiesAt(settings({ copiesPerRing: 32, rings: 64 }), 0).length, 256)
})

test('ring 0 starts at the near end and later rings sit further down the axis', () => {
  const config = settings({ copiesPerRing: 1, rings: 4, radius: 0, depth: 40, nearEnd: 6, twistDegrees: 0 })
  const z = copiesAt(config, 0).map((copy) => positionOf(copy)[2])
  assert.deepEqual(z, [6, -4, -14, -24])
})

test('a ring spreads its copies evenly around the axis at the radius', () => {
  const config = settings({ copiesPerRing: 4, rings: 1, radius: 2, depth: 40, nearEnd: 0, fadeDistance: 0 })
  assert.deepEqual(copiesAt(config, 0).map(positionOf), [
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
    [0, -2, 0],
  ])
})

test('copies approach the near end at the configured speed and wrap to the far end', () => {
  const config = settings({ copiesPerRing: 1, rings: 4, radius: 0, depth: 40, nearEnd: 6, speed: 4 })
  // Half a beat at speed 4 moves every copy 2 units toward the near end (ring 0
  // starts exactly ON the near end, so it is the one already wrapped).
  assert.deepEqual(copiesAt(config, 0.5).map((copy) => positionOf(copy)[2]), [-32, -2, -12, -22])
  // Rings stay evenly spaced across the wrap: sorted by depth they are always
  // the same ladder, one slot rotated - the corridor is seamless.
  assert.deepEqual(copiesAt(config, 1).map((copy) => positionOf(copy)[2]).sort((a, b) => a - b), [-30, -20, -10, 0])
  assert.deepEqual(copiesAt(config, 1).map((copy) => positionOf(copy)[2]), [-30, 0, -10, -20])
  // A full depth of travel returns the tunnel to its starting configuration.
  assert.deepEqual(copiesAt(config, 10).map(positionOf), copiesAt(config, 0).map(positionOf))
})

test('negative speed sends the tunnel away and wraps at the far end instead', () => {
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 0, depth: 20, nearEnd: 0, speed: -4 })
  assert.deepEqual(copiesAt(config, 1).map((copy) => positionOf(copy)[2]), [-4, -14])
  assert.deepEqual(copiesAt(config, 3).map((copy) => positionOf(copy)[2]), [-12, -2])
})

test('corridor geometry is world-metric: the placement scale is divided out', () => {
  // The renderer composes placement * transform, so without this a Laser Sphere
  // at size 0.5 (scale 0.3125) shrank a 40-deep corridor to 12.5 and pulled the
  // near end in front of the camera, dimming copies in plain view.
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 2, depth: 20, nearEnd: 10, speed: 0 })
  const placementTransform = new Matrix4().makeScale(0.25, 0.25, 0.25)
  const copies = tunnelSplitter
    .resolve({ settings: config, notes: [] })
    .apply(identityVisualCopy(), { beat: 0, index: 0, count: 1, placementTransform })
  // Offsets are pre-divided, so placement * transform lands on the configured
  // scene units - ring 0 at z = 10, ring 1 ten units behind it, radius 2.
  const placed = copies.map((copy) => {
    const e = placementTransform.clone().multiply(copy.transform).elements
    return [e[12], e[13], e[14]].map((n) => Math.round(n * 1e9) / 1e9 || 0)
  })
  assert.deepEqual(placed, [[2, 0, 10], [2, 0, 0]])
  // Non-uniform placement scale (a Laser Line scales X by length, Y by
  // thickness) is normalised per axis, not by one averaged factor.
  const stretched = new Matrix4().makeScale(4, 0.5, 2)
  const stretchedCopies = tunnelSplitter
    .resolve({ settings: config, notes: [] })
    .apply(identityVisualCopy(), { beat: 0, index: 0, count: 1, placementTransform: stretched })
  const e = stretched.clone().multiply(stretchedCopies[0].transform).elements
  assert.deepEqual([e[12], e[13], e[14]].map((n) => Math.round(n * 1e9) / 1e9 || 0), [2, 0, 10])
})

test('the axis setting redirects the corridor without changing its shape', () => {
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 1, depth: 20, nearEnd: 5, speed: 0 })
  assert.deepEqual(copiesAt(settings({ ...config, axis: 1 }), 0).map(positionOf), [[5, 1, 0], [-5, 1, 0]])
  assert.deepEqual(copiesAt(settings({ ...config, axis: 2 }), 0).map(positionOf), [[0, 5, 1], [0, -5, 1]])
})

test('twist rotates each successive ring for a spiral corridor', () => {
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 1, depth: 20, nearEnd: 0, speed: 0, twistDegrees: 90 })
  assert.deepEqual(copiesAt(config, 0).map(positionOf), [[1, 0, 0], [0, 1, -10]])
})

test('opacity ramps in at the far end and out at the near end, hiding the respawn', () => {
  const config = settings({ copiesPerRing: 1, rings: 1, radius: 0, depth: 20, nearEnd: 0, speed: 0, fadeDistance: 5 })
  const opacityAtDepth = (depthIntoTunnel: number) =>
    tunnelSlotPlacement(0, settings({ ...config, nearEnd: 0 }), -depthIntoTunnel).opacity
  assert.equal(opacityAtDepth(0), 0) // at the near end: fully faded out
  assert.equal(opacityAtDepth(10), 1) // mid-corridor: fully visible
  // Energy-linear: opacity is the square root of the distance ramp, so an
  // emissive copy's emitted energy (opacity²) rises linearly with distance and
  // clears the bloom threshold early instead of igniting at the last moment.
  const energyAtDepth = (depthIntoTunnel: number) =>
    Math.round(opacityAtDepth(depthIntoTunnel) ** 2 * 1e9) / 1e9
  assert.equal(energyAtDepth(1.25), 0.25)
  assert.equal(energyAtDepth(2.5), 0.5)
  assert.equal(energyAtDepth(18.75), 0.25)
  assert.equal(tunnelSlotPlacement(0, config, 0.0001).opacity < 0.005, true) // just past wrap: still faded
  assert.equal(tunnelSlotPlacement(0, settings({ ...config, fadeDistance: 0 }), 0).opacity, 1)
})

test('fade multiplies the incoming copy opacity rather than replacing it', () => {
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 0, depth: 20, speed: 0, fadeDistance: 5 })
  const copies = tunnelSplitter
    .resolve({ settings: config, notes: [] })
    .apply({ ...copiesAt(config, 0)[0], opacity: 0.5 }, { beat: 0, index: 0, count: 1 })
  assert.equal(copies[0].opacity, 0) // ring 0 sits at the near end
  assert.equal(copies[1].opacity, 0.5) // ring 1 is mid-corridor
})

test('held speed notes add distance while held and keep it afterwards', () => {
  const config = settings({ speed: 0, midiSpeed: 8 })
  const notes = [note(1, TUNNEL_FORWARD_PITCH, 2)]
  assert.equal(evaluateTunnelTravel(notes, config, 0), 0)
  assert.equal(evaluateTunnelTravel(notes, config, 2), 8) // one beat held
  assert.equal(evaluateTunnelTravel(notes, config, 3), 16) // full duration
  assert.equal(evaluateTunnelTravel(notes, config, 50), 16) // retained, not snapped back
  // Velocity scales the rush, and the two rows cancel.
  assert.equal(evaluateTunnelTravel([note(0, TUNNEL_FORWARD_PITCH, 1, 64)], config, 4), 8 * (64 / 127))
  assert.equal(
    evaluateTunnelTravel([note(0, TUNNEL_FORWARD_PITCH, 1), note(0, TUNNEL_REVERSE_PITCH, 1)], config, 4),
    0,
  )
  // Base speed still integrates underneath the MIDI contribution.
  assert.equal(evaluateTunnelTravel(notes, settings({ speed: 2, midiSpeed: 8 }), 3), 6 + 16)
})

test('travel is continuous across a note release, so the tunnel never jumps', () => {
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 0, speed: 4, midiSpeed: 8 })
  const notes = [note(1, TUNNEL_FORWARD_PITCH, 2)]
  const epsilon = 0.0001
  for (const boundary of [1, 3]) {
    const before = evaluateTunnelTravel(notes, config, boundary - epsilon)
    const after = evaluateTunnelTravel(notes, config, boundary + epsilon)
    assert.equal(Math.abs(after - before) < 0.01, true)
  }
  // Same beat, same frame - the pause invariant.
  assert.deepEqual(copiesAt(config, 2.5, notes).map(positionOf), copiesAt(config, 2.5, notes).map(positionOf))
})

test('orientation aims copies at or away from the corridor axis', () => {
  const config = settings({ copiesPerRing: 1, rings: 1, radius: 2, depth: 20, nearEnd: 0, speed: 0, fadeDistance: 0 })
  const forward = (copy: VisualCopy) => {
    const e = copy.transform.elements
    const r = (n: number) => Math.round(n * 1e6) / 1e6 || 0
    return [r(e[8]), r(e[9]), r(e[10])] // local +Z in the copy's frame
  }
  assert.deepEqual(forward(copiesAt(settings({ ...config, orientation: 0 }), 0)[0]), [0, 0, 1])
  assert.deepEqual(forward(copiesAt(settings({ ...config, orientation: 1 }), 0)[0]), [-1, 0, 0])
  assert.deepEqual(forward(copiesAt(settings({ ...config, orientation: 2 }), 0)[0]), [1, 0, 0])
  // A zero-radius tunnel has no radial direction to aim along; stay unrotated.
  assert.deepEqual(forward(copiesAt(settings({ ...config, radius: 0, orientation: 1 }), 0)[0]), [0, 0, 1])
})

test('declares the two speed rows, five origin rows per axis, and the camera mute', () => {
  const rows = tunnelSplitter.midiRows?.(settings()) ?? []
  assert.deepEqual(rows.slice(0, 2), [
    { pitch: TUNNEL_FORWARD_PITCH, label: 'Rush forward' },
    { pitch: TUNNEL_REVERSE_PITCH, label: 'Rush backward' },
  ])
  assert.equal(rows.length, 13)
  assert.deepEqual(rows.slice(2, 7).map((row) => row.pitch), TUNNEL_ORIGIN_X_PITCHES)
  assert.deepEqual(rows.slice(7, 12).map((row) => row.pitch), TUNNEL_ORIGIN_Y_PITCHES)
  assert.deepEqual(rows[12], { pitch: TUNNEL_CAMERA_MUTE_PITCH, label: 'Mute at camera' })
  // Pitch rises with the value: the low row is the far negative side.
  assert.equal(rows[2].label, 'Origin X: far left')
  assert.equal(rows[6].label, 'Origin X: far right')
  assert.equal(rows[7].label, 'Origin Y: far down')
  assert.equal(rows[11].label, 'Origin Y: far up')
  // Every declared pitch is distinct - a shared pitch would make one row
  // silently drive two behaviours.
  assert.equal(new Set(rows.map((row) => row.pitch)).size, rows.length)
  assert.equal(tunnelSplitter.strictMidiRows, true)
})

test('with no origin notes the corridor spawns dead centre, exactly as before', () => {
  const config = settings({ copiesPerRing: 1, rings: 2, radius: 0, depth: 20, nearEnd: 0, speed: 0, originSpread: 8 })
  assert.deepEqual(copiesAt(config, 0).map(positionOf), [[0, 0, 0], [0, 0, -10]])
})

test('an origin row moves where copies come FROM, never where they arrive', () => {
  // One copy, one ring: at spawn it sits a full spread off-axis; halfway down
  // the corridor it is half as far off; at the destination it is dead on it.
  const config = settings({
    copiesPerRing: 1, rings: 1, radius: 0, depth: 20, nearEnd: 0, speed: 1, fadeDistance: 0, originSpread: 8,
  })
  const notes = [note(0, TUNNEL_ORIGIN_X_PITCHES[4], 0.1)] // 'far right' = +1 step
  const xAt = (beat: number) => positionOf(copiesAt(config, beat, notes)[0])[0]
  // Ring 0 starts ON the near end, so it wraps immediately and re-enters at the
  // far end: at beat 0+ it is at full depth with the full origin offset.
  assert.equal(Math.round(xAt(0.0001) * 100) / 100, 8)
  assert.equal(xAt(10), 4) // half way down
  assert.equal(Math.round(xAt(19.9999) * 100) / 100, 0) // arriving: back on axis
})

test('X and Y latch independently, and the last row to fire wins', () => {
  const lookup = tunnelOriginLookup(
    [
      note(0, TUNNEL_ORIGIN_X_PITCHES[0], 0.1), // far left
      note(1, TUNNEL_ORIGIN_Y_PITCHES[3], 0.1), // up (+0.5)
      note(2, TUNNEL_ORIGIN_X_PITCHES[4], 0.1), // far right, replaces far left
    ],
    { speed: 1, midiSpeed: 0, originSpread: 10 },
  )
  assert.deepEqual(lookup(-1), { x: 0, y: 0 }) // spawned before any row fired
  assert.deepEqual(lookup(0), { x: -10, y: 0 })
  assert.deepEqual(lookup(1), { x: -10, y: 5 })
  assert.deepEqual(lookup(2), { x: 10, y: 5 })
  // The centre row is a real destination, not a no-op: it recentres the axis.
  const recentred = tunnelOriginLookup(
    [note(0, TUNNEL_ORIGIN_X_PITCHES[0], 0.1), note(1, TUNNEL_ORIGIN_X_PITCHES[2], 0.1)],
    { speed: 1, midiSpeed: 0, originSpread: 10 },
  )
  assert.deepEqual(recentred(1), { x: 0, y: 0 })
})

test('copies keep the origin they spawned at, so a note bends the corridor', () => {
  // Two rings ten apart. The note fires at beat 5, by which time ring 1 (which
  // spawned at beat 0) is mid-corridor: it must hold its old centred line while
  // the copy that spawns after the note comes in from the side.
  const config = settings({
    copiesPerRing: 1, rings: 2, radius: 0, depth: 20, nearEnd: 0, speed: 1, fadeDistance: 0, originSpread: 8,
  })
  const notes = [note(5, TUNNEL_ORIGIN_X_PITCHES[4], 0.1)]
  const [nearCopy, farCopy] = copiesAt(config, 12, notes).map(positionOf)
  // Ring 0 wrapped at beat 0 (travel 0, before the note) and is 12 down the
  // corridor: still on its original centred line.
  assert.equal(nearCopy[0], 0)
  assert.equal(nearCopy[2], -8)
  // Ring 1 wrapped at travel 10 (beat 10, after the note) and is 2 down: it
  // spawned at +8 and has closed 10% of the way in.
  assert.equal(Math.round(farCopy[0] * 100) / 100, 7.2)
  assert.equal(farCopy[2], -18)
})

test('origin offsets are world-metric like the rest of the corridor', () => {
  // Without this an instrument that draws itself small would shrink the swing
  // in from the side along with the corridor it belongs to.
  const config = settings({
    copiesPerRing: 1, rings: 1, radius: 0, depth: 20, nearEnd: 0, speed: 1, fadeDistance: 0, originSpread: 8,
  })
  const notes = [note(0, TUNNEL_ORIGIN_X_PITCHES[4], 0.1)]
  const placementTransform = new Matrix4().makeScale(0.25, 0.25, 0.25)
  const copies = tunnelSplitter
    .resolve({ settings: config, notes })
    .apply(identityVisualCopy(), { beat: 10, index: 0, count: 1, placementTransform })
  const e = placementTransform.clone().multiply(copies[0].transform).elements
  // Half way down the corridor: half the spread off-axis, in scene units.
  assert.deepEqual([e[12], e[13], e[14]].map((n) => Math.round(n * 1e9) / 1e9 || 0), [4, 0, -10])
  // Straight from the placement helper too, so the taper is not scale-dependent.
  const midway = tunnelSlotPlacement(0, config, 10, tunnelOriginLookup(notes, config))
  assert.equal(midway.position.x, 4)
})

test('the origin rows follow the axis setting, moving the corridor cross-section', () => {
  // Axis X puts the ring plane on world Y/Z, so 'Origin X' is world Y there -
  // the same remapping radius already uses.
  const config = settings({
    copiesPerRing: 1, rings: 1, radius: 0, depth: 20, nearEnd: 0, speed: 1, fadeDistance: 0, originSpread: 6, axis: 1,
  })
  const notes = [note(0, TUNNEL_ORIGIN_X_PITCHES[4], 0.1)]
  const position = positionOf(copiesAt(config, 10, notes)[0])
  assert.deepEqual(position, [-10, 3, 0])
})

test('origin spread of 0 disables the rows without disabling the corridor', () => {
  const config = settings({
    copiesPerRing: 1, rings: 2, radius: 0, depth: 20, nearEnd: 0, speed: 0, originSpread: 0,
  })
  const notes = [note(0, TUNNEL_ORIGIN_X_PITCHES[0], 0.1), note(0, TUNNEL_ORIGIN_Y_PITCHES[0], 0.1)]
  assert.deepEqual(copiesAt(config, 0, notes).map(positionOf), [[0, 0, 0], [0, 0, -10]])
})

test('origin rows never change the copy count or the speed rows behaviour', () => {
  const config = settings()
  const notes = [
    note(0, TUNNEL_ORIGIN_X_PITCHES[0], 0.1),
    note(1, TUNNEL_ORIGIN_Y_PITCHES[4], 0.1),
    note(1, TUNNEL_FORWARD_PITCH, 2),
  ]
  assert.equal(copiesAt(config, 3, notes).length, 48)
  // Travel only listens to the speed rows; origin notes contribute nothing.
  assert.equal(
    evaluateTunnelTravel(notes, config, 3),
    evaluateTunnelTravel([note(1, TUNNEL_FORWARD_PITCH, 2)], config, 3),
  )
})

test('the camera mute zone runs from the near end back past the camera plane', () => {
  // Defaults: near end 12, camera at z = 5 -> 7 corridor units plus the 2-unit
  // margin hide the whole approach while the row is held.
  assert.equal(tunnelCameraMuteZone(settings()), 9)
  // A near end pulled in front of the lens clamps to just the margin.
  assert.equal(tunnelCameraMuteZone(settings({ nearEnd: 3 })), 2)
})

test('the camera mute gate follows its notes, ignoring velocity', () => {
  const notes = [note(4, TUNNEL_CAMERA_MUTE_PITCH, 2, 64)]
  assert.equal(isTunnelCameraMuteActive(notes, 3.9999), false)
  assert.equal(isTunnelCameraMuteActive(notes, 4), true)
  assert.equal(isTunnelCameraMuteActive(notes, 5.9999), true)
  assert.equal(isTunnelCameraMuteActive(notes, 6), false)
  assert.equal(isTunnelCameraMuteActive([], 4), false)
})

test('a held Mute at camera note mutes the copies that would hit the camera', () => {
  // Ring depths back from the near end: [0, 10, 20, 30]; zone = (6 - 5) + 2 = 3.
  const config = settings({ copiesPerRing: 1, rings: 4, radius: 0, depth: 40, nearEnd: 6, speed: 0, fadeDistance: 0 })
  const notes = [note(1, TUNNEL_CAMERA_MUTE_PITCH, 2)]
  // Before the note: every ring renders.
  assert.deepEqual(copiesAt(config, 0, notes).map((copy) => copy.opacity), [1, 1, 1, 1])
  // While held: only ring 0 (inside the zone) is muted; the rest are untouched.
  assert.deepEqual(copiesAt(config, 2, notes).map((copy) => copy.opacity), [0, 1, 1, 1])
  // After release the corridor is exactly as if nothing happened.
  assert.deepEqual(copiesAt(config, 3, notes).map((copy) => copy.opacity), [1, 1, 1, 1])
  // A wider margin mutes deeper rings.
  assert.deepEqual(
    copiesAt(settings({ ...config, cameraMuteMargin: 12 }), 2, notes).map((copy) => copy.opacity),
    [0, 0, 1, 1],
  )
})

test('the camera mute is a pure opacity gate: copies keep flowing underneath', () => {
  const config = settings({ copiesPerRing: 1, rings: 4, radius: 0, depth: 40, nearEnd: 6, speed: 4, fadeDistance: 0 })
  const notes = [note(0, TUNNEL_CAMERA_MUTE_PITCH, 16)]
  // Same beat, same positions - muted or not.
  assert.deepEqual(copiesAt(config, 3.5, notes).map(positionOf), copiesAt(config, 3.5).map(positionOf))
  // ...and the structural count never changes.
  assert.equal(copiesAt(settings(), 2, notes).length, 48)
})

test('faces the ring center by default, so the corridor reads as a wall', () => {
  assert.equal(DEFAULTS.orientation, 1)
})

test('Beat-synced mode converts rings-per-beat through the current ring spacing', () => {
  // 40 deep / 8 rings = 5 units of spacing; one ring per beat = 5 units/beat.
  const config = settings({ speedMode: 1, syncRingsPerBeat: 1, depth: 40, rings: 8, speed: 33, midiSpeed: 0 })
  assert.equal(tunnelBaseSpeed(config), 5)
  assert.equal(evaluateTunnelTravel([], config, 3), 15)
  // Reproportioning the corridor keeps the CADENCE, not the units/beat.
  assert.equal(tunnelBaseSpeed({ ...config, depth: 80 }), 10)
  assert.equal(tunnelBaseSpeed({ ...config, syncRingsPerBeat: -0.5 }), -2.5)
  // Free mode still reads the speed knob verbatim, and is the stored default.
  assert.equal(DEFAULTS.speedMode, 0)
  assert.equal(tunnelBaseSpeed(settings({ speed: 7 })), 7)
})

test('at one ring per beat the formation maps onto itself every beat', () => {
  const config = settings({ speedMode: 1, syncRingsPerBeat: 1, twistDegrees: 0, midiSpeed: 0 })
  const snapshot = (beat: number) =>
    copiesAt(config, beat).map((copy) => JSON.stringify(positionOf(copy))).sort()
  assert.deepEqual(snapshot(1), snapshot(0))
  assert.notDeepEqual(snapshot(0.5), snapshot(0))
})

test('sync detents are musical divisions with zero dead centre', () => {
  const detents = [...TUNNEL_SYNC_DETENTS]
  assert.equal(detents[Math.floor(detents.length / 2)], 0)
  assert.deepEqual(detents, [...detents].sort((a, b) => a - b))
  assert.equal(tunnelSyncDetentLabel(1), '1b')
  assert.equal(tunnelSyncDetentLabel(4), '1/4b')
  assert.equal(tunnelSyncDetentLabel(-0.125), '−8b')
  assert.equal(tunnelSyncDetentLabel(0), '0')
  // An off-grid (automated) value reads back as its nearest detent.
  assert.equal(TUNNEL_SYNC_DETENTS[tunnelSyncDetentIndex(0.6)], 0.5)
})
