import type { Track } from '../../types'
import { getInstrument } from '../../instruments'
import type {
  ResolvedGraph,
  ResolvedObject,
  ResolvedNote,
  ResolvedAutomation,
  ResolvedEffectAutomation,
  ResolvedEnvelope,
  ResolvedGroup,
} from './types'
import { DEFAULT_ADSR } from './adsr'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import { automationAmount, automationLaneValueBounds, automationOutputBounds, extractBurstGates, extractCycleGates, extractForceNotes, extractKeyframes, extractNoiseGates, integrateForceLane, sampleAutomationLane, type NoiseConfig } from './automation'
import { automationValueBounds, type AutomationRange } from '../trackTypes'
import { isNumberParam, type ObjectInstrumentDef, type ParamDef } from '../../instruments/types'
import { SPATIAL_TRANSFORM_PARAM_DEFS, TRANSFORM_PARAM_DEFS, transformDefault, withTransformParams } from '../transform'
import { SPATIAL_TF_PARAMS, tfAutomationChainEntry } from './tfAutomationChain'
import { getMoverOrSplitterDefinition } from '../visualCopies/registry'
import { mergeDefinitionSettings } from '../visualCopies/definitions'
import { framedMoverOrSplitter } from '../visualCopies/moverFrame'
import { splitterWithChildChain } from '../visualCopies/splitterChildChain'
import type { MoverOrSplitter } from '../visualCopies/types'
import { structuralCopyCount } from '../visualCopies/resolveVisualCopies'
import { gatedMoverOrSplitter } from '../visualCopies/copyTargets'
import { bypassGated } from '../visualCopies/bypass'
import {
  liveChildrenAt,
  switchGated,
  switcherVariantsFor,
  SWITCHER_MODE_PARAM,
  type SwitcherBinding,
} from '../visualCopies/switcher'
import { orderedSwitcherBindings } from '../switcherBindings'
import { identitySV } from './stateVector'
import { flattenTrackNotes as flattenTrackNotesRaw } from './noteFlatten'
import { isSceneTrackId } from '../sceneTrack'
import { clipsFromNotes, isLyricClipNote } from './lyricClips'

/** The slice of the project the resolver reads. ProjectStore's state satisfies it
 *  structurally, so the engine never imports the store's internals. */
export interface ProjectSnapshot {
  tracks: Record<string, Track>
  rootTrackIds: string[]
  beatsPerBar: number
  bpm: number
  totalBars?: number
}

/** Track ids in depth-first order across the whole forest (roots, then each one's
 *  descendants). The engine treats nested and top-level tracks uniformly - nesting
 *  only adds transform inheritance (later); every object/modulator still resolves.
 *  A visited set guards against malformed cyclic data. */
function flattenTree(p: ProjectSnapshot): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id)) return
    const track = p.tracks[id]
    if (!track) return
    seen.add(id)
    out.push(id)
    for (const childId of track.childIds ?? []) visit(childId)
  }
  for (const id of p.rootTrackIds) visit(id)
  return out
}

function flattenTrackNotes(track: Track, p: ProjectSnapshot): ResolvedNote[] {
  return flattenTrackNotesRaw(track, p.beatsPerBar, p.totalBars)
}

/** Gather a track's `automation` child tracks into resolved keyframe lanes over
 *  the given params (an instrument def's for object tracks, a MoverOrSplitter
 *  def's for mover/splitter tracks, a director def's for director tracks -
 *  the latter resolved per frame by VisualEngine's resolveComposition, since
 *  director tracks never enter the resolved graph). Each lane maps one param
 *  (its note pitch → the param's [min,max]); the engine samples them per frame.
 *  Children with no target param or an unknown param are skipped. Muted
 *  automation children are ignored (a quick disable); solo pools per parent. */
/**
 * Noise's deviation is a fraction of the lane's span, and AMOUNT scales it along
 * with the centers. A boosted lane's bounds already carry the amount in their
 * span (automationOutputBounds), so the stored `range` is re-based onto them:
 * the wobble comes out the same size it always did (nominal span × range ×
 * amount) while the CLAMP is the boosted one. A no-op at amount 1.
 */
function scaledNoise(
  cfg: NoiseConfig,
  range: AutomationRange | undefined,
  paramMin: number,
  paramMax: number,
  amount: number,
  bounds: { min: number; max: number },
): NoiseConfig {
  const nominal = automationValueBounds(range, paramMin, paramMax)
  const effSpan = bounds.max - bounds.min
  const factor = amount * (effSpan > 0 ? (nominal.max - nominal.min) / effSpan : 1)
  return factor === 1 ? cfg : { ...cfg, range: cfg.range * factor }
}

export function resolveAutomationLanes(track: Track, params: ParamDef[], p: ProjectSnapshot): ResolvedAutomation[] {
  const out: ResolvedAutomation[] = []
  // Per-parent solo pool among this track's automation children.
  const anyAutoSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'automation' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'automation') continue
    if (child.muted || (anyAutoSolo && !child.solo)) continue
    const param = child.targetParam
    if (!param) continue
    const pdef = params.find((pd) => pd.key === param)
    if (!pdef || !isNumberParam(pdef)) continue
    // The lane's output gain, applied at extraction so every consumer of the
    // resolved lane (engine, hover preview, paramAtBeat) agrees on the values.
    const amount = automationAmount(child)
    // How far this lane may travel: its own value bounds (already possibly past
    // the param's own), widened when AMOUNT boosts. Sampling clamps to these, so
    // a boosted burst/noise/cycle reaches into the headroom instead of piling up
    // against the param's max.
    const bounds = automationOutputBounds(child.automationRange, pdef.min, pdef.max, amount)
    // Burst mode: the notes become ADSR bursts aimed at their own pitch-value,
    // travelling from whatever value sits underneath (hence `base`).
    if (child.burst) {
      out.push({
        param,
        sourceTrackId: child.id,
        mode: 'linear',
        keyframes: [],
        burst: child.burst,
        bursts: extractBurstGates(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount, child.automationRange),
        min: bounds.min,
        max: bounds.max,
        base: pdef.default,
      })
      continue
    }
    // Noise mode: the notes become wobble gates instead of keyframes. Amount
    // scales the wobble's deviation along with its centers - a tamed lane
    // shrinks as a whole, not just where its notes sit.
    if (child.noise) {
      out.push({
        param,
        sourceTrackId: child.id,
        mode: 'linear',
        keyframes: [],
        noise: scaledNoise(child.noise, child.automationRange, pdef.min, pdef.max, amount, bounds),
        gates: extractNoiseGates(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount, child.automationRange),
        min: bounds.min,
        max: bounds.max,
      })
      continue
    }
    // Cycle mode: the motion curve plays once between each pair of note onsets,
    // scaled to the earlier note's pitch-value.
    if (child.cycle) {
      out.push({
        param,
        sourceTrackId: child.id,
        mode: 'linear',
        keyframes: [],
        cycle: child.cycle,
        cycles: extractCycleGates(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount, child.automationRange),
        min: bounds.min,
        max: bounds.max,
      })
      continue
    }
    // Force mode: integrated ONCE, here, into a table the sampler looks up. This
    // is the only lane that does real work at resolve; doing it per frame would
    // make every paused scrub pay for the whole phrase.
    if (child.force) {
      out.push({
        param,
        sourceTrackId: child.id,
        mode: 'linear',
        keyframes: [],
        force: child.force,
        forceTable: integrateForceLane(
          child.force,
          extractForceNotes(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount, child.automationRange),
          bounds.min,
          bounds.max,
        ),
        min: bounds.min,
        max: bounds.max,
      })
      continue
    }
    // min/max ride along for the SPLINE easing, whose tangents may overshoot the
    // keyframes; every other easing stays inside them and ignores the bounds.
    out.push({
      param,
      sourceTrackId: child.id,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, pdef.min, pdef.max, p.totalBars, amount, child.automationRange),
      splineTension: child.splineTension,
      min: bounds.min,
      max: bounds.max,
    })
  }
  return out
}

