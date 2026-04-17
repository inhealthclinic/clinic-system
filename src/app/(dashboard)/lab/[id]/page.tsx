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
  ref_gender?: {
    male?: { min: number; max: number }
    female?: { min: number; max: number }
  }
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

function calcFlagWithGender(
  value: string,
  param: Parameter,
  gender?: string | null,
): 'normal' | 'low' | 'high' | 'critical' {
  const v = parseFloat(value)
  if (isNaN(v)) return 'normal'

  // Use gender-specific ranges if available
  const genderRef =
    gender === 'male'
      ? param.ref_gender?.male
      : gender === 'female'
      ? param.ref_gender?.female
      : null
  const refMin = genderRef?.min ?? param.ref_min
  const refMax = genderRef?.max ?? param.ref_max

  if (
    (param.critical_low != null && v <= param.critical_low) ||
    (param.critical_high != null && v >= param.critical_high)
  ) {
    return 'critical'
  }
  if (refMin != null && v < refMin) return 'low'
  if (refMax != null && v > refMax) return 'high'
  return 'normal'
}

function getTATStatus(
  orderedAt: string,
  status: string,
): { label: string; cls: string } | null {
  if (['delivered', 'verified', 'ready'].includes(status)) return null
  const hours = (Date.now() - new Date(orderedAt).getTime()) / (1000 * 60 * 60)
  if (hours < 2)
    return { label: `${Math.floor(hours * 60)} мин`, cls: 'bg-green-100 text-green-700' }
  if (hours < 24)
    return { label: `${Math.floor(hours)} ч`, cls: 'bg-yellow-100 text-yellow-700' }
  return {
    label: `${Math.floor(hours / 24)} дн. просрочка`,
    cls: 'bg-red-100 text-red-700',
  }
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
  patientGender,
  onSaved,
}: {
  item: OrderItem
  clinicId: string
  patientId: string
  patientGender?: string | null
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
  const [prevResult, setPrevResult] = useState<ResultEntry[] | null>(null)

  useEffect(() => {
    if (!item.template_id) return
    supabase
      .from('lab_results')
      .select('results, completed_at')
      .eq('patient_id', patientId)
      .neq('order_item_id', item.id)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.results) setPrevResult(data.results as ResultEntry[])
      })
  }, [item.id])

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
      const flag = calcFlagWithGender(val, p, patientGender)
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
          const flag = val !== '' ? calcFlagWithGender(val, p, patientGender) : null
          const prevVal = prevResult?.find(r => r.parameter === p.name)
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
                {prevVal && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    Пред.:{' '}
                    <span className={`font-medium ${FLAG_CLR[prevVal.flag] ?? 'text-gray-600'}`}>
                      {prevVal.value}
                    </span>
                    {val !== '' && !isNaN(parseFloat(val)) && !isNaN(parseFloat(prevVal.value))
                      ? parseFloat(val) > parseFloat(prevVal.value)
                        ? ' ↑'
                        : parseFloat(val) < parseFloat(prevVal.value)
                        ? ' ↓'
                        : ''
                      : ''}
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
function ResultsTable({
  result,
  prevResults,
}: {
  result: LabResult
  prevResults?: ResultEntry[] | null
}) {
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
              <th className="text-left text-xs font-medium text-gray-400 px-4 py-2.5">Δ Пред.</th>
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
                <td className="px-4 py-2.5 text-xs">
                  {(() => {
                    const prev = prevResults?.find(p => p.parameter === r.parameter)
                    if (!prev || !prev.value || !r.value)
                      return <span className="text-gray-300">—</span>
                    const diff = parseFloat(r.value) - parseFloat(prev.value)
                    if (isNaN(diff)) return <span className="text-gray-300">—</span>
                    return (
                      <span
                        className={
                          diff > 0
                            ? 'text-orange-500'
                            : diff < 0
                            ? 'text-blue-500'
                            : 'text-gray-400'
                        }
                      >
                        {diff > 0 ? '+' : ''}
                        {diff.toFixed(1)} {diff !== 0 ? (diff > 0 ? '↑' : '↓') : ''}
                        <div className="text-gray-300">{prev.value}</div>
                      </span>
                    )
                  })()}
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

/* ─── ЛИС: нативные функции ─────────────────────────────────── */

// Печать бланка результатов (ЛИС-функция)
function printLabReport(order: LabOrder) {
  const date = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const items = order.items ?? []
  const rows = items.map(item => {
    const result = item.result?.[0]
    if (!result) {
      return `<tr><td colspan="5" style="padding:8px;color:#9ca3af;font-style:italic">${item.name} — результат не введён</td></tr>`
    }
    const entries: ResultEntry[] = Array.isArray(result.results) ? result.results as ResultEntry[] : []
    return entries.map(e => {
      const flagColor: Record<string, string> = {
        normal: '#16a34a', low: '#2563eb', high: '#ea580c', critical: '#dc2626'
      }
      const flagLabel: Record<string, string> = { normal: 'N', low: '↓', high: '↑', critical: '!!!' }
      const color = e.flag ? flagColor[e.flag] : '#111'
      const flag  = e.flag ? flagLabel[e.flag] : ''
      const ref   = e.ref_min != null && e.ref_max != null ? `${e.ref_min} – ${e.ref_max}` : '—'
      return `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid #f3f4f6">${e.parameter || item.name}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #f3f4f6;font-weight:600;color:${color}">${e.value}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280">${e.unit ?? '—'}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #f3f4f6;color:#6b7280">${ref}</td>
        <td style="padding:7px 8px;border-bottom:1px solid #f3f4f6;font-weight:700;color:${color}">${flag}</td>
      </tr>`
    }).join('')
  }).join('')

  const doctor = order.doctor ? `${order.doctor.last_name} ${order.doctor.first_name}` : '—'
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Результаты анализов · ${order.order_number ?? ''}</title>
    <style>body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:32px;max-width:720px;margin:auto} h2{margin:0 0 4px} table{width:100%;border-collapse:collapse;margin-top:12px} th{text-align:left;padding:8px;background:#f9fafb;font-size:11px;color:#6b7280;border-bottom:2px solid #e5e7eb} .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px} .footer{margin-top:32px;display:flex;justify-content:space-between;border-top:1px solid #e5e7eb;padding-top:16px}</style>
  </head><body>
    <h2>РЕЗУЛЬТАТЫ ЛАБОРАТОРНЫХ ИССЛЕДОВАНИЙ</h2>
    <p style="color:#6b7280;font-size:12px;margin:0 0 16px">№ ${order.order_number ?? '—'} · ${date}${order.urgent ? ' · <span style="color:#dc2626;font-weight:700">СРОЧНЫЙ</span>' : ''}</p>
    <div style="margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">
      <div><span style="color:#6b7280">Пациент:</span> <strong>${order.patient?.full_name ?? '—'}</strong></div>
      <div><span style="color:#6b7280">Врач:</span> ${doctor}</div>
      ${order.patient?.birth_date ? `<div><span style="color:#6b7280">Дата рожд.:</span> ${new Date(order.patient.birth_date).toLocaleDateString('ru-RU')}</div>` : ''}
      ${order.patient?.gender ? `<div><span style="color:#6b7280">Пол:</span> ${order.patient.gender === 'male' ? 'М' : 'Ж'}</div>` : ''}
    </div>
    <table>
      <thead><tr>
        <th>Показатель</th><th>Результат</th><th>Ед. изм.</th><th>Референс</th><th>Флаг</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">
      <div style="font-size:12px;color:#6b7280">Верифицировал: _________________</div>
      <div style="font-size:12px;color:#6b7280">Дата выдачи: ${date}</div>
    </div>
  </body></html>`

  const w = window.open('', '_blank', 'width=760,height=700')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

// Печать этикетки пробирки (ЛИС-функция)
function printSampleLabel(order: LabOrder) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Этикетка</title>
    <style>body{font-family:Arial,sans-serif;margin:0;padding:12px} .label{border:2px solid #111;border-radius:6px;padding:10px;width:260px;font-size:11px} .num{font-size:16px;font-weight:700;letter-spacing:2px;font-family:monospace} .barcode{font-family:'Libre Barcode 39',monospace;font-size:32px;letter-spacing:4px;margin:6px 0}</style>
  </head><body>
    <div class="label">
      <div class="num">${order.order_number ?? order.id.slice(0, 8).toUpperCase()}</div>
      <div class="barcode">*${(order.order_number ?? order.id.slice(0, 8)).replace(/[^A-Z0-9]/gi, '')}*</div>
      <div><strong>${order.patient?.full_name ?? '—'}</strong></div>
      <div style="color:#6b7280">${order.patient?.birth_date ? new Date(order.patient.birth_date).toLocaleDateString('ru-RU') : ''}</div>
      <div style="margin-top:6px;font-size:10px">${new Date().toLocaleDateString('ru-RU')} ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
      ${order.urgent ? '<div style="color:#dc2626;font-weight:700;margin-top:4px">⚡ СРОЧНО</div>' : ''}
    </div>
    <script>window.onload=()=>{window.print()}</script>
  </body></html>`

  const w = window.open('', '_blank', 'width=340,height=260')
  if (!w) return
  w.document.write(html)
  w.document.close()
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
  const [prevResultsMap, setPrevResultsMap] = useState<Record<string, ResultEntry[]>>({})

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
      setLoading(false)
      return
    }

    const loadedOrder = data as unknown as LabOrder
    setOrder(loadedOrder)

    // Load previous results for each item with a template
    const items: OrderItem[] = loadedOrder.items ?? []
    const prevPromises = items
      .filter(i => i.template_id)
      .map(async (i) => {
        const { data: prevData } = await supabase
          .from('lab_results')
          .select('results, completed_at, order_item_id')
          .eq('patient_id', loadedOrder.patient_id)
          .neq('order_id', loadedOrder.id)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (prevData) {
          setPrevResultsMap(prev => ({
            ...prev,
            [i.id]: prevData.results as ResultEntry[],
          }))
        }
      })
    await Promise.all(prevPromises)

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
            {(() => {
              const tat = getTATStatus(order.ordered_at, order.status)
              return tat ? (
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${tat.cls}`}>
                  ⏱ {tat.label}
                </span>
              ) : null
            })()}
          </div>
          {order.patient && (
            <p className="text-sm text-gray-500 mt-0.5">{order.patient.full_name}</p>
          )}
        </div>
        {/* ЛИС: кнопки печати */}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button
            onClick={() => printLabReport(order)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
            title="Распечатать бланк результатов"
          >
            🖨 Результаты
          </button>
          <button
            onClick={() => printSampleLabel(order)}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
            title="Распечатать этикетку пробирки"
          >
            🏷 Этикетка
          </button>
        </div>
      </div>

      {/* ЛИС: баннер критических значений */}
      {(() => {
        const criticals = (order.items ?? []).filter(item => {
          const results: ResultEntry[] = (item.result?.[0]?.results ?? []) as ResultEntry[]
          return results.some(r => r.flag === 'critical')
        })
        if (!criticals.length) return null
        return (
          <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
            <span className="text-xl flex-shrink-0">⚠️</span>
            <div>
              <p className="text-sm font-semibold text-red-800">Критические значения!</p>
              <p className="text-xs text-red-600 mt-0.5">
                {criticals.map(i => i.name).join(', ')} — требуют немедленного внимания врача
              </p>
            </div>
          </div>
        )
      })()}

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
                <ResultsTable result={result} prevResults={prevResultsMap[item.id]} />
              )}

              {/* Inline form if no result yet and form is open */}
              {!result && formOpen && (
                <ResultsForm
                  item={item}
                  clinicId={clinicId}
                  patientId={order.patient_id}
                  patientGender={order.patient?.gender}
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
