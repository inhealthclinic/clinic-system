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

import { useEffect, useMemo, useState } from 'react'
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
            <>
              <Field label="Шаблон сообщения">
                <select className={inputCls} value={String(get('template_key'))} onChange={e => set('template_key', e.target.value)}>
                  <option value="">— выбрать —</option>
                  {tmpls.map(t => <option key={t.key} value={t.key}>{t.title} ({t.key})</option>)}
                </select>
              </Field>
              <DelayField get={get} set={set} />
            </>
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
