# Particle Stream

Find **Particle Stream** in the library's **Instruments** folder. It continuously
flows away from the default camera, into the distance, without needing MIDI.

**Streams** chooses 1–16 trajectories. **Density** fixes 2–48 dots on each stream:
six streams at density 16 always contain 96 dots. Dots are spaced evenly by distance
along each curved path. They keep moving through crossings and recycle quietly at
the ends. MIDI never adds extra particles or bursts.

**Twist** bends the paths, with zero giving straight flights. Speed, spread, particle
size, glow, and color shape the appearance. **Meeting point X/Y** under More moves
the intersection arrangement.

Draw MIDI notes to steer the paths:

- **Path · center:** every stream crosses one point.
- **Path · adjacent pairs:** neighboring streams meet in pairs. Six streams make
  three meeting points; an odd leftover crosses the center.
- **Path · left / right:** every stream crosses an offset point.
- **Path · separate streams:** streams flow without converging.

A note starts a smooth one-beat transition to its pattern, which then stays selected.
Rapid notes blend continuously without snapping the dots or their velocity. Notes
steer the existing flow; they no longer schedule a dot's exact arrival time or add
new groups of dots. Note length and velocity do not change the route. In a chord,
the highest supported pitch wins. The pattern buttons choose the starting pattern
before MIDI takes over.

Numeric controls accept ordinary parameter automation. Geometry, stream-count and
speed edits reshape or rephase the current field; use MIDI for smooth pattern
sequencing. The flow follows the track's local -Z axis. Track transforms and movers
can reposition it; a custom camera does not automatically re-aim the field. Pause,
backward scrubbing, and export all sample the same deterministic flow.
