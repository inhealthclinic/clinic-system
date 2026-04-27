/**
 * GET /api/cron/bot-followup
 *
 * Запускается каждые 5 минут (GitHub Actions). Берёт сделки, которым ровно
 * час назад ушло приветствие. Если клиент за это время написал в чат —
 * передаём сделку менеджеру (bot_state='done', bot_active=false), фоллоуап
 * НЕ шлём. Если тишина — шлём шаблон bot_followup_no_answer и завершаем.
 *
 * Идемпотентность: bot_followup_sent_at IS NULL в WHERE гарантирует ровно
 * одну отправку на сделку.
 *
 * ВАЖНО: бот работает 24/7 — никаких проверок времени суток.
 *
 * Защита: Authorization: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText, normalizePhone } from '@/lib/greenapi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FAILURES = 5

interface BotDealRow {
  id: string
  clinic_id: string
  contact_phone: string | null
  bot_failure_count: number
  bot_greeting_sent_at: string
  patient: { phones: string[] | null } | { phones: string[] | null }[] | null
}

interface TemplateRow {
  clinic_id: string
  body: string
}

function pickPhone(d: BotDealRow): string | null {
  if (d.contact_phone) return normalizePhone(d.contact_phone)
  const p = Array.isArray(d.patient) ? d.patient[0] : d.patient
  const phone = p?.phones?.[0]
  return phone ? normalizePhone(phone) : null
}

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

  // Берём всех, кому час+ назад послали приветствие и фоллоуап ещё не уходил.
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { data: queue, error: qErr } = await sb
    .from('deals')
    .select(`
      id, clinic_id, contact_phone, bot_failure_count, bot_greeting_sent_at,
      patient:patients(phones)
    `)
    .eq('bot_active', true)
    .eq('bot_state', 'greeted')
    .lt('bot_greeting_sent_at', cutoff)
    .is('bot_followup_sent_at', null)
    .is('deleted_at', null)
    .returns<BotDealRow[]>()

  if (qErr) {
    console.error('[cron/bot-followup] queue load failed:', qErr.message)
    return NextResponse.json({ error: qErr.message }, { status: 500 })
  }

  if (!queue || queue.length === 0) {
    return NextResponse.json({ ok: true, followup_sent: 0, transferred_to_manager: 0, failed: 0 })
  }

  // Шаблоны фоллоуапа по клиникам — одним запросом.
  const clinicIds = Array.from(new Set(queue.map(d => d.clinic_id)))
  const { data: templates } = await sb
    .from('message_templates')
    .select('clinic_id, body')
    .in('clinic_id', clinicIds)
    .eq('key', 'bot_followup_no_answer')
    .eq('is_active', true)
    .returns<TemplateRow[]>()
  const tmplByClinic = new Map((templates ?? []).map(t => [t.clinic_id, t.body]))

  let followup_sent = 0, transferred_to_manager = 0, failed = 0

  for (const d of queue) {
    // Проверяем — был ли ответ клиента (direction='in') после приветствия.
    // count=exact возвращает count даже без head:true; ограничиваемся одной
    // строкой в data, чтобы не тащить всю историю.
    const { count: replyCount } = await sb
      .from('deal_messages')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', d.id)
      .eq('direction', 'in')
      .gt('created_at', d.bot_greeting_sent_at)

    if ((replyCount ?? 0) > 0) {
      // Клиент ответил — передаём менеджеру, фоллоуап НЕ шлём.
      // Тег 'чатбот' остаётся для аналитики «лид прошёл через бота и ответил».
      await sb.from('deals')
        .update({ bot_active: false, bot_state: 'done' })
        .eq('id', d.id)
      transferred_to_manager++
      continue
    }

    // Тишина — шлём фоллоуап.
    const tmplBody = tmplByClinic.get(d.clinic_id)
    if (!tmplBody) {
      console.warn('[cron/bot-followup] no bot_followup_no_answer template for clinic', d.clinic_id)
      // Без шаблона дальше шлять нечего — гасим бота, чтобы не висел в очереди.
      await sb.from('deals')
        .update({ bot_active: false, bot_state: 'done' })
        .eq('id', d.id)
      failed++
      continue
    }

    const phone = pickPhone(d)
    if (!phone || phone.length < 10) {
      await sb.from('deals')
        .update({ bot_active: false, bot_state: 'done' })
        .eq('id', d.id)
      failed++
      continue
    }

    let providerId: string | undefined
    try {
      const r = await sendWhatsAppText(phone, tmplBody)
      providerId = r.idMessage
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[cron/bot-followup] sendWhatsAppText failed:', d.id, msg)
      const nextCount = (d.bot_failure_count ?? 0) + 1
      if (nextCount >= MAX_FAILURES) {
        await sb.from('deals')
          .update({
            bot_active: false,
            bot_state: 'done',
            bot_failure_count: nextCount,
          })
          .eq('id', d.id)
        await sb.from('webhook_errors').insert({
          source: 'bot-followup',
          event_type: 'send_followup',
          external_id: d.id,
          error_message: `Превышен лимит попыток (${MAX_FAILURES}): ${msg}`,
          payload: { deal_id: d.id, clinic_id: d.clinic_id },
        })
      } else {
        await sb.from('deals')
          .update({ bot_failure_count: nextCount })
          .eq('id', d.id)
      }
      failed++
      continue
    }

    await sb.from('deal_messages').insert({
      deal_id: d.id,
      clinic_id: d.clinic_id,
      direction: 'out',
      channel: 'whatsapp',
      body: tmplBody,
      sender_type: 'bot',
      external_id: providerId,
      status: 'sent',
    })

    await sb.from('deals')
      .update({
        bot_followup_sent_at: new Date().toISOString(),
        bot_state: 'followup_sent',
        bot_active: false,
      })
      .eq('id', d.id)

    followup_sent++
  }

  return NextResponse.json({ ok: true, followup_sent, transferred_to_manager, failed })
}
