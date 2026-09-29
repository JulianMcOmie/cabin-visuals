import { unzipSync } from 'fflate'

export const MAX_SONG_BYTES = 100 * 1024 * 1024
const MAX_ZIP_BYTES = 160 * 1024 * 1024
const MAX_STEM_BYTES = 20 * 1024 * 1024

/** Immutable uploaded clip refs are UUID paths; never accept arbitrary URLs. */
export function ownsAudioRef(ref: unknown, userId: string): ref is string {
  return typeof ref === 'string' && ref.startsWith(`${userId}/`) &&
    ref.split('/').length === 3 && ref.split('/').every((p) => /^[\w-]+$/.test(p))
}

export async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('The audio response is too large.')
  if (!response.body) throw new Error('The audio response was empty.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) throw new Error('The audio response is too large.')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  const result = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

export function drumFromZip(zip: Uint8Array): Uint8Array {
  // Only inflate the drum file, never the other five potentially large stems.
  const files = unzipSync(zip, { filter: (file) => {
    const isDrum = /(?:^|[\/ _-])drums?(?:[ _-][^/]*)?\.mp3$/i.test(file.name)
    if (isDrum && file.originalSize > MAX_STEM_BYTES) throw new Error('The drum stem is too large.')
    return isDrum
  } })
  const stems = Object.values(files)
  if (stems.length !== 1 || !stems[0].length) throw new Error('The separator did not return a usable drum stem.')
  return stems[0]
}

export async function separateDrums(audio: Blob, apiKey: string, signal: AbortSignal): Promise<Uint8Array> {
  const form = new FormData()
  form.append('file', audio, 'song')
  form.append('stem_variation_id', 'six_stems_v1')
  const response = await fetch('https://api.elevenlabs.io/v1/music/stem-separation?output_format=mp3_44100_128', {
    method: 'POST', headers: { 'xi-api-key': apiKey }, body: form, signal,
  })
  if (!response.ok) {
    if (response.status === 429) throw new Error('Drum separation is busy or out of credits. Try again later.')
    throw new Error(`Drum separation failed (${response.status}). Please try again later.`)
  }
  return drumFromZip(await readLimited(response, MAX_ZIP_BYTES))
}
