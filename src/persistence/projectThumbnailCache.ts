import type { ProjectSummary } from './projectStorage'
interface Entry { key: string; owner: string; id: string; rev: number; image: string; at: number }
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
const keyOf = (owner: string, id: string) => `${owner}:${id}`
export function subscribeProjectThumbnails(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function withCachedThumbnail(owner: string, project: ProjectSummary): ProjectSummary {
  if (project.preview?.image) return project
  const cached = entries.get(keyOf(owner, project.id))
  return cached?.rev === project.rev ? { ...project, preview: {
    durationSeconds: project.preview?.durationSeconds ?? 0, rows: project.preview?.rows ?? [], image: cached.image,
  } } : project
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cabin-project-thumbnails', 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('images', { keyPath: 'key' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Thumbnail cache unavailable'))
  })
}
export async function restoreProjectThumbnails(owner: string) {
  try {
    const db = await database()
    try {
      const rows = await new Promise<Entry[]>((resolve, reject) => {
        const request = db.transaction('images').objectStore('images').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      for (const entry of rows) if (entry.owner === owner) entries.set(entry.key, entry)
      listeners.forEach(listener => listener())
    } finally { db.close() }
  } catch { /* Private mode/storage denial: session cache still works. */ }
}
export async function cacheProjectThumbnail(owner: string, id: string, rev: number, image: string) {
  const entry: Entry = { key: keyOf(owner, id), owner, id, rev, image, at: Date.now() }
  entries.set(entry.key, entry)
  const ordered = [...entries.values()].sort((a, b) => b.at - a.at)
  for (const old of ordered.slice(200)) entries.delete(old.key)
  listeners.forEach(listener => listener())
  try {
    const db = await database()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('images', 'readwrite'), store = tx.objectStore('images')
        store.put(entry)
        const all = store.getAll()
        all.onsuccess = () => {
          const rows = all.result as Entry[]
          rows.sort((a, b) => b.at - a.at).slice(200).forEach(row => store.delete(row.key))
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  } catch { /* Disposable cache; never fail editing over storage quota. */ }
}

const projectLists = new Map<string, ProjectSummary[]>()
const listListeners = new Set<(owner: string, list: ProjectSummary[]) => void>()
export function publishThumbnailProjects(owner: string, list: ProjectSummary[]) {
  projectLists.set(owner, list)
  listListeners.forEach(listener => listener(owner, list))
}
export function knownThumbnailProjects(owner: string) { return projectLists.get(owner) }
export function subscribeThumbnailProjects(listener: (owner: string, list: ProjectSummary[]) => void) {
  listListeners.add(listener)
  return () => { listListeners.delete(listener) }
}
