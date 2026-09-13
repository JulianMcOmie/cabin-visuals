# Compact execution for new chain definitions

A registered mover, splitter or colorizer is expected to keep dense Particle chains compact. `particleExecution.test.ts` checks the entire registry; adding a definition automatically adds it to that check. A definition does not become GPU compatible merely because it declares a kind, a count bound or a caching policy.

## Authoring contract

Resolve a definition into shared data and derive its reference evaluator from that same data. Uniform motion belongs in `localTransforms[AtBeat]` or `rootTransform[AtBeat]`; spatial fanout belongs in `sharedLocalLayout`. A position, index or appearance calculation belongs in a serializable GPU operation with a matching CPU interpreter. Notes and automation should be sampled once into the shared operation, with no per-particle walk through song history.

The families on `MoverOrSplitter` are exclusive proofs. A new operation must declare its input dependencies, exact output count, and conservative transform bounds. Position-dependent operations see the incoming reference frame; deferred internal transforms retain their normal final composition. Index-dependent operations receive the index and count at their own chain stage, before later splitters fan out. Appearance follows the existing channel algebra: tint replaces, relative hue/saturation/lightness accumulate, and perceptual flags follow the last writer that sets them.

Placement dependencies must survive equal-beat edits as well as playback. An operation that measures world positions receives the actual placement matrix, including a mover's nested frame. Do not bake a sampled position or source instrument color into a definition-level capability claim.

## Existing exceptions

`MoverOrSplitterDefinition.particleExecution` records an existing limitation with a category and a concrete explanation. Absence means compact execution is required. The compiler never reads this field or a definition ID; it accepts only the resolved operation/layout proofs. The declaration makes remaining work visible during review and conformance testing, rather than making a renderer exception silently appear when a device is added.

Current categories are:

| Category | What the reason must identify |
| --- | --- |
| `formation` | A dependency on the complete incoming population, such as proving Conveyor's lattice period. |
| `copy-clocks` | Per-copy time or birth clocks that require independent downstream evaluation. |
| `unported` | The concrete transform or appearance operation still missing from the GPU vocabulary. |
| `variable-fanout` | A non-Cartesian emission/count dependency that needs a compact index mapping. |
| `device-control` | A channel such as an object-wide time remap or parent gate that the engine resolves outside spatial evaluation. |

Extras status alone is not an explanation. Remove or narrow a declaration when its operation becomes compact. A new definition should implement the shared execution path; an exception requires a concrete dependency that the current program cannot represent.

## Gates and composition

`compactEntryGate.ts` forwards uniform beat gates by selecting either the existing shared data or identity. Bypass and switcher variants retain the enabled count ceiling even when the current frame is disabled. Count-one GPU operations can carry copy-target predicates, evaluated against their incoming stage index and count. Targeting a splitter is different: untouched inputs emit one copy while targeted inputs fan out, so hiding duplicate slots is not an equivalent implementation.

Automation must preserve a definition's stable composition convention as well as its GPU metadata. A nested splitter samples child motion in its own frame and guards degenerate parent matrices; appearance belonging to active children must not leak into the bare branch. Its ordered appearance substages retain each colorizer's incoming sample position, index domain and active mask. Later nested fanout repeats these samples by ancestry without resampling the palette on the CPU.

Recursive child tables require an explicit proof that their transforms are independent of object placement. World-space appearance can still read placement in the interpreter. Recursive fanout can emit fewer bare copies when its incoming frame is singular, so `requiresInvertibleInput` permits the compact table only when the compiler certifies that every incoming frame stays invertible across playback. Static nondegenerate transforms and operations that explicitly preserve determinants can establish that proof; an animated scale that merely happens to be nonzero at the current beat cannot. A proof failure must not be disguised as duplicated hidden outputs: downstream indices and counts would change.

The current representation flattens a local nested subtree into tables, capped at 4,096 possible outputs before any identity sampling. Its preparation cost grows with that local subtree, although outer occurrences share the result. A larger subtree retains the reference path. Reusable recursive program nodes would be needed to remove the remaining product cost and support arbitrary deep fanout compactly.

Gate, frame and count wrappers must preserve those rules when forwarding any new operation family.

## Verification

The registry conformance test checks default settings, every select option and each numeric bound. It compares reference transforms and appearance through a small mixed chain with placement, upstream appearance and later fanout. A separate check places every required definition after a million-copy prefix, forbids reference `apply` calls during compilation, and checks complete counts, compact payloads and repeated seeks.

The registry check supplements focused operation tests and rendered CPU/GPU image comparisons. New operations still need cases for their own nonlinear boundaries, singular matrices, color quantization and conditional state changes. Test wrapper combinations explicitly: ordinary parameter automation, bypass, switcher modes, copy targets, nested mover frames and nested splitter children. Worker serialization and picking must use the same operation data as rendering.

```sh
node --import tsx --test --experimental-test-module-mocks \
  src/editor/core/visualCopies/particleExecution.test.ts \
  src/editor/core/visualCopies/compactEntryGate.test.ts \
  src/editor/core/visualCopies/nestedGpuAppearance.test.ts
```
