'use client'

/**
 * <TriggerConfigDrawer /> — форма настройки конкретного триггера.
 *
 * Открывается при клике на карточку пользовательского триггера. Отдаёт
 * наверх (`onSave`) обновлённый { config, is_active }. PipelineCanvas
 * пишет в pipeline_stage_triggers (мигр. 088).
 *
 * Per-type fields:
 *   salesbot           → template_key + delay_minutes
 *   create_task        → text + due_in_minutes + delay_minutes
 *   change_stage       → target_stage_id + delay_minutes
 *   change_field       → field (whitelist) + value + delay_minutes
 *   change_responsible → user_id + delay_minutes
 *   edit_tags          → add[] + remove[] + delay_minutes
 *   complete_tasks     → delay_minutes
 *   webhook            → url + method + delay_minutes
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { TriggerType } from './TriggerPicker'

interface CustomTrigger {
  id: string
  stage_id: string
  type: TriggerType
  config: Record<string, unknown>
  is_active: boolean
}

interface StageRef { id: string; name: string; pipeline_id: string }
interface UserRef  { id: string; first_name: string; last_name: string }
interface TmplRef  { key: string; title: string }

interface Props {
  open: boolean
  trigger: CustomTrigger | null
  onClose: () => void
  onSave: (id: string, patch: { config: Record<string, unknown>; is_active: boolean }) => Promise<void>
}

const ALLOWED_FIELDS = [
  { key: 'priority',             label: 'Приоритет' },
  { key: 'contact_city',         label: 'Город контакта' },
  { key: 'notes',                label: 'Заметки' },
  { key: 'amount',               label: 'Сумма' },
  { key: 'preferred_doctor_id',  label: 'Предпочитаемый врач (UUID)' },
]

export default function TriggerConfigDrawer({ open, trigger, onClose, onSave }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [stages, setStages]   = useState<StageRef[]>([])
  const [users, setUsers]     = useState<UserRef[]>([])
  const [tmpls, setTmpls]     = useState<TmplRef[]>([])

  useEffect(() => {
    if (!trigger) return
    setConfig({ ...(trigger.config || {}) })
    setActive(trigger.is_active)
    setErr('')
  }, [trigger])

  useEffect(() => {
    if (!open || !clinicId) return
    ;(async () => {
      const [s, u, m] = await Promise.all([
        supabase.from('pipeline_stages')
          .select('id, name, pipeline_id, pipeline:pipelines!inner(clinic_id)')
          .eq('pipeline.clinic_id', clinicId)
          .order('sort_order'),
        supabase.from('user_profiles')
          .select('id, first_name, last_name')
          .eq('clinic_id', clinicId)
          .order('first_name'),
        supabase.from('message_templates')
          .select('key, title')
          .eq('clinic_id', clinicId)
          .eq('is_active', true)
          .order('title'),
      ])
      setStages((s.data ?? []) as unknown as StageRef[])
      setUsers((u.data ?? []) as UserRef[])
      setTmpls((m.data ?? []) as TmplRef[])
    })()
  }, [open, clinicId, supabase])

  if (!open || !trigger) return null

  const set = (k: string, v: unknown) => setConfig(c => ({ ...c, [k]: v }))
  const get = (k: string, fb: unknown = '') => config[k] ?? fb

  const save = async () => {
    setSaving(true); setErr('')
    try { await onSave(trigger.id, { config, is_active: active }); onClose() }
    catch (e) { setErr(e instanceof Error ? e.message : 'Ошибка') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Настройка триггера: {trigger.type}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-auto p-5 space-y-4">
          {/* Активен */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Активен</span>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          </label>

          {/* Per-type */}
          {trigger.type === 'salesbot' && (
            <SalesbotTriggerForm config={config} set={set} tmpls={tmpls} />
          )}

          {trigger.type === 'create_task' && (
            <>
              <Field label="Текст задачи">
                <textarea className={inputCls} rows={3}
                  value={String(get('text', 'Связаться с клиентом'))}
                  onChange={e => set('text', e.target.value)} />
              </Field>
              <Field label="Срок (минут от срабатывания)">
                <input type="number" min={5} className={inputCls}
                  value={Number(get('due_in_minutes', 60))}
                  onChange={e => set('due_in_minutes', parseInt(e.target.value, 10) || 60)} />
              </Field>
              <DelayField get={get} set={set} />
            </>
          )}

          {trigger.type === 'change_stage' && (
            <>
              <Field label="Целевая стадия">
                <select className={inputCls} value={String(get('target_stage_id'))} onChange={e => set('target_stage_id', e.target.value)}>
                  <option value="">— выбрать —</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <DelayField get={get} set={set} />
            </>
          )}

          {trigger.type === 'change_field' && (
            <>
              <Field label="Поле">
                <select className={inputCls} value={String(get('field'))} onChange={e => set('field', e.target.value)}>
                  <option value="">— выбрать —</option>
                  {ALLOWED_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Значение">
                <input type="text" className={inputCls}
                  value={String(get('value', ''))}
                  onChange={e => set('value', e.target.value)} />
              </Field>
              <DelayField get={get} set={set} />
            </>
          )}

          {trigger.type === 'change_responsible' && (
            <>
              <Field label="Новый ответственный">
                <select className={inputCls} value={String(get('user_id'))} onChange={e => set('user_id', e.target.value)}>
                  <option value="">— выбрать —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
                </select>
              </Field>
              <DelayField get={get} set={set} />
            </>
          )}

          {trigger.type === 'edit_tags' && (
            <>
              <Field label="Добавить теги (через запятую)">
                <input type="text" className={inputCls}
                  value={(Array.isArray(config.add) ? (config.add as string[]) : []).join(', ')}
                  onChange={e => set('add', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
              </Field>
              <Field label="Убрать теги (через запятую)">
                <input type="text" className={inputCls}
                  value={(Array.isArray(config.remove) ? (config.remove as string[]) : []).join(', ')}
                  onChange={e => set('remove', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
              </Field>
              <DelayField get={get} set={set} />
            </>
          )}

          {trigger.type === 'complete_tasks' && (
            <>
              <p className="text-xs text-gray-500">Закроет все открытые задачи сделки. Параметров нет.</p>
              <DelayField get={get} set={set} />
            </>
          )}

          {trigger.type === 'webhook' && (
            <>
              <Field label="URL">
                <input type="url" placeholder="https://..." className={inputCls}
                  value={String(get('url'))} onChange={e => set('url', e.target.value)} />
              </Field>
              <Field label="Метод">
                <select className={inputCls} value={String(get('method', 'POST'))} onChange={e => set('method', e.target.value)}>
                  <option>POST</option><option>PUT</option><option>GET</option>
                </select>
              </Field>
              <DelayField get={get} set={set} />
              <p className="text-xs text-gray-500 leading-snug">
                В тело уйдёт JSON: {`{ event, trigger:{id,type,stage_id}, deal:{id,clinic_id,stage_id,phone}, fired_at }`}
              </p>
            </>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md text-sm text-gray-700 hover:bg-gray-50">Отмена</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-md border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  )
}

function DelayField({
  get, set,
}: {
  get: (k: string, fb?: unknown) => unknown
  set: (k: string, v: unknown) => void
}) {
  return (
    <Field label="Задержка (минут после входа в стадию)">
      <input
        type="number" min={0} className={inputCls}
        value={Number(get('delay_minutes', 0))}
        onChange={e => set('delay_minutes', parseInt(e.target.value, 10) || 0)}
      />
    </Field>
  )
}

/**
 * Salesbot-trigger picker «как в amoCRM»: выбор момента запуска, шаблон,
 * чекбокс «применить ко всем сделкам в этапе». Под капотом всё ложится в
 * один объект config:
 *   { mode, template_key, delay_minutes?, daily_at?, no_reply_hours?, apply_to_existing? }
 *
 * Cron сейчас обрабатывает только on_enter с delay_minutes (modes 'immediate'
 * и 'delay'). Остальные режимы помечены как «в разработке» — UI сохраняет,
 * но обработчик на бэке появится позже.
 */
type SalesbotMode =
  | 'immediate'           // Сразу после создания в этапе
  | 'delay'               // Через N часов после входа в этап
  | 'before_datetime'     // За N часов до выбранного момента
  | 'at_datetime'         // В точное время YYYY-MM-DD HH:MM
  | 'daily_at'            // Ежедневно в HH:MM
  | 'on_chat_created_in'  // При создании беседы входящим (Скоро)
  | 'on_chat_created_out' // При создании беседы исходящим (Скоро)
  | 'no_reply_hours'      // X часов с последнего входящего
  | 'on_first_inbound'    // Первое входящее за день (Скоро)
  | 'on_read'             // При прочтении сообщения клиентом (Скоро)
  | 'on_chat_close'       // Сразу после закрытия беседы (Скоро)

const MODE_LABELS: Record<SalesbotMode, string> = {
  immediate:           'Сразу после создания в этапе',
  delay:               'Через N часов после входа в этап',
  before_datetime:     'За N часов до выбранного времени',
  at_datetime:         'В точное время',
  daily_at:            'Ежедневно в HH:MM',
  on_chat_created_in:  'При создании беседы входящим сообщением',
  on_chat_created_out: 'При создании беседы исходящим сообщением',
  no_reply_hours:      'N часов с последнего входящего сообщения',
  on_first_inbound:    'При первом входящем сообщении за день',
  on_read:             'При прочтении сообщения клиентом',
  on_chat_close:       'Сразу после закрытия беседы',
}

const IMPLEMENTED: Record<SalesbotMode, boolean> = {
  immediate: true, delay: true,
  before_datetime: true, at_datetime: true,
  daily_at: true,
  on_chat_created_in: true, on_chat_created_out: true,
  no_reply_hours: true,
  on_first_inbound: true, on_read: true, on_chat_close: true,
}

function SalesbotTriggerForm({
  config, set, tmpls,
}: {
  config: Record<string, unknown>
  set: (k: string, v: unknown) => void
  tmpls: TmplRef[]
}) {
  const mode = (config.mode as SalesbotMode | undefined) ?? 'immediate'
  const [open, setOpen] = useState(false)
  const ddRef = useRef<HTMLDivElement | null>(null)

  // Закрытие дропдауна по клику снаружи.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Выбрать режим и сразу подогнать сопутствующие поля под cron-формат.
  const setMode = (m: SalesbotMode) => {
    set('mode', m)
    if (m === 'immediate') set('delay_minutes', 0)
    if (m === 'daily_at' && !config.daily_at) set('daily_at', '10:00')
    if (m === 'no_reply_hours' && !config.no_reply_hours) set('no_reply_hours', 24)
    setOpen(false)
  }

  // Установить тайминг inline в строке «триггеров воронки» — под капотом
  // это либо immediate (delay=0), либо delay (delay_minutes>0). Оставляет
  // основной дропдаун открытым, чтобы пользователь видел результат.
  const setStageTiming = (delayMin: number) => {
    if (delayMin <= 0) {
      set('mode', 'immediate'); set('delay_minutes', 0)
    } else {
      set('mode', 'delay'); set('delay_minutes', delayMin)
    }
  }

  // Подпись текущего режима для кнопки «Выполнить:» — для immediate/delay
  // совмещаем в одно: «<тайминг> после создания в этапе».
  const currentLabel =
    mode === 'immediate' || mode === 'delay'
      ? `${formatStageTiming(Number(config.delay_minutes ?? 0))} после создания в этапе`
      : mode === 'on_first_inbound'
        ? `Первое входящее за ${ ({day:'день',week:'неделю',month:'месяц'} as Record<string,string>)[String(config.period ?? 'day')] ?? 'день' }`
        : mode === 'on_read'
          ? `При прочтении (${Number(config.read_window_hours ?? 24)} ч.)`
          : mode === 'on_chat_close'
            ? `${formatStageTiming(Number(config.close_delay_minutes ?? 0))} после закрытия беседы`
            : MODE_LABELS[mode]

  return (
    <div className="space-y-4">
      {/* Шаблон сообщения */}
      <Field label="Шаблон сообщения (Salesbot отправит этот текст)">
        <select className={inputCls}
          value={String(config.template_key ?? '')}
          onChange={e => set('template_key', e.target.value)}>
          <option value="">— выбрать —</option>
          {tmpls.map(t => <option key={t.key} value={t.key}>{t.title} ({t.key})</option>)}
        </select>
      </Field>

      {/* Выполнить: <текущий режим> ▾ */}
      <div className="relative" ref={ddRef}>
        <button type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between border border-gray-300 rounded-md px-3 py-2 text-sm bg-white hover:bg-gray-50">
          <span className="text-gray-800">
            <span className="text-gray-500">Выполнить:&nbsp;</span>
            {currentLabel}
          </span>
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" className="text-gray-400">
            <path d="M5.5 7.5l4.5 4.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {open && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-[420px] overflow-auto">
            <DropdownGroup title="Триггеры воронки">
              <StageTimingRow
                checked={mode === 'immediate' || mode === 'delay'}
                delayMinutes={Number(config.delay_minutes ?? 0)}
                onChange={setStageTiming}
              />
            </DropdownGroup>

            <DropdownGroup title="Триггеры по времени">
              <TimeTriggersRow
                mode={mode}
                config={config}
                set={set}
                setMode={(m) => {
                  // Inline: меняем mode, но дропдаун НЕ закрываем,
                  // чтобы пользователь мог продолжить заполнять поля.
                  set('mode', m)
                  if (m === 'daily_at' && !config.daily_at) set('daily_at', '10:00')
                }}
              />
            </DropdownGroup>

            <DropdownGroup title="Триггеры по беседам">
              <ChatTriggersRow
                mode={mode}
                config={config}
                set={set}
                setMode={(m) => set('mode', m)}
              />
            </DropdownGroup>
          </div>
        )}
      </div>

      {/* Параметры выбранного режима */}
      <ModeParams mode={mode} config={config} set={set} />

      <p className="text-xs text-gray-500 leading-snug">
        Сообщение будет отправлено контакту, если у него есть открытая беседа в WhatsApp.
      </p>

      {/* Применить к существующим */}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox"
          checked={!!config.apply_to_existing}
          onChange={e => set('apply_to_existing', e.target.checked)}
        />
        Применить триггер ко всем сделкам в текущей стадии воронки
      </label>
      <p className="text-[11px] text-gray-500 -mt-2 ml-6">
        По умолчанию триггер сработает только для сделок, которые войдут в этап
        ПОСЛЕ сохранения. Включите, чтобы прогнать также те, что уже там.
      </p>
    </div>
  )
}

/** Блок параметров под выбранный режим. Реализованные — с инпутами,
 *  «Скоро» — с заглушкой и пометкой. */
function ModeParams({
  mode, config, set,
}: {
  mode: SalesbotMode
  config: Record<string, unknown>
  set: (k: string, v: unknown) => void
}) {
  // immediate/delay/daily_at/at_datetime/before_datetime настраиваются
  // inline в дропдауне — здесь дополнительные поля не нужны.
  if (mode === 'immediate' || mode === 'delay') return null
  if (mode === 'daily_at' || mode === 'at_datetime' || mode === 'before_datetime') return null

  if (mode === 'no_reply_hours') {
    return (
      <Field label="Часов с последнего входящего сообщения">
        <input type="number" min={1} max={720} className={inputCls}
          value={Number(config.no_reply_hours ?? 24)}
          onChange={e => set('no_reply_hours', parseInt(e.target.value, 10) || 24)} />
      </Field>
    )
  }

  // Не реализованные режимы — заглушка.
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      Этот режим пока в разработке — UI сохранит выбор, но cron его не обрабатывает.
    </div>
  )
}

function DropdownGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </div>
      <div className="py-1">{children}</div>
    </div>
  )
}

/** Формат тайминга для immediate/delay: «Сразу», «Через 5 минут»,
 *  «Один день», «1 ч 30 м» и т.п. */
function formatStageTiming(min: number): string {
  if (!min || min <= 0) return 'Сразу'
  if (min === 1440) return 'Один день'
  if (min < 60) return `Через ${min} ${min === 1 ? 'минуту' : (min < 5 ? 'минуты' : 'минут')}`
  const h = Math.floor(min / 60), m = min % 60
  if (m === 0) return `Через ${h} ${h === 1 ? 'час' : (h < 5 ? 'часа' : 'часов')}`
  return `Через ${h} ч ${m} м`
}

const STAGE_PRESETS: { label: string; minutes: number }[] = [
  { label: 'Сразу',          minutes: 0 },
  { label: 'Через 5 минут',  minutes: 5 },
  { label: 'Через 10 минут', minutes: 10 },
  { label: 'Один день',      minutes: 1440 },
]

/** Кликабельная подпись «Сразу / Через 5 минут / …» с amo-поповером
 *  пресетов и custom-интервалом. Используется и в строке «триггеры
 *  воронки», и в строке «Сразу после закрытия беседы». */
function TimingButton({
  delayMinutes, onChange,
}: {
  delayMinutes: number
  onChange: (min: number) => void
}) {
  const [popOpen, setPopOpen] = useState(false)
  const [customH, setCustomH] = useState<number>(Math.floor(delayMinutes / 60))
  const [customM, setCustomM] = useState<number>(delayMinutes % 60)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!popOpen) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPopOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popOpen])

  // Локальные H/M синхронизируем с приходящим извне delayMinutes,
  // чтобы открыть поповер не сбрасывало уже введённое значение.
  useEffect(() => {
    setCustomH(Math.floor(delayMinutes / 60))
    setCustomM(delayMinutes % 60)
  }, [delayMinutes])

  const apply = (min: number) => { onChange(min); setPopOpen(false) }
  const applyCustom = () => apply(Math.max(0, customH * 60 + customM))

  return (
    <span className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setPopOpen(o => !o) }}
        className="text-blue-600 hover:underline font-medium"
      >
        {formatStageTiming(delayMinutes)}
      </button>

      {popOpen && (
        <div className="absolute z-30 left-0 top-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg w-[260px] py-1"
             onClick={(e) => e.stopPropagation()}>
          {STAGE_PRESETS.map(p => (
            <button key={p.minutes}
              type="button"
              onClick={() => apply(p.minutes)}
              className={`w-full flex items-center gap-2 text-left text-sm px-3 py-1.5 hover:bg-blue-50 ${
                p.minutes === delayMinutes ? 'bg-blue-50/70' : ''
              }`}
            >
              <span className="w-3 text-blue-600">
                {p.minutes === delayMinutes ? '✓' : ''}
              </span>
              <span>{p.label}</span>
            </button>
          ))}
          <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-1.5">
            <span className="text-sm text-gray-700 mr-1">Задать интервал</span>
            <input
              type="number" min={0} max={999}
              value={customH}
              onChange={e => setCustomH(Math.max(0, parseInt(e.target.value, 10) || 0))}
              className="w-12 rounded border border-gray-300 px-1.5 py-1 text-sm text-center"
            />
            <span className="text-xs text-gray-500">ч</span>
            <input
              type="number" min={0} max={59}
              value={customM}
              onChange={e => setCustomM(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
              className="w-12 rounded border border-gray-300 px-1.5 py-1 text-sm text-center"
            />
            <span className="text-xs text-gray-500">м</span>
            <button
              type="button"
              onClick={applyCustom}
              className="ml-auto px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs"
            >ОК</button>
          </div>
        </div>
      )}
    </span>
  )
}

