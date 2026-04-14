'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

export function useCurrentUser() {
  const { user, profile, isLoading, setUser, setProfile, setLoading } = useAuthStore()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const supabase = createClient()

    // Initial session check
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        const { data } = await supabase
          .from('user_profiles')
          .select('*, role:roles(id, slug, name, color, max_discount_percent)')
          .eq('id', session.user.id)
          .single()
        setProfile(data ?? null)
      }
      setLoading(false)
    })

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) {
          const { data } = await supabase
            .from('user_profiles')
            .select('*, role:roles(id, slug, name, color, max_discount_percent)')
            .eq('id', session.user.id)
            .single()
          setProfile(data ?? null)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, profile, isLoading }
}
