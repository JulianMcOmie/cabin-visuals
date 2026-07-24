import { getAudioUrl } from '../../persistence/audioStorage'
import { isUploadedRef } from '../core/audio/audioSource'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import type { AudioBlock } from '../types'
import type { TranscribedWord } from './lyricPlacement'

/**
 * The song → timed words pipeline, shared by the Lyric Video setup screen and
 * the Text Display panel's Transcribe button: ride out the upload, wait for
 * the local decode (it writes the detected BPM and first-beat trim), then
 * transcribe and force-align through the API routes.
 *
 * Every thrown message here is shown to the user verbatim, so they are written
 * as sentences, not diagnostics.
 */

export type TranscribePhase =
  | { kind: 'uploading'; progress: number }
  | { kind: 'transcribing' }
  | { kind: 'aligning' }

/** The project's song: the first audio block on the first audio track. */
export function firstAudioBlock(): AudioBlock | undefined {
  const s = useProjectStore.getState()
  for (const id of s.rootTrackIds) {
    const t = s.tracks[id]
    if (t?.type === 'audio' && t.audioBlocks?.length) return t.audioBlocks[0]
  }
  return undefined
}

async function postWords(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<{ text?: string; words: TranscribedWord[] }> {
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

/**
 * Transcribe the project's song into sung-seconds words. Reports progress
 * through `onPhase`; throws with a user-facing message on every failure.
 * Callers place the words on the timeline (placeTranscription + addLyricTrack).
 */
export async function transcribeActiveSong(
  onPhase: (phase: TranscribePhase) => void = () => {},
): Promise<TranscribedWord[]> {
  const block = firstAudioBlock()
  if (!block) throw new Error('There is no song in this project yet - add one to the timeline first.')
  // Transcription reads the song from the bucket, so bytes that never left the
  // tab (an unsaved project) can't be transcribed - say that, rather than
  // letting the signed-URL call fail with storage's own "Object not found".
  if (!isUploadedRef(block.clipRef)) {
    throw new Error('The song only lives in this tab so far - sign in and save the project so it uploads, then try again.')
  }

  // Ride the background upload out; transcription reads the uploaded file.
  const deadline = Date.now() + 180_000
  for (;;) {
    const up = useAudioStore.getState().uploads[block.clipRef]
    if (!up) break
    if (up.status === 'failed') throw new Error(up.error ?? 'The song upload failed.')
    if (Date.now() > deadline) throw new Error('The song upload timed out.')
    onPhase({ kind: 'uploading', progress: up.progress })
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

  onPhase({ kind: 'transcribing' })
  const transcribed = await postWords('/api/transcribe', { url, fileName })

  onPhase({ kind: 'aligning' })
  // Align against the FILTERED word list, never the raw transcript - the raw
  // text can carry annotations that would come back timed as words.
  const text = transcribed.words.map((w) => w.word).join(' ')
  const aligned = await postWords('/api/align', { url, fileName, text })
  return aligned.words
}
