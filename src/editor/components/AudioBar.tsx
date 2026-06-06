'use client'

import { useState, useRef } from 'react'
import { FileAudio, X, Volume2 } from 'lucide-react'

export function AudioBar() {
  const [audioFile, setAudioFile] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setAudioFile(file.name)
  }

  return (
    <div className="h-9 flex-shrink-0 flex items-center gap-3 px-4 border-t border-zinc-800 bg-zinc-950 select-none">
      <span className="text-xs text-zinc-500">Audio:</span>

      {audioFile ? (
        <div className="flex items-center gap-1.5">
          <FileAudio size={13} className="text-zinc-400" />
          <span className="text-xs text-zinc-300">{audioFile}</span>
          <button
            onClick={() => setAudioFile(null)}
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

      {audioFile && (
        <div className="ml-auto flex items-center gap-1.5 text-zinc-500">
          <Volume2 size={12} />
          <span className="text-xs">Audio loaded</span>
        </div>
      )}
    </div>
  )
}
