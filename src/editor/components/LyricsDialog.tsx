'use client'

import { useEffect, useRef, useState } from 'react'
import { Captions, Loader2, X } from 'lucide-react'
import { useProjectStore, type LyricWord } from '../store/ProjectStore'
import { useAudioStore } from '../store/AudioStore'
import { useUIStore } from '../store/UIStore'
import { getAudioUrl } from '../../persistence/audioStorage'
import { track } from '../../analytics/analytics'

/**
 * The Lyrics dialog: turns words into a Text Display track (one "Next word"
 * note per word), three ways in -
 *
 *  - Align (best): pasted lyrics + the song go to /api/align (forced
 *    alignment) - the words are the user's truth, the aligner only times
 *    them, so onsets come back tight and the words are always right.
 *  - Transcribe: /api/transcribe (Whisper) guesses words AND timing from
 *    the song alone - zero effort, looser onsets.
 *  - 1/beat: no timing at all; pasted words scaffold one per beat for
 *    retiming in the track's MIDI editor.
 *
 * Timed words map through the audio block's placement (startBar + trimStart).
 *
 * Modeled on ExportDialog: owns modalOpen while up, blocks editor shortcuts,
 * Escape closes.
 */

interface TranscribedWord { word: string; start: number; end: number }

// Text Display's parser treats whitespace as the word separator and gives
// '!' and '|' grouping powers - none of which a lyric word should smuggle in.
function sanitizeWord(raw: string): string {
  return raw.replace(/[\s|!]+/g, '')
}

/** Sung seconds -> project-beat words, mapped through the audio placement.
 *  `trustEnds` decides where a word's note ends: forced alignment returns
 *  dependable end times, so aligned words end when they're sung (no lingering);
 *  Whisper's end times are noise on sung vocals, so transcription holds each
 *  word until the next one's onset instead. */
function placeTranscription(
  words: TranscribedWord[],
  audio: { startBar: number; trimStart: number },
  bpm: number,
  beatsPerBar: number,
  trustEnds: boolean,
): LyricWord[] {
  const secPerBeat = 60 / bpm
  const blockStartBeat = audio.startBar * beatsPerBar
  const placed: LyricWord[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const word = sanitizeWord(w.word)
    if (!word) continue
    const startBeat = blockStartBeat + (w.start - audio.trimStart) / secPerBeat
    if (startBeat < 0) continue // sung before the clip's in-point
    const next = words[i + 1]
    const endSec = trustEnds
      ? Math.min(w.end, next?.start ?? Infinity) // never across the next onset
      : next ? next.start : w.start + 2 * secPerBeat
    const durationBeats = Math.max(0.15, (endSec - w.start) / secPerBeat)
    placed.push({ word, startBeat, durationBeats })
  }
  return placed
}

/** Pasted lyrics -> an even one-word-per-beat scaffold from beat 0. */
function placePasted(text: string): LyricWord[] {
  return text
    .split(/\s+/)
    .map(sanitizeWord)
    .filter(Boolean)
    .map((word, i) => ({ word, startBeat: i, durationBeats: 0.9 }))
}

/** Pasted lyrics -> the text the aligner should chase: section headers like
 *  [Chorus] dropped, whitespace collapsed. The aligner times exactly the
 *  words it's given, so the text should be what's actually sung, in order. */
