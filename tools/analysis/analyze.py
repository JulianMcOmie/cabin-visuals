"""Song -> Demucs stems -> beat grid, note events and envelopes (analysis.json).

    python analyze.py <song> --out <dir> [--stems <dir>] [--bpm 148] [--downbeat 0.116]

Run by `cabin analyze <project>` with the shared venv (~/.cache/cabin/venv, made by
`cabin analyze --setup`). Writes <out>/analysis.json; the CLI turns it into beats,
a per-bar table, suggested sections, MIDI, and `p.analysis()` for edit scripts.

Everything is in SECONDS here; the beat grid is `tempo` = {bpm, period, phase,
downbeat}: `phase` is the first beat, `downbeat` the first bar line (>= 0).

  events.kick/snare/hat   [{t, v}]                  onsets from the drum stem, snapped to 16ths
  events.bass/vocal       [{t, d, v, p}]            notes: onset, duration, level, MIDI pitch (or null)
  events.other            [{t, d, v, pc, c}]        synth/keys onsets: pitch class, brightness 0..1
  harmony                 [{b, c}] per beat         bass root pitch class (-1 = none), 12-bin chroma 0..9
  env.<name>              ints 0..1000 @ fps        kick snare hat drums bass vocals other mix sub low mid high air
  env.vocalPitch/bassPitch  MIDI @ fps (0 = unvoiced)
  env.spectrum16          16 log bands @ 30 fps
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 44100
HOP = 256                     # 5.8 ms analysis hop
FPS = 60                      # envelope rate
N_FFT = 2048
STEM_NAMES = ('drums', 'bass', 'vocals', 'other')


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def load(path):
    y, _ = librosa.load(str(path), sr=SR, mono=True)
    return y


def frames_to_time(n):
    return librosa.frames_to_time(np.arange(n), sr=SR, hop_length=HOP)


def band_flux(S, freqs, lo, hi):
    """Half-wave rectified spectral flux of one frequency band, log-compressed."""
    band = S[(freqs >= lo) & (freqs < hi)]
    L = np.log1p(100 * band)
    return np.maximum(0, np.diff(L, axis=1, prepend=L[:, :1])).sum(axis=0)


def band_energy(S, freqs, lo, hi):
    band = S[(freqs >= lo) & (freqs < hi)]
    return np.sqrt((band ** 2).mean(axis=0))


def pick(env, t, *, delta, wait_s, pre_s=0.03, post_s=0.03, avg_s=0.12):
    """Adaptive peak picking. Returns (times, strengths 0..1, normalised env)."""
    env = env / (np.percentile(env, 99.5) + 1e-9)
    fr = 1 / (t[1] - t[0])
    idx = librosa.util.peak_pick(
        env,
        pre_max=max(1, int(pre_s * fr)), post_max=max(1, int(post_s * fr)),
        pre_avg=max(1, int(avg_s * fr)), post_avg=max(1, int(avg_s * fr)),
        delta=delta, wait=max(1, int(wait_s * fr)),
    )
    return t[idx], np.clip(env[idx], 0, 1.5) / 1.5, env


def to_fps(x, t, duration, fps=FPS):
    """Resample a feature sampled at times t to fps, max-pooled so short transients survive."""
    n = int(np.ceil(duration * fps))
    out = np.zeros(n)
    fi = np.clip((t * fps).astype(int), 0, n - 1)
    np.maximum.at(out, fi, x)
    filled = np.zeros(n, bool)
    filled[fi] = True
    if not filled.all():
        out[~filled] = np.interp(np.flatnonzero(~filled), np.flatnonzero(filled), out[filled])
    return out


def norm01(x, pct=99):
    return np.clip(x / (np.percentile(x, pct) + 1e-9), 0, 1)


def q(x, scale=1000):
    return [int(round(v * scale)) for v in np.clip(x, 0, 1)]


def attack_release(x, fr, attack_ms=5, release_ms=180):
    """Envelope follower: fast rise, exponential fall."""
    a = np.exp(-1 / max(1, attack_ms / 1000 * fr))
    r = np.exp(-1 / max(1, release_ms / 1000 * fr))
    y = np.zeros_like(x)
    v = 0.0
    for i, s in enumerate(x):
        c = a if s > v else r
        v = c * v + (1 - c) * s
        y[i] = v
    return y


# ---------------------------------------------------------------------- stems

def ensure_wav(song: Path, out: Path) -> Path:
    """Decode anything ffmpeg reads to a 44.1k stereo WAV (librosa/Demucs both read it)."""
    if song.suffix.lower() == '.wav':
        return song
    wav = out / 'mix.wav'
    if not wav.exists() or wav.stat().st_mtime < song.stat().st_mtime:
        log(f'decoding {song.name} -> {wav}')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(song), '-ar', str(SR), '-ac', '2', str(wav)], check=True)
    return wav


def ensure_stems(wav: Path, stems_dir: Path | None, out: Path) -> Path:
    """Stems dir holding drums/bass/vocals/other.wav - Demucs htdemucs if missing."""
    if stems_dir is None:
        stems_dir = out / 'stems' / 'htdemucs' / wav.stem
    if all((stems_dir / f'{n}.wav').exists() for n in STEM_NAMES):
        return stems_dir
    import torch
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    log(f'separating stems with Demucs htdemucs on {device} (a minute or two)...')
    subprocess.run([sys.executable, '-m', 'demucs', '-n', 'htdemucs', '-d', device, '-o', str(out / 'stems'), str(wav)], check=True)
    stems_dir = out / 'stems' / 'htdemucs' / wav.stem
    if not all((stems_dir / f'{n}.wav').exists() for n in STEM_NAMES):
        raise SystemExit(f'demucs did not produce stems in {stems_dir}')
    return stems_dir


# ---------------------------------------------------------------------- grid

def coherence(gt, gv, periods):
    return np.array([abs(np.sum(gv * np.exp(2j * np.pi * gt / P))) for P in periods])


def estimate_grid(drums, duration, bpm_hint=None):
    """Beat period + phase. Programmed music sits on a fixed grid, and beat trackers drift by
    tens of ms over a song - so take the tracker's tempo only as a starting point, then find the
    period whose phase best lines up every strong drum onset (the length of the resultant of
    exp(2*pi*i*t/P)), and that vector's phase."""
    drum_on = librosa.onset.onset_strength(y=drums, sr=SR, hop_length=HOP, lag=1, max_size=1)
    t_on = frames_to_time(len(drum_on))
    gt, gv, _ = pick(drum_on, t_on, delta=0.15, wait_s=0.06)
    strong = gv > 0.3
    if strong.sum() >= 16:
        gt, gv = gt[strong], gv[strong]
    if bpm_hint:
        p_est, span = 60 / bpm_hint, 0.002
    else:
        tempo, _ = librosa.beat.beat_track(onset_envelope=drum_on, sr=SR, hop_length=HOP, tightness=200)
        tempo = float(np.atleast_1d(tempo)[0])
        while tempo < 72:
            tempo *= 2
        while tempo > 185:
            tempo /= 2
        p_est, span = 60 / tempo, 0.035
    coarse = np.linspace(p_est * (1 - span), p_est * (1 + span), 4001)
    p0 = coarse[np.argmax(coherence(gt, gv, coarse))]
    fine = np.linspace(p0 - 2e-5, p0 + 2e-5, 2001)
    period = fine[np.argmax(coherence(gt, gv, fine))]
    bpm = 60 / period
    if abs(bpm - round(bpm)) < 0.02:          # programmed tempo: snap to the integer BPM
        bpm = float(round(bpm))
        period = 60 / bpm
    z = np.sum(gv * np.exp(2j * np.pi * gt / period))
    phase = (np.angle(z) / (2 * np.pi) * period) % period
    # Onset functions peak partway up the attack. Put the grid where the transient starts:
    # average the drum waveform's envelope over every beat and find where it first rises past
    # halfway from the pre-hit floor to the peak.
    y = np.abs(drums)
    w = int(0.08 * SR)
    acc = np.zeros(2 * w)
    nb = int((duration - 1) / period)
    for b in range(4, max(5, nb - 1)):
        c = int((phase + b * period) * SR)
        if c - w < 0 or c + w > len(y):
            continue
        seg = y[c - w:c + w]
        acc += seg / (seg.max() + 1e-9)
    if acc.max() > 0:
        acc = np.convolve(acc, np.ones(44) / 44, mode='same')
        floor = np.median(acc[:w // 2])
        peak = acc[w - w // 2:w + w // 2].max()
        above = np.flatnonzero(acc[w - w // 2:] > floor + 0.5 * (peak - floor))
        if len(above):
            phase = (phase + (above[0] + (w - w // 2) - w) / SR) % period
    return bpm, period, phase


def estimate_downbeat(phase, period, duration, kicks, bass_onsets, chroma, tc, bpb):
    """Which beat of the bar is ONE: the offset whose beats carry the most kick weight, bass
    onsets and harmonic change."""
    n = int((duration - phase) / period)
    if n < bpb * 4:
        return phase, [0.0] * bpb
    beats = phase + np.arange(n) * period

    def at_beats(times, vals):
        out = np.zeros(n)
        j = np.round((np.asarray(times) - phase) / period).astype(int)
        ok = (j >= 0) & (j < n)
        for jj, t, v in zip(j[ok], np.asarray(times)[ok], np.asarray(vals)[ok]):
            if abs(t - beats[jj]) < 0.07:
                out[jj] = max(out[jj], v)
        return out

    kick_at = at_beats([k[0] for k in kicks], [k[1] for k in kicks])
    bass_at = at_beats(bass_onsets, np.ones(len(bass_onsets)))
    C = np.zeros((12, n))
    for j in range(n):
        i0, i1 = np.searchsorted(tc, beats[j]), np.searchsorted(tc, beats[j] + period)
        if i1 > i0:
            C[:, j] = chroma[:, i0:i1].mean(axis=1)
    C /= np.linalg.norm(C, axis=0, keepdims=True) + 1e-9
    nov = np.zeros(n)
    for j in range(2, n - 2):
        a, b = C[:, j - 2:j].mean(axis=1), C[:, j:j + 2].mean(axis=1)
        nov[j] = 1 - a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)
    nov /= nov.max() + 1e-9
    scores = [float(kick_at[o::bpb].mean() + 2 * nov[o::bpb].mean() + 0.5 * bass_at[o::bpb].mean()) for o in range(bpb)]
    best = int(np.argmax(scores))
    return phase + best * period, scores


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('song')
    ap.add_argument('--out', required=True)
    ap.add_argument('--stems', help='existing stems dir (drums/bass/vocals/other.wav)')
    ap.add_argument('--bpm', type=float, help='known tempo (only the phase is estimated)')
    ap.add_argument('--downbeat', type=float, help='known first downbeat, seconds')
    ap.add_argument('--beats-per-bar', type=int, default=4)
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wav = ensure_wav(Path(args.song).resolve(), out)
    stems_dir = ensure_stems(wav, Path(args.stems) if args.stems else None, out)

    mix = load(wav)
    stems = {n: load(stems_dir / f'{n}.wav') for n in STEM_NAMES}
    duration = len(mix) / SR
    log(f'duration {duration:.3f}s, stems {stems_dir}')

    D = np.abs(librosa.stft(stems['drums'], n_fft=N_FFT, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=N_FFT)
    td = frames_to_time(D.shape[1])
    fr = SR / HOP

    bpm, period, phase = estimate_grid(stems['drums'], duration, args.bpm)
    step16 = period / 4

    def snap(times, tol=0.035):
        """Onsets within tol of a 16th-note grid line move onto it."""
        s = np.round((times - phase) / step16)
        g = phase + s * step16
        return np.where(np.abs(times - g) < tol, g, times)

    # ------------------------------------------------------------ drums
    kick_flux = band_flux(D, freqs, 30, 120)
    snare_flux = band_flux(D, freqs, 180, 4000)
    hat_flux = band_flux(D, freqs, 7000, 16000)
    low_e = band_energy(D, freqs, 30, 150)
    mid_e = band_energy(D, freqs, 1000, 5000)
    kt, kv, _ = pick(kick_flux, td, delta=0.10, wait_s=0.09)
    st, sv, _ = pick(snare_flux, td, delta=0.12, wait_s=0.09)
    ht, hv, _ = pick(hat_flux, td, delta=0.07, wait_s=0.05)
    # a kick bleeds into the snare band: a snare needs real crack relative to its low end
    ri = np.clip((st * fr).astype(int) + 2, 0, len(mid_e) - 1)
    r = mid_e[ri] / (low_e[ri] + 1e-6)
    keep = r > np.percentile(r, 35)
    st, sv = st[keep], sv[keep]
    kt, st, ht = snap(kt), snap(st), snap(ht)

    # ------------------------------------------------------------ bass
    B = stems['bass']
    bass_rms = librosa.feature.rms(y=B, frame_length=2048, hop_length=HOP)[0]
    b_on = librosa.onset.onset_strength(y=B, sr=SR, hop_length=HOP, fmax=500, lag=2)
    bt_on, _, _ = pick(b_on, td[:len(b_on)], delta=0.12, wait_s=0.08)
    bt_on = snap(bt_on, tol=0.03)
    log('pitch-tracking bass...')
    f0_b, vflag_b, _ = librosa.pyin(B, fmin=28, fmax=400, sr=SR, frame_length=4096, hop_length=HOP * 4)
    tb0 = librosa.times_like(f0_b, sr=SR, hop_length=HOP * 4)
    midi_b = librosa.hz_to_midi(np.where(vflag_b, f0_b, np.nan))

    # ------------------------------------------------------------ vocals
    V = stems['vocals']
    voc_rms = librosa.feature.rms(y=V, frame_length=2048, hop_length=HOP)[0]
    v_on = librosa.onset.onset_strength(y=V, sr=SR, hop_length=HOP, lag=2, max_size=3)
    vt, _, _ = pick(v_on, td[:len(v_on)], delta=0.10, wait_s=0.10, avg_s=0.2)
    log('pitch-tracking vocals...')
    f0_v, vflag_v, _ = librosa.pyin(V, fmin=70, fmax=1100, sr=SR, frame_length=2048, hop_length=HOP * 2)
    tv0 = librosa.times_like(f0_v, sr=SR, hop_length=HOP * 2)
    midi_v = librosa.hz_to_midi(np.where(vflag_v, f0_v, np.nan))

    # ------------------------------------------------------------ other (synths, keys, fx)
    O = stems['other']
    oth_rms = librosa.feature.rms(y=O, frame_length=2048, hop_length=HOP)[0]
    o_on = librosa.onset.onset_strength(y=O, sr=SR, hop_length=HOP, lag=2, max_size=3)
    ot, _, _ = pick(o_on, td[:len(o_on)], delta=0.12, wait_s=0.07)
    ot = snap(ot, tol=0.03)
    chroma = librosa.feature.chroma_cqt(y=O, sr=SR, hop_length=HOP * 2)
    tc = librosa.times_like(chroma, sr=SR, hop_length=HOP * 2)
    o_cent = librosa.feature.spectral_centroid(S=np.abs(librosa.stft(O, n_fft=N_FFT, hop_length=HOP)), sr=SR)[0]

    # ------------------------------------------------------------ downbeat
    if args.downbeat is not None:
        downbeat, scores = args.downbeat, []
    else:
        downbeat, scores = estimate_downbeat(phase, period, duration, list(zip(kt, kv)), bt_on, chroma, tc, args.beats_per_bar)
    log(f'tempo {bpm:.3f} bpm, period {period:.6f}s, first beat {phase:.4f}s, first downbeat {downbeat:.4f}s'
        + (f' (bar-offset scores {", ".join(f"{s:.2f}" for s in scores)})' if scores else ''))

    # ------------------------------------------------------------ event annotation
    def env_at(env, t_env, t, win=0.12):
        i0, i1 = np.searchsorted(t_env, t), np.searchsorted(t_env, t + win)
        return float(env[i0:max(i0 + 1, i1)].max()) if i0 < len(env) else 0.0

    def median_pitch(midi, t_p, t, dur):
        i0, i1 = np.searchsorted(t_p, t + 0.02), np.searchsorted(t_p, t + max(0.06, dur))
        seg = midi[i0:i1]
        seg = seg[~np.isnan(seg)]
        return float(np.median(seg)) if len(seg) else None

    def durations(times, rms, t_rms, floor_ratio=0.25, cap=2.0):
        """Each note lasts until the next onset or until its envelope falls away."""
        out_d = []
        for i, t in enumerate(times):
            nxt = times[i + 1] if i + 1 < len(times) else t + cap
            i0, i1 = np.searchsorted(t_rms, t), np.searchsorted(t_rms, min(nxt, t + cap))
            seg = rms[i0:i1]
            if len(seg) == 0:
                out_d.append(0.1)
                continue
            peak = seg[:max(1, int(0.08 * fr))].max()
            below = np.flatnonzero(seg < peak * floor_ratio)
            end = below[below > int(0.05 * fr)]
            out_d.append(float(max(0.05, (end[0] if len(end) else len(seg)) / fr)))
        return out_d

    t_rms = frames_to_time(len(voc_rms))
    voc_n = voc_rms / (np.percentile(voc_rms, 99) + 1e-9)
    bass_n = bass_rms / (np.percentile(bass_rms, 99) + 1e-9)
    oth_n = oth_rms / (np.percentile(oth_rms, 99) + 1e-9)

    events = {
        'kick': [{'t': round(float(t), 4), 'v': round(float(v), 3)} for t, v in zip(kt, kv)],
        'snare': [{'t': round(float(t), 4), 'v': round(float(v), 3)} for t, v in zip(st, sv)],
        'hat': [{'t': round(float(t), 4), 'v': round(float(v), 3)} for t, v in zip(ht, hv)],
        'bass': [], 'vocal': [], 'other': [],
    }
    for t, d in zip(bt_on, durations(bt_on, bass_rms, t_rms, floor_ratio=0.35)):
        lvl = env_at(bass_n, t_rms, t)
        if lvl >= 0.12:
            p = median_pitch(midi_b, tb0, t, d)
            events['bass'].append({'t': round(float(t), 4), 'd': round(d, 3), 'v': round(min(1, lvl), 3), 'p': None if p is None else round(p, 2)})
    for t, d in zip(vt, durations(vt, voc_rms, t_rms)):
        lvl = env_at(voc_n, t_rms, t)
        if lvl >= 0.10:
            p = median_pitch(midi_v, tv0, t, d)
            events['vocal'].append({'t': round(float(t) - 0.012, 4), 'd': round(d, 3), 'v': round(min(1, lvl), 3), 'p': None if p is None else round(p, 2)})
    for t, d in zip(ot, durations(ot, oth_rms, t_rms)):
        lvl = env_at(oth_n, t_rms, t)
        if lvl >= 0.10:
            c = chroma[:, min(np.searchsorted(tc, t + 0.03), chroma.shape[1] - 1)]
            cent = float(o_cent[min(np.searchsorted(td, t + 0.02), len(o_cent) - 1)])
            events['other'].append({'t': round(float(t), 4), 'd': round(d, 3), 'v': round(min(1, lvl), 3),
                                    'pc': int(np.argmax(c)), 'c': round(float(np.log2(max(cent, 50) / 50) / 8.5), 3)})

    # ------------------------------------------------------------ envelopes @ FPS
    M = np.abs(librosa.stft(mix, n_fft=N_FFT, hop_length=HOP))
    tm = frames_to_time(M.shape[1])
    env = {
        'kick': attack_release(norm01(band_energy(D, freqs, 30, 120)), fr, 2, 140),
        'snare': attack_release(norm01(band_energy(D, freqs, 1500, 5000)), fr, 2, 120),
        'hat': attack_release(norm01(band_energy(D, freqs, 7000, 16000)), fr, 1, 60),
        'drums': attack_release(norm01(band_energy(D, freqs, 20, 16000)), fr, 2, 150),
        'bass': attack_release(norm01(bass_rms), fr, 10, 200),
        'vocals': attack_release(norm01(voc_rms), fr, 10, 160),
        'other': attack_release(norm01(oth_rms), fr, 10, 200),
        'mix': attack_release(norm01(band_energy(M, freqs, 20, 16000)), fr, 5, 250),
        'sub': attack_release(norm01(band_energy(M, freqs, 20, 80)), fr, 5, 200),
        'low': attack_release(norm01(band_energy(M, freqs, 80, 300)), fr, 5, 200),
        'mid': attack_release(norm01(band_energy(M, freqs, 300, 2500)), fr, 5, 200),
        'high': attack_release(norm01(band_energy(M, freqs, 2500, 8000)), fr, 3, 150),
        'air': attack_release(norm01(band_energy(M, freqs, 8000, 18000)), fr, 2, 120),
    }
    out_env = {}
    for name, x in env.items():
        tt = tm if len(x) == len(tm) else frames_to_time(len(x))
        out_env[name] = q(to_fps(x, tt, duration))

    def pitch_track(midi, t_p):
        n = int(np.ceil(duration * FPS))
        idx = np.clip(np.searchsorted(t_p, np.arange(n) / FPS), 0, len(midi) - 1)
        return [0 if np.isnan(x) else round(float(x), 1) for x in midi[idx]]

    out_env['vocalPitch'] = pitch_track(midi_v, tv0)
    out_env['bassPitch'] = pitch_track(midi_b, tb0)

    edges = np.geomspace(40, 16000, 17)
    spec = np.log1p(np.stack([band_energy(M, freqs, edges[i], edges[i + 1]) for i in range(16)]) * 50)
    spec /= np.percentile(spec, 99, axis=1, keepdims=True) + 1e-9
    n30 = int(np.ceil(duration * 30))
    spec30 = np.stack([to_fps(s, tm, duration)[::2][:n30] for s in spec])
    out_env['spectrum16'] = [q(spec30[:, i], 99) for i in range(spec30.shape[1])]

    # ------------------------------------------------------------ harmony per beat
    # pYIN on the bass stem is the most reliable root (chroma is fooled by the overtones of low
    # notes); take the most common pitch class over the half bar, so an 808's downward glide at
    # each onset can't pull it sharp. The other stem's chroma gives the chord colour.
    bass_chroma = librosa.feature.chroma_cqt(y=B, sr=SR, hop_length=HOP * 2, fmin=librosa.note_to_hz('A0'), n_octaves=5)
    harmony = []
    for b in range(int((duration - phase) / period) + 1):
        t0, t1 = phase + b * period, phase + (b + 1) * period
        i0 = np.searchsorted(tc, t0)
        i1 = max(np.searchsorted(tc, t1), i0 + 1)
        bc = bass_chroma[:, i0:i1].mean(axis=1)
        oc = chroma[:, i0:i1].mean(axis=1)
        oc = oc / (oc.max() + 1e-9)
        be = float(bass_n[np.searchsorted(t_rms, t0):np.searchsorted(t_rms, t1) + 1].mean())
        h0 = phase + (b - b % 2) * period
        pv = midi_b[(tb0 >= h0) & (tb0 < h0 + 2 * period)]
        pv = pv[~np.isnan(pv)]
        if be <= 0.08:
            root = -1
        elif len(pv) >= 3:
            root = int(np.bincount(np.round(pv).astype(int) % 12, minlength=12).argmax())
        else:
            root = int(np.argmax(bc))
        harmony.append({'b': root, 'c': [int(round(v * 9)) for v in np.nan_to_num(oc)]})

    data = {
        'duration': round(duration, 4),
        'harmony': harmony,
        'fps': FPS,
        'tempo': {'bpm': round(bpm, 4), 'period': round(period, 6), 'phase': round(phase, 5), 'downbeat': round(float(downbeat), 5),
                  'beatsPerBar': args.beats_per_bar},
        'events': events,
        'env': out_env,
        'source': {'song': str(Path(args.song).resolve()), 'stems': str(stems_dir.resolve())},
    }
    dest = out / 'analysis.json'
    dest.write_text(json.dumps(data, separators=(',', ':')))
    log(f'wrote {dest} ({dest.stat().st_size / 1e6:.2f} MB)')
    for k, v in events.items():
        log(f'  {k:6s} {len(v)} events')


if __name__ == '__main__':
    main()
