'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// Default type presets (fallback when nothing saved yet)
const DEFAULT_TYPES = [
  { key: 'consultation', label: 'Консультация', color: '#3b82f6' },
  { key: 'procedure',    label: 'Процедура',    color: '#8b5cf6' },
  { key: 'checkup',      label: 'Осмотр',       color: '#10b981' },
  { key: 'followup',     label: 'Повторный',     color: '#06b6d4' },
  { key: 'surgery',      label: 'Операция',      color: '#f59e0b' },
  { key: 'emergency',    label: 'Срочно',        color: '#ef4444' },
  { key: 'other',        label: 'Другое',        color: '#6b7280' },
]

type ApptType = { key: string; label: string; color: string }

export default function SettingsSchedulePage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [types, setTypes]     = useState<ApptType[]>(DEFAULT_TYPES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')

  // Load saved types from clinic settings
  useEffect(() => {
    if (!clinicId) return
    supabase.from('clinics').select('settings').eq('id', clinicId).single()
      .then(({ data }) => {
        const saved = data?.settings?.appt_types as ApptType[] | undefined
        if (saved && Array.isArray(saved) && saved.length > 0) {
          setTypes(saved)
        }
        setLoading(false)
      })
  }, [clinicId])

  const updateType = (idx: number, field: 'label' | 'color', value: string) => {
    setTypes(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t))
    setSaved(false)
  }

  const addType = () => {
    setTypes(prev => [...prev, { key: `custom_${Date.now()}`, label: 'Новый тип', color: '#6b7280' }])
    setSaved(false)
  }

  const removeType = (idx: number) => {
    setTypes(prev => prev.filter((_, i) => i !== idx))
    setSaved(false)
  }

  const handleSave = async () => {
    if (!clinicId) return
    setSaving(true); setError(''); setSaved(false)

    // Get current settings first to merge
    const { data: current } = await supabase.from('clinics').select('settings').eq('id', clinicId).single()
    const currentSettings = (current?.settings as Record<string, unknown>) ?? {}

    const { error: err } = await supabase.from('clinics').update({
      settings: { ...currentSettings, appt_types: types },
    }).eq('id', clinicId)

    setSaving(false)
    if (err) { setError(err.message); return }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Типы записей и цвета</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Настройте названия и цвета типов приёмов. Эти типы появятся при создании записи в расписании.
        </p>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400 animate-pulse">
          Загрузка...
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_auto_auto] gap-4 px-5 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Название</p>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Цвет</p>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Удалить</p>
          </div>

          {/* Type rows */}
          <div className="divide-y divide-gray-50">
            {types.map((t, idx) => (
              <div key={t.key} className="grid grid-cols-[2fr_auto_auto] gap-4 items-center px-5 py-3.5">
                {/* Label */}
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.color }} />
                  <input
                    className={inputCls}
                    value={t.label}
                    onChange={e => updateType(idx, 'label', e.target.value)}
                    placeholder="Название типа"
                  />
                </div>

                {/* Color picker */}
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={t.color}
                    onChange={e => updateType(idx, 'color', e.target.value)}
                    className="w-9 h-9 rounded-lg border border-gray-200 cursor-pointer p-0.5 bg-white"
                    title="Выбрать цвет"
                  />
                  <span className="text-xs text-gray-400 font-mono w-16">{t.color}</span>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => removeType(idx)}
                  className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Удалить">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add new */}
          <div className="px-5 py-3 border-t border-gray-100">
            <button type="button" onClick={addType}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors">
              <span className="text-base font-bold leading-none">+</span>
              Добавить тип
            </button>
          </div>
        </div>
      )}

      {/* Preview */}
      {!loading && (
        <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Предпросмотр</p>
          <div className="flex flex-wrap gap-2">
            {types.map(t => (
              <span key={t.key}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: t.color }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white/60 flex-shrink-0" />
                {t.label || 'Без названия'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</p>
      )}

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-6 py-2.5 text-sm font-medium transition-colors">
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium flex items-center gap-1.5">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Сохранено
          </span>
        )}
      </div>
    </div>
  )
}
