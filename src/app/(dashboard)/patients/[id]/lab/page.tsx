'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── types ────────────────────────────────────────────────────────────────────

interface ResultRow {
  parameter: string
  value: string
  unit: string | null
  ref_min: string | null
  ref_max: string | null
  flag: 'normal' | 'low' | 'high' | 'critical' | null
}

interface LabResult {
  id: string
  order_item_id: string | null
  results: ResultRow[]
  conclusion: string | null
  has_critical: boolean
  completed_at: string | null
}

interface LabOrderItem {
  id: string
  name: string
  price: number | null
  status: 'pending' | 'completed'
  results: LabResult[]
}

interface LabOrder {
  id: string
  order_number: string
  status: string
  urgent: boolean
  ordered_at: string
  notes: string | null
  external_lab_name: string | null
  items: LabOrderItem[]
}

interface Patient {
  id: string
  full_name: string
}

// ─── constants ────────────────────────────────────────────────────────────────

const ORDER_STATUS: Record<string, { cls: string; label: string }> = {
  ordered:      { cls: 'bg-gray-100 text-gray-600',    label: 'Назначен' },
  agreed:       { cls: 'bg-blue-50 text-blue-600',     label: 'Согласован' },
  paid:         { cls: 'bg-teal-100 text-teal-700',    label: 'Оплачен' },
  sample_taken: { cls: 'bg-yellow-100 text-yellow-700',label: 'Взят материал' },
  in_progress:  { cls: 'bg-blue-100 text-blue-700',    label: 'В процессе' },
  rejected:     { cls: 'bg-red-100 text-red-600',      label: 'Отклонён' },
  ready:        { cls: 'bg-green-100 text-green-700',  label: 'Готов' },
  verified:     { cls: 'bg-purple-100 text-purple-700',label: 'Верифицирован' },
  delivered:    { cls: 'bg-gray-50 text-gray-400',     label: 'Выдан' },
}

const FLAG_STYLE: Record<string, { cls: string; label: string }> = {
  normal:   { cls: 'text-green-700',                                   label: 'Норма' },
  low:      { cls: 'text-blue-600',                                    label: 'Низко' },
  high:     { cls: 'text-orange-600',                                  label: 'Высоко' },
  critical: { cls: 'text-red-700 font-bold bg-red-50 px-1 rounded',   label: 'Крит.' },
}

const PENDING_STATUSES = new Set(['ordered', 'agreed', 'in_progress'])

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

// ─── sub-components ───────────────────────────────────────────────────────────

function FlagBadge({ flag }: { flag: ResultRow['flag'] }) {
  if (!flag || flag === 'normal') return null
  const s = FLAG_STYLE[flag]
  return (
    <span className={`text-xs ${s.cls}`}>{s.label}</span>
  )
}

