# VisualCopy mover/splitter refactor handoff

## Status

This document specifies the agreed architecture for replacing the current split mover/clone model with one ordered, instrument-independent mover-and-splitter pipeline.

Implementation was intentionally stopped after one isolated deprecation commit on `codex/visual-copy-foundation`:

```text
5f9c2da Deprecate legacy visual duplication paths
```

No VisualCopy runtime or renderer wiring has been implemented. The existing application behavior is unchanged by that commit.

## Objective

Every instrument track should produce one opaque visual output. A top-to-bottom sequence of movers and splitters should then describe how many times that output is rendered and how each copy is transformed or visually adjusted.

The pipeline must support non-commutative ordering:

```text
move -> split -> rotate
```

must be observably different from:

```text
split -> move -> rotate
```

Downstream movers receive the index and count created by upstream splitters, so they can produce alternating motion, waves, gradients, and other copy-aware behavior.

The pipeline must not understand instrument-specific meshes, particles, text, video, notes, pads, abilities, or parameters. It operates only on generic instructions for rendering copies of an already-processed instrument output.

## Locked vocabulary

Use these names consistently:

```ts
VisualCopy
MoverOrSplitter
MoverOrSplitterContext

identityVisualCopy()
resolveVisualCopies()
getVisualCopies()
getVisualCopy()
getVisualCopyCount()

moverAndSplitterChain
moverOrSplitter
previousVisualCopies
visualCopies
```

Avoid `operator`, `seed`, `instance graph`, or custom metadata terminology in the first implementation.

## Core contract

### VisualCopy

A `VisualCopy` means:

> Render the same already-processed instrument output once with this transform and these generic appearance adjustments.

The initial contract should be closed and small:

```ts
interface VisualCopy {
  transform: Matrix4
  opacity: number
  colorShift: {
    hue: number
    saturation: number
    lightness: number
  }
}
```

An identity copy renders the output once without changing it:

```ts
function identityVisualCopy(): VisualCopy {
  return {
    transform: new Matrix4(),
    opacity: 1,
    colorShift: {
      hue: 0,
      saturation: 0,
      lightness: 0,
    },
  }
}
```

Do not add instrument data, MIDI notes, splitter ancestry, custom channels, source-element information, or arbitrary metadata to this type.

### Matrix semantics

`Matrix4` already contains position, orientation, and scale. Self-rotation and orbit rotation do not require separate fields; they are different composition operations:

```ts
// Local/self-space change.
next.transform.copy(previous.transform).multiply(delta)

// Parent/world-space change.
next.transform.copy(delta).multiply(previous.transform)

// Orbit around a pivot.
next.transform
  .copy(translateToPivot)
  .multiply(rotationDelta)
  .multiply(translateFromPivot)
  .multiply(previous.transform)
```

Each definition must document whether its delta is composed locally or in parent space. Do not rely on an implicit shared convention for both behaviors.

### MoverOrSplitter

An individual chain entry receives one copy and returns one or more copies:

```ts
interface MoverOrSplitterContext {
  beat: number
  index: number
  count: number
}

interface MoverOrSplitter {
  apply(
    visualCopy: VisualCopy,
    context: MoverOrSplitterContext,
  ): VisualCopy[]
}
```

A mover normally returns a one-item array. A splitter returns multiple items. The shared return type is what allows one straightforward resolution loop.

Definitions should treat the incoming copy as immutable and return new `VisualCopy` values with independently owned matrices.

### resolveVisualCopies

The core evaluator should be deliberately unsurprising:

```ts
function resolveVisualCopies(
  moverAndSplitterChain: MoverOrSplitter[],
  beat: number,
): VisualCopy[] {
  let visualCopies = [identityVisualCopy()]

  for (const moverOrSplitter of moverAndSplitterChain) {
    const previousVisualCopies = visualCopies
    const count = previousVisualCopies.length

    visualCopies = previousVisualCopies.flatMap((visualCopy, index) =>
      moverOrSplitter.apply(visualCopy, {
        beat,
        index,
        count,
      }),
    )
  }

  return visualCopies
}
```

