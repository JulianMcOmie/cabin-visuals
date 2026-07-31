import { useContext, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Color, Mesh, ShaderMaterial } from 'three'
import { beatInBlock, useInstrumentFrame } from '../core/visual/instrumentFrame'
import { getVisualCopy } from '../core/visual/VisualEngine'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { FORCE_TRANSPARENT_KEY } from '../core/visual/animatedOpacity'
import {
  DEFAULT_FLASH_WALL_COLOR,
  FLASH_WALL_BASE_PITCH,
  FLASH_WALL_MAX_ZONES,
  flashWallGrid,
  resolveZoneFlashes,
  zoneColorHex,
  type FlashWallEnvelope,
} from './flashWallCore'
import { paramDefault, type ObjectInstrumentDef, type ParamDef } from './types'

// FLASH WALL - a rectangle of light carved into zones, preset to fill the
// camera. Every MIDI note flashes its zone through an adjustable ADSR
// envelope: the screen becomes a playable light fixture. Pitch walks the zones
// left-to-right (wrapping past the zone count), velocity scales the peak. The
// math lives in flashWallCore.ts (pure, tested); this file is the shader and
// the def. The panel aesthetic - seams, bezel hairlines, vignette, beat-seeded
// grain - is one TEXTURE amount so the instrument stays easy to play with.

const PARAMS: ParamDef[] = [
  { key: 'zones', label: 'Zones', min: 1, max: FLASH_WALL_MAX_ZONES, step: 1, default: 6 },
  {
    key: 'layout',
    label: 'Layout',
    type: 'select',
    options: [
      { value: 0, label: 'Columns' },
      { value: 1, label: 'Rows' },
      { value: 2, label: 'Grid' },
    ],
    default: 0,
  },
  { key: 'attack', label: 'Attack (s)', min: 0, max: 0.6, step: 0.005, default: 0.01, curve: 2 },
  { key: 'decay', label: 'Decay (s)', min: 0.01, max: 2, step: 0.01, default: 0.18, curve: 2 },
  { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'release', label: 'Release (s)', min: 0.01, max: 3, step: 0.01, default: 0.4, curve: 2 },
  { key: 'idle', label: 'Idle Glow', min: 0, max: 0.5, step: 0.01, default: 0.08 },
  { key: 'gap', label: 'Cell Gap', min: 0, max: 0.25, step: 0.005, default: 0.06 },
  { key: 'texture', label: 'Texture', min: 0, max: 1, step: 0.01, default: 0.5 },
  { key: 'color', label: 'Color', type: 'color', default: DEFAULT_FLASH_WALL_COLOR },
  {
    key: 'colorMode',
    label: 'Color Mode',
    type: 'select',
    options: [
      { value: 0, label: 'Solid' },
      { value: 1, label: 'Spectrum' },
      { value: 2, label: 'Pitch' },
    ],
    default: 1,
  },
  // The placement MODE, like Oscilloscope's: full-frame by default (the wall
  // IS the screen), or a real rectangle in the scene with a size and a depth
  // sort. A select so the size sliders can gate on `=0`.
  {
    key: 'fitToScreen',
    label: 'Placement',
    type: 'select',
    options: [
      { value: 1, label: 'Fill screen' },
      { value: 0, label: 'In scene' },
    ],
    default: 1,
  },
  // 16:9, sized to sit fully inside the default camera's frame at the origin.
  { key: 'panelWidth', label: 'Width', min: 0.5, max: 24, step: 0.1, default: 6.4, showIf: 'fitToScreen=0' },
  { key: 'panelHeight', label: 'Height', min: 0.5, max: 16, step: 0.1, default: 3.6, showIf: 'fitToScreen=0' },
]

