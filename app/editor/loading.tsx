import { LoadingScreen } from '../../src/components/LoadingScreen'

// Next renders this the instant a navigation to /editor starts, so opening a
// project shows the smoking-cabin transition instead of a static frame.
export default function Loading() {
  return <LoadingScreen />
}
