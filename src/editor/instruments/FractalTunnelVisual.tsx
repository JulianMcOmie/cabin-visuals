import { useRef, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { AdditiveBlending, Color, Group, Vector2, Vector3, type IUniform, type Mesh, type MeshBasicMaterial } from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'

// The Fractal Tunnel visual - the lazy half of ./FractalTunnel (see that file's
// header for the port's history and why it is GPU line geometry, not a canvas).

interface Point3D {
  x: number
  y: number
  z: number
  hue: number
  generation: number
}

interface Branch {
  points: Point3D[]
  generation: number
  hue: number
}

interface BranchParams {
  symmetry: number
  branchCount: number
  generations: number
  spiralAmount: number
  lengthDecay: number
  spreadAngle: number
  hueShift: number
  baseHue: number
}

const CONFIG = {
  backFlowerZ: -250,
  backFlowerScale: 20,
  frontFlowerZ: 500,
  focalLength: 800,
  tunnelLineOpacity: 0.5,
  baseLength: 80,
  oscSpeed: 1,
}

// The projection still happens against a virtual 1024-tall frame, exactly as the
// canvas version did, so the artwork's proportions are untouched; the result is
// then mapped into the plane's world units.
const VIRTUAL_H = 1024
const MAX_GENERATIONS = 5
const MAX_RINGS = 6
// Safety rail the canvas version lacked: symmetry 12 x 5 branches x 5 generations
// is ~187k segments, which used to simply hang the tab.
const MAX_SEGMENTS = 24000

function project(
  x: number, y: number, z: number,
  centerX: number, centerY: number,
  focalLength: number
): { x: number; y: number; scale: number } | null {
  const perspectiveZ = focalLength - z
  if (perspectiveZ <= 0) return null
  const scale = focalLength / perspectiveZ
  return { x: centerX + x * scale, y: centerY + y * scale, scale }
}

function generateBranches(
  baseLength: number,
  zPosition: number,
  scale: number,
  params: BranchParams,
  globalDirectionFlip: number
): Branch[] {
  const branches: Branch[] = []

  const addBranches = (
    x: number, y: number,
    angle: number,
    length: number,
    gen: number,
    hue: number,
    direction: number
  ) => {
    if (gen >= params.generations) return

    const segments = 20
    const points: Point3D[] = []
    let currentX = x
    let currentY = y
    let currentAngle = angle

    points.push({ x: currentX, y: currentY, z: zPosition, hue, generation: gen })

    for (let i = 1; i <= segments; i++) {
      const t = i / segments
      currentAngle = angle + t * params.spiralAmount * direction * globalDirectionFlip * Math.PI
      const segLength = (length * scale) / segments
      currentX += Math.cos(currentAngle) * segLength
      currentY += Math.sin(currentAngle) * segLength
      points.push({ x: currentX, y: currentY, z: zPosition, hue, generation: gen })
    }

    branches.push({ points, generation: gen, hue })

    const childLength = length * params.lengthDecay
    const endAngle = currentAngle

    for (let i = 0; i < params.branchCount; i++) {
      const fanOffset = ((i / (params.branchCount - 1 || 1)) - 0.5) * params.spreadAngle * Math.PI
      const childAngle = endAngle + fanOffset
      const childDirection = (i / (params.branchCount - 1 || 1)) * 2 - 1
      const childHue = (hue + params.hueShift + i * params.hueShift * 0.3) % 1
      addBranches(currentX, currentY, childAngle, childLength, gen + 1, childHue, childDirection)
    }
  }

  for (let i = 0; i < params.symmetry; i++) {
    const angle = (i / params.symmetry) * Math.PI * 2 - Math.PI / 2
    addBranches(0, 0, angle, baseLength, 0, params.baseHue, 1)
  }

  return branches
}

function getEndpoints(branches: Branch[], maxGen: number): Point3D[] {
  const endpoints: Point3D[] = []
  branches.forEach(branch => {
    if (branch.generation === maxGen - 1) {
      endpoints.push(branch.points[branch.points.length - 1])
    }
  })
  return endpoints
}

// ────────────────────────────────────────────
// Pulse rings, injected into the line shader
// ────────────────────────────────────────────

// Each ring is (radius, halfBandWidth, opacity) in device pixels from frame centre.
// Inside a band the fragment's hue rotates half a turn - the same "inverted colour"
// the canvas version got by compositing a second, hue-shifted render.
const RING_UNIFORM_DECL = `
uniform vec3 uRings[${MAX_RINGS}];
uniform vec2 uRingCenter;

vec3 cabinHueRotate(vec3 color, float turns) {
  vec3 axis = normalize(vec3(1.0));
  float angle = turns * 6.28318530718;
  return color * cos(angle)
    + cross(axis, color) * sin(angle)
    + axis * dot(axis, color) * (1.0 - cos(angle));
}
`

const RING_SNIPPET = `
{
  float ringD = distance(gl_FragCoord.xy, uRingCenter);
  float ringMix = 0.0;
  for (int ri = 0; ri < ${MAX_RINGS}; ri++) {
    vec3 ring = uRings[ri];
    if (ring.z <= 0.0) continue;
    if (abs(ringD - ring.x) < ring.y) ringMix = max(ringMix, ring.z);
  }
  if (ringMix > 0.0) {
    gl_FragColor.rgb = mix(gl_FragColor.rgb, cabinHueRotate(gl_FragColor.rgb, 0.5), ringMix);
  }
}
`

interface RingUniforms {
  uRings: IUniform<Vector3[]>
  uRingCenter: IUniform<Vector2>
}

/** One additive line pass: a batch of segments sharing a width. Buffers are
 *  allocated with headroom and rewritten in place; `setPositions` mints a fresh
 *  GPU buffer on every call, which across 13 passes at 60fps is exactly the
 *  per-frame churn this port exists to remove. */
interface LinePass {
  line: LineSegments2
  geometry: LineSegmentsGeometry
  material: LineMaterial
  positions: Float32Array
  colors: Float32Array
  capacity: number
}

function createPass(parent: Group, resolution: Vector2, rings: RingUniforms, renderOrder: number): LinePass {
  const geometry = new LineSegmentsGeometry()
  const material = new LineMaterial({
    color: 0xffffff,
    linewidth: 1,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    resolution,
    worldUnits: false,
  })
  material.blending = AdditiveBlending
  // These blend additively and must stay in the transparent queue; without the
  // flag the opacity wrapper clears `transparent` whenever opacity is 1.
  material.userData[FORCE_TRANSPARENT_KEY] = true
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRings = rings.uRings
    shader.uniforms.uRingCenter = rings.uRingCenter
    shader.fragmentShader = RING_UNIFORM_DECL + shader.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      RING_SNIPPET + '\n#include <tonemapping_fragment>',
    )
  }
  // REQUIRED, not cosmetic: without it three would consider these materials
  // identical to any other stock LineMaterial (same shader source, same
  // defines) and hand them a cached program compiled WITHOUT the ring
  // injection - or hand HopfFibration's lines a program that has it.
  material.customProgramCacheKey = () => 'fractal-tunnel-rings-v1'
  const line = new LineSegments2(geometry, material)
  line.frustumCulled = false // bounds change every frame; culling would just cost
  line.renderOrder = renderOrder
  line.visible = false
  parent.add(line)
  return { line, geometry, material, positions: new Float32Array(0), colors: new Float32Array(0), capacity: 0 }
}

