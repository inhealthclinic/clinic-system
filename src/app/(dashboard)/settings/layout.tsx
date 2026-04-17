'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SETTINGS_NAV = [
  { href: '/settings/clinic',        label: 'Клиника',         icon: '🏥' },
  { href: '/settings/doctors',       label: 'Врачи',           icon: '👨‍⚕️' },
  { href: '/settings/services',      label: 'Услуги / Прайс',  icon: '📋' },
  { href: '/settings/users',         label: 'Сотрудники',      icon: '👥' },
  { href: '/settings/roles',         label: 'Роли и доступ',   icon: '🔐' },
  { href: '/settings/lab',           label: 'Анализы (шаблоны)', icon: '🧪' },
  { href: '/settings/crm',          label: 'CRM — воронки',   icon: '📊' },
  { href: '/settings/notifications', label: 'Уведомления',     icon: '🔔' },
  { href: '/settings/schedule',     label: 'Типы записей',    icon: '🎨' },
  { href: '/settings/packages',    label: 'Пакеты анализов', icon: '📦' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="max-w-5xl mx-auto flex gap-6 items-start">
      {/* Sub-nav */}
      <aside className="w-52 flex-shrink-0 bg-white rounded-xl border border-gray-100 overflow-hidden sticky top-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Настройки</p>
        </div>
        <nav className="p-2">
          {SETTINGS_NAV.map(item => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                  active
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                ].join(' ')}
              >
                <span className="text-base leading-none">{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
