'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Upload } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { useTimeStore } from '../store/TimeStore'
import { runExport } from '../core/export/exportEngine'
import { downloadBlob } from '../core/export/mux'
import { getFrameDriver } from '../core/export/frameDriver'
import { isExportSupported } from '../core/export/support'
import { useScrub } from '../hooks/useScrub'
import { resolveTrackIdentityColor } from '../utils/trackDisplayColor'
import { clampToFreeTier, defaultBitrate, defaultSettings, resolveExportRange, resolutionsFor, type ExportAspect, type ExportRateControl, type ExportSettings } from '../core/export/types'

const SETTINGS_KEY = 'cabin.exportSettings'

type Phase =
  | { kind: 'settings' }
  | { kind: 'running'; frame: number; total: number; startedAt: number }
  | { kind: 'done'; fileName: string; blob: Blob }
  | { kind: 'error'; message: string }

/** The project's name as a safe default filename (no path/reserved characters). */
function defaultFileName(): string {
  const name = useUIStore.getState().projectName?.trim()
  if (!name) return 'export'
  const safe = name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim()
  return safe || 'export'
}

// A remembered range must still fit the OPEN project. The spec's rail offers
// two ranges (Loop region / Full track); a saved 'custom' from the old dialog
// degrades to whole rather than surfacing a mode the UI no longer sells.
function sanitizeRange(s: ExportSettings): ExportSettings {
  const { totalBars } = useProjectStore.getState()
  const hasLoop = useTimeStore.getState().loopRegion != null
  const modeValid = s.rangeMode === 'whole' || (s.rangeMode === 'loop' && hasLoop)
  return {
    ...s,
    rangeMode: modeValid ? s.rangeMode : 'whole',
    rangeFromBar: 1,
    rangeToBar: Math.max(1, totalBars),
  }
}

function loadSavedSettings(isPro: boolean): ExportSettings {
  const base = defaultSettings(defaultFileName())
  base.rangeToBar = Math.max(1, useProjectStore.getState().totalBars)
  let merged = base
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as Partial<ExportSettings>
      merged = sanitizeRange({ ...base, ...saved, fileName: base.fileName })
    }
  } catch { /* corrupt storage - fall through to defaults */ }

  if (merged.aspect !== '16:9' && merged.aspect !== '9:16') merged.aspect = '16:9'
  const viewAspect = useProjectStore.getState().viewAspect
  if (viewAspect === '16:9' || viewAspect === '9:16') merged.aspect = viewAspect

  const tiers = resolutionsFor(merged.aspect)
  if (!tiers.some((r) => r.width === merged.width && r.height === merged.height)) {
    const longEdge = Math.max(merged.width, merged.height)
    const tier = tiers.find((r) => Math.max(r.width, r.height) === longEdge)
      ?? tiers.find((r) => r.label === '1080p') ?? tiers[0]
    merged.width = tier.width
    merged.height = tier.height
  }
  merged.videoBitrate = defaultBitrate(Math.max(merged.width, merged.height), merged.fps)
  if (merged.rateControl !== 'quality') merged.rateControl = 'bitrate'
  merged.watermark = false
  return isPro ? merged : clampToFreeTier(merged)
}

// ── The monitor ──────────────────────────────────────────────────────────────

/**
 * A 2d mirror of the live WebGL canvas, repainted on rAF while `live`. During
 * an export the same canvas renders the encode frames, so the mirror becomes a
 * true render monitor with no extra plumbing; when painting stops (complete),
 * the last frame simply stays put.
 */
function MonitorCanvas({ live, className = '' }: { live: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!live) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    const paint = () => {
      const source = getFrameDriver()?.getCanvas()
      if (source && source.width > 0 && source.height > 0) {
        const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
        const w = source.width * scale
        const h = source.height * scale
        ctx.fillStyle = '#08090d'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        try {
          ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
        } catch { /* source mid-resize - next frame wins */ }
      }
      raf = requestAnimationFrame(paint)
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [live])
  return <canvas ref={ref} width={1280} height={720} className={`block w-full ${className}`} style={{ aspectRatio: '16 / 9' }} />
}