/** Mark an interleaved attribute's backing buffer dirty. Returns false when the
 *  geometry isn't laid out as expected, so the caller can fall back. */
function touchAttribute(geometry: LineSegmentsGeometry, name: string): boolean {
  const attribute = geometry.getAttribute(name) as { data?: { needsUpdate: boolean } } | undefined
  if (!attribute?.data) return false
  attribute.data.needsUpdate = true
  return true
}

/** Upload a pass's segments, or hide it when it has none. */
function commitPass(pass: LinePass, positions: number[], colors: number[], width: number) {
  const segments = positions.length / 6
  if (segments === 0) {
    pass.line.visible = false
    return
  }
  if (segments > pass.capacity) {
    // Grow with headroom so an oscillating segment count doesn't reallocate
    // every frame, then hand the new arrays to three once.
    pass.capacity = Math.ceil(segments * 1.5)
    pass.positions = new Float32Array(pass.capacity * 6)
    pass.colors = new Float32Array(pass.capacity * 6)
    pass.positions.set(positions)
    pass.colors.set(colors)
    pass.geometry.setPositions(pass.positions)
    pass.geometry.setColors(pass.colors)
  } else {
    pass.positions.set(positions)
    pass.colors.set(colors)
    if (!touchAttribute(pass.geometry, 'instanceStart') || !touchAttribute(pass.geometry, 'instanceColorStart')) {
      pass.geometry.setPositions(pass.positions)
      pass.geometry.setColors(pass.colors)
    }
  }
  // Draw only the segments actually written; the tail of the buffer is stale.
  pass.geometry.instanceCount = segments
  pass.material.linewidth = Math.max(0.5, width)
  pass.line.visible = true
}

