'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface Payment {
  amount: number
  method: string
  type: string
  status: string
  paid_at: string
}

interface Patient {
  id: string
  full_name: string
  debt_amount: number
}

interface Charge {
  name: string
  total: number
}

interface LabOrderRow {
  id: string
  status: string
  created_at: string
}

interface LabResultRow {
  service_name: string | null
  flag: string | null
  collected_at: string | null
  created_at: string
}

type Period = 'today' | 'week' | 'month' | 'quarter' | 'custom'

/* ─── Constants ──────────────────────────────────────────────────────────── */
const METHOD_RU: Record<string, string> = {
  cash:    'Наличные',
  kaspi:   'Kaspi',
  halyk:   'Halyk',
  credit:  'Кредит',
  balance: 'Депозит',
}

const METHOD_COLOR: Record<string, string> = {
  cash:    'bg-green-500',
  kaspi:   'bg-orange-500',
  halyk:   'bg-yellow-500',
  credit:  'bg-purple-500',
  balance: 'bg-blue-500',
}

const METHODS = ['cash', 'kaspi', 'halyk', 'credit', 'balance'] as const

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

function getRange(period: Period, customStart: string, customEnd: string): { start: string; end: string } {
  const now = new Date()
  if (period === 'custom') {
    const s = customStart ? new Date(customStart) : new Date(now)
    s.setHours(0, 0, 0, 0)
    const e = customEnd ? new Date(customEnd) : new Date(now)
    e.setHours(23, 59, 59, 999)
    return { start: s.toISOString(), end: e.toISOString() }
  }
  if (period === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0)
    const e = new Date(now); e.setHours(23, 59, 59, 999)
    return { start: s.toISOString(), end: e.toISOString() }
  }
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 90
  const s = new Date(now); s.setDate(now.getDate() - days); s.setHours(0, 0, 0, 0)
  return { start: s.toISOString(), end: now.toISOString() }
}

