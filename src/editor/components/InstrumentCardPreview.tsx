'use client'

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useInstrumentClipUrl } from '../../components/instrumentClipUrl'
import posters from '../../components/instrumentPreviewPosters.json'
import { get2DPreview, Preview2D } from './InstrumentPreview2D'
import { acquireClipLoad } from './clipLoadQueue'
import type { InstrumentItem } from './LeftSidebar'

const posterIndex: Record<string, { src: string; version: string; time?: number; placeholder?: string }> = posters
// Folder navigation unmounts cards. Keep their last pixels AND playback time
// so coming back resumes the same motion instead of flashing the opening shot.
const frames = new Map<string, { src: string; time: number }>()

function Clip({ src, poster, startTime, visible }: { src: string; poster?: string; startTime: number; visible: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [saved] = useState(() => frames.get(src))
  const [allowed, setAllowed] = useState(false)
  const [painted, setPainted] = useState(false)
  const [failed, setFailed] = useState(false)
  const releaseRef = useRef<() => void>(() => {})

  useEffect(() => acquireClipLoad(done => {
    releaseRef.current = done
    setAllowed(true)
  }), [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (visible) void video.play().catch(() => {})
    else video.pause()
  }, [visible, allowed])

  // Release the poster only when the browser has actually submitted a frame,
  // including a restored seek. loadeddata alone can precede that paint.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0
    let raf = 0
    const reveal = () => { releaseRef.current(); setPainted(true) }
    const ready = () => {
      releaseRef.current()
      if (!('requestVideoFrameCallback' in video)) {
        raf = requestAnimationFrame(() => { raf = requestAnimationFrame(reveal) })
      }
    }
    if ('requestVideoFrameCallback' in video) frame = video.requestVideoFrameCallback(reveal)
    video.addEventListener('loadeddata', ready)
    if (video.readyState >= 2) ready()
    return () => {
      video.removeEventListener('loadeddata', ready)
      if (frame) video.cancelVideoFrameCallback(frame)
      cancelAnimationFrame(raf)
    }
  }, [allowed])

  useLayoutEffect(() => {
    const video = videoRef.current
    if (!video) return
    return () => {
      video.pause()
      if (video.readyState < 2 || !video.videoWidth) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 320; canvas.height = 180
        canvas.getContext('2d')!.drawImage(video, 0, 0, 320, 180)
        frames.delete(src)
        frames.set(src, { src: canvas.toDataURL('image/webp', 0.8), time: video.currentTime })
        if (frames.size > 96) frames.delete(frames.keys().next().value!)
      } catch { /* A CORS-restricted clip still has its bundled poster. */ }
    }
  }, [src, allowed])

  return <>
    {(saved?.src ?? poster) && (
      // Native image: these tiny, pre-sized, hashed WebPs need no image service.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={saved?.src ?? poster} alt="" draggable={false} width={320} height={180}
        className="absolute inset-0 h-full w-full object-cover" />
    )}
    {allowed && !failed && <video
      ref={videoRef}
      src={src}
      crossOrigin="anonymous"
      loop muted playsInline preload="auto"
      onLoadedMetadata={event => {
        const video = event.currentTarget
        const resumeAt = saved?.time ?? startTime
        if (resumeAt > 0 && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = resumeAt % video.duration
      }}
      onError={() => { releaseRef.current(); setFailed(true) }}
      className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150 motion-reduce:transition-none"
      style={{ opacity: painted ? 1 : 0 }}
    />}
  </>
}

/** Stills paint with the shell, ahead of manifests, decoder slots and WebGL.
 * Nearby cards preload; only visible cards animate. */
export const InstrumentCardPreview = memo(function InstrumentCardPreview({ item }: { item: InstrumentItem }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [visible, setVisible] = useState(false)
  const [activeTab, setActiveTab] = useState(true)
  const draw = get2DPreview(item.id)
  const clip = useInstrumentClipUrl(item.id)
  const poster = posterIndex[item.id]?.src
  const restingFrame = (clip && frames.get(clip)?.src) || poster

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const updateTab = () => setActiveTab(!document.hidden)
    updateTab()
    document.addEventListener('visibilitychange', updateTab)
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true); setVisible(true)
      return () => document.removeEventListener('visibilitychange', updateTab)
    }
    const root = host.closest<HTMLElement>('[data-library-scroll]')
    const preload = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNear(true); preload.disconnect() }
    }, { root, rootMargin: '400px 0px' })
    const playback = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root })
    preload.observe(host); playback.observe(host)
    return () => {
      preload.disconnect(); playback.disconnect()
      document.removeEventListener('visibilitychange', updateTab)
    }
  }, [])

  return <div ref={hostRef} className="absolute inset-0 bg-cover bg-center" data-instrument-preview={item.id}
    style={{ backgroundImage: !draw && posterIndex[item.id]?.placeholder ? `url(${posterIndex[item.id].placeholder})` : undefined }}>
    {!draw && <>
      {!poster && <span className="absolute inset-0 flex items-center justify-center [&_svg]:h-8 [&_svg]:w-8">{item.icon}</span>}
      {restingFrame && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={restingFrame} alt="" draggable={false} width={320} height={180}
          className="absolute inset-0 h-full w-full object-cover" />
      )}
      {near && clip && <Clip key={clip} src={clip} poster={poster} startTime={posterIndex[item.id]?.time ?? 0} visible={visible && activeTab} />}
    </>}
    {draw && <Preview2D draw={draw} active={visible && activeTab} />}
  </div>
})
