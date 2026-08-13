'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEventHandler, type ReactNode } from 'react'
import { X, ChevronDown, Waves, Dices, TrendingUp, Zap } from 'lucide-react'
import { useUIStore, MIDI_ROW_HEIGHT_MIN, MIDI_ROW_HEIGHT_MAX, type EditingBlockRef } from '../../store/UIStore'
import { useTimeStore } from '../../store/TimeStore'
import { useProjectStore } from '../../store/ProjectStore'
import { useMidiEditorState } from './useMidiEditorState'
import { MidiEditor } from './MidiEditor'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { computeRulerGrid } from '../rulerGrid'
import { generateRows, generateValueRows, generateToggleRows, generateVideoClipRows, generatePhotoRows, generateInstrumentRows, generateTriggerRows } from './generateRows'
import { midiNoteBaseColor, midiToolbarAccent } from '../../utils/midiEditorPalette'
import { resolveTrackDisplayColor } from '../../utils/trackDisplayColor'
import { useVideoStore } from '../../store/VideoStore'
import { usePhotoStore } from '../../store/PhotoStore'
import { getInstrument } from '../../instruments'
import { VIDEO_BASE_PITCH } from '../../core/video/videoTime'
import { PHOTO_BASE_PITCH } from '../../core/photo/photoTime'
import { isNumberParam } from '../../instruments/types'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { compositionAutomatableParams, compositionDef, isCompositionTrack } from '../../core/directors'
import { withSpatialTransformParams, withTransformParams } from '../../core/transform'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import { automationMode } from '../../core/visual/automation'
import { resolveDeclaredMidiRows } from './resolveDeclaredRows'
import type { AutomationMode, Block, InterpolationMode, Track } from '../../types'

/** Filled-track position for .slider-console inputs (drives the --fill var);
 *  `color` retints the filled portion (--slider-color) to the edited track. */
const sliderFill = (value: number, min: number, max: number, color?: string) =>
  ({
    '--fill': `${((value - min) / (max - min)) * 100}%`,
    ...(color ? { '--slider-color': color } : undefined),
  } as CSSProperties)

/** Borderless toolbar select: the native control with its chrome stripped and
 *  a quiet chevron, so it sits in the toolbar like the buttons around it. */
function ToolbarSelect({ value, onChange, title, children }: {
  value: string | number
  onChange: ChangeEventHandler<HTMLSelectElement>
  title: string
  children: ReactNode
}) {
  return (
    <div className="relative flex-shrink-0">
      <select
        value={value}
        onChange={onChange}
        title={title}
        className="appearance-none h-5 pl-1.5 pr-[18px] rounded bg-zinc-800/70 hover:bg-zinc-700/70 text-[10px] text-zinc-300 outline-none cursor-pointer transition-colors"
      >
        {children}
      </select>
      <ChevronDown size={10} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500" />
    </div>
  )
}

/** A labelled toolbar slider - one lane param in its most compact form, wearing
 *  the edited track's accent like the other toolbar chrome. */
function ToolbarSlider({ label, title, value, min, max, step, accent, onChange }: {
  label: string
  title: string
  value: number
  min: number
  max: number
  step: number
  accent: string
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-1" title={title}>
      <span className="text-[10px] text-zinc-600">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={sliderFill(value, min, max, accent)}
        className="slider-console w-10 cursor-pointer"
      />
    </div>
  )
}

/** The three things an automation lane's notes can mean. Mirrors the settings
 *  panel's segmented control (AutomationUserInterface). */
const MODE_OPTIONS: { value: AutomationMode; label: string; title: string; icon: typeof Waves }[] = [
  { value: 'curve', label: 'Curve', title: 'Notes are value keyframes joined by a curve', icon: TrendingUp },
  { value: 'noise', label: 'Noise', title: 'Held notes gate a seeded random wobble around their value', icon: Waves },
  { value: 'burst', label: 'Burst', title: 'Each note fires an ADSR envelope toward its value', icon: Zap },
]

