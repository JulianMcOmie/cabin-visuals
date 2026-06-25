'use client'

import { useRef } from 'react'
import { FileAudio, X, Volume2 } from 'lucide-react'
import * as Tone from 'tone'
import { useAudioStore } from '../store/AudioStore'
import { saveAudio, removeAudio } from '../core/audioSource'
import { getPlaybackEngine } from '../core/playback'

export function AudioBar() {
  const clip = useAudioStore((s) => s.clip)
  const setClip = useAudioStore((s) => s.setClip)
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

    setClip({ ref, fileName: file.name, duration })
  }

  const handleClear = () => {
    if (clip) removeAudio(clip.ref)
    setClip(null)
    getPlaybackEngine().loadAudio(null)
  }

  return (
    <div className="h-9 flex-shrink-0 flex items-center gap-3 px-4 border-t border-zinc-800 bg-[#1e1e21] select-none">
      <span className="text-xs text-zinc-500">Audio:</span>

      {clip ? (
        <div className="flex items-center gap-1.5">
          <FileAudio size={13} className="text-zinc-400" />
          <span className="text-xs text-zinc-300">{clip.fileName}</span>
          <button
            onClick={handleClear}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <X size={12} />
          </button>
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

      {clip && (
        <div className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <Volume2 size={12} />
          <span className="text-xs">Audio loaded</span>
        </div>
      )}
    </div>
  )
}
