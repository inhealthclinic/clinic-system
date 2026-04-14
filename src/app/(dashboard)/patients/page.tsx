'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import type { Patient } from '@/types/app'

const STATUS_LABELS: Record<string, string> = {
  new: 'Новый', active: 'Активный', in_treatment: 'На лечении',
  completed: 'Завершён', lost: 'Потерян', vip: 'VIP'
}
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  active: 'bg-blue-100 text-blue-700',
  in_treatment: 'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
  lost: 'bg-red-100 text-red-500',
  vip: 'bg-amber-100 text-amber-700',
}

export default function PatientsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [patients,  setPatients]  = useState<Patient[]>([])
  const [search,    setSearch]    = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [page,      setPage]      = useState(0)
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(false)
  const PER_PAGE = 25

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('patients')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(page * PER_PAGE, (page + 1) * PER_PAGE - 1)

    if (search.length >= 2) {
      q = q.or(`full_name.ilike.%${search}%,iin.ilike.%${search}%`)
    }
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)

    const { data, count } = await q
    setPatients(data || [])
    setTotal(count || 0)
    setLoading(false)
  }, [search, statusFilter, page])

  useEffect(() => { setPage(0) }, [search, statusFilter])
  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Шапка */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Пациенты</h1>
          <p className="text-gray-400 text-sm mt-0.5">Всего: {total.toLocaleString()}</p>
        </div>
        <PermissionGuard permission="patients:create">
          <button onClick={() => router.push('/patients/new')}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
            + Новый пациент
          </button>
        </PermissionGuard>
      </div>

      {/* Поиск + фильтры */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени, телефону, ИИН..."
            className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
          <option value="all">Все статусы</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Пациент</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Телефон</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Статус</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Баланс</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Долг</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Добавлен</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : patients.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Пациенты не найдены</td></tr>
            ) : patients.map(p => (
              <tr key={p.id} onClick={() => router.push(`/patients/${p.id}`)}
                className="hover:bg-blue-50/30 cursor-pointer transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-bold shrink-0">
                      {p.full_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 flex items-center gap-1">
                        {p.full_name}
                        {p.is_vip && <span className="text-amber-400 text-xs">★</span>}
                      </p>
                      <p className="text-xs text-gray-400">{p.patient_number}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{p.phones?.[0] || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status]}`}>
                    {STATUS_LABELS[p.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {p.balance_amount > 0 ? (
                    <span className="text-green-600 font-medium">{p.balance_amount.toLocaleString()} ₸</span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right">
                  {p.debt_amount > 0 ? (
                    <span className="text-red-500 font-medium">{p.debt_amount.toLocaleString()} ₸</span>
                  ) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(p.created_at).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: '2-digit' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Пагинация */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              {page * PER_PAGE + 1}–{Math.min((page + 1) * PER_PAGE, total)} из {total}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40">←</button>
              <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40">→</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
