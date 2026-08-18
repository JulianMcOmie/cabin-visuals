import type { BufferTarget } from 'mediabunny'
import { loadMediabunny } from './loadMediabunny'
import { getVideoSource } from './videoSource'
import { loadAudioTrack } from '../../utils/loadAudioTrack'

// "Extract audio" on a Video clip: demux the source's audio track into its own
// .m4a (video discarded; the audio stream is COPIED when the container allows
// it, so this is fast and lossless for the usual mp4/AAC phone footage) and
// land it through the one audio load pipeline - a new audio track at bar 0,
// bytes uploaded for durability, duration decoded locally.
//
// matchTempo is OFF on the landing: this audio exists to line up with its
// video clip, so the grid must not re-tempo and the in-point must not trim to
// a detected downbeat - both would slide it off the footage it came from.

/** Extract `ref`'s audio into a new project audio track. Throws with a
 *  user-facing message when the video has no audio or can't be converted. */
export async function extractAudioTrack(ref: string, fileName: string): Promise<void> {
  const { Input, Output, Conversion, Mp4OutputFormat, BufferTarget, ALL_FORMATS } = await loadMediabunny()
  const input = new Input({ formats: ALL_FORMATS, source: await getVideoSource(ref) })
  try {
    const audioTrack = await input.getPrimaryAudioTrack()
    if (!audioTrack) throw new Error(`${fileName} has no audio track.`)

    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      showWarnings: false,
    })
    if (!conversion.isValid) throw new Error(`Couldn't extract audio from ${fileName} - unsupported audio codec.`)
    await conversion.execute()

    const buffer = (output.target as BufferTarget).buffer
    if (!buffer) throw new Error(`Couldn't extract audio from ${fileName}.`)
    const base = fileName.replace(/\.[^.]+$/, '')
    await loadAudioTrack(new File([buffer], `${base}.m4a`, { type: 'audio/mp4' }), { matchTempo: false })
  } finally {
    void input.dispose()
  }
}
