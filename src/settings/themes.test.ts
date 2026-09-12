import test from 'node:test'
import assert from 'node:assert/strict'
import { THEMES, DEFAULT_THEME, isThemeId, themeFromMetadata, mergeThemeSettings, settingsCacheKey } from './themes'

test('missing, malformed and old settings always resolve to the default', () => {
  for (const metadata of [undefined, {}, { cabin_settings: null }, { cabin_settings: 'forest' }, { cabin_settings: { theme: 'deleted-theme' } }, { cabin_settings: { theme: ['forest'] } }]) {
    assert.equal(themeFromMetadata(metadata), DEFAULT_THEME)
  }
  assert.equal(isThemeId('__proto__'), false)
})
test('each selectable theme round-trips through account metadata', () => {
  assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length)
  for (const { id } of THEMES) assert.equal(themeFromMetadata({ cabin_settings: { theme: id } }), id)
})
test('a theme update preserves future settings without mutating the prior metadata', () => {
  const metadata = { full_name: 'Account name', cabin_settings: { theme: 'forest', reducedMotion: true } }
  assert.deepEqual(mergeThemeSettings(metadata, 'ember'), { theme: 'ember', reducedMotion: true })
  assert.equal(metadata.cabin_settings.theme, 'forest')
  assert.deepEqual(mergeThemeSettings({ cabin_settings: ['old'] }, 'violet'), { theme: 'violet' })
})
test('guest and separate users never share storage keys', () => {
  assert.equal(new Set([null, 'user-a', 'user-b'].map(settingsCacheKey)).size, 3)
})
