import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { registerFrameDriver, setExportPinned, isExportPinned } from '../editor/core/export/frameDriver'

const mockModule = (mock as unknown as { module(path: string, options: { namedExports: object }): void }).module.bind(mock)
mockModule('../editor/store/ProjectStore.ts', { namedExports: { useProjectStore: {} } })
mockModule('../editor/store/AudioStore.ts', { namedExports: { useAudioStore: {} } })
mockModule('../editor/store/TimeStore.ts', { namedExports: { useTimeStore: { getState: () => ({ isPlaying: false, currentBeat: 3 }) } } })
mockModule('./serialize.ts', { namedExports: { serialize: () => ({}) } })
mockModule('./projectStorage.ts', { namedExports: { save: async () => 1, ProjectConflictError: class extends Error {} } })

test('autosave thumbnail cannot render a preview beat or release an active export', async () => {
  const { captureThumbnail } = await import('./autosave')
  let renders = 0, releases = 0
  registerFrameDriver({
    pin() {}, renderFrame() { renders++ },
    unpin() { releases++; setExportPinned(false) },
    getCanvas() { throw new Error('no thumbnail context') },
  })
  try {
    setExportPinned(true)
    assert.equal(captureThumbnail(), undefined)
    assert.equal(renders, 0)
    assert.equal(releases, 0)
    assert.equal(isExportPinned(), true)
    setExportPinned(false)
    captureThumbnail()
    assert.equal(renders, 1, 'thumbnail capture resumes after export')
    assert.equal(releases, 1)
  } finally {
    setExportPinned(false)
    registerFrameDriver(null)
  }
})