/** Gather an object track's `automation` child tracks into resolved keyframe lanes.
 *  The canonical transform params (core/transform.ts) are automatable on every
 *  object track, exactly like the instrument's own params. */
function resolveAutomations(track: Track, def: ObjectInstrumentDef | undefined, p: ProjectSnapshot): ResolvedAutomation[] {
  return def ? resolveAutomationLanes(track, withTransformParams(def.params), p) : []
}

/** Sample one beat of every automation lane into a settings/params overlay.
 *  Mirrors computeAtBeat's merge: an inert lane (noise/burst between its gates)
 *  contributes nothing, so `settings` shows through; keyframe lanes hold their
 *  endpoints outside the range. `settings` is what bursts travel away from. */
function sampleAutomationLanes(
  lanes: ResolvedAutomation[],
  beat: number,
  settings: Record<string, string | number>,
): Record<string, number> {
  const values: Record<string, number> = {}
  for (const lane of lanes) {
    // Only numeric params get lanes, so a string-valued setting can never be the
    // base here - fall back to the param's default if one somehow collides.
    const underneath = settings[lane.param]
    const v = sampleAutomationLane(lane, beat, typeof underneath === 'number' ? underneath : lane.base ?? 0)
    if (!Number.isNaN(v)) values[lane.param] = v
  }
  return values
}

/** Gather automation children whose target is fx-namespaced (`fx:<instanceId>:<key>`)
 *  into effect-override lanes. `enabled` is the 0/1 pseudo-param; anything else must
 *  match one of the plugin's numeric params (its [min,max] scales the pitch mapping). */
function resolveEffectAutomations(track: Track, p: ProjectSnapshot): ResolvedEffectAutomation[] {
  const out: ResolvedEffectAutomation[] = []
  const effects = track.effects ?? []
  if (effects.length === 0) return out
  const anyAutoSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'automation' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'automation') continue
    if (child.muted || (anyAutoSolo && !child.solo)) continue
    const target = parseFxTarget(child.targetParam)
    if (!target) continue
    const instance = effects.find((e) => e.id === target.instanceId)
    if (!instance) continue
    let min = 0
    let max = 1
    let base = instance.settings[target.key] ?? 0
    if (target.key !== 'enabled') {
      const pdef = getEffect(instance.pluginId)?.params.find((pd) => pd.key === target.key)
      if (!pdef || !isNumberParam(pdef)) continue
      min = pdef.min
      max = pdef.max
      base = instance.settings[target.key] ?? pdef.default
    }
    // The lane's output gain. 'enabled' is exempt: it is a 0/1 switch read
    // against a 0.5 threshold, and a gain there would just be a surprise
    // off-switch.
    const amount = target.key === 'enabled' ? 1 : automationAmount(child)
    // The lane's reach, exactly as on an instrument-param lane (its own bounds,
    // widened by a boosting amount). 'enabled' keeps the raw 0/1 span.
    const bounds = target.key === 'enabled'
      ? { min, max }
      : automationOutputBounds(child.automationRange, min, max, amount)
    // Burst mode: each note fires the ADSR from the stored setting toward its own
    // pitch-value. The 0/1 'enabled' pseudo-param has no range to travel through,
    // so it stays a keyframe lane whatever the track says.
    if (child.burst && target.key !== 'enabled') {
      out.push({
        instanceId: target.instanceId,
        key: target.key,
        mode: 'linear',
        keyframes: [],
        burst: child.burst,
        bursts: extractBurstGates(child.blocks, p.beatsPerBar, min, max, p.totalBars, amount, child.automationRange),
        min: bounds.min,
        max: bounds.max,
        base,
      })
      continue
    }
    // Cycle mode rides fx lanes the same way burst does; 'enabled' stays a
    // keyframe lane for the same reason (a 0/1 switch has no span to cycle).
    if (child.cycle && target.key !== 'enabled') {
      out.push({
        instanceId: target.instanceId,
        key: target.key,
        mode: 'linear',
        keyframes: [],
        cycle: child.cycle,
        cycles: extractCycleGates(child.blocks, p.beatsPerBar, min, max, p.totalBars, amount, child.automationRange),
        min: bounds.min,
        max: bounds.max,
        base,
      })
      continue
    }
    // Force rides fx lanes too, integrated here exactly as the object branch
    // does; 'enabled' stays keyframes (a 0/1 switch is not a body to push).
    if (child.force && target.key !== 'enabled') {
      out.push({
        instanceId: target.instanceId,
        key: target.key,
        mode: 'linear',
        keyframes: [],
        force: child.force,
        forceTable: integrateForceLane(
          child.force,
          extractForceNotes(child.blocks, p.beatsPerBar, min, max, p.totalBars, amount, child.automationRange),
          bounds.min,
          bounds.max,
        ),
        min: bounds.min,
        max: bounds.max,
        base,
      })
      continue
    }
    // Bounds ride along for the spline's overshoot clamp - see the object-lane
    // branch above. The `enabled` pseudo-param's 0/1 bounds are its own.
    out.push({
      instanceId: target.instanceId,
      key: target.key,
      mode: child.interpolation ?? 'linear',
      keyframes: extractKeyframes(child.blocks, p.beatsPerBar, min, max, p.totalBars, amount, child.automationRange),
      splineTension: child.splineTension,
      min: bounds.min,
      max: bounds.max,
    })
  }
  return out
}

/** The reserved envelope target: multiplies the object's rendered opacity, so every
 *  instrument is fade-able without exposing a param (renderer-level, per the design
 *  doc). Wins over an instrument's own numeric param of the same key. */
export const ENVELOPE_OPACITY_TARGET = 'opacity'

const clampTo = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Gather an object track's `envelope` child tracks. Each is a note-gated ADSR
 *  modulating one target: the reserved 'opacity' key, one of the parent's numeric
 *  params, or an fx-namespaced effect setting. Mute/solo mirror automation children
 *  (their own solo pool, per object). Unknown/non-numeric targets are skipped. */
function resolveEnvelopes(track: Track, def: ObjectInstrumentDef | undefined, p: ProjectSnapshot): ResolvedEnvelope[] {
  const out: ResolvedEnvelope[] = []
  const anyEnvSolo = (track.childIds ?? []).some((cid) => {
    const c = p.tracks[cid]
    return !!c && !c.instrumentId && c.type === 'envelope' && !!c.solo
  })
  for (const childId of track.childIds ?? []) {
    const child = p.tracks[childId]
    if (!child || child.instrumentId || child.type !== 'envelope') continue
    if (child.muted || (anyEnvSolo && !child.solo)) continue
    const target = child.targetParam
    if (!target) continue
    const adsr = { ...DEFAULT_ADSR, ...child.adsr }
    const depth = clampTo(child.envDepth ?? 1, 0, 1)
    const notes = flattenTrackNotes(child, p)
    if (target === ENVELOPE_OPACITY_TARGET) {
      out.push({ trackId: child.id, kind: 'opacity', min: 0, max: 1, envTarget: 1, adsr, depth, notes })
      continue
    }
    const fx = parseFxTarget(target)
    if (fx) {
      const instance = (track.effects ?? []).find((e) => e.id === fx.instanceId)
      const pdef = instance ? getEffect(instance.pluginId)?.params.find((pd) => pd.key === fx.key) : undefined
      if (!instance || !pdef || !isNumberParam(pdef)) continue // 'enabled' is a 0/1 toggle - no ADSR
      out.push({
        trackId: child.id,
        kind: 'fx',
        instanceId: fx.instanceId,
        key: fx.key,
        fxBase: instance.settings[fx.key] ?? pdef.default,
        min: pdef.min,
        max: pdef.max,
        envTarget: clampTo(child.envTarget ?? pdef.max, pdef.min, pdef.max),
        adsr,
        depth,
        notes,
      })
      continue
    }
    const pdef = def ? withTransformParams(def.params).find((pd) => pd.key === target) : undefined
    if (!pdef || !isNumberParam(pdef)) continue
    out.push({
      trackId: child.id,
      kind: 'param',
      param: target,
      paramDefault: pdef.default,
      min: pdef.min,
      max: pdef.max,
      envTarget: clampTo(child.envTarget ?? pdef.max, pdef.min, pdef.max),
      adsr,
      depth,
      notes,
    })
  }
  return out
}


