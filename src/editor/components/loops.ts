import type { Block, Track } from '../types'
import { WIREFRAME_SHAPES } from '../instruments/wireframeCore'

/** A loop is a complete, editable instrument tree with its own MIDI. */
export interface VisualLoop {
  id: string
  name: string
  description: string
  bars: number
  instruments: readonly string[]
  createTracks: (startBar?: number, beatsPerBar?: number) => Track[]
}

const COLOR = '#7dd3fc'
const BARS = 4

function twistedTunnelTracks(startBar = 0, beatsPerBar = 4): Track[] {
  const wireframeId = crypto.randomUUID()
  const tunnelId = crypto.randomUUID()
  const twistId = crypto.randomUUID()
  // Author in 4/4, then preserve the phrase's bar positions in other meters.
  const beatScale = beatsPerBar / 4
  const block = (notes: [number, number, number, number][]): Block => ({
    id: crypto.randomUUID(), startBar, durationBars: BARS, loop: true, loopLengthBars: BARS,
    notes: notes.map(([startBeat, durationBeats, pitch, velocity]) => ({
      id: crypto.randomUUID(), startBeat: startBeat * beatScale,
      durationBeats: durationBeats * beatScale, pitch, velocity,
    })),
  })
  const common = { color: COLOR, muted: false, solo: false, childIds: [] }
  return [
    {
      ...common, id: wireframeId, name: 'Twisted Tunnel', type: 'base', instrumentId: 'wireframe',
      childIds: [tunnelId, twistId],
      params: { shape: WIREFRAME_SHAPES.findIndex(shape => shape.id === 'square'), size: 1.4, glow: 0.5, weight: 3, detail: 0.4, spin: 0 },
      stringParams: { color: COLOR },
      blocks: [block(Array.from({ length: 16 }, (_, beat) => [beat, 0.5, beat % 4 === 0 ? 68 : 52, beat % 4 === 0 ? 112 : 76]))],
    },
    {
      ...common, id: tunnelId, name: 'Tunnel', type: 'splitter', instrumentId: '', splitterId: 'tunnel', parentId: wireframeId,
      inputValues: { copiesPerRing: 6, rings: 8, radius: 3.4, size: 1, depth: 40, nearEnd: 12, speedMode: 1, syncRingsPerBeat: 0.5, twistDegrees: 0, orientation: 1, fadeDistance: 6, midiSpeed: 2.5 },
      // The four rushes add exactly one ring of travel per phrase, keeping
      // the repeating corridor aligned across the four-bar boundary.
      blocks: [block([[0, 0.5, 60, 127], [4, 0.5, 60, 127], [8, 0.5, 60, 127], [12, 0.5, 60, 127]])],
    },
    {
      ...common, id: twistId, name: 'Twist', type: 'mover', instrumentId: '', moverId: 'symmetricRotation', parentId: wireframeId,
      inputValues: { axis: 2, mode: 3, anchor: 0, falloff: 1, span: 20, twist: 100, fold: 0, roll: 0, angle: 1, curve: 1, cyclesPerBeat: 0.125, returnBeats: 1 },
      blocks: [block([[0, 4, 60, 80], [4, 4, 60, 112], [8, 4, 61, 80], [12, 4, 61, 112]])],
    },
  ]
}

export const VISUAL_LOOPS: readonly VisualLoop[] = [{
  id: 'twisted-tunnel', name: 'Twisted Tunnel', bars: BARS,
  description: 'Glowing wireframes rush through a tunnel that twists with the beat.',
  instruments: ['Wireframe', 'Tunnel', 'Twist'],
  createTracks: twistedTunnelTracks,
}]
