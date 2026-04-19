'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Legacy localStorage-based settings — перенесены в /settings/pipelines (БД).
export default function LegacySettingsCRMRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/settings/pipelines') }, [router])
  return null
}
