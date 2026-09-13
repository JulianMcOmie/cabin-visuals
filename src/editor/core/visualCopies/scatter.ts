import { Matrix4, Vector3 } from 'three'
import { sharedLocalLayout } from './sharedLocalLayout'
import type { MoverOrSplitterDefinition } from './definitions'
import { SCATTER_COLOR } from './identityColors'
import { applySplitterSize, splitterSize, SPLITTER_SIZE_PARAM } from './splitterSize'
import { countLaneRows, resolveCountLane } from './countLane'

export interface ScatterSettings {
  distribution: number
  copies: number
  spread: number
  seed: number
  clusters: number
  size: number
  plane: number
}
export const SCATTER_MAX_COPIES = 256
const bound = (n: number, min: number, max: number, fallback: number) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback))

/** A private integer PRNG: each resolve restarts from the saved seed. Never
 * consumes playback state, wall time, or another input copy's random stream. */
function randomStream(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let x = Math.imul(state ^ (state >>> 15), 1 | state)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}
type Point = [number, number]
const distanceSq = (a: Point, b: Point) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
function disk(random: () => number): Point {
  const r = Math.sqrt(random()), angle = random() * Math.PI * 2
  return [r * Math.cos(angle), r * Math.sin(angle)]
}

/** Stable progressive points: increasing COUNT retains the previous slots in
 * every mode. Even uses 24 best candidates per new slot (bounded O(N²)),
 * spreading points apart without a visible grid or an unbounded rejection loop. */
export function scatterPositions(settings: ScatterSettings): Vector3[] {
  const count = Math.round(bound(settings.copies, 1, SCATTER_MAX_COPIES, 64))
  const seed = Math.round(bound(settings.seed, 0, 65535, 1))
  const spread = bound(settings.spread, 0, 40, 3)
  const clusters = Math.round(bound(settings.clusters, 1, 8, 4))
  const random = randomStream(seed)
  const centerRandom = randomStream(seed ^ 0x51ed270b)
  const centers = Array.from({ length: clusters }, () => disk(centerRandom).map(v => v * .65) as Point)
  const points: Point[] = []
  for (let i = 0; i < count; i++) {
    let point = disk(random)
    if (settings.distribution === 1) {
      const center = centers[i % clusters]
      point = [center[0] + point[0] * .22, center[1] + point[1] * .22]
    } else if (settings.distribution === 2) {
      let bestDistance = -1
      for (let candidate = 0; candidate < 24; candidate++) {
        const sample = candidate === 0 ? point : disk(random)
        let nearest = Infinity
        for (const previous of points) nearest = Math.min(nearest, distanceSq(sample, previous))
        if (nearest > bestDistance) { bestDistance = nearest; point = sample }
      }
    }
    points.push(point)
  }
  return points.map(([x, y]) => settings.plane === 1 ? new Vector3(x * spread, 0, y * spread)
    : settings.plane === 2 ? new Vector3(0, x * spread, y * spread) : new Vector3(x * spread, y * spread, 0))
}
function resolveScatter(settings: ScatterSettings) {
  const transforms = scatterPositions(settings).map(p => applySplitterSize(new Matrix4().makeTranslation(p.x, p.y, p.z), splitterSize(settings.size)))
  // LOCAL placement: a preceding mover or splitter re-frames the whole cloud.
  return sharedLocalLayout({ transforms })
}
export const scatterSplitter: MoverOrSplitterDefinition<ScatterSettings> = {
  id: 'scatter', label: 'Scatter', kind: 'splitter', identityColor: SCATTER_COLOR,
  params: [
    { key: 'distribution', label: 'Distribution', type: 'select', options: [{ value: 0, label: 'Uniform' }, { value: 1, label: 'Clustered' }, { value: 2, label: 'Even' }], default: 2 },
    { key: 'copies', label: 'Copies', min: 1, max: SCATTER_MAX_COPIES, step: 1, integer: true, default: 64 },
    { key: 'spread', label: 'Spread', min: 0, max: 40, step: .1, default: 3 },
    { key: 'seed', label: 'Seed', min: 0, max: 65535, step: 1, integer: true, default: 1 },
    { key: 'clusters', label: 'Clusters', min: 1, max: 8, step: 1, integer: true, default: 4, showIf: 'distribution=1' },
    SPLITTER_SIZE_PARAM,
    { key: 'plane', label: 'Plane', type: 'select', options: [{ value: 0, label: 'XY' }, { value: 1, label: 'XZ' }, { value: 2, label: 'YZ' }], default: 0 },
  ],
  midiRows: () => countLaneRows(1, SCATTER_MAX_COPIES, 'copy', 'copies'), strictMidiRows: true,
  resolve({ settings, notes }) { return resolveCountLane({ settings, notes, key: 'copies', min: 1, max: SCATTER_MAX_COPIES, resolveAt: resolveScatter }) },
}
