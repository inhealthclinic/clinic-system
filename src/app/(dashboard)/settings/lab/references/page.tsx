'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────────────────── */
interface Service {
  id: string
  name: string
  category: string | null
  is_lab: boolean
  default_unit: string | null
  reference_min: number | null
  reference_max: number | null
  reference_text: string | null
}

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
  created_at: string
}

type Preset = 'children' | 'women' | 'men' | 'pregnant' | 'adult'

const PRESETS: Record<Preset, { label: string; emoji: string; apply: (r: Partial<RefRange>) => Partial<RefRange> }> = {
  children: { label: 'Дети', emoji: '👶', apply: r => ({ ...r, sex: null, age_min: 0, age_max: 17, pregnant: null, label: r.label || 'Дети (до 18 лет)' }) },
  women:    { label: 'Женщины', emoji: '👩', apply: r => ({ ...r, sex: 'F', age_min: 18, age_max: null, pregnant: false, label: r.label || 'Женщины' }) },
  men:      { label: 'Мужчины', emoji: '👨', apply: r => ({ ...r, sex: 'M', age_min: 18, age_max: null, pregnant: null, label: r.label || 'Мужчины' }) },
  pregnant: { label: 'Беременные', emoji: '🤰', apply: r => ({ ...r, sex: 'F', age_min: 18, age_max: null, pregnant: true, label: r.label || 'Беременные' }) },
  adult:    { label: 'Взрослые', emoji: '🧑', apply: r => ({ ...r, sex: null, age_min: 18, age_max: null, pregnant: null, label: r.label || 'Взрослые' }) },
}

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
const lbl = 'block text-xs font-medium text-gray-500 mb-1'

/* ─── Helpers ────────────────────────────────────────────────────────── */
function describeRange(r: RefRange): string {
  if (r.label) return r.label
  const parts: string[] = []
  if (r.sex === 'M') parts.push('♂ Мужчины')
  else if (r.sex === 'F') parts.push('♀ Женщины')
  else parts.push('Все')
  if (r.age_min != null || r.age_max != null) {
    const a = r.age_min ?? 0
    const b = r.age_max ?? '∞'
    parts.push(`${a}–${b} лет`)
  }
  if (r.pregnant === true) parts.push('🤰 беременные')
  else if (r.pregnant === false) parts.push('не беременные')
  return parts.join(' · ')
}

