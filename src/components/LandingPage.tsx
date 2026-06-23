"use client"

import type React from "react"

import { useRef, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowDown, LogOut, ExternalLink } from "lucide-react"
import { Button } from "./ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { createClient } from "../utils/supabase/client"
import { logout } from "../../app/(auth)/logout/actions"
import type { User } from '@supabase/supabase-js'

interface ProfileData {
  first_name: string | null;
  last_name: string | null;
}

const getInitials = (firstName: string | null | undefined, lastName: string | null | undefined): string => {
  const firstInitial = firstName?.[0]?.toUpperCase() || '';
  const lastInitial = lastName?.[0]?.toUpperCase() || '';
  return firstInitial && lastInitial ? `${firstInitial}${lastInitial}` : (firstInitial || lastInitial || '?');
};

export default function LandingPage() {
  const videoSectionRef = useRef<HTMLElement>(null)
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  useEffect(() => {
    let isMounted = true
    const supabase = createClient()
    
    // Get initial user and profile
    const getUser = async () => {
      const { data: { user: initialUser } } = await supabase.auth.getUser()
      
      if (!isMounted) return
      setUser(initialUser)
      
      // Fetch profile if user exists
      if (initialUser) {
        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('first_name, last_name')
          .eq('user_id', initialUser.id)
          .single()
        
        if (!isMounted) return
        
        if (error) {
          console.error('Error fetching profile:', error)
        } else if (profileData) {
          setProfile(profileData)
        }
      }
    }
    
    getUser()

    // Listen ONLY for sign out events to update UI
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (!isMounted) return
        
        // Only handle SIGNED_OUT event to clear state
        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
        }
      }
    )

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    if (isLoggingOut) return
    setIsLoggingOut(true)
    
    try {
      // Call server action - it will trigger SIGNED_OUT event and redirect
      await logout()
    } catch (error) {
      console.error("Logout error:", error)
      window.location.href = '/'
    }
  }

  const scrollToVideo = () => {
    videoSectionRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  const userInitials = getInitials(profile?.first_name, profile?.last_name)

  return (
    // Ensure custom CSS classes like electric-blue, glow-*, blob-*, success-*, checkmark* are defined elsewhere
    <div className="flex min-h-screen flex-col bg-black text-white relative">
      {/* Animated background blobs */}
      <div className="blob-container">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>

      <header className="container flex h-20 items-center justify-between py-6 relative z-10 mx-auto px-4">
        <Link href="/" className="font-medium text-xl cursor-pointer hover:text-electric-blue transition-colors">
          Cabin Visuals
        </Link>
        <nav className="flex items-center gap-3">
          {user ? (
            // Show profile dropdown if user is logged in
            <DropdownMenu>
              <DropdownMenuTrigger 
                className="h-10 w-10 rounded-full bg-electric-blue/20 hover:bg-electric-blue/30 flex items-center justify-center text-white font-semibold transition-all cursor-pointer"
                disabled={isLoggingOut}
              >
                <span>{userInitials}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-gray-900 border-gray-800">
                {(user || profile) && (
                  <div className="px-3 py-2 text-sm text-white">
                    {profile && (profile.first_name || profile.last_name) && (
                      <p className="font-medium truncate">{`${profile.first_name || ''} ${profile.last_name || ''}`.trim()}</p>
                    )}
                    {user && (
                      <p className="text-gray-300 truncate">{user.email}</p>
                    )}
                  </div>
                )}
                <DropdownMenuSeparator className="bg-gray-800" />
                <DropdownMenuItem 
                  className="flex items-center cursor-pointer text-white hover:bg-gray-700"
                  onSelect={() => window.open('https://discord.gg/WhKZbH8nnV', '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  <span>Discord Community</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-gray-800" />
                <DropdownMenuItem
                  className={`flex items-center w-full text-red-400 cursor-pointer hover:bg-gray-700 rounded-sm text-sm p-1.5 focus:bg-gray-700 focus:text-red-400 ${isLoggingOut ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={isLoggingOut}
                  onSelect={(event) => {
                    event.preventDefault()
                    handleLogout()
                  }}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  <span>{isLoggingOut ? "Logging out..." : "Log out"}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            // Show login/signup buttons if not logged in
            <>
              <Link href="/login" className="cursor-pointer">
                <Button
                  className="rounded-full bg-white/10 backdrop-blur-sm border border-white/30 text-white hover:bg-white/20 hover:border-white/50 transition-all shadow-lg cursor-pointer"
                >
                  Log In
                </Button>
              </Link>
              <Link href="/signup" className="cursor-pointer">
                <Button
                  style={{ backgroundColor: '#00a8ff', boxShadow: '0 10px 25px rgba(0, 168, 255, 0.5)' }}
                  className="rounded-full text-white hover:opacity-80 transition-all border-0 cursor-pointer"
                  onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 30px rgba(0, 168, 255, 0.7)'}
                  onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 10px 25px rgba(0, 168, 255, 0.5)'}
                >
                  Sign Up
                </Button>
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1 relative z-10">
        <section className="container flex flex-col items-center justify-center space-y-12 py-24 text-center md:py-32 mx-auto px-4">
          <div className="space-y-5">
            <img src="/logo.svg" alt="" className="block mx-auto h-32 w-auto md:h-40" />
            <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl">
              <span>The </span>
              <span className="text-electric-blue">visual music</span>
              <span> workstation</span>
            </h1>
            <p className="mx-auto max-w-[700px] text-lg text-gray-300 md:text-xl">
              {/* eslint-disable-next-line react/no-unescaped-entities */}
              The first tool dedicated to creating visual music.
            </p>
          </div>
          <div className="w-full max-w-md space-y-8">
            <div className="flex justify-center items-center">
              {user ? (
                // Show "Take me to my projects" if user is logged in
                <Button
                  onClick={() => router.push('/projects')}
                  style={{ backgroundColor: '#00a8ff', boxShadow: '0 20px 40px rgba(0, 168, 255, 0.6)' }}
                  className="rounded-full px-12 py-7 text-xl font-bold text-white hover:opacity-80 hover:scale-105 transition-all border-0 cursor-pointer"
                  onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 20px 50px rgba(0, 168, 255, 0.8)'}
                  onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 20px 40px rgba(0, 168, 255, 0.6)'}
                >
                  Take me to my projects
                </Button>
              ) : (
                // Show "Sign Up" if not logged in
                <Link href="/signup" className="cursor-pointer">
                  <Button
                    style={{ backgroundColor: '#00a8ff', boxShadow: '0 20px 40px rgba(0, 168, 255, 0.6)' }}
                    className="rounded-full px-12 py-7 text-xl font-bold text-white hover:opacity-80 hover:scale-105 transition-all border-0 cursor-pointer"
                    onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 20px 50px rgba(0, 168, 255, 0.8)'}
                    onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 20px 40px rgba(0, 168, 255, 0.6)'}
                  >
                    Sign Up
                  </Button>
                </Link>
              )}
            </div>
            <div className="space-y-8">
              <Button
                variant="outline"
                onClick={scrollToVideo}
                className="btn-main-demo rounded-full px-8 py-3 border-2 border-gray-600 bg-gray-900/50 backdrop-blur-sm text-white hover:bg-gray-800/50 hover:border-gray-500 transition-all shadow-lg cursor-pointer"
              >
                Watch Demo
              </Button>

              <div className="flex flex-col items-center space-y-2">
                <p className="text-sm text-gray-400">Scroll to explore</p>
                <ArrowDown className="h-6 w-6 animate-bounce text-gray-400" />
              </div>
            </div>
          </div>
        </section>

        {/* Video Section */}
        <section
          ref={videoSectionRef}
          id="demo-video"
          className="container py-24 flex flex-col items-center justify-center mx-auto px-4 sm:px-6 lg:px-8"
        >
          <div className="w-full max-w-5xl aspect-video rounded-xl overflow-hidden border border-gray-800 glow-subtle">
            <div className="relative w-full h-full bg-gray-900 flex items-center justify-center">
              {/* Consider adding a placeholder/thumbnail before the iframe loads */}
              <iframe
                className="absolute top-0 left-0 w-full h-full"
                src="https://www.youtube.com/embed/8jPhqXtWIUw" // Added parameters to YouTube URL
                title="Cabin Visuals Demo"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          </div>
        </section>

          {/* Footer */}
      
    <div className="container py-12 mx-auto px-4">
        <div className="border-t border-gray-800 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
        <p className="text-sm text-gray-400">© {new Date().getFullYear()} Cabin Visuals. All rights reserved.</p>
        <p className="text-sm text-gray-400 mt-4 md:mt-0">Made with ♥ for musicians and visual artists</p>
        </div>
    </div>
      </main>

    
    </div>
  )
} 