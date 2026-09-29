# src/editor/instruments/custom — code instruments (one file each, no ceremony)

A code instrument is ONE file in `custom/<pack>/<name>.ts` that exports
`instrument = defineInstrument({...})` (or `composition = defineComposition({...})`).
That's the whole integration:
- `scripts/code-instruments.cjs` (run by `next.config.ts`, watching this folder
  in dev; `./cabin instruments` by hand) regenerates `instruments.generated.ts` /
  `compositions.generated.ts`;
- `code/register.tsx` registers them (library **Code** folder per pack, the piano
  roll's `rows`, an auto console panel from `params`, the `code` glyph);
- **saving the file swaps the new code in live** on the next frame - no reload,
  engine and stores untouched (`code/live.ts`; metadata edits re-resolve).

None of the object-instrument checklist in `../CLAUDE.md` applies. Packs are per
song or idea (`innuendo/`, `examples/`, `core/`). `_`-prefixed files are helpers.
Ids are `'<pack>.<name>'`, persisted in projects - **never rename a shipped id**.
Import everything from `'../../code'`. Scaffold: `./cabin instrument new
<pack>/<name> --kind strokes|particles|mesh|fullframe|post|camera|composition`.
Reference: `./cabin docs sdk` (every export, generated) / `./cabin docs api <name>`.

## The contract (code/types.ts)

```ts
export const instrument = defineInstrument<State>({
  id: 'pack.name', name: 'Name', description: 'what it looks like, what notes do', color: '#56d8ff',
  params: { radius: p.num(1.5, 0.2, 6), count: p.int(8, 1, 64), glow: p.bool(true),
            shape: p.select(['Circle', 'Square'], 0), tint: p.color('#fff'), lane: p.text('Kick') },
  rows: { 60: 'Kick', 62: { label: 'Snare', emphasized: true } },   // omit for the full piano roll
  setup(ctx) { /* build three objects once, ctx.root.add(...), ctx.own(disposable) */ return state },
  frame(ctx, state) { /* pose everything for ctx.beat - PURE, frames arrive in any order */ },
  camera(ctx, state) { return { position, target, up?, roll?, fov? } },   // optional: fly THE camera
  look(ctx, state) { return { bloom, exposure, aberration, … } },         // optional: grade the frame
  post: { fragment, uniforms, update(ctx, u) { … return false to skip } }, // optional scene pass
  panel: 'auto',                    // default; or a console PanelSpec, or false for the plain list
  dispose(state) {},
})
```

- **Pure function of the beat.** The directory's ESLint bans (`Math.random`,
  `Date.now`, `performance.now`, `useFrame`, direct `.opacity` writes) apply.
  Randomness: `ctx.rand(...seed)`, `hash(...)`, `rng(seed)` - seed from stable
  facts (`h.index`, `h.pitch`), never a frame counter. Whole-song integration is
  fine if CACHED BY THE NOTE STREAM'S IDENTITY (`WeakMap<readonly ResolvedNote[],
  …>` - stable per resolve; `innuendo/pen.ts`). Never accumulate across frames.
- `ctx` (FrameCtx): `beat bar beatInBar sec secPerBeat bpm beatsPerBar`,
  `params` (numbers; bools 0/1, selects = index), `colors` (LINEAR THREE.Color,
  reused - copy before keeping), `text`, `notes`/`active`, `energy`, `opacity`,
  `inBlock`, `root camera gl size px aspect viewport`, `claimCamera()`.
- **Note queries** (code/notes.ts, on every ctx): `hits(q?, within?, max?)`
  newest first `{pitch velocity(0..1) beat age ageSec dur end held index}`,
  `last`, `held`, `holding`, `count(q, fromBeat)`, `pulse(q, decay)`,
  `gate(q, attack, release)`, `between(q, from, to)` - and **the future**:
  `next(q)` / `upcoming(q, within, max)` (`in` = beats until). `q` = a pitch, a
  list, a predicate, or undefined. The portal and the score tunnel read the future.
- **Lanes: other tracks' notes.** `ctx.lane('Kick')` (or `'Scene/Track'`) gives
  the same queries (+ `.notes`) over any track in the project, shown or not. The
  song's shared lanes live in a never-shown "Lanes" scene (`core.lane`, draws
  nothing) - `cabin lanes <p> --from-analysis` writes Kick, Snare, Hat, Bass,
  Vocal, Other, Root, Chord. One lane then drives many instruments; take the
  lane name as a `p.text` param (`innuendo/rig.ts`).
- **Camera.** There is ONE camera, shared by every scene. `camera()` returns a
  pose each frame (or move `ctx.camera` yourself and call `ctx.claimCamera()`);
  the claim holds while this track's scene is on screen and is released - the
  default pose [0,0,5] fov 55 restored - when the scene cuts away
  (core/visual/cameraOwner.ts; the built-in camera rigs claim the same way).
  Two camera tracks on screen: the last to claim wins. Billboards computed
  before the camera instrument runs in a frame see last frame's pose (one frame;
  stills are rendered twice, so they're exact).
- **Look.** `look()` returns overrides for the frame's grade while the scene is
  on screen: `bloom` (0.9) `bloomThreshold` (1.15) `bloomRadius` (0.72)
  `exposure` (1) `saturation` (1.08) `contrast` (1.045) `vignette` (0.82 floor)
  `grain` (0.014) `aberration` (px, 0) `tint` `fade` + `fadeColor`. A
  composition's `ctx.look({...})` wins over instruments (core/visual/look.ts).
  Defaults render bit-for-bit as before.
- **Panel.** Default `'auto'`: selects (≤5 options) as segmented rows, numbers
  as knobs four to a row (first one large, one-word captions from the label or
  key), colours as labelled pills; bools/text in MORE (code/panel.ts). Pass a
  console `PanelSpec` (userInterfaceRenderers/console/spec.tsx) for a hand-laid one.
- Code instruments render whether or not a block covers the playhead; gate on
  `ctx.inBlock` yourself if you want block-bounded visibility.
- Errors in any hook are caught and reported, never thrown: the row gets a red
  `!` badge (hover = message), `./cabin errors <project>` lists them.
- `fullFrame: true` pins `ctx.root` to the camera; draw in `ctx.viewport` units.

## The kit (code/kit, code/motion.ts, core/easing.ts)

- `Strokes(capacity, { glow, soft, blend, depthTest })` - camera-facing tapered
  capsules: `begin()`, `seg(ax,ay,az, bx,by,bz, r1,r2, color, alpha, gain)`,
  `poly`, `ring(cx,cy,cz, radius, width, color, alpha, gain, {seg, from, to, squash, dash})`,
  `polygon(...)`, `bendXY(fx(z), fy(z))`, `end()`. One draw call.
- `Sprites(capacity)` - `put(x,y,z, size, SPRITE.dot|flare|ring|disc|square|half|quarter|annulus|tri, color, alpha, gain, rot)`, `bendXY`.
- `particles({ count, seed, vertex, header, fragment, uniforms, hardness })` - GPU
  point clouds: a GLSL snippet sets `pos`, `size`, `color` from `aSeed` (vec4),
  `aIndex`, `uBeat`, `uSec` + your uniforms; `tick(beat, sec, px)` per frame.
  References: `innuendo/chladni.ts` (Newton-settled sand), `orb.ts`.
- `GLSL.noise` (snoise, snoise3, fbm, hash11/12/31), `GLSL.rotate`, `GLSL.screen`
  (toCentered/toUv/shapeR), `GLSL.pointSprite`.
- motion: `ease.*` + `easeByName('expo.out')` (core/easing.ts - the SAME names
  automation keys use), `tween`, `keyframes([[t,v,ease?]])`, `spring`,
  `springKick`, `impulse`, `decay`, `adsr`, `osc.*`, `noise2/3`, `fbm3`,
  `curl3`, `fibonacciSphere`, `GOLDEN_ANGLE`, `cosinePalette`, `smoothstep`…
- **Any installed library** can be imported - use it as a function of time,
  never a ticker: framer-motion's `interpolate` / spring generators (`.next(t)`),
  maath, troika-three-text (layout is async: build in `setup`), a PAUSED GSAP
  timeline `seek(ctx.sec)`'d in `frame`. Not OK: `animate()`, `useSpring`,
  `damp(delta)`. Def files load with the editor, so libraries join the initial
  bundle - prefer what's already a dependency.

## Post passes and compositions

- `post` - full-frame shaders over the finished scene (after Strobe, before the
  scene effect chain): `tDiffuse`, `vUv`, `uAspect`, `uBeat`, `uResolution`
  auto-declared, plus your uniforms (comma lists recognised). `innuendo/mirror.ts`.
- `defineComposition({ id, name, params, rows, resolve(ctx) })` - a Composite
  track returning the frame's layers. Scene rows start at 60; trigger rows go
  below 60. `ctx.scene(pitch)`, `sceneNamed`, `layer(sceneId, opts)`,
  `shaded(sceneId, { key, fragment, uniforms, scenes })`, `look({...})`.
  `shader.scenes = { tNext: nextSceneId }` samples MORE live scenes in the same
  shader (auto-declared `sampler2D`; those scenes render and their instruments
  run this frame) - morphs, displacements, wipes between two scenes.
  Because `resolve` sees the future, a transition can START BEFORE its cut
  (`innuendo/portal.ts`). Write transitions as code - there's no generic layer.
- Automation with exact values + easing: `cabin keys <p> <Scene/Track> <param>
  "80:1.5, 88:3:expo.in"` or `track.child(...).curve([{beat, value, ease}])` -
  Note.value/Note.ease on the lane's notes; the engine eases each segment by
  its key's ease (core/visual/automation.ts).

## Wiring (don't undo)

- **Code files stay out of the engine's import graph.** Only `code/register.tsx`
  (a Fast Refresh boundary, mounted by App) imports the generated lists; it
  writes `INSTRUMENTS`, calls `registerCompositions`, and wires the SDK's
  outside services (`code/world.ts`: lane notes, camera claim, looks). Importing
  a code module from ProjectStore / VisualEngine / core/directors would make
  every edit re-execute them under HMR - an empty store or a projectless engine.
- **Hot swap** (`code/live.ts`): `defineInstrument` publishes its spec; the view
  (`CodeInstrumentView`, one per id) reads the newest spec every frame and
  re-runs setup when it changed. `useInstrumentFrame`'s `extra` signature
  carries the spec so a swap repaints while paused.
- Editing engine/registry modules still re-creates singletons; `?file=`
  sessions reload the page then (`dev/hmrReload.ts`).

## Hard-won looks (read before tuning)

- **Bloom is wide** (threshold 1.15, mip radius 0.72). `gain` > ~1.2 on a shape
  covering much of the frame becomes fog. Keep big strokes near gain 1.
- **Fat capsules on a many-segment ring overlap into a soft band.** Thin ring +
  a thin expanding shockwave for punch (`innuendo/tunnel.ts`).
- **Zero-length segments stack** into a blown-out dot - skip repeated points (`pen.ts`).
- Additive batches sum: N copies of a held note at alpha 1 is N× bright.
- Particles in flight read as noise when everything moves at once: a blast per
  phrase, not per bar.
- **Camera-facing layouts: "up" is toward the lens.** Burst in-plane and keep
  lifts shallow (`chladni.ts`) or the frame drowns in near-camera static.
- `cabin audit <p>` finds black / blown / static / frozen stretches over the
  whole song - run it before a render.

## Packs

- `core/lane` - a shared MIDI lane (draws nothing; read with `ctx.lane`).
- `examples/pulse-ring` - the smallest useful instrument.
- `innuendo/` - built for underscores' INNUENDO (tools/cabin/examples/innuendo.ts):
  `hairline`, `orb`, `step-ring`, `fifths`, `blades`, `glyphs`, `pen`, `chladni`,
  `tunnel` (fly through the score), `rig` (camera + look from the lanes),
  `mirror` (post-only fold), `portal` (composition: dive-through cuts).
