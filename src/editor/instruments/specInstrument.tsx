import { useRef, type ReactElement } from 'react'
import { Mesh, MeshPhysicalMaterial } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { setAnimatedOpacity } from '../core/visual/animatedOpacity'
import { compileExpr, type RenderSpec, type Compiled, type Scope, type Primitive, type Expr } from '../core/visual/renderSpec'
import type { ObjectInstrumentDef, ParamDef, MidiRowDef, LocalTransform, TransformCtx } from './types'

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
interface DirectColorParam {
  key: string
  default: string
  legacyHueParam?: string
}

export interface MaterialPreset {
  metalness?: number
  roughness?: number
  clearcoat?: number
  clearcoatRoughness?: number
  iridescence?: number
  iridescenceIOR?: number
  envMapIntensity?: number
  flatShading?: boolean
}

function SpecRenderer({ trackId, primitive, appearance, paramDefaults, colorParam, material }: {
  trackId: string
  primitive: Primitive
  appearance: CompiledAppearance
  paramDefaults: Record<string, number>
  colorParam?: DirectColorParam
  material: MaterialPreset
}) {
  const meshRef = useRef<Mesh>(null)
  useInstrumentFrame(trackId, (state) => {
    if (!meshRef.current) return false
    const mat = meshRef.current.material as MeshPhysicalMaterial
    // Overlay the track's explicit params over the instrument's defaults, so an
    // unset param reads its default (not 0) - a fresh track has no params yet.
    const scope: Scope = { param: { ...paramDefaults, ...state.params }, port: { energy: state.energy }, beat: state.beat }
    if (colorParam) {
      const directColor = state.stringParams[colorParam.key]
      const legacyHue = colorParam.legacyHueParam ? state.params[colorParam.legacyHueParam] : undefined
      if (directColor) mat.color.set(directColor)
      else if (legacyHue !== undefined) mat.color.setHSL(((legacyHue % 360) + 360) % 360 / 360, 0.65, 0.6)
      else mat.color.set(colorParam.default)
    } else if (appearance.hue) {
      mat.color.setHSL(((appearance.hue(scope) % 360) + 360) % 360 / 360, 0.65, 0.6)
    }
    if (appearance.emissive) mat.emissiveIntensity = appearance.emissive(scope)
    if (appearance.opacity) { mat.transparent = true; setAnimatedOpacity(mat, appearance.opacity(scope)) }
  })
  return (
    <mesh ref={meshRef} castShadow receiveShadow>
      {primitiveGeometry(primitive)}
      <meshPhysicalMaterial
        color="#6366f1"
        metalness={material.metalness ?? 0.4}
        roughness={material.roughness ?? 0.35}
        clearcoat={material.clearcoat ?? 0.35}
        clearcoatRoughness={material.clearcoatRoughness ?? 0.2}
        iridescence={material.iridescence ?? 0}
        iridescenceIOR={material.iridescenceIOR ?? 1.3}
        envMapIntensity={material.envMapIntensity ?? 1.1}
        flatShading={material.flatShading ?? false}
        emissive="#312e81"
        emissiveIntensity={0.2}
      />
    </mesh>
  )
}

/**
 * Turn a RenderSpec into a normal ObjectInstrumentDef: the transform bindings compile
 * into the def's `localTransform` (so the engine composes it down the hierarchy exactly
 * like the Cube's), and the appearance bindings drive a bound SpecRenderer. Expressions
 * are compiled once here, evaluated per frame. No ObjectRenderer change - a spec is just
 * a def whose component happens to be the interpreter.
 */
export function specInstrument(opts: {
  id: string
  name: string
  params: ParamDef[]
  midiRows?: MidiRowDef[]
  spec: RenderSpec
  /** Direct string-valued material color, with an optional old hue-param fallback. */
  colorParam?: DirectColorParam
  material?: MaterialPreset
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
    <SpecRenderer
      trackId={trackId}
      primitive={spec.primitive}
      appearance={appearance}
      paramDefaults={paramDefaults}
      colorParam={opts.colorParam}
      material={opts.material ?? {}}
    />
  )

  return {
    id: opts.id,
    name: opts.name,
    kind: 'object',
    userInterfaceRenderer: 'parameters',
    params: opts.params,
    midiRows: opts.midiRows,
    localTransform,
    component: Component,
  }
}
