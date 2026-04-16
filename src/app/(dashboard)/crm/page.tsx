'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import {
  SOURCE_OPTIONS,
  normalizeSource,
  sourceLabel,
  PRIORITY_OPTIONS,
  LOST_REASON_OPTIONS,
  INTERACTION_TYPE_OPTIONS,
} from '@/lib/crm/constants'
import {
  PHONE_PREFIX,
  formatPhoneInput,
  normalizePhoneKZ,
  isValidPhoneKZ,
  formatPhoneDisplay,
  onPhoneKeyDown,
} from '@/lib/utils/phone'

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

// Display list (Russian labels) — but every <select> below uses SOURCE_OPTIONS
// directly to ensure the DB-safe value is sent.  Kept only for legacy
// fallback when reading settings written by older versions.
const DEFAULT_SOURCES: string[] = SOURCE_OPTIONS.map(o => o.label)

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

// Backed by the central dictionary — same shape as before.
const LOST_REASONS = LOST_REASON_OPTIONS.map(o => ({ value: o.value, label: o.label }))

const PRIORITY_STYLE: Record<string, { bg: string; text: string; label: string }> =
  Object.fromEntries(
    PRIORITY_OPTIONS.map(o => [o.value, { bg: o.bg, text: o.text, label: o.label }]),
  )

const INT_TYPES = INTERACTION_TYPE_OPTIONS
  .filter(o => ['call', 'whatsapp', 'note', 'email'].includes(o.value))
  .map(o => ({ value: o.value, label: o.label }))

const INT_ICON: Record<string, string> = Object.fromEntries(
  INTERACTION_TYPE_OPTIONS.map(o => [o.value, o.icon]),
)

const PERIOD_OPTS = [
  { key: 'all',   label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'week',  label: '7 дней' },
  { key: 'month', label: '30 дней' },
] as const
type PeriodKey = typeof PERIOD_OPTS[number]['key']

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
  // amoCRM extensions (may be undefined if migration not yet run)
  deal_value?: number | null
  expected_close_date?: string | null
  tags?: string[] | null
  assigned_to?: string | null
  first_owner_id?: string | null
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

interface TaskRow {
  id: string
  title: string
  type: string | null
  priority: string
  status: string
  due_at: string | null
  assigned_to: string | null
  created_at: string
}

interface UserOption {
  id: string
  name: string
  avatar_url: string | null
}

interface Stage { key: string; label: string; color: string }

// ─── helpers ─────────────────────────────────────────────────────────────────

const fmtTenge = (n: number | null | undefined) => {
  if (n === null || n === undefined || isNaN(Number(n))) return ''
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(n)) + ' ₸'
}

const daysSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

const periodCutoff = (p: PeriodKey): number | null => {
  const now = Date.now()
  if (p === 'today') return now - 86400000
  if (p === 'week')  return now - 7 * 86400000
  if (p === 'month') return now - 30 * 86400000
  return null
}

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·'
}

// ─── TransferModal ────────────────────────────────────────────────────────────

