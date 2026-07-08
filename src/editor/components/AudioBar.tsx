'use client'

import { useRef } from 'react'
import { FileAudio, Volume2 } from 'lucide-react'
import * as Tone from 'tone'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { saveAudio } from '../core/audio/audioSource'
import { selectNewTrack } from '../utils/selection'

/**
 * The one entry point for project audio: loading a file registers the clip in
 * the audioClips catalog and auto-creates the audio track (top of the track
 * rows) with a block at bar 0. One audio track for now - while one exists the
 * bar is inert; deleting the track re-enables it.
 */
export function AudioBar() {
  const hasAudioTrack = useProjectStore((s) =>
    s.rootTrackIds.some((id) => s.tracks[id]?.type === 'audio'),
  )
  const audioTrackName = useProjectStore((s) => {
    const id = s.rootTrackIds.find((tid) => s.tracks[tid]?.type === 'audio')
    return id ? s.tracks[id]?.name : undefined
  })
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset the input so re-selecting the same file still fires onChange.
    e.target.value = ''

    const ref = await saveAudio(file)

    // Decode once to read the duration for the descriptor (best-effort).
    let duration = 0
    try {
      const ctx = Tone.getContext().rawContext as AudioContext
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
      duration = buffer.duration
    } catch (err) {
      console.warn('Could not decode audio for duration', err)
    }

    const clip = { ref, fileName: file.name, duration }
    useAudioStore.getState().addClip(clip)
    // A new instrument becomes the selection; blocks deselect.
    selectNewTrack(useProjectStore.getState().addAudioTrack(clip))
  }

  return (
    <div className="h-7 flex-shrink-0 flex items-baseline gap-2.5 px-3 pt-[7px] border-t border-[var(--border)] bg-[var(--bg-panel)] select-none">
      <span className="text-[10px] font-semibold tracking-[0.06em] text-[var(--text-muted)] leading-none">AUDIO</span>

      {hasAudioTrack ? (
        <span className="flex items-baseline gap-1.5 opacity-70" title="One audio track for now - delete the audio track to load a different file">
          <FileAudio size={11} className="text-[var(--text-muted)] translate-y-[2px]" />
          <span className="text-[11px] text-[var(--text-3)] leading-none">{audioTrackName ?? 'Audio track'}</span>
        </span>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] transition-colors cursor-pointer bg-transparent border-none p-0 leading-none"
        >
          Click to load audio…
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {hasAudioTrack && (
        <span className="ml-auto flex items-baseline gap-1.5 text-[var(--text-muted)]">
          <Volume2 size={11} className="translate-y-[2px]" />
          <span className="text-[11px] leading-none">Audio on the timeline</span>
        </span>
      )}
    </div>
  )
}
