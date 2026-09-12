'use client'

import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { DRUM_NAMES, DRUM_PARTS, type DrumPart } from '../utils/drumDetection'
import { extractDrumMidi, type DrumPhase } from '../utils/extractDrumMidi'

export function DrumMidiButtons() {
  const hasSong = useProjectStore((s) => s.audioRootTrackIds.some((id) => !!s.audioTracks[id]?.audioBlocks?.length))
  const [phase, setPhase] = useState<DrumPhase | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const active = useRef<AbortController | null>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  const run = async (part: DrumPart) => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setError(false); setMessage(null); setPhase({ label: 'Preparing song…' })
    try {
      const count = await extractDrumMidi(part, (p) => { if (!controller.signal.aborted) setPhase(p) }, controller.signal)
      if (!controller.signal.aborted) setMessage(`Added ${DRUM_NAMES[part]} MIDI with ${count} editable hits.`)
    } catch (err) {
      if (!controller.signal.aborted) { setError(true); setMessage(err instanceof Error ? err.message : 'Drum extraction failed.') }
    } finally {
      if (!controller.signal.aborted) setPhase(null)
      if (active.current === controller) active.current = null
    }
  }
  return (
    <div className="mb-3" aria-label="Extract drum MIDI">
      {DRUM_PARTS.map((part) => (
        <button key={part} onClick={() => void run(part)} disabled={!hasSong || !!phase}
          className="mb-1.5 flex h-7 w-full items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-app)] text-[11px] font-medium text-[var(--text-secondary)] enabled:cursor-pointer enabled:hover:bg-[var(--bg-elevated)] disabled:opacity-50">
          Get {part === 'hihat' ? 'hi-hat' : part} MIDI
        </button>
      ))}
      {phase && <button className="text-[10px] text-[var(--text-muted)] underline" onClick={() => { active.current?.abort(); active.current = null; setPhase(null); setMessage('Cancelled. The separated audio can be reused on your next attempt.') }}>Cancel</button>}
      <p role={error ? 'alert' : 'status'} className={`mt-1 text-[9px] leading-relaxed ${error ? 'text-[#d68383]' : 'text-[var(--text-muted)]'}`}>
        {phase ? `${phase.label}${phase.progress === undefined ? '' : ` ${Math.round(phase.progress * 100)}%`}` : message ?? 'Adds a new editable track. Estimated hits may need cleanup, especially in dense mixes. Hi-hat also picks up cymbals.'}
      </p>
    </div>
  )
}
