'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ─────────────────────────────────────────────────── */
interface Parameter {
  name: string
  unit: string
  ref_min: number | null
  ref_max: number | null
  critical_low?: number | null
  critical_high?: number | null
}

interface ResultEntry {
  parameter: string
  value: string
  unit: string
  ref_min: number | null
  ref_max: number | null
  flag: 'normal' | 'low' | 'high' | 'critical'
}

interface LabResult {
  id: string
  order_id: string
  order_item_id: string
  patient_id: string
  results: ResultEntry[]
  conclusion: string | null
  has_critical: boolean
  completed_at: string
}

interface Template {
  id: string
  name: string
  parameters: Parameter[]
}

interface OrderItem {
  id: string
  order_id: string
  template_id: string | null
  name: string
  price: number | null
  status: string
  template: Template | null
  result: LabResult[]
}

interface LabOrder {
  id: string
  clinic_id: string
  patient_id: string
  doctor_id: string | null
  order_number: string | null
  status: string
  urgent: boolean
  ordered_at: string
  notes: string | null
  external_lab_name: string | null
  rejected_reason: string | null
  verified_at: string | null
  patient: { id: string; full_name: string; birth_date: string | null; gender: string | null } | null
  doctor: { id: string; first_name: string; last_name: string } | null
  items: OrderItem[]
}

/* ─── Constants ─────────────────────────────────────────────── */
const STATUS_CLR: Record<string, string> = {
  ordered:      'bg-gray-100 text-gray-600',
  agreed:       'bg-blue-50 text-blue-600',
  paid:         'bg-teal-100 text-teal-700',
  sample_taken: 'bg-yellow-100 text-yellow-700',
  in_progress:  'bg-blue-100 text-blue-800',
  ready:        'bg-green-100 text-green-700',
  verified:     'bg-purple-100 text-purple-700',
  delivered:    'bg-gray-50 text-gray-400',
  rejected:     'bg-red-100 text-red-600',
}

const STATUS_RU: Record<string, string> = {
  ordered:      'Новый',
  agreed:       'Согласован',
  paid:         'Оплачен',
  sample_taken: 'Взят образец',
  in_progress:  'В работе',
  ready:        'Готов',
  verified:     'Верифицирован',
  delivered:    'Выдан',
  rejected:     'Отклонён',
}

const STATUS_FLOW = [
  'ordered',
  'agreed',
  'sample_taken',
  'in_progress',
  'ready',
  'verified',
  'delivered',
]

