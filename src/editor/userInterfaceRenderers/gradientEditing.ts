import { create } from 'zustand'
import type { GradientNode, PathPoint } from '../core/visualCopies/gradientPath'
export type HandleKind = 'point' | 'incoming' | 'outgoing'
export interface GradientEditSession { targetId: string; raw: string; curved: boolean; colorA: string; colorB: string; set: (raw: string) => void }
interface GradientEditingState { session: GradientEditSession | null; setSession: (session: GradientEditSession | null) => void }
export const useGradientEditing = create<GradientEditingState>((set) => ({ session: null, setSession: session => set({ session }) }))
export function moveGradientHandle(nodes: GradientNode[], index: number, kind: HandleKind, point: PathPoint) {
  return nodes.map((node, i) => {
    if (i !== index) return node
    if (kind !== 'point') return { ...node, [kind]: point }
    const shift = (p: PathPoint) => p.map((v,k) => v + point[k] - node.point[k]) as PathPoint
    return { point, incoming: shift(node.incoming), outgoing: shift(node.outgoing) }
  })
}
export function splitGradientSegment(nodes: GradientNode[], index: number, t = 0.5) {
  if (nodes.length >= 64) return nodes
  const a=nodes[index], b=nodes[index+1]
  const lerp=(p:PathPoint,q:PathPoint) => p.map((v,k) => v+(q[k]-v)*t) as PathPoint
  const p=lerp(a.point,a.outgoing), q=lerp(a.outgoing,b.incoming), r=lerp(b.incoming,b.point)
  const u=lerp(p,q), v=lerp(q,r), point=lerp(u,v)
  return [...nodes.slice(0,index), {...a,outgoing:p}, {point,incoming:u,outgoing:v}, {...b,incoming:r}, ...nodes.slice(index+2)]
}
