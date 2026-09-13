import { Raycaster, Vector2, type Camera, type Scene } from 'three'
import { getCompositionLayers, getMountedRenderScenes } from './VisualEngine'
import { layersUnderPoint, type HitPass } from './hoverPickCore'
import { pickHoverTarget } from './hoverTargets'

export type PreviewHit = { trackId: string; sceneId: string } | null
const raycaster = new Raycaster(), ndc = new Vector2()
raycaster.params.Points.threshold = .12
raycaster.params.Line.threshold = .06
function passOf(scene: Scene | null): HitPass | undefined {
  for (const [key, mounted] of getMountedRenderScenes()) {
    if (mounted !== scene) continue
    const pass = key.slice(key.lastIndexOf(':') + 1)
    return pass === 'front' || pass === 'invert' ? pass : 'base'
  }
}
/** Both renderers raycast their own mounted objects and the same layer mapping. */
export function pickRenderedTrack(camera: Camera, nx: number, ny: number): PreviewHit {
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  for (const layer of layersUnderPoint(getCompositionLayers(), nx, ny)) {
    ndc.set(layer.ndcX, layer.ndcY)
    raycaster.setFromCamera(ndc, camera)
    const hit = pickHoverTarget(raycaster, layer.sceneId, passOf)
    if (hit) return { trackId: hit.trackId, sceneId: layer.sceneId }
  }
  return null
}
