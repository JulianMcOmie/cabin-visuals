# Add an instrument

Cabin Visuals is a DAW for visuals: define visuals with MIDI. This route covers
an ordinary object instrument with settings and a beat-driven R3F visual.

## Minimum reading path

After the [repository invariants](../CLAUDE.md#load-bearing-invariants-violating-these-breaks-distant-code), read this page and only these contracts/examples:

| Read | What it answers |
|---|---|
| [ObjectInstrumentDef, ParamDef, default helpers](../src/editor/instruments/types.ts) | What the definition supplies; optional capabilities are documented on their fields. |
| [useInstrumentFrame](../src/editor/core/visual/instrumentFrame.ts) contract and [ObjectState](../src/editor/core/visual/types.ts) | Which resolved inputs the visual receives and when its callback runs. Read the declaration/comments; no need to study signature-buffer internals. |
| [Particle.tsx](../src/editor/instruments/Particle.tsx) | A small definition, schema, lazy visual reference, and ordinary `panelSpec`. Its optional `instancedComponent` is not required. |
| [BasicShapeVisual.tsx](../src/editor/instruments/BasicShapeVisual.tsx) | A small frame callback updating a mounted mesh; [basicShapeCore.ts](../src/editor/instruments/basicShapeCore.ts) owns its appearance math. This rendering example is independent of the picker: Circle/Triangle remain for saved projects. |
| [PanelSpec](../src/editor/userInterfaceRenderers/console/spec.tsx) declarations | Supported rows and slots. The interpreter below the declarations is not prerequisite reading. |

You can now implement the ordinary route. Open the integration locations when
wiring it in; use the conditional references below only for capabilities you need.

## What is provided, what you supply

| Provided by the editor | Supplied by the instrument |
|---|---|
| Resolved beat, note stream, active notes, energy, sampled parameters, and copy-aware frame state | The visual response to those inputs: geometry, material, note interpretation, pure visual math. |
| Placement, hierarchy, movers/splitters, automation and export through the existing render path | `localTransform` only for instrument-specific shape/response; ordinary placement uses the canonical track transform (`tf*`). |
| Parameter storage, defaults in the inspector, bound setters, shared controls and panel layout | `params` and a `panelSpec`; custom preview/interaction components only where the instrument needs them. |

Consume the engine's resolved inputs. Notes can encode complex behavior, and
moving notes or devices in the hierarchy can change their interpretation through
resolution order. Do not introduce a separate invariant pattern representation
or reconstruct the document/resolve pipeline inside an instrument.

1. Add `Foo.tsx` with a named `ObjectInstrumentDef` export and a stable id. Declare
   settings in `params`; use `paramDefault` / `stringParamDefault` for runtime
   fallbacks, or constants shared with the schema. Saved tracks may omit new keys.
   Preserve shipped ids, parameter keys, select values and MIDI pitches.
2. Put the R3F component in `FooVisual.tsx`, accepting `{ trackId }`. Wire it with
   `lazyInstrument(() => import('./FooVisual').then(m => m.FooVisual))` from
   [lazyInstrument.ts](../src/editor/instruments/lazyInstrument.ts). Definitions
   are imported eagerly; never statically import a visual from a definition or
   add an eager barrel that includes visuals. Custom panel slots also introduce
   imports: keep their dependencies small and keep heavy visuals lazy.
3. Use `useInstrumentFrame(trackId, state => { ... })` to mutate refs/materials.
   Return `false` when a required ref/resource is not ready. Motion is a function
   of `state.beat` and resolved inputs, never accumulated frame deltas or real
   time. Use `seededRand` for repeatable randomness. Avoid per-frame React state
   and direct ProjectStore reads. Geometry changes driven by params also happen
   here; dispose resources you allocate imperatively.
4. Declare the settings panel and integrate the instrument below.

## Reuse the settings library

Use `panelSpec` for ordinary settings, with `userInterfaceRenderer: 'parameters'`
as the required renderer field. The spec takes precedence and needs no UI
registration. Particle shows knobs and a color pill; [LaserLine.tsx](../src/editor/instruments/LaserLine.tsx)
adds a MIDI vocabulary and schema-default lookups without a separate panel file.

The [console kit public exports](../src/editor/userInterfaceRenderers/console/index.ts)
are the supported UI entry point. Declare the accent once; reuse its layout,
knobs, color picker, segments and disclosure. Unclaimed parameters go to MORE.
For a minimal generic panel, omit `panelSpec` and keep `'parameters'`.

| Need | Existing path |
|---|---|
| Knobs, color pills, select rows | `PanelSpec.rows`; use `bipolar` for signed knobs. |
| A distinctive preview or a custom row | `PanelSpec.preview` or `custom` with `claims`; these stay components. |
| View state or interaction beyond the spec | A bespoke renderer composing `Console`, `ControlRow`, `Knob`, `ColorPill`, `Segmented`, `More` from the kit. Register in UI [ids.ts](../src/editor/userInterfaceRenderers/ids.ts) and [index.ts](../src/editor/userInterfaceRenderers/index.ts). |
| Parameter binding in a custom component | [bindPanel](../src/editor/userInterfaceRenderers/console/bindings.ts) over the supplied [UserInterfaceParameter](../src/editor/userInterfaceRenderers/types.ts) values/setters; no direct store writes. Create and consume the binder each render; do not reuse a drained binder. |
| A preview frame, R3F canvas or demo loop | `PreviewWindow`, `PreviewCanvas`, `usePreviewLoop`; reuse the instrument's pure math. A panel demo clock is separate from the instrument's resolved beat. |

`showIf` parameters are filtered before the instrument renderer receives them.
Mark gated knobs optional (`'key?'` or `optional: true`). Spec pills and segmented
rows currently have no optional flag: use a custom row with `claims` and optional
binder lookups, or let gated controls appear in MORE. A missing required binding
falls back to the generic list; it does not mean registration failed.

For custom layout, follow the [panel design guide](instrument-panel-design-guide.md)
and [UI guide](../src/editor/userInterfaceRenderers/CLAUDE.md): the inspector owns
identity/chrome; the instrument supplies its controls. Use existing kit styling
and accent helpers rather than copying control markup or inventing panel colors.

## Integrate it

| Location | Action |
|---|---|
| [instruments/index.ts](../src/editor/instruments/index.ts), `INSTRUMENTS` | Import the definition and add it to the map. |
| [LeftSidebar.tsx](../src/editor/components/LeftSidebar.tsx), `ALL_OBJECT_INSTRUMENTS` and nearby folder sets | Add the library card and choose its shelf. Unclaimed entries go to Extras; do not expand the curated core by default. The picker intentionally differs from the registry. |
| [trackGlyphs.tsx](../src/editor/components/timeline/trackGlyphs.tsx), `G` | Add a 16px `currentColor` track glyph. Card artwork and tinted timeline marks serve different purposes. |
| [InstrumentHoverPreview.tsx](../src/editor/components/InstrumentHoverPreview.tsx), `ObjectPreview` and preview fixtures | Check the default synthetic notes/params show the new instrument meaningfully; add a fixture only if needed. This is separate from an inspector `panelSpec.preview`. |

[TrackEditor.tsx](../src/editor/components/TrackEditor.tsx) already binds params
and dispatches `panelSpec`. An ordinary instrument does not need an editor-shell
branch, a bespoke UI registration, a resolver rewrite, or a persistence upgrade.
If changing saved data shape/meaning, use the [persistence guide](../src/persistence/CLAUDE.md).

## Specialized routes and shared gaps

| Only when needed | Read |
|---|---|
| Custom MIDI row meanings or ability lanes | [Note semantics](instrument-note-semantics.md) and the corresponding fields in `ObjectInstrumentDef`. |
| Many copies with a measured rendering cost | [instancedFrame.ts](../src/editor/core/visual/instancedFrame.ts) and the [instanced path guide](../src/editor/core/visual/CLAUDE.md#instancedframets--the-instanced-copy-pool-fast-path-2026-08); keep the ordinary fallback working. |
| Transparent/custom shaders, geometry replacement, full-frame, lights, cameras or scene passes | The [instrument notes index](../src/editor/instruments/CLAUDE.md#specialized-references) links to the relevant section. |
| Changing chain resolution itself | [VisualCopy guide](../src/editor/core/visualCopies/CLAUDE.md), after identifying the specific gap. Ordinary instruments consume the result. |

New instrument-specific visual math is ordinary implementation. If the existing
shared capabilities cannot express the task, first present a concrete proposal:
the gap, which existing pieces fail and why, and the smallest reusable addition.
Do that before committing to a broad abstraction. Routine navigation fixes and
small improvements to supported library pieces do not require a new design phase.

## Verify the change

Run commands from the product repo with dependencies installed. Replace example
file names with the changed files; [package.json](../package.json) owns scripts.

- Lint changed instrument files: `npx eslint src/editor/instruments/Foo.tsx src/editor/instruments/FooVisual.tsx`.
  [eslint.config.mjs](../eslint.config.mjs) enforces the beat/randomness rules.
- For nontrivial visual math, keep pure helpers in `fooCore.ts` and test behavioral
  invariants (direct vs backward seek, note boundaries, defaults), not duplicated
  formulas: `node --import tsx --test --experimental-test-module-mocks src/editor/instruments/fooCore.test.ts`.
  [basicShapeCore.test.ts](../src/editor/instruments/basicShapeCore.test.ts) is a small example.
  Avoid importing `*Visual.tsx` into Node tests (renderer/engine cycles); lazy
  metadata definitions can be imported if their own dependencies are Node-safe.
- `npm run test:visual` includes colocated instrument tests. Run affected tests
  for a local change, the broader suite for shared behavioral changes. Run a
  typecheck for TypeScript changes (`npx tsc --noEmit`). Prose-only changes need
  link/symbol/command checks, not a production build.
- In `/editor`, add from the picker; check the intended shelf, track glyph,
  defaults, controls, color and any gates/MORE at narrow inspector width. Check
  undo/redo, pause with parameter edits, playback, forward/backward seek to the
  same beat, and a mover/splitter with visibility fades. For a visual change,
  compare a short export at matching beats. Report any checks you could not run.
- Use a unique port and dist directory for local smoke tests, e.g.
  `NEXT_DIST_DIR=.next-instrument-guide npm run dev -- --port 3099` after checking
  that port is free. A build must use a different dist directory from a live server.

Library clip generation is a publishing step: `npm run previews:instruments -- foo`
captures the selected instrument and **uploads to Supabase**. The
[script header](../scripts/generate-instrument-previews.mjs) owns prerequisites
and `PREVIEW_BASE_URL`. Use it when publishing preview assets is in scope;
it is not a local verification prerequisite.