/* ─── KPI Card ───────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, accent }: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold truncate ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

/* ─── CSS Bar Chart (by day) ─────────────────────────────────────────────── */
function DayChart({ byDay, startDate, endDate }: {
  byDay: Record<string, number>
  startDate: string
  endDate: string
}) {
  // Build list of days in the range (max 14 if range > 14 days)
  const days: string[] = []
  const s = new Date(startDate); s.setHours(0, 0, 0, 0)
  const e = new Date(endDate);   e.setHours(0, 0, 0, 0)
  const diffDays = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1
  const step = diffDays > 14 ? Math.ceil(diffDays / 14) : 1
  const cur = new Date(s)
  while (cur <= e) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + step)
  }
  const maxVal = Math.max(...days.map(d => byDay[d] ?? 0), 1)

  return (
    <div className="flex items-end gap-1 h-24">
      {days.map(d => {
        const val = byDay[d] ?? 0
        const pct = Math.round((val / maxVal) * 100)
        const label = new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
        return (
          <div key={d} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="relative w-full flex flex-col justify-end" style={{ height: '72px' }}>
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {fmt(val)}
              </div>
              <div
                className="w-full bg-blue-500 rounded-t transition-all"
                style={{ height: `${pct}%`, minHeight: val > 0 ? '2px' : '0' }}
              />
            </div>
            <span className="text-[9px] text-gray-400 leading-none">{label}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function FinanceReportsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [period, setPeriod]           = useState<Period>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd]     = useState('')

  const [payments, setPayments]   = useState<Payment[]>([])
  const [debtors, setDebtors]     = useState<Patient[]>([])
  const [charges, setCharges]     = useState<Charge[]>([])
  const [labOrders, setLabOrders] = useState<LabOrderRow[]>([])
  const [labResults, setLabResults] = useState<LabResultRow[]>([])
  const [loading, setLoading]     = useState(true)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)

    const { start, end } = getRange(period, customStart, customEnd)

    const [pmtRes, debtRes, chgRes, labOrdRes, labResRes] = await Promise.all([
      supabase
        .from('payments')
        .select('amount, method, type, status, paid_at')
        .eq('clinic_id', clinicId)
        .eq('status', 'completed')
        .gte('paid_at', start)
        .lte('paid_at', end),

      supabase
        .from('patients')
        .select('id, full_name, debt_amount')
        .gt('debt_amount', 0)
        .order('debt_amount', { ascending: false })
        .limit(10),

      supabase
        .from('charges')
        .select('name, total')
        .eq('clinic_id', clinicId)
        .gte('created_at', start)
        .lte('created_at', end)
        .eq('status', 'paid'),

      supabase
        .from('lab_orders')
        .select('id, status, created_at')
        .eq('clinic_id', clinicId)
        .gte('created_at', start)
        .lte('created_at', end),

      supabase
        .from('patient_lab_results')
        .select('service_name, flag, collected_at, created_at')
        .eq('clinic_id', clinicId)
        .gte('created_at', start)
        .lte('created_at', end),
    ])

    setPayments(pmtRes.data ?? [])
    setDebtors(debtRes.data ?? [])
    setCharges(chgRes.data ?? [])
    setLabOrders(labOrdRes.data ?? [])
    setLabResults(labResRes.data ?? [])
    setLoading(false)
  }, [clinicId, period, customStart, customEnd])

  useEffect(() => { load() }, [load])

  /* ─── Derived KPIs ─── */
  const revenue    = payments.filter(p => p.type === 'payment').reduce((s, p) => s + p.amount, 0)
  const refunds    = payments.filter(p => p.type === 'refund').reduce((s, p) => s + p.amount, 0)
  const prepays    = payments.filter(p => p.type === 'prepayment').reduce((s, p) => s + p.amount, 0)

  const cash       = payments.filter(p => p.type === 'payment' && p.method === 'cash').reduce((s, p) => s + p.amount, 0)
  const kaspi      = payments.filter(p => p.type === 'payment' && p.method === 'kaspi').reduce((s, p) => s + p.amount, 0)

  const payCount   = payments.filter(p => p.type === 'payment').length
  const avgCheck   = payCount > 0 ? Math.round(revenue / payCount) : 0

  /* ─── By method breakdown ─── */
  const byMethod: Record<string, number> = {}
  payments.filter(p => p.type === 'payment').forEach(p => {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount
  })
  const methodMax = Math.max(...Object.values(byMethod), 1)

  /* ─── By day ─── */
  const byDay: Record<string, number> = {}
  payments.filter(p => p.type === 'payment').forEach(p => {
    const day = p.paid_at.slice(0, 10)
    byDay[day] = (byDay[day] ?? 0) + p.amount
  })

  /* ─── Top services ─── */
  const serviceMap: Record<string, number> = {}
  charges.forEach(c => {
    serviceMap[c.name] = (serviceMap[c.name] ?? 0) + c.total
  })
  const topServices = Object.entries(serviceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  const serviceMax = topServices.length > 0 ? topServices[0][1] : 1

  /* ─── Lab metrics ─── */
  const labTotal      = labOrders.length
  const labVerified   = labOrders.filter(o => o.status === 'verified' || o.status === 'delivered').length
  const labInProgress = labOrders.filter(o => o.status === 'in_progress' || o.status === 'received').length
  const labCancelled  = labOrders.filter(o => o.status === 'cancelled').length
  const labAbnormal   = labResults.filter(r => r.flag === 'low' || r.flag === 'high' || r.flag === 'critical_low' || r.flag === 'critical_high').length
  const labResultsTotal = labResults.length

  const labServiceMap: Record<string, number> = {}
  labResults.forEach(r => {
    const k = r.service_name ?? '—'
    labServiceMap[k] = (labServiceMap[k] ?? 0) + 1
  })
  const topLabServices = Object.entries(labServiceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  const labServiceMax = topLabServices.length > 0 ? topLabServices[0][1] : 1

  const { start: rangeStart, end: rangeEnd } = getRange(period, customStart, customEnd)

  /* ─── Render ─── */
  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Period selector ── */}
      <div className="flex flex-wrap items-center gap-2">
        {(['today', 'week', 'month', 'quarter'] as const).map(p => (
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
            {p === 'today' ? 'Сегодня' : p === 'week' ? 'Неделя' : p === 'month' ? 'Месяц' : 'Квартал'}
          </button>
        ))}
        <button
          onClick={() => setPeriod('custom')}
          className={[
            'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            period === 'custom'
              ? 'bg-blue-600 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
          ].join(' ')}
        >
          Произвольный
        </button>

        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            />
          </div>
        )}

        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading || !clinicId}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? 'Загрузка...' : 'Обновить'}
        </button>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Выручка"
          value={fmt(revenue)}
          sub={`${payCount} оплат`}
          accent="text-green-600"
        />
        <KpiCard
          label="Возвраты"
          value={fmt(refunds)}
          accent={refunds > 0 ? 'text-red-600' : 'text-gray-900'}
        />
        <KpiCard label="Наличные" value={fmt(cash)} />
        <KpiCard label="Kaspi" value={fmt(kaspi)} />
        <KpiCard
          label="Средний чек"
          value={fmt(avgCheck)}
          sub={payCount > 0 ? `из ${payCount} оплат` : undefined}
        />
        <KpiCard
          label="Предоплаты получено"
          value={fmt(prepays)}
          accent="text-blue-600"
        />
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Revenue by method */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Выручка по методам</h3>
          {revenue === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Нет данных</p>
          ) : (
            <div className="space-y-3">
              {METHODS.map(m => {
                const val = byMethod[m] ?? 0
                if (val === 0) return null
                const pct = Math.round((val / methodMax) * 100)
                return (
                  <div key={m}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-600">{METHOD_RU[m]}</span>
                      <span className="text-sm font-medium text-gray-900">{fmt(val)}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${METHOD_COLOR[m] ?? 'bg-gray-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Revenue by day */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Выручка по дням</h3>
          {revenue === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Нет данных</p>
          ) : (
            <DayChart byDay={byDay} startDate={rangeStart} endDate={rangeEnd} />
          )}
        </div>
      </div>

      {/* ── Debtors + Top services ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Debtors */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Дебиторы</h3>
            <p className="text-xs text-gray-400 mt-0.5">Пациенты с долгом, топ 10</p>
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Загрузка...</div>
          ) : debtors.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Долгов нет</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {debtors.map((pt, i) => (
                <div key={pt.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="text-xs font-medium text-gray-400 w-5 text-right flex-shrink-0">
                    {i + 1}
                  </span>
                  <p className="flex-1 text-sm text-gray-900 truncate">{pt.full_name}</p>
                  <p className="text-sm font-semibold text-red-600 flex-shrink-0">
                    {fmt(pt.debt_amount)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top services */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Топ услуги</h3>
            <p className="text-xs text-gray-400 mt-0.5">По выручке за период, топ 10</p>
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Загрузка...</div>
          ) : topServices.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Нет данных</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topServices.map(([name, total], i) => {
                const pct = Math.round((total / serviceMax) * 100)
                return (
                  <div key={name} className="px-5 py-3">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-xs font-medium text-gray-400 w-5 text-right flex-shrink-0">
                        {i + 1}
                      </span>
                      <p className="flex-1 text-sm text-gray-900 truncate">{name}</p>
                      <p className="text-sm font-semibold text-gray-900 flex-shrink-0">{fmt(total)}</p>
                    </div>
                    <div className="ml-8 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Lab section ── */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          🧪 Лаборатория
        </h2>

        {/* Lab KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Заказов всего"
            value={String(labTotal)}
            sub={period === 'today' ? 'сегодня' : period === 'week' ? 'за неделю' : period === 'month' ? 'за месяц' : period === 'quarter' ? 'за квартал' : 'за период'}
          />
          <KpiCard
            label="Завершено"
            value={String(labVerified)}
            accent={labVerified > 0 ? 'text-green-600' : 'text-gray-900'}
          />
          <KpiCard
            label="В работе"
            value={String(labInProgress)}
            accent={labInProgress > 0 ? 'text-blue-600' : 'text-gray-900'}
          />
          <KpiCard
            label="Отменено"
            value={String(labCancelled)}
            accent={labCancelled > 0 ? 'text-gray-500' : 'text-gray-900'}
          />
          <KpiCard
            label="Результатов"
            value={String(labResultsTotal)}
          />
          <KpiCard
            label="Отклонений"
            value={String(labAbnormal)}
            accent={labAbnormal > 0 ? 'text-red-600' : 'text-gray-900'}
            sub={labResultsTotal > 0 ? `${Math.round((labAbnormal / labResultsTotal) * 100)}%` : undefined}
          />
        </div>

        {/* Top lab services */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Топ анализы</h3>
            <p className="text-xs text-gray-400 mt-0.5">По количеству выполненных результатов, топ 10</p>
          </div>
          {loading ? (
            <div className="p-6 text-center text-sm text-gray-400">Загрузка...</div>
          ) : topLabServices.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Нет данных</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {topLabServices.map(([name, count], i) => {
                const pct = Math.round((count / labServiceMax) * 100)
                return (
                  <div key={name} className="px-5 py-3">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="text-xs font-medium text-gray-400 w-5 text-right flex-shrink-0">
                        {i + 1}
                      </span>
                      <p className="flex-1 text-sm text-gray-900 truncate">{name}</p>
                      <p className="text-sm font-semibold text-gray-900 flex-shrink-0">{count}</p>
                    </div>
                    <div className="ml-8 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-400 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
