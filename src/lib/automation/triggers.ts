/**
 * Исполнение пользовательских триггеров воронки (мигр. 088).
 *
 * Вызывается из /api/cron/automation. Идемпотентность — через таблицу
 * pipeline_trigger_executions (мигр. 089 + 092):
 *   • dedup_key=NULL  → один раз per (trigger, deal) — immediate / delay
 *   • dedup_key='YYYY-MM-DD' → один раз в сутки — daily_at
 *   • dedup_key='<last_inbound_msg_id>' → один раз на «затишье» — no_reply_hours
 *
 * При выходе сделки из стадии БД-триггер очищает executions (мигр. 089),
 * чтобы при повторном входе действия отработали снова.
 *
 * Поддерживаемые типы:
 *   • salesbot, create_task, change_stage, change_field,
 *     change_responsible, edit_tags, complete_tasks, webhook
 *
 * Режимы (config.mode, расширение поверх 088):
 *   • immediate         — сразу при входе в стадию
 *   • delay             — через config.delay_minutes
 *   • daily_at          — ежедневно в config.daily_at (HH:MM)
 *   • no_reply_hours    — если последнее inbound старше config.no_reply_hours
 *   (immediate/delay = event 'on_enter'; daily_at/no_reply_hours тоже
 *    в стадии, но проверяются по своим условиям, отдельно от stage_entered_at)
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

// ── Mode helpers ────────────────────────────────────────────────────────────

const TICK_WINDOW_MIN = 5 // согласовано с pg_cron */5

/** Проверка: попало ли текущее время в окно [HH:MM, HH:MM + tick) с учётом местного TZ конфига. */
function inDailyAtWindow(hhmm: string, now: Date): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return false
  const h = Number(m[1]), mm = Number(m[2])
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return false
  const target = h * 60 + mm
  const cur    = now.getUTCHours() * 60 + now.getUTCMinutes()
  // окно tick минут вперёд (cron срабатывает раз в TICK_WINDOW_MIN)
  const diff = ((cur - target) + 24 * 60) % (24 * 60)
  return diff >= 0 && diff < TICK_WINDOW_MIN
}

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10) // YYYY-MM-DD UTC
}

/** ISO-week number (1..53) — без зависимостей. */
function weekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (t.getUTCDay() + 6) % 7 // пн=0..вс=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3)
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const diff = (t.getTime() - firstThu.getTime()) / 86400_000
  return 1 + Math.round((diff - ((firstThu.getUTCDay() + 6) % 7) + 3) / 7)
}

