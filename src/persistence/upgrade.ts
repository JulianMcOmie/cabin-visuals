import type { ProjectDocument } from './types'
import { emptyDocument } from './types'
import type { Scene, Track, AudioBlock, EffectInstance, VideoPad } from '../editor/types'
import type { AudioClip } from '../editor/store/AudioStore'

// What shipped steps give scenes that predate the backgroundColor field.
// Deliberately NOT the app's DEFAULT_SCENE_BACKGROUND: these steps are frozen,
// and old projects were authored against a renderer that cleared to black -
// following the app default when it later changed (black → the Cabin accent,
// 2026-08-15) would repaint every legacy project on its next load.
const LEGACY_SCENE_BACKGROUND = '#000000'

/** Bump when the document shape changes, and append the matching step below. */
export const CURRENT_VERSION = 16

type UpgradeStep = (doc: Record<string, unknown>) => Record<string, unknown>

// vN → vN+1, keyed by N. Append-only: a shipped step is never edited, so any
// old blob can walk the chain to the current shape. Each step is pure - it
// returns a new object and never mutates its input.
const UPGRADES: Record<number, UpgradeStep> = {}

// ── v1 → v2 ──────────────────────────────────────────────────────────────────
// Three shape changes that shipped together with the audio-track feature:
//  1. audioClip (single global descriptor) → audioClips (catalog keyed by ref)
//  2. a v1 clip was hard-pinned to beat 0 - reproduce that exactly by
//     synthesizing an audio track (top of the root tracks) holding one block
//     at bar 0 trimmed to the full clip, so old saves keep sounding identical
//  3. track.visualPlugins → track.effects (the plugins/ → effects/ rename)
UPGRADES[1] = (doc) => {
  const { audioClip, ...rest } = doc as {
    audioClip?: AudioClip | null
    tracks?: Record<string, Track & { visualPlugins?: EffectInstance[] }>
    rootTrackIds?: string[]
  } & Record<string, unknown>

  // 3 · visualPlugins → effects on every track.
  let tracks: Record<string, Track> = {}
  for (const [id, t] of Object.entries(rest.tracks ?? {})) {
    const { visualPlugins, ...track } = t
    tracks[id] = visualPlugins ? ({ ...track, effects: visualPlugins } as Track) : (track as Track)
  }

  // 1 + 2 · the clip enters the catalog and becomes a bar-0 block.
  const audioClips: Record<string, AudioClip> = audioClip ? { [audioClip.ref]: audioClip } : {}
  let rootTrackIds = rest.rootTrackIds ?? []
  if (audioClip) {
    const trackId = crypto.randomUUID()
    const block: AudioBlock = {
      id: crypto.randomUUID(),
      clipRef: audioClip.ref,
      startBar: 0,
      trimStart: 0,
      trimEnd: audioClip.duration,
    }
    const audioTrack: Track = {
      id: trackId,
      name: audioClip.fileName,
      type: 'audio',
      instrumentId: '',
      color: '#38bdf8',
      muted: false,
      solo: false,
      blocks: [],
      childIds: [],
      audioBlocks: [block],
    }
    tracks = { ...tracks, [trackId]: audioTrack }
    rootTrackIds = [trackId, ...rootTrackIds]
  }

  return { ...rest, tracks, rootTrackIds, audioClips }
}

// ── v2 → v3 ──────────────────────────────────────────────────────────────────
// The dimension → mover rename: track type 'dimension' becomes 'mover' and
// dimensionId becomes moverId. Everything else on those tracks (inputValues,
// depth, envelope, midiMode, weight, opMode) is unchanged.
UPGRADES[2] = (doc) => {
  const rest = doc as { tracks?: Record<string, Track & { dimensionId?: string }> } & Record<string, unknown>
  const tracks: Record<string, Track> = {}
  for (const [id, t] of Object.entries(rest.tracks ?? {})) {
    if ((t.type as string) === 'dimension') {
      const { dimensionId, ...track } = t
      tracks[id] = { ...track, type: 'mover', moverId: dimensionId } as Track
    } else {
      tracks[id] = t as Track
    }
  }
  return { ...rest, tracks }
}

