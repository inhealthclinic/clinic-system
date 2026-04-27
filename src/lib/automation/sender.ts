/**
 * Унифицированная отправка системного шаблона из автоматизации воронки.
 *
 * Используется cron-эндпоинтом /api/cron/automation. Чтобы каждый блок (1/2/3
 * касание) не дублировал «найди шаблон по key → возьми телефон → пошли через
 * Green-API → запиши в deal_messages → обнови deal» — собрали в один helper.
 *
 * ВАЖНО: если body шаблона начинается с маркера '[ЗАПОЛНИТЬ' или '[ЗАГЛУШКА',
 * считаем шаблон неконфигурированным и НЕ отправляем (возвращаем status='skipped').
 * 086_automation_templates_seed.sql сидит именно такие плейсхолдеры — менеджер
 * должен явно прописать тексты в /settings/automation, иначе клиенту уехала бы
 * квадратная скобка вместо приветствия.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppText, normalizePhone } from '@/lib/greenapi'

export type SendResult =
  | { status: 'sent';     providerId: string;  body: string }
  | { status: 'skipped';  reason: 'placeholder' | 'no_template' | 'no_phone' }
  | { status: 'failed';   error: string }

interface DealRow {
  id: string
  clinic_id: string
  contact_phone: string | null
  patient: { phones: string[] | null } | { phones: string[] | null }[] | null
}

function pickPhone(d: DealRow): string | null {
  if (d.contact_phone) return normalizePhone(d.contact_phone)
  const p = Array.isArray(d.patient) ? d.patient[0] : d.patient
  const phone = p?.phones?.[0]
  return phone ? normalizePhone(phone) : null
}

function isPlaceholder(body: string): boolean {
  const t = body.trimStart()
  return t.startsWith('[ЗАПОЛНИТЬ') || t.startsWith('[ЗАГЛУШКА')
}

/**
 * Отправляет системный шаблон в чат сделки через Green-API и пишет
 * deal_messages с sender_type='bot'. Не апдейтит сам deal — это делает
 * вызывающий код (он знает, какие именно поля выставить: touch1_sent_at и т.п.).
 */
export async function sendTemplateToDeal(
  sb: SupabaseClient,
  dealId: string,
  templateKey: string,
): Promise<SendResult> {
  // 1. Сделка + телефон + клиника
  const { data: deal, error: dealErr } = await sb
    .from('deals')
    .select('id, clinic_id, contact_phone, patient:patients(phones)')
    .eq('id', dealId)
    .single<DealRow>()
  if (dealErr || !deal) {
    return { status: 'failed', error: dealErr?.message ?? 'deal not found' }
  }

  // 2. Шаблон по ключу для этой клиники
  const { data: tmpl } = await sb
    .from('message_templates')
    .select('body')
    .eq('clinic_id', deal.clinic_id)
    .eq('key', templateKey)
    .eq('is_active', true)
    .maybeSingle<{ body: string }>()
  if (!tmpl?.body) {
    return { status: 'skipped', reason: 'no_template' }
  }
  if (isPlaceholder(tmpl.body)) {
    // Менеджер ещё не написал реальный текст — молчим, не позорим клинику.
    return { status: 'skipped', reason: 'placeholder' }
  }

  const phone = pickPhone(deal)
  if (!phone || phone.length < 10) {
    return { status: 'skipped', reason: 'no_phone' }
  }

  // 3. Шлём через Green-API
  let providerId: string
  try {
    const r = await sendWhatsAppText(phone, tmpl.body, deal.clinic_id)
    providerId = r.idMessage
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }

  // 4. История переписки
  await sb.from('deal_messages').insert({
    deal_id: deal.id,
    clinic_id: deal.clinic_id,
    direction: 'out',
    channel: 'whatsapp',
    body: tmpl.body,
    sender_type: 'bot',
    external_id: providerId,
    status: 'sent',
  })

  return { status: 'sent', providerId, body: tmpl.body }
}
