"use client"

import { useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MotionConfig } from "framer-motion"
import { CabinLogo } from "./CabinLogo"
import { Appear, Reveal } from "./motionPresets"
import { ProfileMenu } from "./ProfileMenu"
import { useAuth } from "../persistence/hooks/useAuth"
import { getLastProjectId } from "../persistence/lastProject"
import { track } from "../analytics/analytics"

export default function LandingPage() {
  const videoSectionRef = useRef<HTMLElement>(null)
  const router = useRouter()
  // Shared cached auth (not a private per-mount fetch), so navigating back to
  // the landing page renders the known sign-in state instead of re-running the
  // login/signup -> profile flip.
  const { user } = useAuth()

  const scrollToVideo = () => {
    videoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)] text-[var(--text)] font-sans">
      {/* Nav - 64px, hairline border */}
      <header className="border-b border-[var(--border-subtle)]">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5 select-none cursor-pointer">
            <CabinLogo className="h-[30px] w-auto" />
            <span className="translate-y-[5px] text-[15px] font-semibold text-[var(--text)]">Cabin Visuals</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="px-3 text-[13px] text-[var(--text-3)] transition-colors hover:text-[var(--text)] cursor-pointer"
            >
              Pricing
            </Link>
            {user && !user.is_anonymous ? (
              // Real account: the shared profile menu (anonymous sessions get
              // the sign-in affordances instead).
              <ProfileMenu />
            ) : (
              // Show login/signup buttons if not logged in
              <>
                <Link
                  href="/login"
                  className="inline-flex h-8 items-center rounded-[5px] border border-[var(--border)] px-3.5 text-[13px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex h-8 items-center rounded-[5px] bg-[var(--accent)] px-3.5 text-[13px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-10 px-6 pt-[104px] pb-[88px] text-center">
          <Appear className="flex flex-col items-center gap-7">
            <CabinLogo className="block h-[150px] w-auto" />
            <h1 className="m-0 text-[44px] font-bold leading-[1.08] tracking-[-0.03em] text-[var(--text)] md:text-[64px]">
              <span>Create insanely great visuals for music</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[18px] leading-[1.55] text-[var(--text-3)]">
              The best workstation for music-synced visuals
            </p>
          </Appear>
          <Appear delay={0.1} className="flex flex-col items-center gap-[18px]">
            <div className="flex items-center gap-3">
              {user ? (
                // Logged in: straight back into the last project they opened
                // on this device; /projects only when there's nothing to resume.
                <button
                  onClick={() => {
                    const last = getLastProjectId(user.id)
                    router.push(last ? `/editor?project=${last}` : '/projects')
                  }}
                  className="inline-flex h-[46px] items-center justify-center rounded-md bg-[var(--accent)] px-7 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Continue creating
                </button>
              ) : (
                // Not logged in: drop them straight into the editor to play.
                <Link
                  href="/editor"
                  onClick={() => track('try_it_out_clicked')}
                  className="inline-flex h-[46px] items-center justify-center rounded-md bg-[var(--accent)] px-7 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Start creating
                </Link>
              )}
              <button
                onClick={scrollToVideo}
                className="inline-flex h-[46px] items-center justify-center rounded-md border border-[var(--border)] px-6 text-[15px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] cursor-pointer"
              >
                Watch the demo
              </button>
            </div>
            <span className="font-mono text-[12px] text-[var(--text-muted)]">
              No account needed - the editor opens in your browser
            </span>
          </Appear>
        </section>

        {/* Video Section */}
        <section
          ref={videoSectionRef}
          id="demo-video"
          className="mx-auto flex w-full max-w-[1200px] justify-center px-6 pb-24"
        >
          <Reveal className="w-full max-w-[960px]">
            <div className="flex items-center gap-2 px-0.5 pb-2.5">
              <span className="h-2 w-2 rounded-[2px] bg-[var(--accent)]"></span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)]">DEMO - 2:41</span>
            </div>
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-canvas-deep)]">
              <iframe
                className="absolute top-0 left-0 h-full w-full border-0"
                src="https://www.youtube.com/embed/8jPhqXtWIUw"
                title="Cabin Visuals Demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          </Reveal>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border-subtle)]">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-2 px-6 py-7 md:flex-row">
          <p className="m-0 text-[13px] text-[var(--text-muted)]">© {new Date().getFullYear()} Cabin Visuals. All rights reserved.</p>
          <p className="m-0 text-[13px] text-[var(--text-muted)]">Made with ♥ for musicians and visual artists</p>
        </div>
      </footer>
    </div>
    </MotionConfig>
  )
}
