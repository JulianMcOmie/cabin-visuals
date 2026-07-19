'use client'

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Box as BoxIcon, RotateCcw } from 'lucide-react'
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
import { isNumberParam } from '../instruments/types'
import { ParameterList } from './ParametersUserInterface'
import type { UserInterfaceParameter, UserInterfaceRendererDefinition } from './types'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function parameter(parameters: readonly UserInterfaceParameter[], key: string) {
  return parameters.find((candidate) => candidate.definition.key === key)
}

function numericValue(bound: UserInterfaceParameter | undefined, fallback = 0): number {
  return typeof bound?.value === 'number' ? bound.value : fallback
}

function stringValue(bound: UserInterfaceParameter | undefined, fallback: string): string {
  return typeof bound?.value === 'string' ? bound.value : fallback
}

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

function PreviewSolid({
  geometry,
  color,
  size,
  spinSpeed,
  position,
}: {
  geometry: FundamentalGeometryId
  color: string
  size: number
  spinSpeed: number
  position: [number, number, number]
}) {
  const groupRef = useRef<Group>(null)

  useFrame(({ clock }) => {
    const group = groupRef.current
    if (!group) return
    group.rotation.set(...cubeSpinRotation(clock.elapsedTime * 2, spinSpeed))
  })

  const previewScale = clamp(size / 1.6, 0.42, 1.48)
  const previewPosition: [number, number, number] = [
    clamp(position[0] / 10, -1, 1) * 0.5,
    clamp(position[1] / 10, -1, 1) * 0.34,
    clamp(position[2] / 10, -1, 1) * 0.5,
  ]

  return (
    <group ref={groupRef} position={previewPosition} scale={previewScale}>
      <FundamentalMesh geometry={geometry} color={color} />
    </group>
  )
}

function SolidPreview({
  geometry,
  color,
  size,
  spinSpeed,
  position,
}: {
  geometry: FundamentalGeometryId
  color: string
  size: number
  spinSpeed: number
  position: [number, number, number]
}) {
  return (
    <div
      data-testid="cube-live-preview"
      className="relative h-[136px] overflow-hidden border-y border-white/[0.07]"
      style={{
        background: 'radial-gradient(circle at 50% 38%, rgba(87,87,219,0.18), rgba(7,9,14,0.97) 63%), linear-gradient(145deg, #111522, #07090e)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          maskImage: 'linear-gradient(to bottom, transparent, black 42%, black)',
        }}
      />
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.2, 5], fov: 55 }}
        gl={{ antialias: true, alpha: true }}
      >
        <MatchingEnvironment />
        <ambientLight intensity={0.12} />
        <hemisphereLight color="#dbeafe" groundColor="#170921" intensity={0.55} />
        <directionalLight position={[4, 7, 5]} intensity={2.4} castShadow />
        <pointLight position={[-4, 2, -3]} color="#60a5fa" intensity={7} distance={20} decay={2} />
        <pointLight position={[3, -1, 3]} color="#fb7185" intensity={3.5} distance={16} decay={2} />
        <PreviewSolid geometry={geometry} color={color} size={size} spinSpeed={spinSpeed} position={position} />
        <ContactShadows position={[0, -1.42, 0]} opacity={0.42} scale={6} blur={2.5} far={4.5} color="#02030a" />
        <gridHelper args={[8, 16, '#2b3250', '#151a27']} position={[0, -1.4, 0]} />
        <OrbitControls makeDefault enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} />
      </Canvas>
    </div>
  )
}