/** Automation editor context: the param a lane drives, and its value bounds.
 *  kind picks the row model - 'value' shows 13 value-labelled rows across the
 *  automation span; 'toggle' shows exactly On/Off (booleans, effect enabled). */
interface AutomationInfo {
  paramLabel: string
  paramMin: number
  paramMax: number
  kind: 'value' | 'toggle'
}

/** Trigger-lane editor context: rows are interchangeable slots (pitch is ignored
 *  by the engine), labelled rowLabel; cornerLabel states the lane's semantics. */
interface TriggerInfo {
  rowLabel: string
  cornerLabel: string
}

const INTERP_OPTIONS: { value: InterpolationMode; label: string }[] = [
  { value: 'step', label: 'Step' },
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'smooth-step', label: 'Smooth Step' },
]

const DEFAULT_QUANTIZE: number | 'smart' = 'smart'

// Minimum bars the editor timeline spans, so short projects still have room to
// work past the block. Longer projects span their full length (TimeStore.totalBars).
const INITIAL_TOTAL_BARS = 10

// Values are in beats: 1/4 note = 1 beat. The T entries are triplet grids -
// three notes in the space of the next-larger straight value (1/8T = three per
// beat = 1/3 beat), the "triplets" Tyler asked for.
const QUANTIZE_OPTIONS = [
  { value: 1, label: '1/4' },
  { value: 0.5, label: '1/8' },
  { value: 1 / 3, label: '1/8T' },
  { value: 0.25, label: '1/16' },
  { value: 1 / 6, label: '1/16T' },
  { value: 0.125, label: '1/32' },
]

/** Human label for a grid resolution in beats (1 beat = 1/4 note), for the
 *  Smart option's live readout. Falls back to beats/bars for the coarse
 *  zoomed-out grids that have no note-value name. */
function quantizeLabel(beats: number, beatsPerBar: number): string {
  const named = QUANTIZE_OPTIONS.find((o) => o.value === beats)
  if (named) return named.label
  if (beats % beatsPerBar === 0) {
    const bars = beats / beatsPerBar
    return bars === 1 ? '1 bar' : `${bars} bars`
  }
  return beats === 1 ? '1 beat' : `${beats} beats`
}

/** `frozenRef` keeps the roll rendering a block the store has already dropped.
 *  Dismissing sets `editingBlock` to null, which is the same signal that starts
 *  the roll's slide-away - without this the panel re-renders empty and what
 *  slides off screen is a black box (BottomArea in App.tsx passes the last ref
 *  for the length of the exit). */
