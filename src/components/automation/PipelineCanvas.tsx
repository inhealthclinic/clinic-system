'use client'

/**
 * <PipelineCanvas /> — единый редактор воронки в стиле amoCRM.
 *
 * Раскладка:
 *   ┌──────────┬──────────┬──────────┬──────────┐
 *   │ ЭТАП 1   │ ЭТАП 2   │ ЭТАП 3   │ ЭТАП 4   │  ← цветной хедер
 *   │  ⋮       │  ⋮       │  ⋮       │  ⋮       │  ← рендж попап
 *   ├──────────┼──────────┼──────────┼──────────┤
 *   │ карточка │ карточка │ карточка │ — пусто  │  ← триггеры
 *   │ карточка │          │ карточка │          │
 *   └──────────┴──────────┴──────────┴──────────┘
 *
 * Стадии редактируются прямо в хедере (имя — клик; цвет/роль/удаление —
 * через ⋮). Автоматизации (бот / задачи / касания) живут карточками
 * внутри столбцов, привязка по `stage.code`.
 *
 * Состояние автоматизаций (clinics.settings.automation.<flag> +
 * message_templates.body) грузится и сохраняется этим же компонентом —
 * единая кнопка «Сохранить» вверху страницы.
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import TriggerPicker, { type TriggerType } from './TriggerPicker'
import TriggerConfigDrawer from './TriggerConfigDrawer'

// ─── пользовательские триггеры (мигр. 088) ───────────────────────────────────
interface CustomTrigger {
  id: string
  clinic_id: string
  stage_id: string
  type: TriggerType
  event: 'on_enter' | 'on_exit' | 'on_create' | 'on_no_reply'
  config: Record<string, unknown>
  is_active: boolean
  sort_order: number
}

const TYPE_LABEL: Record<TriggerType, { icon: string; label: string }> = {
  salesbot:           { icon: '🤖', label: 'Salesbot' },
  create_task:        { icon: '✓',  label: 'Создать задачу' },
  create_deal:        { icon: '$',  label: 'Создать сделку' },
  send_email:         { icon: '✉',  label: 'Письмо' },
  webhook:            { icon: '⚡', label: 'Webhook' },
  change_stage:       { icon: '⇆',  label: 'Смена статуса' },
  edit_tags:          { icon: '#',  label: 'Теги' },
  complete_tasks:     { icon: '☑',  label: 'Закрыть задачи' },
  generate_form:      { icon: '📋', label: 'Анкета' },
  change_responsible: { icon: '👤', label: 'Ответственный' },
  change_field:       { icon: '✎',  label: 'Изменить поле' },
  businessbot:        { icon: '🤖', label: 'Businessbot' },
  delete_files:       { icon: '🗑',  label: 'Удалить файлы' },
}

// ─── публичные типы ──────────────────────────────────────────────────────────

export interface Pipeline {
  id: string; clinic_id: string; code: string; name: string
  is_system: boolean; is_active: boolean; sort_order: number
}
export interface Stage {
  id: string; pipeline_id: string; code: string; name: string; color: string
  sort_order: number; is_active: boolean
  stage_role: 'normal' | 'won' | 'lost' | 'closed'
  is_system: boolean; is_editable: boolean; is_deletable: boolean
  counts_in_kpi: boolean
  default_responsible_user_id?: string | null
}

// ─── автоматизации ───────────────────────────────────────────────────────────

type AutoFlag =
  | 'bot_enabled'
  | 'work_24h' | 'work_48h'
  | 'touch_1' | 'touch_2' | 'touch_3' | 'touch_no_reply'

interface AutoCard {
  flag: AutoFlag
  templateKey: string
  badge: string         // 🤖 / ⏰ / 💬
  badgeLabel: string
  title: string
  hint: string
  rows: number
  legacyBotFlag?: boolean   // bot_enabled живёт в settings, не в settings.automation
}

/** stage.code → массив автоматизаций. Те, что не указаны — без триггеров. */
const STAGE_AUTOMATIONS: Record<string, AutoCard[]> = {
  new: [
    {
      flag: 'bot_enabled', legacyBotFlag: true, templateKey: 'bot_greeting',
      badge: '🤖', badgeLabel: 'Salesbot', title: 'Запуск Salesbot: Приветствие',
      hint: 'Сразу при появлении нового лида — приветствие в WhatsApp. Через 1 ч без ответа — фоллоуап. Бот работает 24/7.',
      rows: 4,
    },
  ],
  in_progress: [
    {
      flag: 'work_24h', templateKey: 'work_task_24h',
      badge: '⏰', badgeLabel: 'Задача', title: '24 ч с последнего входящего → задача',
      hint: 'Если клиент не отвечает 24 ч — менеджеру создаётся задача с этим текстом.',
      rows: 3,
    },
    {
      flag: 'work_48h', templateKey: 'work_task_48h',
      badge: '⏰', badgeLabel: 'Задача', title: '48 ч с последнего входящего → задача',
      hint: 'Финальная задача, если за 48 ч ответа нет.',
      rows: 3,
    },
  ],
  contact: [
    {
      flag: 'touch_1', templateKey: 'touch_1',
      badge: '💬', badgeLabel: 'Касание', title: '1-е касание: сразу при входе',
      hint: 'WhatsApp в момент перевода в «Касание».',
      rows: 4,
    },
    {
      flag: 'touch_2', templateKey: 'touch_2',
      badge: '💬', badgeLabel: 'Касание', title: '2-е касание: через 120 ч',
      hint: '≈ 5 дн. после входа, если клиент молчит.',
      rows: 4,
    },
    {
      flag: 'touch_3', templateKey: 'touch_3',
      badge: '💬', badgeLabel: 'Касание', title: '3-е касание: через 240 ч',
      hint: '≈ 10 дн. Финальное автоматическое касание.',
      rows: 4,
    },
    {
      flag: 'touch_no_reply', templateKey: 'touch_no_reply_task',
      badge: '⏰', badgeLabel: 'Задача', title: 'Через сутки после 3-го касания → задача',
      hint: 'Если клиент молчит сутки после 3-го касания — задача менеджеру.',
      rows: 3,
    },
  ],
}

