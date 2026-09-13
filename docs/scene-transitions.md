# Scene Switcher transitions

Select a Scene Switcher on Main and choose **Cut**, **Crossfade**, or **Motion** in its Instrument panel. Existing projects default to Cut. Preview the Composite to see the result.

Crossfade blends the two scene textures. Motion carries a shared screen-space transform across the scene change. Choose Scale, Position X, Position Y, Rotation, or Combined. Scale is a percentage change (50 means 1.5× at the cut); position uses percentages of the frame; rotation uses degrees. Negative amounts reverse the motion. Combined applies all four channels together.

For a growing handoff, select Motion → Scale, set Scale to 50%, and Length to 2 beats. Growth begins one beat before the change. The incoming scene takes over at 1.5× with the same growth velocity and acceleration, continues growing briefly, then settles to its normal size one beat later.

The added transform has continuous value, velocity, and acceleration, with zero velocity and acceleration at the outer edges. It moves the entire rendered scene, including the background. It does not match individual objects, their starting transforms, or their existing animation derivatives; those still come from each scene. Movement and shrinkage can expose the Main background.

Transitions are centered on actual scene ownership changes, including a Hold release revealing an older held note. Repeated notes for the same scene do not retrigger a transition. Neighboring changes shorten the window symmetrically to avoid overlap. Empty gaps remain empty. Length 0 bypasses transitions. Preview, scrubbing, worker rendering, and export resolve the same curve from the timeline beat.
