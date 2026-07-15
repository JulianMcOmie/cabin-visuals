'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Film } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useUIStore } from '../store/UIStore'
import { useTimeStore } from '../store/TimeStore'
import { runExport } from '../core/export/exportEngine'
import { downloadBlob } from '../core/export/mux'
import { getFrameDriver } from '../core/export/frameDriver'
import { isExportSupported } from '../core/export/support'
import { clampToFreeTier, defaultBitrate, defaultSettings, resolveExportRange, RESOLUTIONS, type ExportRangeMode, type ExportSettings } from '../core/export/types'

const SETTINGS_KEY = 'cabin.exportSettings'

type Phase =
  | { kind: 'settings' }
  | { kind: 'running'; frame: number; total: number; startedAt: number }
  // The finished file waits here - nothing downloads until the user asks.
  | { kind: 'done'; fileName: string; blob: Blob }
  | { kind: 'error'; message: string }

/** The project's name as a safe default filename (no path/reserved characters). */
function defaultFileName(): string {
  const name = useUIStore.getState().projectName?.trim()
  if (!name) return 'export'
  const safe = name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim()
  return safe || 'export'
}

// A remembered range must still fit the OPEN project: loop mode with no region
// set, custom bars outside [1, totalBars], or a garbage mode all fall back to
// whole project silently rather than clamping to something arbitrary.
function sanitizeRange(s: ExportSettings): ExportSettings {
  const { totalBars } = useProjectStore.getState()
  const hasLoop = useTimeStore.getState().loopRegion != null
  const barsValid =
    Number.isFinite(s.rangeFromBar) && Number.isFinite(s.rangeToBar) &&
    s.rangeFromBar >= 1 && s.rangeToBar <= totalBars && s.rangeToBar >= s.rangeFromBar
  const modeValid =
    s.rangeMode === 'whole' || (s.rangeMode === 'loop' && hasLoop) || (s.rangeMode === 'custom' && barsValid)
  return {
    ...s,
    rangeMode: modeValid ? s.rangeMode : 'whole',
    rangeFromBar: barsValid ? s.rangeFromBar : 1,
    rangeToBar: barsValid ? s.rangeToBar : Math.max(1, totalBars),
  }
}

function loadSavedSettings(isPro: boolean): ExportSettings {
  // Quality settings are remembered across sessions; the FILENAME is not - it
  // defaults to the open project's name every time. The watermark flag is never
  // trusted from storage - it's derived from the plan, here and again at start.
  const base = defaultSettings(defaultFileName())
  base.rangeToBar = Math.max(1, useProjectStore.getState().totalBars)
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return isPro ? { ...base, watermark: false } : clampToFreeTier(base)
    const saved = JSON.parse(raw) as Partial<ExportSettings>
    const merged = sanitizeRange({ ...base, ...saved, fileName: base.fileName })
    merged.videoBitrate = defaultBitrate(merged.width, merged.fps)
    merged.watermark = !isPro
    return isPro ? merged : clampToFreeTier(merged)
  } catch {
    return isPro ? { ...base, watermark: false } : clampToFreeTier(base)
  }
}

/**
 * The export lifecycle in one modal: settings → running (progress + cancel) →
 * done/error. While open, a capture-phase key blocker keeps Space/Enter and the
 * timeline shortcuts from reaching the editor underneath; the overlay is
 * translucent on purpose - the canvas behind it renders the actual frames as
 * they export, which is the best progress bar there is.
 */
