# Particle Stream

Find **Particle Stream** in the library's **Instruments** folder. It starts flowing
without notes. **Streams** chooses 1–16 trajectories; **Dots** changes how many
particles occupy each stream. **Twist** bends the paths, with zero giving straight
flights. Speed, spread, particle size, glow, and color shape the appearance.

Draw MIDI notes where you want the particles to meet:

- **Meet · center:** every stream crosses one point.
- **Meet · adjacent pairs:** neighboring streams meet in pairs. Six streams make
  three meeting points; an odd leftover crosses the center.
- **Meet · left / right:** every stream meets at an offset point.
- **Open · separate streams:** streams continue without converging.

A note marks the exact **meeting time**, even off-grid. Dots approach beforehand
and shoot through the crossing; they do not stop there. The pattern stays selected
for following particles until another note changes it. For example, put Center at
beat 4, Pairs at beat 8, and Right at beat 12. Note length and velocity do not change
the route. If you draw a chord, the highest supported row pitch wins.

The pattern buttons choose the starting pattern before MIDI takes over. **Meeting
point X/Y** under More moves the arrangement. Numeric controls accept ordinary
parameter automation, but geometry, stream-count and speed changes reshape the
current field; use the MIDI rows for continuous pattern sequencing. Incoming dots
anticipate future notes, so editing a future crossing can change its approach.

The field flies along the track's local +Z axis toward the default camera. Track
transforms and movers can reposition it; a custom camera does not automatically
re-aim the field. Extremely dense rolls are capped at 128 scheduled note packets
per flight, in addition to the background flow. Pause, backward scrubbing, and
export all sample the same deterministic paths.
