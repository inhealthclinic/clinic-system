'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { prefetchCrm } from '@/lib/crmPrefetch'

/* ─── Types ───────────────────────────────────────────────── */
interface DashStats {
  appointments_total: number
  appointments_confirmed: number
  appointments_arrived: number
  appointments_completed: number
  visits_open: number
  revenue_today: number
  new_leads: number
  overdue_tasks: number
  unpaid_charges: number
  // LIS widgets
  lab_in_progress: number
  lab_awaiting_sample: number
  lab_critical_today: number
}

interface CriticalResult {
  id: string
  service_name_snapshot: string
  result_value: number | null
  unit_snapshot: string | null
  flag: string | null
  result_date: string
  patient_id: string
  patient_name: string
}

interface TodayAppt {
  id: string
  time_start: string
  time_end: string
  status: string
  patient: { full_name: string } | null
  doctor: { first_name: string; last_name: string; color: string | null } | null
}

interface OverdueTask {
  id: string
  title: string
  priority: string
  due_at: string
  patient: { full_name: string } | null
}

interface OpenVisit {
  id: string
  patient: { full_name: string } | null
  doctor: { first_name: string; last_name: string } | null
  started_at: string | null
  created_at: string
}

/* ─── Constants ───────────────────────────────────────────── */
const APPT_STATUS: Record<string, { cls: string; label: string }> = {
  pending:    { cls: 'bg-gray-100 text-gray-500',     label: 'Ожидает' },
  confirmed:  { cls: 'bg-green-100 text-green-700',   label: 'Подтверждено' },
  arrived:    { cls: 'bg-yellow-100 text-yellow-800', label: 'Пришёл' },
  completed:  { cls: 'bg-blue-100 text-blue-700',     label: 'Принято' },
  no_show:    { cls: 'bg-red-100 text-red-600',       label: 'Не явился' },
  cancelled:  { cls: 'bg-gray-50 text-gray-400',      label: 'Отменено' },
}

const PRIORITY_CLR: Record<string, string> = {
  urgent: 'bg-red-100 text-red-600',
  high:   'bg-orange-100 text-orange-600',
  normal: 'bg-blue-100 text-blue-600',
  low:    'bg-gray-100 text-gray-500',
}

const INITIAL: DashStats = {
  appointments_total: 0, appointments_confirmed: 0, appointments_arrived: 0,
  appointments_completed: 0, visits_open: 0, revenue_today: 0,
  new_leads: 0, overdue_tasks: 0, unpaid_charges: 0,
  lab_in_progress: 0, lab_awaiting_sample: 0, lab_critical_today: 0,
}

