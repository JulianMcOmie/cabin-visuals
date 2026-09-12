# Particle Stream

Find **Particle Stream** in the library's **Instruments** folder. It continuously
flows away from the default camera, into the distance, without needing MIDI.

**Streams** chooses 1–16 trajectories. **Density** fixes 2–48 dots on each stream:
six streams at density 16 always contain 96 dots. Dots enter at regular intervals
and travel at a constant distance rate along their own curved path. They keep moving through crossings and recycle quietly at
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

A particle chooses its whole route when it enters and follows that route to the
far end. A note changes the routes of incoming particles over one beat; particles
already traveling keep their paths. The change moves into the distance with the
flow, so several stages of the sequence can be visible at once. At default speed,
a journey takes eight beats. Rapid notes blend the routes assigned to successive
particles without bending particles already in flight. Notes do not schedule a
dot's exact arrival time or add new groups of dots. Note length and velocity do not change the route. In a chord,
the highest supported pitch wins. The pattern buttons choose the starting pattern
before MIDI takes over.

Numeric controls accept ordinary parameter automation. Geometry, stream-count and
speed edits reshape or rephase the current field; use MIDI for smooth pattern
sequencing. The flow follows the track's local -Z axis. Track transforms and movers
can reposition it; a custom camera does not automatically re-aim the field. Pause,
backward scrubbing, and export all sample the same deterministic flow.