/** Начало периода (UTC), для фильтра «было ли inbound в этом периоде». */
function startOfPeriod(now: Date, period: 'day' | 'week' | 'month'): Date {
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  if (period === 'week') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const dayNum = (d.getUTCDay() + 6) % 7 // пн=0
    d.setUTCDate(d.getUTCDate() - dayNum)
    return d
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

type Mode =
  | 'immediate' | 'delay' | 'daily_at' | 'no_reply_hours'
  | 'at_datetime' | 'before_datetime'
  | 'on_chat_created_in' | 'on_chat_created_out' | 'on_first_inbound'

/** Определяем режим триггера. По умолчанию immediate/delay (on_enter). */
function detectMode(t: PipelineTrigger): Mode {
  const m = cfgStr(t.config, 'mode')
  if (m === 'daily_at')             return 'daily_at'
  if (m === 'no_reply_hours')       return 'no_reply_hours'
  if (m === 'at_datetime')          return 'at_datetime'
  if (m === 'before_datetime')      return 'before_datetime'
  if (m === 'on_chat_created_in')   return 'on_chat_created_in'
  if (m === 'on_chat_created_out')  return 'on_chat_created_out'
  if (m === 'on_first_inbound')     return 'on_first_inbound'
  if (m === 'delay')                return 'delay'
  if (m === 'immediate')            return 'immediate'
  // обратная совместимость: если есть delay_minutes → delay, иначе immediate
  return cfgNum(t.config, 'delay_minutes', 0) > 0 ? 'delay' : 'immediate'
}

/** Сработала ли точка времени в окне «cron-tick минут после fireAt». */
function inFireWindow(fireAt: Date, now: Date): boolean {
  const diff = now.getTime() - fireAt.getTime()
  return diff >= 0 && diff < TICK_WINDOW_MIN * 60_000
}

// ── Cron entry ───────────────────────────────────────────────────────────────

export async function processCustomTriggers(sb: SupabaseClient): Promise<{
  triggers: number; fired: number; failed: number; skipped: number
}> {
  const now = new Date()

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
    const mode = detectMode(t)

    // Daily-at: вне 5-минутного окна — пропускаем.
    if (mode === 'daily_at') {
      const at = cfgStr(t.config, 'daily_at')
      if (!inDailyAtWindow(at, now)) { skipped++; continue }
    }

    // At-datetime / before-datetime: считаем fireAt и проверяем окно.
    if (mode === 'at_datetime' || mode === 'before_datetime') {
      const targetIso = cfgStr(t.config, 'target_at')
      if (!targetIso) { skipped++; continue }
      const target = new Date(targetIso)
      if (isNaN(target.getTime())) { skipped++; continue }
      const fireAt = mode === 'before_datetime'
        ? new Date(target.getTime() - cfgNum(t.config, 'hours_before', 0) * 3600_000)
        : target
      if (!inFireWindow(fireAt, now)) { skipped++; continue }
    }

    // Базовый запрос сделок этой стадии.
    let q = sb
      .from('deals')
      .select('id, clinic_id, stage_id, stage_entered_at, responsible_user_id, contact_phone, tags')
      .eq('clinic_id', t.clinic_id)
      .eq('stage_id', t.stage_id)
      .is('deleted_at', null)

    if (mode === 'delay' || mode === 'immediate') {
      const delayMin = mode === 'delay' ? cfgNum(t.config, 'delay_minutes', 0) : 0
      const cutoff   = new Date(now.getTime() - delayMin * 60_000).toISOString()
      q = q.lte('stage_entered_at', cutoff)
    }

    const { data: deals } = await q.returns<DealMin[]>()
    if (!deals?.length) continue

    // Уже исполнено? — берём executions этого триггера и строим карту.
    const { data: doneRows } = await sb
      .from('pipeline_trigger_executions')
      .select('deal_id, dedup_key').eq('trigger_id', t.id)
      .returns<{ deal_id: string; dedup_key: string | null }[]>()
    const seenKeys = new Set((doneRows ?? []).map(r => `${r.deal_id}|${r.dedup_key ?? ''}`))

    for (const d of deals) {
      // Вычисляем dedup_key и (для no_reply) проверяем условие.
      let dedup: string | null = null

      if (mode === 'daily_at') {
        dedup = todayKey(now)
      } else if (mode === 'at_datetime' || mode === 'before_datetime') {
        // Дедуп по самому target_at: если менеджер изменит дату — триггер сработает снова.
        dedup = `${mode}:${cfgStr(t.config, 'target_at')}`
      } else if (mode === 'no_reply_hours') {
        const hours = cfgNum(t.config, 'no_reply_hours', 0)
        if (hours <= 0) continue
        // Берём последнее входящее сообщение этой сделки.
        const { data: last } = await sb
          .from('deal_messages')
          .select('id, created_at')
          .eq('deal_id', d.id)
          .eq('direction', 'in')
          .order('created_at', { ascending: false })
          .limit(1)
          .returns<{ id: string; created_at: string }[]>()
        if (!last?.length) continue // ещё ни одного входящего — пропускаем
        const ageMs = now.getTime() - new Date(last[0].created_at).getTime()
        if (ageMs < hours * 3600_000) continue
        dedup = last[0].id // дедуп по конкретному «последнему inbound»
      } else if (mode === 'on_chat_created_in' || mode === 'on_chat_created_out') {
        // «При создании беседы»: проверяем, что у сделки есть хотя бы
        // одно сообщение нужного направления. Дедуп — one-shot per сделке.
        const dir = mode === 'on_chat_created_in' ? 'in' : 'out'
        const { data: any1 } = await sb
          .from('deal_messages')
          .select('id')
          .eq('deal_id', d.id)
          .eq('direction', dir)
          .limit(1)
          .returns<{ id: string }[]>()
        if (!any1?.length) continue
        dedup = null // one-shot
      } else if (mode === 'on_first_inbound') {
        // Первое входящее за период (день/неделя/месяц). Дедуп —
        // по периоду: для day → 'YYYY-MM-DD', для week → 'YYYY-Www', для month → 'YYYY-MM'.
        const period = cfgStr(t.config, 'period', 'day')
        const periodKey =
          period === 'month' ? now.toISOString().slice(0, 7) :
          period === 'week'  ? `${now.getUTCFullYear()}-W${String(weekNumber(now)).padStart(2, '0')}` :
          /* day */            todayKey(now)
        // Проверяем: было ли inbound в этом периоде.
        const periodStart = startOfPeriod(now, period as 'day' | 'week' | 'month')
        const { data: any1 } = await sb
          .from('deal_messages')
          .select('id')
          .eq('deal_id', d.id)
          .eq('direction', 'in')
          .gte('created_at', periodStart.toISOString())
          .limit(1)
          .returns<{ id: string }[]>()
        if (!any1?.length) continue
        dedup = `${period}:${periodKey}`
      }

      const key = `${d.id}|${dedup ?? ''}`
      if (seenKeys.has(key)) continue

      try {
        await handler(sb, t, d)
        await sb.from('pipeline_trigger_executions').insert({
          clinic_id: t.clinic_id, trigger_id: t.id, deal_id: d.id,
          dedup_key: dedup, status: 'ok',
        })
        fired++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await sb.from('pipeline_trigger_executions').insert({
          clinic_id: t.clinic_id, trigger_id: t.id, deal_id: d.id,
          dedup_key: dedup, status: 'failed', error: msg.slice(0, 500),
        })
        failed++
      }
    }
  }

  return { triggers: triggers.length, fired, failed, skipped }
}
