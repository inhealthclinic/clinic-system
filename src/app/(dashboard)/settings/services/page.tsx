'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Service {
  id: string
  clinic_id: string
  name: string
  category: string
  price: number
  duration_minutes: number
  is_active: boolean
  created_at: string
}

interface ServiceForm {
  name: string
  category: string
  price: string
  duration_minutes: string
  is_active: boolean
}

const EMPTY_FORM: ServiceForm = {
  name:             '',
  category:         '',
  price:            '',
  duration_minutes: '30',
  is_active:        true,
}

// ─── ServiceModal ─────────────────────────────────────────────────────────────

function ServiceModal({
  service,
  categories,
  clinicId,
  onClose,
  onSaved,
}: {
  service: Service | null   // null = create mode
  categories: string[]
  clinicId: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const isEdit = service !== null

  const [form, setForm] = useState<ServiceForm>(() =>
    isEdit
      ? {
          name:             service!.name,
          category:         service!.category,
          price:            String(service!.price),
          duration_minutes: String(service!.duration_minutes),
          is_active:        service!.is_active,
        }
      : EMPTY_FORM
  )
  const [saving, setSaving]       = useState(false)
  const [deactivating, setDeactivating] = useState(false)
  const [error, setError]         = useState('')
  const [catOpen, setCatOpen]     = useState(false)

  const filteredCats = categories.filter(c =>
    c.toLowerCase().includes(form.category.toLowerCase()) && c !== form.category
  )

  const setField = <K extends keyof ServiceForm>(key: K, val: ServiceForm[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('Введите название услуги'); return }
    setError('')
    setSaving(true)

    const payload = {
      name:             form.name.trim(),
      category:         form.category.trim(),
      price:            parseFloat(form.price) || 0,
      duration_minutes: parseInt(form.duration_minutes, 10) || 30,
      is_active:        form.is_active,
    }

    if (isEdit) {
      const { error: err } = await supabase
        .from('services')
        .update(payload)
        .eq('id', service!.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase
        .from('services')
        .insert({ ...payload, clinic_id: clinicId })
      if (err) { setError(err.message); setSaving(false); return }
    }

    onSaved()
    onClose()
  }

  const handleDeactivate = async () => {
    if (!isEdit) return
    setDeactivating(true)
    const { error: err } = await supabase
      .from('services')
      .update({ is_active: false })
      .eq('id', service!.id)
    if (err) { setError(err.message); setDeactivating(false); return }
    onSaved()
    onClose()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Редактировать услугу' : 'Новая услуга'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Name */}
          <div>
            <label className={labelCls}>Название <span className="text-red-400">*</span></label>
            <input
              className={inputCls}
              placeholder="Консультация терапевта"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Category with suggestions */}
          <div className="relative">
            <label className={labelCls}>Категория</label>
            <input
              className={inputCls}
              placeholder="Консультации"
              value={form.category}
              onChange={e => { setField('category', e.target.value); setCatOpen(true) }}
              onFocus={() => setCatOpen(true)}
              onBlur={() => setTimeout(() => setCatOpen(false), 150)}
              autoComplete="off"
            />
            {catOpen && filteredCats.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
                {filteredCats.map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onMouseDown={() => { setField('category', cat); setCatOpen(false) }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Price + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Цена (₸)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className={inputCls}
                placeholder="5000"
                value={form.price}
                onChange={e => setField('price', e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Длительность (мин)</label>
              <input
                type="number"
                min="1"
                step="5"
                className={inputCls}
                placeholder="30"
                value={form.duration_minutes}
                onChange={e => setField('duration_minutes', e.target.value)}
              />
            </div>
          </div>

          {/* Is active toggle */}
          <label className="flex items-center gap-3 cursor-pointer py-1">
            <div
              onClick={() => setField('is_active', !form.is_active)}
              className={[
                'w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                form.is_active ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            >
              <span className={[
                'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                form.is_active ? 'translate-x-5' : 'translate-x-0.5',
              ].join(' ')} />
            </div>
            <span className="text-sm text-gray-700">Активна</span>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || deactivating}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              Отмена
            </button>
            {isEdit && service!.is_active && (
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={saving || deactivating}
                className="border border-red-200 text-red-600 hover:bg-red-50 rounded-lg py-2.5 px-3 text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {deactivating ? '...' : 'Деактивировать'}
              </button>
            )}
            <button
              type="submit"
              disabled={saving || deactivating}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {saving ? 'Сохранение...' : isEdit ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [services, setServices]           = useState<Service[]>([])
  const [loading, setLoading]             = useState(true)
  const [search, setSearch]               = useState('')
  const [showInactive, setShowInactive]   = useState(false)
  const [modalService, setModalService]   = useState<Service | null | undefined>(undefined) // undefined = closed, null = create
  const isModalOpen = modalService !== undefined

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await createClient()
      .from('services')
      .select('*')
      .order('category')
      .order('name')
    setServices((data ?? []) as Service[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // All unique categories from all services (for suggestions in modal)
  const allCategories = useMemo(
    () => Array.from(new Set(services.map(s => s.category).filter(Boolean))).sort(),
    [services]
  )

  // Filtered + optionally hide inactive
  const visible = useMemo(() => {
    return services.filter(s => {
      if (!showInactive && !s.is_active) return false
      if (search.trim()) {
        return s.name.toLowerCase().includes(search.trim().toLowerCase())
      }
      return true
    })
  }, [services, search, showInactive])

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>()
    for (const s of visible) {
      const cat = s.category || 'Без категории'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(s)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ru'))
  }, [visible])

  const totalActive = services.filter(s => s.is_active).length
  const totalInactive = services.filter(s => !s.is_active).length

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Прайс-лист</h2>
          <p className="text-sm text-gray-400">
            {totalActive} активных
            {totalInactive > 0 && `, ${totalInactive} неактивных`}
          </p>
        </div>
        <button
          onClick={() => setModalService(null)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Добавить услугу
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex gap-3 mb-5">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск услуги..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
        />
        {totalInactive > 0 && (
          <button
            onClick={() => setShowInactive(v => !v)}
            className={[
              'px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors flex-shrink-0',
              showInactive
                ? 'bg-gray-100 border-gray-300 text-gray-700'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            ].join(' ')}
          >
            {showInactive ? 'Скрыть неактивные' : 'Показать неактивные'}
          </button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Загрузка...
        </div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-sm text-gray-400 mb-3">
            {search ? 'Услуги не найдены' : 'Услуг пока нет'}
          </p>
          {!search && (
            <button
              onClick={() => setModalService(null)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              + Добавить первую услугу
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {grouped.map(([category, items]) => (
            <div key={category}>
              {/* Category header */}
              <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {category}
                </span>
                <span className="text-xs text-gray-400">{items.length}</span>
              </div>

              {/* Service rows */}
              {items.map((s, idx) => (
                <button
                  key={s.id}
                  onClick={() => setModalService(s)}
                  className={[
                    'w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors',
                    idx < items.length - 1 ? 'border-b border-gray-50' : '',
                    !s.is_active ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  {/* Active dot */}
                  <div className={[
                    'w-2 h-2 rounded-full flex-shrink-0',
                    s.is_active ? 'bg-green-400' : 'bg-gray-300',
                  ].join(' ')} />

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <p className={[
                      'text-sm font-medium truncate',
                      s.is_active ? 'text-gray-900' : 'text-gray-400',
                    ].join(' ')}>
                      {s.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.duration_minutes} мин</p>
                  </div>

                  {/* Price */}
                  <div className="text-right flex-shrink-0">
                    <p className={[
                      'text-sm font-semibold',
                      s.is_active ? 'text-gray-900' : 'text-gray-400',
                    ].join(' ')}>
                      {s.price > 0
                        ? `${s.price.toLocaleString('ru-RU')} ₸`
                        : <span className="text-gray-400 font-normal">бесплатно</span>}
                    </p>
                  </div>

                  {/* Edit chevron */}
                  <svg
                    width="14"
                    height="14"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="text-gray-300 flex-shrink-0"
                  >
                    <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <ServiceModal
          service={modalService ?? null}
          categories={allCategories}
          clinicId={clinicId}
          onClose={() => setModalService(undefined)}
          onSaved={() => { load(); setModalService(undefined) }}
        />
      )}
    </div>
  )
}
