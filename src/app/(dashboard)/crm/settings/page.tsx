'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ─── defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_LEADS_STAGES = [
  { key: 'new',         label: 'Неразобранное', color: '#94a3b8' },
  { key: 'in_progress', label: 'В работе',       color: '#3b82f6' },
  { key: 'contact',     label: 'Касание',        color: '#f59e0b' },
  { key: 'booked',      label: 'Записан',        color: '#10b981' },
]

const DEFAULT_MEDICAL_STAGES = [
  { key: 'checkup',              label: 'Чек-ап',                             color: '#6366f1' },
  { key: 'tirzepatide_service',  label: 'Запись на услугу тирзепатид',        color: '#8b5cf6' },
  { key: 'primary_scheduled',   label: 'Назначена первичная консультация',   color: '#3b82f6' },
  { key: 'no_show',              label: 'Не пришел',                          color: '#ef4444' },
  { key: 'primary_done',        label: 'Проведена первичная консультация',   color: '#10b981' },
  { key: 'secondary_scheduled', label: 'Назначена вторичная консультация',   color: '#06b6d4' },
  { key: 'secondary_done',      label: 'Проведена вторичная консультация',   color: '#0891b2' },
  { key: 'deciding',            label: 'Принимают решение',                  color: '#f59e0b' },
  { key: 'treatment',           label: 'Лечение',                            color: '#84cc16' },
  { key: 'tirzepatide_tx',      label: 'Лечение тирзепатид',                 color: '#22c55e' },
  { key: 'control_tests',       label: 'Контрольные анализы',                color: '#14b8a6' },
  { key: 'people',              label: 'Люди',                               color: '#a78bfa' },
  { key: 'success',             label: 'Успешно реализована',                color: '#16a34a' },
  { key: 'failed',              label: 'Не реализована',                     color: '#dc2626' },
  { key: 'closed',              label: 'Закрыто',                            color: '#6b7280' },
]

const DEFAULT_SOURCES = ['Таргет', 'Instagram', 'WhatsApp', 'Рекомендация', 'Сайт', '2GIS']

const SETTINGS_KEY = 'crm_settings'

interface Stage { key: string; label: string; color: string }

interface CrmSettings {
  leads_stages: Stage[]
  medical_stages: Stage[]
  sources: string[]
}

function loadSettings(): CrmSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { leads_stages: DEFAULT_LEADS_STAGES, medical_stages: DEFAULT_MEDICAL_STAGES, sources: DEFAULT_SOURCES }
    const parsed = JSON.parse(raw) as Partial<CrmSettings>
    return {
      leads_stages:   parsed.leads_stages   ?? DEFAULT_LEADS_STAGES,
      medical_stages: parsed.medical_stages ?? DEFAULT_MEDICAL_STAGES,
      sources:        parsed.sources        ?? DEFAULT_SOURCES,
    }
  } catch { return { leads_stages: DEFAULT_LEADS_STAGES, medical_stages: DEFAULT_MEDICAL_STAGES, sources: DEFAULT_SOURCES } }
}

// ─── StageList ────────────────────────────────────────────────────────────────

function StageList({ stages, onChange }: {
  stages: Stage[]
  onChange: (stages: Stage[]) => void
}) {
  const updateLabel = (idx: number, label: string) => {
    onChange(stages.map((s, i) => i === idx ? { ...s, label } : s))
  }
  const updateColor = (idx: number, color: string) => {
    onChange(stages.map((s, i) => i === idx ? { ...s, color } : s))
  }

  return (
    <div className="space-y-2">
      {stages.map((stage, idx) => (
        <div key={stage.key} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
          <input
            type="color"
            value={stage.color}
            onChange={e => updateColor(idx, e.target.value)}
            className="w-7 h-7 rounded-lg border-0 cursor-pointer p-0 bg-transparent"
            title="Цвет этапа"
          />
          <span className="text-xs text-gray-400 w-36 truncate font-mono flex-shrink-0">{stage.key}</span>
          <input
            type="text"
            value={stage.label}
            onChange={e => updateLabel(idx, e.target.value)}
            className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      ))}
    </div>
  )
}

