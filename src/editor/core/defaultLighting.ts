import type { Scene, Track } from '../types'

// The default light rig as TRACKS: every visual scene is born with a
// "Lighting" group of five Light-instrument tracks wearing the exact values of
// the old hardcoded rig in VisualScene.tsx, so a fresh scene looks pixel-
// identical to before - but the lights are now visible rows you can move,
// automate, re-color or delete. Persistence UPGRADES[17] gives existing saves
// the same group (with its own frozen copy of these values - a shipped
// upgrade step must not chase this module).
//
// Positions live in the canonical tf* transform params; the old JSX rig's
// rectAreaLight rotation was radians, tfRot* is degrees (same XYZ Euler
// order), hence the ±35.52. `bulb: 0` keeps the default rig invisible in the
// frame - user-added lights default the bulb ON instead.

interface SeedLight {
  name: string
  color: string
  params: Record<string, number>
  stringParams?: Record<string, string>
}

const SEED_LIGHTS: SeedLight[] = [
  {
    // <ambientLight intensity={0.12}> + <hemisphereLight #dbeafe/#170921 0.55>
    name: 'Ambience',
    color: '#93c5fd',
    params: { type: 3, intensity: 0.55, flat: 0.12, bulb: 0 },
    stringParams: { color: '#dbeafe', groundColor: '#170921' },
  },
  {
    // The shadow-casting key: <directionalLight [4,7,5] intensity 2.4>
    name: 'Key Light',
    color: '#fde68a',
    params: { type: 2, intensity: 2.4, castShadow: 1, bulb: 0, tfX: 4, tfY: 7, tfZ: 5 },
    stringParams: { color: '#ffffff' },
  },
  {
    // <rectAreaLight [4,4,5] rot [-0.62, 0.62, 0]rad #fff7ed intensity 6, 5x5>
    name: 'Fill Panel',
    color: '#fed7aa',
    params: {
      type: 4, intensity: 6, width: 5, height: 5, bulb: 0,
      tfX: 4, tfY: 4, tfZ: 5, tfRotX: -35.52, tfRotY: 35.52,
    },
    stringParams: { color: '#fff7ed' },
  },
  {
    // <pointLight [-4,2,-3] #60a5fa intensity 7 distance 20 decay 2>
    name: 'Cool Fill',
    color: '#60a5fa',
    params: { type: 0, intensity: 7, distance: 20, decay: 2, bulb: 0, tfX: -4, tfY: 2, tfZ: -3 },
    stringParams: { color: '#60a5fa' },
  },
  {
    // <pointLight [3,-1,3] #fb7185 intensity 3.5 distance 16 decay 2>
    name: 'Warm Rim',
    color: '#fb7185',
    params: { type: 0, intensity: 3.5, distance: 16, decay: 2, bulb: 0, tfX: 3, tfY: -1, tfZ: 3 },
    stringParams: { color: '#fb7185' },
  },
]

/** The seeded rig: a "Lighting" group plus its five light tracks, fresh ids
 *  every call. Splice `rootId` into the scene's roots and merge `tracks`. */
export function defaultLightingTracks(): { tracks: Record<string, Track>; rootId: string } {
  const groupId = crypto.randomUUID()
  const tracks: Record<string, Track> = {}
  const childIds: string[] = []
  for (const seed of SEED_LIGHTS) {
    const id = crypto.randomUUID()
    childIds.push(id)
    tracks[id] = {
      id,
      name: seed.name,
      type: 'base',
      instrumentId: 'light',
      params: { ...seed.params },
      stringParams: seed.stringParams ? { ...seed.stringParams } : undefined,
      color: seed.color,
      muted: false,
      solo: false,
      blocks: [],
      parentId: groupId,
      childIds: [],
    }
  }
  tracks[groupId] = {
    id: groupId,
    name: 'Lighting',
    type: 'group',
    instrumentId: '',
    color: '#eab308',
    muted: false,
    solo: false,
    blocks: [],
    childIds,
  }
  return { tracks, rootId: groupId }
}

/** True for a track that belongs to the (possibly renamed) lighting rig: a
 *  light itself, or a group holding only lights. The timeline's empty-scene
 *  helper treats a scene wearing nothing else as still empty. */
export function isLightingOnlyTrack(track: Track | undefined, tracks: Record<string, Track>): boolean {
  if (!track) return false
  if (track.type === 'base' && track.instrumentId === 'light') return true
  return track.type === 'group'
    && track.childIds.length > 0
    && track.childIds.every((id) => isLightingOnlyTrack(tracks[id], tracks))
}
