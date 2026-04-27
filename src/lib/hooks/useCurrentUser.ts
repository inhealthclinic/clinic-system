'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/**
 * Восстанавливает сессию Supabase при загрузке страницы.
 *
 * Стратегия (после фикса race condition с протухшим токеном):
 *   1) Если в persisted-кеше есть user — рендерим страницу сразу с этим
 *      кешем, НО isLoading НЕ снимаем, пока getUser() не подтвердит.
 *      Иначе при сломанном refresh-токене setUser(null) прилетал ПОСЛЕ
 *      того, как лоадер уже был снят, и юзера кидало на /login.
 *   2) Используем getUser() (а не getSession()), потому что он валидирует
 *      JWT через Supabase и триггерит refresh — middleware на сервере
 *      делает то же самое, и cookies остаются согласованными.
 *   3) onAuthStateChange сбрасывает user в null ТОЛЬКО на явный SIGNED_OUT.
 *      INITIAL_SESSION с пустой сессией игнорируем — getUser() авторитетен.
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

    // Safety: если сеть зависла — через 5с снимаем лоадер,
    // чтобы юзер хотя бы что-то увидел (а не вечный спиннер).
    const safety = setTimeout(() => {
      if (!cancelled) setLoading(false)
    }, 5000)

    ;(async () => {
      try {
        // getUser() валидирует JWT через Supabase API + автоматически
        // рефрешит токен. В отличие от getSession() — не вернёт стухший
        // user из локального стораджа.
        const { data: { user: u }, error } = await supabase.auth.getUser()
        if (cancelled) return

        if (error || !u) {
          // Точно нет валидной сессии — чистим стейт.
          setUser(null)
          setProfile(null)
        } else {
          setUser(u)
          loadProfile(u.id).catch(() => {})
        }
        setLoading(false)
        clearTimeout(safety)
      } catch {
        if (!cancelled) {
          // Сетевая ошибка — НЕ выкидываем юзера, оставляем cached state.
          setLoading(false)
        }
      }
    })()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Реагируем только на явные события — INITIAL_SESSION с null
        // нам не интересен (его обработает getUser() выше).
        if (event === 'SIGNED_OUT') {
          setUser(null)
          setProfile(null)
          return
        }
        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          const u = session?.user ?? null
          if (u) {
            setUser(u)
            loadProfile(u.id).catch(() => {})
          }
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