Required ordering rules:

1. Chain entries execute strictly top to bottom.
2. A step processes input copies in their existing order.
3. A splitter emits slots in its own declared slot order.
4. Nested output order is input-major, then splitter-slot order.
5. The next step receives `index` and `count` for the complete result of the previous step.
6. A hard maximum copy count prevents accidental exponential rendering explosions.

No MIDI, automation, envelope, project-track, React, or instrument logic belongs in `resolveVisualCopies`.

## MIDI and time ownership

All MIDI interpretation belongs inside the specific mover or splitter definition.

The new core must not have generic concepts named `continuous`, `amount`, or `ballistic`. Those belong to the deprecated mover runtime. A new definition decides its own MIDI vocabulary and time response.

A resolved definition may close over immutable settings and resolved notes:

```ts
function resolveSomeMover(args: {
  settings: SomeMoverSettings
  notes: ResolvedNote[]
}): MoverOrSplitter {
  return {
    apply(visualCopy, context) {
      const value = evaluateThisMoversMidi(
        args.notes,
        args.settings,
        context.beat,
      )

      return [applyThisMoversTransform(visualCopy, value, context)]
    },
  }
}
```

This is encapsulation, not mutable playback state. Evaluation must remain a pure function of beat plus immutable resolved data so that pause, scrub, playback, and export agree exactly.

### MIDI-gated splitter copies

A splitter's configured copy count is structural. MIDI controls opacity/existence without removing slots:

```ts
return [
  {
    ...leftCopy,
    opacity: visualCopy.opacity * leftGate,
  },
  {
    ...rightCopy,
    opacity: visualCopy.opacity * rightGate,
  },
]
```

An inactive slot remains present with opacity zero. This prevents downstream indices from changing when notes turn on and off.

For a two-way symmetry splitter:

```text
pitch A -> left copy gate
pitch B -> right copy gate
```

Velocity may control opacity if that splitter's definition chooses to do so. The core evaluator does not know this mapping.

## Instrument boundary

The instrument remains an opaque React/R3F subtree:

```ts
component: FC<{ trackId: string }>
```

The instrument is responsible for its own appearance at the current beat. It may render a mesh, group, light, points object, canvas-textured plane, particle system, or multiple children. Movers and splitters do not inspect it.

The new system begins with exactly one identity `VisualCopy` for every instrument track. Generic multiplicity comes only from splitters.

This intentionally does not expose internally managed particles, text characters, or meshes as separate copies. A particle-system instrument is one opaque output unless its own implementation is later redesigned.

## Confirmed current-code constraints

### There is no primitive before ObjectRenderer

`VisualScene` currently receives only descriptors:

```ts
{ trackId: string; instrumentId: string }
```

`ObjectRenderer` resolves the instrument definition and mounts its component:

```tsx
const Component = def.component
return <Component trackId={trackId} />
```

The actual Three.js primitives do not exist until that component renders. Different instruments return groups, meshes, points, lights, textured planes, or imperative subtrees. Therefore the engine cannot clone a universal Three.js primitive before `ObjectRenderer`.

### The renderer can still receive more resolved objects

The clean adaptation is to publish one structural render-list entry per `VisualCopy`:

```ts
interface ObjectListEntry {
  trackId: string
  instrumentId: string
  visualCopyIndex: number
}
```

`VisualScene` mounts one `ObjectRenderer` for each entry. Each renderer renders exactly one occurrence and pulls exactly one copy:

```ts
const visualCopy = getVisualCopy(trackId, visualCopyIndex)
```

`ObjectRenderer` does not resolve splitters, loop over copies, or know that sibling copies exist. It only applies the transform, opacity, and color shift for the one occurrence it was given.

