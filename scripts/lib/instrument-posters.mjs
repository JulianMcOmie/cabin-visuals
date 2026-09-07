import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import sharp from 'sharp'

const run = promisify(execFile)
const output = new URL('../../public/instrument-previews/', import.meta.url)
const index = new URL('../../src/components/instrumentPreviewPosters.json', import.meta.url)

// The exact opening video frame makes the still-to-motion handoff continuous.
// Content hashes let the app cache posters indefinitely, including offline.
export async function createInstrumentPoster(id, bytes, version) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`Invalid instrument id: ${id}`)
  const temp = await mkdtemp(join(tmpdir(), 'instrument-poster-'))
  try {
    // Synth voices start at zero size on the exact note onset. Give its
    // attack a moment to open, and start playback at that same frame.
    const time = id === 'modSynth' ? 0.125 : 0
    await writeFile(join(temp, 'clip.mp4'), bytes)
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', join(temp, 'clip.mp4'),
      '-ss', String(time), '-frames:v', '1', join(temp, 'poster.png')])
    const poster = await sharp(join(temp, 'poster.png')).resize(320, 180).webp({ quality: 80 }).toBuffer()
    const hash = createHash('sha256').update(poster).digest('hex').slice(0, 12)
    const filename = `${id}-${hash}.webp`
    await mkdir(output, { recursive: true })
    await writeFile(new URL(filename, output), poster)
    const tiny = await sharp(poster).resize(80, 45).webp({ quality: 45 }).toBuffer()
    return { src: `/instrument-previews/${filename}`, version, time, placeholder: `data:image/webp;base64,${tiny.toString('base64')}` }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

export async function readInstrumentPosters() {
  try { return JSON.parse(await readFile(index, 'utf8')) } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

export async function writeInstrumentPosters(posters) {
  await writeFile(index, JSON.stringify(Object.fromEntries(Object.entries(posters).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n')
}
