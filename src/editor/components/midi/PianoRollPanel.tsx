'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Magnet } from 'lucide-react'
import { useUIStore } from '../../store/UIStore'
import { useProjectStore } from '../../store/ProjectStore'
import { useMidiEditorState } from './useMidiEditorState'
import { MidiEditor } from './MidiEditor'
import { PLAYHEAD_TRIANGLE_HALF } from '../../constants'
import { generateRows, generateValueRows, generateToggleRows, generateVideoClipRows, generatePhotoRows, generateInstrumentRows, generateTriggerRows } from './generateRows'
import { useVideoStore } from '../../store/VideoStore'
import { usePhotoStore } from '../../store/PhotoStore'
import { getInstrument } from '../../instruments'
import { VIDEO_BASE_PITCH } from '../../core/video/videoTime'
import { PHOTO_BASE_PITCH } from '../../core/photo/photoTime'
import { isNumberParam } from '../../instruments/types'
import { getMoverOrSplitterDefinition } from '../../core/visualCopies/registry'
import { getDirector } from '../../core/directors'
import { mergeDefinitionSettings } from '../../core/visualCopies/definitions'
import { getPriorVisualCopyCount } from '../../core/visual/resolve'
import { getEffect } from '../../effects'
import { parseFxTarget } from '../../effects/automation'
import type { Block, InterpolationMode } from '../../types'

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

const DEFAULT_QUANTIZE = 0.25

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