// ── v3 → v4 ──────────────────────────────────────────────────────────────────
// The Video instrument's pad model: each track's `videoRefs: string[]` (whole
// uploaded files as clips) became `videoPads: VideoPad[]` — (source ref,
// in-point) pairs. Old clips were whole-source, so each ref maps to a pad at
// in-point 0 and keeps playing identically. The videoClips source catalog is
// unchanged.
UPGRADES[3] = (doc) => {
  const rest = doc as { tracks?: Record<string, Track & { videoRefs?: string[] }> } & Record<string, unknown>
  const tracks: Record<string, Track> = {}
  for (const [id, t] of Object.entries(rest.tracks ?? {})) {
    const { videoRefs, ...track } = t
    if (videoRefs && videoRefs.length > 0) {
      const videoPads: VideoPad[] = videoRefs.map((ref) => ({ ref, inPoint: 0 }))
      tracks[id] = { ...track, videoPads } as Track
    } else {
      tracks[id] = track as Track
    }
  }
  return { ...rest, tracks }
}

// ── v4 → v5 ──────────────────────────────────────────────────────────────────
// The single global visual track forest becomes Scene 1. Main is an empty scene
// of the same shape, ready for director tracks. Audio remains project-global and
// is projected into every scene's editor view; it never participates in visual
// scene ownership or director switching.
UPGRADES[4] = (doc) => {
  const rest = doc as {
    tracks?: Record<string, Track>
    rootTrackIds?: string[]
  } & Record<string, unknown>
  const tracks = rest.tracks ?? {}
  const roots = rest.rootTrackIds ?? []
  const audioTracks: Record<string, Track> = {}
  const visualTracks: Record<string, Track> = {}
  for (const [id, track] of Object.entries(tracks)) {
    if (track.type === 'audio') audioTracks[id] = track
    else visualTracks[id] = track
  }
  const audioRootTrackIds = roots.filter((id) => audioTracks[id])
  const rootTrackIds = roots.filter((id) => visualTracks[id])
  const mainId = crypto.randomUUID()
  const firstSceneId = crypto.randomUUID()
  const scenes: Record<string, Scene> = {
    [mainId]: { id: mainId, name: 'Main', isMain: true, backgroundColor: LEGACY_SCENE_BACKGROUND, backgroundTransparent: false, tracks: {}, rootTrackIds: [] },
    [firstSceneId]: { id: firstSceneId, name: 'Scene 1', isMain: false, backgroundColor: LEGACY_SCENE_BACKGROUND, backgroundTransparent: false, tracks: visualTracks, rootTrackIds },
  }
  const project = { ...rest }
  delete project.tracks
  delete project.rootTrackIds
  return {
    ...project,
    scenes,
    sceneOrder: [mainId, firstSceneId],
    activeSceneId: firstSceneId,
    audioTracks,
    audioRootTrackIds,
  }
}

// ── v5 → v6 ──────────────────────────────────────────────────────────────────
// Scene backgrounds become an explicit scene-level parameter. Old scenes adopt
// the new black default rather than depending on a renderer-owned clear color.
UPGRADES[5] = (doc) => {
  const rest = doc as { scenes?: Record<string, Omit<Scene, 'backgroundColor'> & { backgroundColor?: string }> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(rest.scenes ?? {})) {
    scenes[id] = { ...scene, backgroundColor: scene.backgroundColor ?? LEGACY_SCENE_BACKGROUND, backgroundTransparent: false }
  }
  return { ...rest, scenes }
}

// ── v6 → v7 ──────────────────────────────────────────────────────────────────
// Event modifiers were retired. Remove their tracks while promoting any nested
// children to the nearest surviving parent, so unrelated user tracks are kept.
UPGRADES[6] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const modifierTypes = new Set(['add', 'mute', 'suppress', 'override'])
  const scenes: Record<string, Scene> = {}

  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const removed = new Set(Object.values(scene.tracks)
      .filter((track) => modifierTypes.has(track.type as string))
      .map((track) => track.id))
    const promote = (trackId: string, seen = new Set<string>()): string[] => {
      if (seen.has(trackId)) return []
      if (!removed.has(trackId)) return [trackId]
      seen.add(trackId)
      return (scene.tracks[trackId]?.childIds ?? []).flatMap((childId) => promote(childId, seen))
    }

    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      if (removed.has(trackId)) continue
      let parentId = track.parentId
      while (parentId && removed.has(parentId)) parentId = scene.tracks[parentId]?.parentId
      const { parentId: _oldParentId, ...trackWithoutParent } = track
      void _oldParentId
      tracks[trackId] = {
        ...trackWithoutParent,
        ...(parentId ? { parentId } : {}),
        childIds: track.childIds.flatMap((childId) => promote(childId)),
      }
    }
    scenes[sceneId] = {
      ...scene,
      tracks,
      rootTrackIds: scene.rootTrackIds.flatMap((trackId) => promote(trackId)),
    }
  }

  return { ...rest, scenes }
}