function MiniKnob({
  parameter: bound,
  label,
  suffix = '',
}: {
  parameter: UserInterfaceParameter
  label: string
  suffix?: string
}) {
  const definition = bound.definition
  const dragRef = useRef<{ y: number; value: number } | null>(null)
  if (!isNumberParam(definition) || typeof bound.value !== 'number') return null

  const value = bound.value
  const range = definition.max - definition.min
  const percent = range === 0 ? 0 : clamp((value - definition.min) / range, 0, 1)
  const angle = -135 + percent * 270

  const commit = (raw: number) => {
    const snapped = definition.min + Math.round((raw - definition.min) / definition.step) * definition.step
    bound.setValue(clamp(Number(snapped.toFixed(8)), definition.min, definition.max))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { y: event.clientY, value }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    commit(dragRef.current.value + ((dragRef.current.y - event.clientY) / 100) * range)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1
    commit(value + direction * definition.step)
  }

  return (
    <div className="flex min-w-0 flex-col items-center py-1">
      <div
        role="slider"
        tabIndex={0}
        aria-label={definition.label}
        aria-valuemin={definition.min}
        aria-valuemax={definition.max}
        aria-valuenow={value}
        title="Drag vertically · double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => bound.setValue(definition.default)}
        onKeyDown={onKeyDown}
        className="relative h-12 w-12 cursor-ns-resize touch-none rounded-full outline-none ring-offset-2 ring-offset-[#0b0e15] focus-visible:ring-2 focus-visible:ring-violet-400"
        style={{
          background: `conic-gradient(from 225deg, #9d8cff 0deg ${percent * 270}deg, #242938 ${percent * 270}deg 270deg, transparent 270deg)`,
          boxShadow: '0 7px 13px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.13)',
        }}
      >
        <div className="absolute inset-1 rounded-full border border-white/10 bg-[radial-gradient(circle_at_38%_28%,#3b4050,#171a23_52%,#090b10_78%)]" />
        <div className="absolute inset-0" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="absolute left-1/2 top-[7px] h-3 w-[2px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,.65)]" />
        </div>
      </div>
      <div className="mt-1 flex max-w-full items-baseline gap-1">
        <span className="text-[8px] font-semibold tracking-[0.1em] text-white/38">{label}</span>
        <span className="font-mono text-[8px] tabular-nums text-violet-200">{value.toFixed(2)}{suffix}</span>
      </div>
    </div>
  )
}

function XYPad({ x, y }: { x: UserInterfaceParameter; y: UserInterfaceParameter }) {
  const padRef = useRef<HTMLDivElement>(null)
  const xDefinition = x.definition
  const yDefinition = y.definition
  if (!isNumberParam(xDefinition) || !isNumberParam(yDefinition)) return null
  if (typeof x.value !== 'number' || typeof y.value !== 'number') return null

  const xPercent = ((x.value - xDefinition.min) / (xDefinition.max - xDefinition.min)) * 100
  const yPercent = 100 - ((y.value - yDefinition.min) / (yDefinition.max - yDefinition.min)) * 100

  const setFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    const snap = (raw: number, min: number, max: number, step: number) =>
      clamp(min + Math.round((raw - min) / step) * step, min, max)
    x.setValue(snap(xDefinition.min + nx * (xDefinition.max - xDefinition.min), xDefinition.min, xDefinition.max, xDefinition.step))
    y.setValue(snap(yDefinition.max - ny * (yDefinition.max - yDefinition.min), yDefinition.min, yDefinition.max, yDefinition.step))
  }

  return (
    <div
      ref={padRef}
      data-testid="cube-xy-pad"
      role="group"
      aria-label="Cube X and Y position"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setFromPointer(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setFromPointer(event)
      }}
      onDoubleClick={() => { x.setValue(0); y.setValue(0) }}
      className="relative h-[82px] cursor-crosshair touch-none overflow-hidden rounded-md border border-white/10 bg-[#090c13] shadow-[inset_0_0_20px_rgba(0,0,0,.58)]"
      style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)',
        backgroundSize: '20% 25%',
      }}
    >
      <span className="absolute left-1/2 top-0 h-full w-px bg-white/10" />
      <span className="absolute left-0 top-1/2 h-px w-full bg-white/10" />
      <span
        className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-violet-500 shadow-[0_0_0_3px_rgba(139,92,246,.16),0_0_14px_rgba(139,92,246,.75)]"
        style={{ left: `${xPercent}%`, top: `${yPercent}%` }}
      />
      <span className="absolute bottom-1 left-1.5 font-mono text-[7px] text-white/30">X {x.value.toFixed(1)}</span>
      <span className="absolute right-1.5 top-1 font-mono text-[7px] text-white/30">Y {y.value.toFixed(1)}</span>
    </div>
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

function GeometrySelector({ bound }: { bound: UserInterfaceParameter }) {
  const selected = normalizeFundamentalGeometry(bound.value)
  return (
    <div className="grid grid-cols-5 gap-1 border-t border-white/[0.06] px-2 py-1.5">
      {FUNDAMENTAL_GEOMETRIES.map((option) => {
        const active = option.id === selected
        return (
          <button
            key={option.id}
            data-testid={`geometry-${option.id}`}
            aria-label={`Use ${option.label} geometry`}
            aria-pressed={active}
            onClick={() => bound.setValue(option.id)}
            className={`flex min-w-0 flex-col items-center gap-0.5 rounded-md border py-1.5 transition-colors ${active
              ? 'border-violet-300/35 bg-violet-500/16 text-violet-100'
              : 'border-white/[0.07] bg-white/[0.025] text-white/30 hover:bg-white/[0.06] hover:text-white/65'}`}
          >
            <GeometryGlyph geometry={option.id} />
            <span className="max-w-full truncate text-[6px] font-semibold tracking-[0.06em]">{option.shortLabel}</span>
          </button>
        )
      })}
    </div>
  )
}

