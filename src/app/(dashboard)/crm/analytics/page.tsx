'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import {
  SOURCE_OPTIONS,
  sourceLabel,
  LOST_REASON_OPTIONS,
} from '@/lib/crm/constants'

// ─── constants (mirror /crm) ─────────────────────────────────────────────────

const LEADS_STAGES = [
  { key: 'new',         label: 'Неразобранное', color: '#94a3b8' },
  { key: 'in_progress', label: 'В работе',       color: '#3b82f6' },
  { key: 'contact',     label: 'Касание',        color: '#f59e0b' },
  { key: 'booked',      label: 'Записан',        color: '#10b981' },
]
const MEDICAL_STAGES = [
  { key: 'checkup',              label: 'Чек-ап',                   color: '#6366f1' },
  { key: 'tirzepatide_service',  label: 'Тирзепатид (услуга)',     color: '#8b5cf6' },
  { key: 'primary_scheduled',    label: 'Назначена первичная',     color: '#3b82f6' },
  { key: 'no_show',              label: 'Не пришёл',                color: '#ef4444' },
  { key: 'primary_done',         label: 'Проведена первичная',     color: '#10b981' },
  { key: 'secondary_scheduled',  label: 'Назначена вторичная',     color: '#06b6d4' },
  { key: 'secondary_done',       label: 'Проведена вторичная',     color: '#0891b2' },
  { key: 'deciding',             label: 'Принимают решение',        color: '#f59e0b' },
  { key: 'treatment',            label: 'Лечение',                  color: '#84cc16' },
  { key: 'tirzepatide_tx',       label: 'Лечение тирзепатид',      color: '#22c55e' },
  { key: 'control_tests',        label: 'Контр. анализы',          color: '#14b8a6' },
  { key: 'success',              label: 'Успешно',                  color: '#16a34a' },
  { key: 'failed',               label: 'Не реализована',          color: '#dc2626' },
  { key: 'closed',               label: 'Закрыто',                  color: '#6b7280' },
]

const PERIOD_OPTS = [
  { key: '7',   label: '7 дней'  },
  { key: '30',  label: '30 дней' },
  { key: '90',  label: '90 дней' },
  { key: 'all', label: 'Всё время' },
] as const
type PeriodKey = typeof PERIOD_OPTS[number]['key']

// ─── types ───────────────────────────────────────────────────────────────────

interface DealRow {
  id: string
  funnel: string
  stage: string
  status: string
  source: string | null
  priority: string
  lost_reason: string | null
  assigned_to: string | null
  first_owner_id: string | null
  deal_value: number | string | null
  time_to_response_s: number | null
  time_to_booking_s: number | null
  created_at: string
  updated_at: string
}

interface UserOption { id: string; name: string }

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtPct = (n: number) =>
  isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—'

