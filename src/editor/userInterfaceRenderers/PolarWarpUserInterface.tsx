'use client'

import { useMemo, useRef } from 'react'
import { polarWarpMover, type PolarWarpSettings } from '../core/visualCopies/polarWarp'
import { identityVisualCopy } from '../core/visualCopies/identityVisualCopy'
import { POLAR_WARP_COLOR } from '../core/visualCopies/identityColors'
import { bindPanel, Console, ControlRow, Knob, ParameterList, PreviewWindow, usePreviewLoop } from './console'
import type { UserInterfaceRendererDefinition } from './types'

// Like Radial's formation window, this draws the actual copy transforms. The
// held demo note makes both arrival and recovery visible while transport rests.
function FlowerPreview({ settings }: { settings: PolarWarpSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const demo = useMemo(() => {
    const hold = Math.max(1.5, settings.attack + 0.5)
    return {
      hold,
      entry: polarWarpMover.resolve({ settings, notes: [{
        beat: 0.5, pitch: 40, velocity: 1, durationBeats: hold,
        blockStartBeat: 0, blockEndBeat: 128,
      }] }),
    }
  }, [settings])
  const live = useRef({ demo, settings })
  live.current = { demo, settings }
  const copies = useMemo(() => Array.from({ length: 96 }, (_, i) => {
    const copy = identityVisualCopy()
    const angle = i / 96 * Math.PI * 2
    copy.transform.makeTranslation(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5, 0)
    return copy
  }), [])
  const hostRef = usePreviewLoop<HTMLDivElement>((seconds) => {
    const canvas = canvasRef.current
    const host = hostRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !host || !ctx) return
    const w = host.clientWidth, h = host.clientHeight
    if (!w || !h) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
      canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const { demo, settings } = live.current
    const beat = seconds * 2 % (demo.hold + settings.release + 1.25)
    const scale = Math.min(w, h) / 6.2
    ctx.fillStyle = POLAR_WARP_COLOR
    for (let i = 0; i < copies.length; i++) {
      const output = demo.entry.apply(copies[i], { beat, index: i, count: copies.length })[0]
      const e = output.transform.elements
      ctx.save()
      ctx.translate(w/2, h/2)
      ctx.transform(e[0]*scale, -e[1]*scale, e[4]*scale, -e[5]*scale, e[12]*scale, -e[13]*scale)
      ctx.fillRect(-0.075, -0.075, 0.15, 0.15)
      ctx.restore()
    }
  })
  return <PreviewWindow height={145} title="Five-petal demo at 120 BPM" testId="polar-warp-preview">
    <div ref={hostRef} className="absolute inset-0"><canvas ref={canvasRef} className="h-full w-full" /></div>
  </PreviewWindow>
}

export const PolarWarpUserInterfaceRenderer: UserInterfaceRendererDefinition = ({ parameters }) => {
  const pool = bindPanel(parameters)
  const attack = pool.num('attack'), release = pool.num('release')
  if (!attack || !release) return <ParameterList parameters={parameters} />
  return <Console accent={POLAR_WARP_COLOR} testId="polar-warp-user-interface">
    <FlowerPreview settings={{ attack: attack.value, release: release.value }} />
    <ControlRow spill className="justify-center gap-8 px-4 py-3">
      <Knob b={attack} label="ATTACK" format={(v) => `${v.toFixed(2)} beats`} />
      <Knob b={release} label="RELEASE" format={(v) => `${v.toFixed(2)} beats`} />
    </ControlRow>
  </Console>
}