/** Gather an object track's `ability` child tracks into per-key note streams. Solo is
 *  per-object: if any ability child is soloed, the non-soloed ones go silent. */
function resolveAbilityEvents(track: Track, p: ProjectSnapshot): Map<string, ResolvedNote[]> {
  const events = new Map<string, ResolvedNote[]>()
  const children = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => !!c && !c.instrumentId && c.type === 'ability' && !!c.abilityKey)
  const anySolo = children.some((c) => c.solo)
  for (const child of children) {
    const off = !!child.muted || (anySolo && !child.solo)
    events.set(child.abilityKey as string, off ? [] : flattenTrackNotes(child, p))
  }
  return events
}



/** The definition id a track contributes to the mover-and-splitter chain.
 *  Ids unknown to the registry (e.g. deleted legacy movers in old saved
 *  projects) resolve to nothing and are skipped. */
function moverOrSplitterId(track: Track): string | undefined {
  if (track.type === 'splitter') return track.splitterId
  if (track.type === 'mover') return track.moverId
  return undefined
}

/** How many ENTRIES a track contributes to its parent's mover-and-splitter
 *  chain. Three answers, and all three are real:
 *
 *   - **0** - a `parentGate` definition (Bypass) acts on the DEVICE it is nested
 *     under rather than on copies. It is lifted out in
 *     `resolveMoverOrSplitterTrack` and wrapped around that parent, so it must
 *     never also appear as an entry of the parent's frame or child chain.
 *   - **1** - an ordinary mover/splitter/colorizer.
 *   - **N** - a SWITCHER, which splices its devices into this chain contiguously
 *     in child order (visualCopies/switcher.ts). Muted/soloed-out devices stay
 *     in the span as permanently-off entries rather than being removed, so the
 *     row-to-device mapping cannot shift under an authoring toggle.
 *
 *  EVERY walk over a track's chain children shares this count, and that is
 *  load-bearing rather than tidy: `weaveSplitterTfLanes` and
 *  `weaveTfAutomationLanes` re-walk `childIds` counting entries to line lanes up
 *  with the already-resolved chain, so a walk that disagreed with
 *  `resolveMoverAndSplitterChain` by one entry would silently weave every lane
 *  into the wrong slot. With switchers in the tree that stopped being a hazard
 *  and became a certainty, which is why this is a count and not a predicate. */
function chainEntryCount(track: Track, p: ProjectSnapshot): number {
  if (track.type === 'switcher') {
    // Summed, not counted: a rack's rows need not be devices at all. An object
    // or group row contributes 0 entries (it is gated for visibility instead),
    // and a nested rack contributes its own span.
    return switcherChildTracks(track, p)
      .reduce((n, child) => n + chainEntryCount(child, p), 0)
  }
  const def = getMoverOrSplitterDefinition(moverOrSplitterId(track))
  return !!def && !def.parentGate ? 1 : 0
}

/** True for a track that contributes at least one entry - the filter every
 *  chain walk applies before counting. A switcher with no devices in it
 *  contributes nothing and is skipped exactly like an unknown definition. */
function isChainEntryTrack(track: Track, p: ProjectSnapshot): boolean {
  return chainEntryCount(track, p) > 0
}

/**
 * What a switcher racks up, in child order - **one row each, whatever they are.**
 *
 * A rack is deliberately generic: a row may be a DEVICE (it contributes chain
 * entries, gated by the lane), an OBJECT or a GROUP (its objects are gated for
 * visibility instead), or a nested SWITCHER (its own span, gated as one row).
 * Each kind has its own meaning of "off" and the lane does not need to know
 * which is which - so a MIXED rack works, and switching a cube for a grid of
 * spheres is the same gesture as switching one mover for another.
 *
 * Excluded: the child LANES that live on their parent (automation / ability /
 * envelope), audio, and Bypass - a `parentGate` lane gates the device it is
 * nested under and is not a row of anything.
 */
export function switcherChildTracks(track: Track, p: ProjectSnapshot): Track[] {
  return (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => {
      if (!c) return false
      if (c.type === 'automation' || c.type === 'ability' || c.type === 'envelope'
        || c.type === 'audio') return false
      if (c.type === 'switcher' || c.type === 'group' || c.type === 'base') return true
      const def = getMoverOrSplitterDefinition(moverOrSplitterId(c))
      return !!def && !def.parentGate
    })
}

/**
 * A switcher's lane, resolved once: its rows and the gate each one answers to.
 *
 * Shared by BOTH arms - the chain splice below and the object-visibility pass in
 * `resolveProject` - so a rack of devices and a rack of objects can never
 * disagree about what its own notes mean.
 *
 * The gate is memoized on the beat because it is asked once per copy per entry
 * per frame and the mode evaluation walks the note list. One slot is enough:
 * `warpChainBeat` asks every entry for its remap up front (at the REAL beat) and
 * the applies follow (at the object beat), so the worst case is one extra
 * evaluation per frame rather than thrashing.
 */
function resolveSwitcherLane(track: Track, p: ProjectSnapshot): {
  children: Track[]
  mode: number
  isLive: (index: number) => (beat: number) => boolean
  /** True when a row is switched off by AUTHORING (muted, or soloed out by a
   *  sibling) rather than by the lane - so it can never run at any beat. */
  isOff: (index: number) => boolean
} {
  const children = switcherChildTracks(track, p)
  const indexByChild = new Map(children.map((child, index) => [child.id, index]))
  const bindings: SwitcherBinding[] = orderedSwitcherBindings(track, children.map((c) => c.id))
    .map(({ pitch, childTrackId }) => ({ pitch, index: indexByChild.get(childTrackId)! }))
  const notes = flattenTrackNotes(track, p)
  const mode = track.params?.[SWITCHER_MODE_PARAM.key] ?? SWITCHER_MODE_PARAM.default

  let cachedBeat = Number.NaN
  let cachedLive = new Set<number>()
  const liveSet = (beat: number): Set<number> => {
    if (beat !== cachedBeat) {
      cachedBeat = beat
      cachedLive = new Set(liveChildrenAt(bindings, notes, { mode }, beat))
    }
    return cachedLive
  }

  // Mute/solo are AUTHORING overrides and beat the lane: a muted row never runs
  // however it is played, and soloing one is how you audition it on the very
  // track where MIDI would otherwise be deciding.
  const anySolo = children.some((child) => child.solo)
  const isOff = (index: number) => {
    const child = children[index]
    return !child || !!child.muted || (anySolo && !child.solo)
  }
  return {
    children,
    mode,
    isOff,
    isLive: (index) => (isOff(index) ? () => false : (beat) => liveSet(beat).has(index)),
  }
}

/**
 * A switcher's devices, resolved and spliced: the entries of every child in
 * child order, each wrapped in the lane's gate.
 *
 * **A ROW may own more than one entry.** A nested switcher is one row of the
 * outer lane but contributes its whole span, and the outer row gates all of it
 * together. That is why the gate is per ROW and the splice is a flatten, rather
 * than one entry per child: collapsing the inner span into a single entry would
 * mean running a kernel over it, and its entries would then see `index`/`count`/
 * `formation` describing a private fan-out instead of the real formation - the
 * exact mistake visualCopies/switcher.ts's header exists to prevent.
 *
 * The gate is shared by every entry in the span and memoized on the beat,
 * because `apply` is called once per copy per entry per frame and the mode
 * evaluation walks the note list. One slot is enough: `warpChainBeat` asks every
 * entry for its remap up front (at the REAL beat) and the applies follow (at the
 * object beat), so the worst case is one extra evaluation per frame rather than
 * thrashing.
 */
