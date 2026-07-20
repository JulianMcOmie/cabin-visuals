import { useRef, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { BufferGeometry, BufferAttribute, ShaderMaterial, Color, Vector2, AdditiveBlending } from 'three'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

// Ported from Excellent DAW. Spirograph / polygon / polar shapes stream toward the camera
// during held notes, dissolving on arrival. Each note emits a train of copies (spawnRate
// copies per beat over its duration); depth = how long ago the copy played, so it's fully
// scrub-accurate. n.pitch picks the shape (edge count). Thick lines are drawn with a batched
// screen-space line shader - all copies in one BufferGeometry. Palette / automation lanes
// from Tyler's source are dropped. The geometry / flight / burst math is Tyler's verbatim.

// --- Geometry helpers (Tyler verbatim) ---

function gcd(a: number, b: number): number {
  let x = Math.round(a * 10000)
  let y = Math.round(b * 10000)
  while (y) { const t = y; y = x % y; x = t }
  return x / 10000
}

const geometryCache = new Map<string, Float32Array>()
function evictCache() {
  if (geometryCache.size > 300) {
    const iter = geometryCache.keys()
    for (let i = 0; i < 80; i++) {
      const k = iter.next().value
      if (k) geometryCache.delete(k)
    }
  }
}

function getPolygonVerts(sides: number): Float32Array {
  const key = `poly_${sides}`
  let verts = geometryCache.get(key)
  if (verts) return verts
  verts = new Float32Array(sides * 2)
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    verts[i * 2] = Math.cos(angle)
    verts[i * 2 + 1] = Math.sin(angle)
  }
  geometryCache.set(key, verts)
  return verts
}

function getPolarVerts(petals: number, offset: number): Float32Array {
  const oQ = Math.round(offset * 100) / 100
  const key = `polar_${petals}_${oQ}`
  let verts = geometryCache.get(key)
  if (verts) return verts
  const segments = 256
  const tMax = Math.PI * 2
  verts = new Float32Array(segments * 2)
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * tMax
    const r = Math.cos(petals * theta) + oQ
    verts[i * 2] = r * Math.cos(theta)
    verts[i * 2 + 1] = r * Math.sin(theta)
  }
  geometryCache.set(key, verts)
  evictCache()
  return verts
}

function getSpirographVerts(petals: number, r: number, d: number): Float32Array {
  const rQ = Math.round(r * 100) / 100
  const dQ = Math.round(d * 100) / 100
  const key = `spiro_${petals}_${rQ}_${dQ}`
  let verts = geometryCache.get(key)
  if (verts) return verts
  const R = 1
  const innerR = rQ
  const segments = 256
  const revolutions = Math.max(1, Math.round(innerR / gcd(R, innerR)))
  const tMax = revolutions * Math.PI * 2
  verts = new Float32Array(segments * 2)
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * tMax
    verts[i * 2] = (R - innerR) * Math.cos(t) + dQ * Math.cos(((R - innerR) / innerR) * t)
    verts[i * 2 + 1] = (R - innerR) * Math.sin(t) - dQ * Math.sin(((R - innerR) / innerR) * t)
  }
  geometryCache.set(key, verts)
  evictCache()
  return verts
}

// 0 = spirograph, 1 = polygon, 2 = polar (numeric index for select param)
function getShapeVerts(mode: number, petals: number, r: number, d: number): Float32Array {
  switch (mode) {
    case 1: return getPolygonVerts(petals)
    case 2: return getPolarVerts(petals, d)
    case 0:
    default: return getSpirographVerts(petals, r, d)
  }
}

const _tmpColor = new Color()
const MAX_VERTS = 80000