export function PianoRollPanel() {
  const editingBlock = useUIStore((s) => s.editingBlock)
  const setEditingBlock = useUIStore((s) => s.setEditingBlock)
  const tracks = useProjectStore((s) => s.tracks)

  const track = editingBlock ? tracks[editingBlock.trackId] : undefined
  const block = track?.blocks.find((b) => b.id === editingBlock?.blockId)

  // Auto-close if the block disappeared (track/block deleted)
  useEffect(() => {
    if (editingBlock && !block) setEditingBlock(null)
  }, [editingBlock, block, setEditingBlock])

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
    const parent = track.parentId ? tracks[track.parentId] : undefined
    const ability = parent
      ? getInstrument(parent.instrumentId)?.abilities?.find((a) => a.key === track.abilityKey)
      : undefined
    if (ability?.editor !== 'pitched') {
      const label = ability?.label ?? 'Ability'
      trigger = { rowLabel: label, cornerLabel: `${label} · Trigger · velocity = strength` }
      abilityColor = ability?.color
    }
  } else if (track.type === 'automation' && track.targetParam) {
    const parent = track.parentId ? tracks[track.parentId] : undefined
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
      const pdef = parent ? getInstrument(parent.instrumentId)?.params.find((p) => p.key === track.targetParam) : undefined
      if (pdef && isNumberParam(pdef)) automation = { paramLabel: pdef.label, paramMin: pdef.min, paramMax: pdef.max, kind: 'value' }
      else if (pdef?.type === 'boolean') automation = { paramLabel: `${pdef.label} · On/Off`, paramMin: 0, paramMax: 1, kind: 'toggle' }
    }
  }

  return (
    <PianoRollContent
      key={block.id}
      trackId={track.id}
      trackName={track.name}
      trackColor={track.color}
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
  const tracks = useProjectStore((s) => s.tracks)
  const rootTrackIds = useProjectStore((s) => s.rootTrackIds)
  const track = useProjectStore((s) => s.tracks[trackId])
  const midiPixelsPerBeat = useUIStore((s) => s.midiPixelsPerBeat)
  const setMidiPixelsPerBeat = useUIStore((s) => s.setMidiPixelsPerBeat)
  const midiRowScale = useUIStore((s) => s.midiRowScale)
  const setMidiRowScale = useUIStore((s) => s.setMidiRowScale)

  const [snapEnabled, setSnapEnabled] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasScrolledRef = useRef(false)

  const { notes, setNotes, commit, quantize, setQuantize } = useMidiEditorState({
    trackId,
    block,
    defaultQuantize: DEFAULT_QUANTIZE,
  })

  const setTrackInterpolation = useProjectStore((s) => s.setTrackInterpolation)
  const interpolation = useProjectStore((s) => s.tracks[trackId]?.interpolation) ?? 'linear'

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
  const rowsDef = track && (track.type === 'mover' || track.type === 'splitter')
    ? getMoverOrSplitterDefinition(track.type === 'splitter' ? track.splitterId : track.moverId)
    : undefined
  const scenes = useProjectStore((s) => s.scenes)
  const sceneOrder = useProjectStore((s) => s.sceneOrder)
  const directorRows = !automation && track?.type === 'director'
    ? getDirector(track.directorId)?.midiRows(track, scenes, sceneOrder)
    : undefined
  const defRows = !automation && track?.type === 'base'
    ? getInstrument(track.instrumentId)?.midiRows
    : !automation && !trigger && rowsDef?.midiRows && track
      ? rowsDef.midiRows(
          mergeDefinitionSettings(rowsDef, track.inputValues),
          { priorCount: getPriorVisualCopyCount(track.id, { tracks, rootTrackIds, bpm, beatsPerBar, totalBars }) },
        )
      : directorRows
  const rows = automation
    ? automation.kind === 'toggle'
      ? generateToggleRows(notes.map((n) => n.pitch))
      : generateValueRows(automation.paramMin, automation.paramMax, notes.map((n) => n.pitch))
    : trigger
      ? generateTriggerRows(trigger.rowLabel, noteColor ?? trackColor, notes.map((n) => n.pitch))
      : videoTrack
        ? generateVideoClipRows(
            (videoTrack.videoPads ?? []).map((pad, i) => {
              const name = videoClips[pad.ref]?.fileName ?? `Clip ${i + 1}`
              return pad.inPoint > 0 ? `${name} @ ${pad.inPoint.toFixed(1)}s` : name
            }),
            VIDEO_BASE_PITCH,
            notes.map((n) => n.pitch),
          )
        : photoTrack
        ? generatePhotoRows(
            (photoTrack.photoPads ?? []).map((pad, i) => photoClips[pad.ref]?.fileName ?? `Photo ${i + 1}`),
            PHOTO_BASE_PITCH,
            notes.map((n) => n.pitch),
          )
        : defRows
          ? generateInstrumentRows(defRows, rowsDef?.strictMidiRows ? [] : notes.map((n) => n.pitch))
          : noteColor
            ? generateRows(undefined).map((r) => ({ ...r, color: r.emphasized ? r.color : noteColor }))
            : generateRows(undefined)
  const rowHeight = Math.round(28 * midiRowScale)
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

    // Horizontal: place the block start a one-bar lead-in from the left edge.
    const blockStartPx =
      useUIStore.getState().midiLabelWidth + PLAYHEAD_TRIANGLE_HALF + block.startBar * beatsPerBar * midiPixelsPerBeat
    const leadInPx = beatsPerBar * midiPixelsPerBeat
    scrollContainer.scrollLeft = Math.max(0, blockStartPx - leadInPx)

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

        <div className="w-px h-4 bg-zinc-800" />

        <span className="text-xs font-medium" style={{ color: trackColor }}>
          {trackName}
        </span>
        <span className="text-xs text-zinc-600">
          Bar {block.startBar + 1} · {block.durationBars} bar{block.durationBars !== 1 ? 's' : ''}
          {block.loop && block.loopLengthBars != null && ` · loops every ${block.loopLengthBars} bar${block.loopLengthBars !== 1 ? 's' : ''}`}
          {block.loop && block.loopLengthBars == null && ' · loops'}
        </span>

        <div className="w-px h-4 bg-zinc-800" />

        <button
          onClick={() => setSnapEnabled(!snapEnabled)}
          title={snapEnabled ? 'Snap to grid (on)' : 'Snap to grid (off)'}
          className={`flex items-center gap-1 px-1.5 h-5 rounded text-[10px] font-medium transition-colors ${
            snapEnabled
              ? 'bg-indigo-600/30 text-indigo-300'
              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          <Magnet size={10} />
          Snap
        </button>

        <select
          value={quantize}
          onChange={(e) => setQuantize(Number(e.target.value))}
          title="Grid resolution"
          className="h-5 px-1 rounded bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 outline-none"
        >
          {QUANTIZE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {automation && (
          <>
            <div className="w-px h-4 bg-zinc-800" />
            <span className="text-[10px] text-zinc-600" title="Interpolation between keyframes">Interp</span>
            <select
              value={interpolation}
              onChange={(e) => setTrackInterpolation(trackId, e.target.value as InterpolationMode)}
              title="Interpolation between value keyframes"
              className="h-5 px-1 rounded bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 outline-none"
            >
              {INTERP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-1.5" title="Horizontal zoom (Alt+scroll sideways)">
          <span className="text-[10px] text-zinc-600">H</span>
          <input
            type="range"
            min={5}
            max={200}
            value={midiPixelsPerBeat}
            onChange={(e) => setMidiPixelsPerBeat(Number(e.target.value))}
            className="slider-square w-14 cursor-pointer"
          />
        </div>
        <div className="flex items-center gap-1.5" title="Vertical zoom (Alt+scroll)">
          <span className="text-[10px] text-zinc-600">V</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={midiRowScale}
            onChange={(e) => setMidiRowScale(Number(e.target.value))}
            className="slider-square w-14 cursor-pointer"
          />
        </div>

      </div>

      {/* Piano roll grid */}
      <MidiEditor
        trackId={trackId}
        blockStartBeat={block.startBar * beatsPerBar}
        blockDurationBeats={blockDurationBeats}
        rows={rows}
        cornerLabel={automation?.paramLabel ?? trigger?.cornerLabel}
        block={block}
        notes={notes}
        onNotesChange={setNotes}
        onCommit={commit}
        initialTotalBeats={initialTotalBeats}
        beatsPerBar={beatsPerBar}
        quantize={quantize}
        snapEnabled={snapEnabled}
        pixelsPerBeat={midiPixelsPerBeat}
        rowHeight={rowHeight}
      />
    </div>
  )
}
