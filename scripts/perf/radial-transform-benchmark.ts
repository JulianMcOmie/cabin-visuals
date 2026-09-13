/** CPU-only, real-engine regression fixture. Run before and after a change:
 * node --expose-gc --import tsx scripts/perf/radial-transform-benchmark.ts \
 *   --output artifacts/radial-transforms/baseline.json
 * Add --compare artifacts/radial-transforms/baseline.json to check sampled
 * transform parity and report speed ratios. This does not measure rendering,
 * uploads, GPU time, or presented FPS; it isolates document/copy evaluation.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createVisualEngine } from '../../src/editor/core/visual/VisualEngine'
import type { ProjectSnapshot } from '../../src/editor/core/visual/resolve'
import { getMoverOrSplitterDefinition } from '../../src/editor/core/visualCopies/registry'
import { getInstrument } from '../../src/editor/instruments'
import type { Track } from '../../src/editor/types'

type Instrument = 'particle' | 'particleStream'
type Placement = 'none' | 'above' | 'between' | 'below' | 'nested'
const placements: Placement[] = ['none', 'above', 'between', 'below', 'nested']
const copyCount = 32 ** 3
const sampleIndices = [0, 1, 31, 32, 1023, 1024, copyCount - 1]
const sampleBeats = [.5, 1.25, 4.5, -1, .5]
const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1] ?? fallback
}
const samples = Number(option('--samples', '180'))
const warmup = Number(option('--warmup', '30'))
assert(Number.isInteger(samples) && samples > 0)
assert(Number.isInteger(warmup) && warmup >= 0)
const motion = option('--motion', 'rotate')
assert(motion === 'rotate' || motion === 'orbit')
const output = resolve(option('--output', 'artifacts/radial-transforms/current.json'))
const comparePath = option('--compare', '')
const gitInfo = (command: string[], fallback: string) => {
  try { return execFileSync('git', command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return fallback }
}

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#ffffff',
    childIds: [], muted: false, solo: false, blocks: [], ...fields }
}

function fixture(instrument: Instrument, placement: Placement): ProjectSnapshot {
  const radialIds = ['radial0', 'radial1', 'radial2']
  const children = [...radialIds]
  if (placement === 'above') children.unshift('mover')
  if (placement === 'between') children.splice(1, 0, 'mover')
  if (placement === 'below') children.push('mover')
  const tracks: Record<string, Track> = {
    particles: track('particles', { instrumentId: instrument, childIds: children,
      params: { size: .007, count: 6, density: 16, speed: 1, twist: .35, spread: 4 } }),
  }
  radialIds.forEach((id, index) => {
    tracks[id] = track(id, { type: 'splitter', splitterId: 'radial', parentId: 'particles',
      // Distinct planes/radii avoid a degenerate coincident-ring benchmark.
      inputValues: { copies: 32, radius: [4, 1.2, .25][index], plane: index, size: 1 },
      childIds: placement === 'nested' && index === 1 ? ['mover'] : [],
    })
  })
  if (placement !== 'none') {
    tracks.mover = track('mover', { type: 'mover', moverId: 'mover',
      parentId: placement === 'nested' ? 'radial1' : 'particles',
      // Rotate/Orbit + Constant + Auto spin. An empty MIDI lane is deliberately
      // active: these modes' authored baseline rotation runs at all beats.
      inputValues: { motion: motion === 'rotate' ? 1 : 2, mode: 1, drive: 0,
        angleX: 17, angleY: 29, angleZ: 45, angle: 1,
        pivotX: .3, pivotY: -.2, pivotZ: .1 },
    })
  }
  return { tracks, rootTrackIds: ['particles'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}

function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b)
  const percentile = (p: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * p))]
  return { medianMs: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
    minMs: ordered[0], maxMs: ordered.at(-1)!,
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length }
}

function run(instrument: Instrument, placement: Placement) {
  globalThis.gc?.()
  const project = fixture(instrument, placement)
  const engine = createVisualEngine()
  const initialHeap = process.memoryUsage().heapUsed
  const resolveStart = performance.now()
  engine.setProject(project)
  const resolveMs = performance.now() - resolveStart
  const resolveHeapDeltaBytes = process.memoryUsage().heapUsed - initialHeap
  const firstStart = performance.now()
  engine.computeAtBeat(0)
  const firstComputeMs = performance.now() - firstStart
  assert.equal(engine.getVisualCopyCount('particles'), copyCount)
  const sceneId = engine.getObjectList().find(entry => entry.trackId === 'particles')!.sceneId

  for (let frame = 0; frame < warmup; frame++) engine.computeAtBeat(frame / 30)
  const timings: number[] = []
  for (let frame = 0; frame < samples; frame++) {
    const start = performance.now()
    engine.computeAtBeat(1 + frame / 30)
    timings.push(performance.now() - start)
  }
  // Reference samples are outside the timed loop. Re-seeking the same beat must
  // reconstruct exactly the same transforms, regardless of intervening beats.
  const transforms = sampleBeats.map(beat => {
    engine.computeAtBeat(beat)
    return { beat, copies: sampleIndices.map(index => {
      const copy = engine.getVisualCopy('particles', index)!
      assert(copy.transform.elements.every(Number.isFinite))
      return { index, matrix: [...copy.transform.elements], opacity: copy.opacity, colorShift: { ...copy.colorShift } }
    }) }
  })
  assert.deepEqual(transforms[0], transforms.at(-1))
  if (placement !== 'none') assert.notDeepEqual(transforms[0].copies, transforms[1].copies, 'Mover must actually animate')
  const plan = engine.getParticlePlan('particles')
  return { id: `${instrument}/${placement}`, instrument, placement, project,
    logicalCopies: engine.getVisualCopyCount('particles'),
    renderedParticles: copyCount * (instrument === 'particleStream' ? 96 : 1),
    expandedCopies: engine.getVisualCopies('particles').length,
    objectListEntries: engine.getObjectList().filter(entry => entry.trackId === 'particles').length,
    directParticleScene: engine.isDirectParticleScene(sceneId),
    compactPlan: !!plan, planMatrixCount: plan ? plan.matrices.length / 16 : 0,
    resolveMs, resolveHeapDeltaBytes, firstComputeMs, compute: stats(timings),
    computeSamplesMs: timings, transforms }
}

assert(getInstrument('particle') && getInstrument('particleStream'))
assert(getMoverOrSplitterDefinition('radial') && getMoverOrSplitterDefinition('mover'))
const fixtures = []
for (const instrument of ['particle', 'particleStream'] as const) {
  for (const placement of placements) {
    const result = run(instrument, placement)
    fixtures.push(result)
    console.log(`${result.id}: resolve ${result.resolveMs.toFixed(2)}ms; compute median ${result.compute.medianMs.toFixed(3)}ms / p95 ${result.compute.p95Ms.toFixed(3)}ms; expanded ${result.expandedCopies}; compact ${result.compactPlan}; direct ${result.directParticleScene}`)
  }
}
let comparison: unknown
if (comparePath) {
  const baseline = JSON.parse(readFileSync(resolve(comparePath), 'utf8')) as { fixtures: typeof fixtures }
  comparison = fixtures.map(current => {
    const previous = baseline.fixtures.find(entry => entry.id === current.id)
    assert(previous, `Missing baseline fixture ${current.id}`)
    assert.deepEqual(current.project, previous.project, 'Comparisons require identical authored documents')
    let maxMatrixDifference = 0
    current.transforms.forEach((frame, frameIndex) => frame.copies.forEach((copy, copyIndex) => {
      const priorCopy = previous.transforms[frameIndex].copies[copyIndex]
      assert.equal(copy.opacity, priorCopy.opacity)
      assert.deepEqual(copy.colorShift, priorCopy.colorShift)
      copy.matrix.forEach((value, index) => { maxMatrixDifference = Math.max(maxMatrixDifference, Math.abs(value - priorCopy.matrix[index])) })
    }))
    assert(maxMatrixDifference < 1e-9, `${current.id}: transform mismatch ${maxMatrixDifference}`)
    return { id: current.id, medianSpeedRatio: previous.compute.medianMs / current.compute.medianMs,
      p95SpeedRatio: previous.compute.p95Ms / current.compute.p95Ms,
      resolveSpeedRatio: previous.resolveMs / current.resolveMs, maxMatrixDifference }
  })
}
const result = {
  description: 'CPU document resolution and warm computeAtBeat; no rendering, buffer uploads, GPU, or presented FPS measurements.',
  timestamp: new Date().toISOString(), revision: option('--revision', '') || gitInfo(['rev-parse', 'HEAD'], '(unknown)'),
  sourceStatus: gitInfo(['status', '--short'], '(archive without .git)'),
  environment: { node: process.version, platform: platform(), release: release(), arch: process.arch,
    cpu: cpus()[0]?.model, nodeEnv: process.env.NODE_ENV ?? '(unset)', explicitGc: !!globalThis.gc },
  settings: { samples, warmup, motion, copiesPerRadial: 32, radials: 3, bpm: 120,
    frameBeatStep: 1 / 30, note: 'At 120 BPM the beat step corresponds to 60 frames/second; timings are unpaced.' },
  fixtures, ...(comparison ? { comparison } : {}),
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(`Saved ${output}`)
