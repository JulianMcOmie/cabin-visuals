import type { Block } from '../../types'
import {
  evaluateMidiActivity,
  midiActivityTriggersForBlock,
  type MidiActivityTrigger,
} from '../../core/visual/midiActivity'

// A single full-velocity note reaches roughly 33% opacity; chords build toward
// this higher ceiling. That remains translucent, but reads clearly at a glance.
const GLOW_OPACITY_SCALE = 0.65
const MAX_GLOW_OPACITY = 0.5

interface MidiActivityBlock {
  element: HTMLDivElement
  triggers: MidiActivityTrigger[]
  lastOpacity: string
  notes: Array<{
    element: HTMLElement
    trigger: MidiActivityTrigger
    lastActivity: string
  }>
}

const blocks = new Map<string, MidiActivityBlock>()

export function registerMidiActivityBlock(
  block: Block,
  beatsPerBar: number,
  element: HTMLDivElement,
): () => void {
  const triggers = midiActivityTriggersForBlock(block, beatsPerBar)
  const elements = new Map<string, HTMLElement>()
  element.querySelectorAll<HTMLElement>('[data-midi-preview-key]').forEach((noteElement) => {
    const key = noteElement.dataset.midiPreviewKey
    if (key) elements.set(key, noteElement)
  })
  const registration = {
    element,
    triggers,
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

  return () => {
    if (blocks.get(block.id) === registration) blocks.delete(block.id)
    element.style.removeProperty('--midi-activity-opacity')
    for (const note of registration.notes) {
      note.element.style.removeProperty('--midi-note-activity')
    }
  }
}

/** Called by TimelineArea's shared playhead RAF; this never re-renders React.
 *  An inactive transport explicitly clears every block instead of leaving the
 *  envelope frozen at the stopped or scrubbed beat. */
export function updateMidiActivityAtBeat(beat: number, isPlaying: boolean): void {
  for (const block of blocks.values()) {
    const activity = isPlaying ? evaluateMidiActivity(block.triggers, beat) : 0
    const opacity = Math.min(MAX_GLOW_OPACITY, activity * GLOW_OPACITY_SCALE).toFixed(4)
    if (block.lastOpacity !== opacity) {
      block.element.style.setProperty('--midi-activity-opacity', opacity)
      block.lastOpacity = opacity
    }

    for (const note of block.notes) {
      const activity = evaluateMidiActivity([note.trigger], beat).toFixed(4)
      if (note.lastActivity === activity) continue
      note.element.style.setProperty('--midi-note-activity', activity)
      note.lastActivity = activity
    }
  }
}