function ResultsTable({ items }: { items: LabOrderItem[] }) {
  const itemsWithResults = items.filter(i => i.results && i.results.length > 0)
  if (itemsWithResults.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic py-2">Результаты ещё не загружены</p>
    )
  }

  return (
    <div className="space-y-4">
      {itemsWithResults.map(item => {
        const result = item.results[0]
        return (
          <div key={item.id}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              {item.name}
            </p>
            {result.conclusion && (
              <p className="text-sm text-gray-600 mb-2 italic">{result.conclusion}</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-1.5 font-medium">Параметр</th>
                    <th className="px-3 py-1.5 font-medium">Значение</th>
                    <th className="px-3 py-1.5 font-medium">Ед.</th>
                    <th className="px-3 py-1.5 font-medium">Реф. диапазон</th>
                    <th className="px-3 py-1.5 font-medium">Флаг</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((row, idx) => {
                    const isCritical = row.flag === 'critical'
                    return (
                      <tr
                        key={idx}
                        className={`border-t border-gray-100 ${isCritical ? 'bg-red-50' : ''}`}
                      >
                        <td className={`px-3 py-1.5 ${isCritical ? 'font-bold text-red-700' : 'text-gray-700'}`}>
                          {row.parameter}
                        </td>
                        <td className={`px-3 py-1.5 ${isCritical ? 'font-bold text-red-700' : 'text-gray-900'}`}>
                          {row.value}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{row.unit ?? '—'}</td>
                        <td className="px-3 py-1.5 text-gray-500">
                          {row.ref_min != null || row.ref_max != null
                            ? `${row.ref_min ?? '?'} – ${row.ref_max ?? '?'}`
                            : '—'}
                        </td>
                        <td className="px-3 py-1.5">
                          <FlagBadge flag={row.flag ?? null} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {result.completed_at && (
              <p className="text-xs text-gray-400 mt-1">
                Завершено: {fmt(result.completed_at)}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OrderCard({ order }: { order: LabOrder }) {
  const [expanded, setExpanded] = useState(false)
  const s = ORDER_STATUS[order.status] ?? { cls: 'bg-gray-100 text-gray-600', label: order.status }
  const hasCritical = order.items.some(i =>
    i.results.some(r => r.has_critical)
  )

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-800 text-sm">
                #{order.order_number}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
                {s.label}
              </span>
              {order.urgent && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-700">
                  СРОЧНО
                </span>
              )}
              {hasCritical && (
                <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-red-50 text-red-700 border border-red-200">
                  ⚠ Критические значения
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{fmt(order.ordered_at)}</p>
            {order.external_lab_name && (
              <p className="text-xs text-gray-500 mt-0.5">Лаборатория: {order.external_lab_name}</p>
            )}
            {order.items.length > 0 && (
              <p className="text-xs text-gray-600 mt-1">
                {order.items.map(i => i.name).join(', ')}
              </p>
            )}
            {order.notes && (
              <p className="text-xs text-gray-400 mt-1 italic">{order.notes}</p>
            )}
          </div>
          <span className="text-gray-400 text-sm flex-shrink-0 mt-0.5">
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <ResultsTable items={order.items} />
        </div>
      )}
    </div>
  )
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  colorCls,
}: {
  label: string
  value: number
  colorCls: string
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-0">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${colorCls}`}>{value}</p>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function PatientLabPage() {
  const { id: patientId } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [patient, setPatient] = useState<Patient | null>(null)
  const [orders, setOrders] = useState<LabOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!patientId) return
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()

      const [patientRes, ordersRes] = await Promise.all([
        supabase
          .from('patients')
          .select('id, full_name')
          .eq('id', patientId)
          .single(),
        supabase
          .from('lab_orders')
          .select('*, items:lab_order_items(*, results:lab_results(*))')
          .eq('patient_id', patientId)
          .order('ordered_at', { ascending: false }),
      ])

      if (patientRes.error) throw patientRes.error
      if (ordersRes.error) throw ordersRes.error

      setPatient(patientRes.data as Patient)
      setOrders((ordersRes.data ?? []) as LabOrder[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => { load() }, [load])

  // stats
  const total = orders.length
  const pending = orders.filter(o => PENDING_STATUSES.has(o.status)).length
  const readyVerified = orders.filter(o => o.status === 'ready' || o.status === 'verified').length
  const critical = orders.filter(o =>
    o.items.some(i => i.results.some(r => r.has_critical))
  ).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link
          href={`/patients/${patientId}`}
          className="hover:text-blue-600 transition-colors"
        >
          {patient ? patient.full_name : 'Пациент'}
        </Link>
        <span>/</span>
        <span className="text-gray-800 font-medium">Лаборатория</span>
      </div>

      {/* header */}
      <h1 className="text-xl font-bold text-gray-900">Лабораторные заказы</h1>

      {/* error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* stats */}
      {!loading && (
        <div className="flex gap-3 flex-wrap">
          <StatCard label="Всего заказов"     value={total}        colorCls="text-gray-800" />
          <StatCard label="В процессе"        value={pending}      colorCls="text-blue-600" />
          <StatCard label="Готово / верифиц." value={readyVerified} colorCls="text-green-600" />
          <StatCard label="Критические"       value={critical}     colorCls="text-red-600" />
        </div>
      )}

      {/* list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(n => (
            <div key={n} className="h-20 rounded-lg bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          Лабораторных заказов не найдено
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  )
}
