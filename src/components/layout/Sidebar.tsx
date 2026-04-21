'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/lib/stores/authStore'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useUnreadDealMessages } from '@/lib/hooks/useUnreadDealMessages'
import { useLabPendingOrders } from '@/lib/hooks/useLabPendingOrders'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  dividerBefore?: boolean
  /** Ключ для бейджика. */
  badgeKey?: 'crm-unread' | 'lab-pending'
  /**
   * Ролевые ограничения: если массив задан — пункт виден только
   * пользователям с одной из перечисленных ролей. owner всегда видит всё.
   * Если не задан — пункт виден всем.
   */
  roles?: Array<'admin' | 'doctor' | 'nurse' | 'laborant' | 'cashier' | 'manager'>
}

const NAV: NavItem[] = [
  {
    label: 'Дашборд',
    href: '/',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    label: 'Расписание',
    href: '/schedule',
    roles: ['admin', 'doctor', 'nurse', 'manager'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M16 2v4M8 2v4M3 9h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Визиты',
    href: '/visits',
    roles: ['admin', 'doctor', 'nurse'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Пациенты',
    href: '/patients',
    roles: ['admin', 'doctor', 'nurse', 'manager', 'cashier'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'CRM',
    href: '/crm',
    badgeKey: 'crm-unread',
    roles: ['admin', 'manager'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="19" cy="6" r="2" fill="currentColor"/>
      </svg>
    ),
  },
  {
    label: 'Финансы',
    href: '/finance',
    roles: ['admin', 'cashier'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Лаборатория',
    href: '/lab',
    badgeKey: 'lab-pending',
    roles: ['admin', 'doctor', 'laborant', 'nurse'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M9 3h6M10 3v7l-4 9h12l-4-9V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    label: 'Задачи',
    href: '/tasks',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    label: 'Склад',
    href: '/inventory',
    roles: ['admin', 'laborant', 'nurse'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Аналитика',
    href: '/analytics',
    roles: ['admin'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Настройки',
    href: '/settings/clinic',
    dividerBefore: true,
    roles: ['admin'],
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
]

interface SidebarProps {
  onClose?: () => void
}

export function Sidebar({ onClose }: SidebarProps) {
  const pathname = usePathname()
  const { profile, reset } = useAuthStore()
  const router = useRouter()
  // Бейджик «непрочитанные входящие по моим сделкам» на пункте CRM.
  const { count: crmUnread } = useUnreadDealMessages()
  // Бейджик «новые заказы в лабораторию» на пункте Лаборатория.
  const { count: labPending } = useLabPendingOrders()

  // owner видит всё; остальные — только пункты, где их роль перечислена в roles.
  const roleSlug = profile?.role?.slug
  const visibleNav = NAV.filter(item => {
    if (!item.roles) return true
    if (roleSlug === 'owner') return true
    return roleSlug ? item.roles.includes(roleSlug as NonNullable<NavItem['roles']>[number]) : false
  })

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    // Settings sub-pages all start with /settings — match any of them when href is /settings/users
    if (href === '/settings/clinic') {
      return pathname.startsWith('/settings')
    }
    return pathname.startsWith(href)
  }

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    reset()
    router.push('/login')
  }

  return (
    <aside className="w-60 h-full bg-white border-r border-gray-100 flex flex-col">
      {/* Logo */}
      <div className="h-16 px-5 flex items-center gap-3 border-b border-gray-100">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
          iH
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900 leading-tight">in health</p>
          <p className="text-xs text-gray-400 leading-tight">МИС</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="space-y-0.5">
          {visibleNav.map((item) => (
            <div key={item.href}>
              {item.dividerBefore && (
                <div className="my-2 border-t border-gray-100" />
              )}
              <Link
                href={item.href}
                onClick={onClose}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive(item.href)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                ].join(' ')}
              >
                <span className={isActive(item.href) ? 'text-blue-600' : 'text-gray-400'}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.badgeKey === 'crm-unread' && crmUnread > 0 && (
                  <span
                    className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold leading-none"
                    aria-label={`${crmUnread} непрочитанных сообщений`}
                  >
                    {crmUnread > 99 ? '99+' : crmUnread}
                  </span>
                )}
                {item.badgeKey === 'lab-pending' && labPending > 0 && (
                  <span
                    className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-purple-500 text-white text-[11px] font-semibold leading-none"
                    aria-label={`${labPending} новых анализов`}
                  >
                    {labPending > 99 ? '99+' : labPending}
                  </span>
                )}
              </Link>
            </div>
          ))}
        </div>
      </nav>

      {/* User */}
      {profile && (
        <div className="px-3 py-4 border-t border-gray-100">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs flex-shrink-0">
              {profile.first_name[0]}{profile.last_name[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-900 truncate">
                {profile.first_name} {profile.last_name}
              </p>
              <p className="text-xs text-gray-400 truncate">{profile.role?.name}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Выйти"
              className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
