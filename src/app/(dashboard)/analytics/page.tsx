'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PermissionGuard } from '@/components/shared/PermissionGuard'

export default function AnalyticsPage() {
  const supabase = createClient()
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week')
  const [data, setData] = useState<any>(null)

  const getPeriodDates = () => {
    const to = new Date().toISOString().split('T')[0]
    const from = new Date(
      Date.now() - (period === 'today' ? 0 : period === 'week' ? 7 : 30) * 86400000
    ).toISOString().split('T')[0]
    return { from, to }
  }

  useEffect(() => {
    const { from, to } = getPeriodDates()
    Promise.all([
      supabase.from('payments').select('amount, method, paid_at')
        .eq('type', 'payment').eq('status', 'completed')
        .gte('paid_at', `${from}T00:00:00`).lte('paid_at', `${to}T23:59:59`),
      supabase.from('appointments').select('status, doctor_id, doctor:doctors(first_name, last_name)')
        .gte('date', from).lte('date', to),
      supabase.from('patients').select('id', { count: 'exact', head: true })
        .gte('created_at', `${from}T00:00:00`),
      supabase.from('deals').select('status, lost_reason, funnel')
        .gte('created_at', `${from}T00:00:00`),
    ]).then(([pay, apts, newPats, deals]) => {
      const payments = pay.data || []
      const appointments = apts.data || []

      // По методам оплаты
      const byMethod: Record<string, number> = {}
      payments.forEach(p => { byMethod[p.method] = (byMethod[p.method] || 0) + p.amount })

      // По врачам
      const byDoctor: Record<string, { name: string; count: number; completed: number }> = {}
      appointments.forEach((a: any) => {
        const key = a.doctor_id
        if (!byDoctor[key]) byDoctor[key] = {
          name: `${a.doctor?.first_name} ${a.doctor?.last_name}`, count: 0, completed: 0
        }
        byDoctor[key].count++
        if (a.status === 'completed') byDoctor[key].completed++
      })

      setData({
        revenue: payments.reduce((s, p) => s + p.amount, 0),
        byMethod,
        byDoctor: Object.values(byDoctor).sort((a, b) => b.count - a.count),
        newPatients: newPats.count || 0,
        totalAppointments: appointments.filter(a => !['cancelled','rescheduled'].includes(a.status)).length,
        completedAppointments: appointments.filter(a => a.status === 'completed').length,
        noShows: appointments.filter(a => a.status === 'no_show').length,
        leads: (deals.data || []).filter(d => d.funnel === 'leads').length,
        lostDeals: (deals.data || []).filter(d => d.status === 'lost').length,
      })
    })
  }, [period])

  const methodLabels: Record<string, string> = {
    cash: '💵 Наличные', kaspi: '📱 Kaspi', halyk: '💳 Halyk',
    credit: '📋 Кредит', balance: '💰 Депозит',
  }

  return (
    <PermissionGuard permission="analytics:view" fallback={
      <div className="flex items-center justify-center h-96 text-gray-400">Нет доступа</div>
    }>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Аналитика</h1>
          <div className="flex bg-gray-100 rounded-xl p-1">
            {([['today','Сегодня'],['week','Неделя'],['month','Месяц']] as const).map(([k,l]) => (
              <button key={k} onClick={() => setPeriod(k)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  period === k ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}>{l}</button>
            ))}
          </div>
        </div>

        {!data ? (
          <p className="text-center text-gray-400 py-12">Загрузка...</p>
        ) : (
          <>
            {/* KPI */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Выручка', value: `${data.revenue.toLocaleString()} ₸`, color: 'text-green-600' },
                { label: 'Записей', value: data.totalAppointments, color: 'text-gray-800' },
                { label: 'Новых пациентов', value: data.newPatients, color: 'text-blue-600' },
                { label: 'Новых лидов', value: data.leads, color: 'text-purple-600' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* По методам оплаты */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Оплаты по методам</h3>
                {Object.keys(data.byMethod).length === 0 ? (
                  <p className="text-gray-400 text-sm">Нет данных</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(data.byMethod)
                      .sort(([,a], [,b]) => (b as number) - (a as number))
                      .map(([method, amount]) => {
                        const pct = data.revenue > 0 ? Math.round((amount as number) / data.revenue * 100) : 0
                        return (
                          <div key={method}>
                            <div className="flex justify-between text-sm mb-1">
                              <span className="text-gray-700">{methodLabels[method] || method}</span>
                              <span className="font-medium">{(amount as number).toLocaleString()} ₸ · {pct}%</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full">
                              <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>

              {/* По врачам */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-800 mb-4">Загрузка врачей</h3>
                {data.byDoctor.length === 0 ? (
                  <p className="text-gray-400 text-sm">Нет данных</p>
                ) : (
                  <div className="space-y-3">
                    {data.byDoctor.map((d: any) => {
                      const pct = d.count > 0 ? Math.round(d.completed / d.count * 100) : 0
                      return (
                        <div key={d.name}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-700 truncate">{d.name}</span>
                            <span className="text-gray-400 shrink-0 ml-2">
                              {d.completed}/{d.count} · {pct}%
                            </span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full">
                            <div className="h-2 bg-green-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* No-show + конверсия */}
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Не явились', value: data.noShows, note: `из ${data.totalAppointments}`, color: data.noShows > 0 ? 'text-red-500' : 'text-gray-400' },
                { label: 'Выполнено', value: data.completedAppointments, note: `${data.totalAppointments > 0 ? Math.round(data.completedAppointments/data.totalAppointments*100) : 0}%`, color: 'text-green-600' },
                { label: 'Потеряно лидов', value: data.lostDeals, color: data.lostDeals > 0 ? 'text-orange-500' : 'text-gray-400' },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
                  <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{s.label}</p>
                  {s.note && <p className="text-xs text-gray-300">{s.note}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </PermissionGuard>
  )
}
