'use client'

import { useEffect, useState } from 'react'
import { LogOut, ExternalLink, Settings } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { createClient } from '../utils/supabase/client'
import { logout } from '../../app/(auth)/logout/actions'
import { useAuth } from '../persistence/hooks/useAuth'

// The one profile avatar + menu, shared by every page's top-right corner.
// Renders NOTHING for signed-out and anonymous sessions ("logged in" here
// means a real account). Self-contained: fetches its own initials, handles
// its own logout, so pages just drop in <ProfileMenu />.

interface ProfileData {
  first_name: string | null
  last_name: string | null
}

const getInitials = (p: ProfileData | null): string => {
  const f = p?.first_name?.[0]?.toUpperCase() || ''
  const l = p?.last_name?.[0]?.toUpperCase() || ''
  return f && l ? `${f}${l}` : f || l || '?'
}

export function ProfileMenu({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { user, isAnonymous } = useAuth()
  const permanent = !!user && !isAnonymous
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    if (!permanent || !user) return
    let mounted = true
    createClient()
      .from('profiles')
      .select('first_name, last_name')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (mounted) setProfile(data ?? null)
      })
    return () => {
      mounted = false
    }
  }, [permanent, user])

  if (!permanent || !user) return null

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) console.error('Client sign out error:', error.message)
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
      setIsLoggingOut(false)
    }
  }

  const box = size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-[12px]'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title="Account"
        disabled={isLoggingOut}
        className={`flex ${box} cursor-pointer items-center justify-center rounded-[5px] border border-[var(--border)] bg-[var(--bg-elevated)] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]`}
      >
        {getInitials(profile)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="rounded-md border-[var(--border)] bg-[var(--bg-panel)] text-[var(--text-2)] shadow-none"
      >
        <div className="px-3 py-2 text-[13px]">
          {(profile?.first_name || profile?.last_name) && (
            <p className="truncate font-medium text-[var(--text)]">
              {`${profile?.first_name || ''} ${profile?.last_name || ''}`.trim()}
            </p>
          )}
          <p className="truncate text-[var(--text-3)]">{user.email}</p>
        </div>
        <DropdownMenuSeparator className="bg-[var(--border)]" />
        <DropdownMenuItem
          className="flex cursor-pointer items-center text-[13px] text-[var(--text-2)] focus:bg-[var(--bg-elevated)] focus:text-[var(--text)]"
          onSelect={() => {
            window.location.href = '/account'
          }}
        >
          <Settings className="mr-2 h-4 w-4" />
          <span>Account settings</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="flex cursor-pointer items-center text-[13px] text-[var(--text-2)] focus:bg-[var(--bg-elevated)] focus:text-[var(--text)]"
          onSelect={() => window.open('https://discord.gg/WhKZbH8nnV', '_blank')}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          <span>Discord Community</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-[var(--border)]" />
        <DropdownMenuItem
          className={`flex w-full cursor-pointer items-center text-[13px] text-[#d68383] focus:bg-[var(--bg-elevated)] focus:text-[#d68383] ${isLoggingOut ? 'cursor-not-allowed opacity-50' : ''}`}
          disabled={isLoggingOut}
          onSelect={(event) => {
            event.preventDefault()
            void handleLogout()
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>{isLoggingOut ? 'Logging out...' : 'Log out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
