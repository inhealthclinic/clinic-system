'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Appointment, Doctor } from '@/types'

const HOURS = Array.from({ length: 11 }, (_, i) => i + 8) // 8..18

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-blue-100 border-blue-300 text-blue-800',
  confirmed: 'bg-green-100 border-green-300 text-green-800',
  arrived: 'bg-yellow-100 border-yellow-300 text-yellow-800',
  in_visit: 'bg-orange-100 border-orange-300 text-orange-800',
  completed: 'bg-gray-100 border-gray-200 text-gray-600',
  no_show: 'bg-red-100 border-red-200 text-red-600',
  cancelled: 'bg-gray-50 border-gray-200 text-gray-400 line-through',
}

export default function SchedulePage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from('appointments')
        .select('*, patient:patients(id, full_name, phones), doctor:doctors(id, first_name, last_name, color)')
        .gte('start_at', `${date}T00:00:00`)
        .lte('start_at', `${date}T23:59:59`)
        .neq('status', 'cancelled')
        .order('start_at'),
      supabase
        .from('doctors')
        .select('id, first_name, last_name, color, consultation_duration')
        .eq('is_active', true)
        .is('deleted_at', null),
    ]).then(([appts, docs]) => {
      setAppointments(appts.data ?? [])
      setDoctors(docs.data ?? [])
      setLoading(false)
    })
  }, [date])

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="max-w-6xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => {
            const d = new Date(date); d.setDate(d.getDate() - 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
        >
          ‹
        </button>
        <div className="flex-1 text-center">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="sr-only"
            id="date-picker"
          />
          <label htmlFor="date-picker" className="text-base font-semibold text-gray-900 capitalize cursor-pointer hover:text-blue-600">
            {dateLabel}
          </label>
        </div>
        <button
          onClick={() => {
            const d = new Date(date); d.setDate(d.getDate() + 1)
            setDate(d.toISOString().slice(0, 10))
          }}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500"
        >
          ›
        </button>
        <button
          onClick={() => setDate(new Date().toISOString().slice(0, 10))}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium px-3 py-2 rounded-lg hover:bg-blue-50"
        >
          Сегодня
        </button>
        <span className="text-sm text-gray-400">{appointments.length} записей</span>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Загрузка...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-auto">
          <div className="divide-y divide-gray-50">
            {appointments.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">Записей на этот день нет</div>
            ) : (
              appointments.map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="w-20 flex-shrink-0 text-sm font-mono text-gray-500">
                    {fmt(a.start_at)}
                    {a.end_at && (
                      <span className="text-gray-300"> — {fmt(a.end_at)}</span>
                    )}
                  </div>
                  {a.doctor && (
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: (a.doctor as any).color ?? '#6B7280' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {a.patient?.full_name ?? 'Walk-in'}
                    </p>
                    {a.doctor && (
                      <p className="text-xs text-gray-400">
                        {(a.doctor as any).last_name} {(a.doctor as any).first_name}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLOR[a.status] ?? ''}`}>
                    {{
                      scheduled: 'Запись',
                      confirmed: 'Подтверждено',
                      arrived: 'Пришёл',
                      in_visit: 'На приёме',
                      completed: 'Завершено',
                      no_show: 'Не явился',
                      cancelled: 'Отменено',
                    }[a.status] ?? a.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