export const FLASH_WALL_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Zone levels/colors arrive as fixed-size uniform arrays, read via the
// constant-index loop (dynamic uniform-array indexing is not portable GLSL1).
// The look: cells separated by transparent seams, a hairline bezel just inside
// each seam that brightens when the cell fires, a center-weighted vignette,
// and fine grain re-seeded from the BEAT (paused = frozen, per the one rule).
export const FLASH_WALL_FRAGMENT_SHADER = /* glsl */ `
uniform float uCols;
uniform float uRows;
uniform vec3 uColors[${FLASH_WALL_MAX_ZONES}];
uniform float uLevels[${FLASH_WALL_MAX_ZONES}];
uniform float uIdle;
uniform float uGap;
uniform float uTexture;
uniform float uBeat;
uniform float uOpacity;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 grid = vec2(uCols, uRows);
  vec2 flipped = vec2(vUv.x, 1.0 - vUv.y);
  vec2 cell = min(floor(flipped * grid), grid - 1.0);
  int idx = int(cell.y * uCols + cell.x + 0.5);
  vec2 local = flipped * grid - cell;

  float level = 0.0;
  vec3 zoneColor = vec3(0.0);
  for (int i = 0; i < ${FLASH_WALL_MAX_ZONES}; i++) {
    if (i == idx) { level = uLevels[i]; zoneColor = uColors[i]; }
  }

  // Distance to the nearest cell edge, in cell units; the seam is transparent,
  // the bezel is a hairline shelf just inside it.
  vec2 inset = min(local, 1.0 - local);
  float d = min(inset.x, inset.y);
  float g = 0.5 * uGap;
  float mask = smoothstep(g, g + 0.012, d);
  float bezel = smoothstep(g + 0.004, g + 0.02, d) - smoothstep(g + 0.035, g + 0.1, d);

  float vign = 1.0 - uTexture * 0.5 * smoothstep(0.12, 0.72, length(local - 0.5));
  float grain = hash(floor(vUv * vec2(320.0, 180.0)) + floor(uBeat * 4.0)) - 0.5;

  float brightness = uIdle * 0.45 + level * 1.25;
  vec3 col = zoneColor * brightness * vign;
  col = mix(col, vec3(1.0), 0.3 * level * level);
  col += zoneColor * bezel * uTexture * (0.1 + 0.55 * level);
  col += grain * uTexture * (0.05 + 0.12 * level);

  float alpha = mask * clamp(uIdle * 0.85 + level, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(max(col, 0.0) * uOpacity * mask, alpha);
}
`

