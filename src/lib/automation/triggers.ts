/**
 * Исполнение пользовательских триггеров воронки (мигр. 088).
 *
 * Вызывается из /api/cron/automation. Идемпотентность — через таблицу
 * pipeline_trigger_executions (мигр. 089): после успешного исполнения
 * пишем (trigger_id, deal_id), unique-индекс не даст повторить. При
 * выходе сделки из стадии БД-триггер очищает записи (см. 089), чтобы
 * при повторном входе действия отработали снова.
 *
 * Поддерживаемые типы (event='on_enter'):
 *   • salesbot           — отправить шаблон WhatsApp
 *   • create_task        — создать задачу менеджеру
 *   • change_stage       — перевести сделку в другую стадию
 *   • change_field       — обновить колонку deals.<field>
 *   • change_responsible — сменить ответственного
 *   • edit_tags          — добавить/убрать теги
 *   • complete_tasks     — закрыть открытые задачи сделки
 *   • webhook            — POST на внешний URL
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendTemplateToDeal } from './sender'

export interface PipelineTrigger {
  id: string
  clinic_id: string
  stage_id: string
  type: string
  event: 'on_enter' | 'on_exit' | 'on_create' | 'on_no_reply'
  config: Record<string, unknown>
  is_active: boolean
}

interface DealMin {
  id: string
  clinic_id: string
  stage_id: string | null
  stage_entered_at: string | null
  responsible_user_id: string | null
  contact_phone: string | null
  tags: string[] | null
}

const cfgStr = (c: Record<string, unknown>, k: string, fb = '') =>
  (typeof c[k] === 'string' ? (c[k] as string) : fb)
const cfgNum = (c: Record<string, unknown>, k: string, fb = 0) =>
  (typeof c[k] === 'number' ? (c[k] as number) : fb)
const cfgArr = (c: Record<string, unknown>, k: string): string[] =>
  (Array.isArray(c[k]) ? (c[k] as string[]) : [])

// ── Action handlers ──────────────────────────────────────────────────────────

async function execSalesbot(sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const key = cfgStr(t.config, 'template_key')
  if (!key) throw new Error('config.template_key required')
  const r = await sendTemplateToDeal(sb, d.id, key)
  if (r.status === 'failed')  throw new Error(r.error)
  if (r.status === 'skipped') throw new Error(`skipped: ${r.reason}`)
}

async function execCreateTask(sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const text  = cfgStr(t.config, 'text', 'Связаться с клиентом')
  const dueIn = cfgNum(t.config, 'due_in_minutes', 60)
  const due   = new Date(Date.now() + dueIn * 60_000).toISOString()
  const { error } = await sb.from('tasks').insert({
    clinic_id:   d.clinic_id,
    deal_id:     d.id,
    assigned_to: d.responsible_user_id,
    title:       text,
    due_at:      due,
    priority:    'normal',
    status:      'new',
    type:        'follow_up',
  })
  if (error) throw new Error(error.message)
}

async function execChangeStage(sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const target = cfgStr(t.config, 'target_stage_id')
  if (!target) throw new Error('config.target_stage_id required')
  if (target === d.stage_id) return // уже там
  const { error } = await sb.from('deals').update({ stage_id: target }).eq('id', d.id)
  if (error) throw new Error(error.message)
}

async function execChangeField(sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const field = cfgStr(t.config, 'field')
  if (!field) throw new Error('config.field required')
  // Whitelist: чтобы триггер не мог писать в clinic_id/id/stage_id мимо change_stage.
  const ALLOW = new Set(['priority','contact_city','notes','amount','source_id','preferred_doctor_id'])
  if (!ALLOW.has(field)) throw new Error(`field "${field}" not allowed`)
  const value = t.config['value']
  const { error } = await sb.from('deals').update({ [field]: value }).eq('id', d.id)
  if (error) throw new Error(error.message)
}

async function execChangeResponsible(sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const userId = cfgStr(t.config, 'user_id')
  if (!userId) throw new Error('config.user_id required')
  const { error } = await sb.from('deals').update({ responsible_user_id: userId }).eq('id', d.id)
  if (error) throw new Error(error.message)
}

async function execEditTags(sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const add    = cfgArr(t.config, 'add')
  const remove = cfgArr(t.config, 'remove')
  const cur    = d.tags ?? []
  const next   = [...new Set([...cur, ...add])].filter(x => !remove.includes(x))
  const { error } = await sb.from('deals').update({ tags: next }).eq('id', d.id)
  if (error) throw new Error(error.message)
}

async function execCompleteTasks(sb: SupabaseClient, _t: PipelineTrigger, d: DealMin) {
  const { error } = await sb.from('tasks')
    .update({ status: 'done', done_at: new Date().toISOString() })
    .eq('deal_id', d.id).in('status', ['new', 'in_progress'])
  if (error) throw new Error(error.message)
}

async function execWebhook(_sb: SupabaseClient, t: PipelineTrigger, d: DealMin) {
  const url    = cfgStr(t.config, 'url')
  if (!url) throw new Error('config.url required')
  const method = cfgStr(t.config, 'method', 'POST').toUpperCase()
  const payload = {
    event:    t.event,
    trigger:  { id: t.id, type: t.type, stage_id: t.stage_id },
    deal:     { id: d.id, clinic_id: d.clinic_id, stage_id: d.stage_id, phone: d.contact_phone },
    fired_at: new Date().toISOString(),
  }
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`webhook ${res.status}`)
}

const HANDLERS: Record<string, (sb: SupabaseClient, t: PipelineTrigger, d: DealMin) => Promise<void>> = {
  salesbot:           execSalesbot,
  create_task:        execCreateTask,
  change_stage:       execChangeStage,
  change_field:       execChangeField,
  change_responsible: execChangeResponsible,
  edit_tags:          execEditTags,
  complete_tasks:     execCompleteTasks,
  webhook:            execWebhook,
}

// ── Cron entry: обрабатываем все active on_enter триггеры ────────────────────

export async function processCustomTriggers(sb: SupabaseClient): Promise<{
  triggers: number; fired: number; failed: number; skipped: number
}> {
  const { data: triggers } = await sb
    .from('pipeline_stage_triggers')
    .select('*')
    .eq('is_active', true)
    .eq('event', 'on_enter')
    .returns<PipelineTrigger[]>()
  if (!triggers?.length) return { triggers: 0, fired: 0, failed: 0, skipped: 0 }

  let fired = 0, failed = 0, skipped = 0

  for (const t of triggers) {
    const handler = HANDLERS[t.type]
    if (!handler) { skipped++; continue }
    const delayMin = cfgNum(t.config, 'delay_minutes', 0)
    const cutoff   = new Date(Date.now() - delayMin * 60_000).toISOString()

    // Сделки в этой стадии, попавшие сюда не позже cutoff,
    // и для которых ещё не было исполнения этого триггера.
    const { data: deals } = await sb
      .from('deals')
      .select('id, clinic_id, stage_id, stage_entered_at, responsible_user_id, contact_phone, tags')
      .eq('clinic_id', t.clinic_id)
      .eq('stage_id', t.stage_id)
      .is('deleted_at', null)
      .lte('stage_entered_at', cutoff)
      .returns<DealMin[]>()
    if (!deals?.length) continue

    // Узнаём, для каких deal_id уже было выполнение этого триггера.
    const { data: done } = await sb
      .from('pipeline_trigger_executions')
      .select('deal_id').eq('trigger_id', t.id)
      .returns<{ deal_id: string }[]>()
    const seen = new Set((done ?? []).map(r => r.deal_id))

    for (const d of deals) {
      if (seen.has(d.id)) continue
      try {
        await handler(sb, t, d)
        await sb.from('pipeline_trigger_executions').insert({
          clinic_id: t.clinic_id, trigger_id: t.id, deal_id: d.id, status: 'ok',
        })
        fired++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await sb.from('pipeline_trigger_executions').insert({
          clinic_id: t.clinic_id, trigger_id: t.id, deal_id: d.id,
          status: 'failed', error: msg.slice(0, 500),
        })
        failed++
      }
    }
  }

  return { triggers: triggers.length, fired, failed, skipped }
}