This matches the desired mental model: the rendering layer receives more renderable object occurrences.

### Structural list versus per-frame values

Copy count must not change from MIDI gates. React reconciles the object list only when the structural chain changes, such as adding/removing a splitter or changing a configured copy count.

Matrices, opacity, and color shift update imperatively per frame through a cache:

```ts
getVisualCopy(trackId, visualCopyIndex)
```

This avoids rebuilding the React tree during playback.

### Existing CloneWrapper

`CloneWrapper` already proves that ordinary instrument React subtrees can be mounted multiple times. It remains temporarily for old saved clone effects, but it is deprecated and must not receive new features.

During migration, a new `VisualCopy` occurrence may still contain a legacy `CloneWrapper`; old clone effects therefore multiply inside each new copy. This is acceptable compatibility behavior until explicit migration/removal.

### Existing movers

The current mover definitions operate on `StateVector` and are surrounded by shared MIDI modes, depth blending, subset weights, add groups, scratch buffers, and open-ended channels. They should not be ported.

Keep them as a legacy path so existing projects render. Write new movers from new definitions against `VisualCopy`.

During coexistence:

- New mover IDs resolve through the new VisualCopy registry.
- Unknown-to-new-registry mover IDs fall back to the legacy registry.
- Legacy movers execute before the new mover-and-splitter chain.
- Only new movers and splitters participate in exact non-commutative ordering.

Using registry ownership rather than a temporary `visualMover` track type keeps the stored track schema smaller. New mover IDs should remain distinct until deliberate migrations are added.

### Swarm

Swarm is deprecated and may ultimately be deleted. Its `elementCount`, `layoutState`, element matrices, element opacities, and renderer exception are not part of the new architecture.

Do not block the initial wiring on deleting it. Existing Swarm projects may continue through the legacy path until cleanup.

### ObjectState and StateVector

The current `ObjectState` mixes instrument inputs, renderer outputs, effect state, assets, and Swarm-specific element state. `StateVector` belongs to the legacy mover runtime.

Refactoring either is explicitly out of scope for the first seven commits. Store new `VisualCopy[]` values in a separate cache and expose separate accessors. Do not add `VisualCopy[]` to `ObjectState`.

## Final matrix and appearance composition

The new chain describes changes after the instrument's existing processing/placement.

For normal world-space instruments:

```text
final transform = existing track/world placement * visualCopy.transform
```

For appearance:

```text
final opacity = existing opacity * visualCopy.opacity
final color shift = existing color shift + visualCopy.colorShift
```

The identity copy must render pixel-equivalently to the current one-object path.

## Full-frame instruments

Full-frame instruments currently bypass placement and clone effects. The new system should convert full-frame behavior from a bypass into an outer coordinate-space anchor:

```text
world instrument:
  WorldAnchor
    -> VisualCopy transform
      -> instrument component

full-frame instrument:
  CameraFacingScreenAnchor
    -> VisualCopy transform
      -> instrument component
```

The `VisualCopy` contract stays identical. Only the coordinate frame in which its transform is applied differs.

`CameraControl` is not genuinely renderable output; it imperatively changes the shared camera. Duplicating it has no useful semantic meaning. It should eventually be classified as a controller rather than used to complicate the generic copy contract.

## Project resolution and targeting

Add `splitter` as a new `TrackType`. A splitter track may reuse the existing structural fields:

```ts
splitterId?: string
inputValues?: Record<string, number>
blocks: Block[]
parentId?: string
childIds: string[]
targets?: Routing[]
muted: boolean
solo: boolean
```

Do not copy the legacy semantics of `Routing.port` or `Routing.amount`; they are already ignored. Prefer extracting the scope union into a shared type later if that can be done without broad cleanup:

```ts
type ObjectScope =
  | { kind: 'track'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'subtree'; id: string }
```

Ordering rules:

