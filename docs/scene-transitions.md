# Scene Switcher transitions

Select a Scene Switcher on Main and choose **Cut**, **Crossfade**, or **Motion** in its Instrument panel. Existing projects default to Cut. Preview the Composite to see the result.

Crossfade blends scene textures. Motion transforms the objects themselves. Choose Scale, Position X, Position Y, Rotation, or Combined. Scale is a percentage change; X/Y are world units; rotation is in degrees. Negative amounts reverse the direction or shrink objects. Scale and rotation act around each object's origin. Authored hierarchies and mover layouts are evaluated first, then the transition is applied once per object track, including its copies. Backdrops, cameras, and light tracks stay fixed.

For a growing handoff, select Motion → Scale, set Scale to 50%, and Length to 2 beats. The object starts growing one beat before the change, reaches 1.25× at the change, and finishes at 1.5× one beat later. The incoming scene continues at the same curve progress and speed. It keeps its finished size instead of shrinking back. Following scene changes continue from the finished pose; a real empty rest starts a fresh motion phrase.

**Speed curve** offers Gentle, Focused, and Sharp. The panel shows the velocity and acceleration profiles, with a marker at the handoff. All presets have continuous value, velocity, and acceleration. Speed peaks at the scene change, acceleration passes smoothly through zero there, and both vanish at the outer endpoints. Every move proceeds in one direction, with no return or overshoot. Acceleration is the derivative of the chosen velocity curve.

The transition adds to each object's authored pose and animation. It does not match differently positioned objects or infer correspondence between objects in different scenes. Their own animations remain active.

Transitions are centered on actual scene ownership changes, including a Hold release revealing an older held note. Repeated notes for the same scene do not retrigger a transition. Neighboring changes shorten the window symmetrically to avoid overlap. Empty gaps remain empty. Length 0 bypasses transitions. Preview, scrubbing, worker rendering, and export resolve the same curve from the timeline beat.
