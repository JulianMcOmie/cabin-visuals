import type { LyricClip, LyricClipLayout, LyricNotePayload, StyleLane } from '../../types'

/**
 * Lyric clips + style lanes: how a Text Display track gets its words and looks.
 *
 * The 2026-08 text/MIDI redesign (reference mock: text-midi-v5): the instrument
 * itself holds NO text. Words live in lyric CLIPS - timeline spans that each
 * own one phrase - and a note takes the next unclaimed word from the clip its
 * beat falls inside. Note PITCH picks a `StyleLane` (font/color/size/fx), so
 * height styles the word. Word binding is local: pasting or moving WORD notes
 * can never shift words outside their own clip.
 *
 * A clip is itself a NOTE (schema v16), at `PITCH_LYRIC_CLIP`, carrying its
 * phrase in `Note.lyric`. That is the whole reason the piano roll has no clip
 * gesture code: clips are drawn, dragged, resized, boxed, copied, pasted and
 * deleted by the note gestures that already existed, and a clip rides its
 * block like any note. (Consequence, chosen deliberately: copying a region now
 * copies its clips WITH their words - selecting a phrase and its notes and
 * pasting them elsewhere reproduces the whole phrase, which is the point.)
 *
 * Everything here is a pure function of (clips, lanes, note stream) - the one
 * rule. This module has NO three/react imports so instrument tests can load it
 * directly (see instruments/CLAUDE.md on the registry import cycle).
 */

/** Lane i lives at pitch STYLE_PITCH_TOP - i (top lane = highest row). FROZEN:
 *  projects store pitches, so remapping would restyle every saved song. The
 *  band sits above the punctuation rows (pop 47 / zoom flash 46) with room for
 *  MAX_STYLE_LANES lanes before touching them. */
export const STYLE_PITCH_TOP = 60
export const MAX_STYLE_LANES = 8

/** Punctuation rows, kept from the pre-clip instrument (frozen pitches). */
export const PITCH_BASS_POP = 47
export const PITCH_ZOOM_FLASH = 46

/**
 * The row lyric CLIPS live on. Since schema v16 a clip is an ordinary Note at
 * this pitch carrying a `lyric` payload, rather than a track-level array — so
 * every roll gesture (draw, drag, resize, marquee, copy/paste, delete, undo)
 * works on clips with no bespoke code, and a clip rides its block the way a
 * note does.
 *
 * FROZEN, like the lane pitches: projects store it. It sits one above
 * STYLE_PITCH_TOP so it can never collide with a style lane (which occupy
 * STYLE_PITCH_TOP down to STYLE_PITCH_TOP - MAX_STYLE_LANES + 1) — which is
 * also why `laneIndexForPitch` already rejects it, and therefore why a clip
 * note can never be mistaken for a word note.
 */
export const PITCH_LYRIC_CLIP = STYLE_PITCH_TOP + 1

export const isLyricClipNote = (note: { pitch: number }) => note.pitch === PITCH_LYRIC_CLIP

/**
 * The ONE instrument whose pitch-61 notes are lyric clips. Every other
 * instrument's C#4 is an ordinary note, and the engine must treat it as one:
 * keying the clip split on pitch alone silently deleted C#4 from every Midi
 * Roll, cube and laser in the app (found 2026-08-22 - "some of the notes
 * don't show"). Anything that special-cases `isLyricClipNote` outside a text
 * track's own editor must gate on this first.
 */
export const LYRIC_INSTRUMENT_ID = 'textDisplay'
export const carriesLyricClips = (track: { instrumentId?: string }) => track.instrumentId === LYRIC_INSTRUMENT_ID

/** The default phrase payload a freshly drawn clip note carries. */
export function emptyLyricPayload(): LyricNotePayload {
  return { words: [], layout: { kind: 'one' } }
}

/**
 * The clips a note stream declares, in the `LyricClip` shape every consumer
 * already reads. Beats pass straight through, so feeding this the ENGINE's
 * flattened notes yields absolute-beat clips (loop repeats included, each
 * tiled copy its own clip) while feeding it one block's notes yields
 * block-relative ones — the caller's frame of reference wins, exactly as it
 * does for notes.
 */
