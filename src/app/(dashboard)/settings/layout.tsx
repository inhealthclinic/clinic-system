'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SETTINGS_NAV = [
  { href: '/settings/clinic',        label: 'Клиника',         icon: '🏥' },
  { href: '/settings/doctors',       label: 'Врачи',           icon: '👨‍⚕️' },
  { href: '/settings/services',      label: 'Услуги / Прайс',  icon: '📋' },
  { href: '/settings/users',         label: 'Сотрудники и роли', icon: '👥' },
  { href: '/settings/lab',           label: 'Анализы (шаблоны)', icon: '🧪' },
  { href: '/settings/pipelines',     label: 'CRM — воронки и автоматизации', icon: '📊' },
  { href: '/settings/salesbots',         label: 'Salesbot и шаблоны', icon: '🤖' },
  { href: '/settings/notifications', label: 'Уведомления',     icon: '🔔' },
  { href: '/settings/schedule',     label: 'Типы записей',    icon: '🎨' },
  { href: '/settings/packages',    label: 'Пакеты анализов', icon: '📦' },
  { href: '/settings/audit',       label: 'Журнал действий', icon: '📜' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // На редакторе воронки нужен максимум ширины — там горизонтальный канвас
  // amoCRM-стиля. Прячем sub-nav и контейнер.
  const fullscreenRoutes = ['/settings/pipelines', '/settings/salesbots/new']
  if (fullscreenRoutes.some(r => pathname?.startsWith(r))) {
    return <div className="w-full">{children}</div>
  }

  return (
    <div className="max-w-5xl mx-auto flex gap-6 items-start">
      {/* Sub-nav */}
      <aside className="w-52 flex-shrink-0 bg-white rounded-xl border border-gray-100 overflow-hidden sticky top-0">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Настройки</p>
        </div>
        <nav className="p-2">
          {SETTINGS_NAV.map(item => {
            const active = pathname === item.href || (item.href === '/settings/users' && pathname === '/settings/roles')
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