export function FractalTunnelVisual({ trackId }: { trackId: string }) {
  const { viewport, size } = useThree()
  const groupRef = useRef<Group>(null)
  const bgRef = useRef<Mesh>(null)
  const passesRef = useRef<{ core: LinePass[]; glow: LinePass[]; tunnel: LinePass; tunnelGlow: LinePass; dots: LinePass } | null>(null)
  const scratchColor = useRef(new Color()).current

  const resolution = useMemo(() => new Vector2(1, 1), [])
  const rings = useMemo<RingUniforms>(() => ({
    uRings: { value: Array.from({ length: MAX_RINGS }, () => new Vector3()) },
    uRingCenter: { value: new Vector2() },
  }), [])

  // Reused scratch buffers - one per pass - so a frame allocates nothing beyond
  // the branch tree itself.
  const buffers = useMemo(() => ({
    corePos: Array.from({ length: MAX_GENERATIONS }, () => [] as number[]),
    coreCol: Array.from({ length: MAX_GENERATIONS }, () => [] as number[]),
    glowPos: Array.from({ length: MAX_GENERATIONS }, () => [] as number[]),
    glowCol: Array.from({ length: MAX_GENERATIONS }, () => [] as number[]),
    tunnelPos: [] as number[],
    tunnelCol: [] as number[],
    tunnelGlowCol: [] as number[],
    dotPos: [] as number[],
    dotCol: [] as number[],
  }), [])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    // Glow passes first so the cores draw over them.
    const glow = Array.from({ length: MAX_GENERATIONS }, (_, i) => createPass(group, resolution, rings, i))
    const tunnelGlow = createPass(group, resolution, rings, MAX_GENERATIONS)
    const tunnel = createPass(group, resolution, rings, MAX_GENERATIONS + 1)
    const core = Array.from({ length: MAX_GENERATIONS }, (_, i) => createPass(group, resolution, rings, MAX_GENERATIONS + 2 + i))
    const dots = createPass(group, resolution, rings, MAX_GENERATIONS * 2 + 3)
    passesRef.current = { core, glow, tunnel, tunnelGlow, dots }
    return () => {
      for (const pass of [...core, ...glow, tunnel, tunnelGlow, dots]) {
        group.remove(pass.line)
        pass.geometry.dispose()
        pass.material.dispose()
      }
      passesRef.current = null
    }
  }, [resolution, rings])

  useInstrumentFrame(trackId, (state) => {
    const passes = passesRef.current
    const bg = bgRef.current
    if (!passes || !bg) return false

    const p = state.params
    const sp = state.stringParams
    ;(bg.material as MeshBasicMaterial).color.set(sp.bgColor ?? '#050508')

    // Time source: the playhead beat (seconds-tuned motion uses beat * secPerBeat).
    const elapsed = state.beat * state.secPerBeat
    const beat = state.beat * CONFIG.oscSpeed

    // Notes whose onset the playhead has passed - the pure replacement for onset
    // detection: hue bumps and pulse rings derive from these each frame.
    const pastNotes = state.notes.filter((n) => n.beat <= state.beat)

    const colorPulse = (p.colorPulse ?? 0) >= 0.5
    const pulseSpeed = p.pulseSpeed ?? 200
    const pulseBandWidth = p.pulseBandWidth ?? 40
    const pulseFadeDuration = p.pulseFadeDuration ?? 2.0
    const hueOffset = colorPulse ? 0 : (pastNotes.length * 30) % 360

    const symmetry = p.symmetry ?? 6
    const branchCount = p.branchCount ?? 3
    const generations = Math.min(MAX_GENERATIONS, p.generations ?? 3)
    const spiralAmount = p.spiralAmount ?? 0.9
    const lengthDecay = p.lengthDecay ?? 0.8
    const spreadAngle = p.spreadAngle ?? 1.6
    const hueShift = p.hueShift ?? 0.09
    const baseHue = p.baseHue ?? 0.48
    const lineWidth = p.lineWidth ?? 4
    const glowIntensity = p.glowIntensity ?? 0.9

    const params: BranchParams = {
      symmetry,
      branchCount,
      generations,
      spiralAmount: spiralAmount + Math.sin(beat * Math.PI / 4) * 0.3,
      lengthDecay: lengthDecay + Math.sin(beat * Math.PI / 16 + 2) * 0.15,
      spreadAngle: spreadAngle + Math.sin(beat * Math.PI / 8 + 1) * 0.4,
      hueShift,
      baseHue: (baseHue + beat / 64 + hueOffset / 360) % 1,
    }

    const frontBranches = generateBranches(CONFIG.baseLength, CONFIG.frontFlowerZ, 1, params, 1)
    const backBranches = generateBranches(CONFIG.baseLength, CONFIG.backFlowerZ, CONFIG.backFlowerScale, params, 1)
    const frontEndpoints = getEndpoints(frontBranches, generations)
    const backEndpoints = getEndpoints(backBranches, generations)

    // Virtual frame, then the map into plane world units. Both flowers project
    // against the same virtual canvas the original drew into.
    const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
    const virtualW = VIRTUAL_H * aspect
    const centerX = virtualW / 2
    const centerY = VIRTUAL_H / 2
    const toLocalX = (px: number) => (px / virtualW - 0.5) * viewport.width
    const toLocalY = (py: number) => -(py / VIRTUAL_H - 0.5) * viewport.height

    for (let g = 0; g < MAX_GENERATIONS; g++) {
      buffers.corePos[g].length = 0
      buffers.coreCol[g].length = 0
      buffers.glowPos[g].length = 0
      buffers.glowCol[g].length = 0
    }
    buffers.tunnelPos.length = 0
    buffers.tunnelCol.length = 0
    buffers.tunnelGlowCol.length = 0
    buffers.dotPos.length = 0
    buffers.dotCol.length = 0

    let segmentBudget = MAX_SEGMENTS

    // ---- Branch polylines, bucketed by generation (that is where width changes).
    const packBranches = (branches: Branch[]) => {
      for (const branch of branches) {
        const gen = Math.min(MAX_GENERATIONS - 1, branch.generation)
        // Same per-generation styling the canvas version used, with alpha folded
        // into the colour because these blend additively.
        const alpha = Math.max(0.2, 1 - branch.generation * 0.15)
        const lightness = (50 + branch.generation * 5) / 100
        const saturation = (90 - branch.generation * 5) / 100
        scratchColor.setHSL((branch.hue % 1 + 1) % 1, saturation, lightness)
        const cr = scratchColor.r * alpha
        const cg = scratchColor.g * alpha
        const cb = scratchColor.b * alpha
        const gr = cr * glowIntensity * 0.3
        const gg = cg * glowIntensity * 0.3
        const gb = cb * glowIntensity * 0.3

        const pos = buffers.corePos[gen]
        const col = buffers.coreCol[gen]
        const gpos = buffers.glowPos[gen]
        const gcol = buffers.glowCol[gen]

        let prev: { x: number; y: number } | null = null
        for (const point of branch.points) {
          const projected = project(point.x, point.y, point.z, centerX, centerY, CONFIG.focalLength)
          if (!projected) { prev = null; continue }
          const x = toLocalX(projected.x)
          const y = toLocalY(projected.y)
          if (prev && segmentBudget > 0) {
            segmentBudget--
            pos.push(prev.x, prev.y, 0, x, y, 0)
            col.push(cr, cg, cb, cr, cg, cb)
            if (glowIntensity > 0) {
              gpos.push(prev.x, prev.y, 0, x, y, 0)
              gcol.push(gr, gg, gb, gr, gg, gb)
            }
          }
          prev = { x, y }
        }
      }
    }
    packBranches(backBranches)
    packBranches(frontBranches)

    // ---- Tunnel lines: the back flower's endpoints reaching to the front's.
    const tunnelCount = Math.min(frontEndpoints.length, backEndpoints.length)
    for (let i = 0; i < tunnelCount; i++) {
      const back = backEndpoints[i]
      const front = frontEndpoints[i]
      scratchColor.setHSL(((((front.hue + back.hue) / 2) % 1) + 1) % 1, 0.8, 0.6)
      const cr = scratchColor.r * CONFIG.tunnelLineOpacity
      const cg = scratchColor.g * CONFIG.tunnelLineOpacity
      const cb = scratchColor.b * CONFIG.tunnelLineOpacity
      // Glow strength lives in the colour, not material.opacity - the
      // opacity-mover pass owns that and would overwrite it every frame.
      const gr = cr * glowIntensity * 0.35
      const gg = cg * glowIntensity * 0.35
      const gb = cb * glowIntensity * 0.35
      const segments = 30
      let prev: { x: number; y: number } | null = null
      for (let s = 0; s <= segments; s++) {
        const t = s / segments
        const projected = project(
          back.x + (front.x - back.x) * t,
          back.y + (front.y - back.y) * t,
          back.z + (front.z - back.z) * t,
          centerX, centerY, CONFIG.focalLength,
        )
        if (!projected) { prev = null; continue }
        const x = toLocalX(projected.x)
        const y = toLocalY(projected.y)
        if (prev && segmentBudget > 0) {
          segmentBudget--
          buffers.tunnelPos.push(prev.x, prev.y, 0, x, y, 0)
          buffers.tunnelCol.push(cr, cg, cb, cr, cg, cb)
          buffers.tunnelGlowCol.push(gr, gg, gb, gr, gg, gb)
        }
        prev = { x, y }
      }
    }

    // ---- Endpoint dots. A near-zero-length segment renders as a round cap, so
    //      the dots ride the same instanced-line machinery as everything else.
    const dotPulse = 0.5 + 0.5 * Math.sin(elapsed * Math.PI * 3)
    for (const branch of frontBranches) {
      if (branch.generation !== generations - 1) continue
      const last = branch.points[branch.points.length - 1]
      const projected = project(last.x, last.y, last.z, centerX, centerY, CONFIG.focalLength)
      if (!projected || segmentBudget <= 0) continue
      segmentBudget--
      scratchColor.setHSL((branch.hue % 1 + 1) % 1, 1, 0.7)
      const x = toLocalX(projected.x)
      const y = toLocalY(projected.y)
      const nudge = viewport.height * 0.0001
      buffers.dotPos.push(x, y, 0, x + nudge, y, 0)
      buffers.dotCol.push(
        scratchColor.r * 0.9, scratchColor.g * 0.9, scratchColor.b * 0.9,
        scratchColor.r * 0.9, scratchColor.g * 0.9, scratchColor.b * 0.9,
      )
    }

    // ---- Upload. Widths are authored against the 1024-tall virtual frame, so
    //      they scale to whatever the framebuffer actually is.
    const deviceH = Math.max(1, size.height * viewport.dpr)
    resolution.set(Math.max(1, size.width * viewport.dpr), deviceH)
    const pxScale = deviceH / VIRTUAL_H

    for (let g = 0; g < MAX_GENERATIONS; g++) {
      const width = lineWidth * Math.pow(0.7, g) * pxScale
      commitPass(passes.core[g], buffers.corePos[g], buffers.coreCol[g], width)
      // The glow pass stands in for shadowBlur: wider, dimmer, drawn underneath.
      commitPass(passes.glow[g], buffers.glowPos[g], buffers.glowCol[g], width + (10 + g * 2) * pxScale)
    }
    commitPass(passes.tunnel, buffers.tunnelPos, buffers.tunnelCol, 1 * pxScale)
    commitPass(passes.tunnelGlow, buffers.tunnelPos, buffers.tunnelGlowCol, 8 * pxScale)
    const dotRadius = (2 + dotPulse * 1.5) * 2 * pxScale
    commitPass(passes.dots, buffers.dotPos, buffers.dotCol, Math.max(1, dotRadius))

    // ---- Pulse rings: expanding annuli that rotate the hue of whatever they
    //      cross, replacing the original's second inverted render.
    const ringValues = rings.uRings.value
    for (const ring of ringValues) ring.set(0, 0, 0)
    rings.uRingCenter.value.set(resolution.x / 2, resolution.y / 2)
    if (colorPulse) {
      let ringIndex = 0
      // Newest first, so the freshest rings win the fixed-size uniform slots.
      for (let i = pastNotes.length - 1; i >= 0 && ringIndex < MAX_RINGS; i--) {
        const age = (state.beat - pastNotes[i].beat) * state.secPerBeat
        const opacity = 1 - age / pulseFadeDuration
        if (opacity <= 0) continue
        ringValues[ringIndex++].set(
          age * pulseSpeed * pxScale,
          (pulseBandWidth * 0.5) * pxScale,
          opacity,
        )
      }
    }
  })

  // The backdrop plane sits just behind the lines; the lines themselves live at
  // the full-frame group's origin - the distance `viewport` is measured at.
  return (
    <group ref={groupRef}>
      <mesh ref={bgRef} position={[0, 0, -0.01]}>
        <planeGeometry args={[viewport.width * 1.02, viewport.height * 1.02]} />
        <meshBasicMaterial color="#050508" depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
