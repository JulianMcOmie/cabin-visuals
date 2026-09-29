/** Controlled CPU-only splitter benchmark using the production document engine.
 * node --expose-gc --import tsx scripts/perf/splitter-program-benchmark.ts \
 *   --output artifacts/splitter-program/baseline.json
 * Re-run with --compare artifacts/splitter-program/baseline.json after changes.
 * --fixtures accepts comma-separated fixture IDs; --motion orbit checks Orbit.
 * Every fixture stays below 32k copies to keep an expanded baseline bounded.
 * Rendering, uploads, GPU work and presented FPS are intentionally not timed.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createVisualEngine } from '../../src/editor/core/visual/VisualEngine'
import type { ProjectSnapshot } from '../../src/editor/core/visual/resolve'
import { listMoverOrSplitterDefinitions, getMoverOrSplitterDefinition } from '../../src/editor/core/visualCopies/registry'
import { mergeDefinitionSettings } from '../../src/editor/core/visualCopies/definitions'
import { resolveVisualCopies } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import type { Track } from '../../src/editor/types'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1] ?? fallback
}
const samples = Number(option('--samples', '180')), warmup = Number(option('--warmup', '30'))
assert(Number.isInteger(samples) && samples > 0 && Number.isInteger(warmup) && warmup >= 0)
const motion = option('--motion', 'rotate')
assert(motion === 'rotate' || motion === 'orbit')
const output = resolve(option('--output', 'artifacts/splitter-program/current.json'))
const comparePath = option('--compare', '')
const selected = option('--fixtures', '').split(',').filter(Boolean)
const gitInfo = (command: string[], fallback: string) => {
  try { return execFileSync('git', command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return fallback }
}

interface Layout { id: string; settings: Record<string, number> }
interface FixtureSpec { id: string; layouts: Layout[]; copies: number; mover: 'after' | 'between' | number }
const fractal = (branches = 5, depth = 4): Layout => ({ id: 'fractal', settings: { branches, depth, shrink: .45, spread: 1.5, angle: 31, pattern: 0, plane: 0, size: 1 } })
const radial: Layout = { id: 'radial', settings: { copies: 32, radius: 1.2, plane: 1, size: 1 } }
const scatter = (copies: number): Layout => ({ id: 'scatter', settings: { copies, distribution: 2, spread: 2.1, seed: 731, plane: 2, size: 1 } })
const wallpaper = (rows: number, columns: number, mode: number): Layout => ({ id: 'wallpaper', settings: { rows, columns, mode, spacing: .3, offsetX: .22, offsetY: .12, angle: 17, plane: 0, size: 1 } })
const specs: FixtureSpec[] = [
  { id: 'fractal-radial-after', layouts: [fractal(), radial], copies: 781 * 32, mover: 'after' },
  { id: 'fractal-radial-between', layouts: [fractal(), radial], copies: 781 * 32, mover: 'between' },
  { id: 'fractal-nested-radial', layouts: [fractal(), radial], copies: 781 * 32, mover: 0 },
  { id: 'radial-fractal-nested', layouts: [radial, fractal()], copies: 781 * 32, mover: 1 },
  { id: 'scatter-wallpaper-polyhedron', layouts: [scatter(32), wallpaper(4, 4, 1), { id: 'polyhedron', settings: { shape: 4, placement: 0, radius: .4, size: 1 } }], copies: 32 * 32 * 20, mover: 'after' },
  { id: 'fractal-scatter-wallpaper-nested', layouts: [fractal(3, 4), scatter(16), wallpaper(2, 2, 3)], copies: 121 * 16 * 16, mover: 1 },
]
assert(selected.every(id => specs.some(spec => spec.id === id)), 'Unknown fixture ID')

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#ffffff', childIds: [], muted: false, solo: false, blocks: [], ...fields }
}

function projectFor(spec: FixtureSpec): ProjectSnapshot {
  const ids = spec.layouts.map((_, index) => `layout${index}`), children = [...ids]
  if (spec.mover === 'after') children.push('mover')
  if (spec.mover === 'between') children.splice(1, 0, 'mover')
  const tracks: Record<string, Track> = {
    particle: track('particle', { instrumentId: 'particle', childIds: children,
      params: { size: .007, tfX: .2, tfY: -.3, tfRotZ: 11 }, stringParams: { color: '#84ccfa' } }),
  }
  spec.layouts.forEach((layout, index) => {
    assert(getMoverOrSplitterDefinition(layout.id), `Missing definition ${layout.id}`)
    tracks[ids[index]] = track(ids[index], { type: 'splitter', splitterId: layout.id,
      parentId: 'particle', inputValues: layout.settings, childIds: spec.mover === index ? ['mover'] : [] })
  })
  tracks.mover = track('mover', { type: 'mover', moverId: 'mover',
    parentId: typeof spec.mover === 'number' ? ids[spec.mover] : 'particle',
    inputValues: { motion: motion === 'rotate' ? 1 : 2, mode: 1, drive: 0,
      angleX: 17, angleY: 29, angleZ: 45, angle: 1, pivotX: .3, pivotY: -.2, pivotZ: .1 } })
  return { tracks, rootTrackIds: ['particle'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}

function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b)
  const percentile = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]
  return { samples: values.length, medianMs: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1),
    meanMs: values.reduce((sum, value) => sum + value, 0) / values.length }
}

function run(spec: FixtureSpec) {
  globalThis.gc?.()
  const project = projectFor(spec), engine = createVisualEngine()
  const initialHeap = process.memoryUsage().heapUsed, resolveStart = performance.now()
  engine.setProject(project)
  const resolveMs = performance.now() - resolveStart, resolveHeapDeltaBytes = process.memoryUsage().heapUsed - initialHeap
  engine.computeAtBeat(0)
  assert.equal(engine.getVisualCopyCount('particle'), spec.copies)
  const sceneId = engine.getObjectList().find(entry => entry.trackId === 'particle')!.sceneId
  for (let frame = 0; frame < warmup; frame++) engine.computeAtBeat(frame / 30)
  const timings: number[] = []
  for (let frame = 0; frame < samples; frame++) {
    const start = performance.now()
    engine.computeAtBeat(1 + frame / 30)
    timings.push(performance.now() - start)
  }
  const indices = [0, 1, 31, 32, 120, 121, 780, 781, Math.floor(spec.copies / 2), spec.copies - 1]
  const transforms = [.5, 1.25, 4.5, -1, .5].map(beat => {
    engine.computeAtBeat(beat)
    const state = engine.getObjectState('particle')!
    return { beat, world: [...state.world.elements], objectOpacity: state.opacity, meshScale: state.meshScale,
      copies: indices.map(index => {
        const copy = engine.getVisualCopy('particle', index)!
        assert(copy.transform.elements.every(Number.isFinite))
        return { index, matrix: [...copy.transform.elements], opacity: copy.opacity, colorShift: { ...copy.colorShift } }
      }) }
  })
  assert.deepEqual(transforms[0], transforms.at(-1), 'Seeking must reproduce the same frame exactly')
  assert.notDeepEqual(transforms[0].copies, transforms[1].copies, 'Fixture Mover must animate')
  const plan = engine.getParticlePlan('particle')
  return { id: spec.id, spec, project, logicalCopies: engine.getVisualCopyCount('particle'),
    expandedCopies: engine.getVisualCopies('particle').length,
    objectListEntries: engine.getObjectList().filter(entry => entry.trackId === 'particle').length,
    compact: !!plan, framedProgram: !!plan?.program, direct: engine.isDirectParticleScene(sceneId),
    planStorageBytes: plan?.matrices.byteLength ?? 0, resolveMs, resolveHeapDeltaBytes,
    compute: stats(timings), computeSamplesMs: timings, transforms }
}

// One default occurrence per registered splitter documents current opt-ins.
// This inventory is outside the timings; it never fans out a large chain.
const inventory = listMoverOrSplitterDefinitions().filter(def => def.kind === 'splitter').map(def => {
  const settings = mergeDefinitionSettings(def, {}), entry = def.resolve({ settings, notes: [] })
  return { id: def.id, defaults: settings, defaultCopies: resolveVisualCopies([entry], 0).length,
    local: !!(entry.localTransforms || entry.localTransformsAtBeat || entry.localLayout || entry.localLayoutAtBeat), root: !!(entry.rootTransform || entry.rootTransformAtBeat),
    framed: !!entry.framedLocalTransformsAtBeat, privateClocks: !!entry.emitsCopyClocks, cachePolicy: entry.cachePolicy ?? null }
})
const fixtures = specs.filter(spec => selected.length === 0 || selected.includes(spec.id)).map(spec => {
  const result = run(spec)
  console.log(`${result.id}: ${result.logicalCopies} copies; resolve ${result.resolveMs.toFixed(2)}ms; compute median ${result.compute.medianMs.toFixed(3)}ms / p95 ${result.compute.p95Ms.toFixed(3)}ms; compact ${result.compact}; direct ${result.direct}`)
  return result
})
let comparison: unknown
if (comparePath) {
  const baseline = JSON.parse(readFileSync(resolve(comparePath), 'utf8')) as { fixtures: typeof fixtures }
  comparison = fixtures.map(current => {
    const previous = baseline.fixtures.find(row => row.id === current.id)
    assert(previous, `Missing baseline ${current.id}`)
    assert.deepEqual(current.project, previous.project, 'Only identical authored documents can be compared')
    let maxMatrixDifference = 0
    current.transforms.forEach((frame, frameIndex) => {
      const previousFrame = previous.transforms[frameIndex]
      assert.deepEqual(frame.world, previousFrame.world)
      assert.equal(frame.objectOpacity, previousFrame.objectOpacity)
      assert.equal(frame.meshScale, previousFrame.meshScale)
      frame.copies.forEach((copy, copyIndex) => {
        const prior = previousFrame.copies[copyIndex]
        assert.equal(copy.index, prior.index); assert.equal(copy.opacity, prior.opacity)
        assert.deepEqual(copy.colorShift, prior.colorShift)
        copy.matrix.forEach((value, index) => { maxMatrixDifference = Math.max(maxMatrixDifference, Math.abs(value - prior.matrix[index])) })
      })
    })
    assert(maxMatrixDifference < 1e-9, `${current.id}: matrix error ${maxMatrixDifference}`)
    return { id: current.id, medianSpeedRatio: previous.compute.medianMs / current.compute.medianMs,
      p95SpeedRatio: previous.compute.p95Ms / current.compute.p95Ms, resolveSpeedRatio: previous.resolveMs / current.resolveMs, maxMatrixDifference }
  })
}
const result = {
  description: 'CPU-only real-engine splitter evaluation. No rendering, upload, GPU, or presented FPS measurements.',
  timestamp: new Date().toISOString(), revision: option('--revision', '') || gitInfo(['rev-parse', 'HEAD'], '(unknown)'),
  sourceStatus: gitInfo(['status', '--short'], '(archive without .git)'),
  environment: { node: process.version, platform: platform(), release: release(), arch: process.arch,
    cpu: cpus()[0]?.model, nodeEnv: process.env.NODE_ENV ?? '(unset)', explicitGc: !!globalThis.gc },
  settings: { samples, warmup, motion, bpm: 120, frameBeatStep: 1 / 30 }, inventory, fixtures,
  ...(comparison ? { comparison } : {}),
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(`Saved ${output}`)
