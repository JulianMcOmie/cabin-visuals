"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CabinLogo } from "../CabinLogo"
import { ProfileMenu } from "../ProfileMenu"
import { useAuth } from "../../persistence/hooks/useAuth"
import { getLastProjectId } from "../../persistence/lastProject"
import { track } from "../../analytics/analytics"
import { CursorParticles } from "./CursorParticles"
import { EditorFacsimile } from "./EditorFacsimile"
import { EditorialSkin, EditorialHeader } from "./editorialTheme"
import { SOCIAL_LINKS, VISUAL_EXAMPLES } from "./content"

const EYEBROW_CLASSES =
  "m-0 text-[13px] uppercase tracking-[0.22em] text-[var(--lp-accent)]"

// The one CTA treatment: cyan pill, dark text, glow + lift on hover. Spec
// timing (box-shadow .5s / transform .3s) needs the raw transition property.
const CTA_PILL_CLASSES =
  "inline-flex h-[52px] items-center justify-center whitespace-nowrap rounded-[99px] bg-[var(--lp-accent)] px-9 text-[17px] font-semibold text-[#12141a] cursor-pointer [transition:box-shadow_.5s_ease,transform_.3s_ease] hover:shadow-[0_0_60px_rgba(158,232,245,0.5)] hover:-translate-y-0.5"

/** The hero + closing CTA. Logged-in users resume their last project (same
 *  routing as the classic cover); everyone else starts at /start, which
 *  creates a project on an anonymous session. */
function CreateCta({ children }: { children?: ReactNode }) {
  const router = useRouter()
  const { user } = useAuth()

  if (user) {
    return (
      <button
        onClick={() => {
          const last = getLastProjectId(user.id)
          track("continue_creating_clicked", { destination: last ? "editor" : "projects" })
          router.push(last ? `/editor?project=${last}` : "/projects")
        }}
        className={CTA_PILL_CLASSES}
      >
        Continue creating
      </button>
    )
  }
  return (
    <Link href="/start" onClick={() => track("try_it_out_clicked")} className={CTA_PILL_CLASSES}>
      {children ?? "Start creating"}
    </Link>
  )
}

const FEATURES = [
  {
    title: "Compose",
    copy: "Sequence 3D instruments on a timeline, like tracks in a DAW.",
  },
  {
    title: "Sync",
    copy: "Upload your song and it plays along while you work — line every visual up with the music, your way.",
  },
  {
    title: "Finish",
    copy: "Export in 4K, ready to post.",
  },
]

/** The 2026 editorial landing cover: dark-but-not-black, serif display type,
 *  a single cyan accent, and motion kept to the cursor trail + hovers.
 *  Swap covers via ACTIVE_LANDING in ./index.tsx. */
