'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── constants ───────────────────────────────────────────────────────────────

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

// ─── settings (localStorage) ─────────────────────────────────────────────────

const SETTINGS_KEY = 'crm_settings'

interface CrmSettings {
  leads_stages:   { key: string; label: string; color: string }[]
  medical_stages: { key: string; label: string; color: string }[]
  sources: string[]
}

function loadSettings(): CrmSettings {
  if (typeof window === 'undefined') return {
    leads_stages: DEFAULT_LEADS_STAGES,
    medical_stages: DEFAULT_MEDICAL_STAGES,
    sources: DEFAULT_SOURCES,
  }
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

const LOST_REASONS = [
  { value: 'expensive', label: 'Дорого' },
  { value: 'no_time',   label: 'Нет времени' },
  { value: 'no_answer', label: 'Не отвечает' },
  { value: 'not_ready', label: 'Не готов' },
  { value: 'other',     label: 'Другое' },
]

const PRIORITY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  hot:  { bg: 'bg-red-100',    text: 'text-red-600',    label: 'Горячий' },
  warm: { bg: 'bg-orange-100', text: 'text-orange-600', label: 'Тёплый' },
  cold: { bg: 'bg-blue-100',   text: 'text-blue-600',   label: 'Холодный' },
}

const INT_TYPES = [
  { value: 'call',     label: 'Звонок' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'note',     label: 'Заметка' },
  { value: 'email',    label: 'Email' },
]

const INT_ICON: Record<string, string> = {
  call: '📞', whatsapp: '💬', note: '📝', email: '✉️', visit: '🏥', sms: '📱',
}

// ─── types ───────────────────────────────────────────────────────────────────

interface DealRow {
  id: string
  patient_id: string
  funnel: string
  stage: string
  source: string | null
  priority: string
  notes: string | null
  status: string
  created_at: string
  patient: { id: string; full_name: string; phones: string[] } | null
}

interface Interaction {
  id: string
  type: string
  direction: string | null
  summary: string
  outcome: string | null
  created_at: string
}

interface Stage { key: string; label: string; color: string }

// ─── TransferModal ────────────────────────────────────────────────────────────

