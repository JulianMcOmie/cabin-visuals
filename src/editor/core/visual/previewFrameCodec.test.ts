import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisualEngine } from './VisualEngine'
import { PreviewFrameDecoder, PreviewFrameEncoder, previewFrameTransfers } from './previewFrameCodec'
import type { Track } from '../../types'

function project(noteCount = 64, splitCount = 8) {
  const cube: Track = { id: 'cube', name: 'cube', instrumentId: 'cube', type: 'base', color: '#fff', muted: false, solo: false, childIds: ['split'], params: { tfX: 3 }, blocks: [{ id: 'block', startBar: 0, durationBars: 256, loop: false, notes: Array.from({ length: noteCount }, (_, i) => ({ id: `n${i}`, pitch: 60 + i % 12, velocity: 100, startBeat: i / 4, durationBeats: 1 })) }] }
  const split: Track = { ...cube, id: 'split', instrumentId: '', type: 'splitter', splitterId: 'radial', parentId: 'cube', childIds: [], blocks: [], inputValues: { copies: splitCount, radius: 1 } }
  return { tracks: { cube, split }, rootTrackIds: ['cube'], beatsPerBar: 4, bpm: 120, totalBars: 256 }
}

test('packed frames preserve exact matrices, color options and state across seeks; static metadata is sent once', () => {
  const engine = createVisualEngine(), receiver = createVisualEngine()
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(project())
  let publications = 0
  receiver.subscribeObjects(() => publications++)
  let staticNotes: unknown
  for (const [i, beat] of [0, 0.5, 8, 0, 12, 12].entries()) {
    engine.computeAtBeat(beat)
    const copies = engine.getVisualCopies('cube')
    copies[0].colorShift = { hue: -0, saturation: .123456789123, lightness: -.7, tint: '#Aa22Bb', tintAmount: .314, tintPerceptual: false }
    copies[1].colorShift.huePerceptual = true
    copies[2].colorShift.tintPerceptual = undefined
    const packet = encoder.encode(engine.captureFrame(), i, 0, decoder.id)
    assert.equal(packet.objectList === undefined, i > 0)
    assert.equal(packet.staticStates.size, i === 0 ? 1 : 0)
    const transferred = structuredClone(packet, { transfer: previewFrameTransfers(packet) })
    receiver.applyFrame(decoder.decode(transferred), i > 0)
    assert.deepEqual(receiver.getVisualCopies('cube'), copies)
    assert.deepEqual(receiver.getObjectState('cube'), engine.getObjectState('cube'))
    if (i > 0) assert.equal(receiver.getObjectState('cube')!.notes, staticNotes)
    staticNotes = receiver.getObjectState('cube')!.notes
  }
  assert.equal(publications, 1)
})

test('discarded replies, new documents, new sessions and fallback receivers force self-contained metadata', () => {
  const engine = createVisualEngine(), receiver = createVisualEngine()
  const encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(project()); engine.computeAtBeat(2)
  decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), 1, 0)))
  encoder.encode(engine.captureFrame(), 2, 0, decoder.id) // discarded during export
  const recovered = encoder.encode(engine.captureFrame(), 3, 0, decoder.id)
  assert.equal(recovered.baseId, null)
  receiver.applyFrame(decoder.decode(structuredClone(recovered)))
  assert.deepEqual(receiver.getObjectState('cube'), engine.getObjectState('cube'))
  engine.setProject(project(4, 3)); engine.computeAtBeat(1)
  const edited = encoder.encode(engine.captureFrame(), 4, 1, decoder.id)
  assert.equal(edited.baseId, null)
  receiver.applyFrame(decoder.decode(structuredClone(edited)))
  assert.equal(receiver.getVisualCopies('cube').length, 3)
  assert.equal(receiver.getObjectState('cube')!.notes.length, 4)
  const newDecoder = new PreviewFrameDecoder()
  const newSession = encoder.encode(engine.captureFrame(), 5, 1, newDecoder.id)
  assert.equal(newSession.baseId, null)
  newDecoder.decode(structuredClone(newSession))
  assert.throws(() => decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), 6, 1, 5))), /base was not received/)
})

test('new static state at unchanged revision and sparse per-copy clocks are transmitted and reconstructed', () => {
  const engine = createVisualEngine(), encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(project()); engine.computeAtBeat(1)
  decoder.decode(structuredClone(encoder.encode(engine.captureFrame(), 1, 0)))
  const frame = engine.captureFrame(), state = frame.states.get('cube')!
  const shifted = { ...state, beat: -2, notes: [{ ...state.notes[0], beat: -3 }] }
  frame.copyStatesByTrack.set('cube', [null, shifted])
  const packet = encoder.encode(frame, 2, 0, decoder.id)
  assert.equal(packet.staticStates.size, 1)
  const result = decoder.decode(structuredClone(packet))
  assert.equal(result.copyStatesByTrack.get('cube')![0], null)
  assert.equal(result.copyStatesByTrack.get('cube')![1]!.beat, -2)
  assert.deepEqual(result.copyStatesByTrack.get('cube')![1]!.notes, shifted.notes)
  // Empty structure is a real replacement, not 'metadata unchanged'.
  frame.objectList = []
  const empty = decoder.decode(structuredClone(encoder.encode(frame, 3, 0, decoder.id)))
  assert.deepEqual(empty.objectList, [])
})


test('equivalent per-copy states retain sharing, while later divergent clocks remain independent', () => {
  const engine = createVisualEngine(), encoder = new PreviewFrameEncoder(), decoder = new PreviewFrameDecoder()
  engine.setProject(project()); engine.computeAtBeat(1)
  const frame = engine.captureFrame(), shared = { ...frame.states.get('cube')!, beat: -1 }
  frame.copyStatesByTrack.set('cube', [shared, shared])
  const firstPacket = encoder.encode(frame, 1, 0)
  assert.equal(firstPacket.copyStatesByTrack.get('cube')![0], firstPacket.copyStatesByTrack.get('cube')![1])
  const first = decoder.decode(structuredClone(firstPacket))
  const firstCopies = first.copyStatesByTrack.get('cube')!
  assert.equal(firstCopies[0], firstCopies[1])
  const divergent = { ...shared, beat: -3 }
  frame.copyStatesByTrack.set('cube', [shared, divergent])
  const second = decoder.decode(structuredClone(encoder.encode(frame, 2, 0, decoder.id)))
  const secondCopies = second.copyStatesByTrack.get('cube')!
  assert.notEqual(secondCopies[0], secondCopies[1])
  assert.equal(secondCopies[0]!.beat, -1)
  assert.equal(secondCopies[1]!.beat, -3)
  assert.equal(firstCopies[0]!.beat, -1, 'later frames cannot mutate previously decoded states')
})
