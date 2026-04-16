'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────── */
interface Stage { key: string; label: string; color: string }

interface CrmConfig {
  leads_stages:   Stage[]
  medical_stages: Stage[]
  sources:        string[]
  lost_reasons:   { value: string; label: string }[]
}

const DEFAULT_LEADS: Stage[] = [
  { key: 'new',         label: 'Неразобранное', color: '#94a3b8' },
  { key: 'in_progress', label: 'В работе',       color: '#3b82f6' },
  { key: 'contact',     label: 'Касание',        color: '#f59e0b' },
  { key: 'booked',      label: 'Записан',        color: '#10b981' },
]

const DEFAULT_MEDICAL: Stage[] = [
  { key: 'primary_scheduled',   label: 'Назначена первичная консультация',  color: '#3b82f6' },
  { key: 'primary_done',        label: 'Проведена первичная консультация',  color: '#10b981' },
  { key: 'secondary_scheduled', label: 'Назначена вторичная консультация',  color: '#06b6d4' },
  { key: 'secondary_done',      label: 'Проведена вторичная консультация',  color: '#0891b2' },
  { key: 'deciding',            label: 'Принимают решение',                 color: '#f59e0b' },
  { key: 'treatment',           label: 'Лечение',                           color: '#84cc16' },
  { key: 'success',             label: 'Успешно реализована',               color: '#16a34a' },
  { key: 'failed',              label: 'Не реализована',                    color: '#dc2626' },
]

const DEFAULT_SOURCES = ['Таргет', 'Instagram', 'WhatsApp', 'Рекомендация', 'Сайт', '2GIS']

const DEFAULT_LOST_REASONS = [
  { value: 'expensive', label: 'Дорого' },
  { value: 'no_time',   label: 'Нет времени' },
  { value: 'no_answer', label: 'Не отвечает' },
  { value: 'not_ready', label: 'Не готов' },
  { value: 'other',     label: 'Другое' },
]

const PRESET_COLORS = ['#94a3b8','#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#0891b2','#16a34a','#dc2626']

const SETTINGS_KEY = 'crm_config'
const LS_KEY       = 'crm_settings'

const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

