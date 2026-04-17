'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface LabItem {
  id: string
  name: string
  price: number | null
  service_id?: string | null
  result_value?: number | string | null
  result_text?: string | null
  unit_snapshot?: string | null
  reference_min?: number | null
  reference_max?: number | null
  reference_text?: string | null
  flag?: 'normal' | 'low' | 'high' | 'critical' | null
}
interface LabOrder {
  id: string
  order_number: string | null
  patient_id: string
  visit_id: string | null
  doctor_id: string | null
  status: string
  urgent: boolean
  notes: string | null
  ordered_at: string
  sample_taken_at: string | null
  patient?: { id: string; full_name: string } | null
  doctor?: { id: string; first_name: string; last_name: string } | null
  items?: LabItem[]
}

const FLAG_CLR: Record<string, string> = {
  normal:   'text-green-700 bg-green-50',
  low:      'text-blue-700 bg-blue-50',
  high:     'text-orange-700 bg-orange-50',
  critical: 'text-red-700 bg-red-100 font-bold',
}
const FLAG_RU: Record<string, string> = {
  normal:   'Норма',
  low:      '↓ Низко',
  high:     '↑ Высоко',
  critical: '⚠ Критично',
}

function calcFlag(
  value: number,
  refMin: number | null | undefined,
  refMax: number | null | undefined,
): 'normal' | 'low' | 'high' {
  if (refMin != null && value < refMin) return 'low'
  if (refMax != null && value > refMax) return 'high'
  return 'normal'
}

interface PatientHit { id: string; full_name: string; phones: string[] }
interface Doctor     { id: string; first_name: string; last_name: string }
interface Template   { id: string; name: string; price: number | null }

const STATUS_CLR: Record<string, string> = {
  ordered:      'bg-gray-100 text-gray-600',
  agreed:       'bg-blue-50 text-blue-600',
  paid:         'bg-teal-100 text-teal-700',
  sample_taken: 'bg-yellow-100 text-yellow-700',
  in_progress:  'bg-blue-100 text-blue-700',
  rejected:     'bg-red-100 text-red-600',
  ready:        'bg-green-100 text-green-700',
  verified:     'bg-purple-100 text-purple-700',
  delivered:    'bg-gray-50 text-gray-400',
}
const STATUS_RU: Record<string, string> = {
  ordered:      'Назначен',
  agreed:       'Согласован',
  paid:         'Оплачен',
  sample_taken: 'Образец взят',
  in_progress:  'В работе',
  rejected:     'Отклонён',
  ready:        'Готово',
  verified:     'Верифицирован',
  delivered:    'Выдан',
}

