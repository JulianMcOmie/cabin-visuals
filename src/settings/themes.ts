/** Interface palettes only: project, instrument, clip and rendered pixels never use these. */
export const THEMES = [
  { id: 'midnight', name: 'Midnight', description: 'Blue black · ice blue', background: '#0c0d12', panel: '#10131c', accent: '#45c6ff' },
  { id: 'forest', name: 'Forest', description: 'Deep pine · mint', background: '#091310', panel: '#12231c', accent: '#76ddb0' },
  { id: 'ember', name: 'Ember', description: 'Warm charcoal · apricot', background: '#17100d', panel: '#291d17', accent: '#ffb878' },
  { id: 'violet', name: 'Violet', description: 'Aubergine · lavender', background: '#120e1b', panel: '#221a31', accent: '#c3a1ff' },
  { id: 'graphite', name: 'Graphite', description: 'Neutral charcoal · silver', background: '#101112', panel: '#212325', accent: '#c6d0d8' },
] as const
export type ThemeId = typeof THEMES[number]['id']
export const DEFAULT_THEME: ThemeId = 'midnight'
export const SETTINGS_KEY = 'cabin_settings'
export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some(theme => theme.id === value)
}
export function themeFromMetadata(metadata: Record<string, unknown> | undefined): ThemeId {
  const settings = metadata?.[SETTINGS_KEY]
  const theme = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).theme : undefined
  return isThemeId(theme) ? theme : DEFAULT_THEME
}
export function settingsCacheKey(userId: string | null): string {
  // Guest preferences cannot become the next signed-in user's preferences.
  return `cabin:settings:v1:${userId ?? 'guest'}`
}
export function mergeThemeSettings(metadata: Record<string, unknown>, theme: ThemeId) {
  const existing = metadata[SETTINGS_KEY]
  return { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), theme }
}