// ─── SourcesList ──────────────────────────────────────────────────────────────

function SourcesList({ sources, onChange }: {
  sources: string[]
  onChange: (sources: string[]) => void
}) {
  const [newSource, setNewSource] = useState('')

  const add = () => {
    const trimmed = newSource.trim()
    if (!trimmed || sources.includes(trimmed)) return
    onChange([...sources, trimmed])
    setNewSource('')
  }

  const remove = (idx: number) => {
    onChange(sources.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {sources.map((s, idx) => (
          <span
            key={idx}
            className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-700 text-sm rounded-full px-3 py-1"
          >
            {s}
            <button
              onClick={() => remove(idx)}
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newSource}
          onChange={e => setNewSource(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Новый источник..."
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={add}
          disabled={!newSource.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 text-sm font-medium"
        >
          + Добавить
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CrmSettingsPage() {
  const [settings, setSettings] = useState<CrmSettings>({
    leads_stages: DEFAULT_LEADS_STAGES,
    medical_stages: DEFAULT_MEDICAL_STAGES,
    sources: DEFAULT_SOURCES,
  })
  const [saved, setSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'leads' | 'medical' | 'sources'>('leads')

  useEffect(() => {
    setSettings(loadSettings())
  }, [])

  const save = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const resetToDefaults = () => {
    const defaults: CrmSettings = {
      leads_stages: DEFAULT_LEADS_STAGES,
      medical_stages: DEFAULT_MEDICAL_STAGES,
      sources: DEFAULT_SOURCES,
    }
    setSettings(defaults)
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaults))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const tabs: { key: typeof activeTab; label: string }[] = [
    { key: 'leads',   label: '🎯 Этапы лидов' },
    { key: 'medical', label: '🏥 Медицинские этапы' },
    { key: 'sources', label: '📣 Источники' },
  ]

  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/crm"
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Настройки CRM</h1>
            <p className="text-sm text-gray-400">Этапы воронок и источники лидов</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={resetToDefaults}
            className="text-sm text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 transition-colors"
          >
            Сбросить
          </button>
          <button
            onClick={save}
            className={[
              'text-sm font-medium rounded-lg px-4 py-2 transition-all',
              saved
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-blue-600 hover:bg-blue-700 text-white',
            ].join(' ')}
          >
            {saved ? '✓ Сохранено' : 'Сохранить'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={[
              'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors',
              activeTab === t.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        {activeTab === 'leads' && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-gray-800">Этапы воронки лидов</h2>
            </div>
            <p className="text-xs text-gray-400 mb-4">Изменяйте названия и цвета колонок. Порядок фиксирован.</p>
            <StageList
              stages={settings.leads_stages}
              onChange={leads_stages => setSettings(s => ({ ...s, leads_stages }))}
            />
          </div>
        )}

        {activeTab === 'medical' && (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold text-gray-800">Медицинские этапы</h2>
            </div>
            <p className="text-xs text-gray-400 mb-4">Изменяйте названия и цвета колонок. Порядок фиксирован.</p>
            <StageList
              stages={settings.medical_stages}
              onChange={medical_stages => setSettings(s => ({ ...s, medical_stages }))}
            />
          </div>
        )}

        {activeTab === 'sources' && (
          <div>
            <h2 className="text-sm font-semibold text-gray-800 mb-1">Источники лидов</h2>
            <p className="text-xs text-gray-400 mb-4">Управляйте списком источников, которые отображаются при создании лида.</p>
            <SourcesList
              sources={settings.sources}
              onChange={sources => setSettings(s => ({ ...s, sources }))}
            />
          </div>
        )}
      </div>

      {/* Save reminder */}
      <p className="text-xs text-gray-400 text-center mt-4">
        Настройки хранятся локально в браузере
      </p>
    </div>
  )
}
