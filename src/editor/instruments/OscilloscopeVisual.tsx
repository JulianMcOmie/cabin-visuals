import { useContext, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, Quaternion } from 'three'
import { createRasterCanvas, type RasterCanvas } from '../core/visual/rasterCanvas'
import { requestWaveform, waveformKey, waveformRevision } from '../core/visual/previewWaveform'
import { useVisualEngine, VisualEngineContext } from '../core/visual/VisualEngineContext'
import { InstrumentCopyContext } from '../core/visual/instrumentColor'
import { registerFramePreparer } from '../core/export/framePreparers'
import type { ObjectState } from '../core/visual/types'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import { paramDefault } from './types'
import { oscilloscopeInstrument } from './Oscilloscope'

const TEXTURE_HEIGHT = 1024

// Billboard scratch (see the facing math in the frame callback).
const _parentFacing = new Quaternion()
const _inCameraSpace = new Quaternion()
const _roll = new Quaternion()
const _billboard = new Quaternion()

/**
 * The part of `rotation` that is a spin around the camera's view axis, with the
 * part that would tip the plane away from the camera discarded (the twist half
 * of a swing-twist decomposition about Z, which is the view axis in camera
 * space). Keeping only the twist is what makes a rotated scope spin IN the
 * frame - the flat trace can never turn edge-on and vanish, whatever the
 * transform or a mover asks for.
 */
function viewAxisRoll(rotation: Quaternion, out: Quaternion): Quaternion {
  out.set(0, 0, rotation.z, rotation.w)
  // A half-turn about an axis in the XY plane leaves nothing to normalize;
  // there is no roll in it, so it contributes none.
  return out.lengthSq() < 1e-8 ? out.identity() : out.normalize()
}

