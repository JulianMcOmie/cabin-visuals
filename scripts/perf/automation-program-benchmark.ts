/** CPU-only reproduction inventory for automation and position-dependent movers.
 * node --expose-gc --import tsx scripts/perf/automation-program-benchmark.ts \
 *   --output artifacts/automation-program/baseline.json
 * Re-run with --compare artifacts/automation-program/baseline.json after edits.
 * All fixtures use 32³ copies; no rendering, uploads, GPU work or FPS are timed.
 * --fixtures accepts comma-separated IDs; --samples and --warmup control work.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createVisualEngine } from '../../src/editor/core/visual/VisualEngine'
import { resolveProject, type ProjectSnapshot } from '../../src/editor/core/visual/resolve'
import { resolveVisualCopies } from '../../src/editor/core/visualCopies/resolveVisualCopies'
import type { Block, Track } from '../../src/editor/types'

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1] ?? fallback
}
const samples = Number(option('--samples', '180')), warmup = Number(option('--warmup', '30'))
assert(Number.isInteger(samples) && samples > 0 && Number.isInteger(warmup) && warmup >= 0)
const output = resolve(option('--output', 'artifacts/automation-program/current.json'))
const comparePath = option('--compare', '')
const selected = option('--fixtures', '').split(',').filter(Boolean)
const COPIES = 32 ** 3
const indices = [0, 1, 31, 32, 1023, 1024, 12345, 16384, COPIES - 1]
const beats = [.5, 1.25, 4.5, -1, .5]
const gitInfo = (command: string[], fallback: string) => {
  try { return execFileSync('git', command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return fallback }
}

interface Spec {
  id: string
  mover?: 'rotate' | 'orbit' | 'symmetricMotion' | 'symmetricRotation'
  laneParent?: 'particle' | 'a' | 'b' | 'c' | 'mover' | 'frame'
  params?: string[]
  particleLanePosition?: 'before' | 'middle' | 'after'
  framed?: boolean
  nested?: boolean
  cpuPrefix?: 'wave' | 'color' | 'wave-color'
}
const specs: Spec[] = [
  { id: 'control-rotate' },
  { id: 'particle-x-before', laneParent: 'particle', params: ['tfX'], particleLanePosition: 'before' },
  { id: 'particle-y-middle', laneParent: 'particle', params: ['tfY'], particleLanePosition: 'middle' },
  { id: 'particle-xy-after', laneParent: 'particle', params: ['tfX', 'tfY'], particleLanePosition: 'after' },
  { id: 'radial-first-x', laneParent: 'a', params: ['tfX'] },
  { id: 'radial-middle-y', laneParent: 'b', params: ['tfY'] },
  { id: 'radial-last-xy', laneParent: 'c', params: ['tfX', 'tfY'] },
  { id: 'mover-own-xy', laneParent: 'mover', params: ['tfX', 'tfY'] },
  { id: 'mover-angle-xy', laneParent: 'mover', params: ['angleX', 'angleY'] },
  { id: 'rotate-with-translating-frame', laneParent: 'frame', params: ['distanceX', 'distanceY'], framed: true },
  { id: 'orbit-with-translating-frame', mover: 'orbit', laneParent: 'frame', params: ['distanceX', 'distanceY'], framed: true },
  { id: 'nested-rotate-with-translating-frame', laneParent: 'frame', params: ['distanceX', 'distanceY'], framed: true, nested: true },
  { id: 'sibling-symmetric-motion', mover: 'symmetricMotion' },
  { id: 'sibling-symmetric-rotation', mover: 'symmetricRotation' },
  { id: 'nested-symmetric-motion', mover: 'symmetricMotion', nested: true },
  { id: 'nested-symmetric-rotation', mover: 'symmetricRotation', nested: true },
  { id: 'cpu-wave-prefix', cpuPrefix: 'wave', laneParent: 'particle', params: ['tfX', 'tfY'], particleLanePosition: 'after' },
  { id: 'cpu-color-prefix', cpuPrefix: 'color', laneParent: 'particle', params: ['tfX', 'tfY'], particleLanePosition: 'after' },
  { id: 'cpu-wave-color-prefix', cpuPrefix: 'wave-color', laneParent: 'particle', params: ['tfX', 'tfY'], particleLanePosition: 'after' },
]
assert(selected.every(id => specs.some(spec => spec.id === id)), 'Unknown fixture ID')

function track(id: string, fields: Partial<Track>): Track {
  return { id, name: id, type: 'base', instrumentId: '', color: '#ffffff', childIds: [], muted: false, solo: false, blocks: [], ...fields }
}
function block(id: string, pitches: number[], starts: number[], durations?: number[]): Block {
  return { id, startBar: 0, durationBars: 8, loop: false, notes: pitches.map((pitch, index) => ({
    id: `${id}-${index}`, pitch, startBeat: starts[index], durationBeats: durations?.[index] ?? .25, velocity: 100,
  })) }
}
function projectFor(spec: Spec): ProjectSnapshot {
  const tracks: Record<string, Track> = {
    particle: track('particle', { instrumentId: 'particle', childIds: ['a', 'b', 'c', ...(spec.nested ? [] : ['mover'])],
      params: { size: .007, tfX: .2, tfY: -.3, tfRotY: 17, tfRotZ: 11 }, stringParams: { color: '#84ccfa' } }),
  }
  ;['a', 'b', 'c'].forEach((id, index) => {
    tracks[id] = track(id, { type: 'splitter', splitterId: 'radial', parentId: 'particle',
      inputValues: { copies: 32, radius: [2.1, .6, .17][index], plane: index, tilt: [31, 17, -23][index], size: [.9, .8, .7][index] },
      childIds: id === 'b' && spec.nested ? ['mover'] : [] })
  })
  const symmetric = spec.mover === 'symmetricMotion' || spec.mover === 'symmetricRotation'
  tracks.mover = track('mover', { type: 'mover', moverId: symmetric ? spec.mover : 'mover', parentId: spec.nested ? 'b' : 'particle',
    inputValues: spec.mover === 'symmetricMotion'
      ? { symmetry: 0, motion: 1, plane: 3, distance: .3, angle: 17, beats: 2 }
      : spec.mover === 'symmetricRotation'
        ? { mode: 2, drive: 0, axis: 2, axisYaw: 11, axisPitch: 23, centerX: .3, centerY: -.2, centerZ: .1,
          falloff: 2, span: 2, curve: 1.3, anchor: 0, twist: 17, fold: 29, roll: 13, angle: 1 }
        : { motion: spec.mover === 'orbit' ? 2 : 1, mode: 1, drive: 0,
          angleX: 17, angleY: 29, angleZ: 45, angle: 1, pivotX: .3, pivotY: -.2, pivotZ: .1 },
    blocks: spec.mover === 'symmetricMotion' ? [block('sym-notes', [60, 62], [0, 0], [8, 8])] : [] })
  if (spec.framed) {
    tracks.mover.childIds.push('frame')
    tracks.frame = track('frame', { type: 'mover', moverId: 'mover', parentId: 'mover',
      inputValues: { motion: 0, mode: 1, distanceX: .2, distanceY: .3, distanceZ: .1, distance: 1 },
      blocks: [block('frame-notes', [60, 62], [0, 0], [8, 8])] })
  }
  if (spec.cpuPrefix) {
    const prefix: string[] = []
    if (spec.cpuPrefix.includes('wave')) {
      prefix.push('wave')
      tracks.wave = track('wave', { type: 'mover', moverId: 'waveTerrain', parentId: 'particle',
        inputValues: { shape: 3, amplitude: .6, wavelength: 3.2, cyclesPerBeat: .4, damping: 4, centerX: .2, centerY: -.3, separation: 2 } })
    }
    if (spec.cpuPrefix.includes('color')) {
      prefix.push('colorizer')
      tracks.colorizer = track('colorizer', { type: 'mover', moverId: 'calmHueRotate', parentId: 'particle',
        inputValues: { intensity: .6, attackBeats: .3, releaseBeats: .5, staggerBeats: .015, rainbowRate: .2, rainbowSpread: .12 },
        blocks: [block('colors', [60, 61, 62], [0, 0, 3], [3, 8, 4])] })
    }
    // Only the first Radial's 32 slots pass through these arbitrary movers;
    // the two later Radials remain a factored suffix of 1,024 copies per seed.
    tracks.particle.childIds.splice(1, 0, ...prefix)
  }
  const laneIds: string[] = []
  spec.params?.forEach((param, index) => {
    const id = `lane-${index}`, parentId = spec.laneParent!
    const range = param.startsWith('angle') ? { min: 5, max: 65 } : param.startsWith('distance') ? { min: .05, max: .55 } : { min: -1, max: 1 }
    laneIds.push(id)
    tracks[id] = track(id, { type: 'automation', parentId, targetParam: param, interpolation: 'linear',
      automationRange: range, blocks: [block(id, index === 0 ? [36, 84, 48] : [72, 36, 84], [0, 2.5, 5])] })
    if (parentId !== 'particle') tracks[parentId].childIds.push(id)
  })
  if (spec.laneParent === 'particle') {
    const at = spec.particleLanePosition === 'before' ? 0 : spec.particleLanePosition === 'middle' ? 1 : tracks.particle.childIds.length
    tracks.particle.childIds.splice(at, 0, ...laneIds)
  }
  return { tracks, rootTrackIds: ['particle'], beatsPerBar: 4, bpm: 120, totalBars: 8 }
}
function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b)
  const percentile = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]
  return { samples: values.length, medianMs: percentile(.5), p95Ms: percentile(.95), maxMs: percentile(1), meanMs: values.reduce((sum, value) => sum + value, 0) / values.length }
}
function snapshot(engine: ReturnType<typeof createVisualEngine>, beat: number) {
  engine.computeAtBeat(beat)
  const state = engine.getObjectState('particle')!
  return { beat, world: [...state.world.elements], objectOpacity: state.opacity, meshScale: state.meshScale,
    copies: indices.map(index => {
      const copy = engine.getVisualCopy('particle', index)!
      assert(copy.transform.elements.every(Number.isFinite))
      return { index, matrix: [...copy.transform.elements], opacity: copy.opacity, colorShift: { ...copy.colorShift } }
    }) }
}
function run(spec: Spec) {
  globalThis.gc?.()
  const project = projectFor(spec), engine = createVisualEngine()
  const initialHeap = process.memoryUsage().heapUsed, resolveStart = performance.now()
  engine.setProject(project)
  const resolveMs = performance.now() - resolveStart, resolveHeapDeltaBytes = process.memoryUsage().heapUsed - initialHeap
  engine.computeAtBeat(0)
  assert.equal(engine.getVisualCopyCount('particle'), COPIES)
  const sceneId = engine.getObjectList().find(entry => entry.trackId === 'particle')!.sceneId
  for (let frame = 0; frame < warmup; frame++) engine.computeAtBeat(frame / 30)
  const timings: number[] = []
  for (let frame = 0; frame < samples; frame++) {
    const start = performance.now()
    engine.computeAtBeat(1 + frame / 30)
    timings.push(performance.now() - start)
  }
  const transforms = beats.map(beat => snapshot(engine, beat))
  assert.deepEqual(transforms[0], transforms.at(-1), 'Seeking must reproduce the same frame exactly')
  assert.notDeepEqual(transforms[0].copies, transforms[1].copies, 'Fixture motion must animate')
  // Evaluate the actual resolved chain once outside timing. This deliberately
  // expands even a compact case, providing an independent compiler reference.
  engine.computeAtBeat(1.25)
  const resolved = resolveProject(project).objects[0]
  const reference = resolveVisualCopies(resolved.moverAndSplitterChain, 1.25, engine.getObjectState('particle')!.world)
  assert.equal(reference.length, COPIES)
  let referenceMaxMatrixDifference = 0
  transforms[1].copies.forEach(copy => {
    const prior = reference[copy.index]
    assert.equal(copy.opacity, prior.opacity)
    assert.deepEqual(copy.colorShift, prior.colorShift)
    copy.matrix.forEach((value, index) => { referenceMaxMatrixDifference = Math.max(referenceMaxMatrixDifference, Math.abs(value - prior.transform.elements[index])) })
  })
  assert(referenceMaxMatrixDifference < 1e-9)
  // Distinguish accepted automation from authored but unsupported lane targets.
  let automationAffectsOutput: boolean | null = null
  if (spec.params?.length) {
    const noAutomation = createVisualEngine()
    noAutomation.setProject(projectFor({ ...spec, params: [] }))
    automationAffectsOutput = JSON.stringify(snapshot(noAutomation, 1.25)) !== JSON.stringify(transforms[1])
  }
  const plan = engine.getParticlePlan('particle')
  const contracts = resolved.moverAndSplitterChain.map(entry => ({
    local: !!(entry.localTransforms || entry.localTransformsAtBeat || entry.localLayout || entry.localLayoutAtBeat),
    root: !!(entry.rootTransform || entry.rootTransformAtBeat), framed: !!entry.framedLocalTransformsAtBeat,
    localSlotMotion: !!entry.localSlotMotion, privateClocks: !!entry.emitsCopyClocks, cachePolicy: entry.cachePolicy ?? null,
    gpuOperation: 'gpuOperationAtBeat' in entry,
  }))
  return { id: spec.id, spec, project, logicalCopies: engine.getVisualCopyCount('particle'), expandedCopies: engine.getVisualCopies('particle').length,
    objectListEntries: engine.getObjectList().filter(entry => entry.trackId === 'particle').length,
    compact: !!plan, framedProgram: !!plan?.program, direct: engine.isDirectParticleScene(sceneId),
    planStorageBytes: plan?.matrices.byteLength ?? 0, resolveMs, resolveHeapDeltaBytes, contracts,
    cpuPrefixCount: (plan as { cpuPrefix?: { count: number } } | undefined)?.cpuPrefix?.count ?? 0,
    compute: stats(timings), computeSamplesMs: timings, referenceMaxMatrixDifference, automationAffectsOutput, transforms }
}
const fixtures = specs.filter(spec => selected.length === 0 || selected.includes(spec.id)).map(spec => {
  const result = run(spec)
  console.log(`${result.id}: median ${result.compute.medianMs.toFixed(4)}ms / p95 ${result.compute.p95Ms.toFixed(4)}ms; compact ${result.compact}; expanded ${result.expandedCopies}; automation affects output ${result.automationAffectsOutput}`)
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
      const prior = previous.transforms[frameIndex]
      assert.deepEqual(frame.world, prior.world)
      assert.equal(frame.objectOpacity, prior.objectOpacity)
      assert.equal(frame.meshScale, prior.meshScale)
      frame.copies.forEach((copy, copyIndex) => {
        const before = prior.copies[copyIndex]
        assert.equal(copy.index, before.index); assert.equal(copy.opacity, before.opacity)
        assert.deepEqual(copy.colorShift, before.colorShift)
        copy.matrix.forEach((value, index) => { maxMatrixDifference = Math.max(maxMatrixDifference, Math.abs(value - before.matrix[index])) })
      })
    })
    assert(maxMatrixDifference < 1e-9, `${current.id}: matrix error ${maxMatrixDifference}`)
    return { id: current.id, medianSpeedRatio: previous.compute.medianMs / current.compute.medianMs,
      p95SpeedRatio: previous.compute.p95Ms / current.compute.p95Ms, resolveSpeedRatio: previous.resolveMs / current.resolveMs, maxMatrixDifference }
  })
}
const result = { description: 'CPU-only automation/mover evaluation using the production document engine. Excludes rendering, uploads, GPU work and FPS.',
  timestamp: new Date().toISOString(), revision: option('--revision', '') || gitInfo(['rev-parse', 'HEAD'], '(unknown)'),
  sourceStatus: gitInfo(['status', '--short'], '(archive without .git)'),
  environment: { node: process.version, platform: platform(), release: release(), arch: process.arch, cpu: cpus()[0]?.model, nodeEnv: process.env.NODE_ENV ?? '(unset)', explicitGc: !!globalThis.gc },
  settings: { samples, warmup, bpm: 120, frameBeatStep: 1 / 30, copies: COPIES }, fixtures, ...(comparison ? { comparison } : {}) }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(`Saved ${output}`)
