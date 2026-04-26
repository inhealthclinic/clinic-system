/**
 * POST /api/deals/:id/messages
 *
 * Отправка сообщения из CRM.
 * Тело: { body: string, channel: 'whatsapp'|'internal' }
 *
 * Флоу:
 *   1. Инсёртим строку deal_messages (direction='out', status='pending' для WA,
 *      'sent' для internal — оно никуда не уходит).
 *   2. Если channel='whatsapp' — вызываем Green-API.
 *      Успех  → UPDATE status='sent', external_id=idMessage.
 *      Ошибка → UPDATE status='failed', error_text=...
 *   3. Возвращаем созданное сообщение.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppText, normalizePhone } from '@/lib/greenapi'

type Body = {
  body: string
  channel?: 'whatsapp' | 'internal'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params

  let payload: Body
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const body = (payload.body ?? '').trim()
  const channel = payload.channel ?? 'whatsapp'
  if (!body) return NextResponse.json({ error: 'body required' }, { status: 400 })
  if (channel !== 'whatsapp' && channel !== 'internal') {
    return NextResponse.json({ error: 'unsupported channel' }, { status: 400 })
  }

  const supabase = await createClient()

  // 1. Получаем сделку + телефон + статус бота (нужен для отключения).
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, clinic_id, contact_phone, bot_active, patient:patients(phones)')
    .eq('id', dealId)
    .single()

  if (dealErr || !deal) {
    return NextResponse.json({ error: dealErr?.message ?? 'deal not found' }, { status: 404 })
  }

  // Менеджер взял сделку в работу — выключаем бота немедленно. Делаем ДО
  // отправки, чтобы между нашим INSERT и cron-тиком не успело уйти приветствие.
  // bot_state='done' отличает «менеджер ответил» от 'followup_sent' / NULL.
  if ((deal as { bot_active?: boolean }).bot_active) {
    await supabase
      .from('deals')
      .update({ bot_active: false, bot_state: 'done' })
      .eq('id', deal.id)
  }

  const { data: auth } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', auth.user?.id ?? '')
    .maybeSingle()

  // 2. Вставляем сообщение
  const initialStatus = channel === 'whatsapp' ? 'pending' : 'sent'
  const { data: inserted, error: insErr } = await supabase
    .from('deal_messages')
    .insert({
      deal_id: deal.id,
      clinic_id: deal.clinic_id,
      direction: 'out',
      channel,
      body,
      author_id: profile?.id ?? null,
      status: initialStatus,
    })
    .select()
    .single()

  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? 'insert failed' }, { status: 500 })
  }

  // 3. Internal — не отправляем наружу
  if (channel === 'internal') {
    return NextResponse.json({ message: inserted }, { status: 201 })
  }

  // 4. WhatsApp — определяем телефон.
  // patients.phones — text[], берём первый элемент массива.
  // deal.patient может быть объектом или массивом в зависимости от relation.
  const patientRel = Array.isArray(deal.patient)
    ? (deal.patient[0] as { phones?: string[] } | undefined)
    : (deal.patient as { phones?: string[] } | null)
  const patientPhone = patientRel?.phones?.[0]
  const rawPhone = deal.contact_phone || patientPhone || ''
  const phone = normalizePhone(rawPhone)

  if (!phone || phone.length < 10) {
    await supabase
      .from('deal_messages')
      .update({ status: 'failed', error_text: 'Не указан телефон контакта' })
      .eq('id', inserted.id)
    return NextResponse.json(
      { message: { ...inserted, status: 'failed', error_text: 'Не указан телефон контакта' } },
      { status: 201 }
    )
  }

  // 5. Зовём Green-API
  try {
    const { idMessage } = await sendWhatsAppText(phone, body)
    await supabase
      .from('deal_messages')
      .update({ status: 'sent', external_id: idMessage })
      .eq('id', inserted.id)
    return NextResponse.json(
      { message: { ...inserted, status: 'sent', external_id: idMessage } },
      { status: 201 }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'GreenAPI error'
    await supabase
      .from('deal_messages')
      .update({ status: 'failed', error_text: msg })
      .eq('id', inserted.id)
    return NextResponse.json(
      { message: { ...inserted, status: 'failed', error_text: msg } },
      { status: 201 }
    )
  }
}
