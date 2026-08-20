'use client'

// The live window every Scene FX device panel wears: the device's REAL fragment
// shader (effects/scene/previewFrame.ts rewires it onto a procedural reference
// frame) drawn at the panel's own size.
//
// **One WebGL context for the whole family, shared through a module singleton.**
// A rack can have all seven devices expanded at once, and a context per panel
// would put us within reach of the browser's ~16-context budget alongside the
// viewport, the library hover previews and the instrument panels - and when that
// budget is exhausted the browser drops the OLDEST context, which is the main
// VIEWPORT (the war story in userInterfaceRenderers/CLAUDE.md). So the renderer
// below owns exactly one offscreen GL canvas plus a program cache keyed by
// plugin id, and each panel keeps a cheap 2D canvas it blits into.
//
// The blit is `drawImage` straight after `drawArrays` IN THE SAME TASK, which is
// what makes it legal without `preserveDrawingBuffer`: the drawing buffer is
// only guaranteed until the task yields (see the workspace guide's note about
// reading the WebGL canvas). Never split those two across an await or a rAF.
//
// Raw WebGL on the shared preview loop (console/previewLoop.ts) rather than an
// r3f <Canvas>, per the guide: a panel Canvas stays black until the transport
// plays, and a look is exactly what you dial in while parked. The loop's clock
// is panel chrome, not a rendered visual.

import { useEffect, useRef, useState } from 'react'
import { sceneFxPreviewFragment, sceneFxPreviewUniformNames } from '../effects/scene/previewFrame'
import type { VisualEffect } from '../effects/types'
import { PreviewWindow, usePreviewLoop } from './console'

/** Compact, because these stack: a rack of devices is read as a column, and a
 *  148px room per device pushes the third one off the pane. */
const PREVIEW_HEIGHT = 96
const BEATS_PER_SECOND = 2

