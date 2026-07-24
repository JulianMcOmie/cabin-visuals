// Per-device editor UI preferences (localStorage - "user level" in the sense
// of surviving reloads and projects, not roaming across devices).

// v2: v1 could write under the wrong form-factor key when the window width
// changed mid-session (DevTools device emulation), poisoning the desktop
// default to "collapsed". The bump discards any such stored state.
const PANES_KEY = 'cabin:editor-panes:v2'

export interface PaneDefaults {
  library: boolean
  sceneEditor: boolean
}

// Stored per form factor: opening the library on a phone should stick for
// phones without dragging the desktop default along (and vice versa). The
// boundary matches useIsMobile / Tailwind md.
//
// Decided ONCE per page load: reads and writes in one editor session must hit
// the same key, even if the window is resized across the boundary mid-session
// - width at write time is how v1 cross-contaminated its keys.
let cachedFactor: 'mobile' | 'desktop' | null = null
function formFactor(): 'mobile' | 'desktop' {
  if (!cachedFactor) {
    cachedFactor =
      typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
        ? 'mobile'
        : 'desktop'
  }
  return cachedFactor
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
