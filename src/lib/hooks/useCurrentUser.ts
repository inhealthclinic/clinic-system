'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/**
 * Восстанавливает сессию Supabase при загрузке страницы.
 *
 * Важно:
 *   1) Сначала получаем сессию через getSession() (читает из cookie/storage).
 *   2) СРАЗУ снимаем isLoading — layout не должен ждать профиль, иначе
 *      при медленной сети страница висит на «Загрузка…».
 *   3) Профиль догружается фоном.
 *   4) Safety-таймаут 5с на случай, если getSession по какой-то причине
 *      не резолвится (редко, но бывает) — чтобы layout мог принять решение.
 */
export function useCurrentUser() {
  const { user, profile, isLoading, setUser, setProfile, setLoading } = useAuthStore()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const supabase = createClient()
    let cancelled = false

    const loadProfile = async (userId: string) => {
      const { data } = await supabase
        .from('user_profiles')
        .select('*, role:roles(id, slug, name, color, max_discount_percent)')
        .eq('id', userId)
        .single()
      if (!cancelled) setProfile(data ?? null)
    }

    // Safety: если getSession завис, через 5с всё равно снимем лоадер.
    const safety = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, 5000)

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        const u = session?.user ?? null
        setUser(u)
        // Снимаем лоадер СРАЗУ — профиль не обязателен для рендера layout.
        setLoading(false)
        clearTimeout(safety)
        if (u) {
          loadProfile(u.id).catch(() => {})
        } else {
          setProfile(null)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const u = session?.user ?? null
        setUser(u)
        if (event === 'SIGNED_OUT') {
          setProfile(null)
        } else if (u) {
          loadProfile(u.id).catch(() => {})
        }
      }
    )

    return () => {
      cancelled = true
      clearTimeout(safety)
      subscription.unsubscribe()
    }
  }, [setUser, setProfile, setLoading])

  return { user, profile, isLoading }
}
