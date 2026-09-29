import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Track } from '../../src/editor/types'
import type { ProjectSnapshot } from '../../src/editor/core/visual/resolve'
import type { createVisualEngine } from '../../src/editor/core/visual/VisualEngineInstance'

// Run from any directory: node --import tsx scripts/perf/export-effects-cpu.ts
// This measures CPU evaluation only. The baseline restores the former effect
// eligibility predicate in a temporary snapshot of the CURRENT engine, so
// unrelated local optimizations are present on both sides of the comparison.
const root = resolve(__dirname, '../..')
const sourcePath = join(root, 'src/editor/core/visual/VisualEngineInstance.ts')
const outputPath = join(root, 'artifacts/export-performance/effects-cpu-profile.json')
const requireFromRepo = createRequire(join(root, 'package.json'))
const frameCount = 180, rounds = 5, warmupFrames = 60

function fixture(count: number, stacked: boolean): ProjectSnapshot {
  const p: Track = { id: 'p', name: 'Particle', instrumentId: 'particle', type: 'base', color: '#fff',
    childIds: stacked ? ['grid', 'motion', 'grid2'] : ['grid', 'motion'], muted: false, solo: false,
    blocks: [], params: { size: .01 }, effects: [{ id: 'off', pluginId: 'glow', enabled: false, settings: {} }] }
  const grid: Track = { ...p, id: 'grid', instrumentId: '', type: 'splitter', splitterId: 'grid',
    parentId: 'p', childIds: [], effects: [], inputValues: stacked
      ? { rows: count === 4096 ? 8 : 16, columns: count === 32768 ? 16 : 8, depth: 1, spacing: .2 }
      : { rows: count === 4096 ? 16 : 32, columns: count === 4096 ? 16 : 32, depth: count === 32768 ? 32 : 16, spacing: .2 } }
  const grid2: Track = { ...grid, id: 'grid2', inputValues: { rows: count === 4096 ? 8 : 16, columns: 8, depth: 1, spacing: .005 } }
  const motion: Track = { ...grid, id: 'motion', type: 'mover', splitterId: undefined, moverId: 'mover',
    inputValues: { motion: 2, mode: 1, drive: 0, angleZ: 45 },
    blocks: [{ id: 'b', startBar: 0, durationBars: 16, loop: false,
      notes: [{ id: 'n', pitch: 60, velocity: 100, startBeat: 0, durationBeats: 64 }] }] }
  return { tracks: { p, grid, ...(stacked ? { grid2 } : {}), motion }, rootTrackIds: ['p'], beatsPerBar: 4, bpm: 120, totalBars: 16 }
}

async function main() {
  const source = await readFile(sourcePath, 'utf8')
  const needle = '!hasUnbatchableEffects(tracks, obj.trackId)'
  assert.equal(source.split(needle).length, 2, 'Expected exactly one plan eligibility site')
  const baseline = source.replace(needle, `!(() => {
    if (tracks[obj.trackId]?.effects?.some(effect => effect.pluginId !== 'scale')) return true
    for (let parent = tracks[obj.trackId]?.parentId; parent; parent = tracks[parent]?.parentId) {
      if (tracks[parent]?.type === 'group' && tracks[parent]?.effects?.length) return true
    }
    return false
  })()`)
  // Resolve imports from the original source location; the temporary engine
  // never writes into core/ or changes the user's working source files.
  const isolated = baseline.replace(/from\s+(['"])([^'"]+)\1/g, (_match, _quote, specifier: string) =>
    `from ${JSON.stringify(specifier.startsWith('.')
      ? resolve(dirname(sourcePath), specifier) : requireFromRepo.resolve(specifier))}`)
  const temporary = await mkdtemp(join(tmpdir(), 'cabin-export-effects-'))
  try {
    const baselinePath = join(temporary, 'baseline.ts')
    await writeFile(baselinePath, isolated)
    const before = await import(pathToFileURL(baselinePath).href) as { createVisualEngine: typeof createVisualEngine }
    const after = await import(pathToFileURL(sourcePath).href) as { createVisualEngine: typeof createVisualEngine }
    const results = []
    for (const stacked of [false, true]) for (const count of [4096, 16384, 32768]) {
      const document = fixture(count, stacked)
      const engines = [before.createVisualEngine(), after.createVisualEngine()]
      for (const engine of engines) {
        engine.setProject(document)
        assert.equal(engine.getVisualCopyCount('p'), count)
        for (let i = 0; i < warmupFrames; i++) engine.computeAtBeat(i / 30)
      }
      const samples: number[][] = [[], []]
      for (let round = 0; round < rounds; round++) for (const index of round % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now()
        for (let i = 0; i < frameCount; i++) engines[index].computeAtBeat((i + round * frameCount) / 30)
        samples[index].push((performance.now() - start) / frameCount)
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
      const beforeMs = median(samples[0]), afterMs = median(samples[1])
      const result = { layout: stacked ? 'stacked-grids' : 'single-grid', count,
        beforeMs, afterMs, speedup: beforeMs / afterMs, samplesMs: samples,
        beforeObjectListEntries: engines[0].getObjectList().length,
        afterObjectListEntries: engines[1].getObjectList().length,
        proceduralPlan: !!engines[1].getParticlePlan('p') }
      results.push(result)
      console.log(JSON.stringify(result))
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, JSON.stringify({
      command: 'node --import tsx scripts/perf/export-effects-cpu.ts',
      recordedAt: new Date().toISOString(), node: process.version, platform: process.platform, architecture: process.arch,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      scope: 'CPU computeAtBeat only; excludes React mounting, GPU rendering, capture, encoding and muxing.',
      baseline: 'Current engine snapshot with the former effect eligibility predicate; identical disabled Glow documents.',
      statistic: 'Median milliseconds per frame; alternating execution order; 30fps beat increments.',
      frameCount, rounds, warmupFrames, results,
    }, null, 2) + '\n')
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

void main().catch(error => { console.error(error); process.exitCode = 1 })
