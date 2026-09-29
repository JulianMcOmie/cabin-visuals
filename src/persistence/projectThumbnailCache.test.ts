import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cacheProjectThumbnail, withCachedThumbnail } from './projectThumbnailCache'
import type { ProjectSummary } from './projectStorage'

test('cache is scoped to both owner and document revision, and saved images win', async () => {
  const project: ProjectSummary = { id: 'test', name: 'Project', rev: 4, updatedAt: '', preview: { rows: [], durationSeconds: 7 } }
  await cacheProjectThumbnail('alice', project.id, 4, 'generated')
  assert.equal(withCachedThumbnail('alice', project).preview?.image, 'generated')
  assert.equal(withCachedThumbnail('alice', project).preview?.durationSeconds, 7)
  assert.equal(withCachedThumbnail('bob', project).preview?.image, undefined)
  assert.equal(withCachedThumbnail('alice', { ...project, rev: 5 }).preview?.image, undefined)
  const saved = { ...project, preview: { ...project.preview!, image: 'editor' } }
  assert.equal(withCachedThumbnail('alice', saved).preview?.image, 'editor')
  assert.equal(project.preview?.image, undefined)
})
