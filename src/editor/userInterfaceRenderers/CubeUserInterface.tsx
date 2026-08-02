'use client'

// Bespoke settings for the fundamental solid ("Cube"), migrated to
// docs/instrument-panel-design-guide.md on the console kit (./console): the
// old card chrome, in-panel title, reset-all button and native color input
// are gone (all deprecated by the guide). What remains is what the
// instrument owns - geometry, color, spin - as a live orbitable solid over a
// geometry strip and one knob row. Placement (position/size) lives on the
// canonical track transform panel, not here.

import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Box as BoxIcon } from 'lucide-react'
import { Group, PMREMGenerator } from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { cubeSpinRotation } from '../core/visual/cubeSpin'
import {
  DEFAULT_FUNDAMENTAL_COLOR,
  FUNDAMENTAL_GEOMETRIES,
  FundamentalMesh,
  normalizeFundamentalGeometry,
  type FundamentalGeometryId,
} from '../instruments/FundamentalGeometry'
import {
  bindPanel,
  Console,
  ControlRow,
  ColorPill,
  Knob,
  More,
  ParameterList,
  PreviewWindow,
  towardWhite,
  useConsoleAccent,
  withAlpha,
  type StringBinding,
} from './console'
import type { UserInterfaceRendererDefinition } from './types'

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

function PreviewSolid({ geometry, color, spinSpeed }: {
  geometry: FundamentalGeometryId
  color: string
  spinSpeed: number
}) {
  const groupRef = useRef<Group>(null)

  useFrame(({ clock }) => {
    const group = groupRef.current
    if (!group) return
    group.rotation.set(...cubeSpinRotation(clock.elapsedTime * 2, spinSpeed))
  })

  return (
    <group ref={groupRef}>
      <FundamentalMesh geometry={geometry} color={color} />
    </group>
  )
}

function SolidPreview({ geometry, color, spinSpeed }: {
  geometry: FundamentalGeometryId
  color: string
  spinSpeed: number
}) {
  return (
    <PreviewWindow
      height={136}
      testId="cube-live-preview"
      title="Drag to orbit"
      className="cursor-grab active:cursor-grabbing"
    >
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.2, 5], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
      >
        <color attach="background" args={['#05070c']} />
        <MatchingEnvironment />
        <ambientLight intensity={0.12} />
        <hemisphereLight color="#dbeafe" groundColor="#170921" intensity={0.55} />
        <directionalLight position={[4, 7, 5]} intensity={2.4} castShadow />
        <pointLight position={[-4, 2, -3]} color="#60a5fa" intensity={7} distance={20} decay={2} />
        <pointLight position={[3, -1, 3]} color="#fb7185" intensity={3.5} distance={16} decay={2} />
        <PreviewSolid geometry={geometry} color={color} spinSpeed={spinSpeed} />
        <ContactShadows position={[0, -1.42, 0]} opacity={0.42} scale={6} blur={2.5} far={4.5} color="#02030a" />
        <gridHelper args={[8, 16, '#2b3250', '#151a27']} position={[0, -1.4, 0]} />
        <OrbitControls makeDefault enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} />
      </Canvas>
    </PreviewWindow>
  )
}

function GeometryGlyph({ geometry }: { geometry: FundamentalGeometryId }) {
  if (geometry === 'cube') return <BoxIcon size={14} strokeWidth={1.5} />
  const points = geometry === 'tetrahedron'
    ? '12,3 21,20 3,20'
    : geometry === 'octahedron'
      ? '12,2 21,12 12,22 3,12'
      : geometry === 'dodecahedron'
        ? '12,2 21,9 18,20 6,20 3,9'
        : '12,2 20,7 21,16 12,22 3,16 4,7'
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.5">
      <polygon points={points} />
      {geometry === 'icosahedron' && <path d="M4 7l17 9M20 7L3 16M12 2v20" />}
    </svg>
  )
}

/** Each option IS its shape (the guide's segments-with-shapes rule), in the
 *  same chip vocabulary as the Mover's easing strip. */
function GeometrySelector({ b }: { b: StringBinding }) {
  const accent = useConsoleAccent()
  const selected = normalizeFundamentalGeometry(b.value)
  return (
    <div className="grid grid-cols-5 gap-1 px-3 pt-2">
      {FUNDAMENTAL_GEOMETRIES.map((option) => {
        const active = option.id === selected
        return (
          <button
            key={option.id}
            data-testid={`geometry-${option.id}`}
            aria-label={`Use ${option.label} geometry`}
            aria-pressed={active}
            onClick={() => b.set(option.id)}
            className={`flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-md border py-1.5 transition-colors ${
              active ? '' : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'
            }`}
            style={active ? { borderColor: withAlpha(accent, 0.4), background: withAlpha(accent, 0.15), color: towardWhite(accent, 0.45) } : undefined}
          >
            <GeometryGlyph geometry={option.id} />
            <span className="max-w-full truncate text-[6px] font-semibold tracking-[0.06em]">{option.shortLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

export const CubeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const b = bindPanel(parameters)
  const color = b.color('baseColor')
  const geometry = b.string('geometry')
  const spin = b.num('spinSpeed')

  if (!color || !geometry || !spin) return <ParameterList parameters={parameters} />

  const accent = color.value || DEFAULT_FUNDAMENTAL_COLOR

  return (
    <Console accent={accent} testId="cube-user-interface">
      <SolidPreview
        geometry={normalizeFundamentalGeometry(geometry.value)}
        color={accent}
        spinSpeed={spin.value}
      />
      <GeometrySelector b={geometry} />
      <ControlRow spill className="gap-5 px-4 pb-3 pt-2">
        <Knob b={spin} label="SPIN" large suffix="×" />
        <div className="ml-auto">
          <ColorPill b={color} />
        </div>
      </ControlRow>
      <More parameters={b.rest()} />
    </Console>
  )
}