function resolveSwitcherEntries(track: Track, p: ProjectSnapshot): MoverOrSplitter[] {
  const { children, mode, isLive, isOff } = resolveSwitcherLane(track, p)
  if (children.length === 0) return []
  const entries: MoverOrSplitter[] = []
  children.forEach((child, index) => {
    const rowEntries = resolveChainChildEntries(child, p)
    if (rowEntries.length === 0) return
    const gate = isLive(index)
    // A row that can never run publishes NO structural variants, so it adds
    // nothing to the mounted copy ceiling - it still keeps its slot in the span,
    // so pitches and rows never shift under an authoring toggle.
    const variants = isOff(index) ? [] : null
    for (const entry of rowEntries) {
      entries.push(switchGated(
        entry,
        gate,
        variants ?? switcherVariantsFor(entry, mode, index, children.length),
      ))
    }
  })
  return entries
}

/** How many copies a switcher's rack can mount at once - the number its panel
 *  reports, and the one that explains why a rack of splitters got slow. It is a
 *  property of the MODE as much as of the devices: Gate and Toggle can run
 *  everything, so the span's reach is the product of their fan-outs, while Solo
 *  and Latch run at most one and reach only the largest. Editor metadata (it
 *  resolves the span), so memoize it on the document rather than calling it per
 *  frame. */
export function switcherCopyCeiling(track: Track, p: ProjectSnapshot): number {
  return structuralCopyCount(resolveSwitcherEntries(track, p))
}

/** One chain child, resolved to the entries it contributes: a switcher's whole
 *  span, or the single entry every other device is. The one place that decision
 *  is made, so the five walks that build chains and prefixes cannot disagree
 *  about how many slots a child owns. */
function resolveChainChildEntries(track: Track, p: ProjectSnapshot): MoverOrSplitter[] {
  if (track.type === 'switcher') return resolveSwitcherEntries(track, p)
  const resolved = resolveMoverOrSplitterTrack(track, p)
  return resolved ? [resolved] : []
}

/** The bypass gates a mover/splitter track carries: its `parentGate` children,
 *  resolved to the one thing they export (`bypassAt`). Muted lanes are ignored
 *  and solo pools among themselves, mirroring the automation/envelope lanes
 *  rather than the chain - they are not chain entries, so they do not belong in
 *  the chain's pool. */
function resolveBypassGates(track: Track, p: ProjectSnapshot): ((beat: number) => boolean)[] {
  const lanes = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => {
      const def = c ? getMoverOrSplitterDefinition(moverOrSplitterId(c)) : undefined
      return !!def?.parentGate
    })
  if (lanes.length === 0) return []
  const anySolo = lanes.some((lane) => lane.solo)
  const gates: ((beat: number) => boolean)[] = []
  for (const lane of lanes) {
    if (lane.muted || (anySolo && !lane.solo)) continue
    const resolved = resolveOwnMoverOrSplitter(lane, p)
    if (resolved?.bypassAt) gates.push(resolved.bypassAt.bind(resolved))
  }
  return gates
}

/** Resolve one mover/splitter track's OWN definition, without its child chain:
 *  merge the definition's param defaults with the track's stored inputValues
 *  (numeric) and stringParams (color/string),
 *  flatten its notes, and let the definition close over both. Returns null for
 *  unknown ids. Automation children overlay their params per beat: the resolved
 *  closure re-resolves with the beat-sampled settings, memoized per beat. The
 *  memo is a cache, not playback state - re-resolving at a repeated beat yields
 *  the identical closure, so scrub == playback == export still holds. */
function resolveOwnMoverOrSplitter(track: Track, p: ProjectSnapshot): MoverOrSplitter | null {
  const def = getMoverOrSplitterDefinition(moverOrSplitterId(track))
  if (!def) return null
  const settings = mergeDefinitionSettings(def, track.inputValues, track.stringParams)
  const notes = flattenTrackNotes(track, p)
  const resolved = def.resolve({ settings, notes })
  const automation = resolveAutomationLanes(track, def.params, p)
  if (automation.length === 0) return resolved
  let cachedBeat = Number.NaN
  let cached = resolved
  const wrapped: MoverOrSplitter = {
    apply(visualCopy, context) {
      if (context.beat !== cachedBeat) {
        cachedBeat = context.beat
        cached = def.resolve({ settings: { ...settings, ...sampleAutomationLanes(automation, context.beat, settings) }, notes })
      }
      return cached.apply(visualCopy, context)
    },
  }
  // A time remap is deliberately taken from the UN-automated resolution: it is
  // asked for the REAL beat (while apply is asked for the warped one), so
  // routing it through the memo above would thrash the cache every frame. The
  // only thing this loses is automating a remap's own params, which for Freeze
  // means automating a two-value "on release" switch.
  if (resolved.warpBeat) wrapped.warpBeat = (beat) => resolved.warpBeat!(beat)
  // A bypass gate is taken from the UN-automated resolution for the same reason,
  // and loses even less by it: the only thing a Bypass has to automate is a
  // two-value polarity switch.
  if (resolved.bypassAt) wrapped.bypassAt = (beat) => resolved.bypassAt!(beat)
  // Automation makes the per-beat settings - and so possibly the COPY COUNT -
  // vary with the beat, which a single-beat structural probe cannot see. Hand
  // the probe the definition resolved at every lane's maximum reach (and
  // minimum, for a count that shrinks as a param grows) so the mounted pool is
  // sized to everything the lanes can reach (structuralCopyCount in
  // visualCopies/resolveVisualCopies.ts).
  const maxOverlay: Record<string, number> = {}
  const minOverlay: Record<string, number> = {}
  for (const lane of automation) {
    const underneath = settings[lane.param]
    const bounds = automationLaneValueBounds(lane, typeof underneath === 'number' ? underneath : lane.base ?? 0)
    maxOverlay[lane.param] = bounds.max
    minOverlay[lane.param] = bounds.min
  }
  wrapped.structuralVariants = [
    def.resolve({ settings: { ...settings, ...maxOverlay }, notes }),
    def.resolve({ settings: { ...settings, ...minOverlay }, notes }),
  ]
  return wrapped
}

/** Resolve one mover/splitter track WITH its nested mover/splitter children.
 *  Those children are never chain entries of the object; what they are depends
 *  on the parent. Under a MOVER they are its FRAME and move its field
 *  (visualCopies/moverFrame.ts); under a SPLITTER they act on its copies in
 *  its reference frame (visualCopies/splitterChildChain.ts). Both collect
 *  through the same function as an object's chain, so nesting recurses.
 *
 *  A BYPASS child is neither: it says whether this device runs at all, so it is
 *  filtered out of that collection (isChainEntryTrack) and wraps the finished
 *  entry instead (visualCopies/bypass.ts). */
function resolveMoverOrSplitterTrack(track: Track, p: ProjectSnapshot): MoverOrSplitter | null {
  const own = resolveOwnMoverOrSplitter(track, p)
  if (!own) return null
  const children = resolveMoverAndSplitterChain(track, p)
  let entry: MoverOrSplitter
  if (track.type === 'splitter') {
    entry = splitterWithChildChain(own, weaveSplitterTfLanes(track, children, p))
  } else {
    entry = framedMoverOrSplitter(own, children)
    // Structural variants stay the BARE resolutions: frames don't change counts,
    // so they skip the framing wrapper (splitterWithChildChain, whose children DO
    // change counts, composes its own variants instead).
    if (entry !== own && own.structuralVariants) entry.structuralVariants = own.structuralVariants
  }
  // Copy targeting wraps the WHOLE entry, children included: "this device acts on
  // these copies" has to mean its nested frame/child chain too, or a targeted
  // splitter would still spin its untargeted copies. Absent targeting is the
  // common case and adds no wrapper at all.
  const targeted = track.copyTargets ? gatedMoverOrSplitter(entry, track.copyTargets) : entry
  // A Bypass lane wraps everything else, because "this device is switched off"
  // has to mean its frame, its child chain AND its copy targeting - a bypassed
  // splitter that still acted on the copies it had targeted would be off and on
  // at the same time.
  return bypassGated(targeted, resolveBypassGates(track, p))
}

