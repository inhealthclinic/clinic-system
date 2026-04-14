'use client'

import { usePermissions } from '@/lib/hooks/usePermissions'

interface Props {
  permission?: string
  anyOf?: string[]
  allOf?: string[]
  role?: string
  fallback?: React.ReactNode
  children: React.ReactNode
}

export function PermissionGuard({
  permission,
  anyOf,
  allOf,
  role,
  fallback = null,
  children,
}: Props) {
  const { can, canAny, canAll, isRole } = usePermissions()

  let allowed = true

  if (permission) allowed = can(permission)
  if (anyOf?.length)  allowed = canAny(...anyOf)
  if (allOf?.length)  allowed = canAll(...allOf)
  if (role)           allowed = isRole(role)

  return allowed ? <>{children}</> : <>{fallback}</>
}

// Использование:
// <PermissionGuard permission="medcard:sign">
//   <Button>Подписать</Button>
// </PermissionGuard>
//
// <PermissionGuard anyOf={['finance:view','finance:reports']}>
//   <FinanceSection />
// </PermissionGuard>
