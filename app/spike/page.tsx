'use client'

// ─── ENGINE SPIKE round 3 (throwaway) ────────────────────────────────────────
// /spike — the PAD model, per Julia's spec: a clip is a moment picked from the
// middle of a source video; a hit plays it FROM ITS OWN START, instantly,
// re-triggerable, back-to-back. Pads 1-8 on the keyboard. Optional auto-cycle
// fires pads on the beat grid (the auto-cut mode, same engine).
//
// Setup: load videos → scrub the preview → "Arm pad here" (decodes that
// moment's head cache). Perform: Start, then mash keys 1-8. MASH THEM.
// Re-trigger the same pad rapidly. That's the test.
//
// Verdict numbers:
//   TRIGGER ms — hit to first drawn frame. Head cache should make this one
//                display tick (~0-7ms), EVERY hit, including re-triggers.
//   FREEZES    — stalls >80ms and how many seconds into the clip they hit
//                (early = cache/live handoff problem, late = decode throughput).
//   FPS        — must hold your display rate with instruments moving.

import { useEffect, useRef, useState } from 'react'
import {
  OrthographicCamera,
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  BoxGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three'
import { VideoSampleSink } from 'mediabunny'
import { openClip, createPad, PadPlayer, type Pad, type SpikeClip } from '../../src/spike/beatCutEngine'

const STAGE_W = 540
const STAGE_H = 960 // 9:16

interface Hud {
  fps: number
  beat: number
  pad: number
  trigLast: number | null
  trigAvg: number | null
  trigMax: number | null
  freezeCount: number
  freezeWorst: number | null
  freezeLastAt: string | null
  starved: number
  decoded: number
  buffered: number
  headHits: number
  liveHits: number
}

interface Session {
  audio: AudioContext
  player: PadPlayer
  secPerBeat: number
  t0: number
  paused: boolean
  pausedBeat: number
  songBuffer: AudioBuffer | null
  songSource: AudioBufferSourceNode | null
  nextClickBeat: number
  lastAutoSlot: number
  stop: () => void
}

interface Stage {
  renderer: WebGLRenderer
  texture: CanvasTexture
  fctx: CanvasRenderingContext2D
  render: (beat: number) => void
  dispose: () => void
}

export default function SpikePage() {
  const stageCanvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<Stage | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const padsRef = useRef<Pad[]>([])
  const previewSinksRef = useRef<Map<SpikeClip, VideoSampleSink>>(new Map())
  const previewChainRef = useRef<{ pending: number | null; busy: boolean }>({ pending: null, busy: false })
  // One AudioContext for the whole page (created on first user gesture) so the
  // song decodes at PICK time, not at Start - Start must feel instant.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const songBufferRef = useRef<AudioBuffer | null>(null)
  const tapsRef = useRef<number[]>([])
  const autoCycleRef = useRef(false)
  const beatsPerCutRef = useRef(2)

  const [clips, setClips] = useState<SpikeClip[]>([])
  const [pads, setPads] = useState<Pad[]>([])
  const [arming, setArming] = useState(false)
  const [sourceIdx, setSourceIdx] = useState(0)
  const [previewT, setPreviewT] = useState(0)
  const [songName, setSongName] = useState<string | null>(null)
  const [songDecoding, setSongDecoding] = useState(false)
  const [starting, setStarting] = useState(false)
  const [bpm, setBpm] = useState(120)
  const [beatsPerCut, setBeatsPerCut] = useState(2)
  const [autoCycle, setAutoCycle] = useState(false)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hud, setHud] = useState<Hud | null>(null)

  autoCycleRef.current = autoCycle
  beatsPerCutRef.current = beatsPerCut
  padsRef.current = pads

  // ── Stage: built once, survives sessions; one permanent rAF renders always.
  useEffect(() => {
    const canvas = stageCanvasRef.current!
    const frameCanvas = document.createElement('canvas')
    frameCanvas.width = STAGE_W
    frameCanvas.height = STAGE_H
    const fctx = frameCanvas.getContext('2d')!
    fctx.fillStyle = '#000'
    fctx.fillRect(0, 0, STAGE_W, STAGE_H)

    const renderer = new WebGLRenderer({ canvas, antialias: true })
    renderer.setSize(STAGE_W, STAGE_H, false)
    const scene = new Scene()
    const camera = new OrthographicCamera(-0.5, 0.5, STAGE_H / STAGE_W / 2, -STAGE_H / STAGE_W / 2, 0.1, 10)
    camera.position.z = 2

    const texture = new CanvasTexture(frameCanvas)
    texture.colorSpace = SRGBColorSpace
    texture.minFilter = LinearFilter
    texture.generateMipmaps = false
    const backdrop = new Mesh(
      new PlaneGeometry(1, STAGE_H / STAGE_W),
      new MeshBasicMaterial({ map: texture, toneMapped: false, depthWrite: false }),
    )
    scene.add(backdrop)
    const box = new Mesh(new BoxGeometry(0.12, 0.12, 0.12), new MeshNormalMaterial())
    box.position.set(0, -0.45, 0.5)
    scene.add(box)
    const orbiter = new Mesh(new OctahedronGeometry(0.05), new MeshNormalMaterial())
    orbiter.position.z = 0.5
    scene.add(orbiter)

    const render = (beat: number) => {
      const frac = beat % 1
      box.scale.setScalar(1 + 0.8 * Math.pow(Math.max(0, 1 - frac), 3))
      box.rotation.set(beat * 0.7, beat * 1.1, 0)
      orbiter.position.set(Math.cos(beat * Math.PI) * 0.3, 0.35 + Math.sin(beat * Math.PI * 2) * 0.1, 0.5)
      orbiter.rotation.y = beat * 2
      renderer.render(scene, camera)
    }

    const stage: Stage = {
      renderer,
      texture,
      fctx,
      render,
      dispose: () => {
        texture.dispose()
        renderer.dispose()
      },
    }
    stageRef.current = stage

    let raf = 0
    let fps = 60
    let lastTick = performance.now()
    const fpsRef = { get: () => fps }
    ;(stage as Stage & { fps?: () => number }).fps = fpsRef.get

    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      fps = fps * 0.95 + (1000 / Math.max(1, now - lastTick)) * 0.05
      lastTick = now
      const s = sessionRef.current
      let beat = 0
      if (s) {
        scheduleClicks(s)
        beat = beatNow(s)
        // Auto-cycle: fire the next pad exactly on its grid boundary.
        if (autoCycleRef.current && !s.paused && padsRef.current.length > 0) {
          const slot = Math.floor(beat / beatsPerCutRef.current)
          if (slot !== s.lastAutoSlot) {
            s.lastAutoSlot = slot
            s.player.trigger(slot % padsRef.current.length, slot * beatsPerCutRef.current)
          }
        }
        const drew = s.player.frameInto(beat, stage.fctx, STAGE_W, STAGE_H)
        if (drew) stage.texture.needsUpdate = true
      }
      stage.render(beat)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      stage.dispose()
      stageRef.current = null
    }
  }, [])

  // ── Clock helpers (shared by tick + controls).
  const beatNow = (s: Session): number =>
    s.paused ? s.pausedBeat : Math.max(0, (s.audio.currentTime - s.t0) / s.secPerBeat)

  const scheduleClicks = (s: Session) => {
    if (s.songBuffer || s.paused) return
    while (s.t0 + s.nextClickBeat * s.secPerBeat < s.audio.currentTime + 0.15) {
      const at = s.t0 + s.nextClickBeat * s.secPerBeat
      if (at > s.audio.currentTime) {
        const osc = s.audio.createOscillator()
        const gain = s.audio.createGain()
        osc.frequency.value = s.nextClickBeat % 4 === 0 ? 1400 : 900
        gain.gain.setValueAtTime(0.12, at)
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05)
        osc.connect(gain).connect(s.audio.destination)
        osc.start(at)
        osc.stop(at + 0.06)
      }
      s.nextClickBeat++
    }
  }

  const restartSong = (s: Session, beat: number) => {
    s.songSource?.stop()
    s.songSource = null
    if (!s.songBuffer) return
    const src = s.audio.createBufferSource()
    src.buffer = s.songBuffer
    src.connect(s.audio.destination)
    const when = s.audio.currentTime + 0.05
    src.start(when, Math.min(Math.max(0, beat * s.secPerBeat), s.songBuffer.duration - 0.05))
    s.songSource = src
    s.t0 = when - beat * s.secPerBeat
  }

  // ── Setup: sources, preview scrub, arming pads.
  const onVideos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 4)
    e.target.value = ''
    if (files.length === 0) return
    setError(null)
    try {
      const opened = await Promise.all(files.map(openClip))
      setClips(opened)
      setSourceIdx(0)
      setPreviewT(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open video')
    }
  }

  const onSong = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    e.target.value = ''
    songBufferRef.current = null
    setSongName(file?.name ?? null)
    if (!file) return
    setSongDecoding(true)
    setError(null)
    try {
      audioCtxRef.current ??= new AudioContext()
      songBufferRef.current = await audioCtxRef.current.decodeAudioData(await file.arrayBuffer())
    } catch {
      setError('Could not decode that song file - the metronome will click instead')
      setSongName(null)
    } finally {
      setSongDecoding(false)
    }
  }

  /** Paint the frame at `t` of the selected source onto the stage (setup aid).
   *  Coalesced: newest request wins, one decode in flight. */
  const previewSeek = (t: number) => {
    setPreviewT(t)
    const clip = clips[sourceIdx]
    const stage = stageRef.current
    if (!clip || !stage || sessionRef.current) return
    const chain = previewChainRef.current
    chain.pending = t
    if (chain.busy) return
    chain.busy = true
    void (async () => {
      try {
        let sink = previewSinksRef.current.get(clip)
        if (!sink) {
          sink = new VideoSampleSink(clip.track)
          previewSinksRef.current.set(clip, sink)
        }
        while (chain.pending !== null) {
          const want = chain.pending
          chain.pending = null
          const sample = await sink.getSample(want)
          if (sample) {
            const sw = sample.displayWidth
            const sh = sample.displayHeight
            const scale = Math.max(STAGE_W / sw, STAGE_H / sh)
            sample.draw(stage.fctx, (STAGE_W - sw * scale) / 2, (STAGE_H - sh * scale) / 2, sw * scale, sh * scale)
            sample.close()
            stage.texture.needsUpdate = true
          }
        }
      } catch (err) {
        console.error('spike: preview seek failed', err)
      } finally {
        chain.busy = false
      }
    })()
  }

  const armPad = async () => {
    const clip = clips[sourceIdx]
    if (!clip || arming || pads.length >= 8) return
    setArming(true)
    setError(null)
    try {
      const pad = await createPad(clip, previewT, STAGE_W, STAGE_H)
      setPads((p) => [...p, pad])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not arm pad')
    } finally {
      setArming(false)
    }
  }

  const removePad = (i: number) => {
    setPads((p) => {
      p[i]?.dispose()
      return p.filter((_, k) => k !== i)
    })
  }

  const tap = () => {
    const now = performance.now()
    const taps = tapsRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0
    taps.push(now)
    if (taps.length > 6) taps.shift()
    if (taps.length >= 3) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i])
      setBpm(Math.round((60000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length)) * 10) / 10)
    }
  }

  // ── Perform: session lifecycle + triggering.
  const hitPad = (i: number) => {
    const s = sessionRef.current
    if (!s || s.paused || !padsRef.current[i]) return
    s.player.trigger(i, beatNow(s))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const i = Number(e.key) - 1
      if (i >= 0 && i < 8 && sessionRef.current) hitPad(i)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // hitPad reads only refs; re-subscribing per render would drop keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async () => {
    if (pads.length === 0 || running || starting) return
    setError(null)
    setStarting(true)
    audioCtxRef.current ??= new AudioContext()
    const audio = audioCtxRef.current
    if (audio.state === 'suspended') await audio.resume()
    const songBuffer = songBufferRef.current // decoded at pick time
    const secPerBeat = 60 / bpm
    const player = new PadPlayer(pads, secPerBeat)
    const session: Session = {
      audio,
      player,
      secPerBeat,
      t0: audio.currentTime + 0.1,
      paused: false,
      pausedBeat: 0,
      songBuffer,
      songSource: null,
      nextClickBeat: 0,
      lastAutoSlot: -1,
      stop: () => {},
    }
    if (songBuffer) restartSong(session, 0)

    const hudTimer = setInterval(() => {
      const st = player.stats
      const lat = st.triggerLatencies
      const fz = st.freezes
      const lastFz = fz.length ? fz[fz.length - 1] : null
      const stage = stageRef.current as (Stage & { fps?: () => number }) | null
      setHud({
        fps: Math.round(stage?.fps?.() ?? 0),
        beat: Math.floor(beatNow(session)),
        pad: st.activePad,
        trigLast: lat.length ? lat[lat.length - 1] : null,
        trigAvg: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
        trigMax: lat.length ? Math.max(...lat) : null,
        freezeCount: fz.length,
        freezeWorst: fz.length ? Math.max(...fz.map((f) => f.durationMs)) : null,
        freezeLastAt: lastFz ? `${lastFz.secondsIn.toFixed(2)}s in` : null,
        starved: st.starvedTicks,
        decoded: st.decoded,
        buffered: st.buffered,
        headHits: st.headHits,
        liveHits: st.liveHits,
      })
    }, 250)

    session.stop = () => {
      clearInterval(hudTimer)
      session.songSource?.stop()
      player.dispose()
      // The AudioContext is page-shared (song stays decoded) - not closed here.
      sessionRef.current = null
    }
    sessionRef.current = session
    setPaused(false)
    setStarting(false)
    setRunning(true)
    // First pad fires immediately so there's something on screen.
    player.trigger(0, 0)
  }

  const pause = () => {
    const s = sessionRef.current
    if (!s || s.paused) return
    s.pausedBeat = beatNow(s)
    s.paused = true
    s.songSource?.stop()
    s.songSource = null
    setPaused(true)
  }

  const resume = () => {
    const s = sessionRef.current
    if (!s || !s.paused) return
    s.t0 = s.audio.currentTime - s.pausedBeat * s.secPerBeat
    if (s.songBuffer) restartSong(s, s.pausedBeat)
    s.nextClickBeat = Math.ceil(s.pausedBeat)
    s.paused = false
    setPaused(false)
  }

  const nudgeGrid = (msShift: number) => {
    const s = sessionRef.current
    if (s) s.t0 += msShift / 1000
  }

  const stopSession = () => {
    sessionRef.current?.stop()
    setRunning(false)
    setPaused(false)
    setHud(null)
  }

  useEffect(
    () => () => {
      sessionRef.current?.stop()
      for (const p of padsRef.current) p.dispose()
      void audioCtxRef.current?.close()
      audioCtxRef.current = null
    },
    [],
  )

  const mono: React.CSSProperties = { fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }
  const ms = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}ms`)
  const selectedClip = clips[sourceIdx]

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, minHeight: '100vh', background: '#0e0e11', color: '#e8e8ec', fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div style={{ width: 380, flexShrink: 0 }}>
        <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>ENGINE SPIKE · round 3 · PADS</h1>
        <p style={{ ...mono, color: '#7c7c88', marginTop: 0 }}>clips = moments from the middle of a source · a hit plays from the clip&apos;s own start · re-trigger at will</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <label style={mono}>
            1 · videos (1-4)<br />
            <input type="file" accept="video/*" multiple onChange={(e) => void onVideos(e)} disabled={running} />
          </label>

          {clips.length > 0 && !running && (
            <div style={{ ...mono, border: '1px solid #2a2a32', borderRadius: 6, padding: 10 }}>
              2 · pick a moment (paints on the stage) →{' '}
              <select value={sourceIdx} onChange={(e) => { setSourceIdx(Number(e.target.value)); setPreviewT(0) }}>
                {clips.map((c, i) => (
                  <option key={c.name} value={i}>{c.name}</option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={Math.max(0.1, (selectedClip?.duration ?? 1) - 1)}
                step={0.05}
                value={previewT}
                onChange={(e) => previewSeek(Number(e.target.value))}
                style={{ width: '100%', marginTop: 6 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{previewT.toFixed(2)}s / {(selectedClip?.duration ?? 0).toFixed(1)}s</span>
                <button onClick={() => void armPad()} disabled={arming || pads.length >= 8} style={{ fontWeight: 700 }}>
                  {arming ? 'arming…' : `Arm pad ${pads.length + 1} here`}
                </button>
              </div>
            </div>
          )}

          {pads.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pads.map((p, i) => (
                <button
                  key={i}
                  onPointerDown={() => hitPad(i)}
                  style={{
                    ...mono,
                    padding: '10px 8px',
                    minWidth: 82,
                    textAlign: 'left',
                    background: hud?.pad === i ? '#2c2413' : '#17171c',
                    border: `1px solid ${hud?.pad === i ? '#f5a623' : '#2a2a32'}`,
                    borderRadius: 6,
                    color: '#e8e8ec',
                    cursor: 'pointer',
                  }}
                >
                  <b>[{i + 1}]</b> {p.clip.name.slice(0, 8)}<br />@ {p.inPoint.toFixed(1)}s
                  {!running && (
                    <span onClick={(e) => { e.stopPropagation(); removePad(i) }} style={{ color: '#d16969', marginLeft: 6, cursor: 'pointer' }}>×</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <label style={mono}>
            3 · song (optional; metronome otherwise){' '}
            <input type="file" accept="audio/*" onChange={(e) => void onSong(e)} disabled={running || songDecoding} />
            {songDecoding && <span style={{ color: '#f5a623' }}> decoding song…</span>}
            {songName && !songDecoding && <span style={{ color: '#b8b8c2' }}>· {songName} ✓</span>}
          </label>
          <label style={mono}>
            BPM{' '}
            <input type="number" value={bpm} min={40} max={220} step={0.1} onChange={(e) => setBpm(Number(e.target.value) || 120)} disabled={running} style={{ width: 70 }} />{' '}
            <button onClick={tap} disabled={running}>tap</button>
            {'  '}
            <label>
              <input type="checkbox" checked={autoCycle} onChange={(e) => setAutoCycle(e.target.checked)} /> auto-cycle every{' '}
              <select value={beatsPerCut} onChange={(e) => setBeatsPerCut(Number(e.target.value))}>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={4}>4</option>
              </select>{' '}beats
            </label>
          </label>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!running ? (
              <button
                onClick={() => void start()}
                disabled={pads.length === 0 || starting || songDecoding}
                style={{ padding: '6px 16px', fontWeight: 700 }}
              >
                {starting ? 'starting…' : songDecoding ? 'song decoding…' : 'Start'}
              </button>
            ) : (
              <>
                <button onClick={paused ? resume : pause} style={{ padding: '6px 16px' }}>{paused ? 'Play' : 'Pause'}</button>
                <button onClick={stopSession} style={{ padding: '6px 16px' }}>Stop</button>
                <span style={{ ...mono, color: '#7c7c88' }}>grid</span>
                <button onClick={() => nudgeGrid(-10)} style={mono}>-10ms</button>
                <button onClick={() => nudgeGrid(10)} style={mono}>+10ms</button>
              </>
            )}
          </div>
          {running && <p style={{ ...mono, color: '#7c7c88', margin: 0 }}>keys 1-{pads.length} trigger pads — mash them, re-trigger the same pad rapidly</p>}
          {error && <p style={{ ...mono, color: '#d16969' }}>{error}</p>}
        </div>

        {hud && (
          <div style={{ ...mono, marginTop: 20, lineHeight: 1.9, borderTop: '1px solid #2a2a32', paddingTop: 12 }}>
            <div>FPS <b style={{ color: hud.fps >= 55 ? '#6a9955' : '#d16969' }}>{hud.fps}</b> · beat {hud.beat} · pad {hud.pad + 1}{paused ? ' · PAUSED' : ''}</div>
            <div>
              TRIGGER last <b style={{ color: (hud.trigLast ?? 0) < 20 ? '#6a9955' : '#d16969' }}>{ms(hud.trigLast)}</b>
              {' '}avg <b>{ms(hud.trigAvg)}</b> max <b style={{ color: (hud.trigMax ?? 0) < 40 ? '#e8e8ec' : '#d16969' }}>{ms(hud.trigMax)}</b>
            </div>
            <div>
              FREEZES <b style={{ color: hud.freezeCount === 0 ? '#6a9955' : '#d16969' }}>{hud.freezeCount}</b>
              {hud.freezeCount > 0 && <> worst <b>{ms(hud.freezeWorst)}</b> last <b>{hud.freezeLastAt}</b></>}
            </div>
            <div>STARVED <b style={{ color: hud.starved < 30 ? '#6a9955' : '#d16969' }}>{hud.starved}</b> · decoded {hud.decoded} · buffer {hud.buffered}</div>
            <div>frames from cache {hud.headHits} · from live decode {hud.liveHits}</div>
          </div>
        )}

        <div style={{ ...mono, color: '#7c7c88', marginTop: 20, lineHeight: 1.7 }}>
          verdict guide:<br />
          TRIGGER avg ≤ ~10ms on EVERY hit incl. rapid re-triggers → pad model wins<br />
          FREEZES at ~0.3-0.5s in → cache/live handoff needs work<br />
          FREEZES later than that → decode throughput (worker next)<br />
          auto-cycle ON reproduces the beat-cut mode on the same engine
        </div>
      </div>

      <canvas
        ref={stageCanvasRef}
        width={STAGE_W}
        height={STAGE_H}
        style={{ height: 'min(90vh, 960px)', aspectRatio: '9/16', background: '#000', borderRadius: 8, border: '1px solid #2a2a32' }}
      />
    </div>
  )
}
