import 'server-only'
import { promises as fs } from 'fs'
import path from 'path'

// Dev-only: projects as plain folders on disk (`projects/<name>/project.json` +
// media), so the editor and the `cabin` CLI edit the SAME document - the CLI by
// writing the file, the editor by polling its version and PUTting its own edits
// back (src/editor/dev/useFileSync.ts). Never reachable in production: every
// route that uses this answers 404 unless NODE_ENV is development.

export const DEV_FILES_ENABLED = process.env.NODE_ENV === 'development'

export function projectsRoot(): string {
  return path.resolve(process.env.CABIN_PROJECTS_DIR ?? path.join(process.cwd(), 'projects'))
}

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function projectDir(name: string): string | null {
  if (!NAME.test(name)) return null
  return path.join(projectsRoot(), name)
}

export function projectFile(name: string): string | null {
  const dir = projectDir(name)
  return dir ? path.join(dir, 'project.json') : null
}

/** A cheap change token: mtime + size. */
export async function fileVersion(file: string): Promise<string | null> {
  try {
    const st = await fs.stat(file)
    return `${Math.round(st.mtimeMs)}-${st.size}`
  } catch {
    return null
  }
}

/** Resolve a media path inside a project, refusing anything that escapes it. */
export function projectMediaPath(name: string, parts: string[]): string | null {
  const dir = projectDir(name)
  if (!dir) return null
  const full = path.resolve(dir, ...parts)
  if (!full.startsWith(dir + path.sep)) return null
  return full
}

/** Atomic write: temp file + rename, so a reader never sees half a document. */
export async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, content)
  await fs.rename(tmp, file)
}

export async function listProjects(): Promise<Array<{ name: string; version: string | null }>> {
  const root = projectsRoot()
  let entries: string[] = []
  try {
    entries = await fs.readdir(root)
  } catch {
    return []
  }
  const out: Array<{ name: string; version: string | null }> = []
  for (const name of entries.sort()) {
    const file = projectFile(name)
    if (!file) continue
    const version = await fileVersion(file)
    if (version) out.push({ name, version })
  }
  return out
}

const MIME: Record<string, string> = {
  '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.json': 'application/json', '.mid': 'audio/midi',
}

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}
