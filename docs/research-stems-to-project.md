# Song → Stems → MIDI → Auto-Project: Research

*Researched 2026-07-23/24. Prices and model landscape verified against live pages on those dates; anything I could not verify directly is flagged.*

The goal: user uploads a song, the app splits it into stems, converts each stem into MIDI
on its own track, transcribes/aligns the lyrics (already built), and lands a ready-made
project where every MIDI channel drives a visual instrument. This report covers steps 1–2
(stems, audio→MIDI) and how to bolt them onto the existing pipeline.

---

## 1. Do this (recommendation)

**Phase 1 — ship in days, ~$0.03–0.05/song added cost:**

| Step | Tool | Where it runs | Cost/song (4 min) |
|---|---|---|---|
| Stem split (vocals/drums/bass/other) | **htdemucs** via Replicate's public Demucs model | Replicate (T4/A40 GPU), async prediction + webhook | ~$0.02–0.05, ~60–120 s |
| Drums → kick/snare/hat MIDI lanes | **Hand-rolled onset detector + band classifier** on the drum stem (spectral flux; ~150 lines, mirrors the existing `detectBeats` style) | Browser (Web Audio, already decoding stems for playback) | $0 |
| Bass → bassline MIDI | **@spotify/basic-pitch** (TFJS, Apache-2.0) on the bass stem, post-filtered to lowest voice | Browser (web worker) | $0 |
| Vocals → melody MIDI | **@spotify/basic-pitch** on the vocal stem, post-filtered to top line + min-duration | Browser (web worker) | $0 |
| Lyrics | Existing ElevenLabs Scribe + forced alignment | Existing routes | existing cost |
| Project assembly | Existing `importMidiTracks` + `addLyricTrack` + `applyTemplate` | Browser | $0 |

Orchestration: a `stem_jobs` Supabase row + a small `/api/stems` route that creates the
Replicate prediction (passing the song's signed Supabase URL, same host-allowlist pattern
as `/api/transcribe`), a `/api/stems/webhook` route that copies Replicate's output WAVs
into the Supabase audio bucket and flips the row to `done`, and client polling every ~2 s
(the LyricSetupScreen already polls uploads this way). Total new server code: two routes.

**Phase 2 — quality + granularity, still <$0.15/song:** replace the public Replicate
model with one custom Modal (or Replicate Cog) container that runs **BS-RoFormer-SW
6-stem** (adds guitar + piano) *and* runs Basic Pitch + drum transcription server-side in
the same job, returning stems + MIDI JSON in one round trip. Add chords-for-the-"other"-stem
via Music.AI's chords module (~$0.12–0.16/song) or client-side chroma → triads.

**Avoid:** LALAL.AI API (≈$0.15/stem/min ⇒ ~$2.40 per 4-stem song), AudioShake and
Songscription (enterprise/sales-gated), Spleeter (2019 quality), essentia.js (AGPL) and
aubio (GPL) in the client bundle.

---

## 2. What already exists in the repo (integration surface)

Read on 2026-07-24:

- **`src/editor/components/LyricSetupScreen.tsx`** — the whole pipeline UX already
  exists as a phase machine: `pick → uploading → transcribing → aligning → ready`,
  with the style grid shown during the wait. Stems/MIDI slot in as two more phases
  (`splitting`, `converting`) between `uploading` and `transcribing` — or in parallel
  with transcription, since they're independent (both only need the uploaded file's
  signed URL). The screen already: waits out the background upload, waits for local
  decode (BPM + first-beat trim via `detectBeats`), then calls the API routes with
  `{ url, fileName }`.
- **`app/api/transcribe/route.ts` / `app/api/align/route.ts`** — the house pattern for
  audio-processing routes: client sends the *signed Supabase URL* (never bytes), route
  validates the host against `NEXT_PUBLIC_SUPABASE_URL`, fetches the audio itself,
  forwards to the vendor, `maxDuration = 60`, synchronous request/response. A stem
  split takes 1–3 minutes — too long for this synchronous shape, hence the async job
  recommendation below. (Transcribe currently uses ElevenLabs Scribe `scribe_v2`,
  word timestamps; align uses ElevenLabs forced-alignment.)
