'use client'

import { THEMES } from './themes'
import { useThemeSettings } from './ThemeProvider'

export function ThemePicker() {
  const { theme, selectTheme, ready, hasAccount, status } = useThemeSettings()
  return (
    <section aria-labelledby="appearance-heading" className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-7">
      <h2 id="appearance-heading" className="text-lg font-semibold text-[var(--text)]">Appearance</h2>
      <p className="mt-2 text-[13px] text-[var(--text-3)]">Choose the colors for your workspace and the rest of Cabin Visuals.</p>
      <fieldset disabled={!ready || status === 'saving'} className="mt-5">
        <legend className="mb-3 text-[13px] font-medium text-[var(--text-2)]">Color theme</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {THEMES.map(option => (
            <label key={option.id} className={`relative flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-[var(--bg-elevated)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--accent)] ${theme === option.id ? 'border-[var(--accent)] bg-[var(--bg-elevated)]' : 'border-[var(--border)]'}`}>
              <input type="radio" name="color-theme" value={option.id} checked={theme === option.id} onChange={() => selectTheme(option.id)} className="h-4 w-4 accent-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-[var(--text)]">{option.name}</span>
                <span className="block text-[11px] text-[var(--text-3)]">{option.description}</span>
              </span>
              <span aria-hidden="true" className="flex h-8 w-10 shrink-0 overflow-hidden rounded border border-[var(--border-strong)]" style={{ background: option.background }}>
                <span className="mt-2 ml-1.5 h-6 w-5 rounded-t" style={{ background: option.panel }} />
                <span className="mt-2 h-1.5 w-3 rounded" style={{ background: option.accent }} />
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p role="status" aria-live="polite" className={`mt-4 text-[12px] ${status === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-3)]'}`}>
        {!ready ? 'Loading your settings…' : status === 'saving' ? 'Saving your theme…' : status === 'error' ? 'Your theme is applied, but could not be saved to your account.' : hasAccount ? (status === 'saved' ? 'Theme saved to your account.' : 'Your theme follows your account on every device.') : 'Saved in this browser. Sign in to save a theme to your account.'}
      </p>
      {status === 'error' && <button onClick={() => selectTheme(theme)} className="mt-2 cursor-pointer text-[13px] text-[var(--accent)] underline">Retry saving</button>}
    </section>
  )
}