// --- Screen-space thick-line shaders (Tyler verbatim) ---
const vertShader = /* glsl */ `
attribute vec3 aOther;
attribute float aSide;
varying float vEdgeDist;
varying vec3 vColor;
uniform vec2 uResolution;
uniform float uLineWidth;
void main() {
  vColor = color;
  vEdgeDist = aSide;
  vec4 clipThis = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 clipOther = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
  vec2 ndcThis = clipThis.xy / clipThis.w;
  vec2 ndcOther = clipOther.xy / clipOther.w;
  vec2 dir = ndcOther - ndcThis;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  dir *= aspect;
  vec2 perp = normalize(vec2(-dir.y, dir.x));
  perp /= aspect;
  float thickNDC = uLineWidth / uResolution.y;
  clipThis.xy += perp * aSide * thickNDC * clipThis.w;
  gl_Position = clipThis;
}
`
const fragShader = /* glsl */ `
varying float vEdgeDist;
varying vec3 vColor;
void main() {
  float dist = abs(vEdgeDist);
  float alpha = 1.0 - smoothstep(0.3, 1.0, dist);
  gl_FragColor = vec4(vColor * alpha, 1.0);
}
`

const PARAMS: ParamDef[] = [
  { key: 'shapeMode', type: 'select', label: 'Shape Mode', options: [
    { value: 0, label: 'Spirograph' }, { value: 1, label: 'Polygon' }, { value: 2, label: 'Polar Graph' },
  ], default: 0 },
  { key: 'speed', label: 'Flight Speed', min: 2, max: 40, step: 1, default: 12 },
  { key: 'spawnRate', label: 'Copies per Beat', min: 1, max: 32, step: 1, default: 8 },
  { key: 'scale', label: 'Scale', min: 0.1, max: 5, step: 0.1, default: 1 },
  { key: 'rotationStep', label: 'Rotation Step', min: -1, max: 1, step: 0.01, default: 0.15 },
  { key: 'spread', label: 'Spread', min: 0, max: 10, step: 0.5, default: 0 },
  { key: 'farZ', label: 'Spawn Depth', min: 10, max: 100, step: 5, default: 40 },
  { key: 'shapeSize', label: 'Shape Size', min: 0.1, max: 2, step: 0.1, default: 0.4 },
  { key: 'fadeOutZ', label: 'Fade Out Distance', min: 2, max: 30, step: 1, default: 10 },
  { key: 'hueStep', label: 'Hue Step', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'baseHue', label: 'Base Hue', min: 0, max: 1, step: 0.05, default: 0.55 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 1, step: 0.05, default: 1 },
  { key: 'lightness', label: 'Lightness', min: 0.1, max: 1, step: 0.05, default: 0.55 },
  { key: 'rBase', label: 'R Base', min: 0.05, max: 0.5, step: 0.01, default: 0.25 },
  { key: 'dBase', label: 'D Base', min: 0.1, max: 1.0, step: 0.05, default: 0.7 },
  { key: 'burstMode', type: 'select', label: 'Burst Mode', options: [
    { value: 0, label: 'Noisy (Random)' }, { value: 1, label: 'Linear Radial' },
    { value: 2, label: 'Spiral Out' }, { value: 3, label: 'Spiral In' },
  ], default: 0 },
  { key: 'burstRadius', label: 'Burst Radius', min: 0.5, max: 10, step: 0.5, default: 3 },
  { key: 'burstTwists', label: 'Burst Twists', min: 1, max: 12, step: 0.5, default: 4 },
  { key: 'curveX', label: 'Path Curve X', min: -20, max: 20, step: 0.5, default: 0 },
  { key: 'curveY', label: 'Path Curve Y', min: -20, max: 20, step: 0.5, default: 0 },
  { key: 'glowAmount', label: 'Glow Amount', min: 0, max: 5, step: 0.1, default: 1 },
  { key: 'approachGrowth', label: 'Approach Growth', min: 0, max: 20, step: 0.5, default: 0 },
  { key: 'lineWidth', label: 'Line Width', min: 1, max: 100, step: 0.5, default: 6 },
]
function ShapeFlightVisual({ trackId }: { trackId: string }) {
  const geoRef = useRef<BufferGeometry>(null)
  const matRef = useRef<ShaderMaterial>(null)
  const { size } = useThree()

  // Pre-allocated batch buffers.
  const batchPos = useMemo(() => new Float32Array(MAX_VERTS * 3), [])
  const batchCol = useMemo(() => new Float32Array(MAX_VERTS * 3), [])
  const batchOther = useMemo(() => new Float32Array(MAX_VERTS * 3), [])
  const batchSide = useMemo(() => new Float32Array(MAX_VERTS), [])
  const indexBuf = useMemo(() => {
    const maxQuads = MAX_VERTS / 4
    const buf = new Uint32Array(maxQuads * 6)
    for (let q = 0; q < maxQuads; q++) {
      const base = q * 4
      const idx = q * 6
      buf[idx] = base; buf[idx + 1] = base + 1; buf[idx + 2] = base + 2
      buf[idx + 3] = base; buf[idx + 4] = base + 2; buf[idx + 5] = base + 3
    }
    return buf
  }, [])

  const uniforms = useMemo(() => ({
    uResolution: { value: new Vector2(size.width, size.height) },
    uLineWidth: { value: 6.0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    const geo = geoRef.current
    if (!geo) return
    geo.setAttribute('position', new BufferAttribute(batchPos, 3))
    geo.setAttribute('color', new BufferAttribute(batchCol, 3))
    geo.setAttribute('aOther', new BufferAttribute(batchOther, 3))
    geo.setAttribute('aSide', new BufferAttribute(batchSide, 1))
    geo.setIndex(new BufferAttribute(indexBuf, 1))
    geo.setDrawRange(0, 0)
  }, [batchPos, batchCol, batchOther, batchSide, indexBuf])

  useEffect(() => () => {
    geoRef.current?.dispose()
    matRef.current?.dispose()
  }, [])

  useInstrumentFrame(trackId, (state) => {
    const geo = geoRef.current
    if (!geo) return false
    const notes = state.notes
    if (!notes.length) { geo.setDrawRange(0, 0); return }

    const par = state.params
    const shapeMode = Math.round(par.shapeMode ?? 0)
    const speed = par.speed ?? 12
    const spawnRate = Math.max(1, par.spawnRate ?? 8)
    const scaleDefault = par.scale ?? 1
    const rotationStep = par.rotationStep ?? 0.15
    const spread = par.spread ?? 0
    const farZ = par.farZ ?? 40
    const shapeSize = par.shapeSize ?? 0.4
    const fadeOutZ = par.fadeOutZ ?? 10
    const hueStep = par.hueStep ?? 0.08
    const baseHue = par.baseHue ?? 0.55
    const saturation = par.saturation ?? 1
    const lightness = par.lightness ?? 0.55
    const rBase = par.rBase ?? 0.25
    const dBase = par.dBase ?? 0.7
    const burstMode = Math.round(par.burstMode ?? 0)
    const burstRadius = par.burstRadius ?? 3
    const burstTwists = par.burstTwists ?? 4
    const curveXDefault = par.curveX ?? 0
    const curveYDefault = par.curveY ?? 0
    const glowAmount = par.glowAmount ?? 1
    const approachGrowth = par.approachGrowth ?? 0
    const lineWidth = par.lineWidth ?? 6

    if (matRef.current) {
      matRef.current.uniforms.uResolution.value.set(size.width, size.height)
      matRef.current.uniforms.uLineWidth.value = lineWidth
    }

    const currentBeat = state.beat
    const secPerBeat = state.secPerBeat

    // Rotation is a pure function of the beat (not an accumulator), so a paused
    // playhead holds still and any scrub lands on the same rotation.
    const accRotation = currentBeat * rotationStep

    // Visible beat window for early exit (notes are sorted by beat).
    const maxVisibleSecAgo = fadeOutZ / speed
    const maxFutureSecAhead = farZ / speed
    const minVisibleBeat = currentBeat - maxVisibleSecAgo / secPerBeat
    const maxVisibleBeat = currentBeat + maxFutureSecAhead / secPerBeat

    // === Batch: write all shape-copy vertices into one geometry ===
    let vertIdx = 0
    let shapeIdx = 0

    for (let ei = 0; ei < notes.length; ei++) {
      const ev = notes[ei]
      if (ev.beat > maxVisibleBeat) break
      if (ev.beat + ev.durationBeats < minVisibleBeat) continue

      // Derive shape from pitch (Tyler verbatim).
      const petals = Math.min(Math.max(ev.pitch - 45, 3), 20)
      const pitchNorm = (ev.pitch % 24) / 24
      const r = rBase + pitchNorm * 0.3
      const d = dBase + pitchNorm * 0.25
      const copySpacing = 0.1 * (0.5 + (ev.pitch % 12) / 12 * 1.5)

      const spawnInterval = 1 / spawnRate
      const noteEnd = ev.beat + ev.durationBeats
      const numCopies = Math.floor(ev.durationBeats * spawnRate)

      // Color for this note.
      const hue = (baseHue + shapeIdx * hueStep) % 1
      const sat = saturation
      const lit = lightness

      const spreadX = spread > 0 ? Math.sin(shapeIdx * 7.31 + 0.5) * spread : 0
      const spreadY = spread > 0 ? Math.cos(shapeIdx * 13.17 + 0.3) * spread : 0

      const shapeVerts = getShapeVerts(shapeMode, petals, r, d)
      const vertCount = shapeVerts.length / 2

      for (let ci = 0; ci <= numCopies; ci++) {
        const copyBeat = ev.beat + ci * spawnInterval
        if (copyBeat > noteEnd) break

        const beatsAgo = currentBeat - copyBeat
        const secondsAgo = beatsAgo * secPerBeat
        const z = secondsAgo * speed
        if (z < -farZ || z > fadeOutZ) continue
        if (vertIdx + vertCount * 4 > MAX_VERTS) break

        const approachProgress = 1 - Math.max(0, -z) / farZ

        // --- Burst mode (Tyler verbatim) ---
        let bx = spreadX
        let by = spreadY
        const goldenAngle = 2.399963
        const copyAngle = ci * goldenAngle + shapeIdx * 1.618
        if (burstMode === 1) {
          const radius = approachProgress * burstRadius
          bx = Math.cos(copyAngle) * radius
          by = Math.sin(copyAngle) * radius
        } else if (burstMode === 2) {
          const radius = approachProgress * burstRadius
          const windAngle = copyAngle + approachProgress * burstTwists * Math.PI * 2
          const theta = approachProgress * Math.PI
          const roseR = radius * (0.5 + 0.5 * Math.sin(burstTwists * theta))
          bx = roseR * Math.cos(windAngle)
          by = roseR * Math.sin(windAngle)
        } else if (burstMode === 3) {
          const invProgress = 1 - approachProgress
          const phi = copyAngle + approachProgress * burstTwists * Math.PI * 2
          const theta = approachProgress * Math.PI * 0.8
          const rosePetals = Math.max(2, Math.round(burstTwists))
          const roseModulation = 0.6 + 0.4 * Math.cos(rosePetals * phi)
          const radius = invProgress * burstRadius * roseModulation
          bx = radius * Math.sin(theta) * Math.cos(phi)
          by = radius * Math.sin(theta) * Math.sin(phi)
        }

        // --- Curved flight path ---
        const invT = 1 - approachProgress
        const posX = bx + curveXDefault * invT * invT
        const posY = by + curveYDefault * invT * invT
        const posZ = z

        const finalScale = shapeSize * scaleDefault * (1 + approachProgress * approachGrowth)

        const rot = accRotation + ci * copySpacing
        const cosR = Math.cos(rot)
        const sinR = Math.sin(rot)

        const glowBoost = glowAmount
        _tmpColor.setHSL(hue, sat, lit)
        _tmpColor.multiplyScalar(glowBoost)

        // Opacity baked into color (additive: darker = more transparent).
        const opacity = z > 0 ? Math.max(0, 1 - z / fadeOutZ) : approachProgress
        const cr = _tmpColor.r * opacity
        const cg = _tmpColor.g * opacity
        const cb = _tmpColor.b * opacity

        // Emit 4 verts per edge v[i]→v[i+1] (Tyler verbatim).
        for (let v = 0; v < vertCount; v++) {
          const v0i = v
          const v1i = (v + 1) % vertCount
          const lx0 = shapeVerts[v0i * 2], ly0 = shapeVerts[v0i * 2 + 1]
          const lx1 = shapeVerts[v1i * 2], ly1 = shapeVerts[v1i * 2 + 1]

          const wx0 = (lx0 * cosR - ly0 * sinR) * finalScale + posX
          const wy0 = (lx0 * sinR + ly0 * cosR) * finalScale + posY
          const wx1 = (lx1 * cosR - ly1 * sinR) * finalScale + posX
          const wy1 = (lx1 * sinR + ly1 * cosR) * finalScale + posY

          const off0 = vertIdx * 3
          batchPos[off0] = wx0; batchPos[off0 + 1] = wy0; batchPos[off0 + 2] = posZ
          batchOther[off0] = wx1; batchOther[off0 + 1] = wy1; batchOther[off0 + 2] = posZ
          batchCol[off0] = cr; batchCol[off0 + 1] = cg; batchCol[off0 + 2] = cb
          batchSide[vertIdx] = -1; vertIdx++

          const off1 = vertIdx * 3
          batchPos[off1] = wx0; batchPos[off1 + 1] = wy0; batchPos[off1 + 2] = posZ
          batchOther[off1] = wx1; batchOther[off1 + 1] = wy1; batchOther[off1 + 2] = posZ
          batchCol[off1] = cr; batchCol[off1 + 1] = cg; batchCol[off1 + 2] = cb
          batchSide[vertIdx] = 1; vertIdx++

          const off2 = vertIdx * 3
          batchPos[off2] = wx1; batchPos[off2 + 1] = wy1; batchPos[off2 + 2] = posZ
          batchOther[off2] = wx0; batchOther[off2 + 1] = wy0; batchOther[off2 + 2] = posZ
          batchCol[off2] = cr; batchCol[off2 + 1] = cg; batchCol[off2 + 2] = cb
          batchSide[vertIdx] = 1; vertIdx++

          const off3 = vertIdx * 3
          batchPos[off3] = wx1; batchPos[off3 + 1] = wy1; batchPos[off3 + 2] = posZ
          batchOther[off3] = wx0; batchOther[off3 + 1] = wy0; batchOther[off3 + 2] = posZ
          batchCol[off3] = cr; batchCol[off3 + 1] = cg; batchCol[off3 + 2] = cb
          batchSide[vertIdx] = -1; vertIdx++
        }
      }
      shapeIdx++
    }

    const posAttr = geo.getAttribute('position') as BufferAttribute
    const colAttr = geo.getAttribute('color') as BufferAttribute
    const otherAttr = geo.getAttribute('aOther') as BufferAttribute
    const sideAttr = geo.getAttribute('aSide') as BufferAttribute
    if (!posAttr || !colAttr || !otherAttr || !sideAttr) return false
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    otherAttr.needsUpdate = true
    sideAttr.needsUpdate = true
    const numIndices = Math.floor(vertIdx / 4) * 6
    geo.setDrawRange(0, numIndices)
  })

  return (
    <mesh frustumCulled={false}>
      <bufferGeometry ref={geoRef} />
      <shaderMaterial
        ref={matRef}
        vertexShader={vertShader}
        fragmentShader={fragShader}
        uniforms={uniforms}
        vertexColors
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  )
}

export const shapeFlightInstrument: ObjectInstrumentDef = {
  id: 'shapeFlight',
  name: 'Shape Flight',
  kind: 'object',
  userInterfaceRenderer: 'shapeFlight',
  params: PARAMS,
  midiRows: [
    { pitch: 64, label: 'Stream shape · 19 points (intricate)' },
    { pitch: 62, label: 'Stream shape · 17 points' },
    { pitch: 60, label: 'Stream shape · 15 points' },
    { pitch: 59, label: 'Stream shape · 14 points' },
    { pitch: 57, label: 'Stream shape · 12 points' },
    { pitch: 55, label: 'Stream shape · 10 points' },
    { pitch: 52, label: 'Stream shape · 7 points' },
    { pitch: 48, label: 'Stream shape · 3 points (simplest)' },
  ],
  component: ShapeFlightVisual,
}
