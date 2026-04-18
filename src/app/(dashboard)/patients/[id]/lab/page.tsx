'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

// ─── types ────────────────────────────────────────────────────────────────────

interface PatientLabResult {
  id: string
  service_id: string | null
  service_name_snapshot: string
  result_value: number | null
  result_text: string | null
  unit_snapshot: string | null
  reference_min: number | null
  reference_max: number | null
  reference_text: string | null
  flag: 'normal' | 'low' | 'high' | 'critical' | null
  lab_order_id: string | null
  result_date: string
}

interface ActiveOrder {
  id: string
  order_number: string | null
  status: string
  urgent: boolean
  ordered_at: string
  notes: string | null
  items?: Array<{ name: string }>
}

interface Patient {
  id: string
  full_name: string
}

// ─── constants ────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = ['ordered','agreed','paid','sample_taken','in_progress','ready']

const ORDER_STATUS: Record<string, { cls: string; label: string }> = {
  ordered:      { cls: 'bg-gray-100 text-gray-600',    label: 'Назначен' },
  agreed:       { cls: 'bg-blue-50 text-blue-600',     label: 'Согласован' },
  paid:         { cls: 'bg-teal-100 text-teal-700',    label: 'Оплачен' },
  sample_taken: { cls: 'bg-yellow-100 text-yellow-700',label: 'Материал взят' },
  in_progress:  { cls: 'bg-blue-100 text-blue-700',    label: 'В работе' },
  ready:        { cls: 'bg-green-100 text-green-700',  label: 'Готов' },
  verified:     { cls: 'bg-purple-100 text-purple-700',label: 'Верифицирован' },
  delivered:    { cls: 'bg-gray-50 text-gray-400',     label: 'Выдан' },
}

const FLAG_STYLE: Record<string, { cls: string; label: string; dot: string }> = {
  normal:   { cls: 'text-green-700',  label: 'норма',   dot: 'bg-green-500'  },
  low:      { cls: 'text-blue-600',   label: '↓ низко', dot: 'bg-blue-500'   },
  high:     { cls: 'text-orange-600', label: '↑ высоко',dot: 'bg-orange-500' },
  critical: { cls: 'text-red-700 font-bold', label: '⚠ критично', dot: 'bg-red-600' },
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}
function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day:'numeric', month:'short' })
}

// ─── mini-sparkline ───────────────────────────────────────────────────────────

function Sparkline({
  values, refMin, refMax,
}: {
  values: Array<{ v: number; date: string; flag: string | null }>
  refMin: number | null
  refMax: number | null
}) {
  if (values.length < 2) return null
  const W = 120, H = 28, P = 2
  const nums = values.map(p => p.v)
  let minY = Math.min(...nums, refMin ?? Infinity)
  let maxY = Math.max(...nums, refMax ?? -Infinity)
  if (minY === maxY) { minY -= 1; maxY += 1 }
  const range = maxY - minY
  const xs = (i: number) => P + (i / (values.length - 1)) * (W - P * 2)
  const ys = (v: number) => H - P - ((v - minY) / range) * (H - P * 2)

  const points = values.map((p, i) => `${xs(i)},${ys(p.v)}`).join(' ')
  const refBand = (refMin != null && refMax != null)
    ? { y: ys(refMax), h: Math.max(1, ys(refMin) - ys(refMax)) }
    : null

  return (
    <svg width={W} height={H} className="flex-shrink-0">
      {refBand && (
        <rect x={0} y={refBand.y} width={W} height={refBand.h}
          fill="currentColor" className="text-green-100" />
      )}
      <polyline points={points} fill="none" stroke="currentColor"
        className="text-blue-500" strokeWidth="1.5" strokeLinejoin="round" />
      {values.map((p, i) => {
        const color = p.flag === 'critical' ? 'fill-red-600'
          : p.flag === 'high' ? 'fill-orange-500'
          : p.flag === 'low'  ? 'fill-blue-500'
          : 'fill-green-500'
        return (
          <circle key={i} cx={xs(i)} cy={ys(p.v)} r={i === values.length - 1 ? 2.5 : 1.7}
            className={color} />
        )
      })}
    </svg>
  )
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, colorCls }: { label: string; value: number | string; colorCls: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-0">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${colorCls}`}>{value}</p>
    </div>
  )
}

