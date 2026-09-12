import type { WaveformQuery } from '../audio/waveformWindow'
import type { VideoClip } from '../../store/VideoStore'
import type { ProjectState } from '../../store/ProjectStore'
import type { useUIStore } from '../../store/UIStore'
import type { VisualEngineInstance } from './VisualEngineInstance'

export type PreviewProject = Pick<ProjectState, 'scenes' | 'sceneOrder' | 'activeSceneId' | 'bpm' | 'beatsPerBar' | 'totalBars' | 'tracks' | 'rootTrackIds'>
export interface PreviewRequest {
  id: number
  revision: number
  project?: PreviewProject
  videoClips: Record<string, VideoClip>
  beat: number
  playing: boolean
  sceneId: string | null
  width: number
  height: number
  dpr: number
  quality: ReturnType<typeof useUIStore.getState>['previewQuality']
  pick?: { id: number; nx: number; ny: number }
  canvasHover: ReturnType<typeof useUIStore.getState>['canvasHover']
  trackIds: string[]
  render: boolean
}
export interface PreviewResponse {
  id: number
  revision: number
  frame?: ReturnType<VisualEngineInstance['captureFrame']>
  pick?: { id: number; hit: { sceneId: string; trackId: string } | null }
  camera?: { world: number[]; projection: number[] }
  pixels?: ImageData
  ambient?: ImageData
  thumbnails?: { trackId: string; pixels: ImageData }[]
  error?: string
  renderError?: string
  duration: number
}

// Geometry, raster text, fonts, photos and WebCodecs video have worker paths.
// PhotoSlot sprites render in the worker; Oscilloscope requests bounded sample windows.
// Unknown instruments opt out until their visual and assets are worker-safe.
const WORKER_INSTRUMENTS = new Set([
  'glassRoll', 'photoSlot', 'oscilloscope', 'textDisplay', 'emojiDisplay', 'filmCard', 'video', 'photo', 'kaleidoSolid',
  'cube', 'bird', 'undertale', 'circle', 'triangle', 'icosahedronBurst', 'stars', 'particleBurst',
  'particle', 'particleStream', 'fractalTunnel', 'neonPolar', 'hopfFibration', 'shapeFlight',
  'dotField', 'metronomeBalls', 'cameraControl', 'cameraOrbit', 'filmStock',
  'filmGrain', 'scribble', 'pixelBlast', 'colorFilters', 'bassRipple',
  'impactWarp', 'strobe', 'laserSphere', 'laserLine', 'wormhole',
  'particleSphere', 'polyFx', 'radialBloom', 'flashWall', 'overlapShape',
  'overlapSolid', 'crop', 'midiRoll', 'starfield', 'wireframe', 'light',
])
export function canRenderInWorker(project: PreviewProject): boolean {
  return Object.values(project.scenes).every(scene => scene.isMain ||
    Object.values(scene.tracks).every(track => !track.instrumentId || WORKER_INSTRUMENTS.has(track.instrumentId)))
}

export interface PreviewMediaRequest { kind: 'media'; requestId: number; mediaKind: 'video' | 'photo'; ref: string }
export interface PreviewMediaResponse { kind: 'media'; requestId: number; source?: Blob | string; error?: string }
export interface PreviewWaveformRequest { kind: 'waveform'; requestId: number; query: WaveformQuery }
export interface PreviewWaveformResponse { kind: 'waveform'; requestId: number; samples?: Float32Array; error?: string }
export type PreviewWorkerMessage = PreviewResponse | PreviewMediaRequest | PreviewWaveformRequest | { kind: 'invalidate' }
