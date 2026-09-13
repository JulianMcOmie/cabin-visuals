'use client'

import { useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../store/ProjectStore'
import { DRUM_NAMES, DRUM_PARTS, type DrumPart } from '../utils/drumDetection'
import { extractDrumMidi, type DrumPhase } from '../utils/extractDrumMidi'

export function DrumMidiButtons({ trackId }: { trackId: string }) {
  const hasSong = useProjectStore((s) => !!s.audioTracks[trackId]?.audioBlocks?.length)
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
      const count = await extractDrumMidi(part, (p) => { if (!controller.signal.aborted) setPhase(p) }, controller.signal, () => useProjectStore.getState().audioTracks[trackId]?.audioBlocks?.[0])
      if (!controller.signal.aborted) setMessage(`Added ${DRUM_NAMES[part]} MIDI with ${count} editable hits.`)
    } catch (err) {
      if (!controller.signal.aborted) { setError(true); setMessage(err instanceof Error ? err.message : 'Drum extraction failed.') }
    } finally {
      if (!controller.signal.aborted) setPhase(null)
      if (active.current === controller) active.current = null
    }
  }
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" aria-label="Extract drum MIDI">
      {DRUM_PARTS.map((part) => (
        <button key={part} onClick={() => void run(part)} disabled={!hasSong || !!phase}
          className="flex h-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-app)] px-2.5 text-[10px] font-medium text-[var(--text-3)] enabled:cursor-pointer enabled:hover:border-[var(--border-strong)] enabled:hover:text-[var(--text)] disabled:opacity-50">
          Get {part === 'hihat' ? 'hi-hat' : part} MIDI
        </button>
      ))}
      {phase && <button className="text-[10px] text-[var(--text-muted)] underline" onClick={() => { active.current?.abort(); active.current = null; setPhase(null); setMessage('Cancelled. The separated audio can be reused on your next attempt.') }}>Cancel</button>}
      <p role={error ? 'alert' : 'status'} className={`basis-full text-[9px] leading-relaxed ${error ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
        {phase ? `${phase.label}${phase.progress === undefined ? '' : ` ${Math.round(phase.progress * 100)}%`}` : message ?? 'Adds editable MIDI from this track’s first clip. Estimated hits may need cleanup; hi-hat also picks up cymbals.'}
      </p>
    </div>
  )
}
