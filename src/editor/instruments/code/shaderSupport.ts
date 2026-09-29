import {
  AdditiveBlending, Color, Matrix3, Matrix4, NormalBlending, ShaderMaterial, Texture, Vector2, Vector3, Vector4,
  type IUniform,
} from 'three'
import type { LayerShader } from '../../core/directors/types'
import type { PostPass } from './types'

// Material builders for code-authored fragment shaders (scene post passes and
// composition layers). Standard inputs are declared FOR the author unless the
// source already declares them, and so are custom uniforms whose GLSL type can
// be read off their value - so a shader compiles whether or not its author
// wrote the declarations. A fragment-source change (hot reload) rebuilds the
// material; an unchanged one is reused every frame.

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`

const LAYER_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

/** GLSL type for a uniform value, or null when it can't be inferred. */
export function glslTypeOf(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'boolean') return 'float'
  if (value instanceof Vector2) return 'vec2'
  if (value instanceof Vector3 || value instanceof Color) return 'vec3'
  if (value instanceof Vector4) return 'vec4'
  if (value instanceof Matrix3) return 'mat3'
  if (value instanceof Matrix4) return 'mat4'
  if (value instanceof Texture) return 'sampler2D'
  if (Array.isArray(value) || value instanceof Float32Array) {
    const n = (value as ArrayLike<number>).length
    if (n === 2) return 'vec2'
    if (n === 3) return 'vec3'
    if (n === 4) return 'vec4'
  }
  return null
}

/** Prepend `uniform <type> <name>;` / `varying vec2 vUv;` for anything the source doesn't declare. */
export function declareMissing(source: string, decls: Array<{ qualifier: 'uniform' | 'varying'; type: string; name: string }>): string {
  const lines: string[] = []
  const added = new Set<string>()
  for (const d of decls) {
    if (added.has(d.name)) continue
    // Any declaration statement of this qualifier that names it - including
    // comma lists (`uniform float uA, uB;`) and array/precision forms.
    const re = new RegExp(`\\b${d.qualifier}\\s+[^;{}]*\\b${d.name}\\b[^;{}]*;`)
    if (re.test(source)) continue
    lines.push(`${d.qualifier} ${d.type} ${d.name};`)
    added.add(d.name)
  }
  return lines.length ? `${lines.join('\n')}\n${source}` : source
}

function customDecls(uniforms: Record<string, IUniform> | undefined) {
  const out: Array<{ qualifier: 'uniform'; type: string; name: string }> = []
  for (const [name, u] of Object.entries(uniforms ?? {})) {
    const type = glslTypeOf(u.value)
    if (type) out.push({ qualifier: 'uniform', type, name })
  }
  return out
}

/** A scene post-pass material. Standard inputs: tDiffuse, vUv, uAspect, uBeat, uResolution. */
export function makePostMaterial(pass: PostPass): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    tDiffuse: { value: null },
    uAspect: { value: 1 },
    uBeat: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
    ...pass.uniforms,
  }
  const fragmentShader = declareMissing(pass.fragment, [
    { qualifier: 'varying', type: 'vec2', name: 'vUv' },
    { qualifier: 'uniform', type: 'sampler2D', name: 'tDiffuse' },
    { qualifier: 'uniform', type: 'float', name: 'uAspect' },
    { qualifier: 'uniform', type: 'float', name: 'uBeat' },
    { qualifier: 'uniform', type: 'vec2', name: 'uResolution' },
    ...customDecls(pass.uniforms),
  ])
  const mat = new ShaderMaterial({
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
  mat.userData.codeSource = pass.fragment
  return mat
}

/** Plain composition-layer uniform values → three uniform values. */
export function toUniformValue(v: number | readonly number[]): number | Vector2 | Vector3 | Vector4 {
  if (typeof v === 'number') return v
  if (v.length === 2) return new Vector2(v[0], v[1])
  if (v.length === 3) return new Vector3(v[0], v[1], v[2])
  return new Vector4(v[0], v[1], v[2], v[3] ?? 0)
}

/** Write plain values into existing uniform objects without allocating. */
export function assignUniformValue(u: IUniform, v: number | readonly number[]): void {
  if (typeof v === 'number') { u.value = v; return }
  const cur = u.value
  if (v.length === 2 && cur instanceof Vector2) cur.set(v[0], v[1])
  else if (v.length === 3 && cur instanceof Vector3) cur.set(v[0], v[1], v[2])
  else if (v.length === 4 && cur instanceof Vector4) cur.set(v[0], v[1], v[2], v[3])
  else u.value = toUniformValue(v)
}

/** A composition-layer material. Standard inputs: tScene, vUv, uOpacity, uAspect, uBeat, uResolution. */
export function makeLayerMaterial(shader: LayerShader, additive = false): ShaderMaterial {
  const uniforms: Record<string, IUniform> = {
    tScene: { value: null },
    uOpacity: { value: 1 },
    uAspect: { value: 1 },
    uBeat: { value: 0 },
    uResolution: { value: new Vector2(1, 1) },
  }
  for (const [name, v] of Object.entries(shader.uniforms ?? {})) uniforms[name] = { value: toUniformValue(v) }
  // extra scene inputs: samplers bound per frame by the compositor
  const sceneDecls = Object.keys(shader.scenes ?? {}).map((name) => {
    uniforms[name] = { value: null }
    return { qualifier: 'uniform' as const, type: 'sampler2D', name }
  })
  const fragmentShader = declareMissing(shader.fragment, [
    { qualifier: 'varying', type: 'vec2', name: 'vUv' },
    { qualifier: 'uniform', type: 'sampler2D', name: 'tScene' },
    ...sceneDecls,
    { qualifier: 'uniform', type: 'float', name: 'uOpacity' },
    { qualifier: 'uniform', type: 'float', name: 'uAspect' },
    { qualifier: 'uniform', type: 'float', name: 'uBeat' },
    { qualifier: 'uniform', type: 'vec2', name: 'uResolution' },
    ...customDecls(uniforms),
  ])
  const mat = new ShaderMaterial({
    vertexShader: LAYER_VERTEX,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: additive ? AdditiveBlending : NormalBlending,
  })
  mat.userData.codeSource = shader.fragment
  return mat
}
