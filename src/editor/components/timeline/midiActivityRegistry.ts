import type { Block } from '../../types'
import {
  evaluateMidiActivity,
  midiActivityTriggersForBlock,
  MIDI_ACTIVITY_MAX_AGE_BEATS,
  type MidiActivityTrigger,
} from '../../core/visual/midiActivity'

// A single full-velocity note reaches roughly 33% opacity; chords build toward
// this higher ceiling. That remains translucent, but reads clearly at a glance.
const GLOW_OPACITY_SCALE = 0.65
const MAX_GLOW_OPACITY = 0.5

interface MidiActivityBlock {
  element: HTMLDivElement
  /** The matte pulse washes inside this block - one, or one per loop section. */
  pulses: HTMLElement[]
  triggers: MidiActivityTrigger[]
  /** Muted tracks are silent, so their blocks must not pulse on note hits. */
  muted: boolean
  lastOpacity: string
  notes: Array<{
    element: HTMLElement
    trigger: MidiActivityTrigger
    lastActivity: string
  }>
}

const blocks = new Map<string, MidiActivityBlock>()

// ── Compositor promotion ────────────────────────────────────────────────────
//
// The pulse is an opacity fade (see MattePulse in Block.tsx), which the
// compositor CAN animate without repainting - but only on a promoted layer,
// and only `will-change` gets us one here: an imperative per-frame style write
// is not an accelerated animation, so an unpromoted wash repaints its tiles
// every frame exactly like the filter it replaced.
//
// The hint is therefore applied for exactly as long as it buys something:
// while the transport runs, on blocks that can actually pulse. A permanent
// hint in the style prop is the other extreme - hundreds of layer textures
// held for the life of the editor and composited on every timeline scroll,
// almost all of them never animating.
//
// It is only the small wash overlays that are promoted, not the blocks
// themselves, so the layers are cheap and nothing else about the block moves.
let promoted = false
/** Last value handed to updateMidiActivityAtBeat, so a block registered
 *  mid-playback (scrolled into view, or minted by an edit) is promoted on
 *  arrival rather than waiting for the next pause/play cycle. */
let transportPlaying = false

function canPulse(block: MidiActivityBlock): boolean {
  return !block.muted && block.triggers.length > 0
}

function setBlockPromotion(block: MidiActivityBlock, on: boolean): void {
  if (!canPulse(block)) return
  for (const pulse of block.pulses) {
    if (on) pulse.style.willChange = 'opacity'
    else pulse.style.removeProperty('will-change')
  }
}

export function registerMidiActivityBlock(
  block: Block,
  beatsPerBar: number,
  element: HTMLDivElement,
  muted = false,
): () => void {
  const triggers = midiActivityTriggersForBlock(block, beatsPerBar)
  const elements = new Map<string, HTMLElement>()
  element.querySelectorAll<HTMLElement>('[data-midi-preview-key]').forEach((noteElement) => {
    const key = noteElement.dataset.midiPreviewKey
    if (key) elements.set(key, noteElement)
  })
  const registration: MidiActivityBlock = {
    element,
    pulses: [...element.querySelectorAll<HTMLElement>('[data-midi-activity-pulse]')],
    triggers,
    muted,
    lastOpacity: '0',
    notes: triggers.flatMap((trigger) => {
      const noteElement = trigger.previewKey ? elements.get(trigger.previewKey) : undefined
      if (!noteElement) return []
      noteElement.style.setProperty('--midi-note-activity', '0')
      return [{ element: noteElement, trigger, lastActivity: '0' }]
    }),
  }
  blocks.set(block.id, registration)
  element.style.setProperty('--midi-activity-opacity', '0')
  if (transportPlaying) setBlockPromotion(registration, true)

  return () => {
    if (blocks.get(block.id) === registration) blocks.delete(block.id)
    element.style.removeProperty('--midi-activity-opacity')
    setBlockPromotion(registration, false)
    for (const note of registration.notes) {
      note.element.style.removeProperty('--midi-note-activity')
    }
  }
}

// Once a paused sweep has zeroed every block, later paused frames skip the
// whole walk - the RAF calls this every frame forever, and iterating every
// note of a large project just to confirm zeros is real per-frame cost.
// Blocks registered while paused start at 0 (registerMidiActivityBlock), so
// the cleared state stays truthful without re-sweeping.
let idleCleared = false

const ZERO = (0).toFixed(4)
// One reusable single-element array for the per-note evaluation.
const singleTrigger: MidiActivityTrigger[] = [{ beat: 0, velocity: 0 }]
const SINGLE_TRIGGER = (t: MidiActivityTrigger) => { singleTrigger[0] = t; return singleTrigger }

/** Called by TimelineArea's shared playhead RAF; this never re-renders React.
 *  An inactive transport explicitly clears every block instead of leaving the
 *  envelope frozen at the stopped or scrubbed beat. */
export function updateMidiActivityAtBeat(beat: number, isPlaying: boolean): void {
  transportPlaying = isPlaying
  // Promotion follows the transport, not the individual pulse: toggling per
  // note would churn a layer up and down on every hit, and the hint only pays
  // off if it is already in place when the opacity starts moving.
  if (isPlaying !== promoted) {
    promoted = isPlaying
    for (const block of blocks.values()) setBlockPromotion(block, isPlaying)
  }
  if (!isPlaying) {
    if (idleCleared) return
    idleCleared = true
  } else {
    idleCleared = false
  }
  for (const block of blocks.values()) {
    // A muted track is silent; its blocks hold at 0 (no block glow, no per-note
    // flash) instead of pulsing along with the notes that aren't sounding.
    const live = isPlaying && !block.muted
    const activity = live ? evaluateMidiActivity(block.triggers, beat) : 0
    const opacity = Math.min(MAX_GLOW_OPACITY, activity * GLOW_OPACITY_SCALE).toFixed(4)
    if (block.lastOpacity !== opacity) {
      block.element.style.setProperty('--midi-activity-opacity', opacity)
      block.lastOpacity = opacity
    }

    for (const note of block.notes) {
      // Cheap numeric reject first: a note whose onset is in the future, or
      // older than the envelope, is exactly 0 - no array, no toFixed. Only
      // notes inside the ~1.8-beat window pay for the evaluation. (This runs
      // per NOTE per frame across the whole project while playing.)
      const age = beat - note.trigger.beat
      const inWindow = live && age >= 0 && age <= MIDI_ACTIVITY_MAX_AGE_BEATS
      const activity = inWindow ? evaluateMidiActivity(SINGLE_TRIGGER(note.trigger), beat).toFixed(4) : ZERO
      if (note.lastActivity === activity) continue
      note.element.style.setProperty('--midi-note-activity', activity)
      note.lastActivity = activity
    }
  }
}