export function OscilloscopeVisual({ trackId }: { trackId: string }) {
  const { viewport, camera, invalidate } = useThree()
  const groupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<RasterCanvas | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)

  const { getObjectState } = useVisualEngine()
  const preview = useContext(VisualEngineContext)
  const copy = useContext(InstrumentCopyContext)
  const windowRef = useRef<{ key: string; revision: unknown; samples?: Float32Array; promise: Promise<void> } | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const ensureWindow = (state: ObjectState) => {
    const query = { beat: state.beat, bpm: 60 / Math.max(0.0001, state.secPerBeat), beatsPerBar: state.beatsPerBar }
    const key = waveformKey(query), revision = waveformRevision()
    if (windowRef.current?.key === key && windowRef.current.revision === revision) return windowRef.current
    const entry: NonNullable<typeof windowRef.current> = { key, revision, promise: Promise.resolve() }
    windowRef.current = entry
    entry.promise = requestWaveform(query).then(samples => {
      entry.samples = samples
      if (alive.current && windowRef.current === entry) invalidate()
    })
    // Worker/export readiness awaits the original promise and can report a
    // failure. Live callbacks must not create unhandled promise rejections.
    entry.promise.catch(() => {})
    return entry
  }
  const ensureRef = useRef(ensureWindow)
  ensureRef.current = ensureWindow
  useEffect(() => {
    if (preview) return
    return registerFramePreparer(async () => {
      const state = getObjectState(trackId, copy?.visualCopyIndex)
      if (state) await ensureRef.current(state).promise
    })
  }, [preview, getObjectState, trackId, copy?.visualCopyIndex])

  useEffect(() => {
    // Created at a nominal size only: the real width tracks the panel's aspect
    // and is set from the frame callback, which is the one place that knows it.
    const canvas = createRasterCanvas()
    canvas.width = TEXTURE_HEIGHT * 2
    canvas.height = TEXTURE_HEIGHT
    canvasRef.current = canvas

    const texture = new CanvasTexture(canvas)
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    textureRef.current = texture
    invalidate()

    return () => {
      texture.dispose()
      canvasRef.current = null
      textureRef.current = null
    }
  }, [invalidate])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    const group = groupRef.current
    if (!canvas || !texture || !mesh || !group) return false

    // Fit to screen = the legacy pinning: the renderer gives this object's group
    // the camera-facing screen anchor instead of a placement transform, and the
    // anchor sits at exactly the distance r3f's `viewport` sizing assumes, so a
    // viewport-sized plane fills the frame (core/visual/screenAnchor.ts).
    // `state.params` only carries what the track stored, so every read falls
    // back to the SCHEMA rather than to a repeated literal.
    const par = (key: string) => state.params[key] ?? paramDefault(oscilloscopeInstrument, key)
    const fitToScreen = par('fitToScreen') >= 0.5
    const panelWidth = fitToScreen ? viewport.width : Math.max(0.01, par('panelWidth'))
    const panelHeight = fitToScreen ? viewport.height : Math.max(0.01, par('panelHeight'))

    // Texels stay square: the canvas tracks the panel's aspect, so a round line
    // cap is round whether the scope is a wide strip or a tall block. Resizing
    // a canvas clears it, which is fine - the trace is fully redrawn below.
    const width = Math.max(
      256,
      Math.min(2048, Math.round((TEXTURE_HEIGHT * (panelWidth / panelHeight)) / 64) * 64),
    )
    if (canvas.width !== width) canvas.width = width
    const height = canvas.height

    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    const transparent = par('transparentBackground') >= 0.5
    ctx.clearRect(0, 0, width, height)
    if (!transparent) {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
    }

    const samples = ensureWindow(state).samples
    if (!samples) return false
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) {
      const x = samples.length > 1 ? (i / (samples.length - 1)) * width : width / 2
      const y = height * (0.5 - Math.max(-1, Math.min(1, samples[i])) * 0.44)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = state.stringParams.color ?? '#ffffff'
    ctx.lineWidth = Math.max(1, par('lineWidth'))
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
    // An opaque black scope is a solid card and should occlude what is behind
    // it; a see-through one must not, or its empty pixels would punch a hole in
    // the scene. Depth TESTING is on either way - that is what lets the trace
    // pass behind other objects, which is the whole point of the in-scene mode.
    const depthWrite = !transparent && !fitToScreen
    if (material.depthWrite !== depthWrite) {
      material.depthWrite = depthWrite
      material.needsUpdate = true
    }

    mesh.scale.set(panelWidth, panelHeight, 1)

    // Facing. In fit-to-screen the parent group IS the camera-facing anchor, so
    // any rotation here would tilt the screen off the screen.
    //
    // In scene, the scope keeps a world POSITION - movers, the tf* transform and
    // the camera all carry it around, and it depth-sorts against everything -
    // but its ORIENTATION is pinned to the camera, so a flat trace is never seen
    // edge-on. Authored and mover rotation is not discarded, though: its roll
    // about the view axis survives and spins the scope in the frame (turn it on
    // its side), while the components that would tip it away are dropped.
    // TextDisplay left fullFrame behind the same way (c8c7c11), but conjugates
    // the whole parent rotation - there a tipped word is still legible, here a
    // tipped plane disappears.
    //
    // Written as a LOCAL quaternion, since this group hangs under the placement
    // group: world = parent * local, so local = parent⁻¹ * (camera * roll).
    if (fitToScreen || !group.parent) {
      // The parent group IS the camera-facing screen anchor in this mode; any
      // rotation here would tilt the screen off the screen.
      group.quaternion.identity()
    } else {
      group.parent.getWorldQuaternion(_parentFacing)
      _inCameraSpace.copy(camera.quaternion).invert().multiply(_parentFacing)
      _billboard.copy(_parentFacing).invert()
        .multiply(camera.quaternion)
        .multiply(viewAxisRoll(_inCameraSpace, _roll))
      group.quaternion.copy(_billboard)
    }
  }, waveformRevision)

  return (
    <group ref={groupRef}>
      {/* Unit plane, sized by mesh scale in the frame callback: the panel size
          is a param, and params never re-render this component. */}
      <mesh ref={meshRef}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}
