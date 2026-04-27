'use client'

import { usePathname, useRouter } from 'next/navigation'

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
  const router = useRouter()

  const title = Object.entries(TITLES).find(([path]) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)
  )?.[1] ?? ''

  const isCrm = pathname.startsWith('/crm') || pathname.startsWith('/tasks')

  // Показываем кнопку «Назад» на мобильном когда находимся на вложенной
  // динамической странице: /patients/[uuid], /visits/[id], /patients/[id]/medical-card и т.п.
  // Признак вложенности: второй сегмент пути похож на UUID/ID или путь имеет 3+ сегмента.
  const segments = pathname.split('/').filter(Boolean)
  const isNestedPage =
    segments.length >= 2 &&
    (/^[0-9a-f]{8}/i.test(segments[1]) || segments.length >= 3)

  return (
    <header
      className={
        isCrm
          ? 'bg-transparent flex items-center px-4 gap-4 flex-shrink-0 h-0 lg:h-0 [&>*]:lg:hidden'
          : 'h-16 bg-white border-b border-gray-100 flex items-center px-4 gap-4 flex-shrink-0'
      }
    >
      {/* На вложенных страницах мобильного — кнопка «Назад» вместо бургера */}
      {isNestedPage ? (
        <button
          onClick={() => router.back()}
          className="lg:hidden flex items-center gap-1 p-2 text-blue-600 hover:text-blue-700 rounded-lg hover:bg-blue-50 -ml-1"
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span className="text-sm font-medium">Назад</span>
        </button>
      ) : (
        <button
          onClick={onMenuClick}
          className={
            isCrm
              ? 'lg:hidden fixed top-2 left-2 z-30 p-2 text-gray-500 hover:text-gray-700 rounded-lg bg-white/80 backdrop-blur hover:bg-gray-100 shadow-sm'
              : 'lg:hidden p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100'
          }
        >
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
            <path d="M3 12h18M3 6h18M3 18h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      )}
      {!isCrm && <h1 className="text-base font-semibold text-gray-900">{title}</h1>}
    </header>
  )
}
