# Lyric template spec: "Silent Film" (working name)

Reference: Instagram reel by thom.musy — The Cardigans "Lovefool" (screen recording at
`C:\Users\julia\Videos\Screen Recordings\instalyricstempaltesss.mp4`).
Concept in one line: **every word looks printed on degraded film stock and projected — the film
degradation layer sits on top of everything and is what makes it cohesive.**

## Layer stack (bottom → top)

1. Film-stock background (full-screen 2D quad)
2. Lyric words (canvas-textured planes, existing TextDisplay pipeline)
3. Scribble strokes (glowing hand-drawn accents)
4. Intro / outro cards (replace layers 1–3 while active)
5. **Film degradation overlay — composited over ALL of the above**: grain flicker, dust,
   vignette, barrel warp. This layer is non-negotiable; it is what welds text to background.

## Palette (sampled from reference frames)

| Role | Hex | Notes |
|---|---|---|
| Background base | `#1a171b` | Charcoal with a faint warm-purple cast — NOT pure black. Mid tones reach `#211e22` where grain is dense. |
| Text default | `#fdfbfe` | Near-white, whisper of lavender. Soft bloom, never crisp. |
| Accent A (cyan) | body `#4d8cbe`, glow core `#87dcfb` | Electric projector-cyan. |
| Accent B (magenta) | body `#a44cb2`, glow core `#c261d0` | Violet-magenta for climax sections. |
| Intro paper | `#b5d9cc`-ish cream | Cold mint-cream, not warm ivory. Faint graph-paper grid. |
| Highlighter | `#b3c06d` | Muted olive-yellow smear, ~70% opacity over paper. |
| Intro ink | `#303820` | Soft near-black with green cast, slightly blurred edges. |

**Rule: one accent hue on screen at a time.** Sections of the song own a hue (verse = white,
pre-chorus = cyan, chorus/climax = magenta). Accent + white may mix within a phrase
("A MAN" cyan over "THAT" white); cyan + magenta never share a frame.

## Typography

- Vintage high-contrast serif. Candidates (all Google Fonts / OFL — see `specimen.html` sent
  alongside this spec; pick ONE and lock it into the template):
  - IM Fell English SC + IM Fell English — closest to the distressed old-press look
  - Old Standard TT — cleaner, more "1900s schoolbook"
  - Playfair Display / Playfair Display SC — closest to the LOVEFOOL title card Didone
  - Cormorant SC + Cormorant Garamond, EB Garamond — lighter fallbacks
- ALL CAPS for emphasized lyric words; mixed case for connective phrases ("But I think you do").
- Wide tracking (~0.10–0.12em) and wide word gaps (~0.35–0.6em).
- Per-word imperfection: ±2–4° rotation, ±0.05em baseline shift, ±8% size jitter — hand-set type,
  never a straight line of identical glyphs.
- Glow: draw with canvas `shadowBlur` (double pass — tight bright core + wide soft halo).
  Accent words get roughly 2× the halo strength of white words.

## Motion & timing rules

- **Word-by-word reveal synced to the vocal** — one word per Whisper word-timestamp. Words pop on
  with a 1–2 frame flicker (glow overshoots ~150% then settles).
- **Scatter-accumulate:** each word of a phrase lands at a scattered anchor (roughly on a loose
  grid of thirds, random walk from the previous word, rotation jitter as above). Previous words of
  the phrase STAY, dimmed to ~80%; the newest word is brightest. On phrase boundary, all clear
  (hard cut, no fade-out choreography).
- Phrases are 3–6 words. A single big word ("MAMA") may own the whole frame, centered-ish.
- **Global film jitter over everything:** ±1–2px position wobble at ~8–12 Hz plus grain re-roll
  every frame. Never let a frame be perfectly still.
- All motion derives from `state.beat` / word timestamps (pause invariant — pure function of beat).

## Film layers (bespoke background + overlay instrument)

Single full-screen shader, ~5 params. Front overlay and background can be one instrument rendering
two quads, or the compositor applies the overlay pass.

- **Grain:** animated per-frame noise, luminance ±6–10%, visibly coarse (film, not sensor noise).
- **Dust & scratches:** sparse white specks (1–4px) and occasional hair-line streaks, 0.2–1s
  lifetimes, drifting; density param. A rare full-height vertical scratch reads as authentic.
- **Vignette:** strong radial darkening from ~55% radius outward, corners near-black.
- **Barrel warp:** subtle CRT-style bulge (~2–3% distortion) applied to the composited frame —
  frame edges visibly bow.
- **Flicker:** global luminance wobble ±3% at low frequency.
- Faint graph-grid texture at very low opacity under the grain (visible in some reference shots).

## Scribble instrument (bespoke, MIDI-triggered)

- A handful of preset stroke paths: underline swoosh, lasso/loop, S-flourish, circled word.
- Draw-on animation over ~300–500ms (stroke-dash reveal), glow in the section's accent hue,
  wobbly hand-drawn line quality (2–3px width variation, slight overshoot at ends).
