'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { UserProfile } from '@/types/app'

export function useCurrentUser() {
  const { setUser, clearUser, user, isLoading } = useAuthStore()

  useEffect(() => {
    const supabase = createClient()

    async function loadUser() {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) { clearUser(); return }

      // Загружаем профиль + роль + права
      const { data: profile } = await supabase
        .from('user_profiles')
        .select(`
          *,
          role:roles(
            *,
            permissions:role_permissions(
              permission:permissions(module, action)
            )
          )
        `)
        .eq('id', authUser.id)
        .single()

      if (!profile) { clearUser(); return }

      // Нормализуем права роли
      const rolePermissions = (profile.role.permissions || []).map(
        (rp: any) => `${rp.permission.module}:${rp.permission.action}`
      )

      const userProfile: UserProfile = {
        ...profile,
        full_name: `${profile.first_name} ${profile.last_name}`,
        role: {
          ...profile.role,
          permissions: rolePermissions,
        },
        extra_permissions: profile.extra_permissions || [],
        denied_permissions: profile.denied_permissions || [],
      }

      setUser(userProfile)
    }

    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'SIGNED_OUT') clearUser()
        if (event === 'SIGNED_IN')  loadUser()
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { user, isLoading }
}
