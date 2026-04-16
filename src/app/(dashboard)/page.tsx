'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface DashStats {
  appointments_total: number
  appointments_confirmed: number
  appointments_arrived: number
  appointments_completed: number
  visits_open: number
  revenue_today: number
  new_leads: number
}

interface UpcomingAppt {
  id: string
  start_time: string
  patient_name: string
  doctor_name: string
  status: string
}

interface OverdueTask {
  id: string
  title: string
  due_at: string | null
  priority: string
  patient_name?: string | null
}

interface CriticalLab {
  id: string
  patient_name: string
  order_number: string | null
  completed_at: string
}

interface StaleLead {
  id: string
  patient_name: string
  stage: string
  days: number
}

interface SessionStatus {
  id: string
  opened_at: string
  cashier_name?: string
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

const STATUS_DOT: Record<string, string> = {
  scheduled:  'bg-gray-300',
  confirmed:  'bg-blue-400',
  arrived:    'bg-orange-400',
  in_visit:   'bg-purple-400',
  completed:  'bg-green-500',
  no_show:    'bg-red-400',
  cancelled:  'bg-gray-200',
}

const STATUS_RU: Record<string, string> = {
  scheduled:  'Запланирован',
  confirmed:  'Подтверждён',
  arrived:    'Пришёл',
  in_visit:   'На приёме',
  completed:  'Завершён',
  no_show:    'Не пришёл',
  cancelled:  'Отменён',
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
  const { profile } = useAuthStore()
  const userId = profile?.id ?? ''

  const [stats, setStats] = useState<DashStats>(INITIAL)
  const [upcoming, setUpcoming] = useState<UpcomingAppt[]>([])
  const [overdueTasks, setOverdueTasks] = useState<OverdueTask[]>([])
  const [criticalLabs, setCriticalLabs] = useState<CriticalLab[]>([])
  const [staleLeads, setStaleLeads] = useState<StaleLead[]>([])
  const [session, setSession] = useState<SessionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  useEffect(() => {
    const supabase = createClient()
    const nowISO = new Date().toISOString()
    const nowTime = new Date().toTimeString().slice(0, 8)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    Promise.all([
      // Today's appointments stats
      supabase
        .from('appointments')
        .select('status', { count: 'exact' })
        .eq('date', today),
      // Open visits
      supabase
        .from('visits')
        .select('id', { count: 'exact' })
        .eq('status', 'open'),
      // Today's revenue
      supabase
        .from('payments')
        .select('amount')
        .eq('status', 'completed')
        .gte('paid_at', `${today}T00:00:00`)
        .neq('type', 'refund'),
      // New leads today
      supabase
        .from('deals')
        .select('id', { count: 'exact' })
        .eq('funnel', 'leads')
        .gte('created_at', `${today}T00:00:00`),
      // Upcoming appointments today (next 5 after current time)
      supabase
        .from('appointments')
        .select('id, start_time, status, patient:patients(full_name), doctor:doctors(first_name, last_name)')
        .eq('date', today)
        .gte('start_time', nowTime)
        .in('status', ['scheduled', 'confirmed', 'arrived'])
        .order('start_time', { ascending: true })
        .limit(5),
      // Overdue tasks
      supabase
        .from('tasks')
        .select('id, title, due_at, priority, patient:patients(full_name)')
        .in('status', ['new', 'in_progress', 'overdue'])
        .not('due_at', 'is', null)
        .lt('due_at', nowISO)
        .order('due_at', { ascending: true })
        .limit(8),
      // Critical lab results not yet acknowledged
      supabase
        .from('lab_results')
        .select('id, completed_at, critical_notified_at, order:lab_orders(order_number, patient:patients(full_name))')
        .eq('has_critical', true)
        .is('critical_notified_at', null)
        .order('completed_at', { ascending: false })
        .limit(5),
      // Stale leads (>7 days)
      supabase
        .from('deals')
        .select('id, stage, created_at, patient:patients(full_name)')
        .eq('status', 'open')
        .lt('created_at', sevenDaysAgo)
        .order('created_at', { ascending: true })
        .limit(5),
      // Open cash session
      supabase
        .from('cash_sessions')
        .select('id, opened_at, cashier:user_profiles!cash_sessions_opened_by_fkey(first_name, last_name)')
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([appts, visits, payments, leads, upcomingRes, overdueRes, critRes, staleRes, sessRes]) => {
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

      // Map upcoming
      type UpcomingRow = {
        id: string
        start_time: string
        status: string
        patient: { full_name: string } | null
        doctor: { first_name: string; last_name: string } | null
      }
      setUpcoming(((upcomingRes.data ?? []) as unknown as UpcomingRow[]).map(a => ({
        id: a.id,
        start_time: a.start_time,
        patient_name: a.patient?.full_name ?? '—',
        doctor_name: a.doctor ? `${a.doctor.last_name} ${a.doctor.first_name[0] ?? ''}` : '—',
        status: a.status,
      })))

      // Map overdue tasks
      type OverdueRow = {
        id: string
        title: string
        due_at: string | null
        priority: string
        patient: { full_name: string } | null
      }
      setOverdueTasks(((overdueRes.data ?? []) as unknown as OverdueRow[]).map(t => ({
        id: t.id,
        title: t.title,
        due_at: t.due_at,
        priority: t.priority,
        patient_name: t.patient?.full_name ?? null,
      })))

      // Map critical labs
      type CritRow = {
        id: string
        completed_at: string
        order: { order_number: string | null; patient: { full_name: string } | null } | null
      }
      setCriticalLabs(((critRes.data ?? []) as unknown as CritRow[]).map(r => ({
        id: r.id,
        patient_name: r.order?.patient?.full_name ?? '—',
        order_number: r.order?.order_number ?? null,
        completed_at: r.completed_at,
      })))

      // Map stale leads
      type StaleRow = {
        id: string
        stage: string
        created_at: string
        patient: { full_name: string } | null
      }
      setStaleLeads(((staleRes.data ?? []) as unknown as StaleRow[]).map(d => ({
        id: d.id,
        patient_name: d.patient?.full_name ?? '—',
        stage: d.stage,
        days: Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000),
      })))

      // Map session
      if (sessRes.data) {
        const data = sessRes.data as unknown as { id: string; opened_at: string; cashier: { first_name: string; last_name: string } | null }
        setSession({
          id: data.id,
          opened_at: data.opened_at,
          cashier_name: data.cashier ? `${data.cashier.last_name} ${data.cashier.first_name}` : undefined,
        })
      } else {
        setSession(null)
      }

      setLoading(false)
    })
  }, [today, userId])

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Сегодня</h2>
        <p className="text-sm text-gray-400">
          {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Alerts row */}
      {!loading && (criticalLabs.length > 0 || overdueTasks.length > 0 || !session) && (
        <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-3">
          {criticalLabs.length > 0 && (
            <Link href="/lab" className="flex items-center gap-3 bg-red-50 border border-red-200 hover:border-red-300 rounded-xl px-4 py-3 transition-colors">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-red-700">{criticalLabs.length} критич. результат(ов)</p>
                <p className="text-xs text-red-600">Требуется уведомление врача</p>
              </div>
            </Link>
          )}
          {overdueTasks.length > 0 && (
            <Link href="/tasks" className="flex items-center gap-3 bg-orange-50 border border-orange-200 hover:border-orange-300 rounded-xl px-4 py-3 transition-colors">
              <span className="text-2xl">⏰</span>
              <div>
                <p className="text-sm font-semibold text-orange-700">{overdueTasks.length} просроч. задач</p>
                <p className="text-xs text-orange-600">Требуют внимания</p>
              </div>
            </Link>
          )}
          {!session && (
            <Link href="/finance/sessions" className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 hover:border-yellow-300 rounded-xl px-4 py-3 transition-colors">
              <span className="text-2xl">💰</span>
              <div>
                <p className="text-sm font-semibold text-yellow-700">Касса закрыта</p>
                <p className="text-xs text-yellow-600">Откройте смену для приёма платежей</p>
              </div>
            </Link>
          )}
          {session && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <span className="text-2xl">🟢</span>
              <div>
                <p className="text-sm font-semibold text-green-700">Касса открыта</p>
                <p className="text-xs text-green-600">
                  С {new Date(session.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  {session.cashier_name && ` · ${session.cashier_name}`}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Two-column widgets */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          {/* Upcoming appointments */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Ближайшие записи
              </p>
              <Link href="/schedule" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                Все →
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-3">На сегодня больше нет записей</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {upcoming.map(a => (
                  <Link
                    key={a.id}
                    href="/schedule"
                    className="flex items-center gap-3 py-2.5 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <span className="text-sm font-mono font-medium text-gray-700 min-w-[44px]">
                      {a.start_time.slice(0, 5)}
                    </span>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[a.status] ?? 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{a.patient_name}</p>
                      <p className="text-xs text-gray-400 truncate">{a.doctor_name} · {STATUS_RU[a.status] ?? a.status}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Overdue tasks */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Просроченные задачи
                {overdueTasks.length > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center bg-red-100 text-red-600 rounded-full text-[10px] font-bold w-5 h-5">
                    {overdueTasks.length}
                  </span>
                )}
              </p>
              <Link href="/tasks" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                Все →
              </Link>
            </div>
            {overdueTasks.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-3">Нет просроченных задач 🎉</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {overdueTasks.slice(0, 5).map(t => {
                  const days = t.due_at ? Math.floor((Date.now() - new Date(t.due_at).getTime()) / 86400000) : 0
                  return (
                    <Link
                      key={t.id}
                      href="/tasks"
                      className="flex items-start gap-3 py-2.5 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
                    >
                      <span className={[
                        'w-2 h-2 rounded-full flex-shrink-0 mt-1.5',
                        t.priority === 'urgent' ? 'bg-red-500' :
                        t.priority === 'high'   ? 'bg-orange-400' : 'bg-blue-400',
                      ].join(' ')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">{t.title}</p>
                        <p className="text-xs text-gray-400">
                          {t.patient_name && <span>{t.patient_name} · </span>}
                          <span className="text-red-500 font-medium">{days > 0 ? `${days} дн. назад` : 'сегодня'}</span>
                        </p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Critical labs */}
          {criticalLabs.length > 0 && (
            <div className="bg-white rounded-xl border border-red-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">
                  ⚠ Критические результаты
                </p>
                <Link href="/lab" className="text-xs text-red-600 hover:text-red-700 font-medium">
                  Все →
                </Link>
              </div>
              <div className="divide-y divide-gray-50">
                {criticalLabs.map(r => (
                  <Link
                    key={r.id}
                    href="/lab"
                    className="flex items-center gap-3 py-2.5 hover:bg-red-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <span className="text-red-500">⚠</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{r.patient_name}</p>
                      <p className="text-xs text-gray-400">
                        {r.order_number ?? '—'} · {new Date(r.completed_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Stale leads */}
          {staleLeads.length > 0 && (
            <div className="bg-white rounded-xl border border-orange-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
                  Зависшие сделки
                </p>
                <Link href="/crm" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                  Все →
                </Link>
              </div>
              <div className="divide-y divide-gray-50">
                {staleLeads.map(d => (
                  <Link
                    key={d.id}
                    href="/crm"
                    className="flex items-center gap-3 py-2.5 hover:bg-orange-50 rounded-lg px-2 -mx-2 transition-colors"
                  >
                    <span className="text-orange-500">🕐</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{d.patient_name}</p>
                      <p className="text-xs text-gray-400">
                        Этап: {d.stage} · <span className="text-orange-600 font-medium">{d.days} дн.</span>
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
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
