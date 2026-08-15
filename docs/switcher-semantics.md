# Switcher — draft semantics

A container track whose MIDI lane picks **which of its children are live**.

**Status (2026-08-15): built, both arms, and green.** `type: 'switcher'`,
`core/visualCopies/switcher.ts`, the chain splice and object gate in
`core/visual/resolve.ts`, the rack console, the lane's rows, wrap/unwrap, and a
library card in Utility. 36 new tests; suite at 1255 pass / 0 fail.

**A row may be anything** — a device, an object, a group, or a nested rack — and
the lane does not know which is which. That is the genericity the design was
asked for, and it cost one branch: a device row splices chain entries, an
object/group row gates visibility.

Three things landed differently from the first draft, all recorded in
`core/visualCopies/CLAUDE.md`: the children are **spliced** into the parent chain
rather than delegated to by one entry (which fixes an `index`/`count`/`formation`
bug the delegate design would have had); the structural-variant publication is
**mode-dependent**, so exclusivity shrinks the copy ceiling instead of costing
anything; and a switcher is also a **placement node**, without which an object
nested under a rack silently loses its ancestors' transform.

---

## 1. The one rule

> **A Switcher splices its children into the chain it sits in, contiguously and
> in child order. Its notes say which of them are running at this beat.**

The switcher is not one device that impersonates a child; it is a **span** of the
chain that the lane switches parts of on and off. That is what makes the
mix-and-match mode literally true rather than an approximation:

> **Gate mode with every row held is bit-identical to those devices being plain
> chain siblings, with no switcher at all.**

That property is the whole design. Everything else — exclusivity, latching, the
empty lane — is a restriction on *which subset* of the span is running, never a
change to how the running ones compose.

The corollary that makes it worth building: **a subset is not expressible as N
independent gates.** Today, gating five devices means five Bypass lanes; keeping
exactly one on means hand-drawing complementary notes. The switcher makes the
subset rule a property of the lane.

### Why splice instead of delegate