const ROLE_LABEL: Record<Stage['stage_role'], string> = {
  normal: 'Обычный', won: 'Успех', lost: 'Потеря', closed: 'Закрыт',
}
const ROLE_BADGE: Record<Stage['stage_role'], string> = {
  normal: 'bg-gray-100 text-gray-700',
  won:    'bg-green-100 text-green-700',
  lost:   'bg-red-100 text-red-700',
  closed: 'bg-slate-200 text-slate-700',
}
const PRESET_COLORS = [
  '#94a3b8','#64748b','#3b82f6','#06b6d4','#14b8a6','#10b981','#16a34a','#84cc16',
  '#f59e0b','#f97316','#ef4444','#dc2626','#a855f7','#8b5cf6','#6366f1','#ec4899',
]

interface ClinicSettings {
  bot_enabled?: boolean
  automation?: Partial<Record<AutoFlag, boolean>>
  [k: string]: unknown
}

// ─── props ───────────────────────────────────────────────────────────────────

interface Props {
  pipeline: Pipeline
  stages: Stage[]                                    // активные + не активные, по sort_order
  onAddStage: () => void
  onUpdateStage: (id: string, patch: Partial<Stage>) => void
  onDeleteStage: (s: Stage) => void
  onMoveStage: (s: Stage, dir: -1 | 1) => void
}

// ─── компонент ───────────────────────────────────────────────────────────────

