# Path splitter

Add **Path** from Splitters to an object. Copies are evenly spaced along an
open path or closed loop. Width, Bend, Wave amplitude and Wave cycles shape
the path; Angle and Tilt orient it in 3D. Loop height controls the closed loop's
second axis. Loop waves travel in depth and round cycles to whole lobes so
the path and its tangent meet at the seam. Wave animation is cycles per beat;
zero leaves the shape still.

MIDI motion uses six held-note rows: pitches 60/62/64 move forward at 1×/2×/4×
Speed, and 61/63/65 move backward at the same rates. Velocity does not change
the rate. Releasing all notes stops in place. Overlapping notes use the latest
onset; simultaneous onsets choose the fastest row, then forward on a tie.
Releasing an overriding note resumes any earlier note still held. Forward and
Reverse motion modes run continuously from beat zero without MIDI.

Start/End size are multipliers, with the shared Size knob scaling all copies
without changing their spacing. Color blends perceptually between Start and
End, with Color mix controlling how strongly it tints the source. All three
appearance properties follow current path position, including during reverse
motion. On a loop, End values occur halfway around and return smoothly to Start
at the seam; the loop never fades. On an open path, Fade in/out specify the
fraction of path used to fade at each end. **Travel → Repeat** is the default:
copies that reach the end respawn at the start, even on a straight path. Reverse
travel recycles from the start back to the end. Each new pass uses the size,
color and opacity at its new position. Slots are spaced evenly without
duplicating the endpoints. Existing open paths also default to Repeat.

Choose **Travel → Once** for a single pass: copies outside the path remain
structural slots with zero opacity and reappear if MIDI brings them back.
Closed loops always repeat; their shape is independent of open-path recycling.

Speed is world units per beat in the splitter's local frame, measured along
the path at beat zero. Static curves use an arc-length lookup for constant
travel speed. When the wave itself animates, it deforms underneath the same
normalized progress; that deformation adds its own motion. Automated geometry
or speed changes re-evaluate against the current settings, like other movers.
Pause, scrubbing and export all use the same deterministic beat evaluation.

The inspector preview uses a repeating forward/reverse demo in MIDI mode;
the actual scene moves only while its MIDI notes are held.
