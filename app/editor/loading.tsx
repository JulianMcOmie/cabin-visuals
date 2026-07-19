import { LoadingScreen } from '../../src/components/LoadingScreen'

// Next renders this the instant a navigation to /editor starts, so opening a
// project shows the smoking-cabin transition instead of a static frame. Same
// label as the editor shell that follows, so the text never pops in late.
export default function Loading() {
  return <LoadingScreen label="Loading the studio…" />
}