// ── v7 → v8 ──────────────────────────────────────────────────────────────────
// Scene render targets may now preserve a transparent background. Existing
// projects stay visually identical by remaining opaque.
UPGRADES[7] = (doc) => {
  const rest = doc as { scenes?: Record<string, Omit<Scene, 'backgroundTransparent'> & { backgroundTransparent?: boolean }> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(rest.scenes ?? {})) {
    scenes[id] = { ...scene, backgroundTransparent: scene.backgroundTransparent ?? false }
  }
  return { ...rest, scenes }
}

// ── v8 → v9 ──────────────────────────────────────────────────────────────────
// Cube/Circle/Triangle used to expose Base Color as a numeric 0–360 hue. Store
// the equivalent concrete color so the editor can use a native color picker.
UPGRADES[8] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const shapeIds = new Set(['cube', 'circle', 'triangle'])
  const hueToHex = (hue: number) => {
    const h = ((hue % 360) + 360) % 360
    const saturation = 0.65
    const lightness = 0.6
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const x = chroma * (1 - Math.abs((h / 60) % 2 - 1))
    const m = lightness - chroma / 2
    let r = 0, g = 0, b = 0
    if (h < 60) { r = chroma; g = x } else if (h < 120) { r = x; g = chroma }
    else if (h < 180) { g = chroma; b = x } else if (h < 240) { g = x; b = chroma }
    else if (h < 300) { r = x; b = chroma } else { r = chroma; b = x }
    const hex = (value: number) => Math.round((value + m) * 255).toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  }
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      if (!shapeIds.has(track.instrumentId) || track.stringParams?.baseColor) {
        tracks[trackId] = track
        continue
      }
      const { baseHue, ...params } = track.params ?? {}
      tracks[trackId] = {
        ...(track as unknown as Track),
        params,
        stringParams: {
          ...track.stringParams,
          baseColor: hueToHex(baseHue ?? 240),
        },
      }
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v9 → v10 ─────────────────────────────────────────────────────────────────
// World-space instruments' transform params move to the canonical track
// transform keys (src/editor/core/transform.ts): position → tfX/tfY/tfZ and
// size → tfSize (a multiplier of the instrument's natural size, so world sizes
// divide by the 1.6 reference). Automation/envelope children retarget with
// their parent. See docs/track-transform-panel.md.
const TRANSFORM_KEY_MIGRATIONS: Record<string, Record<string, { to: string; scale?: number }>> = {
  cube: {
    baseXPosition: { to: 'tfX' },
    baseYPosition: { to: 'tfY' },
    baseZPosition: { to: 'tfZ' },
    baseSize: { to: 'tfSize', scale: 1 / 1.6 },
  },
  circle: {
    baseXPosition: { to: 'tfX' },
    baseYPosition: { to: 'tfY' },
    baseZPosition: { to: 'tfZ' },
    baseSize: { to: 'tfSize', scale: 1 / 1.6 },
  },
  triangle: {
    baseXPosition: { to: 'tfX' },
    baseYPosition: { to: 'tfY' },
    baseZPosition: { to: 'tfZ' },
    baseSize: { to: 'tfSize', scale: 1 / 1.6 },
  },
  // laserSphere keeps its own `size` param (the bespoke panel's SIZE knob binds
  // to it - see LaserSphereUserInterface), so only its position migrates.
  laserSphere: { x: { to: 'tfX' }, y: { to: 'tfY' }, z: { to: 'tfZ' } },
  laserLine: { x: { to: 'tfX' }, y: { to: 'tfY' }, z: { to: 'tfZ' } },
  particleSphere: { x: { to: 'tfX' }, y: { to: 'tfY' }, z: { to: 'tfZ' }, size: { to: 'tfSize', scale: 1 / 1.6 } },
}

/** Rename one track's params through an instrument's migration map. Exported for
 *  the template builder, which constructs tracks without passing through the
 *  document upgrade chain. */
export function migrateTransformParams(
  instrumentId: string,
  params: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const map = TRANSFORM_KEY_MIGRATIONS[instrumentId]
  if (!map || !params) return params
  let changed = false
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(params)) {
    const m = map[key]
    if (m) {
      out[m.to] = m.scale !== undefined ? value * m.scale : value
      changed = true
    } else {
      out[key] = value
    }
  }
  return changed ? out : params
}

