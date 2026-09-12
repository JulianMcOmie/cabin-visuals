'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAuth } from '../persistence/hooks/useAuth'
import { DEFAULT_THEME, isThemeId, settingsCacheKey, themeFromMetadata, type ThemeId } from './themes'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
interface ThemeSettings {
  theme: ThemeId
  ready: boolean
  hasAccount: boolean
  status: SaveState
  selectTheme: (theme: ThemeId) => void
}
const ThemeContext = createContext<ThemeSettings | null>(null)
function cacheTheme(userId: string | null, theme: ThemeId) {
  try { localStorage.setItem(settingsCacheKey(userId), theme) } catch { /* private browsing / quota */ }
}
function guestTheme(): ThemeId {
  try {
    const value = localStorage.getItem(settingsCacheKey(null))
    if (isThemeId(value)) return value
  } catch { /* storage unavailable */ }
  return DEFAULT_THEME
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user, loading, isAnonymous } = useAuth()
  const userId = user && !isAnonymous ? user.id : null
  const remoteTheme = themeFromMetadata(user?.user_metadata)
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME)
  const [status, setStatus] = useState<SaveState>('idle')
  const identity = useRef(userId)
  const revision = useRef(0)
  const saving = useRef(false)
  // Update during render so an old request cannot paint even before effects run.
  identity.current = userId

  useLayoutEffect(() => {
    if (loading) return
    revision.current++
    saving.current = false
    setStatus('idle')
    setTheme(userId ? remoteTheme : guestTheme())
  }, [userId, loading, remoteTheme])

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',
      getComputedStyle(document.documentElement).getPropertyValue('--bg-page').trim())
  }, [theme])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (!saving.current && event.key === settingsCacheKey(userId) && isThemeId(event.newValue)) {
        setTheme(event.newValue)
        setStatus('idle')
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [userId])

  const selectTheme = useCallback((next: ThemeId) => {
    if (loading || saving.current || !isThemeId(next)) return
    const owner = userId
    const requestRevision = ++revision.current
    setTheme(next)
    if (!owner) {
      cacheTheme(null, next)
      setStatus('saved')
      return
    }
    saving.current = true
    setStatus('saving')
    void (async () => {
      try {
        const response = await fetch('/api/settings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: owner, theme: next }),
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) throw new Error('Theme save failed')
        if (identity.current !== owner || revision.current !== requestRevision) return
        cacheTheme(owner, next)
        setStatus('saved')
      } catch {
        if (identity.current === owner && revision.current === requestRevision) setStatus('error')
      } finally {
        if (identity.current === owner && revision.current === requestRevision) saving.current = false
      }
    })()
  }, [loading, userId])

  return <ThemeContext.Provider value={{ theme, ready: !loading, hasAccount: !!userId, status, selectTheme }}>{children}</ThemeContext.Provider>
}
export function useThemeSettings() {
  const settings = useContext(ThemeContext)
  if (!settings) throw new Error('Theme settings require ThemeProvider')
  return settings
}