// ─── active order card ───────────────────────────────────────────────────────

function ActiveOrderCard({ o }: { o: ActiveOrder }) {
  const s = ORDER_STATUS[o.status] ?? { cls: 'bg-gray-100 text-gray-600', label: o.status }
  return (
    <div className="border border-gray-200 rounded-lg bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-gray-500">#{o.order_number ?? '—'}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
            {o.urgent && <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700">🔴 СРОЧНО</span>}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(o.ordered_at)}</p>
          {(o.items ?? []).length > 0 && (
            <p className="text-xs text-gray-600 mt-1">{(o.items ?? []).map(i => i.name).join(', ')}</p>
          )}
          {o.notes && <p className="text-xs text-gray-400 mt-1 italic">{o.notes}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── grouped history row ─────────────────────────────────────────────────────

interface Grouped {
  name: string
  service_id: string | null
  unit: string | null
  refMin: number | null
  refMax: number | null
  refText: string | null
  rows: PatientLabResult[]
}

function HistoryRow({ g }: { g: Grouped }) {
  const [expanded, setExpanded] = useState(false)
  const latest = g.rows[0]
  const flagStyle = latest.flag ? FLAG_STYLE[latest.flag] : null

  const numericRows = g.rows
    .filter(r => r.result_value != null)
    .sort((a, b) => new Date(a.result_date).getTime() - new Date(b.result_date).getTime())
  const sparkValues = numericRows.map(r => ({
    v: r.result_value!,
    date: r.result_date,
    flag: r.flag,
  }))

  const trend = (() => {
    if (numericRows.length < 2) return null
    const a = numericRows[numericRows.length - 2].result_value!
    const b = numericRows[numericRows.length - 1].result_value!
    if (b > a * 1.05) return { sym: '↑', cls: 'text-orange-600' }
    if (b < a * 0.95) return { sym: '↓', cls: 'text-blue-600' }
    return { sym: '≈', cls: 'text-gray-400' }
  })()

  const displayValue = latest.result_value != null
    ? String(latest.result_value)
    : (latest.result_text ?? '—')

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-medium text-sm text-gray-900 truncate">{g.name}</span>
              {g.rows.length > 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {g.rows.length}×
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-lg font-semibold ${flagStyle?.cls ?? 'text-gray-900'}`}>
                {displayValue}
              </span>
              {g.unit && <span className="text-xs text-gray-500">{g.unit}</span>}
              {flagStyle && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  latest.flag === 'critical' ? 'bg-red-100 text-red-700'
                  : latest.flag === 'high'   ? 'bg-orange-100 text-orange-700'
                  : latest.flag === 'low'    ? 'bg-blue-100 text-blue-700'
                  :                            'bg-green-100 text-green-700'
                }`}>{flagStyle.label}</span>
              )}
              {trend && (
                <span className={`text-sm ${trend.cls}`}>{trend.sym}</span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {fmtDate(latest.result_date)}
              {g.refMin != null || g.refMax != null ? (
                <span className="ml-2">
                  норма {g.refMin ?? '—'} – {g.refMax ?? '—'}
                </span>
              ) : g.refText ? (
                <span className="ml-2">норма: {g.refText}</span>
              ) : null}
            </p>
          </div>
          {sparkValues.length >= 2 && (
            <Sparkline values={sparkValues} refMin={g.refMin} refMax={g.refMax} />
          )}
          <span className="text-gray-400 text-xs flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 text-left">
                <th className="py-1.5 font-medium">Дата</th>
                <th className="py-1.5 font-medium">Значение</th>
                <th className="py-1.5 font-medium">Ед.</th>
                <th className="py-1.5 font-medium">Норма</th>
                <th className="py-1.5 font-medium">Флаг</th>
                <th className="py-1.5 font-medium">Заказ</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map(r => {
                const fs = r.flag ? FLAG_STYLE[r.flag] : null
                return (
                  <tr key={r.id} className={`border-t border-gray-100 ${r.flag === 'critical' ? 'bg-red-50' : ''}`}>
                    <td className="py-1.5 text-gray-600">{fmtShort(r.result_date)}</td>
                    <td className={`py-1.5 ${fs?.cls ?? 'text-gray-900'}`}>
                      {r.result_value != null ? r.result_value : (r.result_text ?? '—')}
                    </td>
                    <td className="py-1.5 text-gray-500">{r.unit_snapshot ?? '—'}</td>
                    <td className="py-1.5 text-gray-500">
                      {r.reference_min != null || r.reference_max != null
                        ? `${r.reference_min ?? '?'} – ${r.reference_max ?? '?'}`
                        : (r.reference_text ?? '—')}
                    </td>
                    <td className="py-1.5">
                      {fs && (
                        <span className={`inline-flex items-center gap-1 ${fs.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${fs.dot}`} />
                          {fs.label}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-gray-400 font-mono text-[10px]">
                      {r.lab_order_id ? (
                        <Link href={`/lab`} className="hover:text-blue-600">
                          →
                        </Link>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function PatientLabPage() {
  const { id: patientId } = useParams<{ id: string }>()

  const [patient, setPatient] = useState<Patient | null>(null)
  const [rows, setRows] = useState<PatientLabResult[]>([])
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [flagFilter, setFlagFilter] = useState<'all' | 'abnormal' | 'critical'>('all')

  const load = useCallback(async () => {
    if (!patientId) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      const [patientRes, resultsRes, activeRes] = await Promise.all([
        supabase.from('patients').select('id, full_name').eq('id', patientId).single(),
        supabase.from('patient_lab_results')
          .select('id, service_id, service_name_snapshot, result_value, result_text, unit_snapshot, reference_min, reference_max, reference_text, flag, lab_order_id, result_date')
          .eq('patient_id', patientId)
          .order('result_date', { ascending: false }),
        supabase.from('lab_orders')
          .select('id, order_number, status, urgent, ordered_at, notes, items:lab_order_items(name)')
          .eq('patient_id', patientId)
          .in('status', ACTIVE_STATUSES)
          .order('ordered_at', { ascending: false }),
      ])
      if (patientRes.error) throw patientRes.error
      if (resultsRes.error) throw resultsRes.error
      if (activeRes.error)  throw activeRes.error

      setPatient(patientRes.data as Patient)
      setRows((resultsRes.data ?? []) as PatientLabResult[])
      setActiveOrders((activeRes.data ?? []) as ActiveOrder[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  // Filter rows
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !r.service_name_snapshot.toLowerCase().includes(q)) return false
      if (dateFrom && r.result_date < dateFrom) return false
      if (dateTo && r.result_date > dateTo + 'T23:59:59') return false
      if (flagFilter === 'critical' && r.flag !== 'critical') return false
      if (flagFilter === 'abnormal' && (r.flag == null || r.flag === 'normal')) return false
      return true
    })
  }, [rows, search, dateFrom, dateTo, flagFilter])

  // Group by service (latest-first per group, groups sorted by latest date)
  const grouped = useMemo<Grouped[]>(() => {
    const m = new Map<string, Grouped>()
    for (const r of filteredRows) {
      const key = r.service_id ?? r.service_name_snapshot
      const existing = m.get(key)
      if (existing) {
        existing.rows.push(r)
        if (r.unit_snapshot && !existing.unit) existing.unit = r.unit_snapshot
        if (r.reference_min != null && existing.refMin == null) existing.refMin = r.reference_min
        if (r.reference_max != null && existing.refMax == null) existing.refMax = r.reference_max
        if (r.reference_text && !existing.refText) existing.refText = r.reference_text
      } else {
        m.set(key, {
          name: r.service_name_snapshot,
          service_id: r.service_id,
          unit: r.unit_snapshot,
          refMin: r.reference_min,
          refMax: r.reference_max,
          refText: r.reference_text,
          rows: [r],
        })
      }
    }
    const arr = Array.from(m.values())
    // rows inside each group already descending by date because input was sorted
    arr.sort((a, b) =>
      new Date(b.rows[0].result_date).getTime() - new Date(a.rows[0].result_date).getTime()
    )
    return arr
  }, [filteredRows])

  // Stats
  const totalParams = new Set(rows.map(r => r.service_id ?? r.service_name_snapshot)).size
  const totalRecords = rows.length
  const criticalCount = rows.filter(r => r.flag === 'critical').length
  const abnormalCount = rows.filter(r => r.flag && r.flag !== 'normal').length
  const lastDate = rows.length > 0 ? fmtDate(rows[0].result_date) : '—'

  const resetFilters = () => {
    setSearch(''); setDateFrom(''); setDateTo(''); setFlagFilter('all')
  }
  const hasFilters = search || dateFrom || dateTo || flagFilter !== 'all'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/patients/${patientId}`} className="hover:text-blue-600 transition-colors">
          {patient ? patient.full_name : 'Пациент'}
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Анализы</span>
      </div>

      <h1 className="text-xl font-bold text-gray-900">История анализов</h1>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className="flex gap-3 flex-wrap">
          <StatCard label="Параметров"        value={totalParams}   colorCls="text-gray-800" />
          <StatCard label="Всего записей"     value={totalRecords}  colorCls="text-blue-600" />
          <StatCard label="Аномалий"          value={abnormalCount} colorCls="text-orange-600" />
          <StatCard label="Критических"       value={criticalCount} colorCls="text-red-600" />
          <StatCard label="Последний анализ"  value={lastDate}      colorCls="text-gray-800" />
        </div>
      )}

      {/* Active orders (running) */}
      {activeOrders.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Активные заказы ({activeOrders.length})
          </p>
          <div className="space-y-2">
            {activeOrders.map(o => <ActiveOrderCard key={o.id} o={o} />)}
          </div>
        </div>
      )}

      {/* Filters */}
      {!loading && rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Поиск по параметру"
              className="flex-1 min-w-[200px] border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <span className="text-xs text-gray-400">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { k: 'all',      label: 'Все',        cls: 'border-gray-300 text-gray-700' },
              { k: 'abnormal', label: 'Аномалии',   cls: 'border-orange-300 text-orange-700' },
              { k: 'critical', label: 'Критические',cls: 'border-red-300 text-red-700' },
            ].map(f => (
              <button
                key={f.k}
                onClick={() => setFlagFilter(f.k as typeof flagFilter)}
                className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                  flagFilter === f.k
                    ? 'bg-gray-900 text-white border-gray-900'
                    : `bg-white hover:bg-gray-50 ${f.cls}`
                }`}
              >
                {f.label}
              </button>
            ))}
            {hasFilters && (
              <button
                onClick={resetFilters}
                className="ml-auto text-xs text-gray-400 hover:text-gray-700">
                сбросить
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">
              Показано: {grouped.length} из {totalParams}
            </span>
          </div>
        </div>
      )}

      {/* History grouped */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(n => (
            <div key={n} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          Верифицированных результатов анализов пока нет
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          По выбранным фильтрам ничего не найдено
        </div>
      ) : (
        <div className="space-y-2">
          {grouped.map(g => <HistoryRow key={g.service_id ?? g.name} g={g} />)}
        </div>
      )}
    </div>
  )
}