export function clipsFromNotes(notes: readonly LyricClipSource[]): LyricClip[] {
  const clips: LyricClip[] = []
  for (const n of notes) {
    if (!isLyricClipNote(n)) continue
    clips.push({
      id: n.id ?? '',
      startBeat: n.startBeat ?? n.beat ?? 0,
      durationBeats: n.durationBeats,
      words: n.lyric?.words ?? [],
      layout: n.lyric?.layout ?? { kind: 'one' },
    })
  }
  return clips
}

/**
 * A track's clips in ABSOLUTE project beats, sorted — the vocabulary the
 * panels, the store actions and the tests speak, since a clip's identity and
 * timing are how a human refers to it. The ENGINE deliberately does not use
 * this: it derives clips from the FLATTENED stream instead, so a looped block's
 * repeats each become their own clip.
 */
export function trackLyricClips(
  blocks: readonly { startBar: number; notes: readonly LyricClipSource[] }[],
  beatsPerBar: number,
): LyricClip[] {
  const clips: LyricClip[] = []
  for (const b of blocks) {
    const offset = b.startBar * beatsPerBar
    for (const c of clipsFromNotes(b.notes)) clips.push({ ...c, startBeat: c.startBeat + offset })
  }
  return sortedClips(clips)
}

/** Either note shape: an authoring `Note` (`startBeat`, block-relative) or a
 *  resolved one (`beat`, absolute). The engine hands over the latter. */
export interface LyricClipSource {
  id?: string
  pitch: number
  durationBeats: number
  startBeat?: number
  beat?: number
  lyric?: LyricNotePayload
}

export const styleLanePitch = (index: number) => STYLE_PITCH_TOP - index

/** The lane a pitch addresses, or -1 when the pitch is outside the lane band. */
export function laneIndexForPitch(pitch: number, laneCount: number): number {
  const i = STYLE_PITCH_TOP - pitch
  return i >= 0 && i < laneCount ? i : -1
}

/** The shipped lane set. PLAIN (index 2) is the migration target for legacy
 *  pitch-48 word notes - see persistence/upgrade.ts v15. Font indices address
 *  Text Display's FONT_STACKS (append-only, so these are stable). */
export function defaultStyleLanes(): StyleLane[] {
  return [
    { name: 'TITLE', font: 0, color: '#facc15', size: 1.9 },
    { name: 'ACCENT', font: 6, color: '#f472b6', size: 1.35 },
    { name: 'PLAIN', font: 0, color: '#ffffff', size: 1 },
    { name: 'WHISPER', font: 1, color: '#9aa1ab', size: 0.65 },
    { name: 'GLITCH', font: 2, color: '#38bdf8', size: 1, fx: ['shake'] },
  ]
}

/** Fold a track's stored lanes over the defaults so every consumer reads a
 *  complete record (same convention as mergeFormationSettings had). A track
 *  with no lanes gets the default set; a saved lane keeps whatever it stored. */
export function resolveStyleLanes(stored?: StyleLane[]): StyleLane[] {
  if (!stored || stored.length === 0) return defaultStyleLanes()
  return stored.slice(0, MAX_STYLE_LANES).map((lane, i) => ({
    name: lane.name || `LANE ${i + 1}`,
    font: Number.isFinite(lane.font) ? Math.max(0, Math.round(lane.font)) : 0,
    color: lane.color || '#ffffff',
    size: Number.isFinite(lane.size) ? Math.max(0.1, Math.min(4, lane.size)) : 1,
    ...(lane.fx && lane.fx.length ? { fx: lane.fx } : {}),
  }))
}

// ── Text entries (moved verbatim from TextDisplay.tsx) ──────────────────────
// One display unit: a word, a grouped `!phrase!`, or one `|syl|` of a word.
// Syllable entries render as a highlighted slice of the full word's layout.

export interface TextEntry {
  text: string
  layoutText: string
  syllableStart: number
  syllableCount: number
  cacheKey: string
}

export function singleTextEntry(text: string): TextEntry {
  return { text, layoutText: text, syllableStart: 0, syllableCount: 1, cacheKey: text }
}

