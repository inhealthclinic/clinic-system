'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/**
 * Восстанавливает сессию Supabase при загрузке страницы.
 *
 * Важно: Supabase SSR client хранит токен в cookies, поэтому при
 * обновлении страницы сессия ДОЛЖНА восстанавливаться без редиректа
 * на /login. Раньше тут стоял 3-секундный таймаут, который при медленной
 * сети мог ложно сбрасывать isLoading=false с user=null — и dashboard
 * layout выкидывал пользователя на логин. Теперь:
 *   1) getSession() читает токен из storage (обычно < 50 мс) и сразу
 *      ставит user + тянет профиль.
 *   2) onAuthStateChange слушает последующие события (refresh, signout).
 *   3) Таймаут убран — если сессии действительно нет, getSession вернёт
 *      null быстро.
 */
export function useCurrentUser() {
  const { user, profile, isLoading, setUser, setProfile, setLoading } = useAuthStore()
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const supabase = createClient()

    const loadProfile = async (userId: string) => {
      const { data } = await supabase
        .from('user_profiles')
        .select('*, role:roles(id, slug, name, color, max_discount_percent)')
        .eq('id', userId)
        .single()
      setProfile(data ?? null)
    }

    // 1) Синхронное чтение существующей сессии из storage/cookie
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const u = session?.user ?? null
      setUser(u)
      if (u) await loadProfile(u.id)
      else setProfile(null)
      setLoading(false)
    })()

    // 2) Подписка на изменения авторизации (SIGNED_IN, TOKEN_REFRESHED, SIGNED_OUT)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        const u = session?.user ?? null
        setUser(u)
        if (event === 'SIGNED_OUT') {
          setProfile(null)
        } else if (u) {
          await loadProfile(u.id)
        }
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [setUser, setProfile, setLoading])

  return { user, profile, isLoading }
}
