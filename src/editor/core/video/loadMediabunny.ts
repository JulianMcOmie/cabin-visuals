/**
 * mediabunny is ~100 KB gzipped and only matters once a project actually
 * touches a video clip - so it is loaded on demand from every call site
 * instead of riding in the editor's initial bundle. Types still come from
 * `import type { ... } from 'mediabunny'` (erased at build time).
 */
export type Mediabunny = typeof import('mediabunny')

let loading: Promise<Mediabunny> | null = null

export function loadMediabunny(): Promise<Mediabunny> {
  if (!loading) loading = import('mediabunny')
  return loading
}