1. New mover and splitter children are collected together in exact `childIds` order.
2. A nested splitter automatically targets its direct parent instrument track.
3. A top-level new mover/splitter uses track, tag, or subtree targets.
4. Matching global entries append after local entries in exact `rootTrackIds` order.
5. Duplicate routes from one global entry to the same target object are deduplicated.
6. Legacy movers remain outside this ordered chain during migration.

Applying a splitter to an instrument track copies that track's output only. It does not implicitly copy descendant instrument tracks. A subtree-targeted splitter applies independently to each object in the subtree.

## Commit sequence

These are commits within one implementation PR/branch. They are separated for reviewability and rollback, not because each commit independently exposes a testable product feature. The complete wiring exists after commit 7; the first real user-defined mover arrives in commit 8.

### Commit 1: `Deprecate legacy visual duplication paths`

Already created as `5f9c2da` in the isolated worktree.

Scope:

- Mark legacy mover definitions/runtime deprecated.
- Mark `CloneSpec`, clone plugins, and `CloneWrapper` deprecated.
- Mark Swarm's special multiplicity deprecated.
- Preserve all behavior.

Verification:

- Typecheck/build.
- Existing visual tests remain unchanged.

### Commit 2: `Add the VisualCopy resolution kernel`

Add an isolated module, suggested layout:

```text
src/editor/core/visualCopies/
  types.ts
  identityVisualCopy.ts
  resolveVisualCopies.ts
```

Add unit tests proving:

- Empty chain returns one identity copy.
- Movers receive the current index/count.
- A splitter expands one copy into multiple copies.
- Downstream movers see the expanded count.
- `mover -> splitter` differs from `splitter -> mover`.
- Nested output ordering is deterministic.
- Opacity and color shift survive copying.
- Definitions do not mutate input copies.
- The hard copy cap works.

The module must not import instruments, stores, React, `ObjectState`, `StateVector`, or project-track types.

### Commit 3: `Define new mover and splitter contracts`

Add a new definition registry independent of the legacy mover registry.

Suggested boundary:

```ts
interface VisualCopyMoverDefinition<Settings> {
  id: string
  label: string
  resolve(args: {
    settings: Settings
    notes: ResolvedNote[]
  }): MoverOrSplitter
}

interface VisualCopySplitterDefinition<Settings> {
  id: string
  label: string
  resolve(args: {
    settings: Settings
    notes: ResolvedNote[]
  }): MoverOrSplitter
}
```

This commit should use test-only fake definitions to verify private MIDI evaluation and deterministic beat behavior. Do not invent production movers before their behavior is specified.

### Commit 4: `Resolve ordered mover and splitter chains`

Scope:

- Add the `splitter` track type and minimal fields.
- Resolve new-registry movers and splitters together in `childIds` order.
- Reuse track/tag/subtree expansion for top-level entries.
- Preserve legacy mover resolution as a separate earlier stage.
- Expose a resolved `moverAndSplitterChain` per object.

Tests:

- Mixed local order is exact.
- Global order is exact.
- Track/tag/subtree targets resolve correctly.
- Duplicate global routes are deduplicated.
- Legacy mover IDs do not enter the new chain.

### Commit 5: `Evaluate VisualCopies during visual frames`

Scope:

- Add a separate per-track `VisualCopy[]` runtime cache.
- Evaluate `resolveVisualCopies()` from the resolved chain at the current beat.
- Expose `getVisualCopies`, `getVisualCopy`, and `getVisualCopyCount`.
- Do not add fields to `ObjectState`.
- Do not change instrument components.

Tests:

- Same beat produces identical copies.
- Scrubbing away and back reproduces matrices exactly.
- MIDI gates change opacity without changing copy count.
- The identity path remains one copy.

### Commit 6: `Render one object per VisualCopy`

Scope:

