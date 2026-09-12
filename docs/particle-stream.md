# Particle Stream

Find **Particle Stream** in the library's **Instruments** folder. It continuously
flows away from the default camera, into the distance, without needing MIDI.

**Streams** chooses 1–16 trajectories. **Density** fixes 2–48 dots on each stream:
six streams at density 16 always contain 96 dots. They move through crossings and
recycle quietly at the ends. MIDI never adds extra particles or bursts.

**Twist** bends the paths, with zero giving straight flights. Speed, spread, particle
size, glow, and color shape the appearance. **Meeting point X/Y** under More moves
the intersection arrangement.

Draw MIDI notes to steer the paths:

- **Path · center:** every stream crosses one point.
- **Path · adjacent pairs:** neighboring streams meet in pairs. Six streams make
  three meeting points; an odd leftover crosses the center.
- **Path · left / right:** every stream crosses an offset point.
- **Path · separate streams:** streams flow without converging.

MIDI specifies **when particles meet**, not when their routes begin. The complete
sequence is used to plan approaches in advance: a particle from each stream reaches
the requested intersection on the note's exact beat, then continues into the
distance. Each particle follows its own predetermined route for the whole journey.
Closely spaced notes get distinct arrivals and can send consecutive particles along
different paths. The structure does not reshape every particle at once.

Routes between notes blend toward the next pattern, completing by that note; rapid
notes shorten the blend instead of waiting one beat. **Speed** sets the ambient
travel rate (eight beats per journey at speed 1 without MIDI). The flow smoothly
adjusts its speed to place existing particles on every MIDI beat, accelerating for
dense passages while keeping the same number of particles. Separate streams pass
the meeting depth on the note without converging. Note length and velocity do not
change the route. In a chord, the highest supported pitch wins. The pattern buttons
choose the starting pattern before the first MIDI approach.

Numeric controls accept ordinary parameter automation. Geometry, stream-count and
speed edits reshape or rephase the current field; use MIDI for smooth pattern
sequencing. The flow follows the track's local -Z axis. Track transforms and movers
can reposition it; a custom camera does not automatically re-aim the field. Pause,
backward scrubbing, and export all sample the same deterministic flow.
