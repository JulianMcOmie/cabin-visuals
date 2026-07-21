import assert from 'node:assert/strict'
import test from 'node:test'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from 'three'
import { applyMaterialOpacity, GATE_OPACITY_UNIFORM } from './animatedOpacity'

// The visibility-mover sev: raw ShaderMaterials ignore `material.opacity` (the
// renderer never uploads it for them), so the wrapper's mover pass was a silent
// no-op on shader instruments (Photo, Stars, particle systems) - the gate could
// not fade or hide them. The wrapper now patches the fragment shader once and
// drives a gate uniform instead.

const VERT = 'void main(){ gl_Position = vec4(position, 1.0); }'

function shaderObject(fragmentShader: string, transparent = true) {
  const mat = new ShaderMaterial({ transparent, uniforms: {}, vertexShader: VERT, fragmentShader })
  const g = new Group()
  g.add(new Mesh(new PlaneGeometry(1, 1), mat))
  return { mat, g }
}

test('raw ShaderMaterial is gated through a wrap uniform, not material.opacity', () => {
  const { mat, g } = shaderObject('void main(){ gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }')

  applyMaterialOpacity(g, 0.5)
  assert.equal(mat.uniforms[GATE_OPACITY_UNIFORM].value, 0.5, 'gate uniform carries the mover value')
  assert.match(mat.fragmentShader, new RegExp(`uniform float ${GATE_OPACITY_UNIFORM};`))
  assert.match(
    mat.fragmentShader,
    new RegExp(`gl_FragColor = vec4\\(1\\.0, 0\\.0, 0\\.0, 1\\.0\\); gl_FragColor\\.a \\*= ${GATE_OPACITY_UNIFORM};`),
    'the assignment gains an alpha multiply',
  )
  assert.equal(mat.opacity, 1, 'material.opacity stays untouched (the shader never read it)')

  applyMaterialOpacity(g, 0)
  assert.equal(mat.uniforms[GATE_OPACITY_UNIFORM].value, 0, 'gate closes to zero')
})

test('every gl_FragColor assignment gets the multiply (branches stay correct)', () => {
  const { mat, g } = shaderObject(
    'void main(){ if (false) { gl_FragColor = vec4(1.0); } else { gl_FragColor = vec4(0.5); } }',
  )
  applyMaterialOpacity(g, 1)
  const multiplies = mat.fragmentShader.match(new RegExp(`gl_FragColor\\.a \\*= ${GATE_OPACITY_UNIFORM};`, 'g'))
  assert.equal(multiplies?.length, 2)
})

test('the wrap is idempotent across frames', () => {
  const { mat, g } = shaderObject('void main(){ gl_FragColor = vec4(1.0); }')
  applyMaterialOpacity(g, 0.25)
  const once = mat.fragmentShader
  applyMaterialOpacity(g, 0.75)
  assert.equal(mat.fragmentShader, once, 'no double-wrap on later frames')
  assert.equal(mat.uniforms[GATE_OPACITY_UNIFORM].value, 0.75)
})

test('authored transparency survives a fully-open gate', () => {
  const { mat, g } = shaderObject('void main(){ gl_FragColor = vec4(1.0); }', true)
  applyMaterialOpacity(g, 1)
  assert.equal(mat.transparent, true, 'soft particle shaders keep their blending at gate 1')
})

test('an authored-opaque shader turns transparent only while gated', () => {
  const { mat, g } = shaderObject('void main(){ gl_FragColor = vec4(1.0); }', false)
  applyMaterialOpacity(g, 1)
  assert.equal(mat.transparent, false, 'opaque at full gate (the Photo backdrop case)')
  applyMaterialOpacity(g, 0.5)
  assert.equal(mat.transparent, true, 'fading blends against what is behind')
  applyMaterialOpacity(g, 1)
  assert.equal(mat.transparent, false, 'and returns to authored opaque')
})

test('materials that forward opacity themselves stay on the standard path', () => {
  // LineMaterial (NeonPolar/HopfFibration) forwards material.opacity to its own
  // uniform via an accessor - wrapping its shader is unnecessary and wrong.
  const mat = new ShaderMaterial({
    transparent: true,
    uniforms: {},
    vertexShader: VERT,
    fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
  })
  ;(mat as ShaderMaterial & { isLineMaterial?: boolean }).isLineMaterial = true
  const g = new Group()
  g.add(new Mesh(new PlaneGeometry(1, 1), mat))
  applyMaterialOpacity(g, 0.5)
  assert.equal(mat.opacity, 0.5, 'forwarded accessor receives the composed value')
  assert.equal(mat.uniforms[GATE_OPACITY_UNIFORM], undefined, 'no wrap applied')
})

test('standard materials are untouched by the shader path', () => {
  const mat = new MeshBasicMaterial({ transparent: true, opacity: 1 })
  const g = new Group()
  g.add(new Mesh(new PlaneGeometry(1, 1), mat))
  applyMaterialOpacity(g, 0.5)
  assert.equal(mat.opacity, 0.5)
  assert.equal('fragmentShader' in mat, false)
})
