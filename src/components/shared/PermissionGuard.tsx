'use client'

import { usePermissions } from '@/lib/hooks/usePermissions'

interface PermissionGuardProps {
  module: string
  action: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function PermissionGuard({
  module,
  action,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { can } = usePermissions()
  if (!can(module, action)) return <>{fallback}</>
  return <>{children}</>
}
