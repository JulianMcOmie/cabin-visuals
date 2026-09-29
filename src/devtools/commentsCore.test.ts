import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { addComment, deleteCommentImages, emptyComments, findComment, needsAttention, readComments, removeComment, replyTo, saveCommentImage, setStatus, updateComments } from './commentsCore'

test('the comment lifecycle: add → Claude replies (review) → you reply (reopens) → resolve', () => {
  const doc = emptyComments()
  const c = addComment(doc, { beat: 120, text: ' faster here ', trackId: 't1', trackName: 'Sand' })
  assert.equal(c.id, 'c1')
  assert.equal(c.text, 'faster here')
  assert.equal(c.status, 'open')
  assert.ok(needsAttention(c))
  replyTo(doc, 'c1', { author: 'claude', text: 'done' }, 'review')
  assert.equal(c.status, 'review')
  assert.ok(!needsAttention(c))
  replyTo(doc, '1', { author: 'you', text: 'not quite' })
  assert.equal(c.status, 'open')
  setStatus(doc, 'c1', 'resolved')
  assert.ok(!needsAttention(c))
  assert.equal(addComment(doc, { beat: 4, text: 'x' }).id, 'c2')
  removeComment(doc, 'c2')
  assert.throws(() => findComment(doc, 'c2'))
  assert.throws(() => addComment(doc, { beat: 1, text: '  ' }))
  assert.throws(() => setStatus(doc, 'c1', 'nope' as never))
})

test('updateComments is a locked read-modify-write; images land under comments/', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-comments-'))
  await Promise.all(Array.from({ length: 8 }, (_, i) => updateComments(dir, (d) => addComment(d, { beat: i, text: `n${i}` }))))
  const doc = await readComments(dir)
  assert.equal(doc.comments.length, 8)
  assert.deepEqual(new Set(doc.comments.map((c) => c.id)).size, 8)
  const rel = await saveCommentImage(dir, 'c1-still.png', 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(rel, 'comments/c1-still.png')
  assert.ok(fs.existsSync(path.join(dir, rel)))
  assert.ok(!fs.existsSync(path.join(dir, 'comments.json.lock')))
})

test('removing a comment deletes its still and reply shots - nothing outside comments/', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabin-comments-'))
  const doc = emptyComments()
  const c = addComment(doc, { beat: 8, text: 'here' })
  c.still = await saveCommentImage(dir, 'c1-still.png', 'data:image/png;base64,iVBORw0KGgo=')
  replyTo(doc, 'c1', { author: 'claude', text: 'done', images: [await saveCommentImage(dir, 'c1-after-2.png', 'data:image/png;base64,iVBORw0KGgo=')] })
  fs.writeFileSync(path.join(dir, 'keep.png'), '')
  const images = removeComment(doc, 'c1')
  assert.deepEqual(images, ['comments/c1-still.png', 'comments/c1-after-2.png'])
  await deleteCommentImages(dir, [...images, 'keep.png', '../keep.png'])
  assert.deepEqual(fs.readdirSync(path.join(dir, 'comments')), [])
  assert.ok(fs.existsSync(path.join(dir, 'keep.png')))
})
