/** Cubic Bézier nodes in world space. Handles are absolute XYZ positions. */
export type PathPoint = [number, number, number]
export interface GradientNode { point: PathPoint; incoming: PathPoint; outgoing: PathPoint }
export const DEFAULT_GRADIENT_PATH = JSON.stringify([
  { point: [-3, 0, 0], incoming: [-4, 0, 0], outgoing: [-1, 0, 0] },
  { point: [3, 0, 0], incoming: [1, 0, 0], outgoing: [4, 0, 0] },
])
const validPoint = (p: unknown): p is PathPoint => Array.isArray(p) && p.length === 3 && p.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10000)
export function parseGradientPath(raw?: string): GradientNode[] {
  try {
    const nodes = JSON.parse(raw ?? DEFAULT_GRADIENT_PATH)
    if (Array.isArray(nodes) && nodes.length >= 2 && nodes.length <= 64 && nodes.every(n => n && validPoint(n.point) && validPoint(n.incoming) && validPoint(n.outgoing))) return nodes
  } catch { /* Invalid persisted input restores the default path. */ }
  return JSON.parse(DEFAULT_GRADIENT_PATH)
}
export function buildGradientPath(raw?: string, curved = false) {
  const nodes = parseGradientPath(raw)
  const points: PathPoint[] = [nodes[0].point]
  if (!curved) points.push(nodes[nodes.length - 1].point)
  else for (let n = 1; n < nodes.length; n++) {
    const a = nodes[n - 1], b = nodes[n]
    for (let i = 1; i <= 64; i++) {
      const t = i / 64, u = 1 - t
      points.push([0, 1, 2].map(k => u*u*u*a.point[k] + 3*u*u*t*a.outgoing[k] + 3*u*t*t*b.incoming[k] + t*t*t*b.point[k]) as PathPoint)
    }
  }
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i-1] + Math.hypot(...points[i].map((v,k) => v - points[i-1][k])))
  return { points, lengths, total: lengths[lengths.length-1] }
}
export function sampleGradientPath(path: ReturnType<typeof buildGradientPath>, x: number, y: number, z: number, distance: boolean, width: number): number {
  let best = Infinity, along = 0
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i-1], b = path.points[i]
    const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2]
    const squared=dx*dx+dy*dy+dz*dz
    const t = squared < 1e-16 ? 0 : Math.max(0, Math.min(1, ((x-a[0])*dx+(y-a[1])*dy+(z-a[2])*dz)/squared))
    const d=(x-a[0]-t*dx)**2+(y-a[1]-t*dy)**2+(z-a[2]-t*dz)**2
    if (d < best) { best=d; along=path.lengths[i-1]+t*Math.sqrt(squared) }
  }
  return distance ? Math.sqrt(best)/Math.max(0.001,width) : path.total < 1e-8 ? 0.5 : along/path.total
}
