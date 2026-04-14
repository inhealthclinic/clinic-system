'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { LabOrder } from '@/types'

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  ready: 'bg-green-100 text-green-700',
  verified: 'bg-purple-100 text-purple-700',
  sent: 'bg-teal-100 text-teal-700',
}

const STATUS_RU: Record<string, string> = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  ready: 'Готово',
  verified: 'Верифицировано',
  sent: 'Отправлено',
}

const PRIORITY_COLOR: Record<string, string> = {
  routine: 'text-gray-400',
  urgent: 'text-orange-500',
  stat: 'text-red-600 font-bold',
}

export default function LabPage() {
  const [orders, setOrders] = useState<LabOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('active')

  useEffect(() => {
    setLoading(true)
    const supabase = createClient()
    let query = supabase
      .from('lab_orders')
      .select('*, patient:patients(id, full_name), doctor:doctors(id, first_name, last_name)')
      .order('ordered_at', { ascending: false })
      .limit(50)

    if (filter === 'active') {
      query = query.in('status', ['pending', 'in_progress'])
    } else if (filter === 'ready') {
      query = query.in('status', ['ready', 'verified'])
    }

    query.then(({ data }) => {
      setOrders(data ?? [])
      setLoading(false)
    })
  }, [filter])

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {[
          { key: 'active', label: 'Активные' },
          { key: 'ready', label: 'Готовые' },
          { key: 'all', label: 'Все' },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              filter === f.key
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-sm text-gray-400">{orders.length} направлений</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Направлений нет</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Пациент</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Врач</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Приоритет</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Дата</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4 text-sm font-medium text-gray-900">
                    {o.patient?.full_name ?? '—'}
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500">
                    {o.doctor ? `${o.doctor.last_name} ${o.doctor.first_name}` : '—'}
                  </td>
                  <td className={`px-5 py-4 text-sm ${PRIORITY_COLOR[o.priority]}`}>
                    {{ routine: 'Плановый', urgent: 'Срочный', stat: 'СТАТ' }[o.priority] ?? o.priority}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status] ?? ''}`}>
                      {STATUS_RU[o.status] ?? o.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-400">
                    {new Date(o.ordered_at).toLocaleDateString('ru-RU', {
                      day: 'numeric', month: 'short',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