UPGRADES[9] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      let next = track
      const params = migrateTransformParams(track.instrumentId, track.params)
      if (params !== track.params) next = { ...next, params }
      // Automation/envelope children target the parent's params by key.
      if ((track.type === 'automation' || track.type === 'envelope') && track.targetParam && track.parentId) {
        const parent = scene.tracks[track.parentId]
        const m = parent ? TRANSFORM_KEY_MIGRATIONS[parent.instrumentId]?.[track.targetParam] : undefined
        if (m) next = { ...next, targetParam: m.to }
      }
      tracks[trackId] = next
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v10 → v11 ────────────────────────────────────────────────────────────────
// The Oscilloscope stopped being a fixed full-frame instrument and became a real
// object in the scene (a positioned, depth-sorted, billboarding panel), with the
// old viewport-pinned overlay kept as its "Fit to screen" placement mode. New
// scopes default to In scene; every scope that already exists was authored
// against the pinned look, so it is pinned explicitly here. `fitToScreen` also
// decides the on-top pass (isOnTopTrack), so this one param restores the whole
// of the previous behaviour - nothing already made changes.
UPGRADES[10] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      tracks[trackId] = track.instrumentId === 'oscilloscope'
        ? { ...track, params: { ...track.params, fitToScreen: 1 } }
        : track
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v11 → v12 ────────────────────────────────────────────────────────────────
// Directors de-specialized: a director is now an ordinary base track whose
// instrumentId names a composition instrument (core/directors). The former
// directorId moves into instrumentId; sceneBindings, params, blocks and child
// automation lanes carry over untouched (their targetParam keys - opacity +
// the def's params - are unchanged). Directors only ever lived in scenes
// (never audioTracks), and a directorId-less director track can only be the
// pre-first-UI Scene Switcher, so that is the fallback id.
UPGRADES[11] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      if ((track.type as string) !== 'director') {
        tracks[trackId] = track
        continue
      }
      const { directorId, ...kept } = track as Track & { directorId?: string }
      tracks[trackId] = { ...kept, type: 'base', instrumentId: directorId ?? 'sceneSwitcher' }
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v12 → v13 ────────────────────────────────────────────────────────────────
// The mover consolidation: the six single-behavior motion movers collapse into
// the one `mover` definition, whose `motion` (0 translate / 1 rotate / 2 orbit)
// and `mode` (0 burst / 1 constant / 2 oscillate) selects pick the cell. Every
// cell delegates to the same evaluators the old definitions used (parity is
// pinned in core/visualCopies/mover.test.ts), and all six spoke the same
// 60-65 (+66 Return) pitches, so notes carry over untouched. The only stored
// values whose KEYS change are Constant Rotate/Orbit's per-axis rates
// (speedX/Y/Z, speed → angleX/Y/Z, angle - same units, °/beat, same ranges);
// automation and envelope child lanes targeting those params retarget with
// their parent, exactly as UPGRADES[9] did for the transform keys.
const MOVER_CONSOLIDATION: Record<string, { motion: number; mode: number; renames?: Record<string, string> }> = {
  burst: { motion: 0, mode: 0 },
  rotateBurst: { motion: 1, mode: 0 },
  orbitBurst: { motion: 2, mode: 0 },
  constantRotate: { motion: 1, mode: 1, renames: { speedX: 'angleX', speedY: 'angleY', speedZ: 'angleZ', speed: 'angle' } },
  constantOrbit: { motion: 2, mode: 1, renames: { speedX: 'angleX', speedY: 'angleY', speedZ: 'angleZ', speed: 'angle' } },
  translationOscillator: { motion: 0, mode: 2 },
}

