import { flattenTrackNotesMemo } from '../../core/visual/noteFlatten'
import { orderedSceneBindings } from '../../core/directors/sceneBindings'
import { sceneRowColor } from '../../core/directors/sceneRowColor'
import type {
  CompositionInstrumentDef, CompositionLayer, LayerShader,
} from '../../core/directors/types'
import { FULL_FRAME } from '../../core/directors/types'
import type { MidiRowDef } from '../types'
import { toMidiRows, toParamDefs } from './params'
import { ColorCache, makeMusicCtx, specDefaults } from './musicCtx'
import { reportCodeError } from './errors'
import { world } from './world'
import type { Look } from '../../core/visual/look'
import type { MusicCtx, ParamSpecs, RowSpecs } from './types'

// Code compositions: the Composite (Main) scene's layer list, written as code.
// This is where a transition stops being a preset and becomes choreography -
// resolve() sees the beat, its own MIDI, and the scenes bound to its rows, and
// returns exactly the layers to draw this instant, each optionally with its own
// fragment shader (zoom-through portals, slit-scans, iris wipes, kaleidoscopic
// cross-dissolves, whatever the song needs).
//
// React-free on purpose: core/directors (and through it ProjectStore) imports
// the generated registry of these.

export interface BoundScene {
  sceneId: string
  name: string
  /** The MIDI row (pitch) that selects it. */
  pitch: number
  /** Row order, top row = 0. */
  index: number
}

export interface CompositionCtx extends MusicCtx {
  trackId: string
  /** Every visual scene with its row, top row first. */
  scenes: BoundScene[]
  /** The scene bound to a row. */
  scene(pitch: number): BoundScene | undefined
  /** A scene by (case-insensitive) name. */
  sceneNamed(name: string): BoundScene | undefined
  /** The scene rows' notes only (what "a scene note" means for switch logic). */
  sceneNotes: MusicCtx['notes']
  /** A layer for a scene; full-frame and opaque unless told otherwise. */
  layer(sceneId: string, opts?: Partial<Omit<CompositionLayer, 'sceneId' | 'directorTrackId'>>): CompositionLayer
  /** A layer drawn through a fragment shader (see LayerShader for its inputs).
   *  `shader.scenes` samples more scenes: { tNext: nextSceneId } → uniform sampler2D tNext. */
  shaded(sceneId: string, shader: LayerShader, opts?: Partial<Omit<CompositionLayer, 'sceneId' | 'directorTrackId' | 'shader'>>): CompositionLayer
  /** Set the frame's look (grade + bloom) - wins over instruments' looks. */
  look(look: Look): void
}

export interface CodeCompositionSpec {
  /** '<pack>.<name>', persisted as the track's instrumentId. */
  id: string
  name: string
  description?: string
  params?: ParamSpecs
  /** Extra trigger rows beside the scene rows. Scene rows start at pitch 60 and
   *  count up, so put triggers below 60 (e.g. 36-59). */
  rows?: RowSpecs
  /** One row per visual scene (default true). */
  sceneRows?: boolean
  resolve(ctx: CompositionCtx): CompositionLayer[]
}

export interface CodeCompositionDef extends CompositionInstrumentDef {
  code: CodeCompositionSpec
}

const colorCaches = new Map<string, ColorCache>()

export function defineComposition(spec: CodeCompositionSpec): CodeCompositionDef {
  const defaults = specDefaults(spec.params)
  const extraRows = toMidiRows(spec.rows) ?? []
  const withScenes = spec.sceneRows !== false
  return {
    id: spec.id,
    name: spec.name,
    params: toParamDefs(spec.params),
    mainOnly: true,
    panelSummary: spec.description,
    midiRows: (track, scenes, sceneOrder) => {
      const rows: MidiRowDef[] = []
      if (withScenes) {
        const bindings = orderedSceneBindings(track, scenes, sceneOrder)
        bindings.slice().sort((a, b) => b.pitch - a.pitch).forEach((b, i) => {
          rows.push({
            pitch: b.pitch,
            label: scenes[b.sceneId]?.name ?? 'Missing scene',
            color: sceneRowColor(scenes[b.sceneId], `hsl(${(i * 67) % 360}, 65%, 58%)`),
            emphasized: i === 0,
          })
        })
      }
      return [...rows, ...extraRows].sort((a, b) => b.pitch - a.pitch)
    },
    resolve: (track, context) => {
      const secPerBeat = context.secPerBeat ?? 0.5
      const notes = flattenTrackNotesMemo(track, context.beatsPerBar, context.totalBars)
      const bindings = orderedSceneBindings(track, context.scenes, context.sceneOrder)
      const scenes: BoundScene[] = bindings
        .slice()
        .sort((a, b) => b.pitch - a.pitch)
        .map((b, index) => ({ sceneId: b.sceneId, pitch: b.pitch, index, name: context.scenes[b.sceneId]?.name ?? '' }))
      const byPitch = new Map(scenes.map((s) => [s.pitch, s]))
      let colors = colorCaches.get(track.id)
      if (!colors) colorCaches.set(track.id, colors = new ColorCache())
      const music = makeMusicCtx({
        beat: context.beat, secPerBeat, beatsPerBar: context.beatsPerBar,
        params: track.params, stringParams: track.stringParams, notes,
      }, defaults, colors)
      const base = (sceneId: string, opts?: Partial<CompositionLayer>): CompositionLayer => ({
        directorTrackId: track.id, sceneId, opacity: 1, viewport: { ...FULL_FRAME }, ...opts,
      })
      const ctx: CompositionCtx = {
        ...music,
        trackId: track.id,
        scenes,
        scene: (pitch) => byPitch.get(pitch),
        sceneNamed: (name) => scenes.find((s) => s.name.toLowerCase() === name.toLowerCase()),
        sceneNotes: notes.filter((n) => byPitch.has(n.pitch)),
        layer: (sceneId, opts) => base(sceneId, opts),
        shaded: (sceneId, shader, opts) => base(sceneId, { ...opts, shader }),
        look: (l) => world().setCompositionLook(l),
      }
      const exists = (sid: string) => !!context.scenes[sid] && !context.scenes[sid].isMain
      try {
        return spec.resolve(ctx).filter((l) => exists(l.sceneId)).map((l) => {
          // a shader's extra scene inputs must name real visual scenes too
          if (!l.shader?.scenes) return l
          const scenes = Object.fromEntries(Object.entries(l.shader.scenes).filter(([, sid]) => exists(sid)))
          return { ...l, shader: { ...l.shader, scenes } }
        })
      } catch (err) {
        reportCodeError(spec.id, track.id, 'composition', err, context.beat)
        return []
      }
    },
    code: spec,
  }
}
