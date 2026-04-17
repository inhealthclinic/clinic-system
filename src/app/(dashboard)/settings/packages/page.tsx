'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabService {
  id: string
  name: string
  category: string
  price: number
  is_lab: boolean
}

interface Package {
  id: string
  name: string
  description: string | null
  price: number | null
  is_active: boolean
  sort_order: number
  service_ids: string[]
}

interface PackageForm {
  name: string
  description: string
  price: string
  is_active: boolean
  sort_order: string
  service_ids: string[]
}

const EMPTY_FORM: PackageForm = {
  name: '',
  description: '',
  price: '',
  is_active: true,
  sort_order: '0',
  service_ids: [],
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PackagesPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [packages, setPackages] = useState<Package[]>([])
  const [labServices, setLabServices] = useState<LabService[]>([])
  const [selected, setSelected] = useState<Package | null>(null)
  const [form, setForm] = useState<PackageForm>(EMPTY_FORM)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  // ── Load data ──────────────────────────────────────────────────────────────

  const loadPackages = useCallback(async () => {
    if (!clinicId) return
    const { data } = await supabase
      .from('service_packages')
      .select('id, name, description, price, is_active, sort_order, service_package_items(service_id)')
      .eq('clinic_id', clinicId)
      .order('sort_order')
    if (data) {
      setPackages(data.map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        is_active: p.is_active,
        sort_order: p.sort_order,
        service_ids: (p.service_package_items ?? []).map((i: any) => i.service_id),
      })))
    }
  }, [clinicId, supabase])

  const loadLabServices = useCallback(async () => {
    if (!clinicId) return
    const { data } = await supabase
      .from('services')
      .select('id, name, category, price, is_lab')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('category')
      .order('name')
    setLabServices(data ?? [])
  }, [clinicId, supabase])

  useEffect(() => {
    loadPackages()
    loadLabServices()
  }, [loadPackages, loadLabServices])

  // ── Select package ─────────────────────────────────────────────────────────

  const selectPackage = (pkg: Package) => {
    setSelected(pkg)
    setIsNew(false)
    setError('')
    setForm({
      name: pkg.name,
      description: pkg.description ?? '',
      price: pkg.price != null ? String(pkg.price) : '',
      is_active: pkg.is_active,
      sort_order: String(pkg.sort_order),
      service_ids: [...pkg.service_ids],
    })
  }

  const startNew = () => {
    setSelected(null)
    setIsNew(true)
    setError('')
    setForm(EMPTY_FORM)
  }

  // ── Toggle service ─────────────────────────────────────────────────────────

  const toggleService = (id: string) => {
    setForm(prev => ({
      ...prev,
      service_ids: prev.service_ids.includes(id)
        ? prev.service_ids.filter(s => s !== id)
        : [...prev.service_ids, id],
    }))
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  const save = async () => {
    if (!clinicId) return
    if (!form.name.trim()) { setError('Введите название пакета'); return }
    if (form.service_ids.length === 0) { setError('Выберите хотя бы одну услугу'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        clinic_id: clinicId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: form.price ? parseFloat(form.price) : null,
        is_active: form.is_active,
        sort_order: parseInt(form.sort_order) || 0,
      }

      let pkgId: string
      if (isNew) {
        const { data, error: e } = await supabase
          .from('service_packages')
          .insert(payload)
          .select('id')
          .single()
        if (e) throw e
        pkgId = data.id
      } else {
        const { error: e } = await supabase
          .from('service_packages')
          .update(payload)
          .eq('id', selected!.id)
        if (e) throw e
        pkgId = selected!.id
      }

      // Sync items: delete all then insert selected
      await supabase.from('service_package_items').delete().eq('package_id', pkgId)
      if (form.service_ids.length > 0) {
        await supabase.from('service_package_items').insert(
          form.service_ids.map(sid => ({ package_id: pkgId, service_id: sid }))
        )
      }

      await loadPackages()
      setIsNew(false)
      // Re-select the saved package
      setSelected(null)
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const deletePackage = async () => {
    if (!selected || !confirm(`Удалить пакет «${selected.name}»?`)) return
    setDeleting(true)
    await supabase.from('service_packages').delete().eq('id', selected.id)
    setSelected(null)
    setIsNew(false)
    setForm(EMPTY_FORM)
    await loadPackages()
    setDeleting(false)
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  // Group services by category
  const grouped = labServices.reduce<Record<string, LabService[]>>((acc, s) => {
    const cat = s.category || 'Прочее'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})

  // Filtered by search
  const filteredGrouped = Object.entries(grouped).reduce<Record<string, LabService[]>>((acc, [cat, svcs]) => {
    const filtered = search
      ? svcs.filter(s => s.name.toLowerCase().includes(search.toLowerCase()))
      : svcs
    if (filtered.length > 0) acc[cat] = filtered
    return acc
  }, {})

  // Computed total from selected services
  const computedTotal = form.service_ids.reduce((sum, id) => {
    const svc = labServices.find(s => s.id === id)
    return sum + (svc?.price ?? 0)
  }, 0)

  const showForm = isNew || selected !== null

  return (
    <div className="flex gap-4 h-[calc(100vh-120px)]">
      {/* Left: package list */}
      <div className="w-64 flex-shrink-0 bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 text-sm">Пакеты анализов</h2>
          <button
            onClick={startNew}
            className="text-blue-600 hover:text-blue-800 text-lg font-bold leading-none"
            title="Добавить пакет"
          >+</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {packages.length === 0 && (
            <p className="text-center text-gray-400 text-sm mt-8">Нет пакетов</p>
          )}
          {packages.map(pkg => (
            <button
              key={pkg.id}
              onClick={() => selectPackage(pkg)}
              className={[
                'w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors',
                selected?.id === pkg.id && !isNew
                  ? 'bg-purple-50 text-purple-800'
                  : 'hover:bg-gray-50 text-gray-700',
                !pkg.is_active ? 'opacity-50' : '',
              ].join(' ')}
            >
              <div className="font-medium text-sm truncate">{pkg.name}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {pkg.service_ids.length} услуг
                {pkg.price != null && ` · ${pkg.price.toLocaleString('ru')} ₸`}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: edit form */}
      {!showForm ? (
        <div className="flex-1 bg-white rounded-xl border border-gray-100 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="text-4xl mb-3">📦</div>
            <p className="text-sm">Выберите пакет или создайте новый</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-white rounded-xl border border-gray-100 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">
              {isNew ? 'Новый пакет' : `Редактировать: ${selected?.name}`}
            </h3>
            <div className="flex items-center gap-2">
              {!isNew && (
                <button
                  onClick={deletePackage}
                  disabled={deleting}
                  className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                >
                  {deleting ? '...' : 'Удалить'}
                </button>
              )}
              <button
                onClick={save}
                disabled={saving}
                className="bg-purple-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-60 transition-colors"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>
            )}

            {/* Basic fields */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Название пакета</label>
                <input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Чекап: Анемия"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Описание (необязательно)</label>
                <input
                  value={form.description}
                  onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Краткое описание пакета"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Цена пакета (₸)
                  {computedTotal > 0 && (
                    <span className="ml-2 text-gray-400 font-normal">
                      сумма услуг: {computedTotal.toLocaleString('ru')} ₸
                    </span>
                  )}
                </label>
                <input
                  type="number"
                  value={form.price}
                  onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                  placeholder={computedTotal > 0 ? String(computedTotal) : 'авто'}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Порядок сортировки</label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))}
                  className={[
                    'relative inline-flex h-5 w-9 rounded-full transition-colors',
                    form.is_active ? 'bg-green-500' : 'bg-gray-300',
                  ].join(' ')}
                >
                  <span className={[
                    'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5',
                    form.is_active ? 'translate-x-4' : 'translate-x-0.5',
                  ].join(' ')} />
                </button>
                <span className="text-sm text-gray-600">
                  {form.is_active ? 'Активен' : 'Неактивен'}
                </span>
              </div>
            </div>

            {/* Services picker */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-gray-700">
                  Услуги в пакете
                  <span className="ml-2 text-purple-600 font-normal">{form.service_ids.length} выбрано</span>
                </label>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Поиск услуги..."
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 w-48"
                />
              </div>

              {labServices.length === 0 ? (
                <p className="text-gray-400 text-sm">Нет лабораторных услуг. Добавьте услуги с флагом «Лабораторная» в разделе Услуги / Прайс.</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(filteredGrouped).map(([cat, svcs]) => (
                    <div key={cat}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{cat}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const ids = svcs.map(s => s.id)
                            const allOn = ids.every(id => form.service_ids.includes(id))
                            setForm(prev => ({
                              ...prev,
                              service_ids: allOn
                                ? prev.service_ids.filter(id => !ids.includes(id))
                                : [...new Set([...prev.service_ids, ...ids])],
                            }))
                          }}
                          className="text-xs text-purple-500 hover:text-purple-700"
                        >
                          {svcs.every(s => form.service_ids.includes(s.id)) ? 'снять всё' : 'выбрать всё'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {svcs.map(svc => {
                          const checked = form.service_ids.includes(svc.id)
                          return (
                            <label
                              key={svc.id}
                              className={[
                                'flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm',
                                checked ? 'bg-purple-50 text-purple-800' : 'hover:bg-gray-50 text-gray-700',
                              ].join(' ')}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleService(svc.id)}
                                className="accent-purple-600"
                              />
                              <span className="flex-1 truncate">{svc.name}</span>
                              {svc.is_lab && <span className="text-xs flex-shrink-0">🧪</span>}
                              {svc.price > 0 && (
                                <span className="text-xs text-gray-400 flex-shrink-0">
                                  {svc.price.toLocaleString('ru')}
                                </span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