const fmtTenge = (n: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₸'

const fmtDays = (sec: number | null) => {
  if (sec === null || sec === undefined || !isFinite(sec)) return '—'
  const d = sec / 86400
  if (d < 1) return `${(sec / 3600).toFixed(1)} ч`
  return `${d.toFixed(1)} дн`
}

const periodSinceMs = (p: PeriodKey): number | null => {
  if (p === 'all') return null
  return Date.now() - Number(p) * 86400000
}

// ─── KPI card ────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, accent }: {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'orange' | 'blue' | 'red'
}) {
  const accentCls = {
    green:  'text-emerald-600',
    orange: 'text-orange-500',
    blue:   'text-blue-600',
    red:    'text-red-500',
  }[accent ?? 'blue']
  return (
    <div className="bg-white rounded-xl border border-gray-100 px-4 py-3">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accentCls}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Funnel chart (horizontal bars) ──────────────────────────────────────────

function Funnel({ stages, deals }: {
  stages: { key: string; label: string; color: string }[]
  deals: DealRow[]
}) {
  const counts = stages.map(s => ({
    ...s,
    n: deals.filter(d => d.stage === s.key).length,
  }))
  const max = Math.max(1, ...counts.map(c => c.n))

  return (
    <div className="space-y-1.5">
      {counts.map((s, idx) => {
        const w = (s.n / max) * 100
        const prev = idx > 0 ? counts[idx - 1].n : null
        const drop = prev !== null && prev > 0 ? 1 - s.n / prev : null
        return (
          <div key={s.key} className="flex items-center gap-3 text-xs">
            <span className="w-44 text-gray-600 truncate flex-shrink-0">{s.label}</span>
            <div className="flex-1 bg-gray-50 rounded h-7 relative overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{ width: `${w}%`, backgroundColor: s.color, opacity: 0.85 }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-xs font-medium text-white drop-shadow">
                {s.n}
              </span>
            </div>
            <span className="w-16 text-right text-gray-400 flex-shrink-0">
              {drop !== null ? `−${(drop * 100).toFixed(0)}%` : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Breakdown table ─────────────────────────────────────────────────────────

function BreakdownTable({ title, rows, valueLabel }: {
  title: string
  rows: { label: string; total: number; won: number; lost: number; valueSum?: number }[]
  valueLabel?: string
}) {
  const total = rows.reduce((s, r) => s + r.total, 0)
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Категория</th>
              <th className="px-3 py-2 text-right font-medium">Всего</th>
              <th className="px-3 py-2 text-right font-medium">Won</th>
              <th className="px-3 py-2 text-right font-medium">Lost</th>
              <th className="px-3 py-2 text-right font-medium">Конверсия</th>
              {valueLabel && <th className="px-3 py-2 text-right font-medium">{valueLabel}</th>}
              <th className="px-3 py-2 text-right font-medium w-24">Доля</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 ? (
              <tr><td colSpan={valueLabel ? 7 : 6} className="text-center py-8 text-gray-300 text-sm">Нет данных</td></tr>
            ) : rows.map(r => {
              const closed = r.won + r.lost
              const conv = closed > 0 ? r.won / closed : NaN
              const share = total > 0 ? r.total / total : 0
              return (
                <tr key={r.label} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-800 truncate max-w-[180px]">{r.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.total}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.won}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-500">{r.lost}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(conv)}</td>
                  {valueLabel && (
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-medium">
                      {r.valueSum != null ? fmtTenge(r.valueSum) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">{fmtPct(share)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CrmAnalyticsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [period,  setPeriod]  = useState<PeriodKey>('30')
  const [funnel,  setFunnel]  = useState<'leads' | 'medical'>('leads')
  const [deals,   setDeals]   = useState<DealRow[]>([])
  const [owners,  setOwners]  = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)

  const stages = funnel === 'leads' ? LEADS_STAGES : MEDICAL_STAGES

  useEffect(() => {
    if (!clinicId) return
    supabase.from('user_profiles')
      .select('id, first_name, last_name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .then(({ data }) => {
        setOwners((data ?? []).map((u: { id: string; first_name: string; last_name: string }) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`.trim(),
        })))
      })
  }, [clinicId])

  useEffect(() => {
    if (!clinicId) return
    setLoading(true)
    let q = supabase.from('deals')
      .select('id, funnel, stage, status, source, priority, lost_reason, assigned_to, first_owner_id, deal_value, time_to_response_s, time_to_booking_s, created_at, updated_at')
      .eq('clinic_id', clinicId)
      .eq('funnel', funnel)
      .order('created_at', { ascending: false })
    const since = periodSinceMs(period)
    if (since) q = q.gte('created_at', new Date(since).toISOString())
    q.then(({ data }) => {
      setDeals((data ?? []) as DealRow[])
      setLoading(false)
    })
  }, [clinicId, funnel, period])

  // ── KPIs ───────────────────────────────────────────────────────────────
  const total      = deals.length
  const won        = deals.filter(d => d.status === 'won').length
  const lost       = deals.filter(d => d.status === 'lost').length
  const open       = deals.filter(d => d.status === 'open').length
  const closed     = won + lost
  const conv       = closed > 0 ? won / closed : NaN
  const wonValue   = deals
    .filter(d => d.status === 'won')
    .reduce((s, d) => s + Number(d.deal_value ?? 0), 0)
  const openValue  = deals
    .filter(d => d.status === 'open')
    .reduce((s, d) => s + Number(d.deal_value ?? 0), 0)
  const avgResp    = (() => {
    const v = deals.map(d => d.time_to_response_s).filter((x): x is number => x !== null)
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null
  })()
  const avgBook    = (() => {
    const v = deals.map(d => d.time_to_booking_s).filter((x): x is number => x !== null)
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null
  })()

  // ── Breakdown by source ────────────────────────────────────────────────
  const bySource = useMemo(() => {
    const map = new Map<string, { total: number; won: number; lost: number; valueSum: number }>()
    SOURCE_OPTIONS.forEach(s => map.set(s.value, { total: 0, won: 0, lost: 0, valueSum: 0 }))
    map.set('__none__', { total: 0, won: 0, lost: 0, valueSum: 0 })
    for (const d of deals) {
      const key = d.source ?? '__none__'
      const m = map.get(key) ?? map.get('__none__')!
      m.total++
      if (d.status === 'won')  { m.won++;  m.valueSum += Number(d.deal_value ?? 0) }
      if (d.status === 'lost') m.lost++
      map.set(key, m)
    }
    const rows = Array.from(map.entries()).map(([k, v]) => ({
      label: k === '__none__' ? '— не указан —' : sourceLabel(k),
      ...v,
    })).filter(r => r.total > 0).sort((a, b) => b.total - a.total)
    return rows
  }, [deals])

  // ── Breakdown by manager (assigned_to ?? first_owner_id) ──────────────
  const byManager = useMemo(() => {
    const map = new Map<string, { total: number; won: number; lost: number }>()
    for (const d of deals) {
      const key = d.assigned_to ?? d.first_owner_id ?? '__none__'
      const m = map.get(key) ?? { total: 0, won: 0, lost: 0 }
      m.total++
      if (d.status === 'won')  m.won++
      if (d.status === 'lost') m.lost++
      map.set(key, m)
    }
    return Array.from(map.entries()).map(([k, v]) => ({
      label: k === '__none__' ? '— не назначен —' : (owners.find(o => o.id === k)?.name ?? 'Удалён'),
      ...v,
    })).sort((a, b) => b.total - a.total)
  }, [deals, owners])

  // ── Lost reasons ──────────────────────────────────────────────────────
  const lostReasons = useMemo(() => {
    const map = new Map<string, number>()
    LOST_REASON_OPTIONS.forEach(r => map.set(r.value, 0))
    map.set('__none__', 0)
    for (const d of deals) {
      if (d.status !== 'lost') continue
      const key = d.lost_reason ?? '__none__'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    const rows = Array.from(map.entries())
      .map(([k, n]) => ({
        label: k === '__none__' ? '— не указано —' : (LOST_REASON_OPTIONS.find(r => r.value === k)?.label ?? k),
        n,
        share: lost > 0 ? n / lost : 0,
      }))
      .filter(r => r.n > 0)
      .sort((a, b) => b.n - a.n)
    return rows
  }, [deals, lost])

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Аналитика CRM</h1>
            <p className="text-sm text-gray-400">Конверсии, источники, менеджеры</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['leads', 'medical'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFunnel(f)}
                className={[
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  funnel === f ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}
              >
                {f === 'leads' ? 'Лиды' : 'Медицинская'}
              </button>
            ))}
          </div>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value as PeriodKey)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            {PERIOD_OPTS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-12">Загрузка...</p>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Сделок" value={String(total)} sub={`${open} открыто`} accent="blue" />
            <Kpi label="Конверсия" value={fmtPct(conv)} sub={`${won} won / ${lost} lost`} accent="green" />
            <Kpi label="Сумма won" value={fmtTenge(wonValue)} sub={`Открыто: ${fmtTenge(openValue)}`} accent="green" />
            <Kpi label="Среднее время до записи" value={fmtDays(avgBook)} sub={`Реакция: ${fmtDays(avgResp)}`} accent="orange" />
          </div>

          {/* Funnel */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-800">
                Воронка · {funnel === 'leads' ? 'Лиды' : 'Медицинская'}
              </h3>
              <p className="text-xs text-gray-400">Drop-off — % падения от предыдущего этапа</p>
            </div>
            <Funnel stages={stages} deals={deals} />
          </div>

          {/* Breakdowns */}
          <BreakdownTable
            title="По источникам"
            rows={bySource}
            valueLabel="Won, ₸"
          />

          <BreakdownTable
            title="По менеджерам (ответственным)"
            rows={byManager}
          />

          {/* Lost reasons */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Причины отказов</h3>
              <span className="text-xs text-gray-400">{lost} проигрышей</span>
            </div>
            {lostReasons.length === 0 ? (
              <p className="text-center py-8 text-gray-300 text-sm">Нет проигрышей за период</p>
            ) : (
              <div className="px-4 py-3 space-y-2">
                {lostReasons.map(r => (
                  <div key={r.label} className="flex items-center gap-3 text-sm">
                    <span className="w-44 text-gray-700 truncate flex-shrink-0">{r.label}</span>
                    <div className="flex-1 bg-gray-50 rounded-full h-3 overflow-hidden">
                      <div className="h-full bg-red-400" style={{ width: `${r.share * 100}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums text-gray-700">{r.n}</span>
                    <span className="w-14 text-right tabular-nums text-gray-400 text-xs">{fmtPct(r.share)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