/** Строка «<тайминг> после создания в этапе» в группе «Триггеры воронки». */
function StageTimingRow({
  checked, delayMinutes, onChange,
}: {
  checked: boolean
  delayMinutes: number
  onChange: (min: number) => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm px-3 py-1.5 hover:bg-blue-50/40">
      <span className={`w-3 inline-flex items-center justify-center text-blue-600`}>
        {checked ? '✓' : ''}
      </span>
      <TimingButton delayMinutes={delayMinutes} onChange={onChange} />
      <span className="text-gray-700">после создания в этапе</span>
    </div>
  )
}

/** Группа «Триггеры по времени» — три инлайновых строки c полями
 *  ввода прямо в тексте, как в amoCRM. Клик по любому полю строки
 *  активирует её mode. */
function TimeTriggersRow({
  mode, config, set, setMode,
}: {
  mode: SalesbotMode
  config: Record<string, unknown>
  set: (k: string, v: unknown) => void
  setMode: (m: SalesbotMode) => void
}) {
  // Утилиты для разделения ISO target_at на дату и время для DOM-инпутов.
  const targetAt = String(config.target_at ?? '')
  const datePart = targetAt.slice(0, 10) // YYYY-MM-DD
  const timePart = targetAt.slice(11, 16) // HH:MM
  const setTargetAt = (date: string, time: string) => {
    if (!date || !time) return
    set('target_at', `${date}T${time}:00`)
  }

  const ROW = 'flex items-center gap-2 text-sm px-3 py-1.5 hover:bg-blue-50/40'
  const CHK = (active: boolean) =>
    `w-3 inline-flex items-center justify-center text-blue-600 ${active ? '' : 'opacity-0'}`
  const FIELD = 'rounded border border-gray-300 px-2 py-0.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20'

  // — За N часов до выбранного времени —
  const beforeChecked = mode === 'before_datetime'
  // — Точное время —
  const atChecked = mode === 'at_datetime'
  // — Ежедневно в HH:MM —
  const dailyChecked = mode === 'daily_at'

  return (
    <div className="space-y-1">
      <div className={ROW} onClick={() => setMode('before_datetime')}>
        <span className={CHK(beforeChecked)}>✓</span>
        <span>За</span>
        <input
          type="number" min={0} max={720}
          value={Number(config.hours_before ?? 0)}
          onChange={e => { setMode('before_datetime'); set('hours_before', parseInt(e.target.value, 10) || 0) }}
          onClick={e => e.stopPropagation()}
          className={`${FIELD} w-16 text-center`}
        />
        <span>часов до</span>
        <input
          type="datetime-local"
          value={targetAt.slice(0, 16)}
          onChange={e => { setMode('before_datetime'); set('target_at', `${e.target.value}:00`) }}
          onClick={e => e.stopPropagation()}
          className={`${FIELD}`}
        />
      </div>

      <div className={ROW} onClick={() => setMode('at_datetime')}>
        <span className={CHK(atChecked)}>✓</span>
        <span>Точное время</span>
        <input
          type="date"
          value={datePart}
          onChange={e => { setMode('at_datetime'); setTargetAt(e.target.value, timePart || '10:00') }}
          onClick={e => e.stopPropagation()}
          className={FIELD}
        />
        <span>в</span>
        <input
          type="time"
          value={timePart || '10:00'}
          onChange={e => { setMode('at_datetime'); setTargetAt(datePart || new Date().toISOString().slice(0, 10), e.target.value) }}
          onClick={e => e.stopPropagation()}
          className={`${FIELD} w-24`}
        />
      </div>

      <div className={ROW} onClick={() => setMode('daily_at')}>
        <span className={CHK(dailyChecked)}>✓</span>
        <span className={dailyChecked ? 'text-gray-800' : 'text-blue-600 hover:underline'}>Ежедневно</span>
        <span>в</span>
        <input
          type="time"
          value={String(config.daily_at ?? '10:00')}
          onChange={e => { setMode('daily_at'); set('daily_at', e.target.value) }}
          onClick={e => e.stopPropagation()}
          className={`${FIELD} w-24`}
        />
      </div>
    </div>
  )
}

