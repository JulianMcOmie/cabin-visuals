import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial } from 'three'
import { getAudioEngine } from '../core/audio/AudioEngine'
import { useInstrumentFrame } from '../core/visual/instrumentFrame'
import type { ObjectInstrumentDef, ParamDef } from './types'

const PARAMS: ParamDef[] = [
  { key: 'color', label: 'Color', type: 'color', default: '#ffffff' },
  { key: 'lineWidth', label: 'Width', min: 1, max: 24, step: 1, default: 4 },
  { key: 'transparentBackground', label: 'Transparent Background', type: 'boolean', default: 1 },
]

const TEXTURE_HEIGHT = 1024

function OscilloscopeVisual({ trackId }: { trackId: string }) {
  const { viewport, invalidate } = useThree()
  const meshRef = useRef<Mesh>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textureRef = useRef<CanvasTexture | null>(null)
  const aspect = viewport.height > 0 ? viewport.width / viewport.height : 1
  const textureWidth = Math.max(256, Math.min(2048, Math.round((TEXTURE_HEIGHT * aspect) / 64) * 64))

  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = textureWidth
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
  }, [invalidate, textureWidth])

  useInstrumentFrame(trackId, (state) => {
    const canvas = canvasRef.current
    const texture = textureRef.current
    const mesh = meshRef.current
    if (!canvas || !texture || !mesh) return false
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    const width = canvas.width
    const height = canvas.height
    const transparent = (state.params.transparentBackground ?? 1) >= 0.5
    ctx.clearRect(0, 0, width, height)
    if (!transparent) {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, width, height)
    }

    const samples = getAudioEngine().getWaveformAtBeat(
      state.beat,
      60 / Math.max(0.0001, state.secPerBeat),
      state.beatsPerBar,
    )
    ctx.beginPath()
    for (let i = 0; i < samples.length; i++) {
      const x = samples.length > 1 ? (i / (samples.length - 1)) * width : width / 2
      const y = height * (0.5 - Math.max(-1, Math.min(1, samples[i])) * 0.44)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = state.stringParams.color ?? '#ffffff'
    ctx.lineWidth = Math.max(1, state.params.lineWidth ?? 4)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    texture.needsUpdate = true
    const material = mesh.material as MeshBasicMaterial
    if (material.map !== texture) {
      material.map = texture
      material.needsUpdate = true
    }
  })

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

export const oscilloscopeInstrument: ObjectInstrumentDef = {
  id: 'oscilloscope',
  name: 'Oscilloscope',
  kind: 'object',
  userInterfaceRenderer: 'oscilloscope',
  params: PARAMS,
  component: OscilloscopeVisual,
  fullFrame: true,
  defaultOnTop: true,
}
