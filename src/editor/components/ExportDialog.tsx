'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Film } from 'lucide-react'
import { useProjectStore } from '../store/ProjectStore'
import { useTimeStore } from '../store/TimeStore'
import { exportAndDownload } from '../core/export/exportEngine'
import { getFrameDriver } from '../core/export/frameDriver'
import { isExportSupported } from '../core/export/support'
import { defaultBitrate, defaultSettings, RESOLUTIONS, type ExportSettings } from '../core/export/types'

const SETTINGS_KEY = 'cabin.exportSettings'

type Phase =
  | { kind: 'settings' }
  | { kind: 'running'; frame: number; total: number; startedAt: number }
  | { kind: 'done'; fileName: string }
  | { kind: 'error'; message: string }

function loadSavedSettings(): ExportSettings {
  const base = defaultSettings('export')
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return base
    const saved = JSON.parse(raw) as Partial<ExportSettings>
    const merged = { ...base, ...saved }
    merged.videoBitrate = defaultBitrate(merged.width, merged.fps)
    return merged
  } catch {
    return base
  }
}

/**
 * The export lifecycle in one modal: settings → running (progress + cancel) →
 * done/error. While open, a capture-phase key blocker keeps Space/Enter and the
 * timeline shortcuts from reaching the editor underneath; the overlay is
 * translucent on purpose — the canvas behind it renders the actual frames as
 * they export, which is the best progress bar there is.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ExportSettings>(loadSavedSettings)
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' })
  const [audioOk, setAudioOk] = useState(true)
  // While exporting, a still of the canvas at the user's beat covers the live
  // canvas (which is busy rendering export frames) — nothing on screen scrubs.
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

  const start = async () => {
    const { bpm, beatsPerBar, totalBars, tracks, rootTrackIds } = useProjectStore.getState()
    const audioTracks = rootTrackIds.map((id) => tracks[id]).filter((t) => t?.type === 'audio')
    const effective = { ...settings, includeAudio: settings.includeAudio && audioOk, videoBitrate: defaultBitrate(settings.width, settings.fps) }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(effective)) } catch { /* private mode */ }

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
      const finished = await exportAndDownload(
        effective,
        { bpm, beatsPerBar, totalBars, audioTracks },
        {
          signal: ctrl.signal,
          onProgress: (frame, total) =>
            setPhase((p) => (p.kind === 'running' ? { ...p, frame, total } : p)),
        },
      )
      setPhase(finished ? { kind: 'done', fileName: effective.fileName } : { kind: 'settings' })
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      abortRef.current = null
      getFrameDriver()?.unpin() // belt-and-braces: clears the beat override too
      setFreeze(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      {freeze && (
        <img
          src={freeze.src}
          alt=""
          className="fixed pointer-events-none select-none"
          style={{ left: freeze.rect.left, top: freeze.rect.top, width: freeze.rect.width, height: freeze.rect.height }}
        />
      )}
      <div ref={panelRef} className="w-[340px] rounded-lg border border-zinc-700 bg-[#202024] shadow-2xl shadow-black/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <Film size={14} className="text-indigo-400" />
            Export video
          </span>
          {!running && (
            <button onClick={onClose} className="flex items-center justify-center w-5 h-5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200">
              <X size={12} />
            </button>
          )}
        </div>

        {phase.kind === 'settings' && (
          <div className="flex flex-col gap-3">
            <label className="flex items-center justify-between text-xs text-zinc-400">
              Resolution
              <select
                value={settings.width}
                onChange={(e) => {
                  const r = RESOLUTIONS.find((r) => r.width === Number(e.target.value)) ?? RESOLUTIONS[0]
                  setSettings((s) => ({ ...s, width: r.width, height: r.height }))
                }}
                className="h-6 px-1.5 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
              >
                {RESOLUTIONS.map((r) => <option key={r.width} value={r.width}>{r.label}</option>)}
              </select>
            </label>

            <label className="flex items-center justify-between text-xs text-zinc-400">
              Frame rate
              <select
                value={settings.fps}
                onChange={(e) => setSettings((s) => ({ ...s, fps: Number(e.target.value) as 30 | 60 }))}
                className="h-6 px-1.5 rounded bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 outline-none"
              >
                <option value={60}>60 fps</option>
                <option value={30}>30 fps</option>
              </select>
            </label>

            <label className={`flex items-center justify-between text-xs ${audioOk ? 'text-zinc-400' : 'text-zinc-600'}`}>
              Include audio
              <input
                type="checkbox"
                checked={settings.includeAudio && audioOk}
                disabled={!audioOk}
                onChange={(e) => setSettings((s) => ({ ...s, includeAudio: e.target.checked }))}
                className="accent-indigo-500 w-3.5 h-3.5"
              />
            </label>
            {!audioOk && <p className="text-[11px] text-zinc-600 -mt-2">No AAC encoder in this browser — exporting video only.</p>}

            <label className="flex items-center justify-between gap-3 text-xs text-zinc-400">
              File name
              <input
                value={settings.fileName}
                onChange={(e) => setSettings((s) => ({ ...s, fileName: e.target.value }))}
                spellCheck={false}
                className="flex-1 min-w-0 h-6 px-1.5 rounded bg-zinc-900 text-xs text-zinc-200 border border-zinc-700 outline-none focus:border-zinc-500"
              />
            </label>

            <button
              onClick={() => void start()}
              disabled={!settings.fileName.trim()}
              className="mt-1 h-8 rounded bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-xs font-semibold transition-colors"
            >
              Export
            </button>
          </div>
        )}

        {phase.kind === 'running' && <RunningView phase={phase} fps={settings.fps} onCancel={() => abortRef.current?.abort()} />}

        {phase.kind === 'done' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-zinc-300">Saved <span className="font-mono text-zinc-100">{phase.fileName}.mp4</span> to your downloads.</p>
            <button onClick={onClose} className="h-8 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors">Close</button>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-red-400 break-words">Export failed: {phase.message}</p>
            <button onClick={() => setPhase({ kind: 'settings' })} className="h-8 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition-colors">Back</button>
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
      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full bg-indigo-500 transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex justify-between text-[11px] text-zinc-500 font-mono tabular-nums">
        <span>{phase.frame} / {phase.total} frames</span>
        <span>
          {speed > 0 ? `${speed.toFixed(1)}× realtime` : '…'}
          {remaining != null && ` · ~${Math.max(1, Math.round(remaining))}s left`}
        </span>
      </div>
      <button onClick={onCancel} className="h-8 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold transition-colors">Cancel</button>
    </div>
  )
}
