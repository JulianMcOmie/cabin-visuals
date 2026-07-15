'use client'

import { useFormStatus } from 'react-dom'
import { CabinLogo } from './CabinLogo'

/**
 * The transition screen: full-viewport page background with the cabin logo
 * puffing smoke (its idle animation, minus the hover gate). Shown wherever a
 * click starts a wait the UI would otherwise sit static through - auth form
 * submissions, editor ↔ projects navigations, route-level loading states.
 */
export function LoadingScreen() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--bg-page)]">
      <div className="w-16">
        <CabinLogo className="cabin-logo-loading" strokeWidth={200} />
      </div>
    </div>
  )
}

/** Drop inside a <form action={serverAction}>: covers the screen while the
 *  action runs (and through its redirect - navigation unmounts the form). */
export function FormPendingScreen() {
  const { pending } = useFormStatus()
  return pending ? <LoadingScreen /> : null
}
