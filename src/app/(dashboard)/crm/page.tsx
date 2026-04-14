'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Deal } from '@/types'

const LEADS_STAGES = [
  { key: 'new', label: 'Новый' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'contact', label: 'Связались' },
  { key: 'booked', label: 'Записан' },
]

const PRIORITY_COLOR: Record<string, string> = {
  hot: 'bg-red-100 text-red-600',
  warm: 'bg-orange-100 text-orange-600',
  cold: 'bg-blue-100 text-blue-600',
}

const PRIORITY_RU: Record<string, string> = {
  hot: 'Горячий',
  warm: 'Тёплый',
  cold: 'Холодный',
}

function DealCard({ deal }: { deal: Deal }) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-gray-900 leading-tight">
          {deal.patient?.full_name ?? 'Без имени'}
        </p>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${PRIORITY_COLOR[deal.priority]}`}>
          {PRIORITY_RU[deal.priority]}
        </span>
      </div>
      {deal.patient?.phones?.[0] && (
        <p className="text-xs text-gray-400 mb-1">{deal.patient.phones[0]}</p>
      )}
      {deal.source && (
        <p className="text-xs text-gray-400">{deal.source}</p>
      )}
      <p className="text-xs text-gray-300 mt-2">
        {new Date(deal.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
      </p>
    </div>
  )
}

export default function CrmPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState<'leads' | 'medical'>('leads')

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('deals')
      .select('*, patient:patients(id, full_name, phones)')
      .eq('funnel', funnel)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setDeals(data ?? [])
        setLoading(false)
      })
  }, [funnel])

  const columns = funnel === 'leads'
    ? LEADS_STAGES
    : [
        { key: 'booked', label: 'Записан' },
        { key: 'confirmed', label: 'Подтверждён' },
        { key: 'arrived', label: 'Пришёл' },
        { key: 'in_visit', label: 'На приёме' },
        { key: 'completed', label: 'Завершён' },
        { key: 'follow_up', label: 'Follow-up' },
      ]

  return (
    <div className="max-w-full">
      {/* Funnel tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(['leads', 'medical'] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setFunnel(f); setLoading(true) }}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              funnel === f
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {f === 'leads' ? 'Лиды' : 'Медицинская'}
          </button>
        ))}
        <span className="ml-2 text-sm text-gray-400">{deals.length} сделок</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">Загрузка...</div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => {
            const colDeals = deals.filter((d) => d.stage === col.key)
            return (
              <div key={col.key} className="flex-shrink-0 w-60">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {col.label}
                  </h3>
                  <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
                    {colDeals.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {colDeals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} />
                  ))}
                  {colDeals.length === 0 && (
                    <div className="text-center py-4 text-xs text-gray-300 border border-dashed border-gray-200 rounded-lg">
                      Пусто
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
