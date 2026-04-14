'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface DashStats {
  appointments_total: number
  appointments_confirmed: number
  appointments_arrived: number
  appointments_completed: number
  visits_open: number
  revenue_today: number
  new_leads: number
}

const INITIAL: DashStats = {
  appointments_total: 0,
  appointments_confirmed: 0,
  appointments_arrived: 0,
  appointments_completed: 0,
  visits_open: 0,
  revenue_today: 0,
  new_leads: 0,
}

function StatCard({
  label,
  value,
  sub,
  color = 'blue',
}: {
  label: string
  value: string | number
  sub?: string
  color?: string
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-bold ${colors[color].split(' ')[1]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashStats>(INITIAL)
  const [loading, setLoading] = useState(true)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    const supabase = createClient()

    Promise.all([
      supabase
        .from('appointments')
        .select('status', { count: 'exact' })
        .gte('start_at', `${today}T00:00:00`)
        .lte('start_at', `${today}T23:59:59`),
      supabase
        .from('visits')
        .select('id', { count: 'exact' })
        .eq('status', 'open'),
      supabase
        .from('payments')
        .select('amount')
        .gte('created_at', `${today}T00:00:00`)
        .eq('status', 'paid'),
      supabase
        .from('deals')
        .select('id', { count: 'exact' })
        .eq('funnel', 'leads')
        .gte('created_at', `${today}T00:00:00`),
    ]).then(([appts, visits, payments, leads]) => {
      const rows = appts.data ?? []
      setStats({
        appointments_total: rows.length,
        appointments_confirmed: rows.filter((r) => r.status === 'confirmed').length,
        appointments_arrived: rows.filter((r) => r.status === 'arrived').length,
        appointments_completed: rows.filter((r) => r.status === 'completed').length,
        visits_open: visits.count ?? 0,
        revenue_today: (payments.data ?? []).reduce((s, r) => s + (r.amount ?? 0), 0),
        new_leads: leads.count ?? 0,
      })
      setLoading(false)
    })
  }, [today])

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Сегодня</h2>
        <p className="text-sm text-gray-400">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard label="Записей" value={stats.appointments_total} color="blue" />
            <StatCard label="Подтверждено" value={stats.appointments_confirmed} color="green" />
            <StatCard label="Пришли" value={stats.appointments_arrived} color="orange" />
            <StatCard label="Принято" value={stats.appointments_completed} color="purple" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Открытых визитов" value={stats.visits_open} color="orange" />
            <StatCard label="Выручка за день" value={fmt(stats.revenue_today)} color="green" />
            <StatCard label="Новых лидов" value={stats.new_leads} color="blue" />
          </div>
        </>
      )}
    </div>
  )
}
