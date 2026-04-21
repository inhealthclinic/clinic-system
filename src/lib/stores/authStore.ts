import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User } from '@supabase/supabase-js'
import type { UserProfile } from '@/types'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  isLoading: boolean
  setUser: (user: User | null) => void
  setProfile: (profile: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

/**
 * Кешируем user/profile в localStorage, чтобы после F5 страница отрисовалась
 * МГНОВЕННО, не дожидаясь getSession(). Supabase параллельно проверит сессию
 * и при необходимости обновит/очистит данные.
 *
 * isLoading в persist НЕ кладём — он всегда инициализируется true при старте
 * приложения, но useCurrentUser сразу сбросит его в false, если в кеше есть
 * user (см. ниже).
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      profile: null,
      isLoading: true,
      setUser: (user) => set({ user }),
      setProfile: (profile) => set({ profile }),
      setLoading: (isLoading) => set({ isLoading }),
      reset: () => set({ user: null, profile: null, isLoading: false }),
    }),
    {
      name: 'ih-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ user: s.user, profile: s.profile }),
    }
  )
)
