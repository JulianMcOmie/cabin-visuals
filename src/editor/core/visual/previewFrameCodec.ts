import { Matrix4 } from 'three'
import type { VisualEngineInstance } from './VisualEngineInstance'
import type { ObjectState } from './types'
import type { VisualCopy } from '../visualCopies/types'

type Frame = ReturnType<VisualEngineInstance['captureFrame']>
const STATIC_KEYS = ['notes', 'automations', 'abilityEvents', 'lyricClips', 'styleLanes', 'videoPads', 'photoPads'] as const
type StaticState = Pick<ObjectState, typeof STATIC_KEYS[number]>
type MovingState = Omit<ObjectState, typeof STATIC_KEYS[number]>
type StatePacket = { staticId: number; value: MovingState }
const STRIDE = 24
const OPTIONAL_COLOR_FLAGS = [['tintPerceptual', 22], ['huePerceptual', 23]] as const
interface PackedCopies { values: Float64Array; tints: (string | null)[] }
export interface PreviewFramePacket extends Omit<Frame, 'objectList' | 'states' | 'copyStatesByTrack' | 'visualCopiesByTrack' | 'particlePlans'> {
  id: number
  baseId: number | null
  objectList?: Frame['objectList']
  particlePlans?: Frame['particlePlans']
  staticStates: Map<number, StaticState>
  states: Map<string, StatePacket>
  copyStatesByTrack: Map<string, (StatePacket | null)[]>
  visualCopiesByTrack: Map<string, PackedCopies>
}

// Keep Float64 precision and exact optional-property presence. Numeric packing
// is transport only; the evaluator never gives up ownership of its live buffers.
function optionalFlag(value: VisualCopy['colorShift'], key: 'tintPerceptual' | 'huePerceptual') {
  return !Object.hasOwn(value, key) ? 0 : value[key] === undefined ? 3 : value[key] ? 2 : 1
}
function packCopies(copies: readonly VisualCopy[]): PackedCopies {
  const values = new Float64Array(copies.length * STRIDE)
  const tints: (string | null)[] = []
  const tintIds = new Map<string | null, number>()
  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i], color = copy.colorShift, offset = i * STRIDE
    values.set(copy.transform.elements, offset)
    let tint = tintIds.get(color.tint)
    if (tint === undefined) { tint = tints.length; tintIds.set(color.tint, tint); tints.push(color.tint) }
    values[offset + 16] = copy.opacity
    values[offset + 17] = color.hue; values[offset + 18] = color.saturation; values[offset + 19] = color.lightness
    values[offset + 20] = color.tintAmount; values[offset + 21] = tint
    values[offset + 22] = optionalFlag(color, 'tintPerceptual'); values[offset + 23] = optionalFlag(color, 'huePerceptual')
  }
  return { values, tints }
}
function unpackCopies({ values, tints }: PackedCopies): VisualCopy[] {
  const copies: VisualCopy[] = []
  for (let offset = 0; offset < values.length; offset += STRIDE) {
    const colorShift: VisualCopy['colorShift'] = {
      hue: values[offset + 17], saturation: values[offset + 18], lightness: values[offset + 19],
      tint: tints[values[offset + 21]], tintAmount: values[offset + 20],
    }
    for (const [key, index] of OPTIONAL_COLOR_FLAGS) {
      const flag = values[offset + index]
      if (flag) colorShift[key] = flag === 3 ? undefined : flag === 2
    }
    copies.push({ transform: new Matrix4().fromArray(values, offset), opacity: values[offset + 16], colorShift })
  }
  return copies
}

/** Delta metadata is based on the receiver's acknowledged frame, not merely on
 * what was sent: export, disposal or an epoch change can discard an in-flight reply. */
