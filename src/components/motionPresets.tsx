"use client"

import { motion } from "framer-motion"
import type { ReactNode } from "react"

// Shared page-motion vocabulary so every surface animates the same way. All of
// it respects OS "reduce motion" when rendered under a MotionConfig
// reducedMotion="user" (the pages set one), so this stays quiet for users who
// asked for stillness.

/** Mount entrance: a quick fade with a small rise. For cards, modals, heroes -
 *  anything that should feel like it settled into place, not slid across. */
export function Appear({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  )
}

/** Scroll-into-view reveal (once): sections fade up as they enter the viewport. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.4, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  )
}

/** Interactive-element feedback: a fast scale nudge, no vertical jump. Spread
 *  onto a motion element. Kept quick on purpose - hover should feel instant. */
export const hoverLift = {
  whileHover: { scale: 1.012, transition: { duration: 0.06 } },
  whileTap: { scale: 0.99, transition: { duration: 0.06 } },
} as const
