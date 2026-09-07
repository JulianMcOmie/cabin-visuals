import assert from 'node:assert/strict'
import test from 'node:test'
import { wallpaperTransforms, wallpaperSplitter, WALLPAPER_MAX_COPIES, type WallpaperSettings } from './wallpaper'
import { mergeDefinitionSettings } from './definitions'
const s = (v: Partial<WallpaperSettings> = {}) => ({ ...mergeDefinitionSettings(wallpaperSplitter, {}), ...v }) as WallpaperSettings
const pos = (m: ReturnType<typeof wallpaperTransforms>[number]) => m.elements.slice(12, 15).map(n => Math.round(n * 1e10) / 1e10)
test('translated cells repeat an entire fourfold orbit in stable cell order', () => {
  const t = wallpaperTransforms(s({ rows: 1, columns: 2, spacing: 2, offsetX: .25, offsetY: .125 }))
  assert.equal(t.length, 8)
  assert.deepEqual(t.slice(0, 4).map(pos), [[-.5, .25, 0], [-1.25, .5, 0], [-1.5, -.25, 0], [-.75, -.5, 0]])
  for (let i = 0; i < 4; i++) assert.equal(pos(t[i + 4])[0] - pos(t[i])[0], 2)
})
test('mirror changes handedness; rotations preserve it in all planes', () => {
  for (const plane of [0, 1, 2]) {
    const t = wallpaperTransforms(s({ rows: 1, columns: 1, mode: 1, plane }))
    assert.ok(t[0].determinant() > 0)
    assert.ok(t[1].determinant() < 0)
    const axes = plane === 1 ? [0, 2] : plane === 2 ? [1, 2] : [0, 1]
    assert.ok(Math.abs(t[0].elements[12 + axes[0]] + t[1].elements[12 + axes[0]]) < 1e-10)
    assert.ok(Math.abs(t[0].elements[12 + axes[1]] - t[1].elements[12 + axes[1]]) < 1e-10)
    assert.ok(wallpaperTransforms(s({ mode: 3, plane })).every(m => m.determinant() > 0))
  }
})
test('counts are bounded and motif size leaves translations unchanged', () => {
  assert.equal(wallpaperTransforms(s({ rows: 100, columns: 100 })).length, WALLPAPER_MAX_COPIES)
  for (const [mode, count] of [[0, 1], [1, 2], [2, 2], [3, 4]]) assert.equal(wallpaperTransforms(s({ mode, rows: 1, columns: 1 })).length, count)
  assert.deepEqual(wallpaperTransforms(s()).map(pos), wallpaperTransforms(s({ size: 3 })).map(pos))
})