export function PianoRollPanel({ frozenRef }: { frozenRef?: EditingBlockRef | null } = {}) {
  const storeEditingBlock = useUIStore((s) => s.editingBlock)
  const editingBlock = storeEditingBlock ?? frozenRef ?? null
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  // Subscribe to the edited track and its parent only - never the whole tracks
  // record, whose identity changes on EVERY project edit and would re-render
  // the entire piano roll per pointermove of any timeline gesture.
  const liveTrack = useProjectStore((s) => (editingBlock ? s.tracks[editingBlock.trackId] : undefined))
  const liveBlock = liveTrack?.blocks.find((b) => b.id === editingBlock?.blockId)

  // Deleting the edited block is the OTHER way the roll dismisses, and it
  // empties the panel the same way. While frozen, fall back to the last pair
  // that rendered so the slide-away still shows the roll it is closing.
  const lastGood = useRef<{ track: Track; block: Block } | null>(null)
  if (liveTrack && liveBlock) lastGood.current = { track: liveTrack, block: liveBlock }
  const frozen = storeEditingBlock == null
  const track = liveTrack ?? (frozen ? lastGood.current?.track : undefined)
  const block = liveBlock ?? (frozen ? lastGood.current?.block : undefined)

  const parent = useProjectStore((s) => (track?.parentId ? s.tracks[track.parentId] : undefined))

  // Auto-close if the block disappeared (track/block deleted). Skipped while
  // frozen: the store is already closed, and the block legitimately may not
  // exist any more (deleting a block is one of the ways the roll dismisses).
  useEffect(() => {
    if (storeEditingBlock && !liveBlock) setEditingBlock(null)
  }, [storeEditingBlock, liveBlock, setEditingBlock])

  // Esc closes (MidiEditor consumes Esc first when notes are selected)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditingBlock(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setEditingBlock])

  if (!editingBlock || !track || !block) return null

  // Value lanes edit parameter VALUES (rows labelled by value), not pitches.
  // Automation tracks target their parent. Trigger lanes (envelope gates and
  // ability lanes) ignore note PITCH entirely, so they
  // get a short set of interchangeable rows instead of the full piano.
  let automation: AutomationInfo | undefined
  let trigger: TriggerInfo | undefined
  let abilityColor: string | undefined
  // Movers/splitters declare their own labelled MIDI vocabulary (midiRows as a
  // function of settings), resolved in PianoRollContent - no lane model here.
  if (track.type === 'envelope') {
    // Envelope gates: pitch is ignored, velocity scales the envelope's peak.
    trigger = { rowLabel: 'Trigger', cornerLabel: 'Envelope · Trigger · velocity = strength' }
  } else if (track.type === 'ability') {
    // Ability lanes consume note TIMING + VELOCITY only (see Cube's shatter: it
    // reads beat/duration/velocity off abilityEvents, never pitch), so they get the
    // short trigger rows. An ability that wants real pitches must declare
    // editor: 'pitched' on its AbilityLaneDef to keep the full piano.
    const ability = parent
      ? getInstrument(parent.instrumentId)?.abilities?.find((a) => a.key === track.abilityKey)
      : undefined
    if (ability?.editor !== 'pitched') {
      const label = ability?.label ?? 'Ability'
      trigger = { rowLabel: label, cornerLabel: `${label} · Trigger · velocity = strength` }
      abilityColor = ability?.color
    }
  } else if (track.type === 'automation' && track.targetParam) {
    const fx = parseFxTarget(track.targetParam)
    if (fx) {
      // Effect automation: value range from the plugin's param. The enabled
      // pseudo-param and boolean params are toggles (two rows, On/Off).
      const inst = (parent?.effects ?? []).find((e) => e.id === fx.instanceId)
      const plugin = inst ? getEffect(inst.pluginId) : undefined
      if (fx.key === 'enabled') {
        automation = { paramLabel: `${plugin?.name ?? 'Effect'} · On/Off`, paramMin: 0, paramMax: 1, kind: 'toggle' }
      } else {
        const pd = plugin?.params.find((p) => p.key === fx.key)
        if (pd && isNumberParam(pd)) automation = { paramLabel: `${plugin?.name} · ${pd.label}`, paramMin: pd.min, paramMax: pd.max, kind: 'value' }
        else if (pd?.type === 'boolean') automation = { paramLabel: `${plugin?.name} · ${pd.label} · On/Off`, paramMin: 0, paramMax: 1, kind: 'toggle' }
      }
    } else {
      // Param automation: the range comes from the parent's instrument def
      // (plus the canonical tf* transform params), from the parent's
      // mover/splitter definition when automating a mover, or - for a
      // composition track on Main (or the legacy 'director' shape) - from its
      // composition def plus the shared Opacity. The composition arm wins over
      // the object def for a dual-surface id like crop: on Main its lanes
      // address the composition params, never tf*.
      const moverDef = parent?.type === 'mover'
        ? getMoverOrSplitterDefinition(parent.moverId)
        : parent?.type === 'splitter'
          ? getMoverOrSplitterDefinition(parent.splitterId)
          : undefined
      const mainActive = !!useProjectStore.getState().scenes[useProjectStore.getState().activeSceneId]?.isMain
      const parentComposition = parent && mainActive && isCompositionTrack(parent)
      const instrumentDef = parent && !parentComposition ? getInstrument(parent.instrumentId) : undefined
      const parentParams = instrumentDef
        ? withTransformParams(instrumentDef.params)
        : moverDef
          // Splitter lanes also target the spatial tf* params (they move the
          // splitter's copies in its own frame - resolve.ts's splitter weave).
          ? parent?.type === 'splitter' ? withSpatialTransformParams(moverDef.params) : moverDef.params
          : parentComposition
            ? compositionAutomatableParams(compositionDef(parent.instrumentId))
            : undefined
      const pdef = parentParams?.find((p) => p.key === track.targetParam)
      if (pdef && isNumberParam(pdef)) automation = { paramLabel: pdef.label, paramMin: pdef.min, paramMax: pdef.max, kind: 'value' }
      else if (pdef?.type === 'boolean') automation = { paramLabel: `${pdef.label} · On/Off`, paramMin: 0, paramMax: 1, kind: 'toggle' }
    }
  }

  return (
    <PianoRollContent
      key={block.id}
      trackId={track.id}
      trackName={track.name}
      trackColor={resolveTrackDisplayColor(track)}
      noteColor={abilityColor}
      automation={automation}
      trigger={trigger}
      block={block}
      onClose={() => setEditingBlock(null)}
    />
  )
}