- Expand the structural object list to one entry per copy index.
- Have `VisualScene` mount one `ObjectRenderer` per entry.
- Give `ObjectRenderer` one `visualCopyIndex` and make it apply only that copy.
- Compose existing world placement with `visualCopy.transform`.
- Multiply opacity and add color shift.
- Preserve legacy `CloneWrapper` inside each occurrence.

Tests:

- One identity copy preserves current rendering structure.
- Two structural copies produce two renderer entries.
- MIDI-hidden copies stay mounted and invisible.
- Per-frame matrix changes do not republish the structural list.
- `onTop` status applies to every occurrence.

### Commit 7: `Support VisualCopies in full-frame rendering`

Scope:

- Replace the full-frame copy bypass with a camera-facing screen anchor.
- Apply the same `VisualCopy` transform inside that anchor.
- Preserve shader and HUD/on-top behavior.

Tests:

- Full-frame identity is equivalent to current placement.
- Multiple copies can translate/scale inside screen space.
- Opacity and color shifts apply.
- Shaders and the HUD pass still compose correctly.

### Commit 8: first real mover

The user will provide the exact mover behavior. Add only that production definition, its controls, MIDI grammar, UI registration, and focused tests.

This is the first end-to-end behavioral test of the new pipeline. Do not add speculative movers or splitters before this specification arrives.

## Cleanup after commit 8 validation

After the first new mover is verified through the complete path:

1. Delete Swarm and remove its picker/registry entry.
2. Remove `elementCount`, `layoutState`, element matrices, element opacities, and Swarm renderer exceptions.
3. Decide which legacy clone effects deserve migration into splitters.
4. Remove `CloneWrapper` only after saved-project compatibility is handled.
5. Replace legacy movers one at a time only when new definitions are specified.
6. Delete the legacy StateVector mover runtime when no saved/project path depends on it.
7. Refactor `ObjectState` separately, not as incidental VisualCopy work.

## Focused verification commands

Use the repository's existing validation plus direct TypeScript checks as appropriate:

```bash
npm run test:visual
npx tsc --noEmit
npm run build
```

Add the VisualCopy unit test file where `test:visual` includes it, or update that script deliberately. The current glob targets `src/editor/core/visual/*.test.ts` and does not recurse into a new `visualCopies/` folder.

After commit 6 and commit 7, add a browser smoke test covering:

- One ordinary instrument with identity copies.
- One ordinary instrument with two fake/test copies.
- One copy opacity-gated to zero without unmounting.
- One full-frame instrument with identity copies.
- One full-frame instrument with two translated copies.

Do not claim complete visual verification until commit 8 supplies a real production mover and that path is exercised.

## Non-goals for the first implementation

- Refactoring `ObjectState`.
- Replacing `StateVector` in the legacy engine.
- Porting existing movers.
- Adding generic continuous/amount/ballistic MIDI modes.
- Publishing custom metadata between chain entries.
- Exposing an instrument's internal particles, characters, or meshes as copies.
- Allowing MIDI to change structural copy count.
- Interleaving legacy movers non-commutatively with new splitters.
- Automatically duplicating child instrument tracks when a parent is split.
- Redesigning effect automation or shaders.
- Adding production movers/splitters without explicit behavior specifications.

## Acceptance criteria before cleanup

The foundation is ready for cleanup only when all of the following are true:

1. Every instrument track resolves at least one identity `VisualCopy`.
2. A new mover and splitter can be ordered non-commutatively in one chain.
3. A downstream mover receives indices created by an upstream splitter.
4. MIDI gating changes opacity without changing structural indices.
5. Ordinary and full-frame instruments both consume the same `VisualCopy` contract.
6. `ObjectRenderer` renders one occurrence and does not resolve copy logic.
7. Legacy movers and clone effects still render existing projects during migration.
8. Pause, scrub, playback, and export evaluate the same copies at the same beat.
9. Copy count is capped and structural React updates are not performed per frame.
10. The first user-specified production mover passes unit and browser verification.