/** A splitter's own spatial tf* automation lanes (x/y/z, rotations, size): each
 *  becomes a count-neutral delta entry (tfAutomationChain.ts) woven among the
 *  splitter's mover/splitter children at the lane's own child position, so a
 *  lane behaves exactly like a mover child added in that slot - it moves the
 *  splitter's copies in the splitter's reference frame, about the splitter's
 *  origin, as internal motion that never re-frames the chain below
 *  (visualCopies/splitterChildChain.ts). No mirroring here, unlike the object
 *  chain's weave: the child chain composes top-down in child order already.
 *  The delta's base is the panel value under the lane - splitters store no tf*
 *  params today, so the transform default - keeping inert lanes genuine no-ops
 *  and keyframe values absolute. */
function weaveSplitterTfLanes(track: Track, chain: MoverOrSplitter[], p: ProjectSnapshot): MoverOrSplitter[] {
  const lanes = resolveAutomationLanes(track, SPATIAL_TRANSFORM_PARAM_DEFS, p)
  if (lanes.length === 0) return chain
  const laneBySource = new Map<string, ResolvedAutomation>()
  for (const lane of lanes) {
    if (lane.sourceTrackId !== undefined) laneBySource.set(lane.sourceTrackId, lane)
  }
  // Walk childIds interleaving lane deltas with the resolved chain entries.
  // Mirrors resolveMoverAndSplitterChain's filters (isChainEntryTrack, mute/solo
  // pool) so the chain entries line up with the walk.
  const chainChildren = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => !!c && isChainEntryTrack(c, p))
  const anySolo = chainChildren.some((c) => c.solo)
  const woven: MoverOrSplitter[] = []
  let chainIndex = 0
  for (const cid of track.childIds ?? []) {
    const child = p.tracks[cid]
    if (!child) continue
    const lane = laneBySource.get(cid)
    if (lane) {
      const base = track.params?.[lane.param] ?? transformDefault(lane.param)
      woven.push(tfAutomationChainEntry(lane, base))
    } else if (!child.muted && (!anySolo || child.solo)) {
      // A switcher child occupies SEVERAL slots of `chain` (its spliced span),
      // so the walk advances by its entry count, not by one.
      const count = chainEntryCount(child, p)
      for (let i = 0; i < count && chainIndex < chain.length; i++) woven.push(chain[chainIndex++])
    }
  }
  return woven
}

/** Collect an object track's mover and splitter children together, in exact
 *  childIds order. Muted entries are removed from the chain (a structural
 *  change - the copy count may drop); solo is a pool among the chain children.
 *  Bypass lanes are not entries at all (isChainEntryTrack) - they gate the
 *  device they are nested under, and reach it through resolveBypassGates. A
 *  SWITCHER child splices its whole span in here instead of one entry
 *  (visualCopies/switcher.ts), which is what makes its Gate mode with every row
 *  held identical to those devices being plain siblings. */
function resolveMoverAndSplitterChain(track: Track, p: ProjectSnapshot): MoverOrSplitter[] {
  const candidates = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => !!c && isChainEntryTrack(c, p))
  const anySolo = candidates.some((c) => c.solo)
  const chain: MoverOrSplitter[] = []
  for (const child of candidates) {
    if (child.muted || (anySolo && !child.solo)) continue
    chain.push(...resolveChainChildEntries(child, p))
  }
  return chain
}

/** Child order decides WHERE a spatial tf* automation lane applies (the user's
 *  mental model reads children as a top-to-bottom pipeline):
 *
 *   - lane ABOVE a splitter: the splitter duplicates the already-animated
 *     object, so the lane's motion belongs to each copy individually (a grid
 *     under a rotation lane shows every cell spinning in place);
 *   - lane BELOW every chain child: the lane animates the finished formation as
 *     one - the historical placement behavior, kept bit-exact by leaving such
 *     lanes on the params-overlay path.
 *
 *  Chain composition runs the OTHER way round (an entry re-frames everything
 *  below it, so "applies per copy" means sitting LATER in the chain), so a
 *  lane's slot MIRRORS across the chain: a lane with g chain siblings above it
 *  becomes a per-copy delta entry (tfAutomationChain.ts) inserted after chain
 *  position n - g. Lanes between two splitters land between them mirrored -
 *  outside the split above them, inside the one below. Delta entries are
 *  count-neutral, so structural budgets and getPriorVisualCopyCount's prefix
 *  math (which ignores them) stay exact. */
function weaveTfAutomationLanes(
  track: Track,
  chain: MoverOrSplitter[],
  lanes: ResolvedAutomation[],
  p: ProjectSnapshot,
): { chain: MoverOrSplitter[]; overlay: ResolvedAutomation[] } {
  if (chain.length === 0 || lanes.length === 0) return { chain, overlay: lanes }
  // How many chain ENTRIES sit above each automation child. Mirrors
  // resolveMoverAndSplitterChain's filters exactly (isChainEntryTrack, mute/solo
  // pool), so the count lines up with `chain`.
  const chainChildren = (track.childIds ?? [])
    .map((cid) => p.tracks[cid])
    .filter((c): c is Track => !!c && isChainEntryTrack(c, p))
  const anySolo = chainChildren.some((c) => c.solo)
  const gapByChildId = new Map<string, number>()
  let entriesAbove = 0
  for (const cid of track.childIds ?? []) {
    const child = p.tracks[cid]
    if (!child) continue
    if (!child.instrumentId && child.type === 'automation') gapByChildId.set(cid, entriesAbove)
    else if (!child.muted && (!anySolo || child.solo)) entriesAbove += chainEntryCount(child, p)
  }
  const n = chain.length
  const overlay: ResolvedAutomation[] = []
  // Keyed by how many chain entries precede the delta in the woven chain.
  const deltasByPosition = new Map<number, MoverOrSplitter[]>()
  for (const lane of lanes) {
    const g = lane.sourceTrackId !== undefined ? gapByChildId.get(lane.sourceTrackId) : undefined
    if (g === undefined || g >= n || !SPATIAL_TF_PARAMS.has(lane.param)) {
      overlay.push(lane)
      continue
    }
    const base = track.params?.[lane.param] ?? transformDefault(lane.param)
    const entry = tfAutomationChainEntry(lane, base)
    const position = n - g
    const slot = deltasByPosition.get(position)
    if (slot) slot.push(entry)
    else deltasByPosition.set(position, [entry])
  }
  if (deltasByPosition.size === 0) return { chain, overlay }
  const woven: MoverOrSplitter[] = []
  for (let i = 0; i < n; i++) {
    woven.push(chain[i])
    const deltas = deltasByPosition.get(i + 1)
    if (deltas) woven.push(...deltas)
  }
  return { chain: woven, overlay }
}

/** True when this mover/splitter belongs to a parent's chain rather than routing
 *  itself: a LOCAL entry of its parent instrument's chain, a FRAME entry of a
 *  parent mover/splitter (visualCopies/moverFrame.ts), a GROUP entry - a
 *  chain child of a group track, broadcast to the member objects above it (the
 *  group pass in resolveProject) - or a SWITCHER's device, which reaches the
 *  chain through its rack's span. Everything else (root level, or under an
 *  instrument the registry no longer knows) is a mover "without a parent": it
 *  routes globally through its `targets`, appended to the end of each target
 *  object's chain. */
function isChainChild(track: Track, p: ProjectSnapshot): boolean {
  const parent = track.parentId ? p.tracks[track.parentId] : undefined
  if (!parent) return false
  return !!getInstrument(parent.instrumentId)
    || !!getMoverOrSplitterDefinition(moverOrSplitterId(parent))
    || parent.type === 'group'
    || parent.type === 'switcher'
}

