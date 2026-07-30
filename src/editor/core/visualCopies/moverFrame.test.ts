import assert from 'node:assert/strict'
import test from 'node:test'
import { Matrix4, Vector3 } from 'three'
import type { ResolvedNote } from '../visual/types'
import { mergeDefinitionSettings } from './definitions'
import { identityVisualCopy } from './identityVisualCopy'
import { impactScatterMover, SCATTER_IMPACT_PITCH, type ImpactScatterSettings } from './impactScatter'
import { MOTION_BLOCKS, motionMover } from './motion'
import { framedMoverOrSplitter } from './moverFrame'
import { resolveVisualCopies } from './resolveVisualCopies'
import type { MoverOrSplitter, VisualCopy } from './types'

/** A frame that slides the parent's field a fixed distance along +X. */
function shift(distance: number): MoverOrSplitter {
  return {
    apply(visualCopy) {
      return [{
        transform: visualCopy.transform.clone().multiply(new Matrix4().makeTranslation(distance, 0, 0)),
        opacity: visualCopy.opacity,
        colorShift: { ...visualCopy.colorShift },
      }]
    },
  }
}

function copyAt(x: number, y: number, z: number): VisualCopy {
  const copy = identityVisualCopy()
  copy.transform.makeTranslation(x, y, z)
  return copy
}

function note(beat: number, pitch: number, durationBeats = 0.25): ResolvedNote {
  return { beat, pitch, durationBeats, velocity: 1, blockStartBeat: 0, blockEndBeat: 1024 }
}

function scatter(overrides: Partial<ImpactScatterSettings> = {}, hitBeat = 0): MoverOrSplitter {
  return impactScatterMover.resolve({
    settings: { ...mergeDefinitionSettings(impactScatterMover, undefined), ...overrides } as ImpactScatterSettings,
    notes: [note(hitBeat, SCATTER_IMPACT_PITCH)],
  })
}

/** Where a copy placed at `home` ends up, as a world position. */
function endsUp(mover: MoverOrSplitter, home: [number, number, number], beat: number): Vector3 {
  const [out] = mover.apply(copyAt(...home), { beat, index: 0, count: 1 })
  return new Vector3().setFromMatrixPosition(out.transform)
}

/** The furthest the copy gets from home over a window, and in which direction. */
function peak(mover: MoverOrSplitter, home: [number, number, number]): { distance: number; x: number } {
  let best = { distance: 0, x: 0 }
  for (let beat = 0; beat <= 8; beat += 1 / 32) {
    const offset = endsUp(mover, home, beat).sub(new Vector3(...home))
    if (offset.length() > best.distance) best = { distance: offset.length(), x: offset.x }
  }
  return best
}

test('an empty frame returns the mover untouched', () => {
  const inner = scatter()
  assert.equal(framedMoverOrSplitter(inner, []), inner)
})

test('a frame moves the blast center, so the throw reverses direction', () => {
  const home: [number, number, number] = [3, 0, 0]
  // Center at the origin: the copy at +3 is thrown outward, away from it.
  const unframed = peak(scatter(), home)
  assert.ok(unframed.x > 0, `thrown +X away from the origin (x=${unframed.x.toFixed(2)})`)

  // The same mover with its field slid to +9: the copy at +3 is now INSIDE the
  // blast, so outward is -X. Nothing about the mover's own settings changed.
  const framed = peak(framedMoverOrSplitter(scatter(), [shift(9)]), home)
  assert.ok(framed.x < 0, `thrown -X away from the moved center (x=${framed.x.toFixed(2)})`)
})

test('a frame moves the falloff with the geometry, not just the direction', () => {
  // Far outside `reach` the hit barely registers; sliding the field onto the copy
  // has to make it land hard, which only happens if gain reads the moved center.
  const home: [number, number, number] = [40, 0, 0]
  const faint = peak(scatter(), home).distance
  const direct = peak(framedMoverOrSplitter(scatter(), [shift(40)]), home).distance
  assert.ok(direct > faint * 4, `moved center hits far harder (${direct.toFixed(2)} vs ${faint.toFixed(2)})`)
})

test('a frame leaves the field at rest when the mover is at rest', () => {
  // Before the hit there is nothing to move: the frame must not displace the
  // copy itself. Only the parent's FIELD moves, never the object.
  const framed = framedMoverOrSplitter(scatter({}, 4), [shift(9)])
  const at = endsUp(framed, [3, 0, 0], 0)
  assert.ok(at.distanceTo(new Vector3(3, 0, 0)) < 1e-9, `copy still at home (${at.toArray()})`)
})

test('frames nest: a frame can itself be framed', () => {
  const home: [number, number, number] = [12, 0, 0]
  const once = peak(framedMoverOrSplitter(scatter(), [shift(6)]), home)
  const twice = peak(framedMoverOrSplitter(framedMoverOrSplitter(scatter(), [shift(6)]), [shift(6)]), home)
  // 6 puts the center below the copy (thrown +X); 6+6 puts it exactly on it.
  assert.ok(once.x > 0, `center at +6 throws +X (x=${once.x.toFixed(2)})`)
  assert.ok(twice.distance > once.distance, `center at +12 hits harder (${twice.distance.toFixed(2)})`)
})

test('a real Motion mover works as a frame: the center drifts with it', () => {
  // Drift +X, unwrapped, so the frame is a growing translation.
  const drift = motionMover.resolve({
    settings: mergeDefinitionSettings(motionMover, { boundX: 0, boundY: 0, boundZ: 0 }) as never,
    notes: [note(0, MOTION_BLOCKS.drift, 16)],
  })
  const home: [number, number, number] = [8, 0, 0]
  // Hit at beat 4, by which point the drifting center has reached +8 - i.e. the
  // copy. An unmoved center at the origin is 8 away and hits far softer.
  const framed = peak(framedMoverOrSplitter(scatter({}, 4), [drift]), home).distance
  const plain = peak(scatter({}, 4), home).distance
  assert.ok(framed > plain, `drifted center hits harder (${framed.toFixed(2)} vs ${plain.toFixed(2)})`)
})

test('the frame does not become an extra chain entry', () => {
  // One mover in, one copy out - a frame changes how its parent behaves, never
  // how many copies the chain produces.
  const framed = framedMoverOrSplitter(scatter(), [shift(9)])
  assert.equal(resolveVisualCopies([framed], 0.25).length, 1)
})
