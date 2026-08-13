'use client'

// Bespoke settings for the 3D Shape instrument, built from the console kit
// (./console) to docs/instrument-panel-design-guide.md: full-bleed in the
// chassis, washed with a dark shade of the instrument's own color, no
// in-panel title or reset chrome. A live orbitable preview of the real solid
// (the instrument's actual physical material, driven by the same
// applyFundamentalSurface the scene uses), then the geometry vocabulary as a
// glyph grid, the FINISH segments with the four surface toggles, and two knob
// rows - SIZE / SPIN / TUBE with the color pill far right, and the WIDTH /
// HEIGHT / DEPTH proportions beneath.

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
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
import {
  bindPanel,
  ColorPill,
  Console,
  ControlRow,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  Segmented,
  spillOf,
  towardWhite,
  useConsoleAccent,
  withAlpha,
  type BooleanBinding,
  type StringBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

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
    <PreviewWindow
      height={132}
      rounded
      testId="cube-live-preview"
      title="Drag to orbit the solid"
      className="cursor-grab active:cursor-grabbing"
    >
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1.1, 4.6], fov: 42 }} gl={{ antialias: true, alpha: true }} shadows>
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
      </Canvas>
    </PreviewWindow>
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

/** Each option IS its solid (the guide's segments-with-shapes rule), on the
 *  same accent-lit chip vocabulary as the other glyph grids. */
function GeometryGrid({ b }: { b: StringBinding }) {
  const accent = useConsoleAccent()
  const selected = normalizeFundamentalGeometry(b.value)
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
            onClick={() => b.set(option.id)}
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

// ── Surface toggles ─────────────────────────────────────────────────────────

/** A segmented-control-style chip for one boolean surface param: the lit state
 *  wears the accent as light, off stays neutral - same vocabulary as the
 *  guide's segmented control, one independent segment per physical property. */
function SurfaceToggle({ b, label }: {
  b: BooleanBinding | null
  label: string
}) {
  const accent = useConsoleAccent()
  if (!b) return null
  const on = b.value >= 0.5
  return (
    <button
      aria-pressed={on}
      aria-label={`${b.def.label} ${on ? 'on' : 'off'}`}
      onClick={() => b.set(on ? 0 : 1)}
      // h-full: the row is items-stretch, so the toggles track the kit
      // Segmented's height instead of pinning their own.
      className={`h-full min-h-6 rounded-[4px] border text-[7px] font-semibold tracking-[0.12em] transition-colors ${on
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

// ── The panel ───────────────────────────────────────────────────────────────

export const CubeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const color = b.color('baseColor')
  const geometry = b.string('geometry')
  const size = b.num('size')
  const spin = b.num('spinSpeed')
  const dimX = b.num('dimX')
  const dimY = b.num('dimY')
  const dimZ = b.num('dimZ')
  const tube = b.num('tube')
  const sides = b.num('sides')
  const finish = b.select('finish')
  // The surface toggles and SHADE are showIf-gated on the finish, so whichever
  // set is off-mode is absent here - optional bindings, never fallback checks.
  const shading = b.num('shading', { optional: true })
  const reflective = b.boolean('reflective', { optional: true })
  const refractive = b.boolean('refractive', { optional: true })
  const shaded = b.boolean('shaded', { optional: true })
  const textured = b.boolean('textured', { optional: true })

  if (!color || !geometry || !size || !spin) return <ParameterList parameters={parameters} />

  const accent = color.value || DEFAULT_FUNDAMENTAL_COLOR
  const pillHalo = `0 0 10px ${withAlpha(accent, 0.35)}`

  const selectedGeometry = normalizeFundamentalGeometry(geometry.value)
  const matte = (finish?.value ?? 0) < 0.5
  const surface: FundamentalSurface = {
    reflective: (reflective?.value ?? 0) >= 0.5,
    refractive: (refractive?.value ?? 0) >= 0.5,
    shaded: (shaded?.value ?? 1) >= 0.5,
    textured: (textured?.value ?? 0) >= 0.5,
  }

  return (
    <Console accent={accent} bleed="full" testId="cube-user-interface">
      <SolidPreview
        geometry={selectedGeometry}
        tube={tube?.value ?? DEFAULT_TUBE_FRACTION}
        sides={normalizeSides(sides?.value ?? DEFAULT_SIDES)}
        color={accent}
        surface={surface}
        matte={matte}
        shading={shading?.value ?? POSTER_SHADE_DEFAULT}
        size={size.value}
        dims={[dimX?.value ?? 1, dimY?.value ?? 1, dimZ?.value ?? 1]}
        spinSpeed={spin.value}
      />
      <div
        // The solid's light spilling through the seam onto the console - the
        // room is lit by the instrument, not painted.
        style={{ background: spillOf(accent) }}
      >
        <GeometryGrid b={geometry} />
        {/* The FINISH picks which surface console follows it: Gloss brings the
            four physical toggles, Matte swaps them for the SHADE knob below. */}
        <div className="flex items-stretch gap-1 px-2 pt-1.5">
          {finish && (
            <div className="w-[108px] shrink-0">
              <Segmented b={finish} name="Finish" />
            </div>
          )}
          {!matte && (
            <div className="grid flex-1 grid-cols-4 gap-1">
              <SurfaceToggle b={reflective} label="REFLECT" />
              <SurfaceToggle b={refractive} label="REFRACT" />
              <SurfaceToggle b={shaded} label="LIT" />
              <SurfaceToggle b={textured} label="TEXTURE" />
            </div>
          )}
        </div>
        <ControlRow className="gap-4 px-3 pt-2">
          <Knob b={size} label="SIZE" large />
          <Knob b={spin} label="SPIN" />
          {matte && <Knob b={shading} label="SHADE" />}
          {TUBED_GEOMETRIES.has(selectedGeometry) && <Knob b={tube} label="TUBE" />}
          {SIDED_GEOMETRIES.has(selectedGeometry) && <Knob b={sides} label="SIDES" />}
          <div className="ml-auto">
            <ColorPill
              b={color}
              halo={pillHalo}
              pillTestId="cube-color-pill"
              wheelTestId="cube-color-wheel"
            />
          </div>
        </ControlRow>
        <ControlRow className="gap-4 px-3 pb-3 pt-1.5">
          <Knob b={dimX} label="WIDTH" />
          <Knob b={dimY} label="HEIGHT" />
          <Knob b={dimZ} label="DEPTH" />
        </ControlRow>
        <More parameters={b.rest()} label="MORE" className="px-3 pb-3" />
      </div>
    </Console>
  )
}