UPGRADES[12] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      const migration = track.type === 'mover' && track.moverId ? MOVER_CONSOLIDATION[track.moverId] : undefined
      if (migration) {
        const inputValues: Record<string, number> = { motion: migration.motion, mode: migration.mode }
        for (const [key, value] of Object.entries(track.inputValues ?? {})) {
          inputValues[migration.renames?.[key] ?? key] = value
        }
        tracks[trackId] = { ...track, moverId: 'mover', inputValues }
        continue
      }
      // Child lanes keyed to a renamed parent param follow the rename.
      if ((track.type === 'automation' || track.type === 'envelope') && track.targetParam && track.parentId) {
        const parent = scene.tracks[track.parentId]
        const renamed = parent?.type === 'mover' && parent.moverId
          ? MOVER_CONSOLIDATION[parent.moverId]?.renames?.[track.targetParam]
          : undefined
        if (renamed) {
          tracks[trackId] = { ...track, targetParam: renamed }
          continue
        }
      }
      tracks[trackId] = track
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v13 → v14 ────────────────────────────────────────────────────────────────
// The 3D Shape grew a FINISH param whose default is the new Matte poster look.
// Tracks saved before the param existed were authored against the physical
// material, so they get pinned to Gloss (finish = 1) explicitly - the new
// default only applies to tracks created after this shipped.
UPGRADES[13] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    for (const [trackId, track] of Object.entries(scene.tracks)) {
      tracks[trackId] = track.type === 'base' && track.instrumentId === 'cube' && track.params?.finish === undefined
        ? { ...track, params: { ...track.params, finish: 1 } }
        : track
    }
    scenes[sceneId] = { ...scene, tracks }
  }
  return { ...rest, scenes }
}

// ── v14 → v15 ────────────────────────────────────────────────────────────────
// The Text Display clips redesign: the instrument no longer holds text. Words
// move from the `text` string param onto `lyricClips` (one whole-song clip -
// old projects had one global word stream, so one clip reproduces it exactly);
// note pitch becomes the STYLE lane (48 "next word" → 58, the PLAIN lane at
// STYLE_PITCH_TOP - 2), and the 60-72 height band retires (those pitches are
// lanes now). The old font/color params seed the PLAIN lane so the words keep
// their authored look. `wordFormation` child lanes retire too: the nearest
// clip layout replaces the first lane's geometry (grid/circle/stack) and the
// tracks are dropped. Constants are inlined - an upgrade step is frozen and
// must not chase the live modules.
UPGRADES[14] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene>; totalBars?: number; beatsPerBar?: number } & Record<string, unknown>
  const songBeats = Math.max(1, (rest.totalBars ?? 32) * (rest.beatsPerBar ?? 4)) + 64

  // The old sheet grammar, tokenized WITHOUT flattening: `!...!` runs stay one
  // token (re-wrapped), and `FOO|LIN` syllable words stay one token - clip
  // entries re-expand both, so note-per-syllable timing survives verbatim.
  const tokenize = (text: string, byLine: boolean): string[] => {
    if (byLine) {
      return text.split(/\r?\n/)
        .map((l) => l.replace(/[|!]+/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((l) => (/\s/.test(l) ? `!${l}!` : l))
    }
    const out: string[] = []
    const parts = text.split('!')
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i].trim()
      if (!seg) continue
      if (i % 2 === 1) out.push(`!${seg}!`)
      else out.push(...seg.split(/\s+/))
    }
    return out
  }

  // Pre-v15 track shapes still carry the retired 'wordFormation' type string.
  type RawTrack = Omit<Track, 'type'> & { type: string; inputValues?: Record<string, number> }

  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    const tracks: Record<string, Track> = {}
    const dropped = new Set<string>()
    // First pass: convert every Text Display track, remembering which
    // formation children die with it.
    for (const [trackId, raw] of Object.entries(scene.tracks)) {
      const track = raw as RawTrack
      if (track.type !== 'base' || track.instrumentId !== 'textDisplay') continue

      const params = { ...track.params }
      const stringParams = { ...track.stringParams }
      const text = stringParams.text ?? 'HELLO'
      const byLine = (params.advanceUnit ?? 0) >= 0.5
      const words = tokenize(text, byLine)

      // Layout: the old Layout param, unless a formation child says otherwise
      // (formations were presence-driven geometry - grid and ring map onto the
      // clip layouts; anything else reads closest as a paragraph card).
      const layoutMode = Math.round(params.layoutMode ?? 0)
      let layout: { kind: 'one' | 'row' | 'stack' | 'scatter' | 'grid' | 'circle'; cols?: number } =
        layoutMode === 1 ? { kind: 'scatter' } : layoutMode === 2 ? { kind: 'stack' } : { kind: 'one' }
      let tookFormationLayout = false
      for (const cid of track.childIds ?? []) {
        const child = scene.tracks[cid] as RawTrack | undefined
        if (!child || child.type !== 'wordFormation') continue
        if (!tookFormationLayout) {
          tookFormationLayout = true
          const iv = child.inputValues ?? {}
          const cols = Math.max(1, Math.round(iv.columns ?? 2))
          const rows = Math.max(1, Math.round(iv.rows ?? 2))
          if ((iv.columnsRing ?? 0) >= 0.5 || (iv.rowsRing ?? 0) >= 0.5) layout = { kind: 'circle' }
          else if (cols > 1 && rows > 1) layout = { kind: 'grid', cols }
          else layout = { kind: 'stack' }
        }
        dropped.add(cid)
      }

      // Revoice the notes: 48 → 58 (PLAIN), height band 60-72 dropped.
      const blocks = track.blocks.map((b) => ({
        ...b,
        notes: b.notes
          .filter((n) => !(n.pitch >= 60 && n.pitch <= 72))
          .map((n) => (n.pitch === 48 ? { ...n, pitch: 58 } : n)),
      }))

      // PLAIN inherits the authored look; the other lanes ship the defaults
      // (inlined - the live defaults may drift, this step may not).
      const styleLanes = [
        { name: 'TITLE', font: 0, color: '#facc15', size: 1.9 },
        { name: 'ACCENT', font: 6, color: '#f472b6', size: 1.35 },
        { name: 'PLAIN', font: Math.max(0, Math.round(params.font ?? 0)), color: stringParams.color || '#ffffff', size: 1 },
        { name: 'WHISPER', font: 1, color: '#9aa1ab', size: 0.65 },
        { name: 'GLITCH', font: 2, color: '#38bdf8', size: 1, fx: ['shake' as const] },
      ]

      delete params.layoutMode
      delete params.phraseGap
      delete params.stackMaxWords
      delete params.advanceUnit
      delete params.font
      delete params.heightAmount
      delete stringParams.text
      delete stringParams.color

      tracks[trackId] = {
        ...(track as unknown as Track),
        params,
        stringParams,
        blocks,
        styleLanes,
        lyricClips: [{
          id: crypto.randomUUID(),
          startBeat: 0,
          durationBeats: songBeats,
          words,
          layout,
        }],
      }
    }
    // Second pass: copy everything else, dropping the dead formation lanes and
    // any orphaned ones on non-text parents.
    for (const [trackId, raw] of Object.entries(scene.tracks)) {
      const track = raw as RawTrack
      if (tracks[trackId]) continue
      if (track.type === 'wordFormation') { dropped.add(trackId); continue }
      tracks[trackId] = track as unknown as Track
    }
    if (dropped.size > 0) {
      for (const [trackId, t] of Object.entries(tracks)) {
        if (t.childIds?.some((cid) => dropped.has(cid))) {
          tracks[trackId] = { ...t, childIds: t.childIds.filter((cid) => !dropped.has(cid)) }
        }
      }
    }
    scenes[sceneId] = {
      ...scene,
      tracks,
      rootTrackIds: scene.rootTrackIds.filter((id) => !dropped.has(id)),
    }
  }
  return { ...rest, scenes }
}

