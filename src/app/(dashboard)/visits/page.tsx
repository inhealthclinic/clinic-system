'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { today } from '@/lib/utils/schedule'

type VisitStatus = 'open' | 'in_progress' | 'completed' | 'partial'

const STATUS_LABELS: Record<VisitStatus, string> = {
  open: 'Ожидает', in_progress: 'На приёме',
  completed: 'Завершён', partial: 'Частично'
}
const STATUS_COLORS: Record<VisitStatus, string> = {
  open: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  partial: 'bg-amber-100 text-amber-700',
}

export default function VisitsPage() {
  const supabase = createClient()
  const router = useRouter()
  const [visits, setVisits] = useState<any[]>([])
  const [filter, setFilter] = useState<VisitStatus | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const todayStr = today()

  useEffect(() => {
    setLoading(true)
    let q = supabase
      .from('visits')
      .select(`
        *,
        patient:patients(id, full_name, phones),
        doctor:doctors(first_name, last_name, color),
        appointment:appointments(date, time_start, time_end, service:services(name))
      `)
      .gte('created_at', `${todayStr}T00:00:00`)
      .order('created_at', { ascending: false })

    if (filter !== 'all') q = (q as any).eq('status', filter)

    q.then(({ data }) => { setVisits(data || []); setLoading(false) })
  }, [filter])

  // Realtime
  useEffect(() => {
    const ch = supabase.channel('visits-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, () => {
        setFilter(f => f) // trigger reload
      }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const counts = {
    all:         visits.length,
    open:        visits.filter(v => v.status === 'open').length,
    in_progress: visits.filter(v => v.status === 'in_progress').length,
    completed:   visits.filter(v => v.status === 'completed').length,
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Визиты сегодня</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {/* Счётчики */}
        <div className="flex gap-3 text-sm">
          {[
            { label: 'На приёме', count: counts.in_progress, color: 'text-green-600' },
            { label: 'Ждут',      count: counts.open,        color: 'text-gray-500' },
            { label: 'Завершено', count: counts.completed,   color: 'text-blue-600' },
          ].map(s => (
            <div key={s.label} className="text-center bg-white border border-gray-200 rounded-xl px-4 py-2">
              <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2 mb-4">
        {([
          ['all', `Все (${counts.all})`],
          ['in_progress', 'На приёме'],
          ['open', 'Ожидают'],
          ['completed', 'Завершены'],
          ['partial', 'Частично'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              filter === k ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* Список */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <p className="text-center py-8 text-gray-400">Загрузка...</p>
        ) : visits.length === 0 ? (
          <p className="text-center py-12 text-gray-400">Нет визитов</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {visits.map(v => (
              <div key={v.id}
                onClick={() => router.push(`/visits/${v.id}`)}
                className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors">
                {/* Цвет врача */}
                <div className="w-1 h-10 rounded-full shrink-0"
                  style={{ backgroundColor: v.doctor?.color || '#6B7280' }} />

                {/* Время */}
                <div className="w-16 shrink-0 text-center">
                  <p className="text-sm font-mono font-semibold text-gray-700">
                    {v.appointment?.time_start?.slice(0,5) || '—'}
                  </p>
                  <p className="text-xs text-gray-400">
                    {v.appointment?.time_end?.slice(0,5)}
                  </p>
                </div>

                {/* Пациент */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {v.patient?.full_name}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {v.doctor?.first_name} {v.doctor?.last_name}
                    {v.appointment?.service?.name && ` · ${v.appointment.service.name}`}
                  </p>
                </div>

                {/* Статус */}
                <span className={`text-xs px-2.5 py-1 rounded-full shrink-0 ${STATUS_COLORS[v.status as VisitStatus]}`}>
                  {STATUS_LABELS[v.status as VisitStatus]}
                </span>

                {/* Финансы */}
                <div className="text-right shrink-0">
                  {!v.finance_settled && v.has_charges && (
                    <span className="text-xs text-orange-500">Не оплачен</span>
                  )}
                  {v.finance_settled && (
                    <span className="text-xs text-green-500">✓ Оплачен</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
