// The Wireframe instrument's pure half: the shape catalog and its polyline
// geometry, shared verbatim by the R3F component (as LineSegments2 positions)
// and the settings panel's canvas previews - one source, so the shelf cannot
// drift from what renders. Type-only sibling of Wireframe.tsx so tests can
// import it without tripping the instruments/index circular-init crash.

export type WireframePoint = [number, number, number]
export type WireframePolyline = WireframePoint[]
export type WireframeCategory = '2d' | '3d' | 'cool'

export interface WireframeShapeDef {
  id: string
  name: string
  category: WireframeCategory
  /** detail is the quantized step from `wireframeDetailStep` (0..DETAIL_STEPS). */
  build: (detail: number) => WireframePolyline[]
}

/** The DETAIL knob (0..1) quantized to rebuild-worthy steps, so the geometry
 *  swap happens a handful of times across the knob's travel instead of on
 *  every drag frame. */
export const WIREFRAME_DETAIL_STEPS = 6
export function wireframeDetailStep(detail: number): number {
  return Math.max(0, Math.min(WIREFRAME_DETAIL_STEPS, Math.round(detail * WIREFRAME_DETAIL_STEPS)))
}

const TAU = Math.PI * 2
const PHI = (1 + Math.sqrt(5)) / 2

/** Segment counts for a detail step: t=0 is the coarse look, t=1 the smooth one. */
function counts(step: number) {
  const t = step / WIREFRAME_DETAIL_STEPS
  return {
    circle: Math.round(20 + t * 52),
    latRings: Math.round(3 + t * 4),
    meridians: Math.round(4 + t * 6),
    curve: Math.round(72 + t * 168),
    tubeRings: Math.round(6 + t * 6),
    rungs: Math.round(8 + t * 8),
  }
}

function ring(n: number, f: (t: number) => WireframePoint): WireframePolyline {
  const points: WireframePolyline = []
  for (let i = 0; i <= n; i++) points.push(f((i / n) * TAU))
  return points
}

const flat = (f: (t: number) => [number, number]) => (t: number): WireframePoint => {
  const [x, y] = f(t)
  return [x, y, 0]
}

/** Platonic solids as vertices + shortest-distance edges: every pair at the
 *  minimum pairwise distance is an edge, which holds for all five solids. */
function edgesFromVertices(vertices: WireframePoint[]): WireframePolyline[] {
  const dist = (a: WireframePoint, b: WireframePoint) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  let min = Infinity
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++) min = Math.min(min, dist(vertices[i], vertices[j]))
  const edges: WireframePolyline[] = []
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      if (dist(vertices[i], vertices[j]) < min * 1.05) edges.push([vertices[i], vertices[j]])
  return edges
}

function signPermutations([x, y, z]: WireframePoint): WireframePoint[] {
  const out: WireframePoint[] = []
  for (let s = 0; s < 8; s++) out.push([x * (s & 1 ? -1 : 1), y * (s & 2 ? -1 : 1), z * (s & 4 ? -1 : 1)])
  return out
}

function cyclicPermutations([x, y, z]: WireframePoint): WireframePoint[] {
  return [[x, y, z], [y, z, x], [z, x, y]]
}

function dedupe(vertices: WireframePoint[]): WireframePoint[] {
  const seen = new Set<string>()
  const out: WireframePoint[] = []
  for (const v of vertices) {
    const key = v.map((c) => c.toFixed(4)).join(',')
    if (!seen.has(key)) { seen.add(key); out.push(v) }
  }
  return out
}

/** Scale every polyline so the farthest point sits at radius 1. */
function normalize(lines: WireframePolyline[]): WireframePolyline[] {
  let max = 0
  for (const line of lines) for (const p of line) max = Math.max(max, Math.hypot(p[0], p[1], p[2]))
  if (max === 0) return lines
  return lines.map((line) => line.map((p): WireframePoint => [p[0] / max, p[1] / max, p[2] / max]))
}

function regularPolygon(sides: number, phase: number): WireframePolyline[] {
  return [ring(sides, flat((t) => [Math.cos(t + phase), Math.sin(t + phase)]))]
}

/**
 * The catalog. APPEND-ONLY: a track stores the shape as its index in this
 * list (a select param), so inserting or reordering would silently re-shape
 * every saved project. `wireframeCore.test.ts` pins the id order.
 */