function TransferModal({ deal, medicalStages, clinicId, onClose, onTransferred }: {
  deal: DealRow
  medicalStages: Stage[]
  clinicId: string
  onClose: () => void
  onTransferred: () => void
}) {
  const supabase = createClient()
  const [targetStage, setTargetStage] = useState(medicalStages[0]?.key ?? 'checkup')
  const [saving, setSaving] = useState(false)

  const handleTransfer = async () => {
    setSaving(true)
    await supabase.from('deals').update({
      funnel: 'medical',
      stage: targetStage,
    }).eq('id', deal.id)
    setSaving(false)
    onTransferred()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 z-10">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Перевод в медицинскую воронку</h3>
        <p className="text-sm text-gray-400 mb-4">{deal.patient?.full_name}</p>

        <p className="text-xs font-medium text-gray-500 mb-2">Этап назначения</p>
        <div className="space-y-1.5 max-h-64 overflow-y-auto mb-5">
          {medicalStages.map(s => (
            <label key={s.key} className="flex items-center gap-3 cursor-pointer rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors">
              <input
                type="radio"
                name="target_stage"
                value={s.key}
                checked={targetStage === s.key}
                onChange={() => setTargetStage(s.key)}
                className="w-4 h-4"
              />
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-sm text-gray-700">{s.label}</span>
            </label>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={handleTransfer}
            disabled={saving}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
          >
            {saving ? 'Перевод...' : '→ Перевести'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── QuickAddForm ─────────────────────────────────────────────────────────────

function QuickAddForm({ stageKey, clinicId, sources, onCreated, onCancel }: {
  stageKey: string
  clinicId: string
  sources: string[]
  onCreated: () => void
  onCancel: () => void
}) {
  const supabase = createClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const { data: patient } = await supabase
        .from('patients')
        .insert({
          clinic_id: clinicId,
          full_name: name.trim(),
          phones: phone.trim() ? [phone.trim()] : [],
          gender: 'other',
          status: 'new',
          is_vip: false,
          balance_amount: 0,
          debt_amount: 0,
          tags: [],
        })
        .select('id')
        .single()

      if (!patient) { setSaving(false); return }

      const { data: deal } = await supabase
        .from('deals')
        .insert({
          clinic_id: clinicId,
          patient_id: patient.id,
          funnel: 'leads',
          stage: stageKey,
          source: source || null,
          priority: 'warm',
        })
        .select('id')
        .single()

      if (deal) {
        const due = new Date()
        due.setHours(due.getHours() + 1)
        await supabase.from('tasks').insert({
          clinic_id: clinicId,
          title: `Позвонить: ${name.trim()}`,
          type: 'call',
          priority: 'high',
          status: 'new',
          patient_id: patient.id,
          due_at: due.toISOString(),
        })
      }
      onCreated()
    } catch {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-blue-200 p-3 shadow-sm space-y-2">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Имя *"
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <input
        value={phone}
        onChange={e => setPhone(e.target.value)}
        placeholder="Телефон"
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <select
        value={source}
        onChange={e => setSource(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      >
        <option value="">Источник</option>
        {sources.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 border border-gray-200 text-gray-500 rounded-lg py-1.5 text-xs font-medium hover:bg-gray-50"
        >
          Отмена
        </button>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-1.5 text-xs font-medium"
        >
          {saving ? '...' : 'Добавить'}
        </button>
      </div>
    </form>
  )
}

// ─── DealCard ────────────────────────────────────────────────────────────────

function DealCard({ deal, sources, onDragStart, onClick, onTransfer }: {
  deal: DealRow
  sources: string[]
  onDragStart: (id: string) => void
  onClick: (deal: DealRow) => void
  onTransfer?: (deal: DealRow) => void
}) {
  const p = PRIORITY_STYLE[deal.priority] ?? PRIORITY_STYLE.warm
  const daysInStage = Math.floor((Date.now() - new Date(deal.created_at).getTime()) / (1000 * 60 * 60 * 24))
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(deal.id) }}
      onClick={() => onClick(deal)}
      className="bg-white rounded-lg border border-gray-100 p-3 shadow-sm hover:shadow-md transition-all cursor-pointer active:opacity-60 select-none"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="text-sm font-medium text-gray-900 leading-tight">
          {deal.patient?.full_name ?? '—'}
        </p>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${p.bg} ${p.text}`}>
          {p.label}
        </span>
      </div>
      {deal.patient?.phones?.[0] && (
        <p className="text-xs text-gray-400 mb-1">{deal.patient.phones[0]}</p>
      )}
      {deal.source && (
        <p className="text-xs text-gray-400">{deal.source}</p>
      )}
      {deal.notes && (
        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{deal.notes}</p>
      )}
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-300">
          {new Date(deal.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
        </p>
        {deal.funnel === 'leads' && onTransfer && (
          <button
            onClick={(e) => { e.stopPropagation(); onTransfer(deal) }}
            className="text-xs text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded px-1.5 py-0.5 font-medium transition-colors"
            title="Перевести в медицинскую воронку"
          >
            → В мед.
          </button>
        )}
      </div>
      {daysInStage > 0 && (
        <span className={`text-xs ${daysInStage > 7 ? 'text-red-400' : daysInStage > 3 ? 'text-orange-400' : 'text-gray-300'}`}>
          {daysInStage} дн.
        </span>
      )}
    </div>
  )
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({ col, deals, sources, clinicId, showQuickAdd, onDragStart, onDrop, onCardClick, onTransfer, onQuickAddToggle, onCreated }: {
  col: Stage
  deals: DealRow[]
  sources: string[]
  clinicId: string
  showQuickAdd: boolean
  onDragStart: (id: string) => void
  onDrop: (stage: string) => void
  onCardClick: (deal: DealRow) => void
  onTransfer?: (deal: DealRow) => void
  onQuickAddToggle: () => void
  onCreated: () => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div className="flex-shrink-0 w-56">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
          <span className="text-xs font-semibold text-gray-600 truncate">{col.label}</span>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">
          {deals.length}
        </span>
      </div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={() => { setOver(false); onDrop(col.key) }}
        className={[
          'min-h-20 rounded-xl p-1.5 space-y-2 transition-colors',
          over ? 'bg-blue-50 ring-2 ring-blue-200 ring-inset' : '',
        ].join(' ')}
      >
        {deals.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            sources={sources}
            onDragStart={onDragStart}
            onClick={onCardClick}
            onTransfer={onTransfer}
          />
        ))}
        {deals.length === 0 && !showQuickAdd && (
          <div className={[
            'text-center py-8 text-xs border border-dashed rounded-lg transition-colors',
            over ? 'border-blue-300 text-blue-400' : 'border-gray-200 text-gray-300',
          ].join(' ')}>
            Пусто
          </div>
        )}
      </div>

      {/* Quick add */}
      {showQuickAdd ? (
        <div className="mt-2">
          <QuickAddForm
            stageKey={col.key}
            clinicId={clinicId}
            sources={sources}
            onCreated={onCreated}
            onCancel={onQuickAddToggle}
          />
        </div>
      ) : (
        <button
          onClick={onQuickAddToggle}
          className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg py-2 transition-colors flex items-center justify-center gap-1"
        >
          <svg width="11" height="11" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          лид
        </button>
      )}
    </div>
  )
}

// ─── Stage auto-tasks ────────────────────────────────────────────────────────

const STAGE_TASKS: Record<string, string> = {
  'contact':            'Написать в WhatsApp: {name}',
  'in_progress':        'Позвонить: {name}',
  'primary_scheduled':  'Напомнить о консультации: {name}',
  'no_show':            'Выяснить причину неявки: {name}',
  'deciding':           'Позвонить, уточнить решение: {name}',
}

// ─── DealDrawer ───────────────────────────────────────────────────────────────

function DealDrawer({ deal, stages, sources, clinicId, onClose, onUpdate, onTransfer }: {
  deal: DealRow
  stages: Stage[]
  sources: string[]
  clinicId: string
  onClose: () => void
  onUpdate: () => void
  onTransfer?: (deal: DealRow) => void
}) {
  const supabase = createClient()
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [loadingInt, setLoadingInt] = useState(true)
  const [showLost, setShowLost] = useState(false)
  const [lostReason, setLostReason] = useState('no_answer')
  const [lostNotes, setLostNotes] = useState('')
  const [savingLost, setSavingLost] = useState(false)
  const [intType, setIntType] = useState('call')
  const [intSummary, setIntSummary] = useState('')
  const [savingInt, setSavingInt] = useState(false)

  const stageIdx = stages.findIndex(s => s.key === deal.stage)

  const loadInteractions = useCallback(async () => {
    setLoadingInt(true)
    const { data } = await supabase
      .from('crm_interactions')
      .select('id, type, direction, summary, outcome, created_at')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: false })
    setInteractions(data ?? [])
    setLoadingInt(false)
  }, [deal.id])

  useEffect(() => { loadInteractions() }, [loadInteractions])

  const moveStage = async (stage: string) => {
    await supabase.from('deals').update({ stage }).eq('id', deal.id)
    const taskTitle = STAGE_TASKS[stage]
    if (taskTitle) {
      const due = new Date()
      due.setHours(due.getHours() + 2)
      await supabase.from('tasks').insert({
        clinic_id: clinicId,
        title: taskTitle.replace('{name}', deal.patient?.full_name ?? ''),
        type: stage === 'no_show' ? 'call' : stage === 'contact' ? 'message' : 'call',
        priority: stage === 'no_show' ? 'high' : 'medium',
        status: 'new',
        patient_id: deal.patient_id,
        due_at: due.toISOString(),
      })
    }
    onUpdate()
    onClose()
  }

  const markLost = async () => {
    setSavingLost(true)
    await supabase.from('deals').update({
      status: 'lost',
      lost_reason: lostReason,
      lost_notes: lostNotes.trim() || null,
    }).eq('id', deal.id)
    setSavingLost(false)
    onUpdate()
    onClose()
  }

  const markWon = async () => {
    await supabase.from('deals').update({ status: 'won' }).eq('id', deal.id)
    onUpdate()
    onClose()
  }

  const addInteraction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!intSummary.trim()) return
    setSavingInt(true)
    await supabase.from('crm_interactions').insert({
      clinic_id: clinicId,
      deal_id: deal.id,
      patient_id: deal.patient_id,
      type: intType,
      direction: intType === 'note' ? null : 'outbound',
      summary: intSummary.trim(),
    })
    setIntSummary('')
    setSavingInt(false)
    loadInteractions()
  }

  const currentStage = stages.find(s => s.key === deal.stage)

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-base font-semibold text-gray-900 leading-tight">
              {deal.patient?.full_name ?? '—'}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {currentStage && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStage.color }} />
                  {currentStage.label}
                </span>
              )}
              {deal.patient?.phones?.[0] && (
                <span className="text-xs text-gray-400">{deal.patient.phones[0]}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {deal.funnel === 'leads' && onTransfer && (
              <button
                onClick={() => onTransfer(deal)}
                className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg px-2.5 py-1.5 font-medium transition-colors"
              >
                → В медицинскую
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Stage pills */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1 w-max">
            {stages.map((s, i) => (
              <button
                key={s.key}
                onClick={() => s.key !== deal.stage && moveStage(s.key)}
                className={[
                  'flex-shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition-colors',
                  i < stageIdx         ? 'bg-green-100 text-green-700' :
                  s.key === deal.stage ? 'text-white cursor-default' :
                                         'bg-gray-100 text-gray-500 hover:bg-gray-200',
                ].join(' ')}
                style={s.key === deal.stage ? { backgroundColor: s.color } : undefined}
              >
                {i < stageIdx ? '✓ ' : ''}{s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Meta */}
          <div className="px-5 py-4 border-b border-gray-50">
            <div className="flex items-center gap-2 flex-wrap">
              {(() => {
                const p = PRIORITY_STYLE[deal.priority] ?? PRIORITY_STYLE.warm
                return (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.bg} ${p.text}`}>
                    {p.label}
                  </span>
                )
              })()}
              {deal.source && (
                <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{deal.source}</span>
              )}
              <span className="text-xs text-gray-400">
                {new Date(deal.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              </span>
            </div>
            {deal.notes && (
              <p className="text-sm text-gray-600 mt-2 leading-relaxed">{deal.notes}</p>
            )}
          </div>

          {/* Add interaction */}
          <div className="px-5 py-4 border-b border-gray-50">
            <form onSubmit={addInteraction} className="space-y-2">
              <div className="flex gap-1">
                {INT_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setIntType(t.value)}
                    className={[
                      'flex-1 text-xs py-1.5 rounded-lg font-medium border transition-colors',
                      intType === t.value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50',
                    ].join(' ')}
                  >
                    {INT_ICON[t.value]} {t.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={intSummary}
                  onChange={e => setIntSummary(e.target.value)}
                  placeholder="Результат или заметка..."
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={savingInt || !intSummary.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg px-4 text-lg font-bold"
                >
                  +
                </button>
              </div>
            </form>
          </div>

          {/* History */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">История</p>
            {loadingInt ? (
              <p className="text-sm text-gray-400">Загрузка...</p>
            ) : interactions.length === 0 ? (
              <p className="text-sm text-gray-300 italic">Нет активностей</p>
            ) : (
              <div className="space-y-3">
                {interactions.map(i => (
                  <div key={i.id} className="flex gap-3">
                    <span className="text-base flex-shrink-0 mt-0.5">{INT_ICON[i.type] ?? '💬'}</span>
                    <div>
                      <p className="text-sm text-gray-800">{i.summary}</p>
                      {i.outcome && <p className="text-xs text-gray-400 mt-0.5">{i.outcome}</p>}
                      <p className="text-xs text-gray-300 mt-0.5">
                        {new Date(i.created_at).toLocaleString('ru-RU', {
                          day: 'numeric', month: 'short',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 flex gap-2">
          {stageIdx < stages.length - 1 && (
            <button
              onClick={() => moveStage(stages[stageIdx + 1].key)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              → {stages[stageIdx + 1]?.label}
            </button>
          )}
          {stageIdx === stages.length - 1 && (
            <button
              onClick={markWon}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              ✓ Выиграть
            </button>
          )}
          <button
            onClick={() => setShowLost(true)}
            className="px-4 py-2.5 border border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors"
          >
            Отказ
          </button>
        </div>
      </div>

      {/* Lost modal */}
      {showLost && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowLost(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 z-10">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Причина отказа</h3>
            <div className="space-y-2.5 mb-4">
              {LOST_REASONS.map(r => (
                <label key={r.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="lost_reason"
                    value={r.value}
                    checked={lostReason === r.value}
                    onChange={() => setLostReason(r.value)}
                    className="accent-red-500 w-4 h-4"
                  />
                  <span className="text-sm text-gray-700">{r.label}</span>
                </label>
              ))}
            </div>
            <textarea
              value={lostNotes}
              onChange={e => setLostNotes(e.target.value)}
              placeholder="Комментарий (необязательно)"
              rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-400 mb-4 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowLost(false)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50"
              >
                Отмена
              </button>
              <button
                onClick={markLost}
                disabled={savingLost}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
              >
                {savingLost ? 'Сохранение...' : 'Закрыть лид'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── CreateDealModal ──────────────────────────────────────────────────────────

function CreateDealModal({ clinicId, sources, onClose, onCreated }: {
  clinicId: string
  sources: string[]
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    gender: 'other' as 'male' | 'female' | 'other',
    source: '',
    priority: 'warm',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [phoneWarning, setPhoneWarning] = useState<string | null>(null)

  const set = (f: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [f]: e.target.value }))

  useEffect(() => {
    if (form.phone.trim().length < 7) { setPhoneWarning(null); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id, full_name')
        .contains('phones', [form.phone.trim()])
        .limit(1)
      if (data?.[0]) {
        setPhoneWarning(`Пациент с таким номером уже существует: ${data[0].full_name}`)
      } else {
        setPhoneWarning(null)
      }
    }, 500)
    return () => clearTimeout(t)
  }, [form.phone])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const { data: patient, error: pErr } = await supabase
        .from('patients')
        .insert({
          clinic_id: clinicId,
          full_name: form.full_name.trim(),
          phones: form.phone.trim() ? [form.phone.trim()] : [],
          gender: form.gender,
          status: 'new',
          is_vip: false,
          balance_amount: 0,
          debt_amount: 0,
          tags: [],
        })
        .select('id')
        .single()

      if (pErr) { setError(pErr.message); setSaving(false); return }

      const { data: deal, error: dErr } = await supabase
        .from('deals')
        .insert({
          clinic_id: clinicId,
          patient_id: patient.id,
          funnel: 'leads',
          stage: 'new',
          source: form.source || null,
          priority: form.priority,
          notes: form.notes.trim() || null,
        })
        .select('id')
        .single()

      if (dErr) { setError(dErr.message); setSaving(false); return }

      // Auto-create "call" task for new lead (rule D1)
      if (deal) {
        const due = new Date()
        due.setHours(due.getHours() + 1)
        await supabase.from('tasks').insert({
          clinic_id: clinicId,
          title: `Позвонить: ${form.full_name.trim()}`,
          type: 'call',
          priority: 'high',
          status: 'new',
          patient_id: patient.id,
          due_at: due.toISOString(),
        })
      }

      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Новый лид</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Имя <span className="text-red-400">*</span></label>
            <input
              className={inputCls} placeholder="Айгерим Бекова"
              value={form.full_name} onChange={set('full_name')}
              required autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Телефон</label>
              <input className={inputCls} placeholder="+7 700 000 0000" value={form.phone} onChange={set('phone')} />
              {phoneWarning && (
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center gap-1.5 mt-1.5">
                  ⚠️ {phoneWarning}
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Пол</label>
              <select className={inputCls} value={form.gender} onChange={set('gender')}>
                <option value="female">Женский</option>
                <option value="male">Мужской</option>
                <option value="other">Не указан</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Источник</label>
              <select className={inputCls} value={form.source} onChange={set('source')}>
                <option value="">— не указан —</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Приоритет</label>
              <select className={inputCls} value={form.priority} onChange={set('priority')}>
                <option value="hot">🔥 Горячий</option>
                <option value="warm">Тёплый</option>
                <option value="cold">Холодный</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Заметка</label>
            <textarea
              className={inputCls + ' resize-none'}
              placeholder="Интересуется процедурой..."
              rows={2}
              value={form.notes}
              onChange={set('notes')}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              {saving ? 'Создание...' : 'Создать лид'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CrmPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [deals, setDeals] = useState<DealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState<'leads' | 'medical'>('leads')
  const [selected, setSelected] = useState<DealRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [transferDeal, setTransferDeal] = useState<DealRow | null>(null)
  const [quickAddStage, setQuickAddStage] = useState<string | null>(null)
  const [settings, setSettings] = useState<CrmSettings>(() => loadSettings())

  const leadsStages = settings.leads_stages
  const medicalStages = settings.medical_stages
  const sources = settings.sources

  const stages = funnel === 'leads' ? leadsStages : medicalStages

  // Reload settings from localStorage when page gains focus (settings page may have updated)
  useEffect(() => {
    const onFocus = () => setSettings(loadSettings())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('deals')
      .select('*, patient:patients(id, full_name, phones)')
      .eq('funnel', funnel)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    setDeals((data ?? []) as DealRow[])
    setLoading(false)
  }, [funnel])

  useEffect(() => { load() }, [load])

  const handleDrop = async (stage: string) => {
    if (!dragId) return
    const deal = deals.find(d => d.id === dragId)
    if (!deal || deal.stage === stage) { setDragId(null); return }
    setDeals(prev => prev.map(d => d.id === dragId ? { ...d, stage } : d))
    const id = dragId
    setDragId(null)
    await supabase.from('deals').update({ stage }).eq('id', id)
    const taskTitle = STAGE_TASKS[stage]
    if (taskTitle) {
      const due = new Date()
      due.setHours(due.getHours() + 2)
      await supabase.from('tasks').insert({
        clinic_id: clinicId,
        title: taskTitle.replace('{name}', deal.patient?.full_name ?? ''),
        type: stage === 'no_show' ? 'call' : stage === 'contact' ? 'message' : 'call',
        priority: stage === 'no_show' ? 'high' : 'medium',
        status: 'new',
        patient_id: deal.patient_id,
        due_at: due.toISOString(),
      })
    }
  }

  const handleQuickCreated = () => {
    setQuickAddStage(null)
    load()
  }

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['leads', 'medical'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFunnel(f)}
              className={[
                'px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
                funnel === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {f === 'leads' ? '🎯 Лиды' : '🏥 Медицинская'}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-400">{deals.length} сделок</span>
        {deals.filter(d => Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000) > 7).length > 0 && (
          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
            ⚠ {deals.filter(d => Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000) > 7).length} зависших
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/crm/settings"
            className="text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 text-sm transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5"/>
            </svg>
            Настройки
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Новый лид
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">Загрузка...</div>
        ) : (
          <div className="flex gap-4 p-6 items-start min-w-max">
            {stages.map(col => (
              <KanbanColumn
                key={col.key}
                col={col}
                deals={deals.filter(d => d.stage === col.key)}
                sources={sources}
                clinicId={clinicId}
                showQuickAdd={quickAddStage === col.key && funnel === 'leads'}
                onDragStart={setDragId}
                onDrop={handleDrop}
                onCardClick={setSelected}
                onTransfer={funnel === 'leads' ? setTransferDeal : undefined}
                onQuickAddToggle={() => setQuickAddStage(prev => prev === col.key ? null : col.key)}
                onCreated={handleQuickCreated}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <DealDrawer
          deal={selected}
          stages={stages}
          sources={sources}
          clinicId={clinicId}
          onClose={() => setSelected(null)}
          onUpdate={load}
          onTransfer={funnel === 'leads' ? (d) => { setSelected(null); setTransferDeal(d) } : undefined}
        />
      )}

      {showCreate && clinicId && (
        <CreateDealModal
          clinicId={clinicId}
          sources={sources}
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); setShowCreate(false) }}
        />
      )}

      {transferDeal && clinicId && (
        <TransferModal
          deal={transferDeal}
          medicalStages={medicalStages}
          clinicId={clinicId}
          onClose={() => setTransferDeal(null)}
          onTransferred={() => { load(); setTransferDeal(null) }}
        />
      )}
    </div>
  )
}