- **`src/editor/utils/loadAudioTrack.ts`** — one load pipeline: track lands
  immediately, decode fills duration, `detectBeats` sets project BPM and trims the
  clip to the first downbeat (`trimStart`). **Stems inherit this for free**: a stem is
  time-aligned sample-for-sample with the original file, so the original's
  `trimStart`/BPM apply to every stem-derived MIDI note. No per-stem beat detection
  needed.
- **MIDI import** (`src/editor/core/midiImport.ts` + `ProjectStore.importMidiTracks`,
  line ~1431) — the landing zone is already built. Converters only need to emit
  `ImportedMidiTrack[]`: `{ name, notes: {id, pitch, startBeat, durationBeats,
  velocity}[], endBeat }` with beats file-absolute; `importMidiTracks` blocks them on
  bar boundaries, names untitled tracks, assigns the default `cube` instrument, and
  returns track ids. Seconds→beats is `beat = (sec − trimStart) × bpm / 60`, the same
  math `placeTranscription` does for lyrics (which also keeps aligner-seconds as
  source of truth so BPM corrections re-derive beats — worth mirroring for MIDI:
  store the seconds alongside).
- **Deps**: `@tonejs/midi` + `midi-file` already present; `tone` provides the
  AudioContext; ffmpeg.wasm (`@ffmpeg/ffmpeg`) is already shipped, usable for
  client-side decode/downmix if needed.
- Memory-file constraints that bind here: media bytes are never deleted inline
  (stems become new bucket objects, reclaimed only by sweep); new instruments need
  registry + LeftSidebar; named `'Lyrics'` track is the refill contract — a similar
  naming contract (`'Drums'`, `'Bass'`, `'Vocal melody'`…) is the natural way to let
  templates restyle stem tracks.

---

## 3. Stem splitting — the options

### 3.1 Self-hosted / open models

| Model | Stems | Quality (SDR avg, MUSDB18-HQ) | Runtime, ~4-min song | License | Notes |
|---|---|---|---|---|---|
| **htdemucs** (Hybrid Transformer Demucs, Meta) | 4 | ~7.7 dB | ~30–60 s on T4/A40; ~4–6× realtime | MIT (code **and** weights) | The safe commercial default. Repo **archived Jan 1 2025** (maintainer left Meta; `adefossez/demucs` fork takes bug fixes only) — frozen but stable and everywhere. |
| **htdemucs_ft** (fine-tuned) | 4 | ~8.5 dB | 4× slower (~90–150 s per 3-min song) | MIT | Better, slower; on Replicate the per-call cost barely changes (overhead-dominated). |
| **htdemucs_6s** | 6 (+guitar, piano) | piano stem is weak (acknowledged in Demucs docs) | ~40–60 s | MIT | Cheap way to 6 stems, but piano quality is poor. |
| **Spleeter** (Deezer, 2019) | 2/4/5 | ~5.4 dB | 2–5 s (40–90× realtime) | MIT | Fast and cheap but audibly worse; bleed/artifacts. Only worth it if latency is everything. |
| **Open-Unmix (UMX)** | 4 | ~5.8 dB | fast | MIT | Research reference; superseded in practice. |
| **BS-RoFormer / Mel-Band RoFormer family** (ByteDance architecture, community weights) | varies; **BS-RoFormer-SW is 6-stem** (vocals, drums, bass, guitar, piano, other) | ~9.8 dB avg, ~11.3 dB bass — current open SOTA | ~60–120 s per 3-min song on A40; ~1.5–3× realtime | Architecture impl (lucidrains) MIT; **weights: per-checkpoint, see risks §6** | The 2024–2026 quality leader. Community checkpoints from ZFTurbo's MIT-licensed Music-Source-Separation-Training repo, `openmirlab/bs-roformer-infer` (23 catalogued checkpoints incl. BS-RoFormer-SW, up to a 53-stem MVSep mega model needing 16 GB VRAM), and `nomadkaraoke/python-audio-separator` (MIT wrapper over the UVR model zoo incl. Roformers). |
| **MuScriptor** (Mirelo + Kyutai, 2026) | n/a — it's transcription, listed for awareness | — | — | "open-weight," paper under review | Watch item, see §4. |

