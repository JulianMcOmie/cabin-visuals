// The pure half of the Particle Field instrument (type-only imports, so the
// colocated test can load it without tripping the instrumentFrame -> registry
// import cycle - see this directory's CLAUDE.md).
//
// The model: a screen-filling slab of particles sits at deterministic ambient
// positions forever. When a text note plays, the K particles whose ambient
// homes are NEAREST the text anchor are recruited and fly to glyph target
// points; everyone else never moves. Recruitment, timing and the field itself
// are all pure functions of (params, notes, beat) - scrub equals playback.

/** Deterministic 0..1 hash (no Math.random anywhere in this module). */
export function fieldHash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/**
 * The ambient field: `count` particles spread uniformly over a width x height
 * slab with `depth` of z jitter. Positions never depend on the beat - the
 * field is furniture, only the recruited particles travel.
 */
export function fieldPositions(count: number, width: number, height: number, depth: number): Float32Array {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    out[i3] = (fieldHash(i * 3.1) - 0.5) * width
    out[i3 + 1] = (fieldHash(i * 3.1 + 1.3) - 0.5) * height
    out[i3 + 2] = (fieldHash(i * 3.1 + 2.6) - 0.5) * depth
  }
  return out
}

/**
 * The `k` particles whose ambient (x, y) is nearest the text anchor, ordered
 * nearest-first. Rank r forms glyph target r, so the letters condense from
 * their immediate surroundings and the far field visibly never changes.
 */
export function recruitNearest(
  ambient: Float32Array,
  count: number,
  k: number,
  centerX: number,
  centerY: number,
): Uint32Array {
  const order = new Array<number>(count)
  const dist = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    order[i] = i
    const dx = ambient[i * 3] - centerX
    const dy = ambient[i * 3 + 1] - centerY
    dist[i] = dx * dx + dy * dy
  }
  order.sort((a, b) => dist[a] - dist[b])
  const take = Math.max(0, Math.min(k, count))
  const out = new Uint32Array(take)
  for (let r = 0; r < take; r++) out[r] = order[r]
  return out
}

export interface TextOnset {
  beat: number
  endBeat: number
}

export interface FieldTimeline {
  /** Index into the onset list of the text currently forming, -1 for none. */
  curIndex: number
  /** 0..1 formation progress of the current text (pre-ease, pre-stagger). */
  curProgress: number
  /** 0..1 dissolve progress of the current text (0 while held / sustained). */
  curRelease: number
  /** The onset before it, still flying home, -1 for none. */
  prevIndex: number
  /** 0..1 dissolve progress of the previous text (1 = fully home). */
  prevRelease: number
}

/**
 * Where each text is in its form/dissolve life at `beat`. With `sustain` a
 * text holds until the next onset takes over; without it, dissolve starts at
 * note-off. Only the previous onset is tracked besides the current one -
 * deeper overlaps are already home (or close enough that snapping is unseen).
 */
export function fieldTimeline(
  onsets: TextOnset[],
  beat: number,
  formBeats: number,
  releaseBeats: number,
  sustain: boolean,
): FieldTimeline {
  const none: FieldTimeline = { curIndex: -1, curProgress: 0, curRelease: 0, prevIndex: -1, prevRelease: 1 }
  let cur = -1
  for (let i = 0; i < onsets.length; i++) {
    if (onsets[i].beat <= beat) cur = i
    else break
  }
  if (cur < 0) return none

  const form = Math.max(1e-3, formBeats)
  const release = Math.max(1e-3, releaseBeats)
  const cn = onsets[cur]
  const curProgress = Math.max(0, Math.min(1, (beat - cn.beat) / form))
  const curRelStart = sustain ? Infinity : cn.endBeat
  const curRelease = beat <= curRelStart ? 0 : Math.max(0, Math.min(1, (beat - curRelStart) / release))

  let prevIndex = -1
  let prevRelease = 1
  if (cur > 0) {
    const pn = onsets[cur - 1]
    // Sustained texts hand off at the next onset; otherwise dissolve began at
    // the note's own end (never later than the handoff).
    const relStart = sustain ? cn.beat : Math.min(pn.endBeat, cn.beat)
    prevRelease = Math.max(0, Math.min(1, (beat - relStart) / release))
    if (prevRelease < 1) prevIndex = cur - 1
  }
  return { curIndex: cur, curProgress, curRelease, prevIndex, prevRelease }
}