/** Any ancestor CONTAINER (group or switcher) with the given flag set. Mute on
 *  one silences its whole subtree; solo on one solos its member objects (they
 *  join the object solo pool). Non-container ancestors never propagate either
 *  flag - that is today's behavior for nested object tracks, kept unchanged. */
function ancestorGroupFlag(track: Track, p: ProjectSnapshot, flag: 'muted' | 'solo'): boolean {
  for (let cur = track.parentId; cur != null; cur = p.tracks[cur]?.parentId) {
    const t = p.tracks[cur]
    if (t && (t.type === 'group' || t.type === 'switcher') && t[flag]) return true
  }
  return false
}

function globalTrackTargetsObject(track: Track, object: Track, p: ProjectSnapshot): boolean {
  return (track.targets ?? []).some(({ scope }) => {
    if (scope.kind === 'track') return scope.id === object.id
    if (scope.kind === 'tag') return (object.tags ?? []).includes(scope.tag)
    let current: Track | undefined = object
    while (current) {
      if (current.id === scope.id) return true
      current = current.parentId ? p.tracks[current.parentId] : undefined
    }
    return false
  })
}

/** Structural copy count immediately before one mover/splitter track. This is
 * editor metadata only: it evaluates the same enabled prefix as resolveProject,
 * so an index-aware definition can expose exactly the rows it can address. A
 * top-level entry may target objects with different prefix counts; one MIDI lane
 * must serve all of them, so its row set uses the largest target count. Global
 * entries (movers without a parent instrument) apply in depth-first tree order. */
export function getPriorVisualCopyCount(trackId: string, p: ProjectSnapshot): number {
  let largest = 1
  for (const prefix of priorChainPrefixes(trackId, p)) {
    largest = Math.max(largest, structuralCopyCount(prefix))
  }
  return largest
}

/**
 * The resolved chain that runs BEFORE one mover/splitter track - the same
 * prefix `getPriorVisualCopyCount` measures, handed over whole so a caller can
 * evaluate it itself. The Targets panel resolves it per frame to draw the real
 * incoming formation, which is what keeps its window from drifting away from
 * what renders.
 *
 * Where several prefixes apply (a group child broadcasting to members, a global
 * entry hitting several objects) it returns the BUSIEST one, matching the count
 * the row's MIDI vocabulary is already sized against.
 *
 * Editor metadata, not a playback path: building it walks the subtree, so a
 * caller should memoize on the document rather than call it per frame.
 */
export function getPriorChainPrefix(trackId: string, p: ProjectSnapshot): MoverOrSplitter[] {
  let best: MoverOrSplitter[] = []
  let bestCount = -1
  for (const prefix of priorChainPrefixes(trackId, p)) {
    const count = structuralCopyCount(prefix)
    if (count > bestCount) {
      bestCount = count
      best = prefix
    }
  }
  return best
}

/** Every chain prefix that can precede one mover/splitter track: the entries
 *  above it, resolved. Usually exactly one; a group chain child has one per
 *  member object and a global entry one per targeted object. */
function priorChainPrefixes(trackId: string, p: ProjectSnapshot): MoverOrSplitter[][] {
  const target = p.tracks[trackId]
  if (!target) return []

  // A chain child counts the entries above it within its parent's chain -
  // an instrument's local chain, or a parent mover's frame chain; a global entry
  // counts each target's local chain plus every preceding global that hits it.
  if (isChainChild(target, p)) {
    const parent = p.tracks[target.parentId!]
    if (!parent) return []
    // A GROUP's chain child broadcasts to the member objects above it; one
    // MIDI lane must serve all of them, so the row set uses the largest member
    // count. Per member: its own chain, then this group's entries above the
    // target. (Entries a nested inner group contributes in between are ignored
    // here - this is editor row metadata, not playback.)
    if (parent.type === 'group') {
      const chainCandidates = (parent.childIds ?? [])
        .map((id) => p.tracks[id])
        .filter((child): child is Track => !!child && isChainEntryTrack(child, p))
      const anySolo = chainCandidates.some((child) => child.solo)
      const entriesAbove: MoverOrSplitter[] = []
      const memberObjects: Track[] = []
      const collectObjects = (id: string) => {
        const t = p.tracks[id]
        if (!t) return
        if (t.instrumentId && getInstrument(t.instrumentId)) memberObjects.push(t)
        for (const c of t.childIds ?? []) collectObjects(c)
      }
      for (const cid of parent.childIds ?? []) {
        if (cid === trackId) break
        const child = p.tracks[cid]
        if (!child) continue
        if (isChainEntryTrack(child, p)) {
          if (child.muted || (anySolo && !child.solo)) continue
          entriesAbove.push(...resolveChainChildEntries(child, p))
        } else {
          collectObjects(cid)
        }
      }
      return memberObjects.map((member) => [
        ...resolveMoverAndSplitterChain(member, p),
        ...entriesAbove,
      ])
    }
    const candidates = (parent.childIds ?? [])
      .map((id) => p.tracks[id])
      .filter((child): child is Track => !!child && isChainEntryTrack(child, p))
    const anySolo = candidates.some((child) => child.solo)
    const prefix: MoverOrSplitter[] = []
    // A SPLITTER's child chain runs over the splitter's own copies
    // (visualCopies/splitterChildChain.ts), so the parent itself heads the
    // prefix; a MOVER's children are its frame and start from one copy.
    if (parent.type === 'splitter') {
      const own = resolveOwnMoverOrSplitter(parent, p)
      if (own) prefix.push(own)
    }
    for (const child of candidates) {
      if (child.id === trackId) break
      if (child.muted || (anySolo && !child.solo)) continue
      prefix.push(...resolveChainChildEntries(child, p))
    }
    return [prefix]
  }

  const objects = Object.values(p.tracks).filter(
    (track) => !!track.instrumentId && !!getInstrument(track.instrumentId),
  )
  const targetObjects = objects.filter((object) => globalTrackTargetsObject(target, object, p))
  return targetObjects.map((object) => {
    const prefix = resolveMoverAndSplitterChain(object, p)
    for (const globalId of flattenTree(p)) {
      if (globalId === trackId) break
      const global = p.tracks[globalId]
      if (
        !global || global.muted ||
        !isChainEntryTrack(global, p) ||
        isChainChild(global, p) ||
        !globalTrackTargetsObject(global, object, p)
      ) continue
      prefix.push(...resolveChainChildEntries(global, p))
    }
    return prefix
  })
}

// ── Per-track resolve reuse ──────────────────────────────────────────────────
// resolveProject runs debounced after every edit burst, and in a large project
// the note flattening (loop tiling) and chain-closure building dominate - a
// one-note edit re-resolving 30 dense tracks costs tens of ms right when the
// gesture ends. The store updates immutably with per-track reference
// preservation, so an object's resolution can be reused by identity: the cache
// is keyed WEAKLY on the object track's own reference (an edit to the track
// replaces the ref, and the old entry is GC'd with it) and validated against
// everything else its resolvers read - the subtree refs (child lanes at any
// depth, including mover frames) and the tempo fields. Cached entries are never
// emitted directly: each resolve emits a shallow copy with its own chain array
// (global movers append per resolve), solo-derived mute, and scratchBase.
// The shared inner closures are stateful-but-pure (per-beat memos), same as
// one instance serving several target objects within a single resolve.
const objectResolveCache = new WeakMap<Track, { deps: unknown[]; entry: ResolvedObject }>()
// Keyed on the track, holding the ENTRIES it contributes - a list rather than
// one entry, because a switcher racks up a whole span.
const globalMoverResolveCache = new WeakMap<Track, { deps: unknown[]; entries: MoverOrSplitter[] }>()

/** Everything a track's resolvers read, as an identity-comparable list: the
 *  track itself, its whole subtree (DFS), and the tempo fields. */
