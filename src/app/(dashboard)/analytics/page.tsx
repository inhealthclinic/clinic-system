'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface RevenueByDay  { day: string; total: number }
interface TopService    { name: string; count: number; total: number }
interface ApptByStatus  { status: string; count: number }
interface PatientsByWeek { week: string; count: number }

type Period = '7' | '30' | '90'

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

function startOf(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function monthStart(): string {
  const d = new Date()
  d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/* ─── Skeleton ───────────────────────────────────────────────────────────── */
function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded-lg ${className ?? ''}`} />
}

/* ─── CSS Bar Chart ──────────────────────────────────────────────────────── */
function BarChart({
  data,
  labelKey,
  valueKey,
  barColor = 'bg-blue-500',
}: {
  data: Record<string, unknown>[]
  labelKey: string
  valueKey: string
  barColor?: string
}) {
  const values = data.map(d => Number(d[valueKey]))
  const maxVal = Math.max(...values, 1)

  return (
    <div className="flex items-end gap-1 h-32 overflow-x-auto pb-1">
      {data.map((d, i) => {
        const val = Number(d[valueKey])
        const barH = Math.max(4, Math.round((val / maxVal) * 120))
        return (
          <div key={i} className="flex flex-col items-center flex-1 min-w-[24px] group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-10 bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
              {typeof d[valueKey] === 'number' && val > 999
                ? fmt(val)
                : val.toLocaleString('ru-RU')}
            </div>
            <div
              className={`w-full rounded-t ${barColor} transition-all`}
              style={{ height: `${barH}px` }}
            />
            <span className="text-[10px] text-gray-400 mt-1 truncate w-full text-center leading-tight">
              {String(d[labelKey]).slice(5)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Stacked Status Bar ─────────────────────────────────────────────────── */
const STATUS_CFG: Record<string, { label: string; color: string }> = {
  completed:  { label: 'Завершён',  color: 'bg-green-500'  },
  confirmed:  { label: 'Подтверждён', color: 'bg-blue-400' },
  pending:    { label: 'Ожидает',   color: 'bg-yellow-400' },
  arrived:    { label: 'Прибыл',    color: 'bg-purple-400' },
  cancelled:  { label: 'Отменён',   color: 'bg-red-400'    },
  no_show:    { label: 'Не пришёл', color: 'bg-gray-400'   },
  rescheduled:{ label: 'Перенесён', color: 'bg-orange-400' },
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function AnalyticsPage() {
  const supabase = createClient()

  const [period, setPeriod]           = useState<Period>('30')
  const [loading, setLoading]         = useState(true)
  const [revenueByDay, setRevenueByDay]   = useState<RevenueByDay[]>([])
  const [topServices, setTopServices]     = useState<TopService[]>([])
  const [apptByStatus, setApptByStatus]   = useState<ApptByStatus[]>([])
  const [patientsByWeek, setPatientsByWeek] = useState<PatientsByWeek[]>([])
  const [completionRate, setCompletionRate] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const since = startOf(Number(period))
    const mStart = monthStart()

    // 1. Revenue by day
    const { data: revRaw } = await supabase
      .from('payments')
      .select('paid_at, amount')
      .neq('type', 'refund')
      .eq('status', 'completed')
      .gte('paid_at', since)
      .order('paid_at', { ascending: true })

    const revMap: Record<string, number> = {}
    ;(revRaw ?? []).forEach(r => {
      const day = r.paid_at?.slice(0, 10) ?? ''
      if (day) revMap[day] = (revMap[day] ?? 0) + (r.amount ?? 0)
    })
    const revByDay: RevenueByDay[] = Object.entries(revMap)
      .map(([day, total]) => ({ day, total }))
      .sort((a, b) => a.day.localeCompare(b.day))
    setRevenueByDay(revByDay)

    // 2. Top services by revenue
    const { data: chargesRaw } = await supabase
      .from('charges')
      .select('name, total')
      .gte('created_at', since)

    const svcMap: Record<string, { count: number; total: number }> = {}
    ;(chargesRaw ?? []).forEach(c => {
      const n = c.name ?? 'Без названия'
      if (!svcMap[n]) svcMap[n] = { count: 0, total: 0 }
      svcMap[n].count += 1
      svcMap[n].total += c.total ?? 0
    })
    const top5: TopService[] = Object.entries(svcMap)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
    setTopServices(top5)

    // 3. Appointments by status (current month)
    const { data: apptRaw } = await supabase
      .from('appointments')
      .select('status')
      .gte('date', mStart.slice(0, 10))

    const apptMap: Record<string, number> = {}
    ;(apptRaw ?? []).forEach(a => {
      apptMap[a.status] = (apptMap[a.status] ?? 0) + 1
    })
    setApptByStatus(
      Object.entries(apptMap).map(([status, count]) => ({ status, count }))
    )

    // 4. New patients per week (last 8 weeks)
    const weeksAgo8 = startOf(56)
    const { data: patientsRaw } = await supabase
      .from('patients')
      .select('created_at')
      .gte('created_at', weeksAgo8)

    const weekMap: Record<string, number> = {}
    ;(patientsRaw ?? []).forEach(p => {
      const d = new Date(p.created_at)
      // ISO week start (Monday)
      const day = d.getDay() || 7
      const monday = new Date(d)
      monday.setDate(d.getDate() - day + 1)
      const key = monday.toISOString().slice(0, 10)
      weekMap[key] = (weekMap[key] ?? 0) + 1
    })
    const pw: PatientsByWeek[] = Object.entries(weekMap)
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-8)
    setPatientsByWeek(pw)

    // 5. Completion rate (current month)
    const completed = apptMap['completed'] ?? 0
    const cancelled = apptMap['cancelled'] ?? 0
    const denom = completed + cancelled
    setCompletionRate(denom > 0 ? Math.round((completed / denom) * 100) : null)

    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  /* Derived KPIs */
  const totalRevenue  = revenueByDay.reduce((s, r) => s + r.total, 0)
  const totalAppts    = apptByStatus.reduce((s, a) => s + a.count, 0)
  const totalNewPts   = patientsByWeek.reduce((s, p) => s + p.count, 0)
  const avgCheck      = totalAppts > 0 ? Math.round(totalRevenue / totalAppts) : 0
  const svcGrandTotal = topServices.reduce((s, t) => s + t.total, 0)

  const periodLabel: Record<Period, string> = { '7': '7 дней', '30': '30 дней', '90': '90 дней' }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        {(['7', '30', '90'] as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              period === p
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {periodLabel[p]}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">Выручка</p>
              <p className="text-2xl font-bold text-green-600">{fmt(totalRevenue)}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">Записей (мес.)</p>
              <p className="text-2xl font-bold text-gray-900">{totalAppts}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">Новых пациентов</p>
              <p className="text-2xl font-bold text-blue-600">{totalNewPts}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <p className="text-xs text-gray-400 mb-1">Средний чек</p>
              <p className="text-2xl font-bold text-gray-900">{fmt(avgCheck)}</p>
            </div>
          </>
        )}
      </div>

      {/* Revenue chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Выручка по дням</h3>
        {loading ? (
          <Skeleton className="h-36" />
        ) : revenueByDay.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Нет данных</p>
        ) : (
          <BarChart data={revenueByDay as unknown as Record<string, unknown>[]} labelKey="day" valueKey="total" barColor="bg-blue-500" />
        )}
      </div>

      {/* Bottom row: services table + appointment status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top services */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Топ-5 услуг</h3>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : topServices.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Нет данных</p>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_48px_80px_40px] gap-2 text-xs font-medium text-gray-400 pb-2 border-b border-gray-50">
                <span>Услуга</span>
                <span className="text-right">Кол-во</span>
                <span className="text-right">Сумма</span>
                <span className="text-right">%</span>
              </div>
              {topServices.map((svc, i) => (
                <div key={i} className="grid grid-cols-[1fr_48px_80px_40px] gap-2 py-1.5 text-sm items-center">
                  <span className="truncate text-gray-800">{svc.name}</span>
                  <span className="text-right text-gray-500">{svc.count}</span>
                  <span className="text-right font-medium text-gray-900">
                    {(svc.total / 1000).toFixed(0)}к₸
                  </span>
                  <span className="text-right text-xs text-gray-400">
                    {svcGrandTotal > 0 ? Math.round((svc.total / svcGrandTotal) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Appointments by status */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">Записи по статусу</h3>
            {completionRate !== null && (
              <span className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full font-medium">
                Завершаемость {completionRate}%
              </span>
            )}
          </div>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
            </div>
          ) : apptByStatus.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Нет данных</p>
          ) : (
            <>
              {/* Stacked bar */}
              <div className="flex rounded-lg overflow-hidden h-5 mb-4">
                {apptByStatus
                  .sort((a, b) => b.count - a.count)
                  .map((a, i) => {
                    const pct = totalAppts > 0 ? (a.count / totalAppts) * 100 : 0
                    const cfg = STATUS_CFG[a.status] ?? { label: a.status, color: 'bg-gray-300' }
                    return (
                      <div
                        key={i}
                        title={`${cfg.label}: ${a.count}`}
                        className={`${cfg.color} transition-all`}
                        style={{ width: `${pct}%` }}
                      />
                    )
                  })}
              </div>
              {/* Legend */}
              <div className="space-y-1.5">
                {apptByStatus
                  .sort((a, b) => b.count - a.count)
                  .map((a, i) => {
                    const cfg = STATUS_CFG[a.status] ?? { label: a.status, color: 'bg-gray-300' }
                    const pct = totalAppts > 0 ? Math.round((a.count / totalAppts) * 100) : 0
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className={`w-3 h-3 rounded-sm flex-shrink-0 ${cfg.color}`} />
                        <span className="flex-1 text-gray-700">{cfg.label}</span>
                        <span className="font-semibold text-gray-900">{a.count}</span>
                        <span className="text-xs text-gray-400 w-10 text-right">{pct}%</span>
                      </div>
                    )
                  })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* New patients bar chart */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Новые пациенты по неделям</h3>
        {loading ? (
          <Skeleton className="h-36" />
        ) : patientsByWeek.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">Нет данных</p>
        ) : (
          <BarChart
            data={patientsByWeek as unknown as Record<string, unknown>[]}
            labelKey="week"
            valueKey="count"
            barColor="bg-emerald-500"
          />
        )}
      </div>
    </div>
  )
}
