import type { CompositionLayer } from '../directors'

/** Every scene a composition layer needs rendered (and its instruments run) this
 *  frame: its own, the scene it crossfades with, and any scenes its shader
 *  samples (LayerShader.scenes - a code composition reading two live scenes). */
export function layerSceneIds(layer: CompositionLayer): string[] {
  const ids = [layer.sceneId]
  if (layer.crossfade) ids.push(layer.crossfade.sceneId)
  if (layer.shader?.scenes) ids.push(...Object.values(layer.shader.scenes))
  return ids
}
