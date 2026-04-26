'use client'

/**
 * /settings/roles — оставлен для обратной совместимости со старыми ссылками.
 * UI «Роли и права» теперь живёт во вкладке /settings/users?tab=roles.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RolesRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings/users?tab=roles')
  }, [router])
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
      Перенаправление…
    </div>
  )
}
