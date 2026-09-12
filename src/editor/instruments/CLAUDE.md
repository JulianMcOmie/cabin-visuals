# Instruments

For an ordinary new instrument, follow [Add an instrument](../../../docs/add-an-instrument.md).
It gives the bounded reading path, supported contracts, shared UI, integration
locations and verification. Use it before exploring renderer/engine internals.

- [types.ts](types.ts) owns definition/parameter contracts and defaults.
- [index.ts](index.ts) registers definitions; [lazyInstrument.ts](lazyInstrument.ts)
  keeps visuals out of the eager metadata bundle.
- [useInstrumentFrame](../core/visual/instrumentFrame.ts) owns beat-driven updates
  and paused skipping; return `false` if a frame cannot be applied yet.
- [Console kit](../userInterfaceRenderers/console/index.ts) owns ordinary settings
  controls/layout/binding. Use `panelSpec` before adding a bespoke renderer.

## Specialized references

Read only the relevant section; these notes are not the new-instrument checklist.

| Working on | Reference |
|---|---|
| Lazy loading, preload or export readiness | [Metadata/lazy boundary](implementation-notes.md#the-def-is-metadata-the-visual-is-a-lazy-chunk) |
| Particle Stream or Glass Roll | [Particle Stream](implementation-notes.md#particle-stream-midi-specifies-arrival-not-emission), [Glass Roll](implementation-notes.md#glass-roll-a-falling-roll-matched-to-a-reference-video) |
| Particle or GPU Stars | [Particle](implementation-notes.md#particle-a-lightweight-object-for-splitter-arrangements), [Stars](implementation-notes.md#gpu-stars-immutable-seeds-bounded-coordinates-explicit-picking) |
| Per-instance fading | [InstancedMesh opacity](implementation-notes.md#per-instance-opacity-on-an-instancedmesh); for the engine's copy pool, [instancedFrame.ts](../core/visual/instancedFrame.ts) |
| Alpha/shader blending | [Transparency contract](implementation-notes.md#an-always-transparent-material-must-declare-force_transparent_key), [animatedOpacity.ts](../core/visual/animatedOpacity.ts) |
| Optional definition capabilities/full-frame | [Definition notes](implementation-notes.md#def-semantics-worth-knowing-full-contracts-in-typests), [types.ts](types.ts) |
| Param-driven geometry | [Geometry replacement](implementation-notes.md#a-param-that-shapes-geometry-is-built-in-the-frame-callback-not-declared) |
| Lights or camera rigs | [Light](implementation-notes.md#the-light-instrument-scene-lights-are-tracks-now), [Cameras](implementation-notes.md#camera-instruments-own-the-camera-and-only-one-can) |
| Particle Stream | [Fixed-density continuous flow](implementation-notes.md#particle-stream-fixed-density-along-continuously-steered-paths) |
| Scene post-processing | [Pass integration and ordering](implementation-notes.md#scene-post-process-instruments-colorfilters-bassripple-impactwarp-strobe-crop) |
| Copy overlap/stencil | [OverlapShape](implementation-notes.md#screen-space-set-operations-between-copies-overlapshapes-stencil-recipe) |
| Procedural material surfaces | [Generated surfaces](implementation-notes.md#generated-surfaces-a-texture-that-travels-with-the-mesh) |

Keep new mechanics at definition sites and link them here. Add feature-specific
reasons/failure modes to the relevant implementation note, not the common path.