export function ExportDialog({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const [settings, setSettings] = useState<ExportSettings>(() => loadSavedSettings(isPro))
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' })
  const [audioOk, setAudioOk] = useState(true)
  // Set when a 'loop' choice had to fall back to whole project at export time.
  const [rangeNote, setRangeNote] = useState<string | null>(null)
  const bpm = useProjectStore((s) => s.bpm)
  const beatsPerBar = useProjectStore((s) => s.beatsPerBar)
  const totalBars = useProjectStore((s) => s.totalBars)
  const loopRegion = useTimeStore((s) => s.loopRegion)
  // While exporting, a still of the canvas at the user's beat covers the live
  // canvas (which is busy rendering export frames) - nothing on screen scrubs.
  const [freeze, setFreeze] = useState<{ src: string; rect: DOMRect } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const running = phase.kind === 'running'

  useEffect(() => {
    void isExportSupported().then((s) => setAudioOk(s.audioOk))
  }, [])

  // Kill background shortcuts (transport Space/Enter, timeline Delete/copy/paste)
  // while the dialog is up. Keys aimed at the dialog's own fields pass through.
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

  // Stand down editor surfaces with document-level pointer handling (panel
  // resize hit-testing) while the dialog is up - the overlay can't block them.
  useEffect(() => {
    useUIStore.getState().setModalOpen(true)
    return () => useUIStore.getState().setModalOpen(false)
  }, [])

  const start = async () => {
    const { bpm, beatsPerBar, totalBars, tracks, rootTrackIds } = useProjectStore.getState()
    const audioTracks = rootTrackIds.map((id) => tracks[id]).filter((t) => t?.type === 'audio')
    // Belt-and-braces: re-derive the tier gates at start, whatever the UI state says.
    const tiered = isPro ? { ...settings, watermark: false } : clampToFreeTier(settings)
    const effective = { ...tiered, includeAudio: tiered.includeAudio && audioOk, videoBitrate: defaultBitrate(tiered.width, tiered.fps) }
    // Persist quality preferences only - the filename belongs to the project,
    // and the watermark flag to the plan.
    const { fileName: _fileName, watermark: _watermark, ...remembered } = effective
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(remembered)) } catch { /* private mode */ }

    // Resolve the range against live state at export time; a loop region that
    // vanished since the mode was chosen degrades to a full export, with a note.
    const range = resolveExportRange(effective, beatsPerBar, totalBars, useTimeStore.getState().loopRegion)
    setRangeNote(effective.rangeMode === 'loop' && !range ? 'No loop region was set, so the whole project was exported.' : null)

    // Freeze the visual behind the dialog: render the user's current beat once
    // (same task, so the buffer is valid) and pin that still over the canvas.
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
      setPhase(blob ? { kind: 'done', fileName: effective.fileName, blob } : { kind: 'settings' })
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      abortRef.current = null
      getFrameDriver()?.unpin() // belt-and-braces: clears the beat override too
      setFreeze(null)
    }
  }

  const clampBar = (v: number) => Math.min(Math.max(Math.round(v), 1), Math.max(1, totalBars))
  // Live duration readout through the same resolver the export uses, so the
  // number shown is exactly what will render.
  const previewRange = resolveExportRange(settings, beatsPerBar, totalBars, loopRegion)
  const previewBeats = previewRange ? previewRange.endBeat - previewRange.startBeat : totalBars * beatsPerBar
  const previewBars = Number((previewBeats / beatsPerBar).toFixed(2))
  const previewSec = (previewBeats * 60) / bpm

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      {freeze && (
        <img
          src={freeze.src}
          alt=""
          className="fixed pointer-events-none select-none"
          style={{ left: freeze.rect.left, top: freeze.rect.top, width: freeze.rect.width, height: freeze.rect.height }}
        />
      )}
      <div ref={panelRef} className="w-[340px] rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
            <Film size={14} className="text-[var(--accent)]" />
            Export video
          </span>
          {!running && (
            <button onClick={onClose} className="flex items-center justify-center w-5 h-5 rounded bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer">
              <X size={12} />
            </button>
          )}
        </div>

        {phase.kind === 'settings' && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between text-xs text-[var(--text-3)]">
              Resolution
              <select
                value={settings.width}
                onChange={(e) => {
                  const r = RESOLUTIONS.find((r) => r.width === Number(e.target.value)) ?? RESOLUTIONS[0]
                  setSettings((s) => ({ ...s, width: r.width, height: r.height }))
                }}
                className="h-6 px-1.5 rounded bg-[var(--bg-app)] text-xs text-[var(--text-2)] border border-[var(--border)] outline-none cursor-pointer"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.width} value={r.width} disabled={!isPro && r.width > 1280}>
                    {r.label}{!isPro && r.width > 1280 ? ' - Pro' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between text-xs text-[var(--text-3)]">
              Frame rate
              <select
                value={settings.fps}
                onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) as 30 | 60 }))}
                className="h-6 px-1.5 rounded bg-[var(--bg-app)] text-xs text-[var(--text-2)] border border-[var(--border)] outline-none cursor-pointer"
              >
                <option value={60}>60 fps</option>
                <option value={30}>30 fps</option>
              </select>
            </label>

            <label className="flex items-center justify-between text-xs text-[var(--text-3)]">
              Range
              <select
                value={settings.rangeMode}
                onChange={(e) => setSettings((s) => ({ ...s, rangeMode: e.target.value as ExportRangeMode }))}
                className="h-6 px-1.5 rounded bg-[var(--bg-app)] text-xs text-[var(--text-2)] border border-[var(--border)] outline-none cursor-pointer"
              >
                <option value="whole">Whole project</option>
                <option value="loop" disabled={!loopRegion}>Loop region{loopRegion ? '' : ' (none set)'}</option>
                <option value="custom">Custom bars</option>
              </select>
            </label>

            {settings.rangeMode === 'custom' && (
              <div className="flex items-center justify-between text-xs text-[var(--text-3)] -mt-1">
                {/* Both bounds inclusive: 2 to 4 exports bars 2, 3, and 4. */}
                <span>Bars (inclusive)</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    max={totalBars}
                    value={settings.rangeFromBar}
                    onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) setSettings((s) => ({ ...s, rangeFromBar: clampBar(v) })) }}
                    onBlur={() => setSettings((s) => ({ ...s, rangeToBar: Math.max(s.rangeToBar, s.rangeFromBar) }))}
                    className="w-14 h-6 px-1.5 rounded bg-[var(--bg-app)] text-xs text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
                  />
                  <span className="text-[var(--text-muted)]">to</span>
                  <input
                    type="number"
                    min={1}
                    max={totalBars}
                    value={settings.rangeToBar}
                    onChange={(e) => { const v = e.target.valueAsNumber; if (Number.isFinite(v)) setSettings((s) => ({ ...s, rangeToBar: clampBar(v) })) }}
                    onBlur={() => setSettings((s) => ({ ...s, rangeFromBar: Math.min(s.rangeFromBar, s.rangeToBar) }))}
                    className="w-14 h-6 px-1.5 rounded bg-[var(--bg-app)] text-xs text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
                  />
                </span>
              </div>
            )}

            <p className="text-[11px] text-[var(--text-muted)] -mt-2">
              {previewBars} {previewBars === 1 ? 'bar' : 'bars'} · {previewSec.toFixed(1)}s
            </p>

            <label className={`flex items-center justify-between text-xs ${audioOk ? 'text-[var(--text-3)]' : 'text-[var(--text-muted)]'}`}>
              Include audio
              <input
                type="checkbox"
                checked={settings.includeAudio && audioOk}
                disabled={!audioOk}
                onChange={(e) => setSettings((s) => ({ ...s, includeAudio: e.target.checked }))}
                className="accent-[#35a7e6] w-3.5 h-3.5 cursor-pointer"
              />
            </label>
            {!audioOk && <p className="text-[11px] text-[var(--text-muted)] -mt-2">No AAC encoder in this browser - exporting video only.</p>}

            <label className="flex items-center justify-between gap-3 text-xs text-[var(--text-3)]">
              File name
              <input
                value={settings.fileName}
                onChange={(e) => setSettings((s) => ({ ...s, fileName: e.target.value }))}
                spellCheck={false}
                className="flex-1 min-w-0 h-6 px-1.5 rounded bg-[var(--bg-app)] text-xs text-[var(--text-2)] border border-[var(--border)] outline-none focus:border-[var(--accent)]"
              />
            </label>

            {!isPro && (
              <p className="text-[11px] text-[var(--text-muted)] leading-snug">
                Free exports are 720p with a small watermark.{' '}
                {/* New tab: mid-export (possibly unsaved demo work) shouldn't be navigated away. */}
                <a
                  href="/pricing"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2 cursor-pointer"
                >
                  Upgrade to Pro
                </a>{' '}
                for clean exports up to 4K.
              </p>
            )}

            <button
              onClick={() => void start()}
              disabled={!settings.fileName.trim()}
              className="mt-1 h-8 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--bg-elevated)] disabled:text-[var(--text-muted)] text-[var(--on-accent)] text-xs font-bold transition-colors cursor-pointer disabled:cursor-default"
            >
              Export
            </button>
          </div>
        )}

        {phase.kind === 'running' && <RunningView phase={phase} fps={settings.fps} onCancel={() => abortRef.current?.abort()} />}

        {phase.kind === 'done' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--text-2)]">
              <span className="font-mono text-[var(--text)]">{phase.fileName}.mp4</span> is ready
              <span className="text-[var(--text-muted)]"> · {(phase.blob.size / 1e6).toFixed(1)} MB</span>
            </p>
            {rangeNote && <p className="text-[11px] text-[var(--text-muted)] leading-snug">{rangeNote}</p>}
            <button
              onClick={() => downloadBlob(phase.blob, phase.fileName)}
              className="h-8 rounded bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--on-accent)] text-xs font-bold transition-colors cursor-pointer"
            >
              Download
            </button>
            <button onClick={onClose} className="h-8 rounded bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-2)] text-xs font-semibold transition-colors cursor-pointer">Close</button>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-red-400 break-words">Export failed: {phase.message}</p>
            <button onClick={() => setPhase({ kind: 'settings' })} className="h-8 rounded bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-2)] text-xs font-semibold transition-colors cursor-pointer">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

function RunningView({ phase, fps, onCancel }: { phase: Extract<Phase, { kind: 'running' }>; fps: number; onCancel: () => void }) {
  const pct = phase.total > 0 ? Math.min(100, (phase.frame / phase.total) * 100) : 0
  const elapsedSec = (performance.now() - phase.startedAt) / 1000
  const outputSec = phase.frame / fps
  const speed = elapsedSec > 0.5 ? outputSec / elapsedSec : 0
  const remaining = speed > 0 ? ((phase.total - phase.frame) / fps) / speed : null
  return (
    <div className="flex flex-col gap-3">
      <div className="h-2 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div className="h-full bg-[var(--accent)] transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
        <span>{phase.frame} / {phase.total} frames</span>
        <span>
          {remaining != null && `~${Math.max(1, Math.round(remaining))}s left`}
        </span>
      </div>
      <p className="text-[11px] text-[var(--text-muted)] leading-snug">
        Stay on this tab for the fastest export - it keeps going in the background, just slower.
      </p>
      <button onClick={onCancel} className="h-8 rounded bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-2)] text-xs font-semibold transition-colors cursor-pointer">Cancel</button>
    </div>
  )
}