function entriesForWord(raw: string): TextEntry[] {
  if (!raw.includes('|')) return [singleTextEntry(raw)]

  const parts = raw.split('|').filter((p) => p.length > 0)
  if (parts.length <= 1) return parts.length === 1 ? [singleTextEntry(parts[0])] : []

  const layoutText = parts.join('')
  const entries: TextEntry[] = []
  let start = 0
  for (const part of parts) {
    entries.push({
      text: part,
      layoutText,
      syllableStart: start,
      syllableCount: parts.length,
      cacheKey: `${layoutText}|${start}|${part}`,
    })
    start += part.length
  }
  return entries
}

function parsePipeAwareSegment(segment: string): TextEntry[] {
  const result: TextEntry[] = []
  let i = 0

  while (i < segment.length) {
    while (i < segment.length && /\s/.test(segment[i])) i++
    if (i >= segment.length) break

    if (segment[i] === '|') {
      const close = segment.indexOf('|', i + 1)
      if (close !== -1) {
        const grouped = segment.slice(i + 1, close).trim()
        if (grouped) {
          if (/\s/.test(grouped)) result.push(singleTextEntry(grouped))
          else result.push(...entriesForWord(grouped))
        }
        i = close + 1
        continue
      }
    }

    const start = i
    while (i < segment.length && !/\s/.test(segment[i])) i++
    result.push(...entriesForWord(segment.slice(start, i)))
  }

  return result
}

/** Parse free text into display entries: whitespace separates words, `!...!`
 *  keeps a phrase together as one entry, `|inside|` a word splits syllables,
 *  and `|... ...|` groups words. (TextDisplay's classic grammar, unchanged.) */
export function parseTextEntries(text: string): TextEntry[] {
  const result: TextEntry[] = []
  const parts = text.split('!')
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      // Inside !...!: the whole run is one entry.
      const grouped = parts[i].trim()
      if (grouped) result.push(singleTextEntry(grouped))
    } else {
      result.push(...parsePipeAwareSegment(parts[i]))
    }
  }
  return result
}

/** A clip's words expanded to display entries (each `|syl|la|ble|` word costs
 *  one note per syllable, exactly like the old Text param did). */
export function clipEntries(clip: LyricClip): TextEntry[] {
  return parseTextEntries(clip.words.join(' '))
}

// ── Resolution: which note sings which word, in which style ─────────────────

export interface ResolvedLyricWord {
  /** null = the note starved (no clip under it, or its clip ran out of words).
   *  Renders nothing; the editor shows the note as an orphan. */
  entry: TextEntry | null
  /** Style lane the note's pitch addresses (clamped valid by construction). */
  laneIndex: number
  /** Index into the sorted `clips` array, -1 when no clip contains the note. */
  clipIndex: number
  /** This word's seat within its clip (entry order), -1 when starved. */
  slotIndex: number
  /** The clip's total entry count (seats reserved for layout math). */
  totalSlots: number
  layout: LyricClipLayout
}

const FALLBACK_LAYOUT: LyricClipLayout = { kind: 'one' }

/** Clips in resolution order. On overlap the LATER-starting clip wins a beat
 *  (the more specific phrase). */
export function sortedClips(clips: readonly LyricClip[]): LyricClip[] {
  return [...clips].sort((a, b) => a.startBeat - b.startBeat)
}

/**
 * Bind a text track's word-note stream to its clips. `notes` must be the
 * style-lane-band notes sorted by beat (the caller filters pitches); each
 * consumes the next unclaimed entry of the clip containing its beat. No
 * cycling: a clip that runs out of entries starves later notes (visible as
 * orphans) rather than silently wrapping - re-indexing is exactly the bug
 * this model exists to kill.
 */
