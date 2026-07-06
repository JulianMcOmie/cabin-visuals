# Instrument note semantics (new instruments)

## THEME: retroArcade (~130 BPM)

### pixelInvaders | Pixel Invaders | no | ambient: yes
notes: note zaps bottom invader in column (pitch % 6) with laser + pixel explosion; formation respawns each 16 beats; velocity → shrapnel. Ambient marching grid.
params: cols=6, rows=3, phraseBeats=16, rowColor1=#39ff14(string)
icon: <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2h1v1h4V2h1v1h1v2h1v3h-1v1h-1v1H8V9H4v1H3V9H2V8H1V5h1V3h1V2z" fill="#39ff14"/><rect x="4" y="5" width="1" height="1" fill="#04070a"/><rect x="7" y="5" width="1" height="1" fill="#04070a"/></svg>

### crtScanlines | CRT Scanlines | FULLFRAME | ambient: yes
notes: note flashes screen in pitch-class color ((pitch%12)*30° hue); pitch ≥ 72 = static blip; velocity → intensity. Ambient scanlines/vignette/rolling band.
params: blipPitch=72, flashDur=0.6, flashStrength=0.5, glowColor=#3aff8c(string)
icon: <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="2" width="10" height="8" rx="2" fill="none" stroke="#3aff8c" strokeWidth="1"/><line x1="3" y1="4.5" x2="9" y2="4.5" stroke="#3aff8c" strokeWidth="0.7" opacity="0.8"/><line x1="3" y1="6" x2="9" y2="6" stroke="#3aff8c" strokeWidth="0.7" opacity="0.5"/><line x1="3" y1="7.5" x2="9" y2="7.5" stroke="#3aff8c" strokeWidth="0.7" opacity="0.3"/></svg>

### paddleBounce | Paddle Bounce | no | ambient: yes
notes: ambient beat-locked pong rally; note = smash (speed spike); latest pitch shapes hops (1+(pitch%3)) & arc height (36-84); velocity → trail.
params: smash=1, baseBounce=1.2, trailMax=14, paddleColor=#22d3ee(string)
icon: <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="4" width="1.4" height="4" fill="#22d3ee"/><rect x="9.6" y="4" width="1.4" height="4" fill="#22d3ee"/><rect x="5" y="5" width="2" height="2" fill="#ffffff"/><rect x="3.6" y="6.4" width="1" height="1" fill="#ffffff" opacity="0.4"/></svg>

### pixelBlast | Pixel Blast | no | ambient: no
notes: note detonates 8-bit explosion; pitch%12 → X lane, octave → Y band; velocity → size/count; palette by pitch class.
params: life=0.9, pixelSize=0.12, count=24, spreadX=4.5
icon: <svg width="12" height="12" viewBox="0 0 12 12"><rect x="5" y="5" width="2" height="2" fill="#ffec27"/><rect x="2" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="8.6" y="5.5" width="1.4" height="1.4" fill="#ff6c24"/><rect x="5.3" y="2" width="1.4" height="1.4" fill="#ff004d"/><rect x="5.3" y="8.6" width="1.4" height="1.4" fill="#ff004d"/><rect x="2.8" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="2.8" width="1" height="1" fill="#ffa300"/><rect x="2.8" y="8.2" width="1" height="1" fill="#ffa300"/><rect x="8.2" y="8.2" width="1" height="1" fill="#ffa300"/></svg>

### scoreTicker | Score Ticker | no | ambient: yes
notes: note adds round(pitch*velocity*multiplier) points, digits spin up; velocity ≥ 0.8 flashes 1UP; ambient glowing score.
params: digits=6, multiplier=1, accentThresh=0.8, scoreColor=#facc15(string)
icon: <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/><rect x="4.8" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/><rect x="8.6" y="3.5" width="2.4" height="5" fill="none" stroke="#facc15" strokeWidth="1"/></svg>