export default function PipelineCanvas({
  pipeline, stages,
  onAddStage, onUpdateStage, onDeleteStage, onMoveStage,
}: Props) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  // пользователи клиники для выбора ответственного
  const [clinicUsers, setClinicUsers] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (!clinicId) return
    supabase.from('user_profiles').select('id, first_name, last_name').eq('clinic_id', clinicId)
      .then(({ data }) => {
        setClinicUsers((data ?? []).map(u => ({
          id: u.id as string,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Сотрудник',
        })))
      })
  }, [clinicId, supabase])

  // автоматизации
  const [autoLoading, setAutoLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [flags, setFlags] = useState<Record<AutoFlag, boolean>>({
    bot_enabled: true,
    work_24h: true, work_48h: true,
    touch_1: true, touch_2: true, touch_3: true, touch_no_reply: true,
  })
  const [bodies, setBodies] = useState<Record<string, string>>({})

  // меню стадии (kebab)
  const [stageMenu, setStageMenu] = useState<string | null>(null)

  // пользовательские триггеры (мигр. 088)
  const [customTriggers, setCustomTriggers] = useState<CustomTrigger[]>([])
  const [pickerStageId, setPickerStageId] = useState<string | null>(null)
  const [editingTrigger, setEditingTrigger] = useState<CustomTrigger | null>(null)

  const loadCustom = useCallback(async () => {
    if (!clinicId) return
    const { data } = await supabase
      .from('pipeline_stage_triggers')
      .select('*')
      .eq('clinic_id', clinicId)
      .order('sort_order')
      .returns<CustomTrigger[]>()
    setCustomTriggers(data ?? [])
  }, [clinicId, supabase])

  useEffect(() => { loadCustom() }, [loadCustom])

  const addTrigger = async (stageId: string, type: TriggerType) => {
    if (!clinicId) return
    setPickerStageId(null)
    const { data, error } = await supabase
      .from('pipeline_stage_triggers')
      .insert({
        clinic_id: clinicId,
        stage_id:  stageId,
        type,
        event:     'on_enter',
        config:    {},
        is_active: true,
        sort_order: customTriggers.filter(t => t.stage_id === stageId).length,
      })
      .select('*')
      .single<CustomTrigger>()
    if (error) { setError(error.message); return }
    await loadCustom()
    // Сразу открываем форму конфигурации, как в amoCRM.
    if (data) setEditingTrigger(data)
  }

  const saveTriggerConfig = async (
    id: string,
    patch: { config: Record<string, unknown>; is_active: boolean },
  ) => {
    const { error } = await supabase
      .from('pipeline_stage_triggers')
      .update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    setCustomTriggers(arr => arr.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  const toggleTrigger = async (id: string, val: boolean) => {
    const { error } = await supabase
      .from('pipeline_stage_triggers')
      .update({ is_active: val }).eq('id', id)
    if (error) { setError(error.message); return }
    setCustomTriggers(arr => arr.map(t => t.id === id ? { ...t, is_active: val } : t))
  }

  const removeTrigger = async (id: string) => {
    if (!confirm('Удалить триггер?')) return
    const { error } = await supabase
      .from('pipeline_stage_triggers')
      .delete().eq('id', id)
    if (error) { setError(error.message); return }
    setCustomTriggers(arr => arr.filter(t => t.id !== id))
  }

  // черновики имени стадии
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!clinicId) return
    let cancelled = false
    ;(async () => {
      setAutoLoading(true)
      try {
        const { data: clinic } = await supabase
          .from('clinics').select('settings').eq('id', clinicId)
          .single<{ settings: ClinicSettings | null }>()
        const s = clinic?.settings ?? {}
        const auto = s.automation ?? {}
        const allKeys = Object.values(STAGE_AUTOMATIONS).flat().map(c => c.templateKey)
        const { data: tmpls } = await supabase
          .from('message_templates').select('key, body')
          .eq('clinic_id', clinicId).in('key', allKeys)
          .returns<{ key: string; body: string }[]>()
        if (cancelled) return
        setFlags(prev => {
          const next = { ...prev }
          next.bot_enabled = s.bot_enabled !== false
          for (const cards of Object.values(STAGE_AUTOMATIONS)) {
            for (const c of cards) {
              if (c.legacyBotFlag) continue
              next[c.flag] = auto[c.flag] !== false
            }
          }
          return next
        })
        setBodies(Object.fromEntries((tmpls ?? []).map(t => [t.key, t.body])))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      } finally {
        if (!cancelled) setAutoLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [clinicId, supabase])

  const save = async () => {
    if (!clinicId) return
    setSaving(true); setError(''); setToast('')
    try {
      const { data: clinic } = await supabase
        .from('clinics').select('settings').eq('id', clinicId)
        .single<{ settings: ClinicSettings | null }>()
      const automation: Partial<Record<AutoFlag, boolean>> = {}
      for (const cards of Object.values(STAGE_AUTOMATIONS)) for (const c of cards) {
        if (c.legacyBotFlag) continue
        automation[c.flag] = flags[c.flag]
      }
      const settings = {
        ...(clinic?.settings ?? {}),
        bot_enabled: flags.bot_enabled,
        automation,
      }
      const { error: cErr } = await supabase
        .from('clinics').update({ settings }).eq('id', clinicId)
      if (cErr) throw cErr

      for (const cards of Object.values(STAGE_AUTOMATIONS)) for (const c of cards) {
        const body = bodies[c.templateKey]?.trim()
        if (!body) continue
        const { error: tErr } = await supabase.from('message_templates').upsert({
          clinic_id: clinicId, key: c.templateKey, title: c.title, body, is_active: true,
        }, { onConflict: 'clinic_id,key' })
        if (tErr) throw tErr
      }

      setToast('Сохранено')
      setTimeout(() => setToast(''), 1800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  // sorted stages по sort_order — на канвас показываем все, активные и нет
  const ordered = useMemo(
    () => [...stages].sort((a, b) => a.sort_order - b.sort_order),
    [stages]
  )

  return (
    <div className="space-y-3">
      {/* Тулбар поверх канвaса */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-gray-500">
          Воронка <span className="font-medium text-gray-900">«{pipeline.name}»</span>
          <span className="ml-2 text-xs text-gray-400">
            этапы — колонки, автоматизации — карточки внутри. Шаблоны с маркером «[ЗАПОЛНИТЬ&nbsp;…]» клиентам не отправляются.
          </span>
        </div>
        <div className="flex items-center gap-3">
          {toast && <span className="text-sm text-emerald-600">{toast}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
          <button
            onClick={save}
            disabled={saving || autoLoading}
            className="rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>

      {/* Канвас */}
      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3 min-w-max">
          {ordered.map((s, i) => {
            const cards = STAGE_AUTOMATIONS[s.code] ?? []
            const isMenu = stageMenu === s.id
            return (
              <div
                key={s.id}
                className={`w-[320px] shrink-0 rounded-lg border bg-white ${s.is_active ? '' : 'opacity-60'}`}
                style={{ borderColor: s.color }}
              >
                {/* Заголовок этапа */}
                <div
                  className="px-3 py-2 border-b rounded-t-lg flex items-start gap-2"
                  style={{ background: s.color + '22', borderColor: s.color }}
                >
                  <input
                    type="text"
                    value={nameDrafts[s.id] ?? s.name}
                    disabled={!s.is_editable}
                    onChange={e => setNameDrafts(d => ({ ...d, [s.id]: e.target.value }))}
                    onBlur={e => {
                      const v = e.target.value.trim()
                      setNameDrafts(d => {
                        if (!(s.id in d)) return d
                        const n = { ...d }; delete n[s.id]; return n
                      })
                      if (v && v !== s.name) onUpdateStage(s.id, { name: v })
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') {
                        setNameDrafts(d => {
                          if (!(s.id in d)) return d
                          const n = { ...d }; delete n[s.id]; return n
                        })
                        ;(e.target as HTMLInputElement).blur()
                      }
                    }}
                    className="bg-transparent flex-1 min-w-0 text-sm font-semibold text-gray-900 border-b border-transparent focus:border-gray-400 outline-none uppercase tracking-wide"
                  />
                  <button
                    onClick={() => setStageMenu(isMenu ? null : s.id)}
                    className="text-gray-500 hover:text-gray-800 text-base leading-none px-1"
                    title="Настройки этапа"
                  >⋮</button>
                </div>

                {/* Поп-меню стадии */}
                {isMenu && (
                  <div className="px-3 py-2 bg-white border-b border-gray-100 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Порядок</span>
                      <div className="flex gap-1">
                        <button onClick={() => onMoveStage(s, -1)} disabled={i === 0}
                          className="px-2 py-0.5 border border-gray-200 rounded disabled:opacity-30">←</button>
                        <button onClick={() => onMoveStage(s, 1)} disabled={i === ordered.length - 1}
                          className="px-2 py-0.5 border border-gray-200 rounded disabled:opacity-30">→</button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Цвет</span>
                      <div className="flex flex-wrap gap-1 max-w-[200px] justify-end">
                        {PRESET_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => onUpdateStage(s.id, { color: c })}
                            className={`w-4 h-4 rounded ${s.color === c ? 'ring-2 ring-offset-1 ring-gray-500' : ''}`}
                            style={{ background: c }}
                            aria-label={c}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Роль</span>
                      <select
                        value={s.stage_role}
                        disabled={s.is_system}
                        onChange={e => onUpdateStage(s.id, { stage_role: e.target.value as Stage['stage_role'] })}
                        className={`text-xs px-1.5 py-0.5 rounded ${ROLE_BADGE[s.stage_role]} border-0 disabled:opacity-60`}
                      >
                        {(['normal','won','lost','closed'] as const).map(r => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Учитывать в KPI</span>
                      <input type="checkbox" checked={s.counts_in_kpi}
                        onChange={e => onUpdateStage(s.id, { counts_in_kpi: e.target.checked })} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Активен</span>
                      <input type="checkbox" checked={s.is_active}
                        onChange={e => onUpdateStage(s.id, { is_active: e.target.checked })} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 shrink-0">Ответственный</span>
                      <select
                        value={s.default_responsible_user_id ?? ''}
                        onChange={e => onUpdateStage(s.id, { default_responsible_user_id: e.target.value || null })}
                        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 max-w-[140px] truncate"
                        title="Автоназначать при входе в этап"
                      >
                        <option value="">— не задан —</option>
                        {clinicUsers.map(u => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 font-mono">{s.code}</span>
                      <button
                        onClick={() => onDeleteStage(s)}
                        disabled={!s.is_deletable || s.is_system}
                        className="text-red-600 hover:text-red-700 disabled:text-gray-300"
                        title={s.is_system ? 'Системный этап' : 'Удалить'}
                      >Удалить</button>
                    </div>
                  </div>
                )}

                {/* Карточки автоматизаций */}
                <div className="p-2 space-y-2 min-h-[140px]" style={{ background: s.color + '0a' }}>
                  {autoLoading && (
                    <div className="text-xs text-gray-400 italic text-center py-6">Загрузка…</div>
                  )}
                  {!autoLoading && cards.length === 0 && customTriggers.filter(t => t.stage_id === s.id).length === 0 && (
                    <div className="text-xs text-gray-400 italic text-center py-4">
                      Триггеров нет
                    </div>
                  )}

                  {/* Пользовательские триггеры (мигр. 088) */}
                  {!autoLoading && customTriggers.filter(t => t.stage_id === s.id).map(t => {
                    const meta = TYPE_LABEL[t.type] ?? { icon: '•', label: t.type }
                    return (
                      <div key={t.id}
                        className="rounded-md bg-white border border-gray-200 p-2.5 space-y-1.5 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px]">
                            <span className="text-base leading-none">{meta.icon}</span>
                            <span className="font-semibold uppercase tracking-wide text-gray-500">{meta.label}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="inline-flex shrink-0 items-center gap-1 cursor-pointer">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-blue-600"
                                checked={t.is_active}
                                onChange={e => toggleTrigger(t.id, e.target.checked)}
                              />
                              <span className={`text-[11px] ${t.is_active ? 'text-emerald-700' : 'text-gray-400'}`}>
                                {t.is_active ? 'Вкл' : 'Выкл'}
                              </span>
                            </label>
                            <button
                              onClick={() => removeTrigger(t.id)}
                              className="text-gray-400 hover:text-red-600 text-xs"
                              title="Удалить"
                            >×</button>
                          </div>
                        </div>
                        <button
                          onClick={() => setEditingTrigger(t)}
                          className="w-full text-left text-[11px] text-gray-600 hover:text-gray-900 leading-snug bg-gray-50 hover:bg-gray-100 rounded px-2 py-1.5 transition"
                        >
                          {summarizeTriggerConfig(t)}
                          <span className="block text-[10px] text-blue-600 mt-0.5">Настроить →</span>
                        </button>
                      </div>
                    )
                  })}

                  {!autoLoading && cards.map(card => (
                    <div key={card.flag}
                      className="rounded-md bg-white border border-gray-200 p-2.5 space-y-1.5 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-base leading-none">{card.badge}</span>
                          <span className="font-semibold uppercase tracking-wide text-gray-500">{card.badgeLabel}</span>
                        </div>
                        <label className="inline-flex shrink-0 items-center gap-1 cursor-pointer">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-blue-600"
                            checked={flags[card.flag]}
                            onChange={e => setFlags(p => ({ ...p, [card.flag]: e.target.checked }))}
                          />
                          <span className={`text-[11px] ${flags[card.flag] ? 'text-emerald-700' : 'text-gray-400'}`}>
                            {flags[card.flag] ? 'Вкл' : 'Выкл'}
                          </span>
                        </label>
                      </div>
                      <div className="text-xs font-medium text-gray-900 leading-snug">{card.title}</div>
                      <div className="text-[11px] text-gray-500 leading-snug">{card.hint}</div>
                      <textarea
                        className="w-full rounded border border-gray-200 px-2 py-1 text-[11px] font-mono"
                        rows={card.rows}
                        placeholder="Текст шаблона…"
                        value={bodies[card.templateKey] ?? ''}
                        onChange={e => setBodies(p => ({ ...p, [card.templateKey]: e.target.value }))}
                      />
                    </div>
                  ))}

                  {/* Кнопка «+ Добавить триггер» (амо-стиль) */}
                  {!autoLoading && (
                    <button
                      onClick={() => setPickerStageId(s.id)}
                      className="w-full rounded-md border border-dashed border-gray-300 bg-white/60 hover:bg-white text-gray-500 hover:text-gray-700 text-xs py-3 transition"
                    >
                      <span className="opacity-60">⊕</span>&nbsp; Добавить триггер
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          {/* кнопка «+ этап» в конце ряда */}
          <button
            onClick={onAddStage}
            className="w-[80px] shrink-0 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 text-xs"
            title="Добавить этап"
          >
            + Этап
          </button>
        </div>
      </div>

      {/* Модалка выбора типа триггера */}
      <TriggerPicker
        open={pickerStageId !== null}
        onClose={() => setPickerStageId(null)}
        onPick={(type) => pickerStageId && addTrigger(pickerStageId, type)}
      />

      {/* Drawer настройки триггера */}
      <TriggerConfigDrawer
        open={editingTrigger !== null}
        trigger={editingTrigger}
        onClose={() => setEditingTrigger(null)}
        onSave={saveTriggerConfig}
      />
    </div>
  )
}

function summarizeTriggerConfig(t: CustomTrigger): string {
  const c = t.config || {}
  const delay = typeof c.delay_minutes === 'number' && c.delay_minutes > 0
    ? ` через ${c.delay_minutes} мин` : ''
  switch (t.type) {
    case 'salesbot':
      return c.template_key ? `Шаблон: ${c.template_key}${delay}` : 'Не настроен — выбрать шаблон'
    case 'create_task':
      return `Задача: «${(c.text as string) || 'Связаться'}»${delay}`
    case 'change_stage':
      return c.target_stage_id ? `Перевод в стадию${delay}` : 'Не настроен — выбрать стадию'
    case 'change_field':
      return c.field ? `Поле ${c.field} = "${c.value ?? ''}"${delay}` : 'Не настроен'
    case 'change_responsible':
      return c.user_id ? `Сменить ответственного${delay}` : 'Не настроен'
    case 'edit_tags':
      return `+[${(c.add as string[] || []).join(',')}] −[${(c.remove as string[] || []).join(',')}]${delay}`
    case 'complete_tasks':
      return `Закрыть открытые задачи${delay}`
    case 'webhook':
      return c.url ? `${c.method || 'POST'} ${String(c.url).slice(0, 40)}…${delay}` : 'Не настроен — указать URL'
    default:
      return 'Скоро'
  }
}
