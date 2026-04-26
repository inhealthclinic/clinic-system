'use client'

/**
 * Старый адрес шаблонов ответов — раздел переехал в /settings/salesbots
 * (вкладка «Шаблоны ответов»). Здесь только редирект, чтобы старые
 * закладки и ссылки в коде не ломались.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function MessageTemplatesRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings/salesbots?tab=quick_replies')
  }, [router])
  return (
    <div className="p-6 text-sm text-gray-500">
      Раздел переехал → «Salesbot и шаблоны». Перенаправляем…
    </div>
  )
}