- Triggered as notes; pitch selects the path preset. Used sparingly — punctuation for big
  moments, not constant decoration.

## Intro card (~2s)

Cold-cream graph paper (warped like the film frames), faint blurred artist names scrolling as a
"playlist page" (FOLLOW ME / …), the featured artist name in a hand-drawn ink rectangle with an
olive-yellow highlighter smear behind it. Serif caps, ink `#303820`, slightly blurred.

## Outro card

Song title in glowing Didone caps (`LOVEFOOL` style: oversized initial cap, small-caps-ish rest) +
artist name smaller beneath, over the film background, with a **live waveform visualizer**: thin
vertical white bars along a center line, glowing, pulsing with the actual track audio.

## Performance model (why this template is affordable)

Stacking three-plus full-frame canvas instruments is normally forbidden here (the library
comment says "one full-frame instrument per template at most") because each one costs a
full-canvas CPU rasterization AND a multi-megabyte texture upload per frame. Three rules make
it viable — keep them if you add layers:

1. **Film cadence quantization.** Every animated value in the film layers derives from
   `filmFrame = floor(beat · secPerBeat · 24)`, never the raw beat. The look is a step function
   (which is what film IS), and identical consecutive frames become detectable.
2. **Repaint skip.** `useFullFrameCanvas`'s `unchanged(key, notes)` returns early when the key
   and note list match the last painted frame — no rasterization, no upload. **The key must list
   every param the paint reads**; a missing one means edits to it silently do nothing, since the
   frame signature is already committed (same trap as the `useInstrumentFrame` `false` contract).
3. **Half-resolution canvases + baked static layers.** Grain/dust/scribbles run at 512px tall
   (a quarter of the pixels) with absolute sizes scaled by `h / 1024`, so the look is
   resolution-independent. Film Card stays at 1024 because type needs the resolution. Vignettes
   and the graph grid are baked once and blitted.

Still on the table if it's not fast enough: port Film Stock + Film Grain to a GLSL shader quad
(grain/vignette/flicker as per-pixel work with beat as a uniform) — zero rasterization, zero
uploads, and it would finally enable the deferred barrel warp.

## Anti-rules (what breaks the aesthetic)

- No pure black (`#000`) and no pure sterile white; everything sits in the tinted ranges above.
- No crisp text edges — if a glyph looks like clean vector type, add glow/erosion until it doesn't.
- No 3D depth, no camera moves other than the jitter/warp above.
- No more than one accent hue per frame; no rainbow cycling.
- No smooth eases on word entry — pops and flickers, not tweens.
- Nothing is ever perfectly static.

## Build mapping (engine work, in order)

1. **Film shader instrument** (new, bespoke): background + degradation overlay. Biggest cohesion
   win; test it over the EXISTING generic text first.
   ✅ Built 2026-07-20 as two instruments in [FilmStock.tsx](../src/editor/instruments/FilmStock.tsx):
   `filmStock` (background, base scene) + `filmGrain` (on-top overlay). Barrel warp deferred
   (needs a post pass, not a scene plane). Not yet visually verified.
2. **TextDisplay additions** ([TextDisplay.tsx](../src/editor/instruments/TextDisplay.tsx)): one
   Google-font load (the locked template font), scatter-accumulate placement mode, glow via
   canvas shadowBlur, per-word jitter. Canvas-texture pipeline stays as-is.
   ✅ Built 2026-07-20: fonts self-hosted in `public/fonts` (IM Fell English SC/English, Playfair
   Display variable) with a lazy loader (`core/visual/fonts.ts`, frame callbacks retry until the
   face is ready); font select gains Fell SC / Fell / Playfair; new params `layoutMode` (Center /
   Scatter), `phraseGap`, `scatterSpread`, `glow`, `jitter` — all default to legacy behavior.
3. **Scribble instrument** (new, small).
   ✅ Built 2026-07-20: [Scribble.tsx](../src/editor/instruments/Scribble.tsx) — pitch 60/62/64/66
   = swoosh / lasso loop / S-flourish / circle, draw-on + hold + fade, seeded wobble.
4. **Intro/outro card instruments** (new): paper card; title card + waveform (audio engine feeds
   the waveform).
   ✅ Built 2026-07-20: [FilmCard.tsx](../src/editor/instruments/FilmCard.tsx) — one instrument,
   mode select. Outro waveform is seeded bars pulsing with note energy (NOT real audio — the
   pause invariant forbids live samples); layer the Oscilloscope instead if the true waveform
   matters.
5. Assemble template: lock font + palette + film params; expose only 2–3 user knobs
   (accent hue, grain amount, maybe font size).
   ✅ Built 2026-07-20: [library-silent-film.ts](../src/templates/library-silent-film.ts) —
   'Silent Film' template: Lyrics (Fell SC, scatter, glow) + Scribbles + Intro Card (bars 0–2) +
   Film Grain + Film Stock, ambient blocks written out to the 512-bar ceiling. No outro block by
   default (song length unknown until transcription) — drop a Film Card block in Title Outro mode
   at the end. Not yet visually verified.