export class PreviewFrameEncoder {
  private lastId: number | undefined
  private revision: number | undefined
  private objectList: Frame['objectList'] | undefined
  private particlePlans: Frame['particlePlans'] = new Map()
  private nextStaticId = 0
  private staticByNotes = new WeakMap<object, { id: number; value: StaticState }[]>()
  encode(frame: Frame, id: number, revision: number, acknowledgedId?: number): PreviewFramePacket {
    const baseId = this.lastId !== undefined && acknowledgedId === this.lastId && revision === this.revision ? this.lastId : null
    if (baseId === null) {
      this.staticByNotes = new WeakMap(); this.nextStaticId = 0; this.objectList = undefined; this.particlePlans = new Map()
    }
    const staticStates = new Map<number, StaticState>()
    const encodedStates = new WeakMap<ObjectState, StatePacket>()
    const encodeState = (state: ObjectState): StatePacket => {
      const cached = encodedStates.get(state)
      if (cached) return cached
      const { notes, automations, abilityEvents, lyricClips, styleLanes, videoPads, photoPads, ...value } = state
      let candidates = this.staticByNotes.get(notes)
      if (!candidates) { candidates = []; this.staticByNotes.set(notes, candidates) }
      let entry = candidates.find(candidate => STATIC_KEYS.every(key => candidate.value[key] === state[key]
        && Object.hasOwn(candidate.value, key) === Object.hasOwn(state, key)))
      if (!entry) {
        const fields = { notes, automations, abilityEvents, lyricClips, styleLanes, videoPads, photoPads }
        // Preserve omitted optional fields, including on hand-built state fixtures.
        for (const key of STATIC_KEYS) if (!Object.hasOwn(state, key)) delete (fields as Partial<StaticState>)[key]
        entry = { id: this.nextStaticId++, value: fields }
        candidates.push(entry); staticStates.set(entry.id, entry.value)
      }
      const encoded = { staticId: entry.id, value }
      encodedStates.set(state, encoded)
      return encoded
    }
    const plansChanged = baseId === null || frame.particlePlans.size !== this.particlePlans.size
      || [...frame.particlePlans].some(([key, plan]) => this.particlePlans.get(key) !== plan)
    const packet: PreviewFramePacket = {
      ...frame, id, baseId, staticStates,
      particlePlans: plansChanged ? new Map(frame.particlePlans) : undefined,
      objectList: frame.objectList !== this.objectList ? frame.objectList : undefined,
      states: new Map([...frame.states].map(([key, state]) => [key, encodeState(state)])),
      copyStatesByTrack: new Map([...frame.copyStatesByTrack].map(([key, states]) => [key, states.map(state => state ? encodeState(state) : null)])),
      visualCopiesByTrack: new Map([...frame.visualCopiesByTrack].map(([key, copies]) => [key, packCopies(copies)])),
    }
    if (plansChanged) this.particlePlans = new Map(frame.particlePlans)
    this.objectList = frame.objectList; this.lastId = id; this.revision = revision
    return packet
  }
}
export class PreviewFrameDecoder {
  id: number | undefined
  private staticStates = new Map<number, StaticState>()
  private objectList: Frame['objectList'] | undefined
  private particlePlans: Frame['particlePlans'] = new Map()
  decode(packet: PreviewFramePacket): Frame {
    if (packet.baseId === null) { this.staticStates.clear(); this.objectList = undefined; this.particlePlans = new Map() }
    else if (packet.baseId !== this.id) throw new Error('Preview frame metadata base was not received')
    for (const [id, state] of packet.staticStates) this.staticStates.set(id, state)
    if (packet.particlePlans) this.particlePlans = packet.particlePlans
    if (packet.objectList) this.objectList = packet.objectList
    if (!this.objectList) throw new Error('Preview frame object metadata is missing')
    const decodedStates = new WeakMap<StatePacket, ObjectState>()
    const decodeState = (packet: StatePacket): ObjectState => {
      const cached = decodedStates.get(packet)
      if (cached) return cached
      const { staticId, value } = packet
      const fields = this.staticStates.get(staticId)
      if (!fields) throw new Error('Preview frame note metadata is missing')
      const decoded = Object.assign(value, fields)
      decodedStates.set(packet, decoded)
      return decoded
    }
    const { id, baseId: _baseId, staticStates: _staticStates, ...frame } = packet
    const decoded: Frame = {
      ...frame, objectList: this.objectList, particlePlans: this.particlePlans,
      states: new Map([...packet.states].map(([key, state]) => [key, decodeState(state)])),
      copyStatesByTrack: new Map([...packet.copyStatesByTrack].map(([key, states]) => [key, states.map(state => state ? decodeState(state) : null)])),
      visualCopiesByTrack: new Map([...packet.visualCopiesByTrack].map(([key, copies]) => [key, unpackCopies(copies)])),
    }
    this.id = id
    return decoded
  }
}
export function previewFrameTransfers(packet: PreviewFramePacket): ArrayBuffer[] {
  return [...packet.visualCopiesByTrack.values()].map(copies => copies.values.buffer as ArrayBuffer)
}
