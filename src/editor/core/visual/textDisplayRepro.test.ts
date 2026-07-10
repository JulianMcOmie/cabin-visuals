import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import type { Track } from '../../types'
import { computeAtBeat, getObjectState, getObjectList, setProject } from './VisualEngine'
import { applyMaterialOpacity, setAnimatedOpacity } from './animatedOpacity'

// Repro for Tyler's sev-1: TextDisplay renders no words. Feeds a textDisplay
// track with "Next word" notes (pitch 48) through the real resolve pipeline
// and asserts the notes reach the instrument's ObjectState.
test('textDisplay object receives its pitch-48 notes', () => {
  const text: Track = {
    id: 'text',
    name: 'Text Display',
    type: 'base',
    instrumentId: 'textDisplay',
    stringParams: { text: 'HELLO WORLD REPRO' },
    color: '#facc15',
    muted: false,
    solo: false,
    childIds: [],
    blocks: [{
      id: 'b1',
      startBar: 0,
      durationBars: 4,
      loop: false,
      notes: [
        { id: 'n1', startBeat: 0, durationBeats: 4, pitch: 48, velocity: 1 },
        { id: 'n2', startBeat: 4, durationBeats: 4, pitch: 48, velocity: 1 },
      ],
    }],
  }

  setProject({ tracks: { text }, rootTrackIds: ['text'], beatsPerBar: 4, bpm: 120, totalBars: 4 })

  const list = getObjectList()
  console.log('object list:', JSON.stringify(list))
  assert.ok(list.some((o) => o.trackId === 'text'), 'textDisplay track resolves to an object')

  computeAtBeat(1)
  const state = getObjectState('text')
  assert.ok(state, 'object state exists at beat 1')
  console.log('notes:', JSON.stringify(state.notes))
  console.log('activeNotes:', JSON.stringify(state.activeNotes))
  console.log('stringParams:', JSON.stringify(state.stringParams))
  console.log('blackedOut:', state.blackedOut, 'opacity:', state.opacity)

  assert.equal(state.notes.length, 2, 'both notes resolve')
  assert.equal(state.notes[0].pitch, 48, 'pitch preserved')
  assert.ok(state.activeNotes.length > 0, 'note active at beat 1')
  assert.equal(state.stringParams.text, 'HELLO WORLD REPRO')
})

// The July 4 regression: the wrapper's mover-opacity pass cached each material's
// first-seen opacity as its permanent base. An instrument that animated its
// opacity through 0 (TextDisplay before its first word note) was frozen
// invisible forever. setAnimatedOpacity keeps the recorded base in lockstep.
test('mover opacity pass composes with instrument-animated opacity', () => {
  const mat = new MeshBasicMaterial({ transparent: true, opacity: 1 })
  const g = new Group()
  g.add(new Mesh(new PlaneGeometry(1, 1), mat))

  // Frame 1: playhead before any word note - the instrument hides the text.
  setAnimatedOpacity(mat, 0)
  applyMaterialOpacity(g, 1)
  assert.equal(mat.opacity, 0)

  // Frame 2: a word note sounds - the instrument shows the text. The wrapper
  // must not resurrect the zero it saw on frame 1.
  setAnimatedOpacity(mat, 1)
  applyMaterialOpacity(g, 1)
  assert.equal(mat.opacity, 1)

  // An opacity mover still modulates on top of the animated value, and stays
  // stable across repeated frames (no compounding).
  applyMaterialOpacity(g, 0.5)
  assert.equal(mat.opacity, 0.5)
  applyMaterialOpacity(g, 0.5)
  assert.equal(mat.opacity, 0.5)
})
