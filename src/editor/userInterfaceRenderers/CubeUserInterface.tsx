'use client'

// Bespoke settings for the 3D Shape instrument, following
// docs/instrument-panel-design-guide.md: full-bleed in the chassis, washed with
// a dark shade of the instrument's own color, no in-panel title or reset
// chrome. A live orbitable preview of the real solid (the instrument's actual
// physical material, driven by the same applyFundamentalSurface the scene
// uses), then the geometry vocabulary as a glyph grid, the four surface
// toggles, and two knob rows - SIZE / SPIN / TUBE with the color pill far
// right, and the WIDTH / HEIGHT / DEPTH proportions beneath.

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PreviewCanvas } from './console'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Color, PMREMGenerator, type Group, type Mesh, type MeshPhysicalMaterial } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { POSTER_SHADE_DEFAULT, createPosterMaterial } from '../instruments/posterShading'
import { cubeSpinRotation } from '../core/visual/cubeSpin'
import {
  DEFAULT_FUNDAMENTAL_COLOR,
  DEFAULT_SIDES,
  DEFAULT_TUBE_FRACTION,
  FUNDAMENTAL_GEOMETRIES,
  FUNDAMENTAL_MATERIAL_PROPS,
  FundamentalGeometryShape,
  SIDED_GEOMETRIES,
  TUBED_GEOMETRIES,
  applyFundamentalSurface,
  normalizeFundamentalGeometry,
  normalizeSides,
  type FundamentalGeometryId,
  type FundamentalSurface,
} from '../instruments/FundamentalGeometry'
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import { ColorWheelPill, hexToHsv, hsvToHex, towardWhite, withAlpha } from './colorWheel'
import { LaserKnob } from './laserKnob'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback: number): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function stringValue(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

function toggleOn(bound: UserInterfaceParameter | undefined, fallback: boolean): boolean {
  return typeof bound?.value === 'number' ? bound.value >= 0.5 : fallback
}

// ── Live preview ────────────────────────────────────────────────────────────

/** The main viewport's environment map, so REFLECT and REFRACT show the real
 *  thing the scene material responds to rather than bare lights. */
function MatchingEnvironment() {
  const { gl, scene } = useThree()

  useEffect(() => {
    const room = new RoomEnvironment()
    const pmrem = new PMREMGenerator(gl)
    const target = pmrem.fromScene(room, 0.04)
    const previous = scene.environment
    room.dispose()
    pmrem.dispose()
    scene.environment = target.texture
    return () => {
      scene.environment = previous
      target.dispose()
    }
  }, [gl, scene])

  return null
}

function PreviewSolid({ geometry, tube, sides, color, surface, matte, shading, size, dims, spinSpeed }: {
  geometry: FundamentalGeometryId
  tube: number
  sides: number
  color: string
  surface: FundamentalSurface
  matte: boolean
  shading: number
  size: number
  dims: [number, number, number]
  spinSpeed: number
}) {
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const materialRef = useRef<MeshPhysicalMaterial>(null)
  const tint = useRef(new Color()).current
  // The Matte finish previews with the REAL poster material (same module as
  // the scene instrument), swapped on exactly like Cube.tsx does.
  const posterMaterial = useMemo(() => createPosterMaterial(), [])
  useEffect(() => () => posterMaterial.dispose(), [posterMaterial])

  // Surface + color land through the SAME applier as the scene instrument, in
  // useFrame so edits hit the existing material without a remount.
  useFrame(({ clock }) => {
    const group = groupRef.current
    if (group) group.rotation.set(...cubeSpinRotation(clock.elapsedTime * 2, spinSpeed))
    const mesh = meshRef.current
    const material = materialRef.current
    if (!mesh || !material) return
    tint.set(color)
    if (matte) {
      if (mesh.material !== posterMaterial) mesh.material = posterMaterial
      ;(posterMaterial.uniforms.uColor.value as Color).copy(tint)
      posterMaterial.uniforms.uShade.value = shading
      posterMaterial.uniforms.uEnergy.value = 0
    } else {
      if (mesh.material !== material) mesh.material = material
      applyFundamentalSurface(material, surface, tint, 0)
    }
  })

  // Map params into preview-safe ranges: SIZE normalized to the tiny room, the
  // proportions shown truthfully but capped so the solid never leaves frame.
  const base = 0.5 * clamp(size, 0.35, 1.7)
  const maxDim = Math.max(dims[0], dims[1], dims[2], 0.25)
  const fit = maxDim > 1.7 ? 1.7 / maxDim : 1
  const scale: [number, number, number] = [base * fit * dims[0], base * fit * dims[1], base * fit * dims[2]]

  return (
    <group ref={groupRef} scale={scale}>
      <mesh ref={meshRef} castShadow>
        <FundamentalGeometryShape geometry={geometry} tube={tube} sides={sides} />
        <meshPhysicalMaterial ref={materialRef} {...FUNDAMENTAL_MATERIAL_PROPS} />
      </mesh>
    </group>
  )
}

function SolidPreview({ geometry, tube, sides, color, surface, matte, shading, size, dims, spinSpeed }: {
  geometry: FundamentalGeometryId
  tube: number
  sides: number
  color: string
  surface: FundamentalSurface
  matte: boolean
  shading: number
  size: number
  dims: [number, number, number]
  spinSpeed: number
}) {
  return (
    <div
      data-testid="cube-live-preview"
      title="Drag to orbit the solid"
      className="relative h-[132px] cursor-grab overflow-hidden rounded-t-[9px] border-b border-white/[0.06] bg-[#05070c] active:cursor-grabbing"
    >
      <PreviewCanvas dpr={[1, 1.5]} camera={{ position: [0, 1.1, 4.6], fov: 42 }} gl={{ antialias: true, alpha: true }} shadows>
        <color attach="background" args={['#05070c']} />
        <MatchingEnvironment />
        <ambientLight intensity={0.08} />
        <directionalLight position={[4, 7, 5]} intensity={1.5} castShadow />
        <pointLight position={[-4, 2, -3]} color={color} intensity={3} distance={18} decay={2} />
        <PreviewSolid geometry={geometry} tube={tube} sides={sides} color={color} surface={surface} matte={matte} shading={shading} size={size} dims={dims} spinSpeed={spinSpeed} />
        {/* The floor grid doubles as the thing REFRACT visibly bends. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow>
          <circleGeometry args={[5, 48]} />
          <meshStandardMaterial color="#080b11" roughness={1} metalness={0} />
        </mesh>
        <gridHelper args={[9, 18, '#1f2637', '#10141d']} position={[0, -1.49, 0]} />
        <ContactShadows position={[0, -1.48, 0]} opacity={0.4} scale={6} blur={2.5} far={4.5} color="#02030a" />
        <OrbitControls
          makeDefault
          target={[0, -0.1, 0]}
          enablePan={false}
          enableZoom={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.15}
          maxPolarAngle={Math.PI * 0.62}
        />
      </PreviewCanvas>
    </div>
  )
}

// ── Geometry vocabulary ─────────────────────────────────────────────────────

function GeometryGlyph({ geometry }: { geometry: FundamentalGeometryId }) {
  const shared = 'h-3.5 w-3.5 fill-none stroke-current'
  switch (geometry) {
    case 'cube':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <path d="M12 3 20 7.5v9L12 21 4 16.5v-9L12 3Zm0 0v9m0 0L4 7.5M12 12l8-4.5" />
        </svg>
      )
    case 'tetrahedron':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <polygon points="12,3 21,20 3,20" />
          <path d="M12 3v17" opacity="0.5" />
        </svg>
      )
    case 'octahedron':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <polygon points="12,2 21,12 12,22 3,12" />
          <path d="M3 12h18" opacity="0.5" />
        </svg>
      )
    case 'dodecahedron':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <polygon points="12,2 21,9 18,20 6,20 3,9" />
          <polygon points="12,7 16.5,10.5 15,15.5 9,15.5 7.5,10.5" opacity="0.5" />
        </svg>
      )
    case 'icosahedron':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <polygon points="12,2 20,7 21,16 12,22 3,16 4,7" />
          <path d="M4 7l17 9M20 7L3 16M12 2v20" opacity="0.5" />
        </svg>
      )
    case 'sphere':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="9" ry="3.5" opacity="0.5" />
        </svg>
      )
    case 'cylinder':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <ellipse cx="12" cy="5" rx="7" ry="2.5" />
          <path d="M5 5v14M19 5v14M5 19a7 2.5 0 0 0 14 0" />
        </svg>
      )
    case 'prism':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <path d="M9 4 16 8v12L9 16V4Zm0 0L4 8m5 8-5 4M4 8v12l5-4m7-8 4-2m-4 14 4-2V6" />
        </svg>
      )
    case 'cone':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <path d="M12 3 19 18M12 3 5 18" />
          <ellipse cx="12" cy="18" rx="7" ry="2.5" />
        </svg>
      )
    case 'capsule':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <rect x="7.5" y="3" width="9" height="18" rx="4.5" />
          <path d="M7.5 8.5c1.2 1 3 1.5 4.5 1.5s3.3-.5 4.5-1.5" opacity="0.5" />
        </svg>
      )
    case 'torus':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <ellipse cx="12" cy="12" rx="9" ry="5.5" />
          <ellipse cx="12" cy="12" rx="3.5" ry="1.8" />
        </svg>
      )
    case 'torusKnot':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24" className={shared} strokeWidth="1.5">
          <path d="M9 4.5a6 6 0 1 0 3.2 11M15 19.5a6 6 0 1 0-3.2-11" />
        </svg>
      )
  }
}

function GeometryGrid({ bound, accent }: { bound: UserInterfaceParameter; accent: string }) {
  const selected = normalizeFundamentalGeometry(bound.value)
  return (
    <div className="grid grid-cols-6 gap-1 px-2 pt-2">
      {FUNDAMENTAL_GEOMETRIES.map((option) => {
        const active = option.id === selected
        return (
          <button
            key={option.id}
            data-testid={`geometry-${option.id}`}
            aria-label={`Use ${option.label} geometry`}
            aria-pressed={active}
            onClick={() => bound.setValue(option.id)}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-[4px] border py-1 transition-colors ${active
              ? ''
              : 'border-white/[0.07] bg-black/20 text-white/35 hover:bg-white/[0.05] hover:text-white/65'}`}
            style={active ? {
              borderColor: withAlpha(accent, 0.45),
              background: withAlpha(accent, 0.18),
              color: towardWhite(accent, 0.62),
            } : undefined}
          >
            <GeometryGlyph geometry={option.id} />
            <span className="max-w-full truncate text-[6px] font-semibold tracking-[0.06em]">{option.shortLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Finish ──────────────────────────────────────────────────────────────────

/** The guide's segmented control: one lit segment on a recessed track. */
function Segmented({ options, value, accent, ariaLabel, onChange }: {
  options: { value: number; label: string; title?: string }[]
  value: number
  accent: string
  ariaLabel: string
  onChange: (value: number) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex h-6 gap-[2px] rounded-[5px] border border-white/[0.07] bg-black/30 p-[2px]"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`flex-1 cursor-pointer rounded-[3px] px-1.5 text-[7px] font-semibold tracking-[0.12em] transition-colors ${
              active ? '' : 'text-white/40 hover:bg-white/[0.04] hover:text-white/65'
            }`}
            style={active
              ? { background: withAlpha(accent, 0.2), color: towardWhite(accent, 0.62) }
              : undefined}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Surface toggles ─────────────────────────────────────────────────────────

/** A segmented-control-style chip for one boolean surface param: the lit state
 *  wears the accent as light, off stays neutral - same vocabulary as the
 *  guide's segmented control, one independent segment per physical property. */
function SurfaceToggle({ bound, label, accent }: {
  bound: UserInterfaceParameter | undefined
  label: string
  accent: string
}) {
  if (!bound || typeof bound.value !== 'number') return null
  const on = bound.value >= 0.5
  return (
    <button
      aria-pressed={on}
      aria-label={`${bound.definition.label} ${on ? 'on' : 'off'}`}
      onClick={() => bound.setValue(on ? 0 : 1)}
      className={`h-6 rounded-[4px] border text-[7px] font-semibold tracking-[0.12em] transition-colors ${on
        ? ''
        : 'border-white/[0.07] bg-black/25 text-white/40 hover:bg-white/[0.05] hover:text-white/65'}`}
      style={on ? {
        borderColor: withAlpha(accent, 0.45),
        background: withAlpha(accent, 0.2),
        color: towardWhite(accent, 0.62),
      } : undefined}
    >
      {label}
    </button>
  )
}

// ── Knobs ───────────────────────────────────────────────────────────────────

function ParamKnob({ parameter: bound, label, accent, large = false }: {
  parameter: UserInterfaceParameter | undefined
  label: string
  accent: string
  large?: boolean
}) {
  if (!bound) return null
  const definition = bound.definition
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null
  return (
    <LaserKnob
      value={bound.value}
      min={definition.min}
      max={definition.max}
      step={definition.step}
      defaultValue={definition.default}
      curve={definition.curve ?? 1}
      label={label}
      ariaLabel={definition.label}
      accent={accent}
      large={large}
      onChange={bound.setValue}
    />
  )
}

// ── The panel ───────────────────────────────────────────────────────────────

export const CubeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const color = parameter(parameters, 'baseColor')
  const geometry = parameter(parameters, 'geometry')
  const size = parameter(parameters, 'size')
  const spin = parameter(parameters, 'spinSpeed')
  const dimX = parameter(parameters, 'dimX')
  const dimY = parameter(parameters, 'dimY')
  const dimZ = parameter(parameters, 'dimZ')
  const tube = parameter(parameters, 'tube')
  const sides = parameter(parameters, 'sides')
  const finish = parameter(parameters, 'finish')
  const shading = parameter(parameters, 'shading')
  // The surface toggles and SHADE are showIf-gated on the finish, so whichever
  // set is off-mode is absent here - optional bindings, never fallback checks.
  const reflective = parameter(parameters, 'reflective')
  const refractive = parameter(parameters, 'refractive')
  const shaded = parameter(parameters, 'shaded')
  const textured = parameter(parameters, 'textured')

  if (!color || !geometry || !size || !spin) return <ParameterList parameters={parameters} />

  const accent = stringValue(color, DEFAULT_FUNDAMENTAL_COLOR)
  const accentHsv = hexToHsv(accent)
  // A hue-true dark shade of the accent, never an alpha tint over the panel gray.
  const shade = hsvToHex(accentHsv.h, Math.min(accentHsv.s, 0.5), 0.075)
  const pillHalo = `0 0 10px ${withAlpha(accent, 0.35)}`

  const selectedGeometry = normalizeFundamentalGeometry(geometry.value)
  const tubeFraction = numericValue(tube, DEFAULT_TUBE_FRACTION)
  const sideCount = normalizeSides(numericValue(sides, DEFAULT_SIDES))
  const matte = numericValue(finish, 0) < 0.5
  const shadeAmount = numericValue(shading, POSTER_SHADE_DEFAULT)
  const surface: FundamentalSurface = {
    reflective: toggleOn(reflective, false),
    refractive: toggleOn(refractive, false),
    shaded: toggleOn(shaded, true),
    textured: toggleOn(textured, false),
  }
  const dims: [number, number, number] = [
    numericValue(dimX, 1),
    numericValue(dimY, 1),
    numericValue(dimZ, 1),
  ]

  return (
    <section
      data-testid="cube-user-interface"
      className="-m-3 rounded-[9px]"
      style={{ background: shade }}
    >
      <SolidPreview
        geometry={selectedGeometry}
        tube={tubeFraction}
        sides={sideCount}
        color={accent}
        surface={surface}
        matte={matte}
        shading={shadeAmount}
        size={numericValue(size, 1)}
        dims={dims}
        spinSpeed={numericValue(spin, 0)}
      />
      <div
        // The solid's light spilling through the seam onto the console - the
        // room is lit by the instrument, not painted.
        style={{ background: `radial-gradient(58% 30px at 50% 0, ${withAlpha(accent, 0.14)}, transparent)` }}
      >
        <GeometryGrid bound={geometry} accent={accent} />
        {/* The FINISH picks which surface console follows it: Gloss brings the
            four physical toggles, Matte swaps them for the SHADE knob below. */}
        <div className="flex items-stretch gap-1 px-2 pt-1.5">
          {finish && (
            <div className="w-[108px] shrink-0">
              <Segmented
                ariaLabel="Finish"
                options={[
                  { value: 0, label: 'MATTE', title: 'Flat poster surface - the Overlap instruments’ look' },
                  { value: 1, label: 'GLOSS', title: 'The physical material with reflections and refraction' },
                ]}
                value={matte ? 0 : 1}
                accent={accent}
                onChange={(v) => finish.setValue(v)}
              />
            </div>
          )}
          {!matte && (
            <div className="grid flex-1 grid-cols-4 gap-1">
              <SurfaceToggle bound={reflective} label="REFLECT" accent={accent} />
              <SurfaceToggle bound={refractive} label="REFRACT" accent={accent} />
              <SurfaceToggle bound={shaded} label="LIT" accent={accent} />
              <SurfaceToggle bound={textured} label="TEXTURE" accent={accent} />
            </div>
          )}
        </div>
        <div className="flex items-end gap-4 px-3 pt-2">
          <ParamKnob parameter={size} label="SIZE" accent={accent} large />
          <ParamKnob parameter={spin} label="SPIN" accent={accent} />
          {matte && <ParamKnob parameter={shading} label="SHADE" accent={accent} />}
          {TUBED_GEOMETRIES.has(selectedGeometry) && (
            <ParamKnob parameter={tube} label="TUBE" accent={accent} />
          )}
          {SIDED_GEOMETRIES.has(selectedGeometry) && (
            <ParamKnob parameter={sides} label="SIDES" accent={accent} />
          )}
          <div className="ml-auto">
            <ColorWheelPill
              value={accent}
              onChange={(hex) => color.setValue(hex)}
              label="COLOR"
              ariaLabel="Shape color"
              halo={pillHalo}
              align="right"
              pillTestId="cube-color-pill"
              wheelTestId="cube-color-wheel"
            />
          </div>
        </div>
        <div className="flex items-end gap-4 px-3 pb-3 pt-1.5">
          <ParamKnob parameter={dimX} label="WIDTH" accent={accent} />
          <ParamKnob parameter={dimY} label="HEIGHT" accent={accent} />
          <ParamKnob parameter={dimZ} label="DEPTH" accent={accent} />
        </div>
      </div>
    </section>
  )
}