Sources: [MixingGPT 8-engine comparison, 2026](https://mixinggpt.com/blog/best-ai-stem-separation-tools-2026); [htdemucs vs BS-RoFormer vs Spleeter 2026 benchmark](https://aistemsplitter.org/blog/htdemucs-vs-bs-roformer-vs-spleeter-2026-benchmark); [facebookresearch/demucs](https://github.com/facebookresearch/demucs) (archived notice); [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training); [openmirlab/bs-roformer-infer](https://github.com/openmirlab/bs-roformer-infer); [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator). All accessed 2026-07-23/24.

**Can it run serverless? Yes — this is the normal way now.**

- **Replicate**: public Demucs models exist ([cjwbw/demucs](https://replicate.com/cjwbw/demucs):
  T4 hardware, ~90 s typical prediction, **~$0.02/run listed**; all htdemucs variants
  supported). The 2026 benchmark measured **~$0.045/song actual** across variants
  (cold start + model load overhead dominates, so `GPU-seconds × rate` underestimates
  ~2×). Replicate supports async predictions with **webhooks** — fits Vercel.
- **Modal**: per-second billing, T4 $0.000164/s, L4 $0.000222/s, A10G $0.000306/s
  (≈$0.59–1.10/hr). A 60 s htdemucs run ≈ **$0.01–0.02/song** compute; you write the
  container (python-audio-separator or bs-roformer-infer make this ~50 lines) and get
  to bundle MIDI conversion in the same job. Scale-to-zero, cold starts in seconds.
- **RunPod / Fal.ai**: comparable serverless GPU pricing; Fal has no first-party
  stem-separation endpoint I could verify — you'd deploy a custom container there too.
  No advantage over Modal/Replicate for this workload.
- **GPU needs**: htdemucs runs in <8 GB VRAM (T4 fine); BS-RoFormer-SW similar;
  only the exotic mega-stem checkpoints want 16 GB.

Sources: [Replicate cjwbw/demucs](https://replicate.com/cjwbw/demucs); [Modal GPU pricing 2026](https://www.spheron.network/blog/modal-gpu-pricing-2026-per-second-billing/) and [computeprices.com/providers/modal](https://computeprices.com/providers/modal); benchmark article above. Accessed 2026-07-24.

### 3.2 Hosted APIs

| Service | Pricing (verified) | Stems | API shape | Verdict for us |
|---|---|---|---|---|
| **Music.AI** (Moises' developer platform) | Per-minute by module, pay-as-you-go: drums $0.15/min, guitar $0.10/min, vocals $0.07–0.10/min, bass/keys/strings $0.05–0.07/min; chords/beats $0.03–0.04/min; $25/mo Professional adds credit + storage. A 4-stem 4-min song lands ≈ **$0.40–1.00+** | Very granular (drum kit pieces, guitar parts, strings, wind…) | Upload → workflow of chained modules → async job, webhooks; polished docs | Best hosted option *if* you want their granular stems + chords + beats in one vendor. ~10–20× the Replicate cost. Good phase-2/3 upgrade for "guitar parts" moat features. |
| **LALAL.AI** | ≈**$0.15 per stem per minute** (billing = file length × number of stem types); minute packs: $15/90 min … $90/900 min (Pro tier has API) | 10+ stem types (incl. drum kit split) | REST, async | ~$2.40 per 4-stem 4-min song — **too expensive** at your scale. |
| **AudioShake** | Not published; credits + "License: Proprietary," enterprise sales | Music + dialogue/FX (film-grade) | Clean REST: create task (URL or assetId, up to 20 targets), poll **or webhook**; also on-device SDK | Industry-best quality reputation (major-label licensed), but sales-gated. Overkill pre-revenue. |
| **Gaudio Studio (GSEP)** | Consumer: $7/50 min, $16/200 min, $50/1000 min (⇒ ~$0.14–0.56/song); developer API = contact | 4+ | Cloud API + on-device SDK | Fine quality, but API isn't self-serve. Skip. |
| **MVSep** | Free queued web processing; paid credits for speed; **has an API** but I could not fetch pricing/terms pages (404s on guessed URLs) | Huge model zoo incl. best community Roformers | REST | Cheapest access to SOTA checkpoints, but commercial terms unverified — **check before relying on it**. |
| **Klangio** | API: free 50 req (15 s max), **$99/mo for 500 req** then $0.20/req | Has separation, but its real product is transcription (see §4) | REST | Interesting for MIDI, not for stems. |

Sources: [music.ai/pricing](https://music.ai/pricing/); [LALAL.AI pricing](https://www.lalal.ai/pricing/) + [dev.to API comparison](https://dev.to/stevecase430/ai-stem-splitter-api-comparison-2026-stemsplit-vs-lalalai-vs-moises-with-benchmarks-372l); [AudioShake developer docs](https://developer.audioshake.ai/legacy-api/server-to-server); [Gaudio](https://www.gaudiolab.com/developers/products/stem-seperation) via [review](https://singify.fineshare.com/blog/ai-music-apps/gaudio-studio); [mvsep.com](https://mvsep.com/en); [klang.io/api](https://klang.io/api/). Accessed 2026-07-23/24.

---

## 4. Stem → MIDI

The key insight: **once you have clean stems, per-stem conversion is an easy problem**,
and the right tool differs by stem type. Full-mix multi-instrument transcription
(MT3-class models) is the hard research problem you get to skip.

### Per stem type

| Stem | Recommended | How | Alternatives |
|---|---|---|---|
| **Drums** | Onset detection + 3-band classification → kick/snare/hat lanes (write it yourself, ~150 lines) | Spectral-flux onsets on the drum stem; classify each hit by spectral centroid / band energy (<150 Hz ⇒ kick, 150 Hz–1 kHz broadband ⇒ snare, >5 kHz ⇒ hat); peak level → velocity. On a *separated* drum stem this is very reliable — the hard part (other instruments) is already removed. | **ADTOF** (5-class NN: +toms/cymbals); Magenta **OaF-Drums** (E-GMD, Apache-2.0, aging TF1 code); 2025 research pairs drum-kit *stem* separation with transcription for 7-class + velocity ([arXiv 2509.24853](https://arxiv.org/abs/2509.24853)). Phase 2+ if 3 lanes ever feel thin. |
| **Bass** | **Basic Pitch** on the bass stem | Post-process: keep lowest note per frame, min duration 0.05 beat, drop pitch bends. Bass is near-monophonic ⇒ Basic Pitch shines. | CREPE (monophonic f0, great accuracy) + your own note segmentation. |
| **Vocals → melody** | **Basic Pitch** on the vocal stem | Post-process: keep top line, merge glissandi, quantize onsets lightly. Note: you already have *word* timings from the aligner — intersecting Basic Pitch notes with word windows gives a "sung note per word" lane that's uniquely useful for lyric visuals. | CREPE for smoother monophonic contour; Mel-RoFormer vocal-melody research models (not packaged). |
| **Other/harmony → chords** | Phase 1: skip (or map Basic Pitch output raw — it's usable as "texture" MIDI). Phase 2: chord track | Hosted: Music.AI chords/beats $0.03–0.04/min (≈$0.12–0.16/song) or Klangio chord-recognition endpoint. Client: chroma-vector template matching (write yourself; avoid essentia.js — AGPL). Emit one MIDI triad per chord span. | Guitar/piano stems (6-stem model) through Basic Pitch each. |

### The converter libraries themselves

- **Spotify Basic Pitch** — the workhorse. Python (`basic-pitch`) *and* TypeScript
  (`@spotify/basic-pitch` 1.0.1 on npm, **TensorFlow.js — runs in the browser**,
  Apache-2.0). Instrument-agnostic, polyphonic, pitch bends, resamples input to
  22,050 Hz mono internally. API: `BasicPitch.evaluateModel(audioBuffer, …)` →
  `outputToNotesPoly` → `noteFramesToTime` → note events with pitch/start/duration/
  amplitude — a direct map onto `ImportedMidiTrack`. The TS repo is low-activity
  (v1.0.1 for years) but small, self-contained, and used in production demos
  (basicpitch.io runs entirely client-side). Also on Replicate ([rhelsing/basic-pitch](https://replicate.com/rhelsing/basic-pitch), CPU, **~$0.0023/run**) if you'd rather not ship TFJS.
  Browser cost: roughly real-time-ish on WebGL backend — a 4-min stem ≈ 20–60 s in a
  web worker; three stems can run concurrently while transcription waits anyway.
- **CREPE** — MIT, SOTA monophonic pitch; TFJS port exists. Use only if Basic Pitch's
  vocal output disappoints.
- **aubio** — GPL-3.0. Avoid in the client bundle; not needed anyway.
- **Omnizart** — multi-task transcription toolbox; unmaintained since ~2022; skip.
- **MT3 / YourMT3+** — full-mix multi-instrument transcription (Magenta / 2024). The
  [2025 AMT Challenge](https://arxiv.org/abs/2603.27528) winner (MIROS) extends
  YourMT3+ with a MusicFM backbone; all entrants still degrade badly on dense
  polyphony. Research-grade, heavy, and unnecessary once you have stems.
- **MuScriptor** (Mirelo + Kyutai, 2026) — new open-weight 1.3B multi-instrument
  audio→MIDI model, claims to beat YourMT3+ on real mixes; paper under review,
  packaging/license not yet settled ([muscriptor.github.io](https://muscriptor.github.io/)).
  **Watch item**: if it ships cleanly it could replace the per-stem converter stack
  with one model in the phase-2 container.
- **Klangio API** — hosted transcription (piano/guitar/bass/vocals → MIDI/MusicXML),
  plus beats + chords endpoints. $99/mo + $0.20/req. A credible "no ML ops at all"
  fallback, but per-request cost exceeds the entire Replicate stem job.
- **Songscription** — good consumer transcription; API is enterprise/sales-only. Skip.

### Client-side vs server-side conversion

Client-side (recommended for phase 1): the stems land in the browser anyway (they'll be
playable/scrubbable tracks), decoding via the existing Tone.js AudioContext; Basic Pitch
TFJS + a hand-rolled drum onset pass mean **zero added infra, zero per-song cost**, and
progress UI for free. Costs: ~3 MB model download (cacheable), CPU/GPU time on the
user's machine (workers keep the UI live — note the full-frame-canvas memory lesson:
don't run this during playback).

Server-side (phase 2): folding conversion into the same GPU job as separation removes
client variability, works on mobile, and opens the door to heavier models (MuScriptor,
ADTOF). Adds ~10–20 s GPU time ≈ $0.005.

---

## 5. Architecture for this app

### Constraints recap

- Vercel functions: `maxDuration = 60` today; even with Fluid compute's longer caps you
  don't want a function *waiting* on a 1–3 min GPU job — you want async.
- Supabase is already the file store + DB; the transcribe/align routes already enforce
  "signed Supabase URL in, never bytes."
- The client already runs a polling phase machine (upload progress) in LyricSetupScreen.

### Recommended flow (phase 1)

```
Browser                          Vercel                         Replicate            Supabase
───────                          ──────                         ─────────            ────────
upload song (existing)  ──────────────────────────────────────────────────────────►  audio bucket
POST /api/stems {url}   ──►  validate host, create stem_jobs row ─►  create
                             prediction {input: signed url,
                             webhook: /api/stems/webhook}                │
poll GET /api/stems/:id  ◄─  read stem_jobs row                          │ 60–120 s GPU
   every 2 s                                                             ▼
                             /api/stems/webhook: fetch 4 wavs,  ◄──  webhook fires
                             upload to audio bucket, write
                             stem paths + status='done'  ─────────────────────────►  stems stored
fetch stems, decode
run Basic Pitch (vox, bass) + drum onset pass in workers
importMidiTracks([...]) → named tracks 'Vocal melody','Bass','Kick','Snare','Hats'
addLyricTrack(...) (already parallel via transcribe/align)
applyTemplate(style)  → done
```

Notes:

- **`stem_jobs` table**: `id, user_id, project_id, clip_ref, provider_id, status
  (pending|running|done|failed), stem_paths jsonb, error, created_at`. RLS like the rest.
  Webhook + polling both go through it, so a dropped webhook degrades to "webhook route
  also reconciles by querying Replicate on poll" — never a stuck UI. Given the project-
  conflict memory rule, keep this table append-ish and idempotent (webhook may fire twice).
- **Signed URLs**: Replicate needs to fetch the song; use a short-lived signed URL from
  the private bucket (the same `getAudioUrl` the client already obtains — pass it
  through, host-validated, exactly like `/api/transcribe`).
- **Stems as first-class clips**: register each stem via the existing clip machinery
  (`addClip` with a ref pointing at the stored stem) so mute/solo per stem works and the
  "media bytes never deleted inline" rule is respected (stems are new bucket objects,
  sweep-reclaimed).
- **Timing**: stems are sample-aligned with the original ⇒ reuse the original block's
  `trimStart` + project BPM for seconds→beats. Store per-note seconds alongside (like
  `lyricTiming`) so BPM corrections re-derive beats.
- **Track naming contract**: name stem tracks predictably (`Drums · Kick`, `Bass`,
  `Vocal melody`, `Harmony`) so templates can restyle them the way `applyTemplate`
  already carries the `'Lyrics'` track across.
- **UX**: stems+MIDI run concurrently with transcribe+align; the style-grid wait
  already absorbs ~60 s, and the whole pipeline stays within the current "pick a look
  while it cooks" dwell time. Add `splitting`/`converting` status lines to the existing
  phase copy.

### Phase plan

1. **Phase 1 — drums-first demo (1–2 weeks):** Replicate htdemucs 4-stem; client-side
   drum lanes (kick/snare/hat) + Basic Pitch bass; wire into LyricSetupScreen; tracks
   land on default instruments with the naming contract. This alone is the "upload a
   song, watch the kick drive the visuals" wow. Cost ≈ $0.03–0.05/song.
2. **Phase 2 — full stems + quality (2–4 weeks):** custom Modal/Cog container:
   BS-RoFormer-SW 6-stem (license-check the exact checkpoint first — see §6) + server-side
   Basic Pitch per stem + drum transcription, one job returning stems + MIDI JSON.
   Vocal-melody∩word-timing lane. Chord track (Music.AI chords module or client chroma).
   Cost ≈ $0.03–0.15/song depending on chords vendor.
3. **Phase 3 — moat features:** granular stems (Music.AI drum-kit pieces / guitar
   parts) for premium tier; evaluate MuScriptor as a single-model transcriber;
   template packs that map the named stem tracks to curated instrument stacks.

### Cost per 4-min song at small scale (100–1,000 songs/mo)

| Stack | $/song |
|---|---|
| Phase 1 (Replicate htdemucs + client MIDI) | **$0.02–0.05** |
| Phase 2 (Modal custom container, all server-side) | **$0.02–0.06** (+$0.12–0.16 if Music.AI chords) |
| Music.AI end-to-end (stems + chords + beats) | $0.55–1.20 |
| LALAL.AI 4 stems | ~$2.40 |
| Klangio per-track transcription (4 stems) | ~$0.80 + $99/mo floor |

At ≤1,000 songs/mo, serverless GPU is unambiguously right; the benchmark article's
break-even for renting dedicated GPUs was ~$2k/mo of inference spend — orders of
magnitude away.

---

## 6. Licensing / ToS risks

- **htdemucs (Demucs)**: MIT code and weights — clean for commercial SaaS. Risk is
  *maintenance* (archived Jan 2025), not license. Pin versions; the model is frozen
  and that's fine.
- **BS-RoFormer-family weights**: the architecture implementations (lucidrains,
  bs-roformer-infer, python-audio-separator) are MIT. The *checkpoints* are trained by
  community members (ZFTurbo, jarredou, unwa, Kim, …). ZFTurbo's repo — which
  distributes many of them — is MIT (license added Nov 2024), and the common reading is
  the release assets inherit MIT; but several popular UVR/MVSep-derived checkpoints
  circulate with unclear or non-commercial intent, and *training-data provenance is
  undocumented for nearly all of them*. **Action: before phase 2, check the specific
  checkpoint's release page/HF card for its license line, keep a record, and prefer
  checkpoints published in explicitly MIT repos.** This is the one genuine legal
  gray zone in the self-hosted path.
- **Basic Pitch**: Apache-2.0 (Python and TS). Clean. CREPE: MIT. Clean.
- **essentia.js (AGPL-3.0)** and **aubio (GPL-3.0)**: copyleft — do not put in the
  client bundle of a proprietary app. Not needed anyway.
- **Hosted APIs**: LALAL.AI, Music.AI, Klangio, Gaudio all put rights responsibility on
  the customer ("you warrant you have rights to the audio you process") — same posture
  the app already takes with ElevenLabs transcription of user uploads. AudioShake is the
  outlier that actively vets/licenses usage (it's built for rightsholders); their
  proprietary license + sales process is heavier than needed here.
- **Product-level exposure**: stem-splitting a copyrighted song creates derivative
  audio. For *user-owned* songs (your target: artists making videos of their own music)
  this is a non-issue; the ToS should state users must own/control uploaded audio —
  which the lyric-transcription feature already implies. The demo song
  (Tame Impala) being run through *separation and re-hosted stems* is more exposed than
  transcription was; consider swapping the demo to a rights-cleared track before launch.
- **Replicate/Modal ToS**: standard compute terms, no claim on your audio; Replicate
  predictions are private by default on paid accounts. No issue found.

---

## 7. Sources

Accessed 2026-07-23/24:

- Replicate Demucs: https://replicate.com/cjwbw/demucs
- Replicate Basic Pitch: https://replicate.com/rhelsing/basic-pitch
- 2026 separation benchmark (SDR/runtime/cost): https://aistemsplitter.org/blog/htdemucs-vs-bs-roformer-vs-spleeter-2026-benchmark
- 8-engine comparison 2026: https://mixinggpt.com/blog/best-ai-stem-separation-tools-2026
- Demucs archived: https://github.com/facebookresearch/demucs
- ZFTurbo training repo (MIT, checkpoints): https://github.com/ZFTurbo/Music-Source-Separation-Training
- bs-roformer-infer (BS-RoFormer-SW 6-stem, model registry): https://github.com/openmirlab/bs-roformer-infer
- python-audio-separator (MIT, UVR model zoo): https://github.com/nomadkaraoke/python-audio-separator
- Music.AI pricing: https://music.ai/pricing/
- LALAL.AI pricing: https://www.lalal.ai/pricing/ ; API cost analysis: https://dev.to/stevecase430/ai-stem-splitter-api-comparison-2026-stemsplit-vs-lalalai-vs-moises-with-benchmarks-372l
- AudioShake developer docs: https://developer.audioshake.ai/legacy-api/server-to-server
- Gaudio: https://www.gaudiolab.com/developers/products/stem-seperation ; pricing via https://singify.fineshare.com/blog/ai-music-apps/gaudio-studio
- MVSep: https://mvsep.com/en (API pricing pages unreachable — unverified)
- Klangio API + pricing: https://klang.io/api/ ; docs: https://api-docs.klang.io/
- Basic Pitch TS: https://github.com/spotify/basic-pitch-ts ; npm: https://www.npmjs.com/package/@spotify/basic-pitch ; about: https://basicpitch.spotify.com/about
- Modal GPU pricing: https://www.spheron.network/blog/modal-gpu-pricing-2026-per-second-billing/ ; https://computeprices.com/providers/modal
- Drum transcription via stem separation (2025): https://arxiv.org/abs/2509.24853
- 2025 AMT Challenge results: https://arxiv.org/abs/2603.27528
- YourMT3+: https://arxiv.org/abs/2407.04822
- MuScriptor: https://muscriptor.github.io/
- Songscription (API enterprise-only): https://www.songscription.ai/pricing
