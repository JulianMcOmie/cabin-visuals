import { useRef, type ReactElement } from 'react'
import { Mesh, MeshStandardMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { compileExpr, type RenderSpec, type Compiled, type Scope, type Primitive, type Expr } from '../core/visual/renderSpec'
import type { ObjectInstrumentDef, ParamDef, LocalTransform, TransformCtx } from './types'

const ZERO: Compiled = () => 0
const ONE: Compiled = () => 1

const compileVec = (v: [Expr, Expr, Expr] | undefined, def: Compiled): [Compiled, Compiled, Compiled] =>
  v ? [compileExpr(v[0]), compileExpr(v[1]), compileExpr(v[2])] : [def, def, def]

// R3F renders every Three geometry as a lowercase intrinsic. Base sizes are chosen so
// a scale of ~1 lands near the Cube's on-screen size.
function primitiveGeometry(primitive: Primitive): ReactElement {
  switch (primitive) {
    case 'box': return <boxGeometry args={[1.6, 1.6, 1.6]} />
    case 'sphere': return <sphereGeometry args={[0.9, 32, 24]} />
    case 'plane': return <planeGeometry args={[1.6, 1.6]} />
    case 'tetrahedron': return <tetrahedronGeometry args={[1.1]} />
    case 'cone': return <coneGeometry args={[1, 1.8, 32]} />
    case 'circle': return <circleGeometry args={[0.9, 48]} />
  }
}

interface CompiledAppearance {
  hue: Compiled | null
  emissive: Compiled | null
  opacity: Compiled | null
}

/** The generic renderer for a RenderSpec object: the world transform + blackout are
 *  applied by ObjectRenderer's placement group (this mesh sits at local origin); the
 *  appearance bindings are evaluated onto the material each frame. */
function SpecRenderer({ trackId, primitive, appearance, paramDefaults }: { trackId: string; primitive: Primitive; appearance: CompiledAppearance; paramDefaults: Record<string, number> }) {
  const meshRef = useRef<Mesh>(null)
  useInstrumentFrame(trackId, (state) => {
    if (!meshRef.current) return
    const mat = meshRef.current.material as MeshStandardMaterial
    // Overlay the track's explicit params over the instrument's defaults, so an
    // unset param reads its default (not 0) — a fresh track has no params yet.
    const scope: Scope = { param: { ...paramDefaults, ...state.params }, port: { energy: state.energy }, beat: state.beat }
    if (appearance.hue) mat.color.setHSL(((appearance.hue(scope) % 360) + 360) % 360 / 360, 0.65, 0.6)
    if (appearance.emissive) mat.emissiveIntensity = appearance.emissive(scope)
    if (appearance.opacity) { mat.transparent = true; mat.opacity = appearance.opacity(scope) }
  })
  return (
    <mesh ref={meshRef}>
      {primitiveGeometry(primitive)}
      <meshStandardMaterial color="#6366f1" metalness={0.4} roughness={0.35} emissive="#312e81" emissiveIntensity={0.2} />
    </mesh>
  )
}

/**
 * Turn a RenderSpec into a normal ObjectInstrumentDef: the transform bindings compile
 * into the def's `localTransform` (so the engine composes it down the hierarchy exactly
 * like the Cube's), and the appearance bindings drive a bound SpecRenderer. Expressions
 * are compiled once here, evaluated per frame. No ObjectRenderer change — a spec is just
 * a def whose component happens to be the interpreter.
 */
export function specInstrument(opts: {
  id: string
  name: string
  params: ParamDef[]
  spec: RenderSpec
}): ObjectInstrumentDef {
  const { spec } = opts

  // Defaults for every param, so an unset param evaluates to its default (not 0).
  const paramDefaults: Record<string, number> = {}
  for (const p of opts.params) if (typeof p.default === 'number') paramDefaults[p.key] = p.default

  const [px, py, pz] = compileVec(spec.transform?.position, ZERO)
  const [rx, ry, rz] = compileVec(spec.transform?.rotation, ZERO)
  let sx: Compiled, sy: Compiled, sz: Compiled
  const sc = spec.transform?.scale
  if (typeof sc === 'string') { const s = compileExpr(sc); sx = sy = sz = s }
  else if (sc) { [sx, sy, sz] = compileVec(sc, ONE) }
  else { sx = sy = sz = ONE }

  const localTransform = (ctx: TransformCtx): LocalTransform => {
    const s: Scope = { param: { ...paramDefaults, ...ctx.params }, port: { energy: ctx.energy }, beat: ctx.beat }
    return {
      position: [px(s), py(s), pz(s)],
      rotation: [rx(s), ry(s), rz(s)],
      scale: [sx(s), sy(s), sz(s)],
    }
  }

  const appearance: CompiledAppearance = {
    hue: spec.appearance?.hue ? compileExpr(spec.appearance.hue) : null,
    emissive: spec.appearance?.emissive ? compileExpr(spec.appearance.emissive) : null,
    opacity: spec.appearance?.opacity ? compileExpr(spec.appearance.opacity) : null,
  }

  const Component = ({ trackId }: { trackId: string }) => (
    <SpecRenderer trackId={trackId} primitive={spec.primitive} appearance={appearance} paramDefaults={paramDefaults} />
  )

  return { id: opts.id, name: opts.name, kind: 'object', params: opts.params, localTransform, component: Component }
}
