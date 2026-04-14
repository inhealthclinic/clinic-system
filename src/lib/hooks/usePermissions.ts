import { useCallback } from 'react'
import { useAuthStore } from '@/lib/stores/authStore'

export function usePermissions() {
  const { permissions, user } = useAuthStore()

  const can = useCallback((permission: string): boolean => {
    if (!user) return false
    if (permissions.has('*')) return true   // owner
    return permissions.has(permission)
  }, [permissions, user])

  const canAny = useCallback((...perms: string[]): boolean => {
    return perms.some(p => can(p))
  }, [can])

  const canAll = useCallback((...perms: string[]): boolean => {
    return perms.every(p => can(p))
  }, [can])

  const isRole = useCallback((slug: string): boolean => {
    return user?.role.slug === slug
  }, [user])

  return { can, canAny, canAll, isRole, user }
}
