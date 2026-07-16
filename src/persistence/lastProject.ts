// Remembers the last project a user opened on this device, so the landing
// page's "Continue creating" button can jump straight back into it instead of
// detouring through /projects. Keyed by user id so a shared browser never
// routes one account at another account's project (which would just fail RLS
// into an error shell). localStorage-only: a fresh device has no entry and the
// landing page falls back to the projects list.

const KEY = 'cabin:last-project'

interface LastProject {
  userId: string
  projectId: string
}

export function rememberLastProject(userId: string, projectId: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ userId, projectId } satisfies LastProject))
  } catch {
    /* storage unavailable (private mode, quota) - the button just falls back */
  }
}

/** The remembered project id for this user, or null (other user / no entry). */
export function getLastProjectId(userId: string): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastProject>
    return parsed.userId === userId && typeof parsed.projectId === 'string'
      ? parsed.projectId
      : null
  } catch {
    return null
  }
}

/** Drop the entry if it points at this project (call when a project is deleted). */
export function forgetLastProject(projectId: string) {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    if ((JSON.parse(raw) as Partial<LastProject>).projectId === projectId) {
      localStorage.removeItem(KEY)
    }
  } catch {
    /* ignore - worst case the landing button opens a dead project once */
  }
}