export function LandingEditorial() {
  const { user } = useAuth()

  return (
    <EditorialSkin className="flex min-h-screen flex-col font-sans">
      <CursorParticles />

      <EditorialHeader>
        <Link
          href="/pricing"
          onClick={() => track("nav_clicked", { from: "landing", to: "pricing" })}
          className="text-[15px] text-[var(--lp-text-muted)] transition-colors hover:text-[var(--lp-accent)] cursor-pointer"
        >
          Pricing
        </Link>
        {user && !user.is_anonymous ? (
          // Real account: the shared profile menu (anonymous sessions get
          // the sign-in affordances instead).
          <ProfileMenu />
        ) : (
          <>
            <Link
              href="/login"
              onClick={() => track("nav_clicked", { from: "landing", to: "login" })}
              className="text-[15px] text-[var(--lp-text-muted)] transition-colors hover:text-[var(--lp-accent)] cursor-pointer"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              onClick={() => track("nav_clicked", { from: "landing", to: "signup" })}
              className="inline-flex h-9 items-center whitespace-nowrap rounded-[99px] bg-[var(--lp-text)] px-5 text-[15px] font-semibold text-[#12141a] transition-colors duration-300 hover:bg-[var(--lp-accent)] cursor-pointer"
            >
              Sign up
            </Link>
          </>
        )}
      </EditorialHeader>

      <main className="flex-1">
        {/* Hero */}
        <section className="flex flex-col items-center px-6 pt-16 pb-16 text-center sm:pt-24 sm:pb-[100px]">
          <CabinLogo className="block h-[88px] w-auto sm:h-[112px]" />
          <h1 className="m-0 mt-10 max-w-[900px] text-[40px] font-normal leading-[1.05] [font-family:var(--lp-font-display)] [text-wrap:balance] sm:text-[56px] lg:text-[96px]">
            Create <em className="italic text-[var(--lp-accent)]">insanely great</em> visuals for music
          </h1>
          <p className="m-0 mt-8 max-w-[480px] text-[20px] leading-[1.6] text-[var(--lp-text-muted)]">
            The best workstation for music-synced visuals.
          </p>
          <div className="mt-11">
            <CreateCta />
          </div>
        </section>

        {/* App preview */}
        <section className="mx-auto w-full max-w-[1440px] px-4 pb-20 sm:px-10 sm:pb-[120px] lg:px-24">
          {/* The facsimile is the whole card: its own transport bar is the
              title bar, so the wrapper only adds the shadow + hover ring. */}
          <div className="rounded-[12px] shadow-[0_40px_80px_rgba(0,0,0,0.4)]">
            <EditorFacsimile className="rounded-[12px] [transition:border-color_.5s] hover:!border-[rgba(158,232,245,0.35)]" />
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-10 px-6 pb-20 sm:grid-cols-3 sm:gap-14 sm:pb-[120px]">
          {FEATURES.map((feature) => (
            <div key={feature.title}>
              <h3 className="m-0 text-[30px] font-normal italic leading-tight [font-family:var(--lp-font-display)]">
                {feature.title}
              </h3>
              <p className="m-0 mt-4 text-[16px] leading-[1.65] text-[var(--lp-text-muted)]">
                {feature.copy}
              </p>
            </div>
          ))}
        </section>

        {/* Showcase */}
        <section className="mx-auto w-full max-w-[1100px] px-6 pb-20 sm:pb-[120px]">
          <p className={`${EYEBROW_CLASSES} text-center`}>Made with Cabin</p>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {VISUAL_EXAMPLES.map((visual) => (
              <div
                key={visual.id}
                className="relative aspect-video overflow-hidden rounded-[10px] bg-black brightness-[0.85] transition-[filter,transform] duration-[400ms] ease-out hover:scale-[1.015] hover:brightness-[1.05]"
              >
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${visual.id}?autoplay=1&mute=1&loop=1&playlist=${visual.id}&controls=0&modestbranding=1&rel=0&playsinline=1&disablekb=1&iv_load_policy=3&showinfo=0&fs=0`}
                  title={visual.title}
                  tabIndex={-1}
                  loading="lazy"
                  allow="autoplay; encrypted-media"
                  className="pointer-events-none absolute inset-0 h-full w-full border-0"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="flex flex-col items-center px-6 pb-24 text-center sm:pb-[140px]">
          <h2 className="m-0 text-[36px] font-normal leading-tight [font-family:var(--lp-font-display)] [text-wrap:balance] sm:text-[56px]">
            Your music deserves visuals.
          </h2>
          <div className="mt-10">
            <CreateCta>Start creating</CreateCta>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--lp-border)]">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-5 px-6 py-8 text-[13px] text-[var(--lp-text-faint)] md:flex-row md:px-16">
          <p className="m-0">
            © {new Date().getFullYear()} Cabin Visuals. All rights reserved. Made with ♥ for musicians and visual artists
          </p>
          {/* Grant condition: the ElevenLabs Grants badge, linked back to the
              program. White variant - the whole site is dark. */}
          <a
            href="https://elevenlabs.io/startup-grants"
            target="_blank"
            rel="noopener noreferrer"
            className="opacity-60 transition-opacity hover:opacity-100"
          >
            <img
              src="https://eleven-public-cdn.elevenlabs.io/payloadcms/cy7rxce8uki-IIElevenLabsGrants%201.webp"
              alt="ElevenLabs Grants"
              className="h-auto w-[180px]"
            />
          </a>
          <div className="flex items-center gap-6">
            {SOCIAL_LINKS.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--lp-text-faint)] transition-colors hover:text-[var(--lp-accent)]"
              >
                {social.label}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </EditorialSkin>
  )
}