export const WIREFRAME_SHAPES: readonly WireframeShapeDef[] = [
  { id: 'circle', name: 'Circle', category: '2d', build: (d) => [ring(counts(d).circle, flat((t) => [Math.cos(t), Math.sin(t)]))] },
  { id: 'triangle', name: 'Triangle', category: '2d', build: () => regularPolygon(3, -Math.PI / 2) },
  { id: 'square', name: 'Square', category: '2d', build: () => regularPolygon(4, Math.PI / 4) },
  { id: 'pentagon', name: 'Pentagon', category: '2d', build: () => regularPolygon(5, -Math.PI / 2) },
  { id: 'hexagon', name: 'Hexagon', category: '2d', build: () => regularPolygon(6, 0) },
  { id: 'star', name: 'Star', category: '2d', build: () => {
    const points: WireframePolyline = []
    for (let i = 0; i <= 10; i++) {
      const r = i % 2 ? 0.45 : 1
      const t = (i / 10) * TAU - Math.PI / 2
      points.push([r * Math.cos(t), r * Math.sin(t), 0])
    }
    return [points]
  } },
  { id: 'squircle', name: 'Squircle', category: '2d', build: (d) => {
    const soft = (v: number) => Math.sign(v) * Math.abs(v) ** 0.5
    return [ring(counts(d).circle, flat((t) => [soft(Math.cos(t)), soft(Math.sin(t))]))]
  } },
  { id: 'tetrahedron', name: 'Tetrahedron', category: '3d', build: () =>
    edgesFromVertices([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]) },
  { id: 'cube', name: 'Cube', category: '3d', build: () => edgesFromVertices(signPermutations([1, 1, 1])) },
  { id: 'octahedron', name: 'Octahedron', category: '3d', build: () =>
    edgesFromVertices(dedupe([[1, 0, 0], [0, 1, 0], [0, 0, 1]].flatMap((v) => signPermutations(v as WireframePoint)))) },
  { id: 'icosahedron', name: 'Icosahedron', category: '3d', build: () =>
    edgesFromVertices(dedupe(cyclicPermutations([0, 1, PHI]).flatMap(signPermutations))) },
  { id: 'dodecahedron', name: 'Dodecahedron', category: '3d', build: () =>
    edgesFromVertices(dedupe([
      ...signPermutations([1, 1, 1]),
      ...cyclicPermutations([0, 1 / PHI, PHI]).flatMap(signPermutations),
    ])) },
  { id: 'sphere', name: 'Sphere', category: '3d', build: (d) => {
    const { latRings, meridians, circle } = counts(d)
    const lines: WireframePolyline[] = []
    for (let i = 1; i <= latRings; i++) {
      const phi = (i / (latRings + 1)) * Math.PI
      const r = Math.sin(phi)
      const y = Math.cos(phi)
      lines.push(ring(circle, (t) => [r * Math.cos(t), y, r * Math.sin(t)]))
    }
    for (let j = 0; j < meridians; j++) {
      const a = (j / meridians) * Math.PI
      lines.push(ring(circle, (t) => {
        const r = Math.sin(t)
        return [r * Math.cos(a), Math.cos(t), r * Math.sin(a)]
      }))
    }
    return lines
  } },
  { id: 'torus', name: 'Torus', category: '3d', build: (d) => {
    const R = 0.72, r = 0.34
    const { tubeRings, circle } = counts(d)
    const lines: WireframePolyline[] = []
    for (let i = 0; i < tubeRings; i++) {
      const u = (i / tubeRings) * TAU
      lines.push(ring(16, (v) => [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]))
    }
    for (let k = 0; k < 4; k++) {
      const v = (k / 4) * TAU
      lines.push(ring(circle, (u) => [(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]))
    }
    return lines
  } },
  { id: 'cone', name: 'Cone', category: '3d', build: (d) => {
    const lines: WireframePolyline[] = [ring(counts(d).circle, (t) => [Math.cos(t), -0.8, Math.sin(t)])]
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * TAU
      lines.push([[Math.cos(t), -0.8, Math.sin(t)], [0, 1, 0]])
    }
    return lines
  } },
  { id: 'cylinder', name: 'Cylinder', category: '3d', build: (d) => {
    const { circle, rungs } = counts(d)
    const lines: WireframePolyline[] = [
      ring(circle, (t) => [Math.cos(t), -0.9, Math.sin(t)]),
      ring(circle, (t) => [Math.cos(t), 0.9, Math.sin(t)]),
    ]
    for (let i = 0; i < rungs; i++) {
      const t = (i / rungs) * TAU
      lines.push([[Math.cos(t), -0.9, Math.sin(t)], [Math.cos(t), 0.9, Math.sin(t)]])
    }
    return lines
  } },
  { id: 'torusKnot', name: 'Torus Knot', category: 'cool', build: (d) => [
    ring(counts(d).curve, (t) => {
      const r = Math.cos(3 * t) + 2
      return [r * Math.cos(2 * t), -Math.sin(3 * t), r * Math.sin(2 * t)]
    }),
  ] },
  { id: 'mobius', name: 'Möbius', category: 'cool', build: (d) => {
    const { circle, rungs } = counts(d)
    const at = (u: number, w: number): WireframePoint => {
      const r = 1 + w * Math.cos(u / 2)
      return [r * Math.cos(u), w * Math.sin(u / 2), r * Math.sin(u)]
    }
    const lines: WireframePolyline[] = [-0.32, 0, 0.32].map((w) => ring(circle, (u) => at(u, w)))
    for (let i = 0; i < rungs; i++) {
      const u = (i / rungs) * TAU
      lines.push([at(u, -0.32), at(u, 0.32)])
    }
    return lines
  } },
  { id: 'spiral', name: 'Spiral', category: 'cool', build: (d) => {
    const n = counts(d).curve
    const points: WireframePolyline = []
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 3 * TAU
      const r = t / (3 * TAU)
      points.push([r * Math.cos(t), r * Math.sin(t), 0])
    }
    return [points]
  } },
  { id: 'helix', name: 'Helix', category: 'cool', build: (d) => {
    const n = counts(d).curve
    const points: WireframePolyline = []
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * 4 * TAU
      points.push([0.7 * Math.cos(t), (i / n) * 2 - 1, 0.7 * Math.sin(t)])
    }
    return [points]
  } },
  { id: 'lissajous', name: 'Lissajous', category: 'cool', build: (d) => [
    ring(counts(d).curve, (t) => [Math.sin(3 * t + Math.PI / 2), Math.sin(2 * t), Math.sin(5 * t) * 0.35]),
  ] },
  { id: 'gem', name: 'Gem', category: 'cool', build: () => {
    const top: WireframePoint = [0, 1.15, 0]
    const bottom: WireframePoint = [0, -1.15, 0]
    const upper: WireframePoint[] = []
    const lower: WireframePoint[] = []
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * TAU
      upper.push([Math.cos(t), 0.35, Math.sin(t)])
      lower.push([0.7 * Math.cos(t + Math.PI / 6), -0.35, 0.7 * Math.sin(t + Math.PI / 6)])
    }
    const lines: WireframePolyline[] = []
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      lines.push([upper[i], upper[j]], [lower[i], lower[j]], [top, upper[i]], [bottom, lower[i]], [upper[i], lower[i]], [upper[j], lower[i]])
    }
    return lines
  } },
]

