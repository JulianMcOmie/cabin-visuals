import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisualEngine } from '../core/visual/VisualEngine'
import { useProjectStore } from './ProjectStore'
import { emptyDocument } from '../../persistence/types'
import { hydrate, serialize } from '../../persistence/serialize'
import { automationTargetsForParent } from '../utils/automationTargets'
import { generateValueRows } from '../components/midi/generateRows'
import { undertaleInstrument } from '../instruments/Undertale'
import { UNDERTALE_CHARACTERS } from '../instruments/undertaleCore'
import { isNumberParam } from '../instruments/types'
import type { Track } from '../types'

const character = undertaleInstrument.params.find(p => p.key === 'character')!
const parent: Track = { id: 'undertale', name: 'Undertale', instrumentId: 'undertale', type: 'base',
  color: '#f0474c', muted: false, solo: false, childIds: [], blocks: [], params: { character: 3 } }

function createLane() {
  hydrate(emptyDocument())
  useProjectStore.getState().addTrack(parent)
  const target = automationTargetsForParent(parent, false).find(t => t.key === 'character')
  assert.ok(target, 'Character is offered by the actual automation menus')
  useProjectStore.getState().addAutomationTrack(parent.id, target.key, target.label, target)
  return useProjectStore.getState().tracks[useProjectStore.getState().tracks[parent.id].childIds[0]]
}

test('Character automation starts stepped with exactly one named row per character', () => {
  const lane = createLane()
  assert.equal(lane.interpolation, 'step')
  assert.equal(lane.automationCombine, 'override')
  assert.deepEqual(lane.automationRange, { integer: true })
  assert.ok(isNumberParam(character))
  const rows = generateValueRows(character.min, character.max, [], parent.color, undefined, lane.automationRange, character.valueLabels)
  assert.equal(rows.length, UNDERTALE_CHARACTERS.length)
  assert.deepEqual(rows.map(row => row.label), [...UNDERTALE_CHARACTERS].reverse())
  assert.deepEqual(rows.map(row => row.pitch), [43,42,41,40,39,38,37,36])
  assert.deepEqual(generateValueRows(0,7,[],parent.color,undefined,{integer:true}).map(row => row.label),
    ['7 · max','6','5','4','3','2','1','0 · min'], 'ordinary numeric rows keep their existing labels')
})

test('character keyframes hold until the next step through seeks and save/load', () => {
  const lane = createLane()
  useProjectStore.getState().addBlock(lane.id, { id: 'choices', startBar: 0, durationBars: 4, loop: false,
    notes: [[1,36],[2,43],[4,38]].map(([startBeat,pitch],i) => ({id:`choice-${i}`,startBeat,pitch,durationBeats:0.25,velocity:100})) })
  hydrate(JSON.parse(JSON.stringify(serialize())))
  const state = useProjectStore.getState()
  assert.equal(state.tracks[parent.id].params?.character, 3, 'saved manual selection stays intact')
  assert.equal(state.tracks[lane.id].interpolation, 'step')
  const engine = createVisualEngine()
  engine.setProject({tracks:state.tracks,rootTrackIds:[parent.id],beatsPerBar:4,bpm:120,totalBars:4})
  for (const [beat,expected] of [[1,0],[1.999,0],[2,7],[3.999,7],[4,2],[6,2],[1.5,0],[2.5,7]]) {
    engine.computeAtBeat(beat)
    assert.equal(engine.getObjectState(parent.id)?.params.character, expected, `beat ${beat}`)
  }
})
