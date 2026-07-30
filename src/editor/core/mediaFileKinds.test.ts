import test from 'node:test'
import assert from 'node:assert/strict'
import {
  dragCarriesFiles,
  isAudioFile,
  isMidiFileName,
  isMidiMimeType,
  mediaKindOfFile,
  mediaKindOfMimeType,
} from './mediaFileKinds'

const f = (name: string, type = '') => ({ name, type })

test('MIDI file routing: extension always, dragover MIME types only', () => {
  assert.ok(isMidiFileName('song.mid'))
  assert.ok(isMidiFileName('SONG.MIDI'))
  assert.ok(!isMidiFileName('song.mid.wav'))
  assert.ok(!isMidiFileName('midi'))
  assert.ok(isMidiMimeType('audio/midi'))
  assert.ok(isMidiMimeType('audio/mid'))
  assert.ok(!isMidiMimeType('audio/mpeg'))
})

test('MIME type decides the kind when the browser reports one', () => {
  assert.equal(mediaKindOfFile(f('song.mp3', 'audio/mpeg')), 'audio')
  assert.equal(mediaKindOfFile(f('clip.mov', 'video/quicktime')), 'video')
  assert.equal(mediaKindOfFile(f('shot.png', 'image/png')), 'photo')
  assert.equal(mediaKindOfFile(f('loop.mid', 'audio/midi')), 'midi')
})

test('extension decides when File.type is empty (Safari)', () => {
  assert.equal(mediaKindOfFile(f('song.aif')), 'audio')
  assert.equal(mediaKindOfFile(f('Song.OPUS')), 'audio')
  assert.equal(mediaKindOfFile(f('take.caf')), 'audio')
  assert.equal(mediaKindOfFile(f('clip.mkv')), 'video')
  assert.equal(mediaKindOfFile(f('photo.heic')), 'photo')
  assert.equal(mediaKindOfFile(f('loop.mid')), 'midi')
})

test('MIDI never falls into the audio pipeline', () => {
  // 'audio/midi' would pass a naive startsWith('audio/') check.
  assert.ok(!isAudioFile(f('loop.mid', 'audio/midi')))
  assert.ok(!isAudioFile(f('loop.midi')))
})

test('files with no pipeline are null, not guessed', () => {
  assert.equal(mediaKindOfFile(f('notes.txt', 'text/plain')), null)
  assert.equal(mediaKindOfFile(f('project.cabin')), null)
  assert.equal(mediaKindOfFile(f('noextension')), null)
  assert.equal(mediaKindOfFile(f('.mp3')), null) // dotfile, not an extension
})

test('mid-drag MIME sniffing reports nothing rather than guessing', () => {
  // Safari exposes '' for every dragged item until the drop; that must read as
  // "no information", never as "not media".
  assert.equal(mediaKindOfMimeType(''), null)
  assert.equal(mediaKindOfMimeType('audio/wav'), 'audio')
})

test('a drag carries files when types says Files - the one cross-browser signal', () => {
  const dt = (types: string[]) => ({ types } as unknown as DataTransfer)
  assert.ok(dragCarriesFiles(dt(['Files'])))
  assert.ok(dragCarriesFiles(dt(['Files', 'public.file-url']))) // Safari's extras
  assert.ok(!dragCarriesFiles(dt(['text/plain'])))
  assert.ok(!dragCarriesFiles(null))
})
