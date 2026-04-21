'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
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
  result_entered_at?: string | null
  result_entered_by?: string | null
  verified_at?: string | null
  verified_by?: string | null
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
  verified_at?: string | null
  verified_by?: string | null
  // Snapshot (filled at creation time)
  patient_name_snapshot?: string | null
  sex_snapshot?: 'male' | 'female' | 'other' | null
  age_snapshot?: number | null
  pregnancy_snapshot?: 'yes' | 'no' | 'unknown' | null
  pregnancy_weeks_snapshot?: number | null
  lab_notes_snapshot?: string | null
  menopause_snapshot?: 'no' | 'peri' | 'post' | 'unknown' | null
  fasting_snapshot?: 'yes' | 'no' | 'unknown' | null
  taking_medications_snapshot?: 'yes' | 'no' | 'unknown' | null
  medications_note_snapshot?: string | null
  cycle_day_snapshot?: number | null
  patient?: { id: string; full_name: string } | null
  doctor?: { id: string; first_name: string; last_name: string } | null
  items?: LabItem[]
  samples?: Array<{ id: string; sample_type: string; collected_at: string; status: string }>
}

const SAMPLE_TYPES = ['blood','urine','stool','smear','saliva','other'] as const
const SAMPLE_TYPE_RU: Record<string, string> = {
  blood:  'Кровь',
  urine:  'Моча',
  stool:  'Кал',
  smear:  'Мазок',
  saliva: 'Слюна',
  other:  'Другое',
}
const SAMPLE_TYPE_ICON: Record<string, string> = {
  blood:  '🩸',
  urine:  '🧴',
  stool:  '💩',
  smear:  '🧫',
  saliva: '💧',
  other:  '🧪',
}
const SAMPLE_STATUS_RU: Record<string, string> = {
  pending:   'ожидает',
  collected: 'взят',
  rejected:  'отклонён',
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

/* ─── Reference-range types & picker ─────────────────────── */
interface RefRange {
  id: string
  service_id: string
  label: string | null
  sex: 'M' | 'F' | null
  age_min: number | null
  age_max: number | null
  pregnant: boolean | null
  min_value: number | null
  max_value: number | null
  text: string | null
  unit: string | null
}

function ageFromBirth(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null
  const now = new Date()
  const b = new Date(birthDate)
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

function mapSex(g: string | null | undefined): 'M' | 'F' | null {
  if (g === 'male') return 'M'
  if (g === 'female') return 'F'
  return null
}

function describeRange(r: RefRange): string {
  if (r.label) return r.label
  const parts: string[] = []
  if (r.sex === 'M') parts.push('♂')
  else if (r.sex === 'F') parts.push('♀')
  if (r.age_min != null || r.age_max != null) {
    parts.push(`${r.age_min ?? 0}–${r.age_max ?? '∞'} л.`)
  }
  if (r.pregnant === true) parts.push('🤰')
  return parts.join(' ') || 'группа'
}

function pickRange(
  ranges: RefRange[],
  patSex: 'M' | 'F' | null,
  patAge: number | null,
  isPregnant: boolean,
): RefRange | null {
  const eligible = ranges.filter(r => {
    if (r.sex != null && patSex != null && r.sex !== patSex) return false
    if (r.age_min != null && patAge != null && patAge < r.age_min) return false
    if (r.age_max != null && patAge != null && patAge > r.age_max) return false
    if (r.pregnant === true && !isPregnant) return false
    if (r.pregnant === false && isPregnant) return false
    return true
  })
  if (eligible.length === 0) return null
  const score = (r: RefRange) =>
    (r.sex ? 2 : 0) +
    (r.pregnant != null ? 2 : 0) +
    (r.age_min != null ? 1 : 0) +
    (r.age_max != null ? 1 : 0)
  return eligible.slice().sort((a, b) => score(b) - score(a))[0]
}

interface PatientHit {
  id: string
  full_name: string
  phones: string[]
  gender?: 'male' | 'female' | 'other' | null
  birth_date?: string | null
  pregnancy_status?: 'yes' | 'no' | 'unknown' | null
  pregnancy_weeks?: number | null
  menopause_status?: 'no' | 'peri' | 'post' | null
  lab_notes?: string | null
}
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
function printLabReport(
  order: LabOrder,
  results: Record<string, string>,
  svcRefs: Record<string, {
    unit: string | null; ref_min: number | null; ref_max: number | null; ref_text: string | null
  }>,
) {
  const w = window.open('', '_blank', 'width=720,height=900')
  if (!w) return
  const dt = new Date(order.ordered_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const flagColor: Record<string, string> = {
    normal:   '#047857',
    low:      '#1d4ed8',
    high:     '#c2410c',
    critical: '#b91c1c',
  }
  const flagLbl: Record<string, string> = {
    normal: 'норма', low: '↓ низко', high: '↑ высоко', critical: '⚠ критично',
  }
  const itemRows = (order.items ?? []).map(item => {
    const refs = item.service_id ? svcRefs[item.service_id] : null
    const raw = results[item.id] ?? ''
    const num = Number(raw.replace(',', '.'))
    const isNum = !isNaN(num) && raw.trim() !== ''
    const flag = isNum ? calcFlag(num, refs?.ref_min, refs?.ref_max) : null
    const unit = item.unit_snapshot ?? refs?.unit ?? ''
    const refRange =
      refs?.ref_min != null || refs?.ref_max != null
        ? `${refs?.ref_min ?? '—'}–${refs?.ref_max ?? '—'}`
        : (refs?.ref_text ?? item.reference_text ?? '—')
    const color = flag ? flagColor[flag] : '#111'
    return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee">${item.name}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:700;color:${color};white-space:nowrap">
          ${raw || '—'}${unit ? ' <span style="font-weight:400;color:#666">' + unit + '</span>' : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#666;font-size:11px;white-space:nowrap">
          ${refRange}${unit && refRange !== '—' ? ' ' + unit : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;font-size:11px;color:${color};font-weight:${flag && flag !== 'normal' ? '700' : '400'}">
          ${flag ? flagLbl[flag] : ''}
        </td>
      </tr>`
  }).join('')
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Результаты анализов</title>
  <style>
    @page { size: A4; margin: 18mm 14mm }
    body{font-family:Arial,sans-serif;max-width:640px;margin:24px auto;font-size:13px;color:#111}
    h2{margin:0 0 2px;font-size:18px}
    .sub{color:#777;font-size:12px;margin-bottom:16px;border-bottom:2px solid #111;padding-bottom:10px}
    .info{display:flex;flex-wrap:wrap;gap:18px;margin-bottom:18px;font-size:12px;color:#444}
    .info b{color:#111}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:8px 10px;background:#f5f5f5;font-size:11px;color:#666;border-bottom:2px solid #ddd;text-transform:uppercase;letter-spacing:.5px}
    .badge{display:inline-block;padding:2px 10px;border-radius:12px;background:#fef3c7;color:#b45309;font-size:11px;font-weight:600}
    .sig{margin-top:36px;display:flex;justify-content:space-between;font-size:12px;color:#555}
    .sig-line{border-top:1px solid #999;padding-top:4px;min-width:200px;text-align:center}
    .foot{margin-top:20px;font-size:10px;color:#aaa;border-top:1px dashed #ddd;padding-top:8px;text-align:center}
    @media print { .no-print { display:none } }
  </style></head><body>
  <h2>IN HEALTH — Результаты анализов</h2>
  <div class="sub">Лаборатория медицинского центра</div>
  <div class="info">
    <div><b>Пациент:</b> ${order.patient_name_snapshot ?? order.patient?.full_name ?? '—'}</div>
    ${order.sex_snapshot ? `<div><b>Пол:</b> ${order.sex_snapshot === 'male' ? 'М' : order.sex_snapshot === 'female' ? 'Ж' : '—'}</div>` : ''}
    ${order.age_snapshot != null ? `<div><b>Возраст:</b> ${order.age_snapshot} лет</div>` : ''}
    ${order.pregnancy_snapshot === 'yes' ? `<div style="color:#be185d"><b>Беременность:</b> ${order.pregnancy_weeks_snapshot ? order.pregnancy_weeks_snapshot + ' нед.' : 'да'}</div>` : ''}
    ${order.menopause_snapshot && order.menopause_snapshot !== 'no' && order.menopause_snapshot !== 'unknown' ? `<div><b>Менопауза:</b> ${order.menopause_snapshot === 'peri' ? 'пери' : 'пост'}</div>` : ''}
    ${order.cycle_day_snapshot != null ? `<div><b>День цикла:</b> ${order.cycle_day_snapshot}</div>` : ''}
    ${order.fasting_snapshot === 'yes' ? '<div><b>Натощак:</b> да</div>' : order.fasting_snapshot === 'no' ? '<div style="color:#b45309"><b>Натощак:</b> нет</div>' : ''}
    ${order.taking_medications_snapshot === 'yes' ? `<div style="color:#b45309"><b>Приём лекарств:</b> ${order.medications_note_snapshot ? order.medications_note_snapshot : 'да'}</div>` : ''}
    <div><b>Дата:</b> ${dt}</div>
    ${order.doctor ? `<div><b>Врач:</b> ${order.doctor.last_name} ${order.doctor.first_name}</div>` : ''}
    ${order.order_number ? `<div><b>№:</b> ${order.order_number}</div>` : ''}
    ${order.urgent ? '<div class="badge">🔴 СРОЧНЫЙ</div>' : ''}
  </div>
  ${order.lab_notes_snapshot ? `<div style="margin:-8px 0 14px;padding:8px 12px;background:#fef3c7;border-left:3px solid #f59e0b;font-size:12px;color:#92400e"><b>⚠ Лаб. примечания:</b> ${order.lab_notes_snapshot}</div>` : ''}
  <table>
    <thead>
      <tr>
        <th style="width:44%">Анализ</th>
        <th style="width:22%">Результат</th>
        <th style="width:22%">Норма</th>
        <th style="width:12%">Флаг</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  ${order.notes ? `<p style="margin-top:14px;color:#555;font-size:12px"><b>Примечание:</b> ${order.notes}</p>` : ''}
  <div class="sig">
    <div class="sig-line">Лаборант (подпись)</div>
    <div class="sig-line">Врач лаборатории (подпись)</div>
  </div>
  <div class="foot">Сформировано: ${new Date().toLocaleString('ru-RU')} &nbsp;·&nbsp; IN HEALTH Медицинский центр</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

/* ─── Sample collection modal ─────────────────────────────── */
function SampleCollectionModal({
  orderNumber, patientName, saving, onCancel, onConfirm,
}: {
  orderNumber: string | null
  patientName: string | null
  saving: boolean
  onCancel: () => void
  onConfirm: (sampleType: string, comment: string) => void
}) {
  const [sampleType, setSampleType] = useState<typeof SAMPLE_TYPES[number]>('blood')
  const [comment, setComment]       = useState('')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => !saving && onCancel()} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">
        <div className="px-5 py-4 border-b border-teal-100 bg-teal-50 flex items-center gap-2">
          <span className="text-lg">🩸</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Забор материала</h3>
            <p className="text-[11px] text-teal-700 mt-0.5 truncate">
              {orderNumber ?? 'Направление'}
              {patientName ? ` · ${patientName}` : ''}
            </p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              Тип материала
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SAMPLE_TYPES.map(t => {
                const active = sampleType === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSampleType(t)}
                    className={`px-2 py-2.5 rounded-lg text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-teal-300 hover:bg-teal-50'
                    }`}
                  >
                    <div className="text-base leading-none mb-1">{SAMPLE_TYPE_ICON[t]}</div>
                    {SAMPLE_TYPE_RU[t]}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Комментарий <span className="text-gray-400 font-normal">(необязательно)</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={2}
              placeholder="например: гемолиз, вторичная проба, натощак…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none resize-none"
            />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-60 text-gray-700 rounded-lg py-2.5 text-sm font-medium transition-colors">
            Отмена
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onConfirm(sampleType, comment)}
            className="flex-1 bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [userMap, setUserMap] = useState<Record<string, string>>({})
  const [sampleModalOpen, setSampleModalOpen] = useState(false)
  const [samples, setSamples] = useState<Array<{
    id: string
    sample_type: string
    collected_at: string
    status: string
    comment: string | null
  }>>([])
  const [results, setResults]     = useState<Record<string, string>>({})

  // Patient demographics from snapshot (or live fallback)
  const patSex = useMemo(() => mapSex(order.sex_snapshot), [order.sex_snapshot])
  const patAge = order.age_snapshot ?? null
  const patPregnancyFromSnapshot = order.pregnancy_snapshot === 'yes'
  const [isPregnant, setIsPregnant] = useState(patPregnancyFromSnapshot)
  const [liveSex, setLiveSex] = useState<'M' | 'F' | null>(null)
  const [liveAge, setLiveAge] = useState<number | null>(null)
  const effectiveSex = patSex ?? liveSex
  const effectiveAge = patAge ?? liveAge

  // Demographic-nuance editor (for "forgot to mark pregnancy" cases)
  const [demoEditOpen, setDemoEditOpen] = useState(false)
  const [demoPreg, setDemoPreg]         = useState<'yes' | 'no' | 'unknown'>(order.pregnancy_snapshot ?? 'unknown')
  const [demoPregWeeks, setDemoPregWeeks] = useState<string>(order.pregnancy_weeks_snapshot != null ? String(order.pregnancy_weeks_snapshot) : '')
  const [demoMeno, setDemoMeno]         = useState<'no' | 'peri' | 'post' | ''>('')
  const [demoNotes, setDemoNotes]       = useState<string>(order.lab_notes_snapshot ?? '')
  const [demoSaving, setDemoSaving]     = useState(false)

  // Load menopause_status from patient card when opening the editor
  // (not stored in order snapshot because it's slow-changing).
  useEffect(() => {
    if (!demoEditOpen) return
    supabase.from('patients')
      .select('menopause_status')
      .eq('id', order.patient_id).maybeSingle()
      .then(({ data }) => {
        setDemoMeno(((data as { menopause_status?: 'no' | 'peri' | 'post' | null })?.menopause_status) ?? '')
      })
  }, [demoEditOpen, order.patient_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Per-service: default + all demographic ranges
  const [svcData, setSvcData] = useState<Record<string, {
    defaultUnit: string | null
    defaultMin: number | null
    defaultMax: number | null
    defaultText: string | null
    ranges: RefRange[]
  }>>({})

  // Pre-fill existing results; load patient + service refs + reference_ranges
  useEffect(() => {
    const init: Record<string, string> = {}
    order.items?.forEach(item => {
      if (item.result_value != null) init[item.id] = String(item.result_value)
      else if (item.result_text) init[item.id] = item.result_text
    })
    setResults(init)

    // Fallback: for legacy orders without snapshot, fetch live patient
    if (order.sex_snapshot == null || order.age_snapshot == null) {
      supabase.from('patients')
        .select('gender, birth_date')
        .eq('id', order.patient_id)
        .single()
        .then(({ data }) => {
          if (data) {
            setLiveSex(mapSex((data as { gender: string }).gender))
            setLiveAge(ageFromBirth((data as { birth_date: string | null }).birth_date))
          }
        })
    }

    const svcIds = (order.items ?? [])
      .map(i => i.service_id).filter((x): x is string => !!x)
    if (svcIds.length > 0) {
      Promise.all([
        supabase.from('services')
          .select('id, default_unit, reference_min, reference_max, reference_text')
          .in('id', svcIds),
        supabase.from('reference_ranges')
          .select('*')
          .in('service_id', svcIds),
      ]).then(([svcRes, rngRes]) => {
        const m: typeof svcData = {}
        for (const r of (svcRes.data ?? []) as Array<{
          id: string; default_unit: string | null;
          reference_min: number | null; reference_max: number | null;
          reference_text: string | null;
        }>) {
          m[r.id] = {
            defaultUnit: r.default_unit,
            defaultMin: r.reference_min,
            defaultMax: r.reference_max,
            defaultText: r.reference_text,
            ranges: [],
          }
        }
        for (const r of (rngRes.data ?? []) as RefRange[]) {
          if (!m[r.service_id]) {
            m[r.service_id] = { defaultUnit: null, defaultMin: null, defaultMax: null, defaultText: null, ranges: [] }
          }
          m[r.service_id].ranges.push(r)
        }
        setSvcData(m)
      })
    }
  }, [order.id, order.patient_id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Derived svcRefs: picks best-matching range per service (with pregnancy toggle)
  const svcRefs = useMemo(() => {
    const m: Record<string, {
      unit: string | null
      ref_min: number | null
      ref_max: number | null
      ref_text: string | null
      label: string | null  // null = default (no specific range matched)
    }> = {}
    for (const [sid, d] of Object.entries(svcData)) {
      const picked = pickRange(d.ranges, effectiveSex, effectiveAge, isPregnant)
      if (picked) {
        m[sid] = {
          unit: picked.unit ?? d.defaultUnit,
          ref_min: picked.min_value,
          ref_max: picked.max_value,
          ref_text: picked.text ?? d.defaultText,
          label: describeRange(picked),
        }
      } else {
        m[sid] = {
          unit: d.defaultUnit,
          ref_min: d.defaultMin,
          ref_max: d.defaultMax,
          ref_text: d.defaultText,
          label: null,
        }
      }
    }
    return m
  }, [svcData, effectiveSex, effectiveAge, isPregnant])

  const advance = async () => {
    const next = NEXT_STATUS[order.status]
    if (!next) return
    // Safety: verifying an order copies items to patient_lab_results. Warn if
    // some items still have no result entered.
    if (next.status === 'verified') {
      const items = order.items ?? []
      const empty = items.filter(i => {
        const raw = (results[i.id] ?? '').trim()
        const hasDb = i.result_value != null || (i.result_text && i.result_text.length > 0)
        return !raw && !hasDb
      })
      if (empty.length > 0) {
        const names = empty.map(i => i.name).join(', ')
        const ok = window.confirm(
          `У ${empty.length} из ${items.length} анализов нет результата:\n${names}\n\nВсё равно верифицировать? В историю пациента попадут только заполненные.`
        )
        if (!ok) return
      }
    }
    setSaving(true)
    const now = new Date().toISOString()
    // При верификации — штампуем verified_at/by на все items,
    // у которых есть введённый результат и нет уже проставленной верификации.
    if (next.status === 'verified') {
      const toVerify = (order.items ?? []).filter(i => {
        if (i.verified_at) return false
        const hasDb = i.result_value != null || (i.result_text && i.result_text.length > 0)
        const raw = (results[i.id] ?? '').trim()
        return hasDb || raw.length > 0
      })
      if (toVerify.length > 0) {
        await Promise.all(toVerify.map(i =>
          supabase.from('lab_order_items').update({
            verified_at: now,
            verified_by: profile?.id ?? null,
          }).eq('id', i.id)
        ))
      }
    }
    const orderPatch: Record<string, unknown> = { status: next.status }
    // Штампуем дату готовности при первом переходе в ready/verified
    if ((next.status === 'ready' || next.status === 'verified') && !order.verified_at) {
      orderPatch.verified_at = now
      orderPatch.verified_by = profile?.id ?? null
    }
    await supabase.from('lab_orders').update(orderPatch).eq('id', order.id)
    setSaving(false)
    onUpdated()
    onClose()
  }

  const loadSamples = useCallback(async () => {
    const { data } = await supabase.from('lab_samples')
      .select('id, sample_type, collected_at, status, comment')
      .eq('lab_order_id', order.id)
      .order('collected_at', { ascending: false })
    setSamples((data ?? []) as Array<{
      id: string; sample_type: string; collected_at: string;
      status: string; comment: string | null;
    }>)
  }, [order.id, supabase])

  useEffect(() => { loadSamples() }, [loadSamples])

  // Подгружаем имена тех, кто вводил/верифицировал результаты
  useEffect(() => {
    const ids = new Set<string>()
    ;(order.items ?? []).forEach(i => {
      if (i.result_entered_by) ids.add(i.result_entered_by)
      if (i.verified_by)       ids.add(i.verified_by)
    })
    if (ids.size === 0) return
    supabase.from('user_profiles')
      .select('id, full_name')
      .in('id', Array.from(ids))
      .then(({ data }) => {
        const m: Record<string, string> = {}
        for (const u of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
          if (u.full_name) m[u.id] = u.full_name
        }
        setUserMap(m)
      })
  }, [order.items, supabase])

  const confirmTakeSample = async (sampleType: string, comment: string) => {
    setTakingSample(true)
    const now = new Date().toISOString()
    // Create sample record
    const { error: insErr } = await supabase.from('lab_samples').insert({
      lab_order_id:  order.id,
      clinic_id:     profile?.clinic_id ?? null,
      sample_type:   sampleType,
      collected_at:  now,
      collected_by:  profile?.id ?? null,
      status:        'collected',
      comment:       comment.trim() || null,
    })
    if (insErr) {
      setTakingSample(false)
      alert(`Не удалось сохранить образец: ${insErr.message}`)
      return
    }
    // Move status forward only if order is still in pre-sample phase
    if (!['sample_taken','in_progress','ready','verified','delivered'].includes(order.status)) {
      await supabase.from('lab_orders')
        .update({ status: 'sample_taken', sample_taken_at: now })
        .eq('id', order.id)
    }
    setTakingSample(false)
    setSampleModalOpen(false)
    await loadSamples()
    onUpdated()
  }

  const saveResults = async () => {
    setSaveRes(true)
    const now = new Date().toISOString()
    await Promise.all(
      (order.items ?? []).map(item => {
        const raw = (results[item.id] ?? '').trim()
        // Нельзя править уже верифицированный результат
        if (item.verified_at) return Promise.resolve({ error: null })
        if (!raw) {
          // Очистка черновика — снять штамп ввода тоже
          return supabase.from('lab_order_items').update({
            result_value: null, result_text: null, flag: null,
            unit_snapshot: null, reference_min: null, reference_max: null,
            result_entered_at: null, result_entered_by: null,
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
          result_value:      isNum ? num : null,
          result_text:       isNum ? null : raw,
          unit_snapshot:     unit,
          reference_min:     refMin,
          reference_max:     refMax,
          reference_text:    refText,
          flag,
          completed_at:      now,
          status:            'done',
          result_entered_at: now,
          result_entered_by: profile?.id ?? null,
        }).eq('id', item.id)
      })
    )
    setSaveRes(false)
    onUpdated()
  }

  const next = NEXT_STATUS[order.status]
  const hasResults = (order.items ?? []).length > 0
  const locked = order.status === 'verified' || order.status === 'delivered'

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
              onClick={() => printLabReport(order, results, svcRefs)}
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

          {/* Patient snapshot block */}
          <div className="bg-gradient-to-br from-blue-50 to-blue-50/40 border border-blue-100 rounded-lg px-4 py-3 space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="text-gray-500 text-xs flex-shrink-0 mt-0.5">Пациент:</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {order.patient_name_snapshot ?? order.patient?.full_name ?? '—'}
                </p>
                <p className="text-xs text-gray-600 mt-0.5">
                  {effectiveSex === 'F' ? '♀ Ж' : effectiveSex === 'M' ? '♂ М' : '—'}
                  {effectiveAge != null ? ` · ${effectiveAge} лет` : ''}
                  {order.pregnancy_snapshot === 'yes' && (
                    <span className="text-pink-700 font-medium ml-1">
                      · 🤰 беременна{order.pregnancy_weeks_snapshot ? ` (${order.pregnancy_weeks_snapshot} нед.)` : ''}
                    </span>
                  )}
                </p>
              </div>
              {!locked && (
                <button
                  type="button"
                  onClick={() => setDemoEditOpen(true)}
                  title="Исправить демографию (беременность/примечания)"
                  className="text-[11px] text-blue-600 hover:text-blue-700 hover:bg-blue-100 px-2 py-1 rounded-md flex items-center gap-1 flex-shrink-0"
                >
                  <svg width="11" height="11" fill="none" viewBox="0 0 24 24">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  Изменить
                </button>
              )}
            </div>
            {order.lab_notes_snapshot && (
              <div className="flex items-start gap-2 pt-1.5 border-t border-blue-100">
                <span className="text-xs flex-shrink-0 mt-0.5">📝</span>
                <p className="text-xs text-amber-900 italic flex-1">{order.lab_notes_snapshot}</p>
              </div>
            )}
            {effectiveSex === 'F' && (
              <label className="flex items-center gap-2 cursor-pointer pt-1.5 border-t border-blue-100">
                <input
                  type="checkbox"
                  checked={isPregnant}
                  onChange={e => setIsPregnant(e.target.checked)}
                  className="accent-blue-600"
                />
                <span className="text-xs text-gray-700 font-medium">
                  🤰 Применять референсы для беременных
                </span>
              </label>
            )}
          </div>

          {/* Items + Results entry */}
          {hasResults && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  Анализы и результаты
                  {locked && <span className="ml-2 text-[10px] text-purple-600 normal-case tracking-normal">🔒 только чтение</span>}
                </p>
                {!locked && (
                  <button
                    onClick={saveResults}
                    disabled={saveRes}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
                    {saveRes ? 'Сохранение...' : '💾 Сохранить результаты'}
                  </button>
                )}
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
                  const itemVerified = !!item.verified_at
                  const itemDraft    = !itemVerified && !!item.result_entered_at
                  const itemRO       = locked || itemVerified
                  const enteredBy    = item.result_entered_by ? userMap[item.result_entered_by] : null
                  const verifiedBy   = item.verified_by       ? userMap[item.verified_by]       : null
                  const fmtDT = (iso: string) =>
                    new Date(iso).toLocaleString('ru-RU', {
                      day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
                    })
                  return (
                    <div key={item.id} className={`rounded-lg px-3 py-2.5 ${
                      itemVerified ? 'bg-purple-50/60 border border-purple-100'
                                    : itemDraft ? 'bg-blue-50/40 border border-blue-100'
                                                : 'bg-gray-50'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <span className="text-sm text-gray-800 font-medium flex-1 min-w-0 truncate">{item.name}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {itemVerified && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                              ✓ верифицирован
                            </span>
                          )}
                          {itemDraft && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                              черновик
                            </span>
                          )}
                          {item.price != null && (
                            <span className="text-xs text-gray-400">{item.price.toLocaleString('ru-RU')} ₸</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={raw}
                          onChange={e => setResults(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Результат"
                          readOnly={itemRO}
                          title={itemVerified ? 'Результат верифицирован — редактирование запрещено' : undefined}
                          className={`flex-1 border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none ${itemRO ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
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
                      <p className="text-[10px] text-gray-400 mt-1">
                        Норма: {refRange}
                        {refs?.label && (
                          <span className="ml-2 inline-block px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                            {refs.label}
                          </span>
                        )}
                      </p>
                      {(itemDraft || itemVerified) && (
                        <div className="mt-1.5 pt-1.5 border-t border-gray-200/60 text-[10px] text-gray-500 space-y-0.5">
                          {item.result_entered_at && (
                            <div>
                              <span className="text-gray-400">Ввёл:</span>{' '}
                              <span className="text-gray-700">{enteredBy ?? '—'}</span>
                              <span className="text-gray-400"> · {fmtDT(item.result_entered_at)}</span>
                            </div>
                          )}
                          {item.verified_at && (
                            <div>
                              <span className="text-purple-400">Верифицировал:</span>{' '}
                              <span className="text-purple-700 font-medium">{verifiedBy ?? '—'}</span>
                              <span className="text-purple-400"> · {fmtDT(item.verified_at)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {/* Samples history */}
          {samples.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Забор материала
              </p>
              <div className="space-y-1.5">
                {samples.map(s => (
                  <div key={s.id} className="bg-teal-50/60 border border-teal-100 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
                    <span className="text-base leading-none">{SAMPLE_TYPE_ICON[s.sample_type] ?? '🧪'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">
                          {SAMPLE_TYPE_RU[s.sample_type] ?? s.sample_type}
                        </span>
                        <span className="text-gray-500">
                          {new Date(s.collected_at).toLocaleString('ru-RU', {
                            day: 'numeric', month: 'short',
                            hour: '2-digit', minute: '2-digit'
                          })}
                        </span>
                        {s.status !== 'collected' && (
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                            s.status === 'rejected' ? 'bg-red-100 text-red-700'
                                                    : 'bg-gray-100 text-gray-600'
                          }`}>
                            {SAMPLE_STATUS_RU[s.status] ?? s.status}
                          </span>
                        )}
                      </div>
                      {s.comment && (
                        <p className="text-gray-600 italic mt-0.5">{s.comment}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-gray-100 space-y-2">
          {/* Material taken — доступно пока заказ не верифицирован/выдан.
              Можно брать несколько проб разных типов. */}
          {!['verified','delivered'].includes(order.status) && (
            <button onClick={() => setSampleModalOpen(true)} disabled={takingSample}
              className="w-full py-2.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-60 transition-colors">
              {samples.length > 0 ? '➕ Добавить пробу' : '🩸 Материал взят'}
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

      {/* Demographic nuance editor — for cases where registrar
          forgot to mark pregnancy / lab_notes at order creation.
          Updates both THIS order's snapshot and the patient card. */}
      {demoEditOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !demoSaving && setDemoEditOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">
            <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center gap-2">
              <span className="text-lg">🧪</span>
              <div>
                <h3 className="text-base font-semibold text-gray-900">Исправить нюансы</h3>
                <p className="text-[11px] text-amber-700 mt-0.5">Обновит и этот заказ, и карту пациента</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              {effectiveSex === 'F' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Беременность</label>
                      <select value={demoPreg}
                        onChange={e => setDemoPreg(e.target.value as 'yes' | 'no' | 'unknown')}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="unknown">Не уточнено</option>
                        <option value="no">Нет</option>
                        <option value="yes">🤰 Да</option>
                      </select>
                    </div>
                    {demoPreg === 'yes' && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Срок (нед.)</label>
                        <input type="number" min={1} max={42}
                          value={demoPregWeeks} onChange={e => setDemoPregWeeks(e.target.value)}
                          placeholder="например, 24"
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400" />
                      </div>
                    )}
                  </div>
                  {demoPreg !== 'yes' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Менопауза</label>
                      <select value={demoMeno}
                        onChange={e => setDemoMeno(e.target.value as 'no' | 'peri' | 'post' | '')}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="">— не указано —</option>
                        <option value="no">Нет</option>
                        <option value="peri">Пре-/перименопауза</option>
                        <option value="post">Постменопауза</option>
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                  Пол: {effectiveSex === 'M' ? '♂ мужской' : 'не указан'} — беременность не применима.
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Лаб. примечание <span className="text-gray-400 font-normal">(препараты, хроника, аллергии)</span>
                </label>
                <textarea rows={3}
                  value={demoNotes} onChange={e => setDemoNotes(e.target.value)}
                  placeholder="например: принимает L-тироксин"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={() => setDemoEditOpen(false)} disabled={demoSaving}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 rounded-lg py-2.5 text-sm font-medium transition-colors">
                Отмена
              </button>
              <button disabled={demoSaving}
                onClick={async () => {
                  if (demoSaving) return
                  setDemoSaving(true)
                  const weeksNum = demoPreg === 'yes' && demoPregWeeks.trim()
                    ? Math.max(1, Math.min(42, parseInt(demoPregWeeks, 10) || 0)) || null
                    : null
                  const notesClean = demoNotes.trim() || null
                  // Update order snapshot
                  await supabase.from('lab_orders').update({
                    pregnancy_snapshot:       demoPreg,
                    pregnancy_weeks_snapshot: weeksNum,
                    lab_notes_snapshot:       notesClean,
                  }).eq('id', order.id)
                  // Update patient record (source of truth for future orders).
                  // menopause_status isn't in the order snapshot — only on patient.
                  const patientUpdate: Record<string, unknown> = {
                    pregnancy_status: demoPreg,
                    pregnancy_weeks:  weeksNum,
                    lab_notes:        notesClean,
                  }
                  if (effectiveSex === 'F') {
                    patientUpdate.menopause_status = demoMeno || null
                  }
                  await supabase.from('patients').update(patientUpdate).eq('id', order.patient_id)
                  setIsPregnant(demoPreg === 'yes')
                  setDemoSaving(false)
                  setDemoEditOpen(false)
                  onUpdated()
                }}
                className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
                {demoSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {sampleModalOpen && (
        <SampleCollectionModal
          orderNumber={order.order_number}
          patientName={order.patient_name_snapshot ?? order.patient?.full_name ?? null}
          saving={takingSample}
          onCancel={() => setSampleModalOpen(false)}
          onConfirm={confirmTakeSample}
        />
      )}
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
  // Demographic nuances — editable by registrar at order-creation time.
  // Prefilled from patient, committed back to patient on save.
  const [pregStatus, setPregStatus]       = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [pregWeeks,  setPregWeeks]        = useState<string>('')
  const [menoStatus, setMenoStatus]       = useState<'no' | 'peri' | 'post' | ''>('')
  const [labNotesDraft, setLabNotesDraft] = useState('')
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // When a patient is picked, pre-fill nuances from their record.
  useEffect(() => {
    if (!patient) return
    setPregStatus(patient.pregnancy_status ?? 'unknown')
    setPregWeeks(patient.pregnancy_weeks != null ? String(patient.pregnancy_weeks) : '')
    setMenoStatus(patient.menopause_status ?? '')
    setLabNotesDraft(patient.lab_notes ?? '')
  }, [patient])

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
        .select('id,full_name,phones,gender,birth_date,pregnancy_status,pregnancy_weeks,menopause_status,lab_notes')
        .ilike('full_name', `%${q}%`).limit(6)
      setHits((data ?? []) as PatientHit[])
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

    const age = ageFromBirth(patient.birth_date ?? null)
    const pregWeeksNum = pregStatus === 'yes' && pregWeeks.trim()
      ? Math.max(1, Math.min(42, parseInt(pregWeeks, 10) || 0)) || null
      : null
    const labNotesClean = labNotesDraft.trim() || null

    // Persist nuances back to patient record (source of truth for future orders).
    const patientUpdate: Record<string, unknown> = {
      pregnancy_status: pregStatus,
      pregnancy_weeks:  pregWeeksNum,
      lab_notes:        labNotesClean,
    }
    if (patient.gender === 'female') {
      patientUpdate.menopause_status = menoStatus || null
    }
    await supabase.from('patients').update(patientUpdate).eq('id', patient.id)

    const { data: order, error: err } = await supabase
      .from('lab_orders')
      .insert({
        clinic_id:  clinicId,
        patient_id: patient.id,
        doctor_id:  doctorId || null,
        urgent,
        notes:      notes.trim() || null,
        status:     'ordered',
        // Snapshot — demographics are frozen at order-creation time
        patient_name_snapshot:    patient.full_name,
        sex_snapshot:             patient.gender ?? null,
        age_snapshot:             age,
        pregnancy_snapshot:       pregStatus,
        pregnancy_weeks_snapshot: pregWeeksNum,
        lab_notes_snapshot:       labNotesClean,
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

          {/* Lab-relevant demographic nuances — editable at order time */}
          {patient && selected.size > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-3">
              <p className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                🧪 Нюансы для лаборатории
                <span className="text-[10px] font-normal text-amber-600">— влияют на подбор референсов</span>
              </p>

              {patient.gender === 'female' ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-600 mb-1">Беременность</label>
                      <select className={inp} value={pregStatus}
                        onChange={e => setPregStatus(e.target.value as 'yes' | 'no' | 'unknown')}>
                        <option value="unknown">Не уточнено</option>
                        <option value="no">Нет</option>
                        <option value="yes">🤰 Да</option>
                      </select>
                    </div>
                    {pregStatus === 'yes' && (
                      <div>
                        <label className="block text-[11px] font-medium text-gray-600 mb-1">Срок (нед.)</label>
                        <input type="number" min={1} max={42} className={inp}
                          value={pregWeeks} onChange={e => setPregWeeks(e.target.value)}
                          placeholder="например, 24" />
                      </div>
                    )}
                  </div>

                  {pregStatus !== 'yes' && (
                    <div>
                      <label className="block text-[11px] font-medium text-gray-600 mb-1">Менопауза</label>
                      <select className={inp} value={menoStatus}
                        onChange={e => setMenoStatus(e.target.value as 'no' | 'peri' | 'post' | '')}>
                        <option value="">— не указано —</option>
                        <option value="no">Нет</option>
                        <option value="peri">Пре-/перименопауза</option>
                        <option value="post">Постменопауза</option>
                      </select>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-gray-500">
                  Пол: {patient.gender === 'male' ? '♂ мужской' : 'не указан'} — поля беременности/менопаузы не применимы.
                </p>
              )}

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Лаб. примечание
                  <span className="text-gray-400 font-normal"> (приём препаратов, хроника, аллергии)</span>
                </label>
                <textarea className={inp + ' resize-none'} rows={2}
                  value={labNotesDraft} onChange={e => setLabNotesDraft(e.target.value)}
                  placeholder="например: принимает L-тироксин, диабет 2 типа…" />
              </div>
            </div>
          )}

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

  // Filters
  const [search, setSearch]     = useState('')      // patient name substring
  const [dateFrom, setDateFrom] = useState('')      // YYYY-MM-DD
  const [dateTo, setDateTo]     = useState('')      // YYYY-MM-DD
  const [urgentOnly, setUrgentOnly] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    let q = supabase
      .from('lab_orders')
      .select('*, patient:patients(id,full_name), doctor:doctors(id,first_name,last_name), items:lab_order_items(id,name,price,service_id,result_value,result_text,unit_snapshot,reference_min,reference_max,reference_text,flag,result_entered_at,result_entered_by,verified_at,verified_by), samples:lab_samples(id,sample_type,collected_at,status)')
      .order('ordered_at', { ascending: false })
      .limit(200)
    if (filter === 'active') q = q.in('status', ['ordered','agreed','paid','sample_taken','in_progress'])
    else if (filter === 'ready') q = q.in('status', ['ready','verified'])
    if (dateFrom) q = q.gte('ordered_at', dateFrom)
    if (dateTo)   q = q.lte('ordered_at', dateTo + 'T23:59:59')
    if (urgentOnly) q = q.eq('urgent', true)
    q.then(({ data }) => { setOrders((data ?? []) as LabOrder[]); setLoading(false) })
  }, [filter, dateFrom, dateTo, urgentOnly])

  // Client-side patient-name filter (avoids a second query)
  const visibleOrders = search.trim()
    ? orders.filter(o => (o.patient?.full_name ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    : orders

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-4xl mx-auto">
      {showCreate && clinicId && (
        <CreateOrderModal clinicId={clinicId} onClose={() => setCreate(false)} onSaved={load} />
      )}
      {selected && (
        <OrderDrawer order={selected} onClose={() => setSelected(null)} onUpdated={load} />
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
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
        <span className="text-sm text-gray-400">
          {visibleOrders.length}{visibleOrders.length !== orders.length ? ` / ${orders.length}` : ''} направлений
        </span>
        <div className="flex-1" />
        <Link href="/lab/qc"
          className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors">
          QC / Levey-Jennings
        </Link>
        <button onClick={() => setCreate(true)} disabled={!clinicId}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          + Направление
        </button>
      </div>

      {/* Filters row */}
      <div className="bg-white border border-gray-100 rounded-xl p-3 mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Поиск по ФИО пациента"
          className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>с</span>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
          <span>по</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer px-2">
          <input
            type="checkbox"
            checked={urgentOnly}
            onChange={e => setUrgentOnly(e.target.checked)}
            className="rounded text-red-500 focus:ring-red-400"
          />
          🔴 срочные
        </label>
        {(search || dateFrom || dateTo || urgentOnly) && (
          <button
            onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setUrgentOnly(false) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2"
          >
            сбросить
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : visibleOrders.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {orders.length === 0 ? 'Направлений нет' : 'По фильтрам ничего не найдено'}
          </div>
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
              {visibleOrders.map(o => (
                <tr key={o.id} onClick={() => setSelected(o)}
                  className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors">
                  <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                    <Link href={`/patients/${o.patient_id}`}
                      className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline">
                      {o.patient_name_snapshot ?? o.patient?.full_name ?? '—'}
                    </Link>
                    <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {o.sex_snapshot === 'female' && <span>♀</span>}
                      {o.sex_snapshot === 'male' && <span>♂</span>}
                      {o.age_snapshot != null && <span>{o.age_snapshot} лет</span>}
                      {o.pregnancy_snapshot === 'yes' && (
                        <span className="text-pink-600">🤰{o.pregnancy_weeks_snapshot ? `${o.pregnancy_weeks_snapshot}н` : ''}</span>
                      )}
                      {o.order_number && <span className="text-gray-400 font-mono">{o.order_number}</span>}
                    </p>
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
                    {(o.samples ?? []).length > 0 && (
                      <div className="flex items-center gap-1 mt-1" title={
                        (o.samples ?? []).map(s =>
                          `${SAMPLE_TYPE_RU[s.sample_type] ?? s.sample_type} · ${new Date(s.collected_at).toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}`
                        ).join('\n')
                      }>
                        {Array.from(new Set((o.samples ?? [])
                          .filter(s => s.status === 'collected')
                          .map(s => s.sample_type))).map(t => (
                          <span key={t} className="text-sm leading-none">{SAMPLE_TYPE_ICON[t] ?? '🧪'}</span>
                        ))}
                        <span className="text-[10px] text-teal-700 ml-0.5">{(o.samples ?? []).length}</span>
                      </div>
                    )}
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
