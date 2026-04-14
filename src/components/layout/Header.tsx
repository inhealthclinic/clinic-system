'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface SearchResult {
  id: string
  type: 'patient' | 'appointment'
  title: string
  subtitle: string
  href: string
}

export function Header({ onMenuClick }: { onMenuClick?: () => void }) {
  const router = useRouter()
  const supabase = createClient()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState(0)

  // Счётчик срочных задач
  useEffect(() => {
    supabase.from('tasks')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'overdue'])
      .then(({ count }) => setTasks(count || 0))
  }, [])

  // Глобальный поиск
  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id, full_name, phones, patient_number')
        .or(`full_name.ilike.%${query}%,patient_number.ilike.%${query}%`)
        .is('deleted_at', null)
        .limit(6)

      setResults((data || []).map(p => ({
        id: p.id,
        type: 'patient' as const,
        title: p.full_name,
        subtitle: `${p.patient_number} · ${p.phones?.[0] || ''}`,
        href: `/patients/${p.id}`,
      })))
      setOpen(true)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const go = (href: string) => {
    router.push(href)
    setQuery('')
    setOpen(false)
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-4 shrink-0">
      {/* Мобильное меню */}
      <button onClick={onMenuClick} className="lg:hidden text-gray-500 hover:text-gray-700">
        ☰
      </button>

      {/* Поиск */}
      <div className="flex-1 max-w-md relative">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder="Поиск пациентов..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none focus:bg-white"
          />
        </div>
        {open && results.length > 0 && (
          <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 mt-1 overflow-hidden">
            {results.map(r => (
              <button key={r.id} onClick={() => go(r.href)}
                className="w-full text-left px-4 py-2.5 hover:bg-blue-50 border-b border-gray-50 last:border-0">
                <p className="text-sm font-medium text-gray-800">{r.title}</p>
                <p className="text-xs text-gray-400">{r.subtitle}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Задачи */}
      <button onClick={() => router.push('/tasks')}
        className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl">
        ✅
        {tasks > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
            {tasks > 9 ? '9+' : tasks}
          </span>
        )}
      </button>
    </header>
  )
}
