import { ProjectsSkeleton } from '../../src/components/ProjectsSkeleton'

// Next renders this the instant a navigation to /projects starts. Showing the
// real chrome (header + skeleton) instead of null means no blank flash and no
// top-bar flicker while the page streams in.
export default function Loading() {
  return <ProjectsSkeleton />
}