/* ─── Skeleton ────────────────────────────────────────────── */
function Sk({ cls = '' }: { cls?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${cls}`} />
}

/* ─── StatCard ────────────────────────────────────────────── */
function StatCard({ label, value, sub, color = 'blue', href }: {
  label: string; value: string | number; sub?: string
  color?: string; href?: string
}) {
  const colors: Record<string, string> = {
    blue:   'text-blue-700',   green:  'text-green-700',
    orange: 'text-orange-600', purple: 'text-purple-700',
    red:    'text-red-600',    gray:   'text-gray-600',
  }
  const inner = (
    <div className="bg-white rounded-xl border border-gray-100 p-5 h-full">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-bold ${colors[color] ?? colors.blue}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
  if (href) return <Link href={href} className="hover:scale-[1.01] transition-transform block">{inner}</Link>
  return inner
}

/* ─── Page ────────────────────────────────────────────────── */
export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const [stats, setStats]             = useState<DashStats>(INITIAL)
  const [loading, setLoading]         = useState(true)
  const [appts, setAppts]             = useState<TodayAppt[]>([])
  const [overdueT, setOverdueT]       = useState<OverdueTask[]>([])
  const [openVisits, setOpenVisits]   = useState<OpenVisit[]>([])
  const [criticalRes, setCriticalRes] = useState<CriticalResult[]>([])
  const [today]                       = useState(() => new Date().toISOString().slice(0, 10))
  const now                           = new Date()

  const greet = () => {
    const h = now.getHours()
    if (h < 12) return 'Доброе утро'
    if (h < 17) return 'Добрый день'
    return 'Добрый вечер'
  }

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

  const load = useCallback(async () => {
    setLoading(true)

    const [
      apptRes, visitsRes, paymentsRes, leadsRes,
      tasksRes, chargesRes, apptFullRes, overdueRes, openVisitsRes,
      labInProgRes, labNoSampleRes, labCritCountRes, labCritListRes,
    ] = await Promise.all([
      // Stats
      supabase.from('appointments').select('status', { count: 'exact' }).eq('date', today),
      supabase.from('visits').select('id', { count: 'exact' }).eq('status', 'open'),
      supabase.from('payments').select('amount').eq('status', 'completed')
        .gte('paid_at', `${today}T00:00:00`).neq('type', 'refund'),
      supabase.from('deals').select('id', { count: 'exact' })
        .eq('funnel', 'leads').gte('created_at', `${today}T00:00:00`),
      // Overdue task count
      supabase.from('tasks').select('id', { count: 'exact' })
        .in('status', ['new', 'in_progress']).lt('due_at', new Date().toISOString()),
      // Unpaid charges count
      supabase.from('charges').select('id', { count: 'exact' })
        .in('status', ['pending', 'pending_approval']),
      // Today's appointments detail
      supabase.from('appointments')
        .select('id,time_start,time_end,status,patient:patients(full_name),doctor:doctors(first_name,last_name,color)')
        .eq('date', today).neq('status', 'cancelled').order('time_start').limit(8),
      // Overdue tasks detail
      supabase.from('tasks')
        .select('id,title,priority,due_at,patient:patients(full_name)')
        .in('status', ['new', 'in_progress']).lt('due_at', new Date().toISOString())
        .order('due_at', { ascending: true }).limit(5),
      // Open visits
      supabase.from('visits')
        .select('id,started_at,created_at,patient:patients(full_name),doctor:doctors(first_name,last_name)')
        .eq('status', 'open').order('created_at', { ascending: false }).limit(5),
      // LIS: orders in progress
      supabase.from('lab_orders').select('id', { count: 'exact', head: true })
        .in('status', ['in_progress', 'sample_taken', 'agreed', 'paid']),
      // LIS: orders awaiting sample
      supabase.from('lab_orders').select('id', { count: 'exact', head: true })
        .in('status', ['ordered', 'agreed', 'paid']),
      // LIS: critical results count today
      supabase.from('patient_lab_results').select('id', { count: 'exact', head: true })
        .in('flag', ['high', 'low', 'critical'])
        .gte('result_date', `${today}T00:00:00`),
      // LIS: critical results list (last 5 of any date)
      supabase.from('patient_lab_results')
        .select('id,service_name_snapshot,result_value,unit_snapshot,flag,result_date,patient_id,patient:patients(full_name)')
        .in('flag', ['high', 'low', 'critical'])
        .order('result_date', { ascending: false }).limit(5),
    ])

    const rows = apptRes.data ?? []
    setStats({
      appointments_total:     rows.length,
      appointments_confirmed: rows.filter(r => r.status === 'confirmed').length,
      appointments_arrived:   rows.filter(r => r.status === 'arrived').length,
      appointments_completed: rows.filter(r => r.status === 'completed').length,
      visits_open:            visitsRes.count ?? 0,
      revenue_today:          (paymentsRes.data ?? []).reduce((s, r) => s + (r.amount ?? 0), 0),
      new_leads:              leadsRes.count ?? 0,
      overdue_tasks:          tasksRes.count ?? 0,
      unpaid_charges:         chargesRes.count ?? 0,
      lab_in_progress:        labInProgRes.count ?? 0,
      lab_awaiting_sample:    labNoSampleRes.count ?? 0,
      lab_critical_today:     labCritCountRes.count ?? 0,
    })
    setAppts((apptFullRes.data ?? []) as unknown as TodayAppt[])
    setOverdueT((overdueRes.data ?? []) as unknown as OverdueTask[])
    setOpenVisits((openVisitsRes.data ?? []) as unknown as OpenVisit[])
    // flatten critical results (patient is a joined row)
    setCriticalRes(((labCritListRes.data ?? []) as unknown as Array<CriticalResult & { patient: { full_name: string } | null }>)
      .map(r => ({ ...r, patient_name: r.patient?.full_name ?? '—' })))
    setLoading(false)
  }, [today])

  useEffect(() => { load() }, [load])

  // Предзагружаем CRM-данные пока пользователь на дашборде
  useEffect(() => {
    if (!profile?.clinic_id) return
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) {
        prefetchCrm(profile.clinic_id, session.access_token, supabase)
      }
    })
  }, [profile?.clinic_id, supabase])

  const dateLabel = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          {greet()}{profile?.first_name ? `, ${profile.first_name}` : ''} 👋
        </h2>
        <p className="text-sm text-gray-400 capitalize">{dateLabel}</p>
      </div>

      {/* Alert banners */}
      {!loading && (stats.overdue_tasks > 0 || stats.unpaid_charges > 0 || stats.visits_open > 0) && (
        <div className="flex flex-col gap-2">
          {stats.overdue_tasks > 0 && (
            <Link href="/tasks" className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 hover:bg-red-100 transition-colors">
              <span className="text-red-500 text-xl">🔴</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-800">
                  {stats.overdue_tasks} просроченных задач
                </p>
                <p className="text-xs text-red-600">Требуют немедленного внимания</p>
              </div>
              <span className="text-red-400 text-sm">→</span>
            </Link>
          )}
          {stats.visits_open > 0 && (
            <Link href="/visits" className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 hover:bg-orange-100 transition-colors">
              <span className="text-orange-500 text-xl">⏳</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-800">
                  {stats.visits_open} открытых визитов
                </p>
                <p className="text-xs text-orange-600">Визиты ожидают завершения</p>
              </div>
              <span className="text-orange-400 text-sm">→</span>
            </Link>
          )}
          {stats.unpaid_charges > 0 && (
            <Link href="/finance" className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 hover:bg-yellow-100 transition-colors">
              <span className="text-yellow-500 text-xl">💳</span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-yellow-800">
                  {stats.unpaid_charges} неоплаченных начислений
                </p>
                <p className="text-xs text-yellow-700">Нужно принять оплату</p>
              </div>
              <span className="text-yellow-400 text-sm">→</span>
            </Link>
          )}
        </div>
      )}

      {/* KPI stats */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => <Sk key={i} cls="h-24" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Записей сегодня" value={stats.appointments_total} color="blue" href="/schedule" />
            <StatCard label="Подтверждено"    value={stats.appointments_confirmed} color="green" />
            <StatCard label="Пришли"          value={stats.appointments_arrived}  color="orange" />
            <StatCard label="Принято"         value={stats.appointments_completed} color="purple" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Открытых визитов" value={stats.visits_open}
              color={stats.visits_open > 0 ? 'orange' : 'gray'} href="/visits" />
            <StatCard label="Выручка за день"  value={fmt(stats.revenue_today)} color="green" href="/finance" />
            <StatCard label="Новых лидов"      value={stats.new_leads} color="blue" href="/crm" />
          </div>

          {/* ── LIS KPI row ───────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="🧪 Лаба: материал не взят" value={stats.lab_awaiting_sample}
              color={stats.lab_awaiting_sample > 0 ? 'orange' : 'gray'} href="/lab" />
            <StatCard label="🧪 Лаба: в работе" value={stats.lab_in_progress}
              color={stats.lab_in_progress > 0 ? 'blue' : 'gray'} href="/lab" />
            <StatCard label="⚠ Отклонений сегодня" value={stats.lab_critical_today}
              color={stats.lab_critical_today > 0 ? 'red' : 'gray'} />
          </div>
        </>
      )}

      {/* ── Critical lab results (recent) ───────────────── */}
      {!loading && criticalRes.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">⚠ Отклонения в анализах</h3>
              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                {criticalRes.length}
              </span>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {criticalRes.map(r => {
              const flagClr =
                r.flag === 'critical' ? 'text-red-700 bg-red-50' :
                r.flag === 'high'     ? 'text-orange-700 bg-orange-50' :
                'text-blue-700 bg-blue-50'
              const flagLbl =
                r.flag === 'critical' ? '⚠ критично' :
                r.flag === 'high'     ? '↑ высоко' :
                '↓ низко'
              return (
                <Link
                  key={r.id}
                  href={`/patients/${r.patient_id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {r.patient_name}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${flagClr}`}>
                        {flagLbl}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {r.service_name_snapshot}: <b>{r.result_value}{r.unit_snapshot ? ' ' + r.unit_snapshot : ''}</b>
                      <span className="text-gray-400 ml-2">
                        {new Date(r.result_date).toLocaleDateString('ru-RU')}
                      </span>
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Today's schedule */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">📅 Расписание сегодня</h3>
            <Link href="/schedule" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Все →
            </Link>
          </div>
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Sk key={i} cls="h-12" />)}
            </div>
          ) : appts.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-400">Записей на сегодня нет</p>
              <Link href="/schedule" className="text-xs text-blue-600 hover:text-blue-700 mt-2 inline-block font-medium">
                + Записать пациента
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {appts.map(a => {
                const st = APPT_STATUS[a.status] ?? APPT_STATUS.pending
                const doc = a.doctor as { first_name: string; last_name: string; color: string | null } | null
                const isPast = a.time_start < now.toTimeString().slice(0, 5)
                return (
                  <Link
                    key={a.id}
                    href="/schedule"
                    className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-14">
                      <p className={`text-xs font-mono font-semibold ${isPast && a.status !== 'completed' ? 'text-red-500' : 'text-gray-700'}`}>
                        {a.time_start.slice(0, 5)}
                      </p>
                      <p className="text-xs text-gray-300">{a.time_end.slice(0, 5)}</p>
                    </div>
                    {doc?.color && (
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: doc.color }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {a.patient?.full_name ?? 'Walk-in'}
                      </p>
                      {doc && (
                        <p className="text-xs text-gray-400 truncate">{doc.last_name} {doc.first_name[0]}.</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${st.cls}`}>
                      {st.label}
                    </span>
                  </Link>
                )
              })}
              {stats.appointments_total > 8 && (
                <div className="px-5 py-3 text-xs text-gray-400 text-center">
                  +{stats.appointments_total - 8} ещё
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: overdue tasks + open visits */}
        <div className="space-y-4">

          {/* Overdue tasks */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">⚡ Срочные задачи</h3>
                {stats.overdue_tasks > 0 && (
                  <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
                    {stats.overdue_tasks}
                  </span>
                )}
              </div>
              <Link href="/tasks" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                Все →
              </Link>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Sk key={i} cls="h-10" />)}
              </div>
            ) : overdueT.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">Просроченных задач нет 🎉</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {overdueT.map(t => {
                  const hoursAgo = Math.round((Date.now() - new Date(t.due_at).getTime()) / 3_600_000)
                  return (
                    <Link
                      key={t.id}
                      href="/tasks"
                      className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${PRIORITY_CLR[t.priority] ?? PRIORITY_CLR.normal}`}>
                        {t.priority === 'urgent' ? '🔴' : t.priority === 'high' ? '🟠' : '🔵'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                        <p className="text-xs text-red-500">
                          просрочена {hoursAgo < 24 ? `${hoursAgo} ч назад` : `${Math.floor(hoursAgo / 24)} д назад`}
                          {t.patient && ` · ${t.patient.full_name}`}
                        </p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* Open visits */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">🩺 Открытые визиты</h3>
                {stats.visits_open > 0 && (
                  <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
                    {stats.visits_open}
                  </span>
                )}
              </div>
              <Link href="/visits" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                Все →
              </Link>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Sk key={i} cls="h-10" />)}
              </div>
            ) : openVisits.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">Открытых визитов нет</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {openVisits.map(v => {
                  const startedAt = v.started_at ?? v.created_at
                  const minsOpen = Math.round((Date.now() - new Date(startedAt).getTime()) / 60_000)
                  const timeStr = minsOpen < 60
                    ? `${minsOpen} мин`
                    : `${Math.floor(minsOpen / 60)} ч ${minsOpen % 60} мин`
                  const doc = v.doctor as { first_name: string; last_name: string } | null
                  return (
                    <Link
                      key={v.id}
                      href={`/visits/${v.id}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {v.patient?.full_name ?? '—'}
                        </p>
                        {doc && (
                          <p className="text-xs text-gray-400">{doc.last_name} {doc.first_name[0]}.</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${minsOpen > 90 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                        {timeStr}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">Быстрые действия</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Записать пациента', href: '/schedule',
              iconColor: 'text-blue-600 bg-blue-50',
              icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 2v4M8 2v4M3 9h18M12 13v4M10 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
            {
              label: 'Новый пациент', href: '/patients/new',
              iconColor: 'text-green-600 bg-green-50',
              icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><circle cx="10" cy="8" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M2 20c0-3.314 3.134-6 7-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M18 14v6M15 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
            {
              label: 'Принять оплату', href: '/finance',
              iconColor: 'text-orange-600 bg-orange-50',
              icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M2 10h20M6 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
            {
              label: 'Новая задача', href: '/tasks',
              iconColor: 'text-purple-600 bg-purple-50',
              icon: <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>,
            },
          ].map(ql => (
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
