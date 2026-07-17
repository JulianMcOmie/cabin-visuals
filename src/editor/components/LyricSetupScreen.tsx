'use client'

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import Link from 'next/link'
import { Music } from 'lucide-react'
import { CabinLogo } from '../../components/CabinLogo'
import { SiteHeader } from '../../components/SiteHeader'
import { ProfileMenu } from '../../components/ProfileMenu'
import { useProjectStore } from '../store/ProjectStore'
import { useAudioStore } from '../store/AudioStore'
import { useUIStore } from '../store/UIStore'
import { getAudioUrl } from '../../persistence/audioStorage'
import { loadAudioTrack } from '../utils/loadAudioTrack'
import { placeTranscription, type TranscribedWord } from '../utils/lyricPlacement'
import { track } from '../../analytics/analytics'

/**
 * The Lyric Video template's intermediate page: shown instead of the editor,
 * dressed as a SITE page (the landing page's top bar via SiteHeader) from
 * the moment the project opens until the lyrics are in:
 *
 *   add your song  →  upload progress bar (+ BPM/downbeat auto-match via
 *   loadAudioTrack)  →  "Transcribing…"  →  "Aligning words…"  →  the editor,
 *   with the template's Lyrics track refilled with the real words.
 *
 * The editor's stores are live underneath (persistence hooks run in
 * EditorApp), so the pipeline reuses the exact upload path the timeline
 * uses - same storage, same beat detection, same trims. The page owns its
 * file drops (the editor and its drop layer aren't mounted while it shows).
 */

type Phase =
  | { kind: 'pick' }
  | { kind: 'uploading'; progress: number }
  | { kind: 'transcribing' }
  | { kind: 'aligning' }
  | { kind: 'error'; message: string }

function firstAudioBlock() {
  const s = useProjectStore.getState()
  for (const id of s.rootTrackIds) {
    const t = s.tracks[id]
    if (t?.type === 'audio' && t.audioBlocks?.length) return t.audioBlocks[0]
  }
  return undefined
}

async function postWords(endpoint: string, payload: Record<string, unknown>): Promise<{ text?: string; words: TranscribedWord[] }> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string; text?: string; words?: TranscribedWord[] }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  if (!data.words?.length) throw new Error('No words came back for the song.')
  return { text: data.text, words: data.words }
}

/** Progress bar: determinate with a value, indeterminate sweep without. */
function ProgressBar({ value }: { value?: number }) {
  return (
    <div className="relative h-1.5 w-64 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
      {value !== undefined ? (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)] transition-[width] duration-200"
          style={{ width: `${Math.round(Math.max(0.02, Math.min(1, value)) * 100)}%` }}
        />
      ) : (
        <div className="absolute inset-y-0 w-1/3 rounded-full bg-[var(--accent)] motion-safe:animate-[lyric-progress-sweep_1.2s_ease-in-out_infinite]" />
      )}
    </div>
  )
}

