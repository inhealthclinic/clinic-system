'use client'

/**
 * QC — контроль качества лаборатории.
 * Три вкладки:
 *  • «Материалы» — CRUD контрольных лотов (mean/SD/уровень)
 *  • «Измерения» — ввод ежедневных значений, список с правилами
 *  • «Графики»   — Levey-Jennings на выбранный материал
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── types ────────────────────────────────────────────────────────────────────

interface QCMaterial {
  id: string
  clinic_id: string
  service_id: string | null
  name: string
  level: 'low' | 'normal' | 'high'
  lot_no: string
  target_mean: number
  target_sd: number
  unit: string | null
  expires_at: string | null
  is_active: boolean
  notes: string | null
}

interface QCMeasurement {
  id: string
  clinic_id: string
  material_id: string
  value: number
  z_score: number | null
  measured_at: string
  operator_id: string | null
  rules: string[]
  status: 'accepted' | 'warning' | 'rejected'
  notes: string | null
}

interface ServiceLite { id: string; name: string }

type Tab = 'materials' | 'measurements' | 'chart'

// ─── helpers ──────────────────────────────────────────────────────────────────

const LEVEL_LABEL: Record<string, string> = {
  low: 'Низкий', normal: 'Норма', high: 'Высокий',
}

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  accepted: { cls: 'bg-green-50 text-green-700',   label: 'ОК' },
  warning:  { cls: 'bg-yellow-50 text-yellow-700', label: 'Warning' },
  rejected: { cls: 'bg-red-100 text-red-700',      label: 'Reject' },
}

const RULE_DESC: Record<string, string> = {
  '1_2s': '1 точка |z|>2 — предупреждение',
  '1_3s': '1 точка |z|>3 — грубая ошибка',
  '2_2s': '2 подряд |z|>2 одной стороны — систематика',
  'R_4s': 'Размах между точками >4SD — случайная',
  '4_1s': '4 подряд |z|>1 одной стороны — дрейф',
  '10_x': '10 подряд по одну сторону среднего — смещение',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function fmtNum(n: number | null | undefined, d = 2): string {
  if (n === null || n === undefined) return '—'
  const x = Number(n)
  return Number.isInteger(x) ? String(x) : x.toFixed(d)
}

// ─── component ────────────────────────────────────────────────────────────────

export default function QCPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [tab, setTab] = useState<Tab>('measurements')
  const [materials, setMaterials] = useState<QCMaterial[]>([])
  const [measurements, setMeasurements] = useState<QCMeasurement[]>([])
  const [services, setServices] = useState<ServiceLite[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedMaterial, setSelectedMaterial] = useState<string>('')

  // form state: new measurement
  const [newValue, setNewValue] = useState<string>('')
  const [newMat, setNewMat] = useState<string>('')
  const [newAt, setNewAt] = useState<string>(() => {
    const d = new Date()
    d.setSeconds(0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [newNotes, setNewNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // material modal state
  const [matEditing, setMatEditing] = useState<Partial<QCMaterial> | null>(null)
  const [matSaving, setMatSaving] = useState(false)

  // ── load
  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const [m, x, s] = await Promise.all([
      supabase.from('qc_materials').select('*').eq('clinic_id', clinicId).order('name'),
      supabase.from('qc_measurements').select('*').eq('clinic_id', clinicId)
        .order('measured_at', { ascending: false }).limit(500),
      supabase.from('services').select('id,name').eq('clinic_id', clinicId).order('name'),
    ])
    setMaterials((m.data ?? []) as QCMaterial[])
    setMeasurements((x.data ?? []) as QCMeasurement[])
    setServices((s.data ?? []) as ServiceLite[])
    setLoading(false)
  }, [supabase, clinicId])

  useEffect(() => { load() }, [load])

  // default selected material for chart
  useEffect(() => {
    if (!selectedMaterial && materials.length > 0) setSelectedMaterial(materials[0].id)
    if (!newMat && materials.length > 0) setNewMat(materials[0].id)
  }, [materials, selectedMaterial, newMat])

  // ── save measurement
  async function saveMeasurement() {
    if (!clinicId || !newMat || !newValue) return
    const v = Number(newValue.replace(',', '.'))
    if (Number.isNaN(v)) { alert('Некорректное значение'); return }
    setSaving(true)
    const { error } = await supabase.from('qc_measurements').insert({
      clinic_id: clinicId,
      material_id: newMat,
      value: v,
      measured_at: new Date(newAt).toISOString(),
      operator_id: profile?.id ?? null,
      notes: newNotes || null,
    })
    setSaving(false)
    if (error) { alert('Ошибка: ' + error.message); return }
    setNewValue(''); setNewNotes('')
    load()
  }

  // ── save material
  async function saveMaterial() {
    if (!clinicId || !matEditing) return
    const m = matEditing
    if (!m.name || !m.lot_no || !m.level || m.target_mean == null || !m.target_sd) {
      alert('Заполните обязательные поля'); return
    }
    setMatSaving(true)
    const payload = {
      clinic_id: clinicId,
      service_id: m.service_id ?? null,
      name: m.name,
      level: m.level,
      lot_no: m.lot_no,
      target_mean: Number(m.target_mean),
      target_sd: Number(m.target_sd),
      unit: m.unit ?? null,
      expires_at: m.expires_at ?? null,
      is_active: m.is_active ?? true,
      notes: m.notes ?? null,
    }
    const { error } = m.id
      ? await supabase.from('qc_materials').update(payload).eq('id', m.id)
      : await supabase.from('qc_materials').insert(payload)
    setMatSaving(false)
    if (error) { alert('Ошибка: ' + error.message); return }
    setMatEditing(null)
    load()
  }

  // ── chart data
  const chartData = useMemo(() => {
    const mat = materials.find(m => m.id === selectedMaterial)
    if (!mat) return null
    const points = measurements
      .filter(x => x.material_id === selectedMaterial)
      .slice()
      .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    return { mat, points }
  }, [materials, measurements, selectedMaterial])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Контроль качества</h1>
          <p className="text-sm text-gray-500">Levey-Jennings + правила Westgard</p>
        </div>
        <Link href="/lab" className="text-sm text-blue-600 hover:underline">← К заказам</Link>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {([
          ['measurements', 'Измерения'],
          ['chart',        'График'],
          ['materials',    'Материалы'],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === k ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-gray-500">Загрузка…</div>}

      {!loading && tab === 'measurements' && (
        <div className="space-y-4">
          {/* form */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h2 className="font-medium text-gray-900 mb-3">Новое измерение</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Материал</label>
                <select
                  value={newMat}
                  onChange={e => setNewMat(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm"
                >
                  {materials.filter(m => m.is_active).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {LEVEL_LABEL[m.level]} (лот {m.lot_no})
                    </option>
                  ))}
                  {materials.length === 0 && <option value="">— нет материалов —</option>}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Значение</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm"
                  placeholder="напр. 5.42"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Когда</label>
                <input
                  type="datetime-local"
                  value={newAt}
                  onChange={e => setNewAt(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Примечание</label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={e => setNewNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 text-sm"
                />
              </div>
            </div>
            <button
              onClick={saveMeasurement}
              disabled={saving || !newMat || !newValue}
              className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md text-sm"
            >
              {saving ? 'Сохраняем…' : 'Записать'}
            </button>
          </div>

          {/* list */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">
              Последние измерения ({measurements.length})
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">Когда</th>
                  <th className="px-4 py-2">Материал</th>
                  <th className="px-4 py-2 text-right">Значение</th>
                  <th className="px-4 py-2 text-right">z</th>
                  <th className="px-4 py-2">Правила</th>
                  <th className="px-4 py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map(m => {
                  const mat = materials.find(x => x.id === m.material_id)
                  const st = STATUS_STYLE[m.status]
                  return (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-gray-600">{fmtDate(m.measured_at)}</td>
                      <td className="px-4 py-2">
                        {mat ? `${mat.name} · ${LEVEL_LABEL[mat.level]} · ${mat.lot_no}` : m.material_id}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {fmtNum(m.value)}{mat?.unit ? ` ${mat.unit}` : ''}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{fmtNum(m.z_score, 2)}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {m.rules.map(r => (
                            <span
                              key={r}
                              title={RULE_DESC[r] ?? r}
                              className="text-xs bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-block text-xs px-2 py-0.5 rounded ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {measurements.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Нет данных</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'chart' && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Материал</label>
            <select
              value={selectedMaterial}
              onChange={e => setSelectedMaterial(e.target.value)}
              className="border border-gray-300 rounded-md px-2 py-2 text-sm"
            >
              {materials.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name} — {LEVEL_LABEL[m.level]} (лот {m.lot_no})
                </option>
              ))}
              {materials.length === 0 && <option value="">— нет материалов —</option>}
            </select>
          </div>

          {chartData && (
            <LeveyJenningsChart
              mean={chartData.mat.target_mean}
              sd={chartData.mat.target_sd}
              unit={chartData.mat.unit}
              points={chartData.points.map(p => ({
                at: p.measured_at, value: p.value, z: p.z_score ?? 0, status: p.status,
              }))}
            />
          )}

          <div className="bg-white border border-gray-200 rounded-lg p-4 text-xs text-gray-600">
            <div className="font-medium text-gray-800 mb-1">Правила Westgard</div>
            <ul className="space-y-0.5">
              {Object.entries(RULE_DESC).map(([k, v]) => (
                <li key={k}><span className="font-mono text-gray-900">{k}</span> — {v}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!loading && tab === 'materials' && (
        <div className="space-y-4">
          <button
            onClick={() => setMatEditing({
              level: 'normal', is_active: true, target_mean: 0, target_sd: 1,
              name: '', lot_no: '',
            })}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm"
          >
            + Новый материал
          </button>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">Название</th>
                  <th className="px-4 py-2">Услуга</th>
                  <th className="px-4 py-2">Уровень</th>
                  <th className="px-4 py-2">Лот</th>
                  <th className="px-4 py-2 text-right">Mean</th>
                  <th className="px-4 py-2 text-right">SD</th>
                  <th className="px-4 py-2">Срок</th>
                  <th className="px-4 py-2">Статус</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {materials.map(m => {
                  const svc = services.find(s => s.id === m.service_id)
                  return (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-4 py-2 font-medium text-gray-900">{m.name}</td>
                      <td className="px-4 py-2 text-gray-600">{svc?.name ?? '—'}</td>
                      <td className="px-4 py-2">{LEVEL_LABEL[m.level]}</td>
                      <td className="px-4 py-2 font-mono text-xs">{m.lot_no}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtNum(m.target_mean, 3)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmtNum(m.target_sd, 3)}</td>
                      <td className="px-4 py-2 text-gray-600">{m.expires_at ?? '—'}</td>
                      <td className="px-4 py-2">
                        {m.is_active
                          ? <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded">активен</span>
                          : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">архив</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => setMatEditing(m)}
                          className="text-blue-600 hover:underline text-xs"
                        >
                          Изменить
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {materials.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-400">Нет материалов</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* material modal */}
      {matEditing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              {matEditing.id ? 'Изменить материал' : 'Новый контрольный материал'}
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Название *</label>
                <input
                  type="text"
                  value={matEditing.name ?? ''}
                  onChange={e => setMatEditing({ ...matEditing, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Услуга</label>
                <select
                  value={matEditing.service_id ?? ''}
                  onChange={e => setMatEditing({ ...matEditing, service_id: e.target.value || null })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2"
                >
                  <option value="">— не задано —</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Уровень *</label>
                <select
                  value={matEditing.level ?? 'normal'}
                  onChange={e => setMatEditing({ ...matEditing, level: e.target.value as QCMaterial['level'] })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2"
                >
                  <option value="low">Низкий</option>
                  <option value="normal">Нормальный</option>
                  <option value="high">Высокий</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Лот *</label>
                <input
                  type="text"
                  value={matEditing.lot_no ?? ''}
                  onChange={e => setMatEditing({ ...matEditing, lot_no: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Единица</label>
                <input
                  type="text"
                  value={matEditing.unit ?? ''}
                  onChange={e => setMatEditing({ ...matEditing, unit: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Target Mean *</label>
                <input
                  type="number"
                  step="any"
                  value={matEditing.target_mean ?? 0}
                  onChange={e => setMatEditing({ ...matEditing, target_mean: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Target SD *</label>
                <input
                  type="number"
                  step="any"
                  value={matEditing.target_sd ?? 1}
                  onChange={e => setMatEditing({ ...matEditing, target_sd: Number(e.target.value) })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Срок годности</label>
                <input
                  type="date"
                  value={matEditing.expires_at ?? ''}
                  onChange={e => setMatEditing({ ...matEditing, expires_at: e.target.value || null })}
                  className="w-full border border-gray-300 rounded-md px-2 py-2"
                />
              </div>
              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={matEditing.is_active ?? true}
                    onChange={e => setMatEditing({ ...matEditing, is_active: e.target.checked })}
                  />
                  Активен
                </label>
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Заметки</label>
                <textarea
                  value={matEditing.notes ?? ''}
                  onChange={e => setMatEditing({ ...matEditing, notes: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-md px-2 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setMatEditing(null)}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
              >
                Отмена
              </button>
              <button
                onClick={saveMaterial}
                disabled={matSaving}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md text-sm"
              >
                {matSaving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Levey-Jennings chart ────────────────────────────────────────────────────

interface LJPoint {
  at: string
  value: number
  z: number
  status: 'accepted' | 'warning' | 'rejected'
}

function LeveyJenningsChart({
  mean, sd, unit, points,
}: {
  mean: number
  sd: number
  unit: string | null
  points: LJPoint[]
}) {
  const W = 820, H = 300
  const PAD_L = 56, PAD_R = 16, PAD_T = 16, PAD_B = 36
  const innerW = W - PAD_L - PAD_R
  const innerH = H - PAD_T - PAD_B

  // y range: ±4SD
  const yMin = mean - 4 * sd
  const yMax = mean + 4 * sd
  const y = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH

  const n = Math.max(points.length, 1)
  const x = (i: number) => PAD_L + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)

  const lineBands = [
    { sd: 0, stroke: '#374151', dash: '',    label: 'Mean' },
    { sd: 1, stroke: '#22c55e', dash: '4 4', label: '±1SD' },
    { sd: 2, stroke: '#f59e0b', dash: '4 4', label: '±2SD' },
    { sd: 3, stroke: '#ef4444', dash: '4 4', label: '±3SD' },
  ]

  const pathD = points.length > 0
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
    : ''

  const dotColor = (s: LJPoint['status']) =>
    s === 'rejected' ? '#dc2626' : s === 'warning' ? '#f59e0b' : '#2563eb'

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-gray-600">
          Mean = <span className="font-mono">{mean}</span>
          {' '}·{' '}SD = <span className="font-mono">{sd}</span>
          {unit ? ` · ${unit}` : ''}
          {' '}·{' '}n = <span className="font-mono">{points.length}</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Y bands */}
        {lineBands.map(b => (
          <g key={b.sd}>
            {b.sd === 0 ? (
              <>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(mean)} y2={y(mean)}
                  stroke={b.stroke} strokeWidth={1.5} />
                <text x={PAD_L - 6} y={y(mean) + 4} textAnchor="end"
                  fontSize="10" fill="#374151">Mean</text>
              </>
            ) : (
              <>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(mean + b.sd * sd)} y2={y(mean + b.sd * sd)}
                  stroke={b.stroke} strokeWidth={1} strokeDasharray={b.dash} opacity={0.8} />
                <line x1={PAD_L} x2={W - PAD_R} y1={y(mean - b.sd * sd)} y2={y(mean - b.sd * sd)}
                  stroke={b.stroke} strokeWidth={1} strokeDasharray={b.dash} opacity={0.8} />
                <text x={PAD_L - 6} y={y(mean + b.sd * sd) + 4} textAnchor="end"
                  fontSize="10" fill={b.stroke}>+{b.sd}SD</text>
                <text x={PAD_L - 6} y={y(mean - b.sd * sd) + 4} textAnchor="end"
                  fontSize="10" fill={b.stroke}>-{b.sd}SD</text>
              </>
            )}
          </g>
        ))}

        {/* axis */}
        <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="#e5e7eb" />
        <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#e5e7eb" />

        {/* connecting line */}
        {pathD && <path d={pathD} fill="none" stroke="#6b7280" strokeWidth={1.2} />}

        {/* points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={4}
              fill={dotColor(p.status)} stroke="#fff" strokeWidth={1.5}>
              <title>
                {`${new Date(p.at).toLocaleString('ru-RU')}\nvalue=${p.value}\nz=${p.z.toFixed(2)}\n${p.status}`}
              </title>
            </circle>
          </g>
        ))}

        {/* x-axis labels: first + last */}
        {points.length > 0 && (
          <>
            <text x={x(0)} y={H - PAD_B + 16} textAnchor="start" fontSize="10" fill="#6b7280">
              {new Date(points[0].at).toLocaleDateString('ru-RU')}
            </text>
            {points.length > 1 && (
              <text x={x(points.length - 1)} y={H - PAD_B + 16} textAnchor="end" fontSize="10" fill="#6b7280">
                {new Date(points[points.length - 1].at).toLocaleDateString('ru-RU')}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  )
}
