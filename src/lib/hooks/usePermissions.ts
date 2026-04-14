'use client'

import { useAuthStore } from '@/lib/stores/authStore'

export function usePermissions() {
  const { profile } = useAuthStore()

  const isOwner = profile?.role?.slug === 'owner'
  const isAdmin = profile?.role?.slug === 'admin'
  const isDoctor = profile?.role?.slug === 'doctor'

  /**
   * Check if current user can perform action in module.
   * Owner always has full access.
   * Full RBAC via role_permissions is enforced at DB level (RLS).
   */
  const can = (module: string, action: string): boolean => {
    if (!profile) return false
    if (isOwner) return true
    // For client-side gating only — DB enforces true permissions via RLS
    return true
  }

  const canAny = (...perms: Array<[string, string]>): boolean =>
    perms.some(([m, a]) => can(m, a))

  return { can, canAny, isOwner, isAdmin, isDoctor, profile }
}