export function LyricSetupScreen({ onClose, projectLoading }: { onClose: () => void; projectLoading: boolean }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const runningRef = useRef(false)
  const closedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // A song landing by ANY route (this page's drop/browse, or a pre-existing
  // track) advances the pipeline.
  const hasAudio = useProjectStore((s) =>
    s.rootTrackIds.some((id) => {
      const t = s.tracks[id]
      return t?.type === 'audio' && !!t.audioBlocks?.length
    }),
  )

  // Reset on setup, not just set on cleanup: StrictMode runs
  // setup→cleanup→setup on mount, and a stuck `true` would silently swallow
  // every phase update (the "nothing happens" failure mode).
  useEffect(() => {
    closedRef.current = false
    return () => { closedRef.current = true }
  }, [])

  const run = async () => {
    if (runningRef.current) return
    runningRef.current = true
    const setLivePhase = (p: Phase) => { if (!closedRef.current) setPhase(p) }
    try {
      const block = firstAudioBlock()
      if (!block) throw new Error('The song did not land - try adding it again.')
      if (block.clipRef.startsWith('blob:')) {
        throw new Error('The song only lives in this tab so far - sign in so it uploads, then try again.')
      }

      // Ride the background upload out; transcription reads the uploaded file.
      const deadline = Date.now() + 180_000
      for (;;) {
        const up = useAudioStore.getState().uploads[block.clipRef]
        if (!up) break
        if (up.status === 'failed') throw new Error(up.error ?? 'The song upload failed.')
        if (Date.now() > deadline) throw new Error('The song upload timed out.')
        setLivePhase({ kind: 'uploading', progress: up.progress })
        await new Promise((r) => setTimeout(r, 200))
      }

      // Also wait for the local decode: it writes the detected BPM and the
      // first-beat trim, and placing words against a pre-detection snapshot
      // shifts every lyric late by the downbeat offset. Decode failure just
      // stops setting trimEnd - proceed (unsynced grid) after a short wait.
      const decodeDeadline = Date.now() + 30_000
      while (Date.now() < decodeDeadline) {
        const b = firstAudioBlock()
        if (!b || b.trimEnd > 0) break
        await new Promise((r) => setTimeout(r, 200))
      }

      const url = await getAudioUrl(block.clipRef)
      const fileName = useAudioStore.getState().audioClips[block.clipRef]?.fileName

      setLivePhase({ kind: 'transcribing' })
      const transcribed = await postWords('/api/transcribe', { url, fileName })

      setLivePhase({ kind: 'aligning' })
      // Align against the FILTERED word list, never the raw transcript - the
      // raw text can carry annotations that would come back timed as words.
      const text = transcribed.words.map((w) => w.word).join(' ')
      const aligned = await postWords('/api/align', { url, fileName, text })

      // Fresh read: the block object captured at start predates the detected
      // trimStart/bpm writes.
      const placedBlock = firstAudioBlock() ?? block
      const { bpm, beatsPerBar } = useProjectStore.getState()
      const words = placeTranscription(aligned.words, placedBlock, bpm, beatsPerBar, true)
      const id = useProjectStore.getState().addLyricTrack(words)
      if (!id) throw new Error('No usable words found in the song.')
      useUIStore.getState().setSelectedTrackId(id)
      track('lyrics_applied', { source: 'aligned', words: words.length })
      if (!closedRef.current) onClose()
    } catch (err) {
      runningRef.current = false
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  // Kick off as soon as a song exists (including one that was already there).
  // Not gated on the phase: addSong flips to 'uploading' before the track
  // lands, and runningRef already makes run() single-shot.
  useEffect(() => {
    if (hasAudio && !projectLoading) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAudio, projectLoading])

  const working = phase.kind === 'uploading' || phase.kind === 'transcribing' || phase.kind === 'aligning'

  // Files can arrive before the project document has hydrated - the pick UI
  // shows immediately (no "loading" detour), and an early song just queues
  // until the hydrate lands so it can't be wiped by it.
  //
  // The phase flips to 'uploading' SYNCHRONOUSLY here, before any async work:
  // the upload path opens with a network auth round-trip, and reacting only
  // after it left the page frozen on "Add your song" for seconds.
  const pendingFileRef = useRef<File | null>(null)
  const startSong = (file: File) => {
    void loadAudioTrack(file).catch((err) => {
      console.error('Could not load the dropped song', err)
      setPhase({ kind: 'error', message: 'Could not load that audio file - try again.' })
    })
  }
  const addSong = (file: File) => {
    setPhase({ kind: 'uploading', progress: 0 })
    if (projectLoading) pendingFileRef.current = file
    else startSong(file)
  }
  useEffect(() => {
    if (projectLoading || !pendingFileRef.current) return
    const file = pendingFileRef.current
    pendingFileRef.current = null
    startSong(file)
  }, [projectLoading])

  // Drag-over indicator, same look as the editor's drop layer. Depth counter
  // absorbs enter/leave noise from crossing child boundaries.
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const isFileDrag = (e: ReactDragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('audio/'))
    if (file) addSong(file)
  }

  return (
    <div
      className="relative flex h-screen w-screen flex-col bg-[var(--bg-page)] text-[var(--text)]"
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        dragDepthRef.current++
        setDragActive(true)
      }}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragActive(false)
      }}
      onDrop={onDrop}
    >
      <SiteHeader>
        <Link href="/projects" className="px-3 text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer">
          Projects
        </Link>
        <ProfileMenu />
      </SiteHeader>

      {dragActive && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded border border-dashed border-[var(--accent)] bg-[var(--accent)]/10">
          <span className="flex items-center gap-1.5 rounded bg-[var(--bg-panel)]/85 px-3 py-1.5 font-mono text-[11px] text-[var(--accent)]">
            <Music size={13} /> drop your song
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0 flex-col items-center justify-center px-6 text-center">
        {/* The thin card framing the whole flow. */}
        <div className="flex w-full max-w-[460px] flex-col items-center gap-7 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-8 py-10">
          <CabinLogo className={`h-24 w-auto ${working ? 'smoking' : ''}`} />

          {phase.kind === 'pick' ? (
            <>
              <div>
                <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Add your song</h1>
                <p className="mx-auto mt-2 mb-0 max-w-[380px] text-[13px] leading-relaxed text-[var(--text-3)]">
                  A lyric video will be automatically generated from your song.
                </p>
              </div>
              <div className="flex w-full flex-col items-center gap-2.5 rounded-lg border border-dashed border-[var(--border-strong)] px-6 py-10">
                <Music size={20} className="text-[var(--text-muted)]" />
                <span className="text-xs text-[var(--text-muted)]">Drop your song anywhere on this page</span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1.5 flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Browse files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) addSong(file)
                  }}
                />
              </div>
            </>
          ) : working ? (
            <div className="flex flex-col items-center gap-3">
              <p className="m-0 text-[15px] font-semibold">
                {phase.kind === 'uploading'
                  ? 'Uploading song…'
                  : phase.kind === 'transcribing'
                    ? 'Transcribing…'
                    : 'Aligning words…'}
              </p>
              <ProgressBar value={phase.kind === 'uploading' ? phase.progress : undefined} />
              <p className="m-0 text-xs text-[var(--text-muted)]">
                {phase.kind === 'uploading'
                  ? 'Syncing the beat grid to your song'
                  : phase.kind === 'transcribing'
                    ? 'Listening for the words'
                    : 'Timing every word to where it’s sung'}
              </p>
            </div>
          ) : phase.kind === 'error' ? (
            <>
              <p className="mx-auto m-0 max-w-[380px] text-[13px] leading-relaxed text-[#d68383]">{phase.message}</p>
              <button
                onClick={() => { setPhase({ kind: 'pick' }); if (firstAudioBlock()) void run() }}
                className="flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
              >
                Try again
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
