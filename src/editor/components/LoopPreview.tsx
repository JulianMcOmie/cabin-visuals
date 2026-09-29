'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { createVisualEngine } from '../core/visual/VisualEngine'
import { VisualEngineContext } from '../core/visual/VisualEngineContext'
import { ObjectRenderer } from './visual/ObjectRenderer'
import type { VisualLoop } from './loops'

function LoopScene({ loop, active }: { loop: VisualLoop; active: boolean }) {
  const stage = useMemo(() => {
    const tree = loop.createTracks()
    const tracks = Object.fromEntries(tree.map(track => [track.id, track]))
    const engine = createVisualEngine()
    engine.setProject({ tracks, rootTrackIds: [tree[0].id], bpm: 120, beatsPerBar: 4, totalBars: loop.bars })
    engine.computeAtBeat(2)
    return { engine, tracks, renderFrame: { current: true } }
  }, [loop])
  const invalidate = useThree(state => state.invalidate)
  const beat = useRef(2)
  useEffect(() => {
    invalidate()
    if (!active) return
    const timer = setInterval(invalidate, 1000 / 30)
    return () => clearInterval(timer)
  }, [active, invalidate])
  useFrame((_, delta) => {
    if (active) beat.current = (beat.current + Math.min(delta, 0.1) * 2) % (loop.bars * 4)
    stage.engine.computeAtBeat(beat.current)
  }, -10)
  return <VisualEngineContext.Provider value={stage}>
    <color attach="background" args={['#080e18']} />
    <Suspense fallback={null}>
      {stage.engine.getObjectList().map(object => <ObjectRenderer
        key={`${object.trackId}:${object.visualCopyIndex}`}
        sceneId="loop-preview" trackId={object.trackId} instrumentId={object.instrumentId}
        visualCopyIndex={object.visualCopyIndex}
      />)}
    </Suspense>
    <EffectComposer multisampling={4}>
      <Bloom intensity={0.9} luminanceThreshold={1.15} luminanceSmoothing={0.08} mipmapBlur radius={0.72} />
    </EffectComposer>
  </VisualEngineContext.Provider>
}

/** A private clock and evaluator keep library playback out of the project and
 * transport. Offscreen, hidden-tab and reduced-motion previews hold a still. */
export function LoopPreview({ loop }: { loop: VisualLoop }) {
  const host = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    const element = host.current
    if (!element) return
    let visible = true
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setActive(visible && !document.hidden && !reducedMotion.matches)
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update() })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    reducedMotion.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
      reducedMotion.removeEventListener('change', update)
    }
  }, [])
  return <div ref={host} data-loop-preview={loop.id} role="img" aria-label={loop.description}
    className="pointer-events-none relative aspect-video overflow-hidden bg-[#080e18]">
    <Canvas frameloop="demand" dpr={2} camera={{ position: [0, 0, 5], fov: 55, near: 0.1, far: 100 }}>
      <LoopScene loop={loop} active={active} />
    </Canvas>
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,#080e1840)]" />
    <span className="absolute bottom-2 right-2 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[9px] text-sky-100/80">{loop.bars} BARS</span>
  </div>
}