/* ─── Status progression ─────────────────────────────────── */
const NEXT_STATUS: Record<string, { status: string; label: string; cls: string }> = {
  ordered:      { status: 'agreed',       label: 'Согласовать',    cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
  agreed:       { status: 'sample_taken', label: 'Образец взят',   cls: 'bg-teal-600 hover:bg-teal-700 text-white' },
  sample_taken: { status: 'in_progress',  label: 'В работу',       cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
  in_progress:  { status: 'ready',        label: '✓ Готово',       cls: 'bg-green-600 hover:bg-green-700 text-white' },
  ready:        { status: 'verified',     label: 'Верифицировать', cls: 'bg-purple-600 hover:bg-purple-700 text-white' },
  verified:     { status: 'delivered',    label: 'Выдать',         cls: 'bg-gray-600 hover:bg-gray-700 text-white' },
}

/* ─── Print lab report ────────────────────────────────────── */
function printLabReport(order: LabOrder, results: Record<string, string>) {
  const w = window.open('', '_blank', 'width=620,height=700')
  if (!w) return
  const dt = new Date(order.ordered_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const itemRows = (order.items ?? []).map(item => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${item.name}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;font-weight:600;color:#111">
        ${results[item.id] ?? '—'}
      </td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#888;font-size:11px">
        ${item.price != null ? item.price.toLocaleString('ru-RU') + ' ₸' : ''}
      </td>
    </tr>`).join('')
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Результаты анализов</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:560px;margin:24px auto;font-size:13px;color:#111}
    h2{margin:0 0 2px;font-size:18px}
    .sub{color:#777;font-size:12px;margin-bottom:16px;border-bottom:2px solid #111;padding-bottom:10px}
    .info{display:flex;gap:24px;margin-bottom:16px;font-size:12px;color:#555}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:6px 8px;background:#f5f5f5;font-size:11px;color:#666;border-bottom:2px solid #ddd;text-transform:uppercase;letter-spacing:.5px}
    .badge{display:inline-block;padding:2px 10px;border-radius:12px;background:#fef3c7;color:#b45309;font-size:11px;font-weight:600}
    .foot{margin-top:20px;font-size:10px;color:#ccc;border-top:1px dashed #ddd;padding-top:8px;text-align:center}
  </style></head><body>
  <h2>IN HEALTH — Результаты анализов</h2>
  <div class="sub">Лаборатория медицинского центра</div>
  <div class="info">
    <div><b>Пациент:</b> ${order.patient?.full_name ?? '—'}</div>
    <div><b>Дата:</b> ${dt}</div>
    ${order.doctor ? `<div><b>Врач:</b> ${order.doctor.last_name} ${order.doctor.first_name}</div>` : ''}
    ${order.urgent ? '<div class="badge">🔴 СРОЧНЫЙ</div>' : ''}
  </div>
  <table>
    <thead><tr><th>Анализ</th><th>Результат</th><th>Стоимость</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${order.notes ? `<p style="margin-top:12px;color:#555;font-size:12px"><b>Примечание:</b> ${order.notes}</p>` : ''}
  <div class="foot">Сформировано: ${new Date().toLocaleString('ru-RU')} &nbsp;·&nbsp; IN HEALTH Медицинский центр</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

/* ─── Order detail drawer ─────────────────────────────────── */
function OrderDrawer({ order, onClose, onUpdated }: {
  order: LabOrder
  onClose: () => void
  onUpdated: () => void
}) {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [saving, setSaving]       = useState(false)
  const [saveRes, setSaveRes]     = useState(false)
  const [takingSample, setTakingSample] = useState(false)
  const [results, setResults]     = useState<Record<string, string>>({})
  // Service refs map: service_id -> { unit, ref_min, ref_max, ref_text }
  const [svcRefs, setSvcRefs] = useState<Record<string, {
    unit: string | null; ref_min: number | null; ref_max: number | null; ref_text: string | null
  }>>({})

  // Pre-fill existing results; load service references
  useEffect(() => {
    const init: Record<string, string> = {}
    order.items?.forEach(item => {
      if (item.result_value != null) init[item.id] = String(item.result_value)
      else if (item.result_text) init[item.id] = item.result_text
    })
    setResults(init)

    const svcIds = (order.items ?? [])
      .map(i => i.service_id).filter((x): x is string => !!x)
    if (svcIds.length > 0) {
      supabase.from('services')
        .select('id, default_unit, reference_min, reference_max, reference_text')
        .in('id', svcIds)
        .then(({ data }) => {
          const m: typeof svcRefs = {}
          for (const r of (data ?? []) as Array<{
            id: string; default_unit: string | null;
            reference_min: number | null; reference_max: number | null;
            reference_text: string | null;
          }>) {
            m[r.id] = {
              unit: r.default_unit, ref_min: r.reference_min,
              ref_max: r.reference_max, ref_text: r.reference_text,
            }
          }
          setSvcRefs(m)
        })
    }
  }, [order.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const advance = async () => {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    setSaving(true)
    await supabase.from('lab_orders').update({ status: next.status }).eq('id', order.id)
    setSaving(false)
    onUpdated()
    onClose()
  }

  const takeSample = async () => {
    setTakingSample(true)
    const now = new Date().toISOString()
    // Create sample record
    await supabase.from('lab_samples').insert({
      lab_order_id: order.id,
      sample_type: 'blood',
      collected_at: now,
      collected_by: profile?.id ?? null,
      status: 'collected',
    })
    // Move status forward
    await supabase.from('lab_orders')
      .update({ status: 'sample_taken', sample_taken_at: now })
      .eq('id', order.id)
    setTakingSample(false)
    onUpdated()
    onClose()
  }

  const saveResults = async () => {
    setSaveRes(true)
    await Promise.all(
      (order.items ?? []).map(item => {
        const raw = (results[item.id] ?? '').trim()
        if (!raw) {
          return supabase.from('lab_order_items').update({
            result_value: null, result_text: null, flag: null,
            unit_snapshot: null, reference_min: null, reference_max: null,
          }).eq('id', item.id)
        }
        const num = Number(raw.replace(',', '.'))
        const isNum = !isNaN(num) && raw !== ''
        const refs = item.service_id ? svcRefs[item.service_id] : null
        const refMin = refs?.ref_min ?? null
        const refMax = refs?.ref_max ?? null
        const refText = refs?.ref_text ?? null
        const unit = refs?.unit ?? null
        const flag = isNum ? calcFlag(num, refMin, refMax) : null

        return supabase.from('lab_order_items').update({
          result_value:   isNum ? num : null,
          result_text:    isNum ? null : raw,
          unit_snapshot:  unit,
          reference_min:  refMin,
          reference_max:  refMax,
          reference_text: refText,
          flag,
          completed_at:   new Date().toISOString(),
          status:         'done',
        }).eq('id', item.id)
      })
    )
    setSaveRes(false)
    onUpdated()
  }

  const next = NEXT_STATUS[order.status]
  const hasResults = (order.items ?? []).length > 0

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md shadow-xl flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <p className="text-sm font-semibold text-gray-900">
              {order.order_number ?? 'Направление'}
            </p>
            {order.patient ? (
              <Link href={`/patients/${order.patient_id}`}
                className="text-xs text-blue-500 hover:text-blue-700 mt-0.5 block"
                onClick={onClose}>
                {order.patient.full_name} →
              </Link>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">—</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => printLabReport(order, results)}
              title="Печать результатов"
              className="text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
              🖨 Отчёт
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="p-5 flex-1 space-y-4">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_CLR[order.status] ?? ''}`}>
              {STATUS_RU[order.status] ?? order.status}
            </span>
            {order.urgent && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-600">
                🔴 СРОЧНЫЙ
              </span>
            )}
          </div>

          {/* Info */}
          <div className="space-y-2 text-sm">
            {order.doctor && (
              <div className="flex gap-2">
                <span className="text-gray-400 w-24 flex-shrink-0">Врач</span>
                <span className="text-gray-900">{order.doctor.last_name} {order.doctor.first_name}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-gray-400 w-24 flex-shrink-0">Дата</span>
              <span className="text-gray-900">
                {new Date(order.ordered_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
            {order.notes && (
              <div className="flex gap-2">
                <span className="text-gray-400 w-24 flex-shrink-0">Примечание</span>
                <span className="text-gray-700 italic">{order.notes}</span>
              </div>
            )}
          </div>

          {/* Items + Results entry */}
          {hasResults && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Анализы и результаты</p>
                <button
                  onClick={saveResults}
                  disabled={saveRes}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                  {saveRes ? 'Сохранение...' : '💾 Сохранить результаты'}
                </button>
              </div>
              <div className="space-y-2">
                {order.items!.map(item => {
                  const refs = item.service_id ? svcRefs[item.service_id] : null
                  const raw = results[item.id] ?? ''
                  const num = Number(raw.replace(',', '.'))
                  const isNum = !isNaN(num) && raw.trim() !== ''
                  const liveFlag = isNum
                    ? calcFlag(num, refs?.ref_min, refs?.ref_max)
                    : null
                  const refRange =
                    refs?.ref_min != null || refs?.ref_max != null
                      ? `${refs.ref_min ?? '—'} – ${refs.ref_max ?? '—'}`
                      : refs?.ref_text ?? '—'
                  return (
                    <div key={item.id} className="bg-gray-50 rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-gray-800 font-medium">{item.name}</span>
                        {item.price != null && (
                          <span className="text-xs text-gray-400">{item.price.toLocaleString('ru-RU')} ₸</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={raw}
                          onChange={e => setResults(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Результат"
                          className="flex-1 border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
                        />
                        {refs?.unit && (
                          <span className="text-xs text-gray-500 whitespace-nowrap">{refs.unit}</span>
                        )}
                        {liveFlag && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${FLAG_CLR[liveFlag]}`}>
                            {FLAG_RU[liveFlag]}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">Норма: {refRange}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 space-y-2">
          {/* Material taken — доступно пока не взят */}
          {!['sample_taken','in_progress','ready','verified','delivered'].includes(order.status) && (
            <button onClick={takeSample} disabled={takingSample}
              className="w-full py-2.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 transition-colors">
              {takingSample ? 'Сохранение...' : '🩸 Материал взят'}
            </button>
          )}
          {next && (
            <button onClick={advance} disabled={saving}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${next.cls}`}>
              {saving ? 'Сохранение...' : next.label}
            </button>
          )}
          {order.status === 'verified' && (
            <p className="text-[11px] text-center text-gray-400">
              ✓ Результаты сохранены в историю пациента
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Create order modal ──────────────────────────────────── */
function CreateOrderModal({ clinicId, onClose, onSaved }: {
  clinicId: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [query, setQuery]         = useState('')
  const [hits, setHits]           = useState<PatientHit[]>([])
  const [patient, setPatient]     = useState<PatientHit | null>(null)
  const [doctors, setDoctors]     = useState<Doctor[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [doctorId, setDoctorId]   = useState('')
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [urgent, setUrgent]       = useState(false)
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('doctors').select('id,first_name,last_name').eq('is_active', true).order('last_name'),
      supabase.from('lab_test_templates').select('id,name,price').eq('is_active', true).order('name').limit(100),
    ]).then(([d, t]) => {
      setDoctors(d.data ?? [])
      setTemplates(t.data ?? [])
    })
  }, [])

  const search = (q: string) => {
    setQuery(q); setPatient(null)
    if (debRef.current) clearTimeout(debRef.current)
    if (q.length < 2) { setHits([]); return }
    debRef.current = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id,full_name,phones').ilike('full_name', `%${q}%`).limit(6)
      setHits(data ?? [])
    }, 300)
  }

  const toggleTemplate = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patient)           { setError('Выберите пациента'); return }
    if (selected.size === 0){ setError('Выберите хотя бы один анализ'); return }
    setSaving(true); setError('')

    const { data: order, error: err } = await supabase
      .from('lab_orders')
      .insert({
        clinic_id:  clinicId,
        patient_id: patient.id,
        doctor_id:  doctorId || null,
        urgent,
        notes:      notes.trim() || null,
        status:     'ordered',
      })
      .select('id').single()

    if (err || !order) { setError(err?.message ?? 'Ошибка'); setSaving(false); return }

    const items = Array.from(selected).map(tid => {
      const t = templates.find(x => x.id === tid)!
      return { order_id: order.id, template_id: tid, name: t.name, price: t.price }
    })
    await supabase.from('lab_order_items').insert(items)

    onSaved(); onClose()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Новое направление</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Patient */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Пациент *</label>
            <input className={inp} placeholder="Поиск по ФИО…" value={query}
              onChange={e => search(e.target.value)} autoFocus />
            {hits.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {hits.map(p => (
                  <button key={p.id} type="button"
                    onClick={() => { setPatient(p); setQuery(p.full_name); setHits([]) }}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors">
                    <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                    {p.phones[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                  </button>
                ))}
              </div>
            )}
            {patient && <p className="text-xs text-green-600 mt-1">✓ {patient.full_name}</p>}
          </div>

          {/* Doctor */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Врач</label>
            <select className={inp} value={doctorId} onChange={e => setDoctorId(e.target.value)}>
              <option value="">— не указан —</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>{d.last_name} {d.first_name}</option>
              ))}
            </select>
          </div>

          {/* Templates */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Анализы * <span className="text-blue-600">({selected.size} выбрано)</span>
            </label>
            {templates.length === 0 ? (
              <p className="text-sm text-gray-400">Шаблоны не добавлены</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto divide-y divide-gray-50">
                {templates.map(t => (
                  <label key={t.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-blue-50 cursor-pointer transition-colors">
                    <input type="checkbox" checked={selected.has(t.id)}
                      onChange={() => toggleTemplate(t.id)}
                      className="rounded text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-gray-800 flex-1">{t.name}</span>
                    {t.price != null && <span className="text-xs text-gray-400">{t.price.toLocaleString('ru-RU')} ₸</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Urgent + Notes */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)}
                className="rounded text-red-500 focus:ring-red-400" />
              <span className="text-sm font-medium text-red-600">🔴 Срочный</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Примечание</label>
            <textarea className={inp + ' resize-none'} rows={2}
              value={notes} onChange={e => setNotes(e.target.value)} placeholder="Клинические данные…" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </form>

        <div className="px-6 pb-6 flex gap-3">
          <button type="button" onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
            Отмена
          </button>
          <button disabled={saving} onClick={handleSubmit as unknown as React.MouseEventHandler}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение...' : 'Создать направление'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────── */
export default function LabPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [orders, setOrders]     = useState<LabOrder[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState('active')
  const [selected, setSelected] = useState<LabOrder | null>(null)
  const [showCreate, setCreate] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    let q = supabase
      .from('lab_orders')
      .select('*, patient:patients(id,full_name), doctor:doctors(id,first_name,last_name), items:lab_order_items(id,name,price,service_id,result_value,result_text,unit_snapshot,reference_min,reference_max,reference_text,flag)')
      .order('ordered_at', { ascending: false })
      .limit(100)
    if (filter === 'active') q = q.in('status', ['ordered','agreed','paid','sample_taken','in_progress'])
    else if (filter === 'ready') q = q.in('status', ['ready','verified'])
    q.then(({ data }) => { setOrders((data ?? []) as LabOrder[]); setLoading(false) })
  }, [filter])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-4xl mx-auto">
      {showCreate && clinicId && (
        <CreateOrderModal clinicId={clinicId} onClose={() => setCreate(false)} onSaved={load} />
      )}
      {selected && (
        <OrderDrawer order={selected} onClose={() => setSelected(null)} onUpdated={load} />
      )}

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="flex gap-2">
          {[
            { key: 'active', label: 'Активные' },
            { key: 'ready',  label: 'Готовые' },
            { key: 'all',    label: 'Все' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={['px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                filter === f.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
              ].join(' ')}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{orders.length} направлений</span>
        <div className="flex-1" />
        <button onClick={() => setCreate(true)} disabled={!clinicId}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          + Направление
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Направлений нет</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">№ / Пациент</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Врач</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Анализы</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Дата</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} onClick={() => setSelected(o)}
                  className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors">
                  <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                    <Link href={`/patients/${o.patient_id}`}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline">
                      {o.patient?.full_name ?? '—'}
                    </Link>
                    {o.order_number && <p className="text-xs text-gray-400 font-mono mt-0.5">{o.order_number}</p>}
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-500">
                    {o.doctor ? `${o.doctor.last_name} ${o.doctor.first_name[0]}.` : '—'}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-500">
                    {(o.items ?? []).length > 0
                      ? (o.items!.length === 1
                          ? o.items![0].name
                          : `${o.items![0].name} +${o.items!.length - 1}`)
                      : '—'}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_CLR[o.status] ?? ''}`}>
                        {STATUS_RU[o.status] ?? o.status}
                      </span>
                      {o.urgent && <span className="text-xs text-red-500">🔴</span>}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-400">
                    {new Date(o.ordered_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
