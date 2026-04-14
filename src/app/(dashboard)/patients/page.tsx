'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Patient } from '@/types'

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый',
  active: 'Активный',
  in_treatment: 'На лечении',
  completed: 'Завершён',
  lost: 'Потерян',
  vip: 'VIP',
}

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  active: 'bg-blue-100 text-blue-700',
  in_treatment: 'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
  lost: 'bg-red-100 text-red-600',
  vip: 'bg-yellow-100 text-yellow-700',
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    const supabase = createClient()
    let query = supabase
      .from('patients')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (q.trim()) {
      query = query.ilike('full_name', `%${q}%`)
    }

    const { data, count } = await query
    setPatients(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search), 300)
    return () => clearTimeout(t)
  }, [search, load])

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Пациенты</h2>
          <p className="text-sm text-gray-400">{total} записей</p>
        </div>
        <Link
          href="/patients/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Новый пациент
        </Link>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени или телефону..."
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : patients.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {search ? 'Ничего не найдено' : 'Пациентов пока нет'}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Пациент</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Телефон</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Баланс</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Карта</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <Link href={`/patients/${p.id}`} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs flex-shrink-0">
                        {p.full_name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 hover:text-blue-600">
                          {p.full_name}
                        </p>
                        {p.birth_date && (
                          <p className="text-xs text-gray-400">
                            {new Date(p.birth_date).toLocaleDateString('ru-RU')}
                          </p>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">{p.phones[0] ?? '—'}</td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">
                    {p.balance_amount > 0 && (
                      <span className="text-green-600">+{p.balance_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.debt_amount > 0 && (
                      <span className="text-red-500">-{p.debt_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.balance_amount === 0 && p.debt_amount === 0 && '—'}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-400">{p.patient_number ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
