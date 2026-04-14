'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { useAuthStore } from '@/lib/stores/authStore'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  { href: '/',           icon: '🏠', label: 'Дашборд',    perm: null },
  { href: '/schedule',   icon: '📅', label: 'Расписание', perm: 'schedule:view' },
  { href: '/patients',   icon: '👥', label: 'Пациенты',   perm: 'patients:view' },
  { href: '/visits',     icon: '🏥', label: 'Визиты',     perm: 'visit:view' },
  { href: '/crm',        icon: '📊', label: 'CRM',        perm: 'crm:view' },
  { href: '/lab',        icon: '🔬', label: 'Лаборатория',perm: 'lab:view' },
  { href: '/finance',    icon: '💰', label: 'Финансы',    perm: 'finance:view' },
  { href: '/tasks',      icon: '✅', label: 'Задачи',     perm: 'tasks:view' },
  { href: '/analytics',  icon: '📈', label: 'Аналитика',  perm: 'analytics:view' },
]

const SETTINGS_NAV = [
  { href: '/settings/clinic',         label: 'Клиника',       perm: 'settings:clinic' },
  { href: '/settings/users',          label: 'Сотрудники',    perm: 'settings:users' },
  { href: '/settings/roles',          label: 'Роли и права',  perm: 'settings:roles' },
  { href: '/settings/doctors',        label: 'Врачи',         perm: 'settings:doctors' },
  { href: '/settings/services',       label: 'Услуги',        perm: 'settings:services' },
  { href: '/settings/lab-templates',  label: 'Шаблоны лаб.',  perm: 'settings:lab_templates' },
  { href: '/settings/notifications',  label: 'Уведомления',   perm: 'settings:notifications' },
]

interface Props { onClose?: () => void }

export function Sidebar({ onClose }: Props) {
  const pathname = usePathname()
  const { can } = usePermissions()
  const { user } = useAuthStore()
  const supabase = createClient()

  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white w-56 shrink-0">
      {/* Логотип */}
      <div className="px-4 py-5 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">
            iH
          </div>
          <div>
            <p className="text-sm font-bold">in health</p>
            <p className="text-xs text-gray-400">МИС</p>
          </div>
        </div>
      </div>

      {/* Навигация */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="space-y-0.5">
          {NAV.filter(item => !item.perm || can(item.perm)).map(item => (
            <Link key={item.href} href={item.href} onClick={onClose}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}>
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        {/* Настройки */}
        {SETTINGS_NAV.some(s => can(s.perm)) && (
          <div className="mt-6">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 mb-2">
              Настройки
            </p>
            <div className="space-y-0.5">
              {SETTINGS_NAV.filter(s => can(s.perm)).map(item => (
                <Link key={item.href} href={item.href} onClick={onClose}
                  className={`flex items-center px-3 py-2 rounded-xl text-sm transition-colors ${
                    pathname.startsWith(item.href)
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}>
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Пользователь */}
      <div className="p-3 border-t border-gray-800">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-800 cursor-pointer group">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-sm font-bold shrink-0">
            {user?.first_name?.[0]}{user?.last_name?.[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-gray-400 truncate">{user?.role?.name}</p>
          </div>
          <button onClick={logout}
            className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity text-xs">
            →
          </button>
        </div>
      </div>
    </div>
  )
}
