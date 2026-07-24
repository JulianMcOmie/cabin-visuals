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
import { LYRIC_STYLES } from '../../templates'
import { TemplateLyricPreview } from '../../components/TemplateLyricPreview'

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
  // The words are in and timed. The style grid is ALREADY on screen by now -
  // it appears the moment the song lands, so the transcription wait doubles as
  // browsing time - this phase just marks that a pick can apply immediately.
  | { kind: 'ready' }
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
function ProgressBar({ value, className = 'w-64' }: { value?: number; className?: string }) {
  return (
    <div className={`relative h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)] ${className}`}>
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

export function LyricSetupScreen({
  onClose,
  projectLoading,
  preStyled = false,
}: {
  onClose: () => void
  projectLoading: boolean
  /** Mobile flow: the project was CREATED on the chosen style (style picked
   *  before the song), so no style grid and no apply-at-the-end - the screen
   *  is just song-in → pipeline → editor. */
  preStyled?: boolean
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  /** The style the user just clicked, held so the card can show it landed. */
  const [chosen, setChosen] = useState<string | null>(null)
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
      // The aligner's seconds ride along as the track's source of truth, so
      // a later BPM correction re-derives the beats instead of moving words.
      const id = useProjectStore.getState().addLyricTrack(words, aligned.words)
      if (!id) throw new Error('No usable words found in the song.')
      useUIStore.getState().setSelectedTrackId(id)
      track('lyrics_applied', { source: 'aligned', words: words.length })
      // The words survive whichever style is chosen - applyTemplate carries a
      // 'Lyrics' track across - so a style picked during the wait applies now
      // (the effect below fires on this transition).
      setLivePhase({ kind: 'ready' })
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
  }, [hasAudio, projectLoading])

  const working = phase.kind === 'uploading' || phase.kind === 'transcribing' || phase.kind === 'aligning'
  // The style grid is on screen from the moment a song lands: the wait IS the
  // browsing time. Deliberately no skip-out while working - the pipeline needs
  // to finish for the project to make sense. Pre-styled projects never show
  // the grid: their wait renders in the card below instead.
  const onGrid = !preStyled && (working || phase.kind === 'ready')

  /** A quiet secondary action, visually subordinate to the main one. */
  const EscapeButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
      onClick={onClick}
      className="mt-5 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] cursor-pointer"
    >
      {label}
    </button>
  )

  /** A pick just records itself; applying waits for the words. While the
   *  pipeline is still running the pick is freely CHANGEABLE - clicking
   *  another card simply moves the selection. It only locks once applying
   *  actually starts (words in + a pick standing). */
  const applying = !!chosen && phase.kind === 'ready'
  const chooseStyle = (id: string) => {
    if (applying || appliedRef.current) return
    setChosen(id)
  }

  /** Apply the chosen look and hand off to the editor, once BOTH are true:
   *  a style is picked and the words are in. Picking early just queues - the
   *  card shows "Waiting for the words…" until the pipeline lands.
   *
   *  The project is already on the bare template, so "Minimal" is a no-op
   *  choice. Applying is not instant (clone + re-mint + autosave before the
   *  editor re-hydrates), so the pick is acknowledged by the render first and
   *  the work happens in this post-paint effect - without that the card
   *  absorbed the click silently and the screen sat there looking broken.
   *  appliedRef guards the StrictMode double-fire. */
  const appliedRef = useRef(false)
  useEffect(() => {
    if (!chosen || phase.kind !== 'ready' || appliedRef.current) return
    appliedRef.current = true
    const style = LYRIC_STYLES.find((s) => s.id === chosen)
    if (style) {
      useProjectStore.getState().applyTemplate(style.document)
      track('lyric_style_chosen', { style: chosen })
    }
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, phase.kind])

  // Pre-styled: the project already wears its look, so words-in IS done.
  useEffect(() => {
    if (!preStyled || phase.kind !== 'ready' || appliedRef.current) return
    appliedRef.current = true
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preStyled, phase.kind])

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

      {/* The style step needs room for a row of previews, so it breaks out of
          the narrow card the rest of the flow lives in. It is on screen from
          the moment the song lands: picking a look is what the transcription
          wait is FOR. */}
      {onGrid ? (
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
          <div className="w-full max-w-[760px]">
            <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">Pick a look</h1>
            <p className="mx-auto mt-2 mb-5 max-w-[440px] text-[13px] leading-relaxed text-[var(--text-3)]">
              {phase.kind === 'ready'
                ? 'Your words are timed to the song. Choose a style - you can change it any time.'
                : 'Choose a style while your song is transcribed - you can change it any time.'}
            </p>
            {/* The pipeline's live status, riding above the grid: the same
                progress language the old wait card used, compacted. */}
            <div className="mx-auto mb-7 flex h-10 flex-col items-center justify-center gap-2">
              {phase.kind === 'ready' ? (
                <p className="m-0 text-xs font-semibold text-[var(--accent)]">✓ Words timed to the song</p>
              ) : (
                <>
                  <ProgressBar value={phase.kind === 'uploading' ? phase.progress : undefined} />
                  <p className="m-0 text-xs text-[var(--text-muted)]">
                    {phase.kind === 'uploading'
                      ? 'Uploading song - syncing the beat grid'
                      : phase.kind === 'transcribing'
                        ? 'Transcribing - listening for the words'
                        : 'Aligning - timing every word to where it’s sung'}
                  </p>
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              {LYRIC_STYLES.map((style) => {
                const picked = chosen === style.id
                return (
                  <button
                    key={style.id}
                    onClick={() => chooseStyle(style.id)}
                    disabled={applying}
                    aria-busy={picked}
                    title={style.description}
                    className={`group overflow-hidden rounded-lg border bg-[var(--bg-app)] text-left transition-all duration-150 ${
                      picked
                        // The click landed: this card lifts and takes the accent.
                        // While the words are still coming the others stay live
                        // (clicking one moves the pick); once applying starts
                        // they step back and the grid is inert.
                        ? `scale-[1.03] border-[var(--accent)] ring-2 ring-[var(--accent)] ${applying ? 'cursor-default' : 'cursor-pointer'}`
                        : applying
                          ? 'border-[var(--border)] opacity-40 cursor-default'
                          : 'cursor-pointer border-[var(--border)] hover:border-[var(--accent)]'
                    }`}
                  >
                    <div className="relative aspect-video bg-[var(--bg-app)]">
                      <TemplateLyricPreview templateId={style.id} />
                    </div>
                    <div className="p-3">
                      <h3 className="m-0 text-[13px] font-semibold text-[var(--text)] group-hover:text-white">
                        {style.styleName ?? style.name}
                      </h3>
                      {picked ? (
                        <div className="mt-2 flex flex-col gap-1.5">
                          {/* Picked mid-pipeline: the choice is queued and applies
                              itself the moment the words land. */}
                          <span className="text-xs font-semibold text-[var(--accent)]">
                            {phase.kind === 'ready' ? 'Applying…' : 'Waiting for the words…'}
                          </span>
                          <ProgressBar className="w-full" />
                        </div>
                      ) : (
                        <p className="mt-1 mb-0 text-xs leading-snug text-[var(--text-muted)]">{style.description}</p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-4 text-center sm:px-6">
        {/* The thin card framing the pick and error steps - the working phases
            live on the style grid now, not in here (except pre-styled runs,
            whose whole wait renders in this card). */}
        <div className="flex w-full max-w-[460px] flex-col items-center gap-7 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] px-5 py-8 sm:px-8 sm:py-10">
          <CabinLogo className="h-16 w-auto sm:h-24" />

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
              <Link
                href="/projects"
                className="text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] cursor-pointer"
              >
                ← Back to projects
              </Link>
            </>
          ) : phase.kind === 'error' ? (
            <>
              <p className="mx-auto m-0 max-w-[380px] text-[13px] leading-relaxed text-[#d68383]">{phase.message}</p>
              <button
                onClick={() => { setPhase({ kind: 'pick' }); if (firstAudioBlock()) void run() }}
                className="flex h-9 items-center justify-center rounded bg-[var(--accent)] px-5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
              >
                Try again
              </button>
              <EscapeButton label="Open the editor anyway" onClick={onClose} />
            </>
          ) : (
            // Pre-styled pipeline wait: same status language the grid shows,
            // in the card - the style is already on, nothing to browse.
            <>
              <div>
                <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">
                  {phase.kind === 'ready' ? 'Opening the editor…' : 'Making your lyric video'}
                </h1>
                <p className="mx-auto mt-2 mb-0 max-w-[380px] text-[13px] leading-relaxed text-[var(--text-3)]">
                  {phase.kind === 'uploading'
                    ? 'Uploading song - syncing the beat grid'
                    : phase.kind === 'transcribing'
                      ? 'Transcribing - listening for the words'
                      : phase.kind === 'aligning'
                        ? 'Aligning - timing every word to where it’s sung'
                        : 'Words timed to the song.'}
                </p>
              </div>
              <ProgressBar
                value={phase.kind === 'uploading' ? phase.progress : undefined}
                className="w-full max-w-[280px]"
              />
            </>
          )}
        </div>
      </div>
      )}
    </div>
  )
}