/** Группа «Триггеры по беседам» — амо-стиль с инлайн-параметрами в тексте.
 *  Источник один — WhatsApp (Green-API), направление переключается кликом
 *  по слову «входящим/исходящим». */
function ChatTriggersRow({
  mode, config, set, setMode,
}: {
  mode: SalesbotMode
  config: Record<string, unknown>
  set: (k: string, v: unknown) => void
  setMode: (m: SalesbotMode) => void
}) {
  const ROW    = 'flex items-center flex-wrap gap-2 text-sm px-3 py-1.5 hover:bg-blue-50/40 cursor-pointer'
  const CHK    = (active: boolean) =>
    `w-3 inline-flex items-center justify-center text-blue-600 ${active ? '' : 'opacity-0'}`
  const LINK   = 'text-blue-600 hover:underline cursor-pointer'
  const FIELD  = 'rounded border border-gray-300 px-2 py-0.5 text-sm bg-white w-16 text-center focus:outline-none focus:ring-2 focus:ring-blue-500/20'
  const SOURCE = <span className="text-blue-600">WhatsApp</span> // у нас один канал

  const createdChecked = mode === 'on_chat_created_in' || mode === 'on_chat_created_out'
  const createdDir = mode === 'on_chat_created_out' ? 'out' : 'in'
  const toggleCreatedDir = () =>
    setMode(createdDir === 'in' ? 'on_chat_created_out' : 'on_chat_created_in')

  const period = String(config.period ?? 'day')
  const PERIODS: Record<string, string> = { day: 'день', week: 'неделю', month: 'месяц' }
  const cyclePeriod = () => {
    const keys = Object.keys(PERIODS)
    const next = keys[(keys.indexOf(period) + 1) % keys.length]
    setMode('on_first_inbound'); set('period', next)
  }

  return (
    <div className="space-y-1">
      {/* При создании беседы <входящим|исходящим> сообщением в WhatsApp */}
      <div className={ROW} onClick={() => setMode(createdDir === 'in' ? 'on_chat_created_in' : 'on_chat_created_out')}>
        <span className={CHK(createdChecked)}>✓</span>
        <span>При создании беседы</span>
        <button type="button" className={LINK}
          onClick={(e) => { e.stopPropagation(); toggleCreatedDir() }}>
          {createdDir === 'in' ? 'входящим' : 'исходящим'}
        </button>
        <span>сообщением в</span> {SOURCE}
      </div>

      {/* [N] часов с последнего входящего сообщения в WhatsApp */}
      <div className={ROW} onClick={() => setMode('no_reply_hours')}>
        <span className={CHK(mode === 'no_reply_hours')}>✓</span>
        <input type="number" min={1} max={720}
          value={Number(config.no_reply_hours ?? 0)}
          onChange={e => { setMode('no_reply_hours'); set('no_reply_hours', parseInt(e.target.value, 10) || 0) }}
          onClick={e => e.stopPropagation()}
          className={FIELD}
        />
        <span>часов с последнего вход. сообщения в</span> {SOURCE}
      </div>

      {/* При первом входящем сообщении в WhatsApp за <день|неделю|месяц> */}
      <div className={ROW} onClick={() => setMode('on_first_inbound')}>
        <span className={CHK(mode === 'on_first_inbound')}>✓</span>
        <span>При первом</span>
        <span className="text-blue-600">входящем</span>
        <span>сообщении в</span> {SOURCE}
        <span>за</span>
        <button type="button" className={LINK}
          onClick={(e) => { e.stopPropagation(); cyclePeriod() }}>
          {PERIODS[period] ?? PERIODS.day}
        </button>
      </div>

      {/* При прочтении сообщения клиентом в WhatsApp ([24 ч.]) */}
      <div className={ROW} onClick={() => setMode('on_read')}>
        <span className={CHK(mode === 'on_read')}>✓</span>
        <span>При прочтении сообщения клиентом в</span> {SOURCE}
        <span>(</span>
        <input type="number" min={1} max={168}
          value={Number(config.read_window_hours ?? 24)}
          onChange={e => { setMode('on_read'); set('read_window_hours', parseInt(e.target.value, 10) || 24) }}
          onClick={e => e.stopPropagation()}
          className={FIELD}
        />
        <span>ч.)</span>
      </div>

      {/* <тайминг> после закрытия беседы WhatsApp */}
      <div className={ROW} onClick={() => setMode('on_chat_close')}>
        <span className={CHK(mode === 'on_chat_close')}>✓</span>
        <TimingButton
          delayMinutes={Number(config.close_delay_minutes ?? 0)}
          onChange={(min) => { setMode('on_chat_close'); set('close_delay_minutes', min) }}
        />
        <span>после закрытия беседы</span> {SOURCE}
      </div>
    </div>
  )
}

function DropdownItem({
  label, checked, onSelect, available,
}: {
  label: string; checked: boolean; onSelect: () => void; available: boolean
}) {
  return (
    <button
      type="button"
      onClick={available ? onSelect : undefined}
      disabled={!available}
      className={`w-full flex items-center gap-2 text-left text-sm px-3 py-1.5 ${
        available ? 'hover:bg-blue-50 text-gray-800 cursor-pointer' : 'text-gray-400 cursor-not-allowed'
      } ${checked ? 'bg-blue-50/70' : ''}`}
    >
      <span className={`w-3 inline-flex items-center justify-center text-blue-600`}>
        {checked ? '✓' : ''}
      </span>
      <span className="flex-1">{label}</span>
      {!available && (
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
          Скоро
        </span>
      )}
    </button>
  )
}
