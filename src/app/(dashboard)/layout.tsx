'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav } from '@/components/layout/BottomNav'
import { CommandPalette } from '@/components/CommandPalette'
import { UnreadNotifier } from '@/components/layout/UnreadNotifier'
import { LabNotifier } from '@/components/layout/LabNotifier'
import { TaskNotifier } from '@/components/layout/TaskNotifier'
import { Notifier } from '@/lib/ui/notify'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, user } = useCurrentUser()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // На /crm и /settings/pipelines сводим внешние отступы к минимуму,
  // чтобы канвас и тулбар занимали всю ширину (как в амоCRM).
  const isCrm = pathname.startsWith('/crm') || pathname.startsWith('/settings/pipelines')

  useEffect(() => {
    if (!isLoading && !user) {
      // Сохраняем текущий путь + query, чтобы после логина вернуть
      // пользователя в то же место, а не кидать на корневой дашборд.
      const search = typeof window !== 'undefined' ? window.location.search : ''
      const returnTo = (pathname || '/') + search
      const qs = returnTo && returnTo !== '/'
        ? `?redirect=${encodeURIComponent(returnTo)}`
        : ''
      router.replace(`/login${qs}`)
    }
  }, [isLoading, user, router, pathname])

  if (isLoading) {
    return (
      <div className="min-h-screen-safe bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold mx-auto mb-3">
            iH
          </div>
          <p className="text-sm text-gray-400">Загрузка...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="flex h-screen-safe overflow-hidden bg-gray-50">
      {/* Global Cmd+K search */}
      <CommandPalette />
      {/* Тосты + звук + Notifications для входящих сообщений по «моим» сделкам */}
      <UnreadNotifier />
      {/* Тосты для новых заказов в лабораторию */}
      <LabNotifier />
      {/* Тосты + звук + Notifications для задач, назначенных текущему юзеру */}
      <TaskNotifier />
      {/* Глобальные toast/confirm — замена нативных alert()/confirm() */}
      <Notifier />
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative z-50 h-full w-60">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className={`flex-1 overflow-auto ${isCrm ? 'p-3 lg:pb-3' : 'p-6 lg:pb-6'} pb-20`}>
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation — только на < 1024px */}
      <BottomNav onMenuOpen={() => setSidebarOpen(true)} />
    </div>
  )
}