// ── The clip map ─────────────────────────────────────────────────────────────

interface MapLane { color: string; clips: { left: number; width: number }[] }

/** The timeline in miniature: root lanes with their blocks in track hues. */
function useClipMap(totalBeats: number): MapLane[] {
  return useMemo(() => {
    const { tracks, rootTrackIds, bpm, beatsPerBar, totalBars } = useProjectStore.getState()
    const total = Math.max(1, totalBars)
    const lanes: MapLane[] = []
    for (const id of rootTrackIds) {
      const track = tracks[id]
      if (!track) continue
      const clips: { left: number; width: number }[] = []
      if (track.type === 'audio') {
        for (const b of track.audioBlocks ?? []) {
          const durationBars = ((Math.max(0, b.trimEnd - b.trimStart) * bpm) / 60) / beatsPerBar
          clips.push({ left: b.startBar / total, width: durationBars / total })
        }
      } else {
        for (const b of track.blocks ?? []) {
          clips.push({ left: b.startBar / total, width: b.durationBars / total })
        }
      }
      if (clips.length > 0) lanes.push({ color: resolveTrackIdentityColor(track), clips })
      if (lanes.length >= 5) break
    }
    return lanes
    // Static per dialog open - the arrangement can't change under a modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalBeats])
}

/** The playhead on the clip map, isolated so its per-frame beat subscription
 *  re-renders a line, not the modal. */
function MapPlayhead({ totalBeats }: { totalBeats: number }) {
  const currentBeat = useTimeStore((s) => s.currentBeat)
  const left = Math.min(1, Math.max(0, currentBeat / totalBeats))
  return (
    <div className="pointer-events-none absolute inset-y-0 z-20" style={{ left: `${left * 100}%` }}>
      <div className="h-full w-px bg-[var(--accent-hover)] shadow-[0_0_8px_rgba(69,198,255,0.8)]" />
      <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--accent-hover)]" />
    </div>
  )
}

