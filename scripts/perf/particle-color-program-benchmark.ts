// CPU-side frame preparation only. Compare retained expanded-copy evaluation
// against a compact plan for the same scene; GPU execution and draw cost are
// measured separately by particle-color-program-gpu.mjs in a visible browser.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { Matrix4 } from 'three'
import { compileParticlePlan } from '../../src/editor/core/visualCopies/particlePlan'
import { createVisualCopyEvaluator } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import { COLOR_IDS, colorEntry, colorNote, radialPopulation } from './particle-color-program-fixtures'

const mode = process.argv[2] ?? 'expanded'
assert.ok(mode === 'expanded' || mode === 'compact')
const output = process.argv[3] ?? mode
const notes = Array.from({ length: 24 }, (_, i) => colorNote(i * .5, i % 4 === 0 ? 61 : 60, .8, 1.5))
const fixtures = [
  ...COLOR_IDS.map(id => ({ name: id, chain: [...radialPopulation(3), colorEntry(id, { continuous: 1 }, notes)] })),
  { name: 'fluid-then-cosine', chain: [...radialPopulation(3), colorEntry('fluidImpact', {}, notes), colorEntry('cosinePalette', { mode: 0, span: 4.7 }, notes)] },
]
const summary = (values: number[]) => {
  values.sort((a, b) => a - b)
  return { medianMs: values[Math.floor(values.length * .5)], p95Ms: values[Math.floor(values.length * .95)], maxMs: values.at(-1), samples: values.length }
}
const results = []
for (const fixture of fixtures) {
  globalThis.gc?.()
  const evaluate = createVisualCopyEvaluator(), placement = new Matrix4().makeRotationY(.23).setPosition(.2, -.1, .3)
  const samples: number[] = []
  let checksum = 0
  for (let frame = 0; frame < 120; frame++) {
    const beat = 6 + frame / 60
    const start = performance.now()
    if (mode === 'expanded') {
      const copies = evaluate(fixture.chain, beat, placement)
      const elapsed = performance.now() - start
      assert.equal(copies.length, 32 ** 3)
      if (frame >= 30) samples.push(elapsed)
      checksum += copies[frame % copies.length].transform.elements[12] + copies[frame % copies.length].colorShift.hue
    } else {
      const plan = compileParticlePlan(fixture.chain, frame, beat, placement)
      const elapsed = performance.now() - start
      assert.ok(plan, `${fixture.name}: compact plan missing`)
      assert.equal(plan.count, 32 ** 3)
      if (frame >= 30) samples.push(elapsed)
      checksum += plan.count + plan.matrices[0]
    }
  }
  const result = { name: fixture.name, count: 32 ** 3, ...summary(samples), checksum }
  results.push(result)
  console.log(JSON.stringify(result))
}
const directory = 'artifacts/particle-color-program'
mkdirSync(directory, { recursive: true })
writeFileSync(`${directory}/${output}.json`, JSON.stringify({
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), mode,
  scope: 'CPU frame preparation with cached static splitter prefix; excludes GPU execution, texture upload and rendering', results,
}, null, 2))
