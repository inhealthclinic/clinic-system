/**
 * GET /api/cron/automation
 *
 * Семь блоков автоматизаций воронки «Лиды» (см. 085_pipeline_automation.sql).
 * Запускается каждые 5 минут (GitHub Actions). Идемпотентность — фильтрами
 * `<x>_sent_at IS NULL` / `<x>_created_at IS NULL`.
 *
 * Все блоки управляются флагами в clinics.settings.automation:
 *   { work_24h: true, work_48h: true, touch_1: true, touch_2: true,
 *     touch_3: true, touch_no_reply: true }
 * При false — блок не работает для конкретной клиники.
 *
 * Защита: Authorization: Bearer ${CRON_SECRET}.
 *
 * Бот «Приветствие»/«Фоллоуап» (блок A) живут в /api/cron/bot-greeting и
 * /api/cron/bot-followup — их сюда не дублируем.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendTemplateToDeal } from '@/lib/automation/sender'
import { processCustomTriggers } from '@/lib/automation/triggers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const HOUR = 60 * 60 * 1000

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ClinicSettings {
  automation?: {
    work_24h?: boolean
    work_48h?: boolean
    touch_1?: boolean
    touch_2?: boolean
    touch_3?: boolean
    touch_no_reply?: boolean
  }
}

async function getClinicAutomation(
  sb: SupabaseClient, clinicIds: string[],
): Promise<Map<string, ClinicSettings['automation']>> {
  if (clinicIds.length === 0) return new Map()
  const { data } = await sb
    .from('clinics')
    .select('id, settings')
    .in('id', clinicIds)
    .returns<{ id: string; settings: ClinicSettings | null }[]>()
  return new Map((data ?? []).map(c => [c.id, c.settings?.automation ?? {}]))
}

async function getStageId(sb: SupabaseClient, clinicId: string, code: string): Promise<string | null> {
  // pipelines.code='leads' для каждой клиники, pipeline_stages.code = our key.
  const { data } = await sb
    .from('pipeline_stages')
    .select('id, pipeline:pipelines!inner(clinic_id, code)')
    .eq('code', code)
    .eq('pipeline.clinic_id', clinicId)
    .eq('pipeline.code', 'leads')
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

interface AutomationDealRow {
  id: string
  clinic_id: string
  responsible_user_id: string | null
  entered_touch_stage_at: string | null
  entered_work_stage_at: string | null
  last_inbound_message_at: string | null
  touch1_sent_at: string | null
  touch2_sent_at: string | null
  touch3_sent_at: string | null
  task_24h_created_at: string | null
  task_48h_created_at: string | null
  task_no_reply_created_at: string | null
  stage_id: string | null
}

// Если клиент ответил после reference — задачу/касание не делаем.
function clientRepliedAfter(d: AutomationDealRow, reference: string | null): boolean {
  if (!reference) return false
  if (!d.last_inbound_message_at) return false
  return new Date(d.last_inbound_message_at).getTime() > new Date(reference).getTime()
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })
  }
  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const now = Date.now()
  const stats = {
    touch_1: 0, touch_2: 0, touch_3: 0,
    work_task_24h: 0, work_task_48h: 0,
    touch_no_reply_task: 0,
    skipped: 0, failed: 0,
  }

  // Подгрузим все «активные для автоматизации» сделки одним запросом —
  // их немного (только в этапах in_progress + contact, без deleted).
  const { data: deals, error: dErr } = await sb
    .from('deals')
    .select(`
      id, clinic_id, responsible_user_id, stage_id,
      entered_touch_stage_at, entered_work_stage_at, last_inbound_message_at,
      touch1_sent_at, touch2_sent_at, touch3_sent_at,
      task_24h_created_at, task_48h_created_at, task_no_reply_created_at
    `)
    .or('entered_touch_stage_at.not.is.null,entered_work_stage_at.not.is.null')
    .is('deleted_at', null)
    .returns<AutomationDealRow[]>()

  if (dErr) {
    console.error('[cron/automation] queue load failed:', dErr.message)
    return NextResponse.json({ error: dErr.message }, { status: 500 })
  }

  if (!deals || deals.length === 0) {
    // Даже если хардкодных целей нет, прогоняем пользовательские триггеры (мигр. 088).
    const custom = await processCustomTriggers(sb).catch((e) => {
      console.error('[cron/automation] custom triggers failed:', e)
      return { triggers: 0, fired: 0, failed: 0, skipped: 0 }
    })
    return NextResponse.json({ ok: true, ...stats, custom })
  }

  const clinicIds = Array.from(new Set(deals.map(d => d.clinic_id)))
  const settingsByClinic = await getClinicAutomation(sb, clinicIds)

  for (const d of deals) {
    const auto = settingsByClinic.get(d.clinic_id) ?? {}

    // ── Блок «В работе»: задача 24ч / 48ч ────────────────────────────────────
    if (d.entered_work_stage_at) {
      const sinceWork = now - new Date(d.entered_work_stage_at).getTime()

      // Если клиент написал ПОСЛЕ входа в этап «В работе» — таймер сбрасывается.
      // Менеджер реально работает с лидом, бот не лезет.
      const repliedInWork = clientRepliedAfter(d, d.entered_work_stage_at)

      if (auto.work_24h !== false
          && !d.task_24h_created_at
          && sinceWork >= 24 * HOUR
          && !repliedInWork) {
        const ok = await createWorkTask(sb, d, '24h')
        if (ok) { stats.work_task_24h++ } else { stats.failed++ }
      }

      if (auto.work_48h !== false
          && !d.task_48h_created_at
          && sinceWork >= 48 * HOUR
          && !repliedInWork) {
        const ok = await createWorkTask(sb, d, '48h')
        if (ok) { stats.work_task_48h++ } else { stats.failed++ }
      }
    }

    // ── Блок «Касание»: 1 сразу, 2 через 120ч, 3 через 240ч, потом задача ────
    if (d.entered_touch_stage_at) {
      const sinceTouch = now - new Date(d.entered_touch_stage_at).getTime()
      const repliedInTouch = clientRepliedAfter(d, d.entered_touch_stage_at)

      // Если клиент ответил в этапе «Касание» — все дальнейшие касания и
      // задачу делаем НЕ. Менеджер забирает диалог.
      if (!repliedInTouch) {
        // 1 касание — сразу при входе.
        if (auto.touch_1 !== false && !d.touch1_sent_at) {
          const ok = await sendTouch(sb, d, 'touch_1', 'touch1_sent_at')
          if (ok) { stats.touch_1++ } else { stats.skipped++ }
        }

        // 2 касание — +120ч после входа в Касание (= +120ч после 1-го).
        if (auto.touch_2 !== false
            && d.touch1_sent_at
            && !d.touch2_sent_at
            && sinceTouch >= 120 * HOUR) {
          const ok = await sendTouch(sb, d, 'touch_2', 'touch2_sent_at')
          if (ok) { stats.touch_2++ } else { stats.skipped++ }
        }

        // 3 касание — +240ч после входа (= +120ч после 2-го).
        if (auto.touch_3 !== false
            && d.touch2_sent_at
            && !d.touch3_sent_at
            && sinceTouch >= 240 * HOUR) {
          const ok = await sendTouch(sb, d, 'touch_3', 'touch3_sent_at')
          if (ok) { stats.touch_3++ } else { stats.skipped++ }
        }

        // Задача после 3-го касания: если за +24ч ответа всё ещё нет —
        // зовём менеджера принять решение по сделке.
        if (auto.touch_no_reply !== false
            && d.touch3_sent_at
            && !d.task_no_reply_created_at
            && now - new Date(d.touch3_sent_at).getTime() >= 24 * HOUR) {
          const ok = await createNoReplyTask(sb, d)
          if (ok) { stats.touch_no_reply_task++ } else { stats.failed++ }
        }
      }
    }
  }

  // Пользовательские триггеры (мигр. 088).
  const custom = await processCustomTriggers(sb).catch((e) => {
    console.error('[cron/automation] custom triggers failed:', e)
    return { triggers: 0, fired: 0, failed: 0, skipped: 0 }
  })

  return NextResponse.json({ ok: true, ...stats, custom })
}

// ── Per-deal helpers ─────────────────────────────────────────────────────────

async function sendTouch(
  sb: SupabaseClient,
  d: AutomationDealRow,
  templateKey: 'touch_1' | 'touch_2' | 'touch_3',
  field: 'touch1_sent_at' | 'touch2_sent_at' | 'touch3_sent_at',
): Promise<boolean> {
  const r = await sendTemplateToDeal(sb, d.id, templateKey)
  if (r.status !== 'sent') {
    // skipped/failed — НЕ ставим sent_at, чтобы следующий тик попробовал
    // снова (скажем, после того как менеджер заменит '[ЗАПОЛНИТЬ]' на текст).
    if (r.status === 'failed') {
      console.error('[cron/automation] touch failed:', d.id, templateKey, r.error)
    }
    return false
  }
  await sb.from('deals')
    .update({ [field]: new Date().toISOString() })
    .eq('id', d.id)
  return true
}

async function createWorkTask(
  sb: SupabaseClient,
  d: AutomationDealRow,
  variant: '24h' | '48h',
): Promise<boolean> {
  // Текст задачи берём из шаблона (или дефолт). Это удобнее, чем хардкод —
  // менеджер хочет менять формулировку без релиза.
  const tmplKey = variant === '24h' ? 'work_task_24h' : 'work_task_48h'
  const { data: tmpl } = await sb
    .from('message_templates')
    .select('body')
    .eq('clinic_id', d.clinic_id)
    .eq('key', tmplKey)
    .maybeSingle<{ body: string }>()

  const title = variant === '24h'
    ? 'Клиент молчит 24 часа'
    : 'Клиент молчит 48 часов'

  const { error: tErr } = await sb.from('tasks').insert({
    clinic_id: d.clinic_id,
    deal_id: d.id,
    title,
    description: tmpl?.body ?? null,
    type: 'follow_up',
    priority: variant === '48h' ? 'high' : 'normal',
    assigned_to: d.responsible_user_id ?? null,
    due_at: new Date().toISOString(),
  })
  if (tErr) {
    console.error('[cron/automation] task insert failed:', d.id, variant, tErr.message)
    return false
  }
  const field = variant === '24h' ? 'task_24h_created_at' : 'task_48h_created_at'
  await sb.from('deals')
    .update({ [field]: new Date().toISOString() })
    .eq('id', d.id)
  return true
}

async function createNoReplyTask(sb: SupabaseClient, d: AutomationDealRow): Promise<boolean> {
  const { data: tmpl } = await sb
    .from('message_templates')
    .select('body')
    .eq('clinic_id', d.clinic_id)
    .eq('key', 'touch_no_reply_task')
    .maybeSingle<{ body: string }>()

  const { error: tErr } = await sb.from('tasks').insert({
    clinic_id: d.clinic_id,
    deal_id: d.id,
    title: 'Клиент не ответил после трёх касаний',
    description: tmpl?.body ?? null,
    type: 'follow_up',
    priority: 'high',
    assigned_to: d.responsible_user_id ?? null,
    due_at: new Date().toISOString(),
  })
  if (tErr) {
    console.error('[cron/automation] no-reply task insert failed:', d.id, tErr.message)
    return false
  }
  await sb.from('deals')
    .update({ task_no_reply_created_at: new Date().toISOString() })
    .eq('id', d.id)
  return true
}

// Утилитарно экспортируем, чтобы при необходимости тесты могли использовать.
export const _internals = { getStageId }
