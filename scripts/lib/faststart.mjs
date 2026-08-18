// Rewrite an MP4 with `moov` at the front (streaming/fast-start) via ffmpeg,
// so a <video> can show frame 1 after ONE request instead of the 2-3 range
// round-trips a moov-last file costs. Container-only (`-c copy`). Returns the
// input bytes unchanged when ffmpeg isn't available, with a warning.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let warned = false
export function faststart(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'faststart-'))
  try {
    const inp = join(dir, 'in.mp4'), out = join(dir, 'out.mp4')
    writeFileSync(inp, bytes)
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', inp, '-c', 'copy', '-movflags', '+faststart', out], { stdio: 'ignore' })
    return readFileSync(out)
  } catch {
    if (!warned) { warned = true; console.log('(ffmpeg not found - uploading clips without fast-start; browsers will need extra range requests before first frame)') }
    return bytes
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