export function resolveLyricWords(
  notes: readonly { beat: number; pitch: number }[],
  clips: readonly LyricClip[] | undefined,
  laneCount: number,
): ResolvedLyricWord[] {
  const ordered = clips && clips.length ? sortedClips(clips) : []
  const entryLists = ordered.map(clipEntries)
  const used = new Array<number>(ordered.length).fill(0)

  return notes.map((n) => {
    const laneIndex = Math.max(0, laneIndexForPitch(n.pitch, laneCount))
    let clipIndex = -1
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i]
      if (n.beat >= c.startBeat - 1e-6 && n.beat < c.startBeat + c.durationBeats - 1e-6) clipIndex = i
      else if (c.startBeat > n.beat) break
    }
    if (clipIndex < 0) {
      return { entry: null, laneIndex, clipIndex: -1, slotIndex: -1, totalSlots: 0, layout: FALLBACK_LAYOUT }
    }
    const slot = used[clipIndex]++
    const entries = entryLists[clipIndex]
    return {
      entry: entries[slot] ?? null,
      laneIndex,
      clipIndex,
      slotIndex: entries[slot] ? slot : -1,
      totalSlots: entries.length,
      layout: ordered[clipIndex].layout ?? FALLBACK_LAYOUT,
    }
  })
}

// ── Transcription → clips ───────────────────────────────────────────────────

export interface PlacedLyricWord {
  word: string
  startBeat: number
  durationBeats: number
}

/**
 * Cut a placed word stream into per-line lyric clips - the beat-space sibling
 * of utils/lyricPlacement's groupTimingIntoLines (sentence-ending punctuation,
 * long gaps, or a word cap start a new line). Each clip spans from its first
 * word's beat to the next clip's start (the last runs 2 beats past its end),
 * so every word note lands inside exactly one clip. `grouped` wraps each line
 * in `!...!` so ONE note shows the whole line (the lines display mode).
 */
export function clipsFromPlacedWords(
  placed: readonly PlacedLyricWord[],
  { maxWords = 8, gapBeats = 2, grouped = false }: { maxWords?: number; gapBeats?: number; grouped?: boolean } = {},
): LyricClip[] {
  if (placed.length === 0) return []
  const lines: PlacedLyricWord[][] = []
  let current: PlacedLyricWord[] = []
  for (let i = 0; i < placed.length; i++) {
    const w = placed[i]
    current.push(w)
    const next = placed[i + 1]
    const sentenceEnd = /[.!?…]["”’)]*$/.test(w.word.trim())
    if (sentenceEnd || current.length >= maxWords
      || (next !== undefined && next.startBeat - (w.startBeat + w.durationBeats) >= gapBeats)) {
      lines.push(current)
      current = []
    }
  }
  if (current.length > 0) lines.push(current)

  return lines.map((line, i) => {
    const start = line[0].startBeat
    const lastEnd = line[line.length - 1].startBeat + line[line.length - 1].durationBeats
    const end = i + 1 < lines.length ? lines[i + 1][0].startBeat : lastEnd + 2
    return {
      id: crypto.randomUUID(),
      startBeat: start,
      durationBeats: Math.max(0.25, end - start),
      words: grouped ? [`!${line.map((w) => w.word).join(' ')}!`] : line.map((w) => w.word),
      layout: { kind: 'one' as const },
    }
  })
}

// ── Seat math for the positional layouts ────────────────────────────────────

export interface ClipSlotOffset {
  x: number
  y: number
  z: number
}

/**
 * Where a slot sits for the positional layouts (grid/circle), in LATTICE units
 * (grid spacing 1 / circle radius 1) centered on the origin - the instrument
 * scales into world units. Words are placed by SLOT, not arrival order, so
 * seats stay reserved and nothing re-flows as words land (the same contract
 * the Stack layout has always kept). Returns null for the flow layouts
 * (one/row/stack/scatter), which place words by their own machinery.
 */
export function clipSlotOffset(layout: LyricClipLayout, slot: number, total: number): ClipSlotOffset | null {
  if (layout.kind === 'grid') {
    const cols = Math.max(1, Math.round(layout.cols ?? 2))
    const rows = Math.max(1, Math.ceil(total / cols))
    const col = slot % cols
    const row = Math.floor(slot / cols)
    return { x: col - (cols - 1) / 2, y: (rows - 1) / 2 - row, z: 0 }
  }
  if (layout.kind === 'circle') {
    const n = Math.max(1, total)
    const a = -Math.PI / 2 + (slot / n) * Math.PI * 2
    return { x: Math.cos(a), y: -Math.sin(a), z: 0 }
  }
  return null
}