export const WIREFRAME_DEFAULT_SHAPE = WIREFRAME_SHAPES.findIndex((s) => s.id === 'sphere')

/** A shape's polylines at a detail step, normalized to unit radius. */
export function wireframeGeometry(shapeIndex: number, detailStep: number): WireframePolyline[] {
  const shape = WIREFRAME_SHAPES[Math.max(0, Math.min(WIREFRAME_SHAPES.length - 1, Math.round(shapeIndex)))]
  return normalize(shape.build(detailStep))
}

/** Flatten polylines into LineSegmentsGeometry.setPositions layout:
 *  consecutive point pairs, 6 floats per segment. */
export function wireframeSegmentPositions(lines: WireframePolyline[]): Float32Array {
  let segments = 0
  for (const line of lines) segments += Math.max(0, line.length - 1)
  const out = new Float32Array(segments * 6)
  let o = 0
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      out[o++] = line[i][0]; out[o++] = line[i][1]; out[o++] = line[i][2]
      out[o++] = line[i + 1][0]; out[o++] = line[i + 1][1]; out[o++] = line[i + 1][2]
    }
  }
  return out
}

/** A shape's idle rotation at a beat - the pure function the pause canary
 *  demands. Flat shapes turn in their own plane; solids turn about Y under a
 *  fixed presentation tilt (applied by the component, not here). SPIN is
 *  signed turns per 4 beats (one bar in 4/4): 0 parks the shape. */
export function wireframeSpinAngle(beat: number, spin: number): number {
  return beat * spin * (TAU / 4)
}

/** Whether a shape reads as flat (rotates in-plane rather than tumbling). */
export function wireframeIsFlat(shapeIndex: number): boolean {
  const shape = WIREFRAME_SHAPES[Math.max(0, Math.min(WIREFRAME_SHAPES.length - 1, Math.round(shapeIndex)))]
  return shape.category === '2d' || shape.id === 'spiral'
}