function ColorSwatch({ bound }: { bound: UserInterfaceParameter }) {
  if (typeof bound.value !== 'string') return null
  return (
    <label
      title={`Color ${bound.value}`}
      className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-md border border-white/15 shadow-[0_0_14px_rgba(99,102,241,.22)]"
      style={{ background: bound.value }}
    >
      <input
        type="color"
        aria-label="Cube material color"
        value={bound.value}
        onChange={(event) => bound.setValue(event.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  )
}

export const CubeUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const size = parameter(parameters, 'baseSize')
  const color = parameter(parameters, 'baseColor')
  const geometry = parameter(parameters, 'geometry')
  const x = parameter(parameters, 'baseXPosition')
  const y = parameter(parameters, 'baseYPosition')
  const z = parameter(parameters, 'baseZPosition')
  const spin = parameter(parameters, 'spinSpeed')

  if (!size || !color || !geometry || !x || !y || !z || !spin) return <ParameterList parameters={parameters} />

  const setPosition = (nextX: number, nextY: number, nextZ: number) => {
    x.setValue(nextX)
    y.setValue(nextY)
    z.setValue(nextZ)
  }

  const resetAll = () => {
    for (const bound of parameters) bound.setValue(bound.definition.default)
  }

  const selectedGeometry = normalizeFundamentalGeometry(geometry.value)
  const selectedLabel = FUNDAMENTAL_GEOMETRIES.find(({ id }) => id === selectedGeometry)?.label ?? 'Cube'

  return (
    <section
      data-testid="cube-user-interface"
      className="-mx-1 overflow-hidden rounded-xl border border-white/[0.09] bg-[#0b0e15] text-white shadow-[0_18px_42px_rgba(0,0,0,.34)]"
    >
      <header className="flex h-10 items-center justify-between px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-violet-300/20 bg-violet-500/15 text-violet-200">
            <GeometryGlyph geometry={selectedGeometry} />
          </div>
          <span className="truncate text-[10px] font-bold uppercase tracking-[0.13em] text-white/85">{selectedLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <ColorSwatch bound={color} />
          <button
            aria-label="Reset all Cube parameters"
            title="Reset all"
            onClick={resetAll}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-white/35 transition-colors hover:bg-white/[0.08] hover:text-white/70"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </header>

      <GeometrySelector bound={geometry} />

      <SolidPreview
        geometry={selectedGeometry}
        color={stringValue(color, DEFAULT_FUNDAMENTAL_COLOR)}
        size={numericValue(size, 1.6)}
        spinSpeed={numericValue(spin)}
        position={[numericValue(x), numericValue(y), numericValue(z)]}
      />

      <div className="space-y-2 p-2">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.07] bg-white/[0.025] px-1.5 py-1">
          <MiniKnob parameter={size} label="SIZE" suffix="×" />
          <MiniKnob parameter={spin} label="SPIN" suffix="×" />
          <MiniKnob parameter={z} label="Z" />
        </div>

        <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-1.5">
          <XYPad x={x} y={y} />
          <div className="mt-1.5 grid grid-cols-4 gap-1">
            {[
              { label: 'CTR', ariaLabel: 'Center position', values: [0, 0, 0] },
              { label: 'LEFT', ariaLabel: 'Place left', values: [-3, 0, 0] },
              { label: 'UP', ariaLabel: 'Place high', values: [0, 3, 0] },
              { label: 'BACK', ariaLabel: 'Place deep', values: [0, 0, -3] },
            ].map((preset) => (
              <button
                key={preset.label}
                aria-label={preset.ariaLabel}
                onClick={() => setPosition(preset.values[0], preset.values[1], preset.values[2])}
                className="rounded border border-white/[0.07] bg-black/15 px-1 py-1.5 text-[7px] font-semibold tracking-[0.06em] text-white/32 transition-colors hover:border-violet-300/25 hover:bg-violet-500/10 hover:text-violet-100"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
