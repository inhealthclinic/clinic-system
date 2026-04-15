'use client'

import Link from 'next/link'
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

interface QuickLink {
  label: string
  href: string
  iconColor: string
  icon: React.ReactNode
}

const QUICK_LINKS: QuickLink[] = [
  {
    label: 'Записать пациента',
    href: '/schedule',
    iconColor: 'text-blue-600 bg-blue-50',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
        <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M16 2v4M8 2v4M3 9h18M12 13v4M10 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Новый пациент',
    href: '/patients/new',
    iconColor: 'text-green-600 bg-green-50',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
        <circle cx="10" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 20c0-3.314 3.134-6 7-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M18 14v6M15 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Принять оплату',
    href: '/finance',
    iconColor: 'text-orange-600 bg-orange-50',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
        <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 10h20M6 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'Новая задача',
    href: '/tasks',
    iconColor: 'text-purple-600 bg-purple-50',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
]

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
        .eq('date', today),
      supabase
        .from('visits')
        .select('id', { count: 'exact' })
        .eq('status', 'open'),
      supabase
        .from('payments')
        .select('amount')
        .eq('status', 'completed')
        .gte('paid_at', `${today}T00:00:00`)
        .neq('type', 'refund'),
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
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <StatCard label="Открытых визитов" value={stats.visits_open} color="orange" />
            <StatCard label="Выручка за день" value={fmt(stats.revenue_today)} color="green" />
            <StatCard label="Новых лидов" value={stats.new_leads} color="blue" />
          </div>
        </>
      )}

      {/* Quick links */}
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Быстрые действия</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {QUICK_LINKS.map((ql) => (
            <Link
              key={ql.href}
              href={ql.href}
              className="bg-white rounded-xl border border-gray-100 p-4 flex flex-col items-start gap-3 hover:border-gray-200 hover:shadow-sm transition-all group"
            >
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ql.iconColor}`}>
                {ql.icon}
              </span>
              <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900 leading-tight">
                {ql.label}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
