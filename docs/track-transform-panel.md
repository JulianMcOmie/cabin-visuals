# Unified Track Transform Panel — Design Doc

**Status:** High-level brainstorm (round 1)
**Started:** 2026-07-28
**Goal:** Move x/y/z, rotation, size/scale, and opacity out of per-instrument
parameters into a single, DAW-inspired control panel integrated into each
track — like volume/pan on a mixer strip.

## Vision (from Tyler)

1. Remove x/y/z/rotation/size/opacity from instrument params — duplicated and
   confusing.
2. Opacity becomes the track's "volume slider"; in place of the pan knob, a
   control that opens the full transform panel.
3. The panel should be minimalist, professional, opinionated: easy AND natural
   to adjust values, snap near symmetrical values, control multiple things at
   once. Plain sliders are annoying — find better interactions.

## Current state (codebase audit, 2026-07-28)

Three overlapping transform systems exist today:

| System | Where | Notes |
|---|---|---|
| Instrument params | 13+ instruments in `src/editor/instruments/` | Inconsistent keys: `x` vs `baseXPosition` vs `posX`; inconsistent units (world / normalized screen / UV / degrees) |
| Effects stack | `src/editor/effects/transforms/` (`offset`, `rotate`, `scale`, `opacity`) | Already a per-track transform, packaged as opt-in effects, applied via `TransformWrapper` nested groups |
| Envelope opacity | `resolve.ts` `ENVELOPE_OPACITY_TARGET` | Precedent for a track-level property that isn't an instrument param |

Other load-bearing facts:

- `Track` (`src/editor/types.ts:119`) has no transform/volume fields today.
- Automation lanes + envelopes target `track.params` keys — removing params
  removes automatability unless transform gets its own automation story.
- Composition point: `VisualEngine.ts` builds a per-track `StateVector`
  (`stateVector.ts`) then `composeMatrix`; injecting a track transform there
  inherits to children + movers for free.
- `fullFrame` instruments (ColorFilters, Video, Photo, PixelBlast…) skip
  placement transforms entirely (`ObjectRenderer.tsx:116`).
- Screen-space instruments (TextDisplay, PhotoSlot, EmojiDisplay) use 2D
  normalized/UV coordinates, not world space.
- Best existing widget precedent: `CubeUserInterface.tsx:331` — XY pad,
  Z knob, size knob, position presets, reset-all.
- Track row UI: `src/editor/components/timeline/Track.tsx` (has M/S buttons,
  no volume). Inspector: `TrackEditor.tsx` (Instrument | Effects tabs).

## Open questions (round 1 — high level)

1. **Data model:** first-class `track.transform` field vs canonical reserved
   param keys vs promoting the effects stack?
2. **Scope of "unified":** does one panel cover world-space objects,
   screen-space instruments, and camera — or world-space only at first?
3. **Automation:** do transform properties remain automatable (lanes /
   envelopes / movers), and how, once they leave `params`?
4. **Where the panel lives:** popover from the track row, inspector section,
   dedicated mixer view, or several of these over one model?

## Decisions

1. **Data model: canonical reserved param keys.** Transforms stay in
   `track.params`, but under standardized keys owned by the engine, not
   declared by instruments. Instruments stop declaring/reading x/y/z/etc.;
   `VisualEngine` applies the canonical keys generically when composing the
   `StateVector`. Existing automation-lane and envelope machinery keeps
   working against these keys.
2. **Scope: world-space first, model for all.** Canonical keys are defined so
   screen-space (2D) and camera tracks can adopt them later; the panel ships
   for world-space object tracks first. fullFrame shader tracks get opacity
   only.
