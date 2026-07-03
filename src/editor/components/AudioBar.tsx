'use client'

import { useRef } from 'react'
import { FileAudio, Volume2 } from 'lucide-react'
import * as Tone from 'tone'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { saveAudio } from '../core/audioSource'

/**
 * The one entry point for project audio: loading a file registers the clip in
 * the audioClips catalog and auto-creates the audio track (top of the track
 * rows) with a block at bar 0. One audio track for now — while one exists the
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
    useProjectStore.getState().addAudioTrack(clip)
  }

  return (
    <div className="h-9 flex-shrink-0 flex items-center gap-3 px-4 border-t border-zinc-800 bg-[#1e1e21] select-none">
      <span className="text-xs text-zinc-500">Audio:</span>

      {hasAudioTrack ? (
        <div className="flex items-center gap-1.5 opacity-60" title="One audio track for now — delete the audio track to load a different file">
          <FileAudio size={13} className="text-zinc-500" />
          <span className="text-xs text-zinc-500">{audioTrackName ?? 'Audio track'}</span>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
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
        <div className="ml-auto flex items-center gap-1.5 text-zinc-600">
          <Volume2 size={12} />
          <span className="text-xs">Audio on the timeline</span>
        </div>
      )}
    </div>
  )
}