const QUAD_VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`

interface CompiledDevice {
  program: WebGLProgram
  uniforms: Map<string, WebGLUniformLocation | null>
}

interface SharedRenderer {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  devices: Map<string, CompiledDevice | null>
}

let shared: SharedRenderer | null = null
let sharedFailed = false

function compile(gl: WebGLRenderingContext, type: number, source: string, label: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(`[scene fx preview] ${label} failed to compile:`, gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function getRenderer(): SharedRenderer | null {
  if (shared) return shared.gl.isContextLost() ? null : shared
  if (sharedFailed) return null
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false })
  if (!gl) {
    sharedFailed = true
    return null
  }
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.disable(gl.DEPTH_TEST)
  gl.disable(gl.BLEND)
  shared = { canvas, gl, devices: new Map() }
  return shared
}

/** The device's program, compiled once per plugin id and cached for the session
 *  (a null entry caches the FAILURE too, so a broken shader is reported once
 *  rather than every frame). */
function getDevice(renderer: SharedRenderer, plugin: VisualEffect): CompiledDevice | null {
  const cached = renderer.devices.get(plugin.id)
  if (cached !== undefined) return cached
  const { gl } = renderer
  const vertex = compile(gl, gl.VERTEX_SHADER, QUAD_VERTEX, `${plugin.id} vertex`)
  const fragment = plugin.fragmentShader
    ? compile(gl, gl.FRAGMENT_SHADER, sceneFxPreviewFragment(plugin.fragmentShader), `${plugin.id} fragment`)
    : null
  let compiled: CompiledDevice | null = null
  if (vertex && fragment) {
    const program = gl.createProgram()
    if (program) {
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.bindAttribLocation(program, 0, 'aPos')
      gl.linkProgram(program)
      if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const uniforms = new Map<string, WebGLUniformLocation | null>()
        for (const name of sceneFxPreviewUniformNames(plugin)) {
          uniforms.set(name, gl.getUniformLocation(program, name))
        }
        compiled = { program, uniforms }
      } else {
        console.warn(`[scene fx preview] ${plugin.id} failed to link:`, gl.getProgramInfoLog(program))
        gl.deleteProgram(program)
      }
    }
  }
  if (vertex) gl.deleteShader(vertex)
  if (fragment) gl.deleteShader(fragment)
  renderer.devices.set(plugin.id, compiled)
  return compiled
}

/**
 * Render one device into the shared canvas and hand it back for an immediate
 * blit. The shared canvas only ever GROWS (resizing a drawing buffer clears it
 * and costs an allocation, and panels differ in width), so the frame is drawn
 * into the bottom-left `width × height` corner and the caller copies that rect.
 */
function renderDevice(
  plugin: VisualEffect,
  settings: Record<string, number>,
  beat: number,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const renderer = getRenderer()
  if (!renderer) return null
  const device = getDevice(renderer, plugin)
  if (!device) return null
  const { gl, canvas } = renderer
  if (canvas.width < width || canvas.height < height) {
    canvas.width = Math.max(canvas.width, width)
    canvas.height = Math.max(canvas.height, height)
  }
  gl.useProgram(device.program)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.viewport(0, 0, width, height)
  gl.uniform1f(device.uniforms.get('aspect') ?? null, width / Math.max(1, height))
  gl.uniform1f(device.uniforms.get('time') ?? null, beat)
  for (const param of plugin.params) {
    const location = device.uniforms.get(param.key)
    if (!location) continue
    const stored = settings[param.key]
    const value = typeof stored === 'number'
      ? stored
      : (typeof param.default === 'number' ? param.default : 0)
    gl.uniform1f(location, value)
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  return canvas
}

/**
 * The panel-facing component. `settings` is the device's live settings object
 * (already merged with automation by the panel's caller), so turning a knob
 * moves the picture on the next frame with no React work per frame.
 */
export function SceneFxPreview({ plugin, settings, testId }: {
  plugin: VisualEffect
  settings: Record<string, number>
  testId?: string
}) {
  const [failed, setFailed] = useState(false)
  // Read through refs so the loop never restarts on a param change - a
  // remounting loop would re-read the clock and stutter the animated devices.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const pluginRef = useRef(plugin)
  pluginRef.current = plugin
  const failedRef = useRef(false)

  // The canvas's device-pixel size, fed by a ResizeObserver instead of being
  // re-read per frame (clientWidth/Height are layout reads, and two of them
  // per frame per stacked device add up). Cleared when the canvas remounts;
  // the draw falls back to one direct read while the cache is empty.
  const sizeRef = useRef<{ width: number; height: number } | null>(null)
  const measure = (canvas: HTMLCanvasElement) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    sizeRef.current = {
      width: Math.max(1, Math.round(canvas.clientWidth * dpr)),
      height: Math.max(1, Math.round(canvas.clientHeight * dpr)),
    }
    return sizeRef.current
  }

  const canvasRef = usePreviewLoop<HTMLCanvasElement>((tSec) => {
    if (failedRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) { failedRef.current = true; setFailed(true); return }
    const { width, height } = sizeRef.current ?? measure(canvas)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const beat = tSec * BEATS_PER_SECOND
    const source = renderDevice(pluginRef.current, settingsRef.current, beat, width, height)
    if (!source) { failedRef.current = true; setFailed(true); return }
    // Same task as the draw above - see the header note.
    // (No loseContext() anywhere here, unlike the per-panel previews: the GL
    // context is the family's, not this panel's, and it outlives every mount.)
    context.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height)
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => measure(canvas))
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      sizeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed])

  return (
    <PreviewWindow height={PREVIEW_HEIGHT} testId={testId} title={`${plugin.name} — live preview`}>
      {failed ? (
        <div className="flex h-full items-center justify-center text-[10px] text-white/30">
          preview unavailable
        </div>
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" aria-label={`${plugin.name} preview`} />
      )}
    </PreviewWindow>
  )
}