function normalizeLyrics(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*\[.*\]\s*$/.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function LyricsDialog({ onClose }: { onClose: () => void }) {
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState<'transcribe' | 'align' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The first audio track's first block is "the song" (the auto-created
  // track from upload; multi-clip arrangements can retime by hand).
  const audioBlock = useProjectStore((s) => {
    for (const id of s.rootTrackIds) {
      const t = s.tracks[id]
      if (t?.type === 'audio' && t.audioBlocks?.length) return t.audioBlocks[0]
    }
    return undefined
  })
  const clip = useAudioStore((s) => (audioBlock ? s.audioClips[audioBlock.clipRef] : undefined))

  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && panelRef.current?.contains(t)) return
      if (e.key === 'Escape' && !busy) { onClose(); return }
      e.stopPropagation()
      if (e.code === 'Space' || e.code === 'Enter') e.preventDefault()
    }
    window.addEventListener('keydown', block, { capture: true })
    return () => window.removeEventListener('keydown', block, { capture: true })
  }, [busy, onClose])

  useEffect(() => {
    useUIStore.getState().setModalOpen(true)
    return () => useUIStore.getState().setModalOpen(false)
  }, [])

  const apply = (words: LyricWord[], source: 'transcription' | 'aligned' | 'pasted') => {
    if (words.length === 0) { setError('No usable words found.'); return }
    const id = useProjectStore.getState().addLyricTrack(words)
    if (id) {
      useUIStore.getState().setSelectedTrackId(id)
      track('lyrics_applied', { source, words: words.length })
      onClose()
    }
  }

  /** The uploaded song's signed URL, with the human-readable failures mapped. */
  const resolveSongUrl = async (): Promise<string> => {
    if (!audioBlock) throw new Error('Add a song to the project first.')
    if (audioBlock.clipRef.startsWith('blob:')) {
      throw new Error('The song only lives in this tab so far - save the project (sign in) so it uploads first.')
    }
    return getAudioUrl(audioBlock.clipRef).catch(() => {
      throw new Error('Could not reach the uploaded song. If the upload is still running, give it a moment.')
    })
  }

  /** POST to a lyric-timing route and place its words on the timeline. */
  const timeWords = async (
    kind: 'transcribe' | 'align',
    endpoint: string,
    payload: Record<string, unknown>,
    source: 'transcription' | 'aligned',
  ) => {
    if (!audioBlock || busy) return
    setBusy(kind)
    setError(null)
    try {
      const url = await resolveSongUrl()
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, fileName: clip?.fileName, ...payload }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; words?: TranscribedWord[] }
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
      if (!data.words?.length) throw new Error('No words came back for the song.')
      const { bpm, beatsPerBar } = useProjectStore.getState()
      apply(placeTranscription(data.words, audioBlock, bpm, beatsPerBar, source === 'aligned'), source)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const transcribe = () => {
    track('lyrics_transcribe_clicked')
    void timeWords('transcribe', '/api/transcribe', {}, 'transcription')
  }

  // Forced alignment: the pasted words are the truth; the aligner only times
  // them - much tighter onsets than transcribe-and-guess, and no wrong words.
  const alignPasted = () => {
    const text = normalizeLyrics(pasted)
    if (!text) return
    track('lyrics_align_clicked')
    void timeWords('align', '/api/align', { text }, 'aligned')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div ref={panelRef} className="w-[340px] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Captions size={14} className="text-[var(--accent)]" />
            Lyrics
          </span>
          {!busy && (
            <button onClick={onClose} className="flex items-center justify-center w-5 h-5 rounded bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer">
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <button
              onClick={transcribe}
              disabled={!audioBlock || !!busy}
              title={audioBlock ? 'Transcribe the song with word timings' : 'Add a song to the project first'}
              className="flex items-center justify-center gap-2 h-8 rounded border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] disabled:opacity-50 text-[var(--text-2)] hover:text-[var(--text)] text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default"
            >
              {busy === 'transcribe' ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Listening to the song…
                </>
              ) : (
                <>Transcribe from song{clip ? '' : ' (add a song first)'}</>
              )}
            </button>
            {clip && (
              <span className="text-[11px] text-[var(--text-muted)] truncate">
                {clip.fileName} - words and timing guessed from the song
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">
            <div className="flex-1 h-px bg-[var(--border)]" />
            OR PASTE THE REAL LYRICS
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>

          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            placeholder="Paste the lyrics as sung, in order - align times each word to the song"
            className="w-full resize-none rounded bg-[var(--bg-app)] text-xs text-[var(--text)] border border-[var(--border)] focus:border-[var(--accent)] outline-none p-2 placeholder:text-[var(--text-muted)]"
            disabled={!!busy}
          />
          <div className="flex gap-2">
            <button
              onClick={alignPasted}
              disabled={!!busy || !audioBlock || pasted.trim().length === 0}
              title={audioBlock ? 'Time each pasted word to where it is sung' : 'Add a song to the project first'}
              className="flex flex-1 items-center justify-center gap-2 h-8 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] text-[var(--on-accent)] text-xs font-bold transition-colors cursor-pointer disabled:cursor-default"
            >
              {busy === 'align' ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Aligning…
                </>
              ) : (
                'Align to song'
              )}
            </button>
            <button
              onClick={() => apply(placePasted(pasted), 'pasted')}
              disabled={!!busy || pasted.trim().length === 0}
              title="Skip timing - place one word per beat to retime by hand"
              className="flex items-center justify-center h-8 px-3 rounded border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-strong)] disabled:opacity-50 text-[var(--text-2)] hover:text-[var(--text)] text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default"
            >
              1 / beat
            </button>
          </div>

          {error && (
            <p className="m-0 text-[11px] leading-relaxed text-[#d68383]">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
