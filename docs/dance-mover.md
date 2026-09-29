# Dance mover

Add **Motion → Dance** under an object, or use **Add mover track → Dance**.
Place notes in its **X crossing**, **Y crossing**, and **Z crossing** rows.
Each note marks the moment that axis passes through the object's center at
speed. Direction alternates automatically on each axis; chords move several
axes together. The three **Swing** knobs set maximum distance from center
(default 1); zero disables that axis. X/Y/Z use MIDI pitches 60/62/64, following
the existing axis convention. Note duration and velocity are ignored.

Equally spaced notes produce full swings. Uneven spacing can reduce their
distance: Dance prioritizes smooth movement and fast crossings over forcing
every swing to reach the same extent. Very dense notes also shrink the travel
to cap speed. Duplicate onsets on the same axis within one millionth of a beat
are one event, so chords cannot accidentally cancel or double the motion.

The phrase leads in up to one beat before its first note and settles up to
one beat after its last note, including across clip boundaries. All notes on
the lane form one continuous phrase; adjacent clips and expanded MIDI loops
do not restart direction. A note exactly at timeline zero is already moving
there: its lead-in occurs before zero. Put the first note at beat 1 or later
to see the full entrance. A transport loop or export cut can still cut the
motion; matching the two ends of an arbitrary transport loop is not guaranteed.

With fixed knob values, position, velocity and acceleration are continuous
at every crossing, reversal, and entrance/exit. Each axis has a local speed
maximum at its own notes. This does not promise a peak in the combined 3D
speed when other axes move simultaneously, nor continuous jerk. Abrupt knob
automation, bypass, or transforms elsewhere in the chain can interrupt the
result. No frame-based renderer can display every crossing if notes are
closer than its frame interval.

## Implementation and verification

`danceCurve.ts` prepares normalized piecewise quartic position curves from
cubic velocity ramps, with quintic entrance/exit segments. At neighboring
crossings with speed magnitudes v and w separated by h beats, the turnaround
occurs h·w/(v+w) beats after the first. This equates the two half-swing
distances. Each crossing's speed uses the larger adjacent gap, bounding the
whole curve without clipping. The unit curve's speed is capped at 256 per
beat; axis amplitude scales it.

Preparation sorts once, uses linear storage, and is cached by immutable note
array identity, so changing an amplitude does not rebuild the curves.
Playback performs three binary searches and polynomial evaluations. The
resolved translation is shared across equal copy clocks within the existing
evaluation scope; no playback history accumulates. Transforms compose locally
after the preceding chain entry, and seeking/export use the same evaluator.

`dance.test.ts` checks analytic position/velocity/acceleration at every join,
independent finite differences, speed maxima and amplitude bounds, irregular
and dense timing, clip/loop boundaries, chords, deduplication, cache reuse,
local transform composition, and arbitrary seeks.