interface PianoRollContentProps {
  trackId: string
  trackName: string
  trackColor: string
  /** Optional flat colour for all rows/notes instead of the per-pitch rainbow. */
  noteColor?: string
  /** Set for value-keyframe tracks - rows are value-labelled and an interp picker shows. */
  automation?: AutomationInfo
  /** Set for trigger/region lanes - a short set of interchangeable rows shows. */
  trigger?: TriggerInfo
  block: Block
  onClose: () => void
}

function PianoRollContent({ trackId, trackName, trackColor, noteColor, automation, trigger, block, onClose }: PianoRollContentProps) {
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const bpm = useProjectStore((s) => s.bpm)
  const track = useProjectStore((s) => s.tracks[trackId])
  const midiPixelsPerBeat = useUIStore((s) => s.midiPixelsPerBeat)
  const setMidiPixelsPerBeat = useUIStore((s) => s.setMidiPixelsPerBeat)
  const rowHeight = useUIStore((s) => s.midiRowHeight)
  const setMidiRowHeight = useUIStore((s) => s.setMidiRowHeight)

  const [snapEnabled, setSnapEnabled] = useState(true)
  // Toolbar toggles and sliders wear the edited track's color, matching the
  // grid chrome (midiEditorChrome) below.
  const accent = midiToolbarAccent(trackColor)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  const { notes, setNotes, commit, quantize, setQuantize } = useMidiEditorState({
    trackId,
    block,
    defaultQuantize: DEFAULT_QUANTIZE,
  })

  // 'Smart' keeps the note grid in sync with the header: quantize = half the
  // smallest subdivision the ruler currently shows at this zoom (computeRulerGrid),
  // matching playheadSnapBeats so notes and the playhead share one grid.
  const smartQuantize = computeRulerGrid(midiPixelsPerBeat, beatsPerBar, Math.max(totalBars, INITIAL_TOTAL_BARS)).smallestBeats / 2
  const effectiveQuantize = quantize === 'smart' ? smartQuantize : quantize

  const setTrackInterpolation = useProjectStore((s) => s.setTrackInterpolation)
  const interpolation = useProjectStore((s) => s.tracks[trackId]?.interpolation) ?? 'linear'
  const noise = useProjectStore((s) => s.tracks[trackId]?.noise)
  const burst = useProjectStore((s) => s.tracks[trackId]?.burst)
  const setTrackNoise = useProjectStore((s) => s.setTrackNoise)
  const setTrackBurst = useProjectStore((s) => s.setTrackBurst)
  const setAutomationMode = useProjectStore((s) => s.setAutomationMode)
  const mode = automationMode({ noise, burst })

  // In burst mode a row is not a value the lane HOLDS but the value each burst
  // travels to, and velocity is that burst's intensity - the corner says so,
  // since the value rows look identical in either mode.
  const cornerLabel = automation
    ? mode === 'burst'
      ? `${automation.paramLabel} · burst target · velocity = intensity`
      : automation.paramLabel
    : trigger?.cornerLabel ?? trackName

  // Value lanes show 13 value-labelled rows (pitch → param/input value) with the
  // target name in the frozen corner; toggle lanes show exactly On/Off; trigger
  // lanes show a short set of interchangeable rows; a Video track shows ONLY its
  // clip rows (one per uploaded clip); instruments that declare a MIDI vocabulary
  // (def.midiRows) show only those labelled rows; anything left shows the full
  // note rainbow.
  const videoTrack = !automation && track?.type === 'base' && track.instrumentId === 'video' ? track : null
  const photoTrack = !automation && track?.type === 'base' && track.instrumentId === 'photo' ? track : null
  const videoClips = useVideoStore((s) => s.videoClips)
  const photoClips = usePhotoStore((s) => s.photoClips)
  // Director rows are labelled with scene names; this string fingerprint keeps
  // them fresh without subscribing to the scenes record itself (whose identity
  // changes on every track edit anywhere).
  const sceneNamesKey = useProjectStore((s) => s.sceneOrder.map((id) => s.scenes[id]?.name).join(' '))
  // Declared rows read the wider project (mover chains, scenes) but must not
  // subscribe to it: recompute only when the edited track itself changes. A
  // sibling chain edit can in principle change a mover lane's prior copy count
  // mid-session; the next edit to THIS track catches up - acceptable staleness
  // for keeping foreign edits from re-rendering the roll.
  const declaredRows = useMemo(() => {
    if (automation || trigger || !track) return undefined
    const s = useProjectStore.getState()
    return resolveDeclaredMidiRows(track, {
      tracks: s.tracks,
      rootTrackIds: s.rootTrackIds,
      scenes: s.scenes,
      sceneOrder: s.sceneOrder,
      bpm,
      beatsPerBar,
      totalBars,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automation, trigger, track, bpm, beatsPerBar, totalBars, sceneNamesKey])
  const defRows = declaredRows?.rows
  const rows = automation
    ? automation.kind === 'toggle'
      ? generateToggleRows(notes.map((n) => n.pitch), trackColor)
      : generateValueRows(automation.paramMin, automation.paramMax, notes.map((n) => n.pitch), trackColor, undefined, track.automationRange)
    : trigger
      ? generateTriggerRows(trigger.rowLabel, midiNoteBaseColor(noteColor ?? trackColor), notes.map((n) => n.pitch))
      : videoTrack
        ? generateVideoClipRows(
            (videoTrack.videoPads ?? []).map((pad, i) => {
              const name = videoClips[pad.ref]?.fileName ?? `Clip ${i + 1}`
              return pad.inPoint > 0 ? `${name} @ ${pad.inPoint.toFixed(1)}s` : name
            }),
            VIDEO_BASE_PITCH,
            notes.map((n) => n.pitch),
            trackColor,
          )
        : photoTrack
        ? generatePhotoRows(
            (photoTrack.photoPads ?? []).map((pad, i) => photoClips[pad.ref]?.fileName ?? `Photo ${i + 1}`),
            PHOTO_BASE_PITCH,
            notes.map((n) => n.pitch),
            trackColor,
          )
        : defRows
          ? generateInstrumentRows(defRows, declaredRows.strict ? [] : notes.map((n) => n.pitch), trackColor)
          : noteColor
            ? generateRows(noteColor)
            : generateRows(trackColor)
  const blockDurationBeats = block.durationBars * beatsPerBar
  // Span the full project length so the MIDI editor scrolls to the same end as
  // the tracks view (at least INITIAL_TOTAL_BARS so short projects still have room).
  const initialTotalBeats = Math.max(totalBars, INITIAL_TOTAL_BARS) * beatsPerBar

  // On open: scroll horizontally to just before the block starts, and vertically
  // to the block's first note (the earliest by time), or C4 if the block is empty.
  useEffect(() => {
    if (hasScrolledRef.current || !containerRef.current) return
    const scrollContainer = containerRef.current.querySelector('.overflow-auto')
    if (!scrollContainer) return

    // Vertical: center on the first note's pitch (or C4 when empty).
    const firstNote = notes.length > 0
      ? notes.reduce((earliest, n) => (n.startBeat < earliest.startBeat ? n : earliest))
      : null
    const targetPitch = firstNote ? firstNote.pitch : 60
    const pitchIdx = rows.findIndex((r) => r.pitch <= targetPitch)
    const targetIdx = pitchIdx === -1 ? Math.floor(rows.length / 2) : pitchIdx
    scrollContainer.scrollTop = Math.max(0, targetIdx * rowHeight - scrollContainer.clientHeight / 2)

    // Horizontal: when the playhead sits inside this block, open centered on
    // it (you double-clicked mid-playback to edit what you're hearing);
    // otherwise place the block start a one-bar lead-in from the left edge.
    const gridLeft = useUIStore.getState().midiLabelWidth + PLAYHEAD_TRIANGLE_HALF
    const currentBeat = useTimeStore.getState().currentBeat
    const blockStartBeat = block.startBar * beatsPerBar
    const blockEndBeat = blockStartBeat + block.durationBars * beatsPerBar
    if (currentBeat >= blockStartBeat && currentBeat < blockEndBeat) {
      const playheadPx = gridLeft + currentBeat * midiPixelsPerBeat
      scrollContainer.scrollLeft = Math.max(0, playheadPx - scrollContainer.clientWidth / 2)
    } else {
      const blockStartPx = gridLeft + blockStartBeat * midiPixelsPerBeat
      const leadInPx = beatsPerBar * midiPixelsPerBeat
      scrollContainer.scrollLeft = Math.max(0, blockStartPx - leadInPx)
    }

    hasScrolledRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef} className="flex flex-col h-full border-t border-zinc-800">
      {/* Toolbar */}
      <div className="flex items-center gap-2 h-8 px-3 bg-zinc-900/60 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={onClose}
          title="Close (Esc)"
          data-midi-close=""
          className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <X size={12} />
        </button>

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          title={snapEnabled ? 'Snap to grid (on)' : 'Snap to grid (off)'}
          className={`px-2 h-5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
            snapEnabled ? '' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
          style={snapEnabled ? { background: accent.pillBg, color: accent.pillText } : undefined}
        >
          Snap
        </button>

        <ToolbarSelect
          value={quantize}
          onChange={(e) => setQuantize(e.target.value === 'smart' ? 'smart' : Number(e.target.value))}
          title="Grid resolution"
        >
          {/* The live readout shows what Smart resolves to at this zoom. */}
          <option value="smart">Smart ({quantizeLabel(smartQuantize, beatsPerBar)})</option>
          {QUANTIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </ToolbarSelect>

        {automation && (
          <>
            <div className="w-px h-4 bg-zinc-800" />
            {/* The lane's MODE, the same three the settings panel shows: value
                keyframes on a curve, seeded noise gates, or ADSR bursts. The
                mode's own controls follow it in the toolbar. */}
            <div className="flex flex-shrink-0 items-center gap-[2px] rounded bg-zinc-800/50 p-[2px]">
              {MODE_OPTIONS.map((option) => {
                const active = option.value === mode
                return (
                  <button
                    key={option.value}
                    onClick={() => setAutomationMode(trackId, option.value)}
                    title={option.title}
                    className={`flex items-center gap-1 px-1.5 h-[18px] rounded-[3px] text-[10px] font-medium transition-colors cursor-pointer ${
                      active ? '' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                    style={active ? { background: accent.pillBg, color: accent.pillText } : undefined}
                  >
                    <option.icon size={10} />
                    {option.label}
                  </button>
                )
              })}
            </div>
            {mode === 'burst' && burst ? (
              <>
                {/* Beats per stage, then how far every burst travels. The curve
                    itself is grabbable in the settings panel. */}
                <ToolbarSlider label="A" title="Attack, in beats" value={burst.attackBeats} min={0} max={4} step={0.01}
                  accent={accent.slider} onChange={(v) => setTrackBurst(trackId, { ...burst, attackBeats: v })} />
                <ToolbarSlider label="D" title="Decay, in beats" value={burst.decayBeats} min={0} max={8} step={0.01}
                  accent={accent.slider} onChange={(v) => setTrackBurst(trackId, { ...burst, decayBeats: v })} />
                <ToolbarSlider label="S" title="Sustain level while the note is held" value={burst.sustainLevel} min={0} max={1} step={0.01}
                  accent={accent.slider} onChange={(v) => setTrackBurst(trackId, { ...burst, sustainLevel: v })} />
                <ToolbarSlider label="R" title="Release, in beats after the note ends" value={burst.releaseBeats} min={0} max={8} step={0.01}
                  accent={accent.slider} onChange={(v) => setTrackBurst(trackId, { ...burst, releaseBeats: v })} />
                <ToolbarSlider label="Amt" title="Intensity: how far every burst travels" value={burst.intensity} min={0} max={1} step={0.01}
                  accent={accent.slider} onChange={(v) => setTrackBurst(trackId, { ...burst, intensity: v })} />
              </>
            ) : mode === 'noise' && noise ? (
              <>
                <ToolbarSlider label="Rate" title="Wiggles per beat" value={noise.rate} min={0.5} max={16} step={0.5}
                  accent={accent.slider} onChange={(v) => setTrackNoise(trackId, { ...noise, rate: v })} />
                <ToolbarSlider label="Smooth" title="0 = stepped chaos, 1 = smooth wandering" value={noise.smoothness} min={0} max={1} step={0.05}
                  accent={accent.slider} onChange={(v) => setTrackNoise(trackId, { ...noise, smoothness: v })} />
                <ToolbarSlider label="Range" title="Deviation around the note's value (fraction of the param range)" value={noise.range} min={0} max={1} step={0.05}
                  accent={accent.slider} onChange={(v) => setTrackNoise(trackId, { ...noise, range: v })} />
                <button
                  onClick={() => setTrackNoise(trackId, { ...noise, seed: Math.floor(Math.random() * 1e9) })}
                  title="Re-roll the noise (new random take; each take replays identically)"
                  className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                >
                  <Dices size={11} />
                </button>
              </>
            ) : (
              <>
                <span className="text-[10px] text-zinc-600" title="Interpolation between keyframes">Interp</span>
                <ToolbarSelect
                  value={interpolation}
                  onChange={(e) => setTrackInterpolation(trackId, e.target.value as InterpolationMode)}
                  title="Interpolation between value keyframes"
                >
                  {INTERP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </ToolbarSelect>
              </>
            )}
          </>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5" title="Horizontal zoom (Alt+scroll sideways)">
          <span className="text-[10px] text-zinc-600">H</span>
          <input
            type="range"
            min={5}
            max={200}
            step="any"
            value={midiPixelsPerBeat}
            onChange={(e) => setMidiPixelsPerBeat(Number(e.target.value))}
            style={sliderFill(midiPixelsPerBeat, 5, 200, accent.slider)}
            className="slider-console w-24 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-1.5" title="Vertical zoom (Alt+scroll)">
          <span className="text-[10px] text-zinc-600">V</span>
          <input
            type="range"
            min={MIDI_ROW_HEIGHT_MIN}
            max={MIDI_ROW_HEIGHT_MAX}
            step="any"
            value={rowHeight}
            onChange={(e) => setMidiRowHeight(Number(e.target.value))}
            style={sliderFill(rowHeight, MIDI_ROW_HEIGHT_MIN, MIDI_ROW_HEIGHT_MAX, accent.slider)}
            className="slider-console w-24 cursor-pointer"
          />
        </div>

      </div>

      {/* Piano roll grid */}
      <MidiEditor
        trackId={trackId}
        trackColor={trackColor}
        blockStartBeat={block.startBar * beatsPerBar}
        blockDurationBeats={blockDurationBeats}
        rows={rows}
        cornerLabel={cornerLabel}
        block={block}
        notes={notes}
        onNotesChange={setNotes}
        onCommit={commit}
        initialTotalBeats={initialTotalBeats}
        beatsPerBar={beatsPerBar}
        quantize={effectiveQuantize}
        snapEnabled={snapEnabled}
        pixelsPerBeat={midiPixelsPerBeat}
        rowHeight={rowHeight}
      />
    </div>
  )
}