The obvious implementation — one `MoverOrSplitter` whose `apply` runs a
sub-chain internally — is wrong, and subtly. `apply` is called **per copy** by
the kernel, so entries inside a nested sub-chain would see `index`/`count`/
`formation` describing that one copy's private fan-out rather than the real
formation. Position-reading devices (Symmetric Motion, a world-placed field,
Conveyor's belt period) would silently measure the wrong thing. Splicing hands
them to the real kernel as real siblings, and the problem does not exist.

---

## 2. What a child is — the two readings

### 2a. Device switcher (children are `mover` / `splitter` / colorizer tracks)

`resolveMoverAndSplitterChain` currently maps each chain child to one entry. A
switcher child contributes **N entries** instead — one per child, each wrapped in
`switchGated(entry, isLiveAt, i)`, a gate the same shape as `bypassGated`. An
off entry returns the copy unchanged, this module's own convention for "this
entry declines to act".

That is the entire runtime change. No nested kernel, no new context plumbing.

### 2b. Object switcher (children are instrument tracks)

Resolves to a **placement node** — the same `ResolvedGroup` a `group` produces —
plus a per-frame member gate. Under Gate, several members are visible at once,
which is simply what a group already does; the lane only says which.

The short way to say it: **an object switcher is a Group whose members are
switched by MIDI.** It should inherit the group's whole kit: `tf*` composed as
the members' parent, `tfOpacity` cascade, automation lanes on those params, the
effect chain broadcast, mover/splitter children broadcast onto each member's
chain.

### 2c. Not a child: an `EffectInstance`

`track.effects` are instances on a track, not tracks, so they cannot be wrapped.
The existing answer stays `fx:<instanceId>:enabled` toggle lanes
(`effects/automation.ts`). "One lane, one row per effect" for those is a
different feature — a row vocabulary over a track's own effect chain, not a
container.

**Recommendation: ship 2a first.** It is the motivating case, it is a
generalisation of code that already exists and is tested, and it needs no change
to the object/render path.

---

## 3. Modes — a 2×2, and every cell is real

Two selects, following the Mover-consolidation precedent rather than a flat list:

**VOICES** — how many children a note may leave live.
**NOTES** — whether a note is momentary or changes a standing state.

|  | **Momentary** (while held) | **Latching** (until changed) |
|---|---|---|
| **Many** | **Gate** — every row currently sounding is live; they compose in child order | **Toggle** — each row's onsets flip that child on/off independently |
| **One** | **Solo** — only the newest sounding note's child is live | **Latch** — the most recent onset owns the beat until the next |

- **Gate** is the mix-and-match case: hold rows 1 and 3 and those two devices
  run, in child order, exactly as if they were the only two children.
- **Toggle** is mix-and-match made *performable* — tap on, tap off, no held
  notes. See the hazard in §8.
- **Solo** and **Latch** are Scene Switcher's two modes exactly
  (`SCENE_SWITCHER_MODE_HOLD` / `_LATCH`), including its overlap rule: **newest
  onset wins**. Reuse that predicate verbatim so the two switchers cannot
  disagree about what a chord means.

**One reserved row: "None"** (pitch 59, below the child block) — under Latch
there is otherwise no way to say "back to nothing". The Mover's Return row is the
precedent.

### Chain order is CHILD order, never onset order

A held chord composes in child order regardless of the order the notes were
played or where the playhead entered them. Chain order is spatial semantics —
the guide's own example is that a Motion *above* an Impact Scatter drifts the
object away from the blast while *below* it the blast stays full strength — so
letting performance order set it would mean the same held chord renders
differently depending on how you got there, and scrubbing into a simultaneous
onset would have no defined answer.

---

## 4. An empty lane is inert — and now it falls out

**With no notes anywhere on the switcher, every child runs, as if the switcher
weren't there.** This is not a special case any more: an empty lane is just the
full subset, which by §1 is the transparent span.

It matches the codebase's standing non-destructive convention — word-formation
lanes, and the `scene` composition def, which exists *precisely because* Scene
Switcher rendering nothing until played made a freshly dropped track look broken.
Wrapping devices in a switcher must never change the picture until you play it.

The discontinuity, which is the same one `scene` documents and should be written
at the definition: **drawing the first note narrows the set to what the mode
says.** Under every mode that is the point; it is still surprising the first time.

---

## 5. What "off" means, per child kind

| child kind | off = |
|---|---|
| mover / splitter / colorizer | entry skipped; the copy passes through unchanged (identity), never hidden or dropped |
| instrument track | `blackedOut` this frame — the object stays mounted, renderers set `visible = false` |

**The gate is binary.** Same argument Bypass makes: a device's contribution is a
matrix (or a copy count), and half a mover is not a well-defined interpolation of
one. Crossfades have homes already — automate the children's params, or use
Visibility.

`blackedOut` is already the right channel for 2b and already threaded everywhere
it needs to be: `ObjectRenderer` (`g.visible`), `ShaderWrapper`, every
post-process instrument's `resolveActiveX`, and `instrumentFrame`'s signature
buffer, so a paused edit repaints. Today it is `obj.muted`, a resolve-time
constant; 2b makes it `obj.muted || switcherOff(beat)`.

---

## 6. Composition with what already exists

- **Mute / solo among children are authoring overrides and win over MIDI.** A
  muted child is never live; a soloed child is always live. Otherwise "audition
  this one" is impossible on the track where you most want it.
- **A Bypass under the switcher** gates the whole span. **A Bypass under a child**
  gates that child. Both fall out; both deserve a test.
- **Automation lanes on a child keep sampling while the child is off.** Pure
  functions of the beat with no state, so a child comes back on at the value it
  would have had. Freezing on deselect would need retained state.
- **`warpBeat` (Freeze) is gated, and gated on the REAL beat.** Follow
  `bypassGated` exactly: `apply` gates on `context.beat` (post-warp), `warpBeat`
  on the playhead beat it is handed. Note `copyTargets` deliberately does *not*
  gate `warpBeat` — a switcher is the opposite case, and the difference should be
  stated at both sites.
- **`copyTargets` and `targets` live on the switcher** and apply to the whole
  span — every spliced entry gets the same wrapper. A child's own `copyTargets`
  still composes inside.
- **Switchers nest.** `flattenTree`'s cycle guard already covers it.

---

## 7. Copy count: you don't have to give anything up

You said you're fine with beat-dependent copy count. Worth knowing that the
engine already gives you it for free, and what it actually costs.

The mounted pool is sized once per resolve by `structuralCopyCount`, which probes
the chain with each entry's `structuralVariants` rank swapped in and takes the
max. Frames producing fewer copies are padded with hidden ones. So the count may
vary per beat; what is fixed is the **ceiling**. Nothing is violated, and no new
machinery is needed — this is exactly the exit Bypass takes.

The real cost is the size of that ceiling, and **the mode controls it**:

- **Gate / Toggle** — every child can be live at once, so the ceiling is the
  **product** of the children's fan-outs. Each gated entry publishes its ungated
  self at `structuralVariants[0]`, so rank 0 probes "everything active". Three
  grid splitters of 9 = a 729-copy pool, mounted permanently, even if you only
  ever hold one row.
- **Solo / Latch** — at most one child is live, so the ceiling is the **max** over
  children. Express it within the existing probe: give gated entry *i* a variants
  array of length N that is `identity` everywhere except index *i*, where it is
  the ungated child. Rank *r* then probes "only child *r* running" — precisely
  the exclusive maximum.

So exclusivity *saves* the pool rather than costing it, and the two arms of the
mode want different variant publications. Get that wrong in the Gate direction
and you get a pool of one at beat 0 that overflows on every later frame (the bug
`bypass.ts` describes); wrong in the Solo direction and you merely over-mount.

**Recommendation:** the settings panel shows the ceiling ("mounts up to N
copies"). It is the one number that explains why a switcher of splitters got
slow, and the engine already knows it.

---

## 8. Sharp edges worth stating up front

- **Toggle's parity does not self-correct.** A child is on when it has an odd
  number of onsets before the beat — pure and deterministic, but inserting or
  deleting one note flips that child for the *entire rest of the timeline*.
  Latch has the same class of edit but heals at the next onset; Toggle never
  does. It is the price of not holding notes, and it should be said in the panel,
  not discovered.
- **A switcher does not save the cost of what it hides.** For 2b all children
  stay mounted; for 2a the pool is sized at the ceiling. It is a compositional
  device, not a performance one.
- **Purity holds for all four modes** — each is a closed-form function of
  `(notes, beat)`, so paused == scrubbed == exported.

---

## 9. Traps for whoever implements it

1. **`isChainEntryTrack` must become a COUNT, not a boolean.** A track now
   contributes 0 entries (Bypass), 1 (ordinary device) or N (switcher). Four
   sites re-walk `childIds` to line lanes up against the already-resolved chain —
   `resolveMoverAndSplitterChain`, `weaveSplitterTfLanes` (`chainIndex++` becomes
   `chainIndex += n`), `weaveTfAutomationLanes` (its `gapByChildId` must count N),
   and `priorChainPrefixes`. `resolve.ts:376` already warns that a walk
   disagreeing by one track weaves every lane into the wrong slot; with N-entry
   children that stops being a hazard and becomes a certainty. One shared
   `chainEntryCount(track, p)` is the fix.
2. **`composition` (`'local'` vs `'chainRoot'`) stays per child.** Because the
   children are spliced as real entries rather than folded into one, each keeps
   its own declaration and `splitterChildChain` anchors each correctly. This is a
   second reason splicing beats delegating — the delegate design had no honest
   answer for a mixed set.
3. **`applyFramed` needs forwarding per gated entry**, following `bypassGated`'s
   shape — omit `internalTransform` when off, so the kernel reads it as "no
   internal motion contributed".
4. **A new `TrackType` and a new `Track` field are additive in persistence** — no
   upgrade step, matching how `group` landed. But `switcherBindings` must still be
   added to `ProjectDocument` (`persistence/types.ts`) to keep the type honest,
   per invariant 1 in the root guide.
5. **`resolveDeps`** must include the switcher's notes and bindings, or lane edits
   won't re-resolve (`resolveReuse.test.ts` is the tripwire).
6. **Test placement**: a colocated test under `core/visualCopies/` runs in
   `npm run test:visual` today. A test in a directory the script's glob doesn't
   name is silently never run.

The test that pins the whole design: **Gate with every row held must produce a
matrix-identical result to the same devices as plain siblings** (§1). That single
assertion catches ordering bugs, gate-wrapper bugs and splice-position bugs at
once — it is this feature's `splitterSize.test.ts`.

---

## 10. The MIDI lane

- One row per child, in child order, from `switcherBindings: Array<{ pitch,
  childTrackId }>`, mirroring `sceneBindings` — including
  `orderedSceneBindings`' self-healing walk and a single shared
  `seedSwitcherBindings`.

  **Do not derive the pitch from the child's index.** A row's pitch is the saved
  value; deriving it means reordering or deleting a child silently re-times every
  note on the lane. Already written down in three places (Strobe's frozen rows,
  `colorizer.ts`, `sceneBindings.ts`) and the easiest thing to get wrong here.

- **A row wears its child's identity colour** — `sceneRowColor.ts`'s convention
  (the row IS the thing it selects), with the same achromatic fallback so rows
  still tell each other apart.

- `generateInstrumentRows` renders in the order given and dims orphan pitches, so
  a removed child's notes never silently vanish.

---

## 11. Integration points

| what | where |
|---|---|
| `TrackType` + `switcherBindings` | `src/editor/types.ts` |
| splice + `chainEntryCount` | `core/visual/resolve.ts` |
| the gate + mode evaluation | `core/visualCopies/switcher.ts` |
| per-frame member gate (2b only) | `core/visual/VisualEngine.ts` (`blackedOut`) |
| create / wrap-selection / binding self-heal | `store/ProjectStore.ts` (beside `groupTracks`) |
| "Wrap in a switcher" | `components/timeline/TrackContextMenu.tsx` |
| library card (a card for a non-instrument, like Word Formation) | `components/LeftSidebar.tsx` |
| rows | `components/midi/resolveDeclaredRows.ts` |
| panel (2 selects, child list, copy-ceiling readout) | `userInterfaceRenderers/` |

```ts
// core/visualCopies/switcher.ts

/** Which children are live at `beat`, as child indices in CHILD order.
 *  Pure, and the only place the mode is read - so the panel, the roll's row
 *  highlight and the stage cannot disagree. An empty lane returns all. */
export function liveChildrenAt(
  bindings: readonly { pitch: number; index: number }[],
  notes: readonly ResolvedNote[],
  settings: SwitcherSettings,   // voices × notes
  beat: number,
): number[]

/** One spliced child, switched by the shared gate. Mirrors bypassGated,
 *  including the warpBeat arm and the structuralVariants publication - whose
 *  SHAPE depends on the mode (see §7). */
export function switchGated(
  entry: MoverOrSplitter,
  isLive: (beat: number) => boolean,
  variants: MoverOrSplitter[],
): MoverOrSplitter
```

---

## 12. Decisions I'd want from you

1. **Devices first, or objects too?** I recommend devices (§2a) — it is your
   case, and the object arm is a separate change to the render path.
2. **The name.** "Switcher" collides with the Main-scene **Scene Switcher**. The
   parallel is real (both bind pitches to a list and pick from it), so it may be
   a feature. Alternatives: **Switch**, **Selector**, **Rack**, **A/B**.
3. **Ship all four modes, or Gate + Latch first?** Toggle carries the §8 hazard
   and is the one I'd hold back if you want a smaller first cut.
4. **`type: 'switcher'`, or a MODE on `group`?** A group already carries the
   transform, opacity cascade and broadcasts an object switcher wants. Against:
   a group holding *devices* is not a thing today, and the two need different row
   vocabularies and panels. I lean separate type, **reusing `ResolvedGroup`** for
   the placement arm.
