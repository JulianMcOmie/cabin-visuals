'use client';

import { useState, useRef, useCallback } from 'react';
import { useUIStore } from '@daw/stores/uiStore';
import { useProjectStore } from '@daw/stores/projectStore';
import { exportVideo } from '@daw/core/exportEngine';

const RESOLUTIONS = [
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
  { label: '4K', width: 3840, height: 2160 },
] as const;

const FPS_OPTIONS = [30, 60] as const;

export function ExportModal() {
  const showModal = useUIStore((s) => s.showExportModal);
  const setShowModal = useUIStore((s) => s.setShowExportModal);
  const isExporting = useUIStore((s) => s.isExporting);
  const exportProgress = useUIStore((s) => s.exportProgress);
  const setIsExporting = useUIStore((s) => s.setIsExporting);
  const setExportProgress = useUIStore((s) => s.setExportProgress);
  const project = useProjectStore((s) => s.project);

  const [resolution, setResolution] = useState(1); // Default: 1080p
  const [fpsIndex, setFpsIndex] = useState(0); // Default: 30fps
  const [statusText, setStatusText] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleExport = useCallback(async () => {
    const res = RESOLUTIONS[resolution];
    const fps = FPS_OPTIONS[fpsIndex];

    const abortController = new AbortController();
    abortRef.current = abortController;

    setIsExporting(true);
    setExportProgress(0);
    setStatusText('Starting export...');

    try {
      const blob = await exportVideo({
        project,
        fps,
        width: res.width,
        height: res.height,
        onProgress: (phase, progress) => {
          setStatusText(phase);
          setExportProgress(progress);
        },
        abortSignal: abortController.signal,
      });

      // Auto-download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'export'}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusText('Export complete!');
      setTimeout(() => {
        setShowModal(false);
        setIsExporting(false);
        setExportProgress(0);
        setStatusText('');
      }, 1500);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setStatusText('Export cancelled');
      } else {
        console.error('Export failed:', err);
        setStatusText(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
      setIsExporting(false);
      setExportProgress(0);
    } finally {
      abortRef.current = null;
    }
  }, [project, resolution, fpsIndex, setIsExporting, setExportProgress, setShowModal]);

  const handleCancel = useCallback(() => {
    if (isExporting && abortRef.current) {
      abortRef.current.abort();
    } else {
      setShowModal(false);
    }
  }, [isExporting, setShowModal]);

  if (!showModal) return null;

  const totalBeats = project.totalBars * project.beatsPerBar;
  const durationSec = totalBeats * (60 / project.bpm);
  const res = RESOLUTIONS[resolution];
  const fps = FPS_OPTIONS[fpsIndex];
  const totalFrames = Math.ceil(durationSec * fps);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget && !isExporting) setShowModal(false); }}
    >
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-[420px] p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Export Video</h2>

        {/* Resolution */}
        <div className="mb-4">
          <label className="text-sm text-muted-foreground mb-1.5 block">Resolution</label>
          <div className="flex gap-2">
            {RESOLUTIONS.map((r, i) => (
              <button
                key={r.label}
                disabled={isExporting}
                onClick={() => setResolution(i)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  resolution === i
                    ? 'bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from border border-accent-from/30'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                }`}
              >
                {r.label}
                <span className="block text-xs opacity-60">{r.width}x{r.height}</span>
              </button>
            ))}
          </div>
        </div>

        {/* FPS */}
        <div className="mb-4">
          <label className="text-sm text-muted-foreground mb-1.5 block">Frame Rate</label>
          <div className="flex gap-2">
            {FPS_OPTIONS.map((f, i) => (
              <button
                key={f}
                disabled={isExporting}
                onClick={() => setFpsIndex(i)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  fpsIndex === i
                    ? 'bg-gradient-to-r from-accent-from/20 to-accent-to/20 text-accent-from border border-accent-from/30'
                    : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                }`}
              >
                {f} fps
              </button>
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="mb-4 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <div className="flex justify-between">
            <span>Duration</span>
            <span className="text-foreground">{durationSec.toFixed(1)}s</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Total frames</span>
            <span className="text-foreground">{totalFrames.toLocaleString()}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Output</span>
            <span className="text-foreground">{res.width}x{res.height} @ {fps}fps</span>
          </div>
        </div>

        {/* Progress */}
        {isExporting && (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-muted-foreground">{statusText}</span>
              <span className="text-foreground font-mono">{Math.round(exportProgress * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-from to-accent-to rounded-full transition-[width] duration-200"
                style={{ width: `${exportProgress * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Status text when not exporting */}
        {!isExporting && statusText && (
          <div className="mb-4 text-sm text-muted-foreground">{statusText}</div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded-lg text-sm bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
          >
            {isExporting ? 'Cancel' : 'Close'}
          </button>
          {!isExporting && (
            <button
              onClick={handleExport}
              className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-accent-from to-accent-to text-white font-medium hover:opacity-90 transition-opacity"
            >
              Export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
