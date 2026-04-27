/**
 * GET /api/cron/bot-greeting
 *
 * Запускается каждые 5 минут (GitHub Actions). Находит сделки, у которых
 * bot_active=true и приветствие ещё не отправлено, шлёт шаблон с key='bot_greeting'
 * через Green-API, помечает bot_state='greeted', добавляет тег 'чатбот'.
 *
 * Идемпотентность: фильтр bot_greeting_sent_at IS NULL гарантирует, что одна
 * и та же сделка не получит приветствие дважды.
 *
 * Ошибки отправки: bot_failure_count++; при достижении 5 — выключаем
 * bot_active и пишем в webhook_errors. До 5 — оставляем сделку в очереди,
 * следующий тик попробует снова.
 *
 * ВАЖНО: бот работает 24/7 — никаких проверок working_hours.
 *
 * Защита: Authorization: Bearer ${CRON_SECRET}.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppText, normalizePhone } from '@/lib/greenapi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FAILURES = 5
const BOT_TAG = 'чатбот'

interface BotDealRow {
  id: string
  clinic_id: string
  contact_phone: string | null
  tags: string[] | null
  bot_failure_count: number
  patient: { phones: string[] | null } | { phones: string[] | null }[] | null
  clinic: { settings: { bot_enabled?: boolean } | null } | { settings: { bot_enabled?: boolean } | null }[] | null
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

function pickClinicSettings(d: BotDealRow): { bot_enabled?: boolean } | null {
  const c = Array.isArray(d.clinic) ? d.clinic[0] : d.clinic
  return c?.settings ?? null
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

  // 1. Очередь: активные сделки без отправленного приветствия.
  // bot_state IS NULL — отдельная проверка для read-after-write идемпотентности
  // (если cron упал между отправкой и UPDATE, флаг bot_greeting_sent_at IS NULL
  // спасёт от повторной отправки, а bot_state IS NULL отсеет уже greeted).
  const { data: queue, error: qErr } = await sb
    .from('deals')
    .select(`
      id, clinic_id, contact_phone, tags, bot_failure_count,
      patient:patients(phones),
      clinic:clinics(settings)
    `)
    .eq('bot_active', true)
    .is('bot_greeting_sent_at', null)
    .is('deleted_at', null)
    .returns<BotDealRow[]>()

  if (qErr) {
    console.error('[cron/bot-greeting] queue load failed:', qErr.message)
    return NextResponse.json({ error: qErr.message }, { status: 500 })
  }

  if (!queue || queue.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0 })
  }

  // 2. Подгружаем шаблоны bot_greeting только для нужных клиник одним запросом.
  const clinicIds = Array.from(new Set(queue.map(d => d.clinic_id)))
  const { data: templates } = await sb
    .from('message_templates')
    .select('clinic_id, body')
    .in('clinic_id', clinicIds)
    .eq('key', 'bot_greeting')
    .eq('is_active', true)
    .returns<TemplateRow[]>()
  const tmplByClinic = new Map((templates ?? []).map(t => [t.clinic_id, t.body]))

  let sent = 0, skipped = 0, failed = 0

  for (const d of queue) {
    // Проверка bot_enabled на уровне клиники: если выключили глобально, пока
    // лид «висел» в очереди — гасим бот без отправки.
    const settings = pickClinicSettings(d)
    if (!settings?.bot_enabled) {
      await sb.from('deals')
        .update({ bot_active: false, bot_state: 'done' })
        .eq('id', d.id)
      skipped++
      continue
    }

    const tmplBody = tmplByClinic.get(d.clinic_id)
    if (!tmplBody) {
      console.warn('[cron/bot-greeting] no bot_greeting template for clinic', d.clinic_id)
      skipped++
      continue
    }

    const phone = pickPhone(d)
    if (!phone || phone.length < 10) {
      // Без телефона нечего отправлять — выключаем бота и логируем.
      console.warn('[cron/bot-greeting] no phone for deal', d.id, '— deactivating bot')
      await sb.from('deals')
        .update({ bot_active: false, bot_state: 'done' })
        .eq('id', d.id)
      skipped++
      continue
    }

    let providerId: string | undefined
    try {
      const r = await sendWhatsAppText(phone, tmplBody, d.clinic_id)
      providerId = r.idMessage
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[cron/bot-greeting] sendWhatsAppText failed:', d.id, msg)
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
          source: 'bot-greeting',
          event_type: 'send_greeting',
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

    // Запись в чат: direction='out', sender_type='bot'.
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

    // Тег для аналитики «прошёл через бота». Дедуплицируем — текущий tags
    // мог уже содержать.
    const curTags = d.tags ?? []
    const nextTags = curTags.includes(BOT_TAG) ? curTags : [...curTags, BOT_TAG]

    await sb.from('deals')
      .update({
        bot_greeting_sent_at: new Date().toISOString(),
        bot_state: 'greeted',
        tags: nextTags,
      })
      .eq('id', d.id)

    sent++
  }

  return NextResponse.json({ ok: true, sent, skipped, failed })
}
