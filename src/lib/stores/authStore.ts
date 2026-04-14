import { create } from 'zustand'
import type { UserProfile, Role } from '@/types/app'

interface AuthState {
  user: UserProfile | null
  permissions: Set<string>
  isLoading: boolean
  setUser: (user: UserProfile | null) => void
  clearUser: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  permissions: new Set(),
  isLoading: true,

  setUser: (user) => {
    if (!user) {
      set({ user: null, permissions: new Set(), isLoading: false })
      return
    }

    // Собираем права: роль + extra - denied
    const rolePerms = new Set(user.role.permissions)
    user.extra_permissions.forEach(p => rolePerms.add(p))
    user.denied_permissions.forEach(p => rolePerms.delete(p))

    // Owner — всё разрешено (маркер)
    if (user.role.slug === 'owner') {
      rolePerms.add('*')
    }

    set({ user, permissions: rolePerms, isLoading: false })
  },

  clearUser: () => set({ user: null, permissions: new Set(), isLoading: false }),
}))
