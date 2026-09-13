// Compiler-only large-population audit; expanded references stay under 8192.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Color } from 'three'
import { compileParticlePlan } from '../../src/editor/core/visualCopies/particlePlan'
import { resolveVisualCopies } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import { applyColorShiftToColor } from '../../src/editor/core/visual/colorShift'
import { COLOR_IDS, colorEntry, colorFrameCases, colorNote, radialPopulation } from './particle-color-program-fixtures'

const outputName = process.argv[2] ?? 'baseline'
const directory = 'artifacts/particle-color-program'
mkdirSync(directory, { recursive: true })
const populations = []
for (const levels of [3, 4]) for (const id of COLOR_IDS) {
  const chain = [...radialPopulation(levels), colorEntry(id, {}, [colorNote()])]
  let calls = 0
  for (const entry of chain) entry.apply = () => { calls++; throw new Error('Large population was expanded during compiler audit') }
  const plain = compileParticlePlan(chain.slice(0, levels), 0, .7)!
  assert.equal(plain.count, 32 ** levels)
  const plan = compileParticlePlan(chain, 0, .7)
  populations.push({ colorizer: id, count: plain.count, withoutColorizerCompact: true,
    withColorizerCompact: !!plan, cpuApplyCalls: calls, packedScalars: plan?.matrices.length ?? null })
}
const color = new Color(), tint = new Color()
const frames = colorFrameCases().map(frame => {
  const copies = resolveVisualCopies(frame.chain, frame.beat, frame.placement)
  assert.ok(copies.length <= 8192)
  return { name: frame.name, beat: frame.beat, count: copies.length, copies: copies.map(copy => {
    applyColorShiftToColor(color.set(frame.color), copy.colorShift, tint)
    return { matrix: copy.transform.elements, opacity: copy.opacity, colorShift: copy.colorShift, linearRgb: color.toArray() }
  }) }
})
const result = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), populations, frames }
writeFileSync(`${directory}/${outputName}.json`, JSON.stringify(result))
console.log(JSON.stringify({ commit: result.commit, populations, frames: frames.length,
  referenceCopies: frames.reduce((sum, frame) => sum + frame.count, 0), file: `${directory}/${outputName}.json` }, null, 2))