3. **Automation: from day one.** Automation lanes and envelopes can target
   canonical transform keys at launch (cheap, since they're still params).

4. **Canonical property set:** `x, y, z` (world units), `rotX, rotY, rotZ`
   (degrees), `size` (uniform multiplier), `opacity` (0–1). Per-axis stretch
   stays out of the panel.
5. **Size is inherited** — scaling a parent scales the subtree, like a group
   fader. Requires composing scale into the world matrix (engine change to
   the placement/mesh-scale split).
6. **Panel home: popover anchored to the track row.** The row strip carries
   the opacity slider + an opener; the full panel pops over at the row,
   dismisses on click-away. Single home; transform stays visually separate
   from instrument params.
7. **Multi-edit scope:** multi-track editing (select N tracks, one drag moves
   all) AND multi-axis gestures (XY pad etc.) are both in scope.
   Linked/mirrored tracks: explicitly out of scope for this change (noted as
   future idea).

8. **Old transform effects are deprecated:** hidden from the add-effect menu,
   still render for existing docs. Panel + automation is THE way to
   transform. Animated bits (rotate speed, scale pulse) get replacements
   later if missed.
9. **Motion params stay on instruments** (spinSpeed, spin…). Panel owns
   placement; instruments own behavior.
10. **Multi-track drag is relative by default** (formation preserved), with a
    modifier to converge to absolute (align).

**Status: design converged (mockup v2 approved) → implementation draft in
worktree branch `track-transform-panel`.**

## Converged UI spec (from mockup v2)

- Track strip: opacity mini-fader (accent-colored fill, % readout) + opener
  button where a pan knob would sit; opener toggles an anchored popover.
- Popover: isometric mini-viewport ("lollipop": shadow on grid floor = x/z
  drag, dot = y drag; dot radius tracks size, dot opacity tracks opacity;
  center axes glow when x=0/z=0; dot ring when y=0) + vertical scrub fields
  for X/Y/Z, RX/RY/RZ (deg), SIZE (×), OPAC (%).
- Scrub fields: vertical drag; shift = fine (0.15×); double-click = reset to
  default; alt = bypass snapping; value renders in accent color when exactly
  on a snap target.
- Snap targets: 0 for x/y/z; multiples of 45° for rotation; 0.5/1/2 for
  size; 0/50/100 for opacity.
- Multi-select: badge shows "N tracks"; drags apply relative deltas (ghost
  lollipops in viewport); modifier converges to absolute.

## Implementation draft (2026-07-28, branch `codex/track-transform-panel`)

- `src/editor/core/transform.ts` — canonical keys (`tfX/tfY/tfZ`,
  `tfRotX/Y/Z` in degrees, `tfSize`, `tfOpacity`), shared ParamDefs, helpers.
- `VisualEngine.computeAtBeat` — composes the canonical transform as the
  PARENT of the instrument's localTransform (skipped when identity); `tfSize`
  stays in the world matrix (inherited group fader); `tfOpacity` multiplies
  rendered opacity alongside envelope gates.
- Automation/envelopes/context-menu offer transform params on every object
  track (`withTransformParams`).
- v9 → v10 document upgrade migrates cube/circle/triangle/laserSphere/
  laserLine/particleSphere old keys (world size ÷ 1.6 → multiplier) and
  retargets automation/envelope children; template builder normalizes too.
- Instruments stripped of transform params; keep behavior only (spin, pulse,
  length/thickness, ripple scale etc.). CubeUserInterface lost its XY pad /
  size / presets (panel owns placement now).
- `TrackTransformPanel.tsx` — popover (portal): iso lollipop viewport +
  vertical scrub fields, snap + accent-on-snap, shift-fine, dblclick-reset,
  alt-no-snap, multi-track relative drag with cmd = absolute align.
- Track row strip (object tracks): opacity mini-fader + Move3d opener.
- offset/rotate/scale/opacity effects marked `deprecated` (hidden from the
  add menu, old docs keep rendering).
- Out of scope this draft: screen-space instruments (TextDisplay, PhotoSlot,
  EmojiDisplay), camera, fullFrame opacity unification, BassRipple/ShapeFlight
  `scale` (instrument behavior, kept).
- Verified: tsc clean, 351/351 tests, production build. Browser smoke test
  pending (dev-server cap: 5 servers from other sessions were running).

## Decision log

- 2026-07-28: Doc created; codebase audit completed.
- 2026-07-28: Round 1 decided — canonical param keys / world-space-first /
  automation day one.
- 2026-07-28: Round 2 decided — property set, inherited size (engine change
  accepted), popover home, multi-track + multi-axis in scope (linking out).
- 2026-07-28: Round 3 decided — deprecate transform effects, motion stays on
  instruments, relative multi-drag with absolute modifier. High level done.
- 2026-07-28: Low-level round: interactive mockup v1 shared (scrub fields,
  XY pad with magnetic axes, snap highlighting, ghost dots for multi-track).
- 2026-07-28: v1 feedback — aesthetic + accent color approved (future idea:
  sync accent with MIDI block/track color — NOT now); scrub drag should be
  VERTICAL (DAW-like); keep a visual anchor but make it read as 3D, tasteful.
- 2026-07-28: Mockup v2 shared — isometric mini-viewport ("lollipop"
  marker: shadow on grid floor = x/z, dot height = y; dot radius ~ size,
  dot opacity ~ opacity), vertical scrub fields.

## Future ideas (parked)

- Sync panel/strip accent color with the track's MIDI block color.
- Linked/mirrored track transforms (symmetric formations).
- Replacements for animated effect behaviors (rotate speed, scale pulse).
- 2D screen-space panel variant; camera track variant.
