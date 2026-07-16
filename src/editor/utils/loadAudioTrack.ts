import * as Tone from 'tone'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { beginSaveAudio, retryAudioUpload } from '../core/audio/audioSource'
import { detectBeats } from '../core/audio/beatDetect'
import { selectNewTrack } from './selection'

// Below this the song has no dependable pulse (ambient, rubato) - leave the
// project's tempo and the clip's start alone rather than guess.
const BEAT_CONFIDENCE_MIN = 0.2

/**
 * The one load pipeline for project audio: the track (and its block at bar 0)
 * lands IMMEDIATELY against a freshly-minted ref backed by the local bytes.
 * Two things then trail behind it, reported through the AudioStore:
 *  - the local decode fills in the clip's real duration (until it lands the
 *    block renders as a loading placeholder - duration 0 is the signal), and
 *  - the upload runs as pure durability, progress shown on the block.
 * The AudioBar button and files dropped onto the track area both come here.
 */
export async function loadAudioTrack(file: File): Promise<void> {
  const audio = useAudioStore.getState()
  let refBox: string | null = null
  const { ref, completion } = await beginSaveAudio(file, (progress) => {
    if (refBox) useAudioStore.getState().patchUpload(refBox, { progress })
  })
  refBox = ref

  // Land the track now - the duration is unknown until the decode below finishes.
  const clip = { ref, fileName: file.name, duration: 0 }
  audio.addClip(clip)
  // A new instrument becomes the selection; blocks deselect.
  const trackId = useProjectStore.getState().addAudioTrack(clip)
  selectNewTrack(trackId)

  audio.patchUpload(ref, { progress: 0, status: 'saving', error: null })
  void completion.then(
    () => useAudioStore.getState().patchUpload(ref, null), // durable
    (err) => {
      const message = err instanceof Error ? err.message : 'Upload failed'
      console.error('Audio upload failed:', message, err)
      useAudioStore.getState().patchUpload(ref, { status: 'failed', error: message })
    },
  )

  // Decode locally for the real duration; the block snaps to size when it lands.
  try {
    const ctx = Tone.getContext().rawContext as AudioContext
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    useAudioStore.getState().addClip({ ...clip, duration: buffer.duration })

    // Match the project to the song: detect tempo + where the first beat
    // lands, set the BPM, and trim the clip's in-point to that first beat so
    // beat 0 of the grid IS the song's downbeat - no manual trimming. Low
    // confidence (no steady pulse) leaves everything untouched. Note the
    // store keeps integer BPM; genuinely fractional live tempos will drift.
    const beats = detectBeats(buffer)
    const confident = beats !== null && beats.confidence >= BEAT_CONFIDENCE_MIN
    if (confident) useProjectStore.getState().setBpm(beats.bpm)

    const track = useProjectStore.getState().tracks[trackId]
    const blockId = track?.audioBlocks?.[0]?.id
    if (blockId) {
      useProjectStore.getState().updateAudioBlock(trackId, blockId, {
        trimEnd: buffer.duration,
        // Sub-20ms offsets are inside the detector's own resolution - skip.
        ...(confident && beats.firstBeatSec > 0.02 ? { trimStart: beats.firstBeatSec } : {}),
      })
    }
  } catch (err) {
    console.warn('Could not decode audio for duration', err)
  }
}

/** Re-run a failed upload (the block's "!" badge). */
export function retryAudioTrackUpload(ref: string): void {
  useAudioStore.getState().patchUpload(ref, { status: 'saving', progress: 0, error: null })
  void retryAudioUpload(ref, (progress) => useAudioStore.getState().patchUpload(ref, { progress })).then(
    () => useAudioStore.getState().patchUpload(ref, null),
    (err) => {
      const message = err instanceof Error ? err.message : 'Upload failed'
      console.error('Audio upload retry failed:', message, err)
      useAudioStore.getState().patchUpload(ref, { status: 'failed', error: message })
    },
  )
}