/* ─── Page ───────────────────────────────────────────────────────────── */
export default function LabReferencesPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [services, setServices]       = useState<Service[]>([])
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [ranges, setRanges]           = useState<RefRange[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [showForm, setShowForm]       = useState(false)
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [form, setForm]               = useState<Partial<RefRange>>({})
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const selected = useMemo(() => services.find(s => s.id === selectedId) ?? null, [services, selectedId])

  /* ─── Load services ─── */
  const loadServices = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const { data } = await supabase
      .from('services')
      .select('id, name, category, is_lab, default_unit, reference_min, reference_max, reference_text')
      .eq('clinic_id', clinicId)
      .eq('is_lab', true)
      .eq('is_active', true)
      .order('category', { nullsFirst: true })
      .order('name')
    setServices((data ?? []) as Service[])
    setLoading(false)
  }, [clinicId, supabase])

  const loadRanges = useCallback(async () => {
    if (!selectedId) { setRanges([]); return }
    const { data } = await supabase
      .from('reference_ranges')
      .select('*')
      .eq('service_id', selectedId)
      .order('created_at')
    setRanges((data ?? []) as RefRange[])
  }, [selectedId, supabase])

  useEffect(() => { loadServices() }, [loadServices])
  useEffect(() => { loadRanges() }, [loadRanges])

  /* ─── Save default reference on service ─── */
  const saveDefault = async () => {
    if (!selected) return
    setSaving(true)
    const { error: err } = await supabase.from('services').update({
      default_unit:   selected.default_unit,
      reference_min:  selected.reference_min,
      reference_max:  selected.reference_max,
      reference_text: selected.reference_text,
    }).eq('id', selected.id)
    setSaving(false)
    if (err) setError(err.message)
    else {
      setError('')
      loadServices()
    }
  }

  /* ─── Form handlers ─── */
  const openForm = (r?: RefRange) => {
    if (r) {
      setEditingId(r.id)
      setForm({
        label: r.label, sex: r.sex, age_min: r.age_min, age_max: r.age_max,
        pregnant: r.pregnant, min_value: r.min_value, max_value: r.max_value,
        text: r.text, unit: r.unit,
      })
    } else {
      setEditingId(null)
      setForm({ sex: null, pregnant: null, unit: selected?.default_unit ?? null })
    }
    setError('')
    setShowForm(true)
  }

  const applyPreset = (p: Preset) => setForm(f => PRESETS[p].apply(f))

  const saveRange = async () => {
    if (!selectedId) return
    setSaving(true)
    const payload = {
      service_id: selectedId,
      label:      form.label?.toString().trim() || null,
      sex:        form.sex ?? null,
      age_min:    form.age_min != null ? Number(form.age_min) : null,
      age_max:    form.age_max != null ? Number(form.age_max) : null,
      pregnant:   form.pregnant ?? null,
      min_value:  form.min_value != null && form.min_value !== ('' as unknown) ? Number(form.min_value) : null,
      max_value:  form.max_value != null && form.max_value !== ('' as unknown) ? Number(form.max_value) : null,
      text:       form.text?.toString().trim() || null,
      unit:       form.unit?.toString().trim() || null,
    }
    const { error: err } = editingId
      ? await supabase.from('reference_ranges').update(payload).eq('id', editingId)
      : await supabase.from('reference_ranges').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowForm(false); setEditingId(null); setForm({})
    loadRanges()
  }

  const delRange = async (id: string) => {
    if (!confirm('Удалить диапазон?')) return
    await supabase.from('reference_ranges').delete().eq('id', id)
    loadRanges()
  }

  /* ─── Filter + group ─── */
  const visible = services.filter(s =>
    !search.trim() ||
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.category ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const grouped = Array.from(
    visible.reduce((m, s) => {
      const k = s.category || 'Без категории'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
      return m
    }, new Map<string, Service[]>())
  ).sort(([a], [b]) => a.localeCompare(b, 'ru'))

  /* ─── Render ─── */
  return (
    <div className="flex gap-4 items-start">
      {/* ── Services list ── */}
      <div className="w-72 flex-shrink-0 bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Анализы</h2>
          <p className="text-xs text-gray-400 mt-0.5">Выберите для настройки референсов</p>
        </div>
        <div className="p-3 border-b border-gray-100">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск..." className={inp} />
        </div>
        <div className="max-h-[560px] overflow-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
          ) : grouped.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              {search ? 'Ничего не найдено' : 'Нет анализов. Создайте услугу с флагом «Лабораторный» в Услугах'}
            </div>
          ) : (
            grouped.map(([cat, items]) => (
              <div key={cat}>
                <div className="px-4 py-2 bg-gray-50 border-y border-gray-100">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{cat}</span>
                </div>
                {items.map(s => (
                  <button key={s.id} onClick={() => setSelectedId(s.id)}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${
                      selectedId === s.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                    }`}>
                    {s.name}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 min-w-0 space-y-4">
        {!selected ? (
          <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
            <p className="text-sm text-gray-400">Выберите анализ слева</p>
          </div>
        ) : (
          <>
            {/* Default reference */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-900">{selected.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Референс по умолчанию — применяется, если нет подходящей группы ниже
                </p>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={lbl}>Min</label>
                  <input type="number" step="any" className={inp}
                    value={selected.reference_min ?? ''}
                    onChange={e => setServices(prev => prev.map(s =>
                      s.id === selected.id ? { ...s, reference_min: e.target.value === '' ? null : Number(e.target.value) } : s))}
                    placeholder="3.5" />
                </div>
                <div>
                  <label className={lbl}>Max</label>
                  <input type="number" step="any" className={inp}
                    value={selected.reference_max ?? ''}
                    onChange={e => setServices(prev => prev.map(s =>
                      s.id === selected.id ? { ...s, reference_max: e.target.value === '' ? null : Number(e.target.value) } : s))}
                    placeholder="5.5" />
                </div>
                <div>
                  <label className={lbl}>Ед. изм.</label>
                  <input className={inp} value={selected.default_unit ?? ''}
                    onChange={e => setServices(prev => prev.map(s =>
                      s.id === selected.id ? { ...s, default_unit: e.target.value || null } : s))}
                    placeholder="г/л" />
                </div>
                <div>
                  <label className={lbl}>Текст. описание</label>
                  <input className={inp} value={selected.reference_text ?? ''}
                    onChange={e => setServices(prev => prev.map(s =>
                      s.id === selected.id ? { ...s, reference_text: e.target.value || null } : s))}
                    placeholder="отриц., &lt;1:10…" />
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-3">
                {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
                <button onClick={saveDefault} disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                  {saving ? '...' : 'Сохранить по умолчанию'}
                </button>
              </div>
            </div>

            {/* Demographic ranges */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Диапазоны по группам</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Дети / женщины / мужчины / беременные — {ranges.length} шт.</p>
                </div>
                <button onClick={() => openForm()}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
                  + Добавить
                </button>
              </div>

              {ranges.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">
                  Пока ни одной группы. Нажмите «Добавить» и выберите пресет.
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {ranges.map(r => (
                    <div key={r.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {describeRange(r)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {r.min_value != null || r.max_value != null
                            ? `${r.min_value ?? '—'} – ${r.max_value ?? '—'}${r.unit ? ' ' + r.unit : ''}`
                            : r.text ?? '—'}
                        </p>
                      </div>
                      <button onClick={() => openForm(r)}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1">
                        Изменить
                      </button>
                      <button onClick={() => delRange(r.id)}
                        className="text-xs text-red-500 hover:text-red-600 font-medium px-2 py-1">
                        Удалить
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Form modal ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 z-10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900">
                {editingId ? 'Изменить диапазон' : 'Новый диапазон'}
              </h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap gap-2 mb-4">
              {(Object.keys(PRESETS) as Preset[]).map(p => (
                <button key={p} onClick={() => applyPreset(p)}
                  className="inline-flex items-center gap-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full transition-colors">
                  <span>{PRESETS[p].emoji}</span>
                  {PRESETS[p].label}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <div>
                <label className={lbl}>Название группы</label>
                <input className={inp} value={form.label ?? ''}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="Беременные II-III триместр" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Пол</label>
                  <select className={inp} value={form.sex ?? ''}
                    onChange={e => setForm(f => ({ ...f, sex: (e.target.value || null) as 'M' | 'F' | null }))}>
                    <option value="">Любой</option>
                    <option value="M">♂ Мужской</option>
                    <option value="F">♀ Женский</option>
                  </select>
                </div>
                <div>
                  <label className={lbl}>Беременность</label>
                  <select className={inp}
                    value={form.pregnant === true ? 'true' : form.pregnant === false ? 'false' : ''}
                    onChange={e => setForm(f => ({
                      ...f,
                      pregnant: e.target.value === 'true' ? true : e.target.value === 'false' ? false : null,
                    }))}>
                    <option value="">Не важно</option>
                    <option value="true">🤰 Только беременные</option>
                    <option value="false">Только не беременные</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Возраст от (лет)</label>
                  <input type="number" min="0" className={inp}
                    value={form.age_min ?? ''}
                    onChange={e => setForm(f => ({ ...f, age_min: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="0" />
                </div>
                <div>
                  <label className={lbl}>до (лет)</label>
                  <input type="number" min="0" className={inp}
                    value={form.age_max ?? ''}
                    onChange={e => setForm(f => ({ ...f, age_max: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="17" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Min</label>
                  <input type="number" step="any" className={inp}
                    value={form.min_value ?? ''}
                    onChange={e => setForm(f => ({ ...f, min_value: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="3.5" />
                </div>
                <div>
                  <label className={lbl}>Max</label>
                  <input type="number" step="any" className={inp}
                    value={form.max_value ?? ''}
                    onChange={e => setForm(f => ({ ...f, max_value: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="5.5" />
                </div>
                <div>
                  <label className={lbl}>Ед. изм.</label>
                  <input className={inp} value={form.unit ?? ''}
                    onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                    placeholder="г/л" />
                </div>
              </div>

              <div>
                <label className={lbl}>Текст. описание (если нет числового)</label>
                <input className={inp} value={form.text ?? ''}
                  onChange={e => setForm(f => ({ ...f, text: e.target.value }))}
                  placeholder="отрицательно, &lt;1:10..." />
              </div>

              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium">
                  Отмена
                </button>
                <button onClick={saveRange} disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium">
                  {saving ? 'Сохранение...' : editingId ? 'Сохранить' : 'Добавить'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