function TransferModal({ deal, medicalStages, onClose, onTransferred }: {
  deal: DealRow
  medicalStages: Stage[]
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
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={handleTransfer} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
            {saving ? 'Перевод...' : '→ Перевести'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── QuickAddForm ─────────────────────────────────────────────────────────────

function QuickAddForm({ stageKey, clinicId, onCreated, onCancel }: {
  stageKey: string
  clinicId: string
  onCreated: () => void
  onCancel: () => void
}) {
  const supabase = createClient()
  const [name, setName]     = useState('')
  const [phone, setPhone]   = useState(PHONE_PREFIX)
  const [source, setSource] = useState<string>('')  // stores normalized DB value
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const phoneValid = isValidPhoneKZ(phone)
  const phoneTouched = phone.length > PHONE_PREFIX.length
  const canSubmit = name.trim().length > 0 && (!phoneTouched || phoneValid)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setError(null)
    setSaving(true)
    try {
      const normalizedPhone = normalizePhoneKZ(phone)
      if (phoneTouched && !normalizedPhone) {
        setError('Введите полный номер телефона (+77XXXXXXXXX)')
        setSaving(false)
        return
      }

      // Dedup by phone
      if (normalizedPhone) {
        const { data: existing } = await supabase
          .from('patients')
          .select('id, full_name')
          .contains('phones', [normalizedPhone])
          .limit(1)
        if (existing?.[0]) {
          setError(`Пациент уже существует: ${existing[0].full_name}`)
          setSaving(false)
          return
        }
      }

      const { data: patient, error: pErr } = await supabase
        .from('patients')
        .insert({
          clinic_id: clinicId,
          full_name: name.trim(),
          phones: normalizedPhone ? [normalizedPhone] : [],
          gender: 'other',
          status: 'new',
          is_vip: false,
          balance_amount: 0,
          debt_amount: 0,
          tags: [],
        })
        .select('id')
        .single()

      if (pErr || !patient) { setError(pErr?.message ?? 'Ошибка создания пациента'); setSaving(false); return }

      const { data: deal, error: dErr } = await supabase
        .from('deals')
        .insert({
          clinic_id: clinicId,
          patient_id: patient.id,
          funnel: 'leads',
          stage: stageKey,
          source: normalizeSource(source),      // null or DB-safe enum
          priority: 'warm',
          notes: notes.trim() || null,
        })
        .select('id')
        .single()

      if (dErr || !deal) { setError(dErr?.message ?? 'Ошибка создания сделки'); setSaving(false); return }

      // Auto-create the first "call" task — always linked via deal_id.
      const due = new Date()
      due.setHours(due.getHours() + 1)
      await supabase.from('tasks').insert({
        clinic_id: clinicId,
        title: `Позвонить: ${name.trim()}`,
        type: 'call',
        priority: 'high',
        status: 'new',
        patient_id: patient.id,
        deal_id: deal.id,
        due_at: due.toISOString(),
      })

      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка')
      setSaving(false)
    }
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-blue-200 p-3 shadow-sm space-y-2">
      <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Имя *"
        className={inputCls} />
      <input
        type="tel"
        value={phone}
        onChange={e => setPhone(formatPhoneInput(e.target.value))}
        onKeyDown={onPhoneKeyDown}
        placeholder={PHONE_PREFIX + ' XXXXXXXXX'}
        className={inputCls + (phoneTouched && !phoneValid ? ' border-orange-300' : '')} />
      <select value={source} onChange={e => setSource(e.target.value)}
        className={inputCls + ' bg-white'}>
        <option value="">Источник</option>
        {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Заметка"
        rows={2} className={inputCls + ' resize-none'} />
      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1">{error}</p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 border border-gray-200 text-gray-500 rounded-lg py-1.5 text-xs font-medium hover:bg-gray-50">
          Отмена
        </button>
        <button type="submit" disabled={saving || !canSubmit} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-1.5 text-xs font-medium">
          {saving ? '...' : 'Добавить'}
        </button>
      </div>
    </form>
  )
}

// ─── DealCard ────────────────────────────────────────────────────────────────

function DealCard({ deal, owners, selected, selectMode, onToggleSelect, onDragStart, onClick, onTransfer }: {
  deal: DealRow
  owners: UserOption[]
  selected: boolean
  selectMode: boolean
  onToggleSelect: (id: string) => void
  onDragStart: (id: string) => void
  onClick: (deal: DealRow) => void
  onTransfer?: (deal: DealRow) => void
}) {
  const p = PRIORITY_STYLE[deal.priority] ?? PRIORITY_STYLE.warm
  const days = daysSince(deal.created_at)
  const stale = days > 7
  const owner = owners.find(o => o.id === (deal.assigned_to ?? deal.first_owner_id))

  return (
    <div
      draggable={!selectMode}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(deal.id) }}
      onClick={() => selectMode ? onToggleSelect(deal.id) : onClick(deal)}
      className={[
        'rounded-lg border p-3 shadow-sm hover:shadow-md transition-all cursor-pointer active:opacity-60 select-none',
        selected ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200' : 'bg-white border-gray-100',
        stale && !selected ? 'border-l-2 border-l-orange-400' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-start gap-2 min-w-0">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => { e.stopPropagation(); onToggleSelect(deal.id) }}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 w-4 h-4 accent-blue-600 flex-shrink-0"
            />
          )}
          <p className="text-sm font-medium text-gray-900 leading-tight truncate">
            {deal.patient?.full_name ?? '—'}
          </p>
        </div>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${p.bg} ${p.text}`}>
          {p.label}
        </span>
      </div>

      {/* Value (highlighted) */}
      {deal.deal_value != null && Number(deal.deal_value) > 0 && (
        <p className="text-sm font-semibold text-emerald-600 mb-1">{fmtTenge(deal.deal_value)}</p>
      )}

      {deal.patient?.phones?.[0] && (
        <p className="text-xs text-gray-400 mb-1">{formatPhoneDisplay(deal.patient.phones[0])}</p>
      )}
      {deal.source && (
        <p className="text-xs text-gray-400">{sourceLabel(deal.source)}</p>
      )}

      {/* Tags */}
      {deal.tags && deal.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {deal.tags.slice(0, 3).map(t => (
            <span key={t} className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">#{t}</span>
          ))}
          {deal.tags.length > 3 && <span className="text-[10px] text-gray-400">+{deal.tags.length - 3}</span>}
        </div>
      )}

      {deal.notes && (
        <p className="text-xs text-gray-500 mt-1.5 line-clamp-2 leading-relaxed">{deal.notes}</p>
      )}

      <div className="flex items-center justify-between mt-2 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Owner avatar */}
          {owner && (
            <span
              title={owner.name}
              className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0"
            >
              {initials(owner.name)}
            </span>
          )}
          <p className="text-xs text-gray-300 truncate">
            {new Date(deal.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
          </p>
        </div>
        {deal.funnel === 'leads' && onTransfer && !selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onTransfer(deal) }}
            className="text-xs text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded px-1.5 py-0.5 font-medium transition-colors flex-shrink-0"
            title="Перевести в медицинскую воронку"
          >
            → В мед.
          </button>
        )}
      </div>

      {days > 0 && (
        <span className={`text-xs ${days > 7 ? 'text-red-400' : days > 3 ? 'text-orange-400' : 'text-gray-300'}`}>
          {days} дн.
        </span>
      )}
    </div>
  )
}

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

function KanbanColumn({
  col, deals, owners, clinicId, showQuickAdd, selectedIds, selectMode,
  onDragStart, onDrop, onCardClick, onTransfer, onQuickAddToggle, onCreated, onToggleSelect,
}: {
  col: Stage
  deals: DealRow[]
  owners: UserOption[]
  clinicId: string
  showQuickAdd: boolean
  selectedIds: Set<string>
  selectMode: boolean
  onDragStart: (id: string) => void
  onDrop: (stage: string) => void
  onCardClick: (deal: DealRow) => void
  onTransfer?: (deal: DealRow) => void
  onQuickAddToggle: () => void
  onCreated: () => void
  onToggleSelect: (id: string) => void
}) {
  const [over, setOver] = useState(false)

  const sumValue = deals.reduce((sum, d) => sum + Number(d.deal_value ?? 0), 0)

  return (
    <div className="flex-shrink-0 w-60">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: col.color }} />
          <span className="text-xs font-semibold text-gray-600 truncate">{col.label}</span>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5 flex-shrink-0">
          {deals.length}
        </span>
      </div>

      {/* Stage value sum */}
      {sumValue > 0 && (
        <p className="text-[11px] text-emerald-600 font-medium mb-2 px-1">{fmtTenge(sumValue)}</p>
      )}

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
            owners={owners}
            selected={selectedIds.has(deal.id)}
            selectMode={selectMode}
            onToggleSelect={onToggleSelect}
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

function DealDrawer({ deal, stages, owners, clinicId, onClose, onUpdate, onTransfer }: {
  deal: DealRow
  stages: Stage[]
  owners: UserOption[]
  clinicId: string
  onClose: () => void
  onUpdate: () => void
  onTransfer?: (deal: DealRow) => void
}) {
  const supabase = createClient()
  const [interactions, setInteractions] = useState<Interaction[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loadingInt, setLoadingInt] = useState(true)
  const [showLost, setShowLost] = useState(false)
  const [lostReason, setLostReason] = useState('no_answer')
  const [lostNotes, setLostNotes] = useState('')
  const [savingLost, setSavingLost] = useState(false)
  const [intType, setIntType] = useState('call')
  const [intSummary, setIntSummary] = useState('')
  const [savingInt, setSavingInt] = useState(false)

  // Editable fields
  const [dealValue, setDealValue]      = useState<string>(String(deal.deal_value ?? ''))
  const [expectedDate, setExpectedDate] = useState<string>(deal.expected_close_date ?? '')
  const [tagsInput, setTagsInput]      = useState<string>(deal.tags?.join(', ') ?? '')
  const [assignedTo, setAssignedTo]    = useState<string>(deal.assigned_to ?? '')
  const [priorityVal, setPriorityVal]  = useState<string>(deal.priority)
  const [sourceVal, setSourceVal]      = useState<string>(deal.source ?? '')

  // New task quick form
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDue, setNewTaskDue]     = useState('')
  const [newTaskType, setNewTaskType]   = useState('call')
  const [savingTask, setSavingTask]     = useState(false)

  const stageIdx = stages.findIndex(s => s.key === deal.stage)

  const loadInteractions = useCallback(async () => {
    setLoadingInt(true)
    const [intRes, taskRes] = await Promise.all([
      supabase.from('crm_interactions')
        .select('id, type, direction, summary, outcome, created_at')
        .eq('deal_id', deal.id)
        .order('created_at', { ascending: false }),
      supabase.from('tasks')
        .select('id, title, type, priority, status, due_at, assigned_to, created_at')
        .eq('deal_id', deal.id)
        .order('due_at', { ascending: true, nullsFirst: false }),
    ])
    setInteractions((intRes.data ?? []) as Interaction[])
    setTasks((taskRes.data ?? []) as TaskRow[])
    setLoadingInt(false)
  }, [deal.id])

  useEffect(() => { loadInteractions() }, [loadInteractions])

  // Debounced auto-save for inline fields
  useEffect(() => {
    const t = setTimeout(() => {
      const updates: Record<string, unknown> = {}
      const parsedVal = dealValue === '' ? null : Number(dealValue)
      if ((deal.deal_value ?? null) !== parsedVal && !isNaN(parsedVal as number)) {
        updates.deal_value = parsedVal
      }
      if ((deal.expected_close_date ?? '') !== expectedDate) {
        updates.expected_close_date = expectedDate || null
      }
      const parsedTags = tagsInput.split(',').map(s => s.trim()).filter(Boolean)
      const currentTags = deal.tags ?? []
      if (JSON.stringify(currentTags) !== JSON.stringify(parsedTags)) {
        updates.tags = parsedTags
      }
      if ((deal.assigned_to ?? '') !== assignedTo) {
        updates.assigned_to = assignedTo || null
      }
      if (deal.priority !== priorityVal) {
        updates.priority = priorityVal
      }
      if ((deal.source ?? '') !== sourceVal) {
        updates.source = normalizeSource(sourceVal) // null or DB-safe enum
      }
      if (Object.keys(updates).length > 0) {
        supabase.from('deals').update(updates).eq('id', deal.id).then(() => onUpdate())
      }
    }, 600)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealValue, expectedDate, tagsInput, assignedTo, priorityVal, sourceVal])

  const moveStage = async (stage: string) => {
    await supabase.from('deals').update({ stage }).eq('id', deal.id)
    const taskTitle = STAGE_TASKS[stage]
    if (taskTitle) {
      const due = new Date()
      due.setHours(due.getHours() + 2)
      await supabase.from('tasks').insert({
        clinic_id: clinicId,
        title: taskTitle.replace('{name}', deal.patient?.full_name ?? ''),
        type: stage === 'no_show' ? 'call' : stage === 'contact' ? 'follow_up' : 'call',
        priority: stage === 'no_show' ? 'high' : 'normal',
        status: 'new',
        patient_id: deal.patient_id,
        deal_id: deal.id,
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

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTaskTitle.trim()) return
    setSavingTask(true)
    const due = newTaskDue ? new Date(newTaskDue).toISOString() : null
    await supabase.from('tasks').insert({
      clinic_id: clinicId,
      title: newTaskTitle.trim(),
      type: newTaskType,
      priority: 'normal',
      status: 'new',
      patient_id: deal.patient_id,
      deal_id: deal.id,
      assigned_to: assignedTo || null,
      due_at: due,
    })
    setNewTaskTitle('')
    setNewTaskDue('')
    setSavingTask(false)
    loadInteractions()
  }

  const toggleTaskDone = async (task: TaskRow) => {
    const isDone = task.status === 'done'
    await supabase.from('tasks').update({
      status: isDone ? 'new' : 'done',
      done_at: isDone ? null : new Date().toISOString(),
    }).eq('id', task.id)
    loadInteractions()
  }

  const currentStage = stages.find(s => s.key === deal.stage)
  const phone = deal.patient?.phones?.[0]
  const waLink = phone
    ? `https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(`Здравствуйте, ${deal.patient?.full_name ?? ''}!`)}`
    : null

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0 pr-3">
            <h3 className="text-base font-semibold text-gray-900 leading-tight">
              {deal.patient?.full_name ?? '—'}
            </h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {currentStage && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentStage.color }} />
                  {currentStage.label}
                </span>
              )}
              {phone && (
                <span className="text-xs text-gray-400">{phone}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="text-xs bg-green-50 hover:bg-green-100 text-green-700 rounded-lg px-2.5 py-1.5 font-medium transition-colors flex items-center gap-1"
                title="Написать в WhatsApp"
              >
                💬 WA
              </a>
            )}
            {phone && (
              <a
                href={`tel:${phone}`}
                className="text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg px-2.5 py-1.5 font-medium transition-colors"
                title="Позвонить"
              >
                📞
              </a>
            )}
            {deal.funnel === 'leads' && onTransfer && (
              <button
                onClick={() => onTransfer(deal)}
                className="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg px-2.5 py-1.5 font-medium transition-colors"
              >
                → В мед.
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-1">
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
          {/* Inline edit fields */}
          <div className="px-5 py-4 border-b border-gray-50 grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Сумма (₸)</label>
              <input
                type="number"
                inputMode="decimal"
                value={dealValue}
                onChange={e => setDealValue(e.target.value)}
                placeholder="0"
                className="w-full mt-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Закрыть до</label>
              <input
                type="date"
                value={expectedDate}
                onChange={e => setExpectedDate(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Ответственный</label>
              <select
                value={assignedTo}
                onChange={e => setAssignedTo(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— не назначен —</option>
                {owners.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Приоритет</label>
              <select
                value={priorityVal}
                onChange={e => setPriorityVal(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="hot">🔥 Горячий</option>
                <option value="warm">Тёплый</option>
                <option value="cold">Холодный</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Источник</label>
              <select
                value={sourceVal}
                onChange={e => setSourceVal(e.target.value)}
                className="w-full mt-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— не указан —</option>
                {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Создан</label>
              <p className="text-sm text-gray-600 mt-1.5">
                {new Date(deal.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Теги (через запятую)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="vip, повтор, рекомендация"
                className="w-full mt-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {deal.notes && (
              <div className="col-span-2">
                <p className="text-sm text-gray-600 leading-relaxed bg-gray-50 rounded-lg px-3 py-2">{deal.notes}</p>
              </div>
            )}
          </div>

          {/* Tasks */}
          <div className="px-5 py-4 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Задачи {tasks.length > 0 && <span className="text-gray-300 ml-1">{tasks.filter(t => t.status !== 'done').length} активных</span>}
            </p>
            {tasks.length > 0 && (
              <div className="space-y-1.5 mb-3">
                {tasks.map(t => {
                  const overdue = t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done'
                  return (
                    <div key={t.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={t.status === 'done'}
                        onChange={() => toggleTaskDone(t)}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span className={['flex-1 truncate', t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-700'].join(' ')}>
                        {t.title}
                      </span>
                      {t.due_at && (
                        <span className={['text-xs', overdue ? 'text-red-500 font-medium' : 'text-gray-400'].join(' ')}>
                          {new Date(t.due_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <form onSubmit={addTask} className="space-y-2">
              <input
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                placeholder="Новая задача..."
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2">
                <select
                  value={newTaskType}
                  onChange={e => setNewTaskType(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
                >
                  <option value="call">📞 Звонок</option>
                  <option value="follow_up">💬 Касание</option>
                  <option value="confirm">✅ Подтвердить</option>
                  <option value="reminder">⏰ Напомнить</option>
                  <option value="other">Другое</option>
                </select>
                <input
                  type="datetime-local"
                  value={newTaskDue}
                  onChange={e => setNewTaskDue(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                />
                <button
                  type="submit"
                  disabled={savingTask || !newTaskTitle.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg px-3 text-sm font-medium"
                >
                  +
                </button>
              </div>
            </form>
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

// amoCRM-style "fast lead": only 4 fields — name, phone, source, note.
// Everything else (gender, priority, value, owner, doctor, birth date,
// tags…) is filled in later from the deal card / drawer.
function CreateDealModal({ clinicId, defaultStage, onClose, onCreated }: {
  clinicId: string
  defaultStage: string
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone]       = useState(PHONE_PREFIX)
  const [source, setSource]     = useState<string>('')   // DB-safe value
  const [notes, setNotes]       = useState('')

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [phoneWarning, setPhoneWarning] = useState<string | null>(null)

  const phoneTouched = phone.length > PHONE_PREFIX.length
  const phoneValid   = isValidPhoneKZ(phone)
  const canSubmit    = fullName.trim().length > 0 && (!phoneTouched || phoneValid)

  // Debounced dedup check by normalized phone
  useEffect(() => {
    if (!phoneTouched || !phoneValid) { setPhoneWarning(null); return }
    const norm = normalizePhoneKZ(phone)
    if (!norm) { setPhoneWarning(null); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients')
        .select('id, full_name')
        .contains('phones', [norm])
        .limit(1)
      if (data?.[0]) setPhoneWarning(`Уже есть пациент: ${data[0].full_name}`)
      else setPhoneWarning(null)
    }, 400)
    return () => clearTimeout(t)
  }, [phone, phoneTouched, phoneValid, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!canSubmit) return
    setSaving(true)
    try {
      const normalizedPhone = phoneTouched ? normalizePhoneKZ(phone) : null
      if (phoneTouched && !normalizedPhone) {
        setError('Введите полный номер телефона: +77XXXXXXXXX')
        setSaving(false); return
      }

      // 1) Patient — manual creation, NO WhatsApp dependency.
      //    whatsapp_chat_id / whatsapp_contact_id остаются NULL — это ok.
      const { data: patient, error: pErr } = await supabase
        .from('patients')
        .insert({
          clinic_id: clinicId,
          full_name: fullName.trim(),
          phones: normalizedPhone ? [normalizedPhone] : [],
          gender: 'other',          // выбирается позже, в карточке
          status: 'new',
          is_vip: false,
          balance_amount: 0,
          debt_amount: 0,
          tags: [],
        })
        .select('id')
        .single()

      if (pErr || !patient) { setError(pErr?.message ?? 'Ошибка создания пациента'); setSaving(false); return }

      // 2) Deal — central entity in amoCRM model.
      const { data: deal, error: dErr } = await supabase
        .from('deals')
        .insert({
          clinic_id: clinicId,
          patient_id: patient.id,
          funnel: 'leads',
          stage:  defaultStage,                  // первый этап текущей воронки
          source: normalizeSource(source),       // DB-safe enum value or null
          priority: 'warm',                      // тёплый по умолчанию
          notes: notes.trim() || null,
        })
        .select('id')
        .single()

      if (dErr || !deal) { setError(dErr?.message ?? 'Ошибка создания сделки'); setSaving(false); return }

      // 3) Auto-task "Позвонить" — always linked via deal_id.
      const due = new Date()
      due.setHours(due.getHours() + 1)
      await supabase.from('tasks').insert({
        clinic_id: clinicId,
        title: `Позвонить: ${fullName.trim()}`,
        type: 'call',         // valid: matches tasks.type CHECK
        priority: 'high',     // valid: matches tasks.priority CHECK
        status: 'new',        // valid: matches tasks.status CHECK
        patient_id: patient.id,
        deal_id: deal.id,
        due_at: due.toISOString(),
      })

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
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-gray-900">Новый лид</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <p className="text-xs text-gray-400 mb-5">Минимум полей — детали добавите в карточке</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Имя <span className="text-red-400">*</span></label>
            <input className={inputCls} placeholder="Айгерим Бекова"
              value={fullName} onChange={e => setFullName(e.target.value)} required autoFocus />
          </div>

          <div>
            <label className={labelCls}>Телефон</label>
            <input
              type="tel"
              className={inputCls + (phoneTouched && !phoneValid ? ' border-orange-300 focus:ring-orange-400' : '')}
              placeholder={PHONE_PREFIX + ' XXXXXXXXX'}
              value={phone}
              onChange={e => setPhone(formatPhoneInput(e.target.value))}
              onKeyDown={onPhoneKeyDown}
            />
            {phoneTouched && !phoneValid && (
              <p className="text-xs text-orange-600 mt-1.5">Номер должен быть полным: {PHONE_PREFIX} + 9 цифр</p>
            )}
            {phoneWarning && (
              <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center gap-1.5 mt-1.5">
                ⚠️ {phoneWarning}
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>Источник</label>
            <select className={inputCls} value={source} onChange={e => setSource(e.target.value)}>
              <option value="">— не указан —</option>
              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>Заметка</label>
            <textarea className={inputCls + ' resize-none'} placeholder="Интересуется процедурой..."
              rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
              Отмена
            </button>
            <button type="submit" disabled={saving || !canSubmit}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {saving ? 'Создание...' : 'Создать лид'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── BulkActionBar ───────────────────────────────────────────────────────────

function BulkActionBar({ count, stages, owners, onClear, onMove, onAssign, onLost }: {
  count: number
  stages: Stage[]
  owners: UserOption[]
  onClear: () => void
  onMove: (stage: string) => void
  onAssign: (userId: string) => void
  onLost: () => void
}) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 z-50 flex items-center gap-4 min-w-max">
      <span className="text-sm font-medium">Выбрано: {count}</span>
      <div className="h-6 w-px bg-gray-700" />
      <select onChange={e => { if (e.target.value) { onMove(e.target.value); e.target.value = '' } }}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm cursor-pointer">
        <option value="">→ Этап</option>
        {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <select onChange={e => { if (e.target.value !== '__none__') { onAssign(e.target.value); e.target.value = '__none__' } }}
        defaultValue="__none__"
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm cursor-pointer">
        <option value="__none__">Назначить</option>
        <option value="">— снять —</option>
        {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <button onClick={onLost} className="bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1.5 text-sm font-medium">
        Отказ
      </button>
      <button onClick={onClear} className="text-gray-400 hover:text-white text-sm">
        Отмена
      </button>
    </div>
  )
}

// ─── ListView (Реестр) ──────────────────────────────────────────────────────

function ListView({ deals, stages, owners, selectedIds, onToggleSelect, onToggleAll, onCardClick, onTransfer }: {
  deals: DealRow[]
  stages: Stage[]
  owners: UserOption[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleAll: () => void
  onCardClick: (deal: DealRow) => void
  onTransfer?: (deal: DealRow) => void
}) {
  const allSelected = deals.length > 0 && deals.every(d => selectedIds.has(d.id))
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-2 w-10">
                <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="w-4 h-4 accent-blue-600" />
              </th>
              <th className="px-3 py-2">Клиент</th>
              <th className="px-3 py-2">Этап</th>
              <th className="px-3 py-2">Сумма</th>
              <th className="px-3 py-2">Источник</th>
              <th className="px-3 py-2">Приоритет</th>
              <th className="px-3 py-2">Ответственный</th>
              <th className="px-3 py-2">Дней</th>
              <th className="px-3 py-2">Создан</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {deals.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-gray-300 text-sm">Нет сделок</td></tr>
            ) : deals.map(d => {
              const stage = stages.find(s => s.key === d.stage)
              const owner = owners.find(o => o.id === (d.assigned_to ?? d.first_owner_id))
              const p = PRIORITY_STYLE[d.priority] ?? PRIORITY_STYLE.warm
              const days = daysSince(d.created_at)
              const isSelected = selectedIds.has(d.id)
              return (
                <tr key={d.id}
                  className={['hover:bg-gray-50 cursor-pointer', isSelected ? 'bg-blue-50' : ''].join(' ')}
                  onClick={() => onCardClick(d)}>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(d.id)} className="w-4 h-4 accent-blue-600" />
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-900 truncate max-w-[180px]">{d.patient?.full_name ?? '—'}</p>
                    {d.patient?.phones?.[0] && <p className="text-xs text-gray-400">{formatPhoneDisplay(d.patient.phones[0])}</p>}
                  </td>
                  <td className="px-3 py-2.5">
                    {stage && (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.label}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-emerald-600 whitespace-nowrap">{fmtTenge(d.deal_value)}</td>
                  <td className="px-3 py-2.5 text-gray-500">{sourceLabel(d.source)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${p.bg} ${p.text}`}>{p.label}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 truncate max-w-[120px]">{owner?.name ?? '—'}</td>
                  <td className={['px-3 py-2.5 text-xs', days > 7 ? 'text-red-500 font-medium' : days > 3 ? 'text-orange-500' : 'text-gray-400'].join(' ')}>
                    {days}
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(d.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                    {d.funnel === 'leads' && onTransfer && (
                      <button onClick={() => onTransfer(d)}
                        className="text-xs text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded px-1.5 py-0.5 font-medium">
                        → В мед.
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── AnalyticsBar ───────────────────────────────────────────────────────────

function AnalyticsBar({ stages, deals, totalValue }: {
  stages: Stage[]
  deals: DealRow[]
  totalValue: number
}) {
  const totalCount = deals.length
  const wonStages = ['booked', 'success', 'closed'] // funnel-end stages
  const wonCount = deals.filter(d => wonStages.includes(d.stage)).length
  const conversion = totalCount > 0 ? Math.round((wonCount / totalCount) * 100) : 0

  return (
    <div className="px-6 py-3 bg-white border-b border-gray-100 flex items-center gap-6 overflow-x-auto">
      <div className="flex flex-col flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Сделок</span>
        <span className="text-lg font-semibold text-gray-900">{totalCount}</span>
      </div>
      <div className="flex flex-col flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Сумма</span>
        <span className="text-lg font-semibold text-emerald-600">{fmtTenge(totalValue) || '0 ₸'}</span>
      </div>
      <div className="flex flex-col flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Конверсия</span>
        <span className="text-lg font-semibold text-blue-600">{conversion}%</span>
      </div>
      <div className="h-10 w-px bg-gray-200 flex-shrink-0" />
      <div className="flex items-center gap-3 overflow-x-auto">
        {stages.map(s => {
          const stageDeals = deals.filter(d => d.stage === s.key)
          const sum = stageDeals.reduce((a, b) => a + Number(b.deal_value ?? 0), 0)
          const pct = totalCount > 0 ? Math.round((stageDeals.length / totalCount) * 100) : 0
          return (
            <div key={s.key} className="flex items-center gap-2 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
              <div className="text-xs">
                <p className="text-gray-700 font-medium whitespace-nowrap">{s.label}</p>
                <p className="text-gray-400">
                  {stageDeals.length} · {pct}%{sum > 0 && ` · ${fmtTenge(sum)}`}
                </p>
              </div>
            </div>
          )
        })}
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
  const [owners, setOwners] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [funnel, setFunnel] = useState<'leads' | 'medical'>('leads')
  const [view, setView] = useState<'kanban' | 'list'>('kanban')
  const [selected, setSelected] = useState<DealRow | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [transferDeal, setTransferDeal] = useState<DealRow | null>(null)
  const [quickAddStage, setQuickAddStage] = useState<string | null>(null)
  const [settings, setSettings] = useState<CrmSettings>(() => loadSettings())

  // Filters
  const [search, setSearch]           = useState('')
  const [period, setPeriod]           = useState<PeriodKey>('all')
  const [filterSource, setFilterSource]     = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterOwner, setFilterOwner]       = useState('')
  const [filterTag, setFilterTag]           = useState('')
  const [showFilters, setShowFilters]       = useState(false)

  // Bulk select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectMode = selectedIds.size > 0
  const [bulkLost, setBulkLost] = useState(false)
  const [bulkLostReason, setBulkLostReason] = useState('no_answer')

  const leadsStages = settings.leads_stages
  const medicalStages = settings.medical_stages
  // Source dropdowns now read from the central SOURCE_OPTIONS dictionary
  // (see /lib/crm/constants.ts) so we no longer need settings.sources.

  const stages = funnel === 'leads' ? leadsStages : medicalStages

  // Reload settings when page gains focus
  useEffect(() => {
    const onFocus = () => setSettings(loadSettings())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Load owners (user profiles)
  useEffect(() => {
    if (!clinicId) return
    supabase.from('user_profiles')
      .select('id, first_name, last_name, avatar_url')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .then(({ data }) => {
        const list = (data ?? []).map((u: { id: string; first_name: string; last_name: string; avatar_url: string | null }) => ({
          id: u.id,
          name: `${u.first_name} ${u.last_name}`.trim(),
          avatar_url: u.avatar_url,
        }))
        setOwners(list)
      })
  }, [clinicId])

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
    setSelectedIds(new Set())
  }, [funnel])

  useEffect(() => { load() }, [load])

  // ── Filtered deals ────────────────────────────────────────────────────
  const filteredDeals = useMemo(() => {
    const cutoff = periodCutoff(period)
    const q = search.trim().toLowerCase()
    return deals.filter(d => {
      if (cutoff !== null && new Date(d.created_at).getTime() < cutoff) return false
      if (filterSource && d.source !== filterSource) return false
      if (filterPriority && d.priority !== filterPriority) return false
      if (filterOwner && (d.assigned_to ?? d.first_owner_id) !== filterOwner) return false
      if (filterTag && !(d.tags ?? []).includes(filterTag)) return false
      if (q) {
        const name = (d.patient?.full_name ?? '').toLowerCase()
        const phone = (d.patient?.phones?.[0] ?? '').toLowerCase()
        const notes = (d.notes ?? '').toLowerCase()
        if (!name.includes(q) && !phone.includes(q) && !notes.includes(q)) return false
      }
      return true
    })
  }, [deals, period, search, filterSource, filterPriority, filterOwner, filterTag])

  const totalValue = filteredDeals.reduce((sum, d) => sum + Number(d.deal_value ?? 0), 0)

  const allTags = useMemo(() => {
    const set = new Set<string>()
    deals.forEach(d => (d.tags ?? []).forEach(t => set.add(t)))
    return Array.from(set).sort()
  }, [deals])

  const staleCount = deals.filter(d => daysSince(d.created_at) > 7).length

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
        type: stage === 'no_show' ? 'call' : stage === 'contact' ? 'follow_up' : 'call',
        priority: stage === 'no_show' ? 'high' : 'normal',
        status: 'new',
        patient_id: deal.patient_id,
        deal_id: deal.id,
        due_at: due.toISOString(),
      })
    }
  }

  const handleQuickCreated = () => {
    setQuickAddStage(null)
    load()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  const toggleAll = () => {
    if (filteredDeals.every(d => selectedIds.has(d.id))) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredDeals.map(d => d.id)))
    }
  }

  const bulkMove = async (stage: string) => {
    const ids = Array.from(selectedIds)
    await supabase.from('deals').update({ stage }).in('id', ids)
    setSelectedIds(new Set())
    load()
  }

  const bulkAssign = async (userId: string) => {
    const ids = Array.from(selectedIds)
    await supabase.from('deals').update({ assigned_to: userId || null }).in('id', ids)
    setSelectedIds(new Set())
    load()
  }

  const bulkMarkLost = async () => {
    const ids = Array.from(selectedIds)
    await supabase.from('deals').update({
      status: 'lost',
      lost_reason: bulkLostReason,
    }).in('id', ids)
    setSelectedIds(new Set())
    setBulkLost(false)
    load()
  }

  const clearFilters = () => {
    setSearch(''); setPeriod('all'); setFilterSource(''); setFilterPriority(''); setFilterOwner(''); setFilterTag('')
  }
  const hasFilters = search || period !== 'all' || filterSource || filterPriority || filterOwner || filterTag

  return (
    <div className="flex flex-col h-full -m-6 overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0 flex-wrap">
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

        {/* View toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['kanban', 'list'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={[
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {v === 'kanban' ? '📋 Канбан' : '📊 Реестр'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск имя/телефон..."
            className="border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm w-56 outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" fill="none" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>

        {/* Period */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {PERIOD_OPTS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={[
                'px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Filters toggle */}
        <button
          onClick={() => setShowFilters(s => !s)}
          className={[
            'border rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors flex items-center gap-1',
            showFilters || hasFilters ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50',
          ].join(' ')}
        >
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
            <path d="M3 6h18M6 12h12M10 18h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Фильтры
          {hasFilters && <span className="bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[9px]">●</span>}
        </button>

        {staleCount > 0 && (
          <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
            ⚠ {staleCount} зависших
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/crm/settings"
            className="text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-2 text-sm transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
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

      {/* Filters row */}
      {showFilters && (
        <div className="px-6 py-3 border-b border-gray-100 bg-gray-50 flex items-center gap-3 flex-wrap text-sm">
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
            <option value="">Источник: все</option>
            {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
            <option value="">Приоритет: все</option>
            <option value="hot">🔥 Горячий</option>
            <option value="warm">Тёплый</option>
            <option value="cold">Холодный</option>
          </select>
          <select value={filterOwner} onChange={e => setFilterOwner(e.target.value)}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
            <option value="">Ответственный: все</option>
            {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {allTags.length > 0 && (
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs bg-white">
              <option value="">Тег: все</option>
              {allTags.map(t => <option key={t} value={t}>#{t}</option>)}
            </select>
          )}
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              Сбросить
            </button>
          )}
        </div>
      )}

      {/* Analytics summary */}
      {!loading && (
        <AnalyticsBar stages={stages} deals={filteredDeals} totalValue={totalValue} />
      )}

      {/* Board / List */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">Загрузка...</div>
        ) : view === 'kanban' ? (
          <div className="flex gap-4 p-6 items-start min-w-max">
            {stages.map(col => (
              <KanbanColumn
                key={col.key}
                col={col}
                deals={filteredDeals.filter(d => d.stage === col.key)}
                owners={owners}
                clinicId={clinicId}
                showQuickAdd={quickAddStage === col.key && funnel === 'leads'}
                selectedIds={selectedIds}
                selectMode={selectMode}
                onDragStart={setDragId}
                onDrop={handleDrop}
                onCardClick={setSelected}
                onTransfer={funnel === 'leads' ? setTransferDeal : undefined}
                onQuickAddToggle={() => setQuickAddStage(prev => prev === col.key ? null : col.key)}
                onCreated={handleQuickCreated}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        ) : (
          <div className="p-6">
            <ListView
              deals={filteredDeals}
              stages={stages}
              owners={owners}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleAll}
              onCardClick={setSelected}
              onTransfer={funnel === 'leads' ? setTransferDeal : undefined}
            />
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectMode && (
        <BulkActionBar
          count={selectedIds.size}
          stages={stages}
          owners={owners}
          onClear={() => setSelectedIds(new Set())}
          onMove={bulkMove}
          onAssign={bulkAssign}
          onLost={() => setBulkLost(true)}
        />
      )}

      {/* Bulk lost modal */}
      {bulkLost && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setBulkLost(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 z-10">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Закрыть как отказ</h3>
            <p className="text-sm text-gray-400 mb-4">{selectedIds.size} сделок будут закрыты</p>
            <div className="space-y-2 mb-5">
              {LOST_REASONS.map(r => (
                <label key={r.value} className="flex items-center gap-3 cursor-pointer">
                  <input type="radio" name="bulk_lost" value={r.value}
                    checked={bulkLostReason === r.value}
                    onChange={() => setBulkLostReason(r.value)}
                    className="accent-red-500 w-4 h-4" />
                  <span className="text-sm text-gray-700">{r.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setBulkLost(false)}
                className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2.5 text-sm font-medium hover:bg-gray-50">
                Отмена
              </button>
              <button onClick={bulkMarkLost}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium">
                Закрыть {selectedIds.size}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <DealDrawer
          deal={selected}
          stages={stages}
          owners={owners}
          clinicId={clinicId}
          onClose={() => setSelected(null)}
          onUpdate={load}
          onTransfer={funnel === 'leads' ? (d) => { setSelected(null); setTransferDeal(d) } : undefined}
        />
      )}

      {showCreate && clinicId && (
        <CreateDealModal
          clinicId={clinicId}
          defaultStage={leadsStages[0]?.key ?? 'new'}
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); setShowCreate(false) }}
        />
      )}

      {transferDeal && clinicId && (
        <TransferModal
          deal={transferDeal}
          medicalStages={medicalStages}
          onClose={() => setTransferDeal(null)}
          onTransferred={() => { load(); setTransferDeal(null) }}
        />
      )}
    </div>
  )
}