const NEXT_STATUS: Record<string, { status: string; label: string; cls: string }> = {
  ordered:      { status: 'agreed',       label: 'Согласовать',    cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
  agreed:       { status: 'sample_taken', label: 'Образец взят',   cls: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
  sample_taken: { status: 'in_progress',  label: 'В работу',       cls: 'bg-blue-700 hover:bg-blue-800 text-white' },
  in_progress:  { status: 'ready',        label: 'Отметить готовым', cls: 'bg-green-600 hover:bg-green-700 text-white' },
  ready:        { status: 'verified',     label: 'Верифицировать', cls: 'bg-purple-600 hover:bg-purple-700 text-white' },
  verified:     { status: 'delivered',    label: 'Выдать пациенту', cls: 'bg-gray-600 hover:bg-gray-700 text-white' },
}

const FLAG_CLR: Record<string, string> = {
  normal:   'text-green-700',
  low:      'text-blue-600',
  high:     'text-orange-600',
  critical: 'text-red-600 font-bold',
}

const FLAG_RU: Record<string, string> = {
  normal:   'Норма',
  low:      'Низко',
  high:     'Высоко',
  critical: '⚠ Критично',
}

/* ─── Helpers ───────────────────────────────────────────────── */
function calcFlag(
  value: string,
  param: Parameter,
): 'normal' | 'low' | 'high' | 'critical' {
  const v = parseFloat(value)
  if (isNaN(v)) return 'normal'

  if (
    (param.critical_low != null && v <= param.critical_low) ||
    (param.critical_high != null && v >= param.critical_high)
  ) {
    return 'critical'
  }
  if (param.ref_min != null && v < param.ref_min) return 'low'
  if (param.ref_max != null && v > param.ref_max) return 'high'
  return 'normal'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/* ─── ResultsForm ───────────────────────────────────────────── */
function ResultsForm({
  item,
  clinicId,
  patientId,
  onSaved,
}: {
  item: OrderItem
  clinicId: string
  patientId: string
  onSaved: () => void
}) {
  const supabase = createClient()

  const parameters: Parameter[] = item.template?.parameters ?? []

  // Build initial values map: { paramName: '' }
  const initValues = () => {
    const m: Record<string, string> = {}
    parameters.forEach(p => { m[p.name] = '' })
    return m
  }

  const [values, setValues] = useState<Record<string, string>>(initValues)
  const [conclusion, setConclusion] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setValue = (name: string, val: string) =>
    setValues(prev => ({ ...prev, [name]: val }))

  const handleSave = async () => {
    if (parameters.length === 0) {
      setError('Нет параметров для ввода')
      return
    }
    setSaving(true)
    setError('')

    const results: ResultEntry[] = parameters.map(p => {
      const val = values[p.name] ?? ''
      const flag = calcFlag(val, p)
      return {
        parameter: p.name,
        value: val,
        unit: p.unit,
        ref_min: p.ref_min,
        ref_max: p.ref_max,
        flag,
      }
    })

    const hasCritical = results.some(r => r.flag === 'critical')

    const { error: insertErr } = await supabase.from('lab_results').insert({
      clinic_id:     clinicId,
      order_id:      item.order_id,
      order_item_id: item.id,
      patient_id:    patientId,
      results,
      conclusion:    conclusion.trim() || null,
      has_critical:  hasCritical,
      completed_at:  new Date().toISOString(),
    })

    if (insertErr) {
      setError(insertErr.message)
      setSaving(false)
      return
    }

    await supabase
      .from('lab_order_items')
      .update({ status: 'completed' })
      .eq('id', item.id)

    setSaving(false)
    onSaved()
  }

  const inp =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  if (parameters.length === 0) {
    return (
      <div className="mt-3 p-4 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-700">
        Шаблон не содержит параметров. Обратитесь к администратору для настройки шаблона.
      </div>
    )
  }

  return (
    <div className="mt-3 border border-blue-100 rounded-xl bg-blue-50/30 p-4 space-y-4">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Ввод результатов</p>

      <div className="space-y-3">
        {parameters.map(p => {
          const val = values[p.name] ?? ''
          const flag = val !== '' ? calcFlag(val, p) : null
          return (
            <div key={p.name} className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">{p.name}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    value={val}
                    onChange={e => setValue(p.name, e.target.value)}
                    className={inp}
                    placeholder="Значение"
                  />
                  {p.unit && <span className="text-xs text-gray-400 whitespace-nowrap">{p.unit}</span>}
                </div>
              </div>
              <div className="text-xs text-gray-400 text-right min-w-[100px]">
                {(p.ref_min != null || p.ref_max != null) && (
                  <span>
                    {p.ref_min ?? '—'} – {p.ref_max ?? '—'}
                  </span>
                )}
                {flag && (
                  <div className={`mt-0.5 font-medium ${FLAG_CLR[flag]}`}>
                    {FLAG_RU[flag]}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5">Заключение</label>
        <textarea
          className={inp + ' resize-none'}
          rows={3}
          value={conclusion}
          onChange={e => setConclusion(e.target.value)}
          placeholder="Клиническое заключение..."
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Сохранение...' : 'Сохранить результаты'}
        </button>
      </div>
    </div>
  )
}

/* ─── ResultsTable ──────────────────────────────────────────── */
function ResultsTable({ result }: { result: LabResult }) {
  return (
    <div className="mt-3 space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Параметр</th>
              <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Значение</th>
              <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Ед.</th>
              <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Референс</th>
              <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Флаг</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, i) => (
              <tr key={i} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2.5 text-gray-700">{r.parameter}</td>
                <td className={`px-4 py-2.5 font-medium ${FLAG_CLR[r.flag] ?? ''}`}>
                  {r.value}
                </td>
                <td className="px-4 py-2.5 text-gray-400">{r.unit}</td>
                <td className="px-4 py-2.5 text-gray-400">
                  {r.ref_min != null || r.ref_max != null
                    ? `${r.ref_min ?? '—'} – ${r.ref_max ?? '—'}`
                    : '—'}
                </td>
                <td className={`px-4 py-2.5 text-xs font-medium ${FLAG_CLR[r.flag] ?? ''}`}>
                  {FLAG_RU[r.flag] ?? r.flag}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.conclusion && (
        <div className="bg-gray-50 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Заключение</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{result.conclusion}</p>
        </div>
      )}
      {result.has_critical && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">
          <span className="text-red-600 font-bold">⚠</span>
          <span className="text-sm font-semibold text-red-600">Обнаружены критические значения!</span>
        </div>
      )}
    </div>
  )
}

/* ─── StatusBar ─────────────────────────────────────────────── */
function StatusBar({ current }: { current: string }) {
  const steps = STATUS_FLOW.filter(s => s !== 'delivered')
  const currentIdx = steps.indexOf(current)

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((s, i) => {
        const done = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={s} className="flex items-center gap-1">
            <div
              className={[
                'px-2.5 py-1 rounded-full text-xs font-medium',
                active
                  ? (STATUS_CLR[s] ?? 'bg-gray-100 text-gray-600') + ' ring-2 ring-offset-1 ring-current'
                  : done
                  ? 'bg-green-50 text-green-600'
                  : 'bg-gray-50 text-gray-300',
              ].join(' ')}
            >
              {done && <span className="mr-1">✓</span>}
              {STATUS_RU[s] ?? s}
            </div>
            {i < steps.length - 1 && (
              <span className="text-gray-200 text-xs">›</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────── */
export default function LabOrderPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''
  const { id: orderId } = useParams<{ id: string }>()

  const [order, setOrder] = useState<LabOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [advancing, setAdvancing] = useState(false)
  const [openForms, setOpenForms] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('lab_orders')
      .select(`
        *,
        patient:patients(id, full_name, birth_date, gender),
        doctor:doctors(id, first_name, last_name),
        items:lab_order_items(
          *,
          template:lab_test_templates(id, name, parameters),
          result:lab_results(*)
        )
      `)
      .eq('id', orderId)
      .single()

    if (error || !data) {
      setNotFound(true)
    } else {
      setOrder(data as unknown as LabOrder)
    }
    setLoading(false)
  }, [orderId])

  useEffect(() => { load() }, [load])

  const toggleForm = (itemId: string) => {
    setOpenForms(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  const closeForm = (itemId: string) => {
    setOpenForms(prev => {
      const next = new Set(prev)
      next.delete(itemId)
      return next
    })
  }

  const advanceStatus = async () => {
    if (!order) return
    const next = NEXT_STATUS[order.status]
    if (!next) return
    setAdvancing(true)
    await supabase
      .from('lab_orders')
      .update({ status: next.status })
      .eq('id', order.id)
    setAdvancing(false)
    load()
  }

  const markReady = async () => {
    if (!order) return
    setAdvancing(true)
    await supabase
      .from('lab_orders')
      .update({ status: 'ready' })
      .eq('id', order.id)
    setAdvancing(false)
    load()
  }

  /* ─── Loading / error states ─────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-sm text-gray-400">Загрузка...</div>
      </div>
    )
  }

  if (notFound || !order) {
    return (
      <div className="max-w-2xl mx-auto text-center py-20">
        <p className="text-gray-400 text-sm mb-4">Направление не найдено</p>
        <Link href="/lab" className="text-blue-600 hover:underline text-sm">
          ← Вернуться к списку
        </Link>
      </div>
    )
  }

  const items: OrderItem[] = order.items ?? []
  const allCompleted = items.length > 0 && items.every(i => i.status === 'completed')
  const nextStep = NEXT_STATUS[order.status]
  const isTerminal = ['delivered', 'rejected'].includes(order.status)

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ─── Header ─────────────────────────────── */}
      <div className="flex items-start gap-4">
        <Link
          href="/lab"
          className="mt-0.5 text-gray-400 hover:text-gray-600 transition-colors text-sm flex items-center gap-1"
        >
          ← Назад
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-semibold text-gray-900">
              {order.order_number ?? 'Направление'}
            </h1>
            {order.urgent && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-600">
                🔴 СРОЧНЫЙ
              </span>
            )}
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_CLR[order.status] ?? ''}`}>
              {STATUS_RU[order.status] ?? order.status}
            </span>
          </div>
          {order.patient && (
            <p className="text-sm text-gray-500 mt-0.5">{order.patient.full_name}</p>
          )}
        </div>
      </div>

      {/* ─── Status progression ─────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
        <StatusBar current={order.status} />

        {!isTerminal && nextStep && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={advanceStatus}
              disabled={advancing}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${nextStep.cls}`}
            >
              {advancing ? 'Сохранение...' : nextStep.label}
            </button>
          </div>
        )}
      </div>

      {/* ─── Meta info ──────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Информация</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-400">Дата назначения</span>
            <p className="text-gray-900 font-medium mt-0.5">{formatDate(order.ordered_at)}</p>
          </div>
          {order.patient?.birth_date && (
            <div>
              <span className="text-gray-400">Дата рождения пациента</span>
              <p className="text-gray-900 font-medium mt-0.5">{formatDate(order.patient.birth_date)}</p>
            </div>
          )}
          {order.doctor && (
            <div>
              <span className="text-gray-400">Лечащий врач</span>
              <p className="text-gray-900 font-medium mt-0.5">
                {order.doctor.last_name} {order.doctor.first_name}
              </p>
            </div>
          )}
          {order.external_lab_name && (
            <div>
              <span className="text-gray-400">Внешняя лаборатория</span>
              <p className="text-gray-900 font-medium mt-0.5">{order.external_lab_name}</p>
            </div>
          )}
          {order.notes && (
            <div className="sm:col-span-2">
              <span className="text-gray-400">Примечание</span>
              <p className="text-gray-700 italic mt-0.5">{order.notes}</p>
            </div>
          )}
          {order.rejected_reason && (
            <div className="sm:col-span-2">
              <span className="text-red-500">Причина отклонения</span>
              <p className="text-red-700 mt-0.5">{order.rejected_reason}</p>
            </div>
          )}
        </div>
      </div>

      {/* ─── Items ──────────────────────────────── */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Анализы ({items.length})
        </p>

        {items.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
            Анализы не добавлены
          </div>
        )}

        {items.map(item => {
          const result = item.result?.[0] ?? null
          const isCompleted = item.status === 'completed'
          const formOpen = openForms.has(item.id)

          return (
            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-900 truncate">{item.name}</span>
                  {item.price != null && (
                    <span className="text-xs text-gray-400 shrink-0">
                      {item.price.toLocaleString('ru-RU')} ₸
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isCompleted ? (
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                      ✓ Выполнен
                    </span>
                  ) : (
                    <button
                      onClick={() => toggleForm(item.id)}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium rounded-lg transition-colors"
                    >
                      {formOpen ? 'Скрыть' : 'Ввести результаты'}
                    </button>
                  )}
                </div>
              </div>

              {/* Result table if exists */}
              {result && (
                <ResultsTable result={result} />
              )}

              {/* Inline form if no result yet and form is open */}
              {!result && formOpen && (
                <ResultsForm
                  item={item}
                  clinicId={clinicId}
                  patientId={order.patient_id}
                  onSaved={() => {
                    closeForm(item.id)
                    load()
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* ─── Ready for verification CTA ─────────── */}
      {allCompleted && order.status === 'in_progress' && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-green-800">Все анализы выполнены</p>
            <p className="text-xs text-green-600 mt-0.5">Направление готово к верификации</p>
          </div>
          <button
            onClick={markReady}
            disabled={advancing}
            className="px-5 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
          >
            {advancing ? '...' : 'Готово к верификации'}
          </button>
        </div>
      )}
    </div>
  )
}