function FlashWallVisual({ trackId }: { trackId: string }) {
  const { viewport } = useThree()
  const copyContext = useContext(InstrumentCopyContext)
  const meshRef = useRef<Mesh>(null)
  // One uniforms identity for the material's lifetime; values are mutated per
  // frame (never per-frame React state - invariant 4).
  const uniforms = useRef({
    uCols: { value: 6 },
    uRows: { value: 1 },
    uColors: { value: Array.from({ length: FLASH_WALL_MAX_ZONES }, () => new Color(DEFAULT_FLASH_WALL_COLOR)) },
    uLevels: { value: new Float32Array(FLASH_WALL_MAX_ZONES) },
    uIdle: { value: 0.08 },
    uGap: { value: 0.06 },
    uTexture: { value: 0.5 },
    uBeat: { value: 0 },
    uOpacity: { value: 1 },
  }).current
  const envRef = useRef<FlashWallEnvelope>({ attackSec: 0, decaySec: 0.01, sustain: 0, releaseSec: 0.01 })
  const levelsRef = useRef<number[]>([]).current
  const pitchesRef = useRef<number[]>([]).current

  useInstrumentFrame(trackId, (state) => {
    const mesh = meshRef.current
    if (!mesh) return false
    // Fallbacks read the SCHEMA, never a repeated literal (this dir's guide).
    const par = (key: string) => state.params[key] ?? paramDefault(flashWallInstrument, key)

    const zones = Math.max(1, Math.min(FLASH_WALL_MAX_ZONES, Math.round(par('zones'))))
    const { cols, rows } = flashWallGrid(zones, par('layout'))
    const env = envRef.current
    env.attackSec = par('attack')
    env.decaySec = Math.max(0.001, par('decay'))
    env.sustain = par('sustain')
    env.releaseSec = par('release')
    resolveZoneFlashes(state.notes, state.beat, state.secPerBeat, zones, env, levelsRef, pitchesRef)

    const baseHex = state.stringParams.color || DEFAULT_FLASH_WALL_COLOR
    const mode = par('colorMode')
    uniforms.uCols.value = cols
    uniforms.uRows.value = rows
    for (let i = 0; i < FLASH_WALL_MAX_ZONES; i++) {
      const inRange = i < zones
      uniforms.uLevels.value[i] = inRange ? levelsRef[i] : 0
      // Grid filler cells past the zone count idle in the base color.
      uniforms.uColors.value[i].set(
        inRange ? zoneColorHex(baseHex, mode, i, zones, pitchesRef[i]) : baseHex,
      )
    }
    uniforms.uIdle.value = par('idle')
    uniforms.uGap.value = par('gap')
    uniforms.uTexture.value = par('texture')
    uniforms.uBeat.value = state.beat
    // Copy/visibility fades, read from engine state THIS frame (LaserSphere's
    // pattern - a raw ShaderMaterial ignores Material.opacity).
    const copyOpacity = copyContext ? getVisualCopy(trackId, copyContext.visualCopyIndex)?.opacity ?? 1 : 1
    // The idle glow is an ambient baseline, so it gates on block coverage:
    // blocks are the instrument's on-screen region (the beatInBlock contract),
    // and a wall with no block at this beat renders nothing at all.
    const inBlock = beatInBlock(state) ? 1 : 0
    uniforms.uOpacity.value = Math.max(0, Math.min(1, state.opacity * copyOpacity)) * inBlock

    // Fill screen: the renderer parents this object to the camera-facing screen
    // anchor, which sits at the distance r3f's viewport sizing assumes - so a
    // viewport-sized plane fills the frame exactly (Oscilloscope's pattern).
    const fill = par('fitToScreen') >= 0.5
    mesh.scale.set(
      fill ? viewport.width : Math.max(0.01, par('panelWidth')),
      fill ? viewport.height : Math.max(0.01, par('panelHeight')),
      1,
    )
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1, 1]} />
      {/* FORCE_TRANSPARENT is load-bearing for Fill mode: the placement
          wrapper's applyMaterialOpacity resets `transparent` to false at full
          fade, and an opaque full-frame plane REPLACES the frame instead of
          blending - the whole scene behind the wall (background included)
          reads black. With it, seams and unlit cells are truly see-through. */}
      <shaderMaterial
        vertexShader={FLASH_WALL_VERTEX_SHADER}
        fragmentShader={FLASH_WALL_FRAGMENT_SHADER}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        userData={{ [FORCE_TRANSPARENT_KEY]: true }}
      />
    </mesh>
  )
}

// One labelled row per zone, walking up from the base pitch. Rows above the
// current zone count wrap back onto the low zones (zoneOfPitch), so a smaller
// wall never mutes notes. Pitches are frozen: projects store them.
const MIDI_ROWS = Array.from({ length: FLASH_WALL_MAX_ZONES }, (_, i) => {
  const zone = FLASH_WALL_MAX_ZONES - i // first row = top of the list
  return {
    pitch: FLASH_WALL_BASE_PITCH + zone - 1,
    label: `Flash zone ${zone}`,
    emphasized: zone === 1,
  }
})

export const flashWallInstrument: ObjectInstrumentDef = {
  id: 'flashWall',
  name: 'Flash Wall',
  kind: 'object',
  userInterfaceRenderer: 'flashWall',
  params: PARAMS,
  midiRows: MIDI_ROWS,
  component: FlashWallVisual,
  // Full-frame is the default MODE (the wall is the screen), but a track can
  // drop into the scene as a real lit rectangle. Read via isFullFrameTrack.
  fullFrameParam: 'fitToScreen',
}