function ClipMap({
  lanes,
  totalBeats,
  loop,
  progress,
  scrubbable,
}: {
  lanes: MapLane[]
  totalBeats: number
  /** Fractions of the map the export range covers; null = full track. */
  loop: { start: number; end: number } | null
  /** 0..1 fill across the export range while rendering; null when idle. */
  progress: number | null
  scrubbable: boolean
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const { startScrub } = useScrub({
    computeBeat: (clientX) => {
      const rect = mapRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return null
      return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * totalBeats
    },
  })
  const rangeStart = loop?.start ?? 0
  const rangeEnd = loop?.end ?? 1

  return (
    <div
      ref={mapRef}
      onPointerDown={scrubbable ? startScrub : undefined}
      className={`relative h-11 overflow-hidden rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[#0a0b10] ${scrubbable ? 'cursor-ew-resize' : ''}`}
    >
      <div className="absolute inset-1 flex flex-col gap-[3px]">
        {lanes.map((lane, i) => (
          <div key={i} className="relative min-h-0 flex-1">
            {lane.clips.map((clip, j) => (
              <div
                key={j}
                className="absolute inset-y-0 rounded-[2px]"
                style={{
                  left: `${clip.left * 100}%`,
                  width: `max(2px, ${clip.width * 100}%)`,
                  backgroundColor: lane.color,
                  opacity: 0.8,
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Rendering: the fill sweeps across the export range itself. */}
      {progress != null && (
        <div
          className="absolute inset-y-0 z-10"
          style={{
            left: `${rangeStart * 100}%`,
            width: `${(rangeEnd - rangeStart) * progress * 100}%`,
            background: 'rgba(69,198,255,0.28)',
            boxShadow: 'inset -2px 0 0 rgba(127,216,255,0.9), 0 0 12px rgba(69,198,255,0.5)',
          }}
        />
      )}

      {/* Loop range: outside dimmed, boundaries barred in accent. */}
      {loop && (
        <>
          <div className="absolute inset-y-0 left-0 z-10" style={{ width: `${loop.start * 100}%`, background: 'rgba(10,11,16,0.78)' }} />
          <div className="absolute inset-y-0 right-0 z-10" style={{ width: `${(1 - loop.end) * 100}%`, background: 'rgba(10,11,16,0.78)' }} />
          <div className="absolute inset-y-0 z-10 w-[2px] bg-[var(--accent)]" style={{ left: `calc(${loop.start * 100}% - 1px)` }} />
          <div className="absolute inset-y-0 z-10 w-[2px] bg-[var(--accent)]" style={{ left: `calc(${loop.end * 100}% - 1px)` }} />
        </>
      )}

      {scrubbable && <MapPlayhead totalBeats={totalBeats} />}
    </div>
  )
}

// ── Rail controls ────────────────────────────────────────────────────────────

const RAIL_LABEL = 'font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] select-none'
const CHIP_SELECT =
  'h-8 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[#10131c] px-2 font-mono text-[12px] text-[var(--text-2)] outline-none cursor-pointer'

function AspectCard({ aspect, selected, onPick }: { aspect: ExportAspect; selected: boolean; onPick: () => void }) {
  const wide = aspect === '16:9'
  return (
    <button
      onClick={onPick}
      aria-pressed={selected}
      className={`flex flex-1 flex-col items-center justify-center gap-2 rounded-[10px] border py-3 transition-colors cursor-pointer ${
        selected
          ? 'border-transparent bg-[var(--accent)]'
          : 'border-[rgba(255,255,255,0.1)] bg-[#10131c] hover:border-[rgba(255,255,255,0.2)]'
      }`}
    >
      <span
        className={`rounded-[3px] border-2 ${selected ? 'border-[#0c0d12]' : 'border-[var(--text-3)]'}`}
        style={{ width: wide ? 30 : 17, height: wide ? 17 : 30 }}
      />
      <span className={`font-mono text-[11px] ${selected ? 'text-[#0c0d12] font-semibold' : 'text-[var(--text-3)]'}`}>{aspect}</span>
    </button>
  )
}

// ── The dialog ───────────────────────────────────────────────────────────────

/**
 * The export flow (5a-5d): a wide idle modal - live scrubbable monitor + clip
 * map left, settings rail right - collapsing to a compact render/receipt popup
 * once encoding starts. idle → rendering → complete; cancel returns to idle
 * (partial file discarded); settings freeze once rendering starts. The file
 * auto-downloads on completion - the receipt screen is the retry path.
 */
export function ExportDialog({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const [settings, setSettings] = useState<ExportSettings>(() => loadSavedSettings(isPro))
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' })
  const [audioOk, setAudioOk] = useState(true)
  const [rangeNote, setRangeNote] = useState<string | null>(null)
  const bpm = useProjectStore((s) => s.bpm)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const loopRegion = useTimeStore((s) => s.loopRegion)
  const [freeze, setFreeze] = useState<{ src: string; rect: DOMRect } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const idle = phase.kind === 'settings'
  const running = phase.kind === 'running'

  const totalBeats = Math.max(1, totalBars) * beatsPerBar
  const lanes = useClipMap(totalBeats)

  useEffect(() => {
    void isExportSupported().then((s) => setAudioOk(s.audioOk))
  }, [])

  // Kill background shortcuts while the dialog is up; dialog fields pass through.
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && panelRef.current?.contains(t)) return
      if (e.key === 'Escape' && phase.kind === 'settings') { onClose(); return }
      e.stopPropagation()
      if (e.code === 'Space' || e.code === 'Enter') e.preventDefault()
    }
    window.addEventListener('keydown', block, { capture: true })
    return () => window.removeEventListener('keydown', block, { capture: true })
  }, [phase.kind, onClose])

  useEffect(() => {
    useUIStore.getState().setModalOpen(true)
    return () => useUIStore.getState().setModalOpen(false)
  }, [])

  const start = async () => {
    const { bpm, beatsPerBar, totalBars, tracks, rootTrackIds } = useProjectStore.getState()
    const audioTracks = rootTrackIds.map((id) => tracks[id]).filter((t) => t?.type === 'audio')
    const tiered = isPro ? { ...settings, watermark: false } : clampToFreeTier(settings)
    const effective = { ...tiered, includeAudio: tiered.includeAudio && audioOk, videoBitrate: defaultBitrate(Math.max(tiered.width, tiered.height), tiered.fps) }
    const { fileName: _fileName, watermark: _watermark, ...remembered } = effective
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(remembered)) } catch { /* private mode */ }

    const range = resolveExportRange(effective, beatsPerBar, totalBars, useTimeStore.getState().loopRegion)
    setRangeNote(effective.rangeMode === 'loop' && !range ? 'No loop region was set, so the whole project was exported.' : null)

    // Freeze the visual behind the dialog: the live canvas is about to render
    // export frames (which the modal's monitor mirrors); the editor view pins
    // a still of the user's beat.
    const driver = getFrameDriver()
    if (driver) {
      const canvas = driver.getCanvas()
      driver.renderFrame(useTimeStore.getState().currentBeat, 0)
      setFreeze({ src: canvas.toDataURL('image/png'), rect: canvas.getBoundingClientRect() })
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPhase({ kind: 'running', frame: 0, total: 1, startedAt: performance.now() })
    try {
      const { blob } = await runExport(
        effective,
        { bpm, beatsPerBar, totalBars, audioTracks, range },
        {
          signal: ctrl.signal,
          onProgress: (frame, total) =>
            setPhase((p) => (p.kind === 'running' ? { ...p, frame, total } : p)),
        },
      )
      if (blob) {
        setPhase({ kind: 'done', fileName: effective.fileName, blob })
        // The receipt screen is the retry path when the browser blocks this.
        downloadBlob(blob, effective.fileName)
      } else {
        setPhase({ kind: 'settings' })
      }
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      abortRef.current = null
      getFrameDriver()?.unpin()
      setFreeze(null)
    }
  }

  // Live duration through the same resolver the export uses.
  const previewRange = resolveExportRange(settings, beatsPerBar, totalBars, loopRegion)
  const previewBeats = previewRange ? previewRange.endBeat - previewRange.startBeat : totalBars * beatsPerBar
  const previewSec = (previewBeats * 60) / bpm
  const duration = `${Math.floor(previewSec / 60)}:${String(Math.floor(previewSec % 60)).padStart(2, '0')}`

  const loopFractions = settings.rangeMode === 'loop' && loopRegion
    ? { start: Math.max(0, loopRegion.startBeat / totalBeats), end: Math.min(1, loopRegion.endBeat / totalBeats) }
    : null

  const vertical = settings.aspect === '9:16'
  const title = phase.kind === 'running' ? 'RENDERING' : phase.kind === 'done' ? 'EXPORT COMPLETE' : phase.kind === 'error' ? 'EXPORT FAILED' : 'EXPORT'

  const closeButton = (
    <button
      onClick={() => { abortRef.current?.abort(); onClose() }}
      aria-label="Close"
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-[var(--text-3)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:text-[var(--text)] cursor-pointer"
    >
      <X size={14} />
    </button>
  )

  return createPortal(
    <>
      {/* The freeze still hides the garbled pinned canvas BENEATH the scrim -
          above it, it read as the visualizer floating over the export UI. */}
      {freeze && (
        <img
          src={freeze.src}
          alt=""
          className="fixed z-[90] pointer-events-none select-none"
          style={{ left: freeze.rect.left, top: freeze.rect.top, width: freeze.rect.width, height: freeze.rect.height }}
        />
      )}
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: 'rgba(8,9,13,0.72)', backdropFilter: 'blur(2px)' }}
      onPointerDown={(e) => { if (idle && e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        className={`${idle ? 'w-[1180px]' : 'w-[720px]'} max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[14px] border border-[rgba(255,255,255,0.1)] bg-[#0f1118] px-[26px] pb-[22px] pt-5 shadow-[0_30px_80px_rgba(0,0,0,0.6)]`}
      >
        <div className="mb-4 flex items-center justify-between">
          <span className="text-[14px] font-bold tracking-[0.12em] text-[var(--text)] [font-family:var(--font-archivo)]">{title}</span>
          {closeButton}
        </div>

        {/* ── Idle: monitor + clip map | settings rail ── */}
        {idle && (
          <div className="flex gap-6">
            <div className="min-w-0 flex-1">
              <div className={`relative overflow-hidden rounded-[10px] border ${running ? 'border-[rgba(69,198,255,0.4)]' : 'border-[rgba(255,255,255,0.08)]'}`}>
                <MonitorCanvas live />
                {/* 9:16 shows the live center-crop: bright column, dimmed sides. */}
                {vertical && (
                  <>
                    <div className="pointer-events-none absolute inset-y-0 left-0 bg-black/60" style={{ width: 'calc(50% - 14.0625%)' }} />
                    <div className="pointer-events-none absolute inset-y-0 right-0 bg-black/60" style={{ width: 'calc(50% - 14.0625%)' }} />
                    <div className="pointer-events-none absolute inset-y-0 w-px bg-[var(--accent)]" style={{ left: 'calc(50% - 14.0625%)' }} />
                    <div className="pointer-events-none absolute inset-y-0 w-px bg-[var(--accent)]" style={{ right: 'calc(50% - 14.0625%)' }} />
                  </>
                )}
              </div>
              <div className="mt-3">
                <ClipMap lanes={lanes} totalBeats={totalBeats} loop={loopFractions} progress={null} scrubbable />
              </div>
            </div>

            <div className="flex w-[280px] flex-shrink-0 flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className={RAIL_LABEL}>Aspect</span>
                <div className="flex gap-2">
                  {(['16:9', '9:16'] as const).map((aspect) => (
                    <AspectCard
                      key={aspect}
                      aspect={aspect}
                      selected={settings.aspect === aspect}
                      onPick={() => setSettings((s) => {
                        const tiers = resolutionsFor(aspect)
                        const tier = tiers.find((r) => Math.max(r.width, r.height) === Math.max(s.width, s.height)) ?? tiers[1]
                        return { ...s, aspect, width: tier.width, height: tier.height }
                      })}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className={RAIL_LABEL}>Export range</span>
                <div className="flex gap-2">
                  {([['loop', 'Loop region'], ['whole', 'Full track']] as const).map(([mode, label]) => {
                    const disabled = mode === 'loop' && !loopRegion
                    const selected = settings.rangeMode === mode
                    return (
                      <button
                        key={mode}
                        disabled={disabled}
                        onClick={() => setSettings((s) => ({ ...s, rangeMode: mode }))}
                        className={`h-[38px] flex-1 rounded-full text-[12px] font-semibold transition-colors ${
                          selected
                            ? 'bg-[var(--accent)] text-[#0c0d12]'
                            : disabled
                              ? 'border border-[rgba(255,255,255,0.06)] text-[var(--text-muted)] cursor-default'
                              : 'border border-[rgba(255,255,255,0.1)] bg-[#10131c] text-[var(--text-3)] hover:border-[rgba(255,255,255,0.2)] cursor-pointer'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="flex items-center justify-between">
                <span className={RAIL_LABEL}>Resolution</span>
                <select
                  value={settings.width}
                  onChange={(e) => {
                    const tiers = resolutionsFor(settings.aspect)
                    const r = tiers.find((r) => r.width === Number(e.target.value)) ?? tiers[0]
                    setSettings((s) => ({ ...s, width: r.width, height: r.height }))
                  }}
                  className={CHIP_SELECT}
                >
                  {resolutionsFor(settings.aspect).map((r) => {
                    const gated = !isPro && Math.max(r.width, r.height) > 1280
                    return (
                      <option key={r.width} value={r.width} disabled={gated}>
                        {r.label}{gated ? ' - Pro' : ''}
                      </option>
                    )
                  })}
                </select>
              </label>

              <label className="flex items-center justify-between">
                <span className={RAIL_LABEL}>FPS</span>
                <select
                  value={settings.fps}
                  onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) as 30 | 60 }))}
                  className={CHIP_SELECT}
                >
                  <option value={60}>60</option>
                  <option value={30}>30</option>
                </select>
              </label>

              <label className="flex items-center justify-between">
                <span className={RAIL_LABEL}>Quality</span>
                <select
                  value={settings.rateControl}
                  onChange={(e) => setSettings((s) => ({ ...s, rateControl: e.target.value as ExportRateControl }))}
                  className={CHIP_SELECT}
                >
                  <option value="bitrate">Standard</option>
                  <option value="quality">Maximum</option>
                </select>
              </label>
              {settings.rateControl === 'quality' && (
                <p className="-mt-2 text-[11px] leading-snug text-[var(--text-muted)]">File can grow several times larger</p>
              )}

              <label className={`flex items-center justify-between ${audioOk ? '' : 'opacity-50'}`}>
                <span className={RAIL_LABEL}>Include audio</span>
                <button
                  role="switch"
                  aria-checked={settings.includeAudio && audioOk}
                  disabled={!audioOk}
                  onClick={() => setSettings((s) => ({ ...s, includeAudio: !s.includeAudio }))}
                  className={`relative h-[21px] w-[38px] rounded-full transition-colors duration-150 cursor-pointer ${
                    settings.includeAudio && audioOk ? 'bg-[var(--accent)]' : 'bg-[#1a1f2c]'
                  }`}
                >
                  <span
                    className="absolute top-[2px] h-[17px] w-[17px] rounded-full bg-[#0c0d12] transition-[left] duration-150"
                    style={{ left: settings.includeAudio && audioOk ? 19 : 2 }}
                  />
                </button>
              </label>
              {!audioOk && <p className="-mt-2 text-[11px] leading-snug text-[var(--text-muted)]">No AAC encoder in this browser - exporting video only.</p>}

              <label className="flex items-center justify-between gap-3">
                <span className={RAIL_LABEL}>File name</span>
                <input
                  value={settings.fileName}
                  onChange={(e) => setSettings((s) => ({ ...s, fileName: e.target.value }))}
                  spellCheck={false}
                  className="h-8 w-[160px] min-w-0 rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-[#10131c] px-2 font-mono text-[12px] text-[var(--text-2)] outline-none focus:border-[var(--accent)]"
                />
              </label>

              {!isPro && (
                <p className="text-[11px] leading-snug text-[var(--text-muted)]">
                  Free exports are 720p.{' '}
                  <a href="/pricing" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline underline-offset-2 hover:text-[var(--accent-hover)] cursor-pointer">
                    Upgrade to Pro
                  </a>{' '}
                  for clean exports up to 4K.
                </p>
              )}

              <button
                onClick={() => void start()}
                disabled={!settings.fileName.trim()}
                className="mt-auto flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-button)] text-[13px] font-bold text-[var(--on-accent)] [font-family:var(--font-plex-sans)] transition-colors hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] cursor-pointer disabled:cursor-default"
              >
                <Upload size={13} strokeWidth={2.5} />
                Export · {duration}
              </button>
            </div>
          </div>
        )}

        {/* ── Rendering: true render monitor + progress ── */}
        {phase.kind === 'running' && (
          <RunningView
            phase={phase}
            fps={settings.fps}
            vertical={vertical}
            lanes={lanes}
            totalBeats={totalBeats}
            loop={loopFractions}
            onCancel={() => abortRef.current?.abort()}
          />
        )}

        {/* ── Complete: the receipt ── */}
        {phase.kind === 'done' && (
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-[10px] border border-[rgba(255,255,255,0.08)]">
              <MonitorCanvas live={false} />
            </div>
            {rangeNote && <p className="text-[11px] leading-snug text-[var(--text-muted)]">{rangeNote}</p>}
            <div className="flex items-center justify-between gap-4">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)]">
                  <Check size={12} strokeWidth={3} className="text-[#0c0d12]" />
                </span>
                <span className="truncate font-mono text-[12px] text-[var(--text-2)]">
                  {phase.fileName}.mp4
                  <span className="text-[var(--text-muted)]"> · {(phase.blob.size / 1e6).toFixed(1)} MB</span>
                </span>
              </span>
              <button
                onClick={() => downloadBlob(phase.blob, phase.fileName)}
                className="h-9 flex-shrink-0 rounded-full bg-[var(--accent-button)] px-6 text-[12px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
              >
                Download
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex flex-col gap-3">
            <p className="break-words text-xs text-red-400">Export failed: {phase.message}</p>
            <button onClick={() => setPhase({ kind: 'settings' })} className="h-10 w-full rounded-full bg-[var(--bg-elevated)] text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--border)] cursor-pointer">
              Back
            </button>
          </div>
        )}
      </div>
    </div>
    </>,
    document.body,
  )
}

function RunningView({
  phase,
  fps,
  vertical,
  lanes,
  totalBeats,
  loop,
  onCancel,
}: {
  phase: Extract<Phase, { kind: 'running' }>
  fps: number
  vertical: boolean
  lanes: MapLane[]
  totalBeats: number
  loop: { start: number; end: number } | null
  onCancel: () => void
}) {
  const progress = phase.total > 0 ? Math.min(1, phase.frame / phase.total) : 0
  const elapsedSec = (performance.now() - phase.startedAt) / 1000
  const outputSec = phase.frame / fps
  const speed = elapsedSec > 0.5 ? outputSec / elapsedSec : 0
  const remainingSec = speed > 0 ? ((phase.total - phase.frame) / fps) / speed : null
  const remaining = remainingSec != null
    ? `${Math.floor(remainingSec / 60)}:${String(Math.max(0, Math.round(remainingSec % 60))).padStart(2, '0')}`
    : null

  return (
    <div className="flex flex-col gap-3">
      {/* The render monitor: the live canvas IS encoding these frames. */}
      <div className="overflow-hidden rounded-[10px] border border-[rgba(69,198,255,0.4)] shadow-[0_0_30px_rgba(69,198,255,0.15)]">
        <MonitorCanvas live />
      </div>

      {vertical ? (
        // 9:16: a thin accent progress line under the monitor.
        <div className="h-[3px] overflow-hidden rounded-full bg-[#1a1f2c]">
          <div className="h-full bg-[var(--accent)] shadow-[0_0_8px_rgba(69,198,255,0.8)] transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : (
        // 16:9: the fill sweeps the export range on the clip map itself.
        <ClipMap lanes={lanes} totalBeats={totalBeats} loop={loop} progress={progress} scrubbable={false} />
      )}

      <div className="flex justify-center gap-2 font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
        <span>{phase.frame} / {phase.total} frames</span>
        {remaining != null && <span>· {remaining} left</span>}
      </div>
      <p className="text-center text-[11px] leading-snug text-[var(--text-muted)]">
        Stay on this tab for the fastest export - it keeps going in the background, just slower.
      </p>
      <button
        onClick={onCancel}
        className="h-10 w-full rounded-full border border-[rgba(255,255,255,0.14)] text-xs font-semibold text-[var(--text-2)] transition-colors hover:border-[rgba(255,255,255,0.3)] hover:text-[var(--text)] cursor-pointer"
      >
        Cancel
      </button>
    </div>
  )
}
