// Per-device editor UI preferences (localStorage - "user level" in the sense
// of surviving reloads and projects, not roaming across devices).

const PANES_KEY = 'cabin:editor-panes'

export interface PaneDefaults {
  library: boolean
  sceneEditor: boolean
}

// Stored per form factor: opening the library on a phone should stick for
// phones without dragging the desktop default along (and vice versa). The
// boundary matches useIsMobile / Tailwind md.
function formFactor(): 'mobile' | 'desktop' {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
    ? 'mobile'
    : 'desktop'
}

/** Initial open state for the collapsible panes: the user's remembered
 *  toggles, else open on desktop and collapsed on phones - a phone editor is
 *  canvas-first until the user asks for more. */
export function readPaneDefaults(): PaneDefaults {
  const fallback = formFactor() === 'desktop'
  try {
    const stored = (JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}') as Record<string, Partial<PaneDefaults>>)[formFactor()] ?? {}
    return { library: stored.library ?? fallback, sceneEditor: stored.sceneEditor ?? fallback }
  } catch {
    return { library: fallback, sceneEditor: fallback }
  }
}

export function writePaneOpen(pane: keyof PaneDefaults, open: boolean): void {
  try {
    const all = JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}') as Record<string, Partial<PaneDefaults>>
    all[formFactor()] = { ...all[formFactor()], [pane]: open }
    localStorage.setItem(PANES_KEY, JSON.stringify(all))
  } catch {
    // Private mode / storage denied - the session still works, just forgets.
  }
}
