import * as Tone from 'tone'
import { useAudioStore } from '../store/AudioStore'
import { useProjectStore } from '../store/ProjectStore'
import { beginSaveAudio, retryAudioUpload } from '../core/audio/audioSource'
import { selectNewTrack } from './selection'

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
    const track = useProjectStore.getState().tracks[trackId]
    const blockId = track?.audioBlocks?.[0]?.id
    if (blockId) {
      useProjectStore.getState().updateAudioBlock(trackId, blockId, { trimEnd: buffer.duration })
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
