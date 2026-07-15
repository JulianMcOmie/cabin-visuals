import { useProjectStore } from '../../store/ProjectStore'
import { useTimeStore } from '../../store/TimeStore'
import { getFrameDriver } from './frameDriver'
import { runExport } from './exportEngine'
import { resolveExportRange, defaultBitrate, type ExportSettings } from './types'

// Shared logic for generating a template gallery preview clip: a short, looping
// slice of the CURRENT project's real render. Used two ways - the dev "Preview
// clip" button (downloads it) and the headless `npm run previews` script (grabs
// the bytes and uploads them). Reuses the export pipeline verbatim, so a clip is
// pixel-identical to a normal export.

// Bump when the capture settings below change (resolution, bars, fps, …): it is
// folded into each template's preview hash, so bumping it forces every clip to
// regenerate on the next `npm run previews`.
export const PREVIEW_CAPTURE_VERSION = 1

// First PREVIEW_BARS bars; loops cleanly at the templates' shared 120 bpm
// (2 bars = 8 beats = 4s). Small, no audio, no watermark.
export const PREVIEW_BARS = 2
const PREVIEW_WIDTH = 640
const PREVIEW_HEIGHT = 360

/** Resolve once the export driver is mounted AND a visual scene with tracks has
 *  hydrated - so an automated caller can navigate to a template and wait for the
 *  scene to be renderable before capturing. */
async function waitUntilRenderable(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const driverReady = getFrameDriver() != null
    const scenes = useProjectStore.getState().scenes
    const hasVisualTracks = Object.values(scenes).some((s) => !s.isMain && Object.keys(s.tracks).length > 0)
    if (driverReady && hasVisualTracks) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

/** Render the current project's first bars to a looping MP4 blob (null if the
 *  scene never became renderable or the export was aborted). */
export async function capturePreviewClip(): Promise<Blob | null> {
  if (!(await waitUntilRenderable())) return null
  const { bpm, beatsPerBar, totalBars } = useProjectStore.getState()
  const settings: ExportSettings = {
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    aspect: '16:9',
    fps: 30,
    includeAudio: false,
    videoBitrate: defaultBitrate(PREVIEW_WIDTH, 30),
    fileName: 'preview',
    watermark: false,
    rangeMode: 'custom',
    rangeFromBar: 1,
    rangeToBar: PREVIEW_BARS,
  }
  const range = resolveExportRange(settings, beatsPerBar, totalBars, useTimeStore.getState().loopRegion)
  const { blob } = await runExport(settings, { bpm, beatsPerBar, totalBars, range })
  return blob
}
