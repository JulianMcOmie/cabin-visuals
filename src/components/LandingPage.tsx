"use client"

import { useRef, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CabinLogo } from "./CabinLogo"
import { ProfileMenu } from "./ProfileMenu"
import { createClient } from "../utils/supabase/client"
import type { User } from '@supabase/supabase-js'

export default function LandingPage() {
  const videoSectionRef = useRef<HTMLElement>(null)
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    let isMounted = true
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      if (isMounted) setUser(data.user)
    })

    // Listen ONLY for sign out events to update UI
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (isMounted && event === 'SIGNED_OUT') setUser(null)
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const scrollToVideo = () => {
    videoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)] text-[var(--text)] font-sans">
      {/* Nav — 64px, hairline border */}
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
          <div className="flex flex-col items-center gap-7">
            <CabinLogo className="block h-[150px] w-auto" />
            <h1 className="m-0 text-[44px] font-bold leading-[1.08] tracking-[-0.03em] text-[var(--text)] md:text-[64px]">
              <span>The </span>
              <span className="text-[var(--accent)]">visual music</span>
              <span> workstation</span>
            </h1>
            <p className="m-0 max-w-[620px] text-[18px] leading-[1.55] text-[var(--text-3)]">
              The first tool dedicated to creating visual music.
            </p>
          </div>
          <div className="flex flex-col items-center gap-[18px]">
            <div className="flex items-center gap-3">
              {user ? (
                // Show "Take me to my projects" if user is logged in
                <button
                  onClick={() => router.push('/projects')}
                  className="inline-flex h-[46px] items-center justify-center rounded-md bg-[var(--accent)] px-7 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Take me to my projects
                </button>
              ) : (
                // Not logged in: drop them straight into the editor to play.
                <Link
                  href="/editor"
                  className="inline-flex h-[46px] items-center justify-center rounded-md bg-[var(--accent)] px-7 text-[15px] font-bold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  Try it out
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
              No account needed — the editor opens in your browser
            </span>
          </div>
        </section>

        {/* Video Section */}
        <section
          ref={videoSectionRef}
          id="demo-video"
          className="mx-auto flex w-full max-w-[1200px] justify-center px-6 pb-24"
        >
          <div className="w-full max-w-[960px]">
            <div className="flex items-center gap-2 px-0.5 pb-2.5">
              <span className="h-2 w-2 rounded-[2px] bg-[var(--accent)]"></span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--text-muted)]">DEMO — 2:41</span>
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
          </div>
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
  )
}
