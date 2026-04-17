'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface LabTemplate {
  id: string
  clinic_id: string
  name: string
  price: number | null
  is_active: boolean
  category: string | null
  reference_range: string | null
  unit: string | null
}

const EMPTY: Omit<LabTemplate, 'id' | 'clinic_id'> = {
  name:            '',
  price:           null,
  is_active:       true,
  category:        '',
  reference_range: '',
  unit:            '',
}

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
const lbl = 'block text-xs font-medium text-gray-500 mb-1.5'

function TemplateModal({ template, clinicId, onClose, onSaved }: {
  template: LabTemplate | null  // null = create
  clinicId: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const isEdit = template !== null
  const [form, setForm] = useState<Omit<LabTemplate, 'id' | 'clinic_id'>>(
    isEdit
      ? {
          name:            template!.name,
          price:           template!.price,
          is_active:       template!.is_active,
          category:        template!.category ?? '',
          reference_range: template!.reference_range ?? '',
          unit:            template!.unit ?? '',
        }
      : { ...EMPTY }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const f = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Введите название'); return }
    setError(''); setSaving(true)

    const payload = {
      name:            form.name.trim(),
      price:           form.price ?? null,
      is_active:       form.is_active,
      category:        form.category?.trim() || null,
      reference_range: form.reference_range?.trim() || null,
      unit:            form.unit?.trim() || null,
    }

    const { error: err } = isEdit
      ? await supabase.from('lab_test_templates').update(payload).eq('id', template!.id)
      : await supabase.from('lab_test_templates').insert({ ...payload, clinic_id: clinicId })

    setSaving(false)
    if (err) { setError(err.message); return }
    onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Редактировать анализ' : 'Новый анализ'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className={lbl}>Название <span className="text-red-400">*</span></label>
            <input className={inp} value={form.name}
              onChange={e => f('name', e.target.value)} placeholder="Общий анализ крови" autoFocus required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Категория</label>
              <input className={inp} value={form.category ?? ''}
                onChange={e => f('category', e.target.value)} placeholder="Гематология" />
            </div>
            <div>
              <label className={lbl}>Ед. измерения</label>
              <input className={inp} value={form.unit ?? ''}
                onChange={e => f('unit', e.target.value)} placeholder="г/л, ммоль/л…" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Цена (₸)</label>
              <input type="number" min="0" className={inp}
                value={form.price ?? ''}
                onChange={e => f('price', e.target.value ? Number(e.target.value) : null)}
                placeholder="1500" />
            </div>
            <div>
              <label className={lbl}>Референс. значения</label>
              <input className={inp} value={form.reference_range ?? ''}
                onChange={e => f('reference_range', e.target.value)} placeholder="3.9–5.5" />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer py-1">
            <div onClick={() => f('is_active', !form.is_active)}
              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${form.is_active ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm text-gray-700">Активен</span>
          </label>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LabSettingsPage() {
  const { profile } = useAuthStore()
  const clinicId    = profile?.clinic_id ?? ''

  const [templates, setTemplates] = useState<LabTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [modal, setModal]         = useState<LabTemplate | null | undefined>(undefined)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await createClient()
      .from('lab_test_templates')
      .select('*')
      .order('category', { nullsFirst: true })
      .order('name')
    setTemplates((data ?? []) as LabTemplate[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const visible = templates.filter(t => {
    if (!showInactive && !t.is_active) return false
    if (search.trim()) return t.name.toLowerCase().includes(search.toLowerCase())
      || (t.category ?? '').toLowerCase().includes(search.toLowerCase())
    return true
  })

  // Group by category
  const grouped = Array.from(
    visible.reduce((map, t) => {
      const cat = t.category || 'Без категории'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(t)
      return map
    }, new Map<string, LabTemplate[]>())
  ).sort(([a], [b]) => a.localeCompare(b, 'ru'))

  const activeCount   = templates.filter(t => t.is_active).length
  const inactiveCount = templates.filter(t => !t.is_active).length

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Шаблоны анализов</h2>
          <p className="text-sm text-gray-400">
            {activeCount} активных{inactiveCount > 0 ? `, ${inactiveCount} неактивных` : ''}
          </p>
        </div>
        <button onClick={() => setModal(null)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Добавить анализ
        </button>
      </div>

      <div className="flex gap-3 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию или категории..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
        {inactiveCount > 0 && (
          <button onClick={() => setShowInactive(v => !v)}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors flex-shrink-0 ${showInactive ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            {showInactive ? 'Скрыть неактивные' : 'Показать неактивные'}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : grouped.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-gray-400 mb-3">{search ? 'Ничего не найдено' : 'Анализов пока нет'}</p>
            {!search && (
              <button onClick={() => setModal(null)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                + Добавить первый анализ
              </button>
            )}
          </div>
        ) : (
          grouped.map(([category, items]) => (
            <div key={category}>
              <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{category}</span>
                <span className="text-xs text-gray-400">{items.length}</span>
              </div>
              {items.map((t, idx) => (
                <button key={t.id} onClick={() => setModal(t)}
                  className={`w-full flex items-center gap-4 px-5 py-3 text-left hover:bg-gray-50 transition-colors ${idx < items.length - 1 ? 'border-b border-gray-50' : ''} ${!t.is_active ? 'opacity-50' : ''}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${t.is_active ? 'bg-green-400' : 'bg-gray-300'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {t.unit && <span className="text-xs text-gray-400">{t.unit}</span>}
                      {t.reference_range && <span className="text-xs text-gray-300">норма: {t.reference_range}</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {t.price != null ? `${t.price.toLocaleString('ru-RU')} ₸` : <span className="text-gray-400 font-normal">—</span>}
                    </p>
                  </div>
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24" className="text-gray-300 flex-shrink-0">
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {modal !== undefined && (
        <TemplateModal
          template={modal}
          clinicId={clinicId}
          onClose={() => setModal(undefined)}
          onSaved={() => { load(); setModal(undefined) }}
        />
      )}
    </div>
  )
}