function resolveDeps(track: Track, p: ProjectSnapshot): unknown[] {
  const deps: unknown[] = [p.beatsPerBar, p.totalBars]
  const seen = new Set<string>()
  const visit = (t: Track) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    deps.push(t)
    for (const cid of t.childIds ?? []) {
      const c = p.tracks[cid]
      if (c) visit(c)
    }
  }
  visit(track)
  return deps
}

function depsEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Flatten the project into resolved objects (with their mover chains) plus the tag
 * index. Objects resolve first so tag-scoped top-level movers can expand to the
 * objects carrying that tag.
 */
export function resolveProject(p: ProjectSnapshot): ResolvedGraph {
  const objects: ResolvedObject[] = []
  const groups: ResolvedGroup[] = []
  const tagIndex = new Map<string, string[]>()
  const backdropChain: MoverOrSplitter[] = []

  // The scene instrument (core/sceneTrack.ts), if this scene wears one. It
  // arrives as an ordinary `group` track spliced in at the front of the roots,
  // so the group machinery below carries it - what it needs on top is the two
  // things a group cannot say: it is the implicit PARENT of every root object
  // (nothing is nested under it in the document), and its colorizers paint the
  // BACKDROP rather than the objects.
  const sceneTrack = p.rootTrackIds.map((id) => p.tracks[id]).find((t) => t && isSceneTrackId(t.id))

  // Real solo, scoped to OBJECTS: if any object is soloed, non-soloed objects go off
  // (muted). Child automation keeps its own mute, so soloing an object never
  // disables its automation. Ability-lane solo is
  // separate (per object, in resolveAbilityEvents).
  // A soloed GROUP joins the pool on behalf of its member objects; a muted
  // group silences its whole subtree (ancestorGroupFlag).
  const isObjectTrack = (t: Track) => !!t.instrumentId
  const anyObjectSolo = Object.values(p.tracks).some((t) => t.solo
    && (isObjectTrack(t) || t.type === 'group' || t.type === 'switcher'))

  // One lane per switcher per resolve, so both arms of a rack - the spliced
  // device entries and the object visibility gates below - share the same
  // memoized evaluation and cannot disagree about what its notes mean.
  const switcherLanes = new Map<string, ReturnType<typeof resolveSwitcherLane>>()
  const laneFor = (t: Track) => {
    let lane = switcherLanes.get(t.id)
    if (!lane) {
      lane = resolveSwitcherLane(t, p)
      switcherLanes.set(t.id, lane)
    }
    return lane
  }

  /** The gate an object inherits from every SWITCHER standing above it: which
   *  row of each rack it descends from, and whether that row is running. Racks
   *  compose by AND, so an inner one cannot re-enable what an outer one
   *  switched off. Undefined when no rack stands above the object, which is the
   *  common case and costs it nothing. */
  const objectLiveAt = (track: Track): ((beat: number) => boolean) | undefined => {
    const gates: ((beat: number) => boolean)[] = []
    let childId = track.id
    for (let cur = track.parentId; cur != null; cur = p.tracks[cur]?.parentId) {
      const parent = p.tracks[cur]
      if (!parent) break
      if (parent.type === 'switcher') {
        const lane = laneFor(parent)
        const index = lane.children.findIndex((c) => c.id === childId)
        if (index >= 0) gates.push(lane.isLive(index))
      }
      childId = cur
    }
    if (gates.length === 0) return undefined
    if (gates.length === 1) return gates[0]
    return (beat) => gates.every((gate) => gate(beat))
  }
  const objectOff = (track: Track) =>
    !!track.muted
    || ancestorGroupFlag(track, p, 'muted')
    || (anyObjectSolo && !track.solo && !ancestorGroupFlag(track, p, 'solo'))

  for (const id of flattenTree(p)) {
    const track = p.tracks[id]
    if (!track) continue
    // A group track resolves to a placement node, not an object: its tf*
    // params (+ their lanes) compose per frame in computeAtBeat as the parent
    // of every member's world. Its chain children broadcast in the group pass
    // below, after all objects exist.
    //
    // A SWITCHER resolves to one too, and that is load-bearing rather than a
    // convenience: `computeAtBeat` composes an object's world from
    // `worldMatrices.get(obj.parentId)`, so a rack standing between an object
    // and its group would otherwise have no matrix under that id and the object
    // would silently LOSE its ancestor's transform. Giving the rack a placement
    // node fixes that and makes a rack movable as one, exactly like a group.
    if (track.type === 'group' || track.type === 'switcher') {
      groups.push({
        trackId: id,
        // Same implicit parenting as the objects below - but the scene
        // instrument is itself a group, and must never parent on itself.
        parentId: track.parentId ?? (id === sceneTrack?.id ? undefined : sceneTrack?.id),
        params: track.params ?? {},
        automations: resolveAutomationLanes(track, TRANSFORM_PARAM_DEFS, p),
        afterObjectIndex: objects.length,
      })
      continue
    }
    if (!track.instrumentId) continue

    const tags = track.tags ?? []
    const def = getInstrument(track.instrumentId)
    if (!def) continue // unknown instrument (removed, or a legacy modulator) renders nothing

    const deps = resolveDeps(track, p)
    const cached = objectResolveCache.get(track)
    let base: ResolvedObject
    if (cached && depsEqual(cached.deps, deps)) {
      base = cached.entry
    } else {
      // Child order routes spatial tf* lanes: above a chain sibling they become
      // per-copy chain entries, below them all they stay placement overlays.
      const { chain, overlay } = weaveTfAutomationLanes(
        track,
        resolveMoverAndSplitterChain(track, p),
        resolveAutomations(track, def, p),
        p,
      )
      // Lyric CLIPS are notes at PITCH_LYRIC_CLIP (see core/visual/lyricClips.ts).
      // Splitting them out here means the instrument's `notes` stay exactly the
      // performance notes they always were — a clip must never register as note
      // energy or activity — while the clips arrive already flattened, so a
      // looped block tiles its phrases and a moved block carries them.
      const flatNotes = flattenTrackNotes(track, p)
      const hasLyricClipNotes = flatNotes.some(isLyricClipNote)
      base = {
        trackId: id,
        instrumentId: track.instrumentId,
        parentId: track.parentId,
        muted: false, // per-resolve (solo pool) - set on the emitted copy below
        params: track.params ?? {},
        stringParams: track.stringParams ?? {},
        localTransform: def?.localTransform,
        notes: hasLyricClipNotes ? flatNotes.filter((n) => !isLyricClipNote(n)) : flatNotes,
        abilityEvents: resolveAbilityEvents(track, p),
        lyricClips: hasLyricClipNotes ? clipsFromNotes(flatNotes) : undefined,
        styleLanes: track.styleLanes,
        automations: overlay,
        effectAutomations: resolveEffectAutomations(track, p),
        envelopes: resolveEnvelopes(track, def, p),
        moverAndSplitterChain: chain,
        // Fresh array whenever the track changed: the gate ref-compares it, so
        // a pad-bank edit (which lands via resolve) is always visible to it.
        videoPads: track.videoPads ? [...track.videoPads] : undefined,
        // Same contract for the Photo instrument's bank.
        photoPads: track.photoPads ? [...track.photoPads] : undefined,
        scratchBase: identitySV(),
        tags,
        maskSourceIds: [],
        masksTargets: false,
      }
      objectResolveCache.set(track, { deps, entry: base })
    }
    objects.push({
      ...base,
      // Parenting on the scene instrument is per-RESOLVE, not part of the
      // cached `base`: the cache is keyed on the track's own reference, and
      // toggling the scene instrument changes neither the track nor its
      // subtree. Baking it into `base` would leave every cached object still
      // claiming the old parent after ⌘⇧S.
      parentId: track.parentId ?? sceneTrack?.id,
      muted: objectOff(track),
      // Per-resolve, never cached onto `base`: it closes over this resolve's
      // lane memos, and the switcher standing above an object is not in that
      // object's own dependency subtree.
      liveAt: objectLiveAt(track),
      // Own array per resolve: the global-mover pass below appends into it.
      moverAndSplitterChain: [...base.moverAndSplitterChain],
      scratchBase: identitySV(),
      // Per-resolve like the chain: the crop routing pass below appends, and
      // targets edits arrive as a whole re-resolve rather than a deps miss.
      maskSourceIds: [],
      masksTargets: track.instrumentId === 'crop' && (track.targets?.length ?? 0) > 0,
    })
    for (const tag of tags) {
      const list = tagIndex.get(tag)
      if (list) list.push(id)
      else tagIndex.set(tag, [id])
    }
  }

  const objectIds = new Set(objects.map((o) => o.trackId))
  const objectById = new Map(objects.map((o) => [o.trackId, o]))

  // The scope root and all its descendants that are objects (depth-first).
  const objectsInSubtree = (rootId: string): string[] => {
    const ids: string[] = []
    const visit = (id: string) => {
      const track = p.tracks[id]
      if (!track) return
      if (objectIds.has(id)) ids.push(id)
      for (const childId of track.childIds ?? []) visit(childId)
    }
    visit(rootId)
    return ids
  }

  // Expand a routing's scope to the concrete object trackIds it hits.
  const objectsForScope = (scope: NonNullable<Track['targets']>[number]['scope']): string[] => {
    switch (scope.kind) {
      case 'track': return [scope.id]
      case 'tag': return tagIndex.get(scope.tag) ?? []
      case 'subtree': return objectsInSubtree(scope.id)
    }
  }

  // Chain children of a GROUP track broadcast to the group's members: each
  // mover/splitter child appends to the chain of every OBJECT descended from
  // the member siblings ABOVE it (children read as a top-to-bottom pipeline,
  // so an entry applies to what the group has already stacked; an entry above
  // every member applies to nothing). Entries compose per member in the
  // member's own frame - "everyone gets the motion", not an orbit of the
  // group's origin; the group's own tf* transform and lanes are the
  // formation-as-one channel. Groups process deepest-first (reversed DFS), so
  // a member's chain reads [own chain, inner group entries, outer group
  // entries] and the global pass below appends after all of them.
  for (const gid of flattenTree(p).reverse()) {
    const g = p.tracks[gid]
    if (!g || g.type !== 'group') continue
    const chainChildren = (g.childIds ?? [])
      .map((cid) => p.tracks[cid])
      .filter((c): c is Track => !!c && isChainEntryTrack(c, p))
    if (chainChildren.length === 0) continue
    const anySolo = chainChildren.some((c) => c.solo)
    // The scene instrument holds no members in its childIds - the scene's
    // objects stay at root in the document. Every object in the scene is a
    // member, and they are all "above" it, so an entry anywhere in its chain
    // reaches all of them. (The scene node is FIRST in DFS, so it is the last
    // group this reversed walk visits: its entries land after every real
    // group's, which is the right nesting order for an outermost container.)
    const isSceneNode = isSceneTrackId(gid)
    const membersAbove: ResolvedObject[] = isSceneNode ? [...objects] : []
    for (const cid of g.childIds ?? []) {
      const child = p.tracks[cid]
      if (!child) continue
      if (isChainEntryTrack(child, p)) {
        if (child.muted || (anySolo && !child.solo)) continue
        // Same identity-keyed reuse as the global pass: a group entry
        // re-resolves only when its own subtree changed.
        const deps = resolveDeps(child, p)
        const cached = globalMoverResolveCache.get(child)
        let entries: MoverOrSplitter[]
        if (cached && depsEqual(cached.deps, deps)) {
          entries = cached.entries
        } else {
          entries = resolveChainChildEntries(child, p)
          globalMoverResolveCache.set(child, { deps, entries })
        }
        if (entries.length === 0) continue
        // On the scene instrument a COLORIZER means the backdrop, not the
        // objects. That is the one place `kind` steers resolution (the
        // visualCopies guide calls it a UI-only discriminator), and it earns
        // the exception: the scene's own colour IS its backdrop, objects
        // already have colorizers at every other level (their own track, a
        // group, a routed global entry), and the backdrop has no other way to
        // be driven by the beat at all. "Grade the whole scene, objects
        // included" is the scene EFFECT chain's job, not this one. A switcher
        // resolves to several entries, so the whole splice goes to the
        // backdrop together.
        if (isSceneNode && getMoverOrSplitterDefinition(moverOrSplitterId(child))?.kind === 'colorizer') {
          backdropChain.push(...entries)
          continue
        }
        for (const member of membersAbove) member.moverAndSplitterChain.push(...entries)
      } else {
        for (const oid of objectsInSubtree(cid)) {
          const member = objectById.get(oid)
          if (member) membersAbove.push(member)
        }
      }
    }
  }

  // Movers and splitters WITHOUT a parent instrument are global: they target
  // existing objects by track/tag/subtree and append to moverAndSplitterChain -
  // after every object's local children, in depth-first tree order (roots first,
  // so root-level entries keep their historical rootTrackIds order). Duplicate
  // routes from one entry to the same target object are deduplicated. Muted
  // entries are skipped; entries with no targets affect nothing.
  for (const trackId of flattenTree(p)) {
    const track = p.tracks[trackId]
    if (!track || track.muted || !isChainEntryTrack(track, p)) continue
    if (isChainChild(track, p)) continue
    // Same identity-keyed reuse as objects: a global entry re-resolves only
    // when its own subtree (settings, notes, automation, frame) changed.
    const deps = resolveDeps(track, p)
    const cached = globalMoverResolveCache.get(track)
    let entries: MoverOrSplitter[]
    if (cached && depsEqual(cached.deps, deps)) {
      entries = cached.entries
    } else {
      entries = resolveChainChildEntries(track, p)
      globalMoverResolveCache.set(track, { deps, entries })
    }
    if (entries.length === 0) continue
    const seenTargets = new Set<string>()
    for (const routing of track.targets ?? []) {
      for (const targetObjectId of objectsForScope(routing.scope)) {
        if (seenTargets.has(targetObjectId)) continue
        seenTargets.add(targetObjectId)
        // A root-level switcher routes its whole span to each target: the rack
        // IS the device as far as `targets` is concerned.
        objectById.get(targetObjectId)?.moverAndSplitterChain.push(...entries)
      }
    }
  }

  // A Crop track with routing targets masks THOSE objects (a screen-space pass
  // in each target's ShaderWrapper) instead of its whole scene; with no targets
  // it stays the scene-wide pass VisualScene runs. Only the crop's TRACK ID is
  // routed - the per-frame mask state is pulled from the crop object's own
  // engine state at draw time, so mute/solo and automation apply through the
  // normal object path. A crop never masks itself or another crop (nothing
  // renders there to mask), mirroring the dedup discipline of the mover pass
  // above. Dead targets mask nothing rather than falling back to scene-wide -
  // the settings panel's dead-target warning is the honest surface for that.
  for (const object of objects) {
    if (!object.masksTargets || object.muted) continue
    const track = p.tracks[object.trackId]
    if (!track) continue
    const seenTargets = new Set<string>()
    for (const routing of track.targets ?? []) {
      for (const targetObjectId of objectsForScope(routing.scope)) {
        if (seenTargets.has(targetObjectId) || targetObjectId === object.trackId) continue
        seenTargets.add(targetObjectId)
        const target = objectById.get(targetObjectId)
        if (!target || target.instrumentId === 'crop') continue
        target.maskSourceIds.push(object.trackId)
      }
    }
  }

  // The scene instrument's fx lanes drive the scene EFFECT chain (its
  // `effects` are Scene.effects on the synthetic track), resolved through the
  // same gatherer objects use so all four automation modes carry over.
  const sceneFxAutomations = sceneTrack ? resolveEffectAutomations(sceneTrack, p) : []
  return {
    objects,
    groups,
    tagIndex,
    backdropChain: backdropChain.length ? backdropChain : undefined,
    sceneFxAutomations: sceneFxAutomations.length ? sceneFxAutomations : undefined,
  }
}
