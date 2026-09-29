import test from 'node:test'
import assert from 'node:assert/strict'
import { compositionDef, isCompositionTrack, listCompositionInstruments, registerCompositions } from './index'
import type { CompositionInstrumentDef } from './types'

const fake = (id: string, name: string) => ({ ...compositionDef('sceneSwitcher')!, id, name }) as CompositionInstrumentDef

test('code compositions register, and re-registering an id replaces it in place (hot reload)', () => {
  const before = listCompositionInstruments().length
  registerCompositions([fake('test.one', 'One')])
  assert.equal(compositionDef('test.one')?.name, 'One')
  assert.equal(isCompositionTrack({ type: 'base', instrumentId: 'test.one' }), true)
  assert.equal(listCompositionInstruments().length, before + 1)
  registerCompositions([fake('test.one', 'One v2')])
  assert.equal(compositionDef('test.one')?.name, 'One v2')
  assert.equal(listCompositionInstruments().length, before + 1)
  assert.equal(listCompositionInstruments().find((d) => d.id === 'test.one')?.name, 'One v2')
})

test('a code composition cannot take a built-in id', () => {
  const builtIn = compositionDef('sceneSwitcher')!
  const errors: unknown[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { errors.push(a) }
  try {
    registerCompositions([fake('sceneSwitcher', 'Impostor')])
  } finally {
    console.error = orig
  }
  assert.equal(compositionDef('sceneSwitcher'), builtIn)
  assert.equal(errors.length, 1)
})
