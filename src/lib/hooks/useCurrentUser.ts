'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/**
 * Восстанавливает сессию Supabase при загрузке страницы.
 *
 * Быстрая стратегия:
 *   1) Если в persisted-кеше (localStorage) уже есть user — СРАЗУ снимаем
 *      isLoading, страница рендерится мгновенно. Supabase параллельно
 *      проверит сессию и при необходимости скорректирует state.
 *   2) Если кеша нет — ждём getSession() (обычно < 50 мс), потом снимаем
 *      лоадер. Safety-таймаут 5с на всякий случай.
 *   3) Профиль всегда догружается фоном, не блокирует рендер.
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

    // Мгновенный рендер: если в persisted-сторе уже есть user — не ждём сеть.
    const cached = useAuthStore.getState().user
    if (cached) {
      setLoading(false)
    }

    const safety = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, 5000)

    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (cancelled) return
        const u = session?.user ?? null
        setUser(u)
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
