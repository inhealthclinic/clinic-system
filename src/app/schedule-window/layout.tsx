'use client'

/**
 * Минимальный layout для popup-окна расписания из карточки сделки CRM.
 * Никаких Sidebar/Header — только auth-guard и общий фон, чтобы всплывающее
 * окно вмещало целиком сетку расписания.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

export default function ScheduleWindowLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useCurrentUser()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) router.push('/login')
  }, [isLoading, user, router])

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Загрузка…</p>
      </div>
    )
  }
  if (!user) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-2">{children}</main>
    </div>
  )
}
