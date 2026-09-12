import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameEncoder, PreviewFrameDecoder } from './previewFrameCodec'
import type { Track } from '../../types'

function project(large = true) {
  const particle: Track = { id: 'p', name: 'Particle', instrumentId: 'particle', type: 'base', color: '#fff', childIds: large ? ['a', 'b'] : [], muted: false, solo: false, blocks: [], params: { size: .01, tfX: 2 } }
  const a: Track = { ...particle, id: 'a', instrumentId: '', type: 'splitter', splitterId: 'grid', parentId: 'p', childIds: [], inputValues: { rows: 32, columns: 32, depth: 1, spacing: .2 } }
  const b: Track = { ...a, id: 'b', inputValues: { rows: 32, columns: 32, depth: 1, spacing: .005 } }
  return { tracks: { p: particle, a, b }, rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}
test('million particles use one mount, no expanded copies, and an acknowledged static plan', () => {
  const engine = createVisualEngine(), receiver = createVisualEngine()
  engine.setProject(project())
  assert.equal(engine.getVisualCopyCount('p'), 1048576)
  assert.equal(engine.getObjectList().filter(o => o.trackId === 'p').length, 1)
  assert.equal(engine.getVisualCopies('p').length, 0)
  const plan = engine.getParticlePlan('p')!
  assert.equal(plan.count, 1048576)
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  for (const [id, beat] of [0, 2, -1, 0].entries()) {
    engine.computeAtBeat(beat)
    const packet = encoder.encode(engine.captureFrame(), id, 0, decoder.id)
    assert.equal(packet.particlePlans === undefined, id > 0)
    receiver.applyFrame(decoder.decode(structuredClone(packet)))
    assert.deepEqual(receiver.getVisualCopy('p', 1048575), engine.getVisualCopy('p', 1048575))
    assert.equal(receiver.getObjectState('p')!.beat, beat)
  }
  let publications = 0; engine.subscribeObjects(() => publications++)
  engine.setProject(project(false)); engine.computeAtBeat(0)
  assert.equal(engine.getParticlePlan('p'), undefined)
  assert.equal(engine.getVisualCopies('p').length, 1)
  assert.equal(publications, 1, 'changing representation remounts even when both lists have one entry')
  const reset = decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), 5, 1, decoder.id)))
  receiver.applyFrame(reset)
  assert.equal(receiver.getParticlePlan('p'), undefined)
})

test('million-particle layout automation and count MIDI stay compact during playback and seeks', () => {
  const p = project()
  p.tracks.b.blocks = [{ id: 'count', startBar: 0, durationBars: 8, loop: false, notes: [
    { id: 'one', pitch: 36, velocity: 100, startBeat: 1, durationBeats: .25 },
    { id: 'full', pitch: 67, velocity: 100, startBeat: 3, durationBeats: .25 },
  ] }]
  p.tracks.b.childIds = ['spacing']
  const spacing: Track = { ...p.tracks.b, id: 'spacing', type: 'automation', parentId: 'b', childIds: [], targetParam: 'spacing', blocks: [{ id: 'space', startBar: 0, durationBars: 8, loop: false, notes: [
    { id: 'low', pitch: 36, velocity: 100, startBeat: 0, durationBeats: .25 },
    { id: 'high', pitch: 60, velocity: 100, startBeat: 4, durationBeats: .25 },
  ] }] }
  const engine = createVisualEngine()
  engine.setProject({ ...p, tracks: { ...p.tracks, spacing } })
  assert.equal(engine.getVisualCopyCount('p'), 1048576)
  const matrices = new Map<number, number[]>()
  for (const beat of [0, 2, 4, -1, 2, 0]) {
    engine.computeAtBeat(beat)
    assert.equal(engine.getVisualCopies('p').length, 0)
    assert.equal(engine.getParticlePlan('p')!.count, beat === 2 ? 32768 : 1048576)
    const matrix = [...engine.getVisualCopy('p', 100)!.transform.elements]
    if (matrices.has(beat)) assert.deepEqual(matrix, matrices.get(beat))
    matrices.set(beat, matrix)
    if (beat === 2) assert.equal(engine.getVisualCopy('p', 1048575)!.opacity, 0)
  }
  assert.notDeepEqual(matrices.get(0), matrices.get(4), 'layout spacing changes with automation')
})