// ── v15 → v16 ────────────────────────────────────────────────────────────────
// The Main scene is called "Composite" now - the name says what it does (it
// composes the other scenes into the final frame) instead of leaning on the
// user already knowing what "Main" means. isMain scenes were never
// user-renamable, so renaming unconditionally loses nothing anyone typed.
UPGRADES[15] = (doc) => {
  const rest = doc as { scenes?: Record<string, Scene> } & Record<string, unknown>
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(rest.scenes ?? {})) {
    scenes[sceneId] = scene.isMain ? { ...scene, name: 'Composite' } : scene
  }
  return { ...rest, scenes }
}

/**
 * Bring a raw blob (any past version) up to the current document shape.
 * The rest of the app only ever sees CURRENT_VERSION documents.
 */
export function upgradeDocument(raw: unknown): ProjectDocument {
  // Not a document at all (null, pre-versioned, corrupt) → start fresh rather
  // than crash the editor on open.
  if (raw === null || typeof raw !== 'object') return emptyDocument()
  let doc = raw as Record<string, unknown>
  if (typeof doc.schemaVersion !== 'number') return emptyDocument()

  while ((doc.schemaVersion as number) < CURRENT_VERSION) {
    const step = UPGRADES[doc.schemaVersion as number]
    if (!step) throw new Error(`No upgrade step from document version ${doc.schemaVersion}`)
    doc = { ...step(doc), schemaVersion: (doc.schemaVersion as number) + 1 }
  }
  return doc as unknown as ProjectDocument
}
