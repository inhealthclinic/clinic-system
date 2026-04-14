'use client'

import { usePathname } from 'next/navigation'

const TITLES: Record<string, string> = {
  '/': 'Дашборд',
  '/schedule': 'Расписание',
  '/patients': 'Пациенты',
  '/crm': 'CRM',
  '/finance': 'Финансы',
  '/lab': 'Лаборатория',
  '/tasks': 'Задачи',
  '/settings/users': 'Пользователи',
  '/settings/roles': 'Роли и права',
}

interface HeaderProps {
  onMenuClick: () => void
}

export function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname()

  const title = Object.entries(TITLES).find(([path]) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)
  )?.[1] ?? ''

  return (
    <header className="h-16 bg-white border-b border-gray-100 flex items-center px-4 gap-4 flex-shrink-0">
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
      >
        <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
          <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      <h1 className="text-base font-semibold text-gray-900">{title}</h1>
    </header>
  )
}
