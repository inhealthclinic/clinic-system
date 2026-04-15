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

    // Timeout: если сессия не получена за 3с — считаем, что не авторизован
    const timeout = setTimeout(() => {
      setLoading(false)
    }, 3000)

    const resolve = async (userId: string | undefined) => {
      clearTimeout(timeout)
      if (userId) {
        const { data } = await supabase
          .from('user_profiles')
          .select('*, role:roles(id, slug, name, color, max_discount_percent)')
          .eq('id', userId)
          .single()
        setProfile(data ?? null)
      } else {
        setProfile(null)
      }
      setLoading(false)
    }

    // Слушаем auth — INITIAL_SESSION срабатывает немедленно из localStorage
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setUser(session?.user ?? null)
        resolve(session?.user?.id)
      }
    )

    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  return { user, profile, isLoading }
}