/* ─── Stage list editor ───────────────────────────────────── */
function StageEditor({ stages, onChange }: {
  stages: Stage[]
  onChange: (s: Stage[]) => void
}) {
  const [adding, setAdding]       = useState(false)
  const [newLabel, setNewLabel]   = useState('')
  const [newColor, setNewColor]   = useState('#3b82f6')

  const add = () => {
    if (!newLabel.trim()) return
    const key = newLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    onChange([...stages, { key: key || `stage_${Date.now()}`, label: newLabel.trim(), color: newColor }])
    setNewLabel(''); setAdding(false)
  }

  const update = (idx: number, field: keyof Stage, val: string) => {
    onChange(stages.map((s, i) => i === idx ? { ...s, [field]: val } : s))
  }

  const remove = (idx: number) => onChange(stages.filter((_, i) => i !== idx))

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...stages]
    const tmp = next[idx]!; next[idx] = next[idx + dir]!; next[idx + dir] = tmp
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          {/* Move buttons */}
          <div className="flex flex-col gap-0.5 flex-shrink-0">
            <button onClick={() => i > 0 && move(i, -1)} disabled={i === 0}
              className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none text-xs">▲</button>
            <button onClick={() => i < stages.length - 1 && move(i, 1)} disabled={i === stages.length - 1}
              className="text-gray-300 hover:text-gray-600 disabled:opacity-20 leading-none text-xs">▼</button>
          </div>
          {/* Color */}
          <input type="color" value={s.color}
            onChange={e => update(i, 'color', e.target.value)}
            className="w-6 h-6 rounded-full border-0 cursor-pointer flex-shrink-0 p-0" />
          {/* Label */}
          <input className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            value={s.label} onChange={e => update(i, 'label', e.target.value)} />
          {/* Remove */}
          <button onClick={() => remove(i)}
            className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0 text-lg leading-none">×</button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 border border-blue-200 rounded-lg px-3 py-2 bg-blue-50">
          {/* Color picker */}
          <div className="flex gap-1 flex-shrink-0 flex-wrap">
            {PRESET_COLORS.slice(0, 6).map(c => (
              <button key={c} type="button"
                onClick={() => setNewColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 ${newColor === c ? 'border-gray-500 scale-110' : 'border-transparent'}`}
                style={{ background: c }} />
            ))}
          </div>
          <input className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Название этапа…" value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            autoFocus />
          <button onClick={add}
            className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded-md font-medium flex-shrink-0">
            Добавить
          </button>
          <button onClick={() => setAdding(false)}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0">×</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="w-full text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg py-2 border border-dashed border-gray-200 hover:border-blue-300 transition-colors flex items-center justify-center gap-1">
          + Добавить этап
        </button>
      )}
    </div>
  )
}

/* ─── String list editor ──────────────────────────────────── */
function ListEditor({ items, onChange, placeholder }: {
  items: string[]
  onChange: (s: string[]) => void
  placeholder: string
}) {
  const [newItem, setNewItem] = useState('')

  const add = () => {
    if (!newItem.trim() || items.includes(newItem.trim())) return
    onChange([...items, newItem.trim()]); setNewItem('')
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">
          {item}
          <button onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-gray-400 hover:text-red-500 ml-1 leading-none">×</button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input className="border border-gray-200 rounded-full px-3 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500 w-36"
          placeholder={placeholder} value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button onClick={add}
          className="text-xs bg-gray-800 text-white px-2.5 py-1 rounded-full font-medium">+</button>
      </div>
    </div>
  )
}

/* ─── Page ────────────────────────────────────────────────── */
export default function CrmSettingsPage() {
  const supabase    = createClient()
  const { profile } = useAuthStore()
  const clinicId    = profile?.clinic_id ?? ''

  const [config, setConfig] = useState<CrmConfig>({
    leads_stages:   DEFAULT_LEADS,
    medical_stages: DEFAULT_MEDICAL,
    sources:        DEFAULT_SOURCES,
    lost_reasons:   DEFAULT_LOST_REASONS,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState(false)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const { data } = await supabase.from('clinics').select('settings').eq('id', clinicId).single()

    // Try DB first, then fallback to localStorage
    const dbConfig = data?.settings?.[SETTINGS_KEY] as CrmConfig | undefined
    if (dbConfig) {
      setConfig({
        leads_stages:   dbConfig.leads_stages   ?? DEFAULT_LEADS,
        medical_stages: dbConfig.medical_stages ?? DEFAULT_MEDICAL,
        sources:        dbConfig.sources        ?? DEFAULT_SOURCES,
        lost_reasons:   dbConfig.lost_reasons   ?? DEFAULT_LOST_REASONS,
      })
    } else if (typeof window !== 'undefined') {
      // Migrate from localStorage
      try {
        const ls = localStorage.getItem(LS_KEY)
        if (ls) {
          const parsed = JSON.parse(ls)
          setConfig({
            leads_stages:   parsed.leads_stages   ?? DEFAULT_LEADS,
            medical_stages: parsed.medical_stages ?? DEFAULT_MEDICAL,
            sources:        parsed.sources        ?? DEFAULT_SOURCES,
            lost_reasons:   parsed.lost_reasons   ?? DEFAULT_LOST_REASONS,
          })
        }
      } catch { /* ignore */ }
    }
    setLoading(false)
  }, [clinicId])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!clinicId) return
    setSaving(true)
    const { data: current } = await supabase.from('clinics').select('settings').eq('id', clinicId).single()
    const newSettings = { ...(current?.settings ?? {}), [SETTINGS_KEY]: config }
    await supabase.from('clinics').update({ settings: newSettings }).eq('id', clinicId)

    // Also update localStorage so CRM page picks it up immediately
    if (typeof window !== 'undefined') {
      localStorage.setItem(LS_KEY, JSON.stringify({
        leads_stages:   config.leads_stages,
        medical_stages: config.medical_stages,
        sources:        config.sources,
      }))
    }

    setSaving(false)
    setToast(true); setTimeout(() => setToast(false), 3000)
  }

  const upd = <K extends keyof CrmConfig>(k: K, v: CrmConfig[K]) =>
    setConfig(prev => ({ ...prev, [k]: v }))

  const sectionHd = 'text-sm font-semibold text-gray-900 mb-3 pb-2 border-b border-gray-100'

  if (loading) return <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>

  return (
    <div>
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-green-600 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg">
          ✓ Настройки CRM сохранены
        </div>
      )}

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Настройки CRM</h2>
          <p className="text-sm text-gray-400">Воронки, этапы, источники лидов</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors">
          {saving ? 'Сохранение...' : 'Сохранить'}
        </button>
      </div>

      <div className="space-y-5">
        {/* Leads funnel */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className={sectionHd}>Воронка лидов</h3>
          <p className="text-xs text-gray-400 mb-3">Этапы работы с новыми обращениями (первичная воронка)</p>
          <StageEditor stages={config.leads_stages} onChange={v => upd('leads_stages', v)} />
        </div>

        {/* Medical funnel */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className={sectionHd}>Медицинская воронка</h3>
          <p className="text-xs text-gray-400 mb-3">Этапы лечебного процесса после первичного обращения</p>
          <StageEditor stages={config.medical_stages} onChange={v => upd('medical_stages', v)} />
        </div>

        {/* Sources */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className={sectionHd}>Источники лидов</h3>
          <p className="text-xs text-gray-400 mb-3">Откуда пришли пациенты / каналы привлечения</p>
          <ListEditor items={config.sources} onChange={v => upd('sources', v)} placeholder="Новый источник…" />
        </div>

        {/* Lost reasons */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className={sectionHd}>Причины закрытия (отказ)</h3>
          <p className="text-xs text-gray-400 mb-3">Варианты при пометке сделки как «Не реализована»</p>
          <div className="flex flex-wrap gap-2">
            {config.lost_reasons.map((r, i) => (
              <div key={i} className="flex items-center gap-1 bg-red-50 text-red-700 text-sm px-3 py-1 rounded-full">
                <input
                  className="bg-transparent outline-none w-28 text-sm"
                  value={r.label}
                  onChange={e => upd('lost_reasons', config.lost_reasons.map((x, j) =>
                    j === i ? { ...x, label: e.target.value } : x
                  ))} />
                <button
                  onClick={() => upd('lost_reasons', config.lost_reasons.filter((_, j) => j !== i))}
                  className="text-red-300 hover:text-red-600 leading-none">×</button>
              </div>
            ))}
            <button
              onClick={() => upd('lost_reasons', [...config.lost_reasons, { value: `reason_${Date.now()}`, label: 'Новая причина' }])}
              className="text-xs bg-red-50 text-red-400 hover:text-red-600 px-3 py-1 rounded-full border border-dashed border-red-200 hover:border-red-400 transition-colors">
              + Добавить
            </button>
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-5">
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors">
          {saving ? 'Сохранение...' : 'Сохранить настройки CRM'}
        </button>
      </div>
    </div>
  )
}
