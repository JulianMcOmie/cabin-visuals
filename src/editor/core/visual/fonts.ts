// Self-hosted display fonts for template instruments (OFL-licensed, latin
// subsets, served from public/fonts). Loaded on demand via the FontFace API -
// never a render-blocking stylesheet - because canvas text (TextDisplay, the
// card instruments) silently falls back to the next stack entry if it draws
// before the face is ready, poisoning cached word canvases. Instrument frame
// callbacks gate on ensureFont() and return `false` (the useInstrumentFrame
// retry contract) until the face is actually usable.

interface FontFileDef {
  file: string
  style?: 'normal' | 'italic'
  /** CSS weight descriptor - a range ('400 900') for variable fonts. */
  weight?: string
}

const FONT_FILES: Record<string, FontFileDef[]> = {
  'IM Fell English SC': [{ file: 'im-fell-english-sc.woff2' }],
  'IM Fell English': [
    { file: 'im-fell-english.woff2' },
    { file: 'im-fell-english-italic.woff2', style: 'italic' },
  ],
  'Playfair Display': [{ file: 'playfair-display.woff2', weight: '400 900' }],
  // Already vendored in public/fonts since the first template pass, but never
  // wired to a font stack until the library grew to 15. All three ship a single
  // 400 weight - asking canvas for a heavier one synthesizes a fake bold, which
  // is exactly what ruins Abril's hairline serifs.
  'Bebas Neue': [{ file: 'BebasNeue-Regular.woff2' }],
  Righteous: [{ file: 'Righteous-Regular.woff2' }],
  'Abril Fatface': [{ file: 'AbrilFatface-Regular.woff2' }],
}

const loaded = new Set<string>()
const loading = new Map<string, Promise<void>>()

/** True once `family` is usable for canvas drawing. */
export function fontReady(family: string): boolean {
  return loaded.has(family)
}

/**
 * Kick off (or continue) loading `family`; returns readiness NOW. Idempotent
 * and cheap after the first call. Unknown families count as ready - they are
 * system stacks. A network failure also resolves to "ready" so callers fall
 * back to the stack's next entry instead of retrying forever.
 */
export function ensureFont(family: string): boolean {
  if (loaded.has(family)) return true
  if (typeof document === 'undefined') return false
  const files = FONT_FILES[family]
  if (!files) {
    loaded.add(family)
    return true
  }
  if (!loading.has(family)) {
    loading.set(
      family,
      Promise.all(
        files.map((f) => {
          const face = new FontFace(family, `url(/fonts/${f.file})`, {
            style: f.style ?? 'normal',
            weight: f.weight ?? '400',
          })
          document.fonts.add(face)
          return face.load()
        }),
      )
        .then(() => { loaded.add(family) })
        .catch(() => { loaded.add(family) }),
    )
  }
  return false
}
