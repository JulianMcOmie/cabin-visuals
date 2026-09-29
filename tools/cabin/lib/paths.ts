import path from 'path'

// Where things live. The CLI runs from anywhere; everything resolves off the repo.

export const REPO = path.resolve(__dirname, '../../..')
export const PROJECTS = path.resolve(process.env.CABIN_PROJECTS_DIR ?? path.join(REPO, 'projects'))
export const CUSTOM = path.join(REPO, 'src/editor/instruments/custom')
export const DAEMON_STATE = path.join(REPO, 'tools/cabin/.daemon.json')
export const DEFAULT_DEV_URL = process.env.CABIN_DEV_URL ?? 'http://localhost:3000'

/** The URL path the dev server serves a project file under (a public-style clip ref). */
export function mediaRef(project: string, rel: string): string {
  return `/api/dev/projects/${encodeURIComponent(project)}/files/${rel.split(path.sep).map(encodeURIComponent).join('/')}`
}

/** The local file behind a media ref of THIS project (or null for other refs). */
export function refToFile(project: string, ref: string): string | null {
  const prefix = `/api/dev/projects/${encodeURIComponent(project)}/files/`
  if (!ref.startsWith(prefix)) return null
  const rel = ref.slice(prefix.length).split('/').map(decodeURIComponent).join(path.sep)
  return path.join(PROJECTS, project, rel)
}
