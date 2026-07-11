'use client'

import { useRef } from 'react'
import { Volume2 } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { loadAudioTrack } from '../utils/loadAudioTrack'

/**
 * Entry point for project audio: loading a file registers the clip in the
 * audioClips catalog and adds an audio track (top of the track rows) with a
 * block at bar 0. A project can hold several - the button always loads
 * another, and audio files dropped onto the track area land the same way.
 */
export function AudioBar() {
  const audioTrackCount = useProjectStore(
    (s) => s.rootTrackIds.filter((id) => s.tracks[id]?.type === 'audio').length,
  )
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so re-selecting the same file still fires onChange.
    e.target.value = ''
    await loadAudioTrack(file)
  }

  return (
    <div className="h-7 flex-shrink-0 flex items-baseline gap-2.5 px-3 pt-[7px] border-t border-[var(--border)] bg-[var(--bg-panel)] select-none">
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] leading-none">AUDIO</span>

      <button
        onClick={() => inputRef.current?.click()}
        title="Load an audio file as a new track - or drag audio files straight into the tracks section"
        className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer bg-transparent border-none p-0 leading-none"
      >
        {audioTrackCount > 0 ? 'Add another audio track…' : 'Click to load audio…'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {audioTrackCount > 0 && (
        <span className="ml-auto flex items-baseline gap-1.5 text-[var(--text-muted)]">
          <Volume2 size={11} className="translate-y-[2px]" />
          <span className="text-[11px] leading-none">
            {audioTrackCount === 1 ? 'Audio on the timeline' : `${audioTrackCount} audio tracks on the timeline`}
          </span>
        </span>
      )}
    </div>
  )
}
