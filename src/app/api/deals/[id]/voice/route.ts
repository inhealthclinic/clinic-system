/**
 * POST /api/deals/:id/voice
 *
 * Отправка голосового сообщения в WhatsApp через Green-API.
 *
 * Принимает multipart/form-data:
 *   - file:        Blob (audio/ogg;codecs=opus | audio/webm;codecs=opus | audio/mp4)
 *   - duration_s:  string (опц.) — длительность записи в секундах
 *
 * Флоу:
 *   1. Загружаем файл в Supabase Storage (bucket 'crm-attachments') —
 *      нужна публичная ссылка для Green-API.
 *   2. Инсёртим deal_messages (channel='whatsapp', body='[🎙 voice]',
 *      attachments=[{kind:'voice', url, mime, size, duration_s}]).
 *   3. Зовём sendFileByUrl. Успех → status='sent', external_id=idMessage.
 *      Ошибка → status='failed'.
 *
 * Зачем sendFileByUrl, а не sendFileByUpload: Green-API при upload-методе
 * иногда теряет mime и присылает как обычный файл, а не PTT. URL-метод
 * с расширением .ogg даёт стабильное определение голосового.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendWhatsAppFileByUrl, normalizePhone } from '@/lib/greenapi'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: dealId } = await params

  const fd = await req.formData().catch(() => null)
  if (!fd) return NextResponse.json({ error: 'multipart/form-data expected' }, { status: 400 })

  const file = fd.get('file')
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  if (file.size > 16 * 1024 * 1024) {
    return NextResponse.json({ error: 'file too large (max 16MB)' }, { status: 413 })
  }

  const durationRaw = fd.get('duration_s')
  const duration_s = typeof durationRaw === 'string' && durationRaw
    ? Math.max(0, Math.round(Number(durationRaw)))
    : null

  const supabase = await createClient()

  // 1. Сделка + телефон
  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id, clinic_id, contact_phone, bot_active, patient:patients(phones)')
    .eq('id', dealId)
    .single()

  if (dealErr || !deal) {
    return NextResponse.json({ error: dealErr?.message ?? 'deal not found' }, { status: 404 })
  }

  // Менеджер вступил в диалог — выключаем бота немедленно.
  if ((deal as { bot_active?: boolean }).bot_active) {
    await supabase.from('deals').update({ bot_active: false, bot_state: 'done' }).eq('id', deal.id)
  }

  const { data: auth } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', auth.user?.id ?? '')
    .maybeSingle()

  // 2. Загрузка в Storage. Расширение .ogg фиксирует mime для Green-API.
  // mime браузеров: 'audio/ogg;codecs=opus' (FF/Chrome) или 'audio/webm;codecs=opus' (старый Chrome).
  // Для WA нужен ogg/opus — браузер уже пишет в opus, остаётся правильное расширение.
  const ext = (file.type.includes('ogg') ? 'ogg'
            : file.type.includes('webm') ? 'ogg'   // opus inside, WA примет
            : file.type.includes('mp4')  ? 'm4a'
            : 'ogg')
  const path = `deals/${deal.clinic_id}/${deal.id}/${Date.now()}.${ext}`

  const arrayBuf = await file.arrayBuffer()
  const { error: upErr } = await supabase.storage
    .from('crm-attachments')
    .upload(path, arrayBuf, {
      contentType: ext === 'ogg' ? 'audio/ogg; codecs=opus' : (file.type || 'audio/ogg'),
      upsert: false,
    })
  if (upErr) {
    return NextResponse.json({ error: `upload failed: ${upErr.message}` }, { status: 500 })
  }
  const { data: pub } = supabase.storage.from('crm-attachments').getPublicUrl(path)
  const fileUrl = pub.publicUrl

  // 3. Insert deal_messages
  const attachment = {
    kind: 'voice' as const,
    url: fileUrl,
    mime: ext === 'ogg' ? 'audio/ogg; codecs=opus' : file.type,
    size: file.size,
    name: `voice-${Date.now()}.${ext}`,
    duration_s,
  }

  const { data: inserted, error: insErr } = await supabase
    .from('deal_messages')
    .insert({
      deal_id: deal.id,
      clinic_id: deal.clinic_id,
      direction: 'out',
      channel: 'whatsapp',
      body: '[🎙 голосовое]',
      attachments: [attachment],
      author_id: profile?.id ?? null,
      status: 'pending',
    })
    .select()
    .single()

  if (insErr || !inserted) {
    return NextResponse.json({ error: insErr?.message ?? 'insert failed' }, { status: 500 })
  }

  // 4. Телефон
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
      { status: 201 },
    )
  }

  // 5. Green-API
  try {
    const { idMessage } = await sendWhatsAppFileByUrl(phone, fileUrl, attachment.name)
    await supabase
      .from('deal_messages')
      .update({ status: 'sent', external_id: idMessage })
      .eq('id', inserted.id)
    return NextResponse.json(
      { message: { ...inserted, status: 'sent', external_id: idMessage } },
      { status: 201 },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'GreenAPI error'
    await supabase
      .from('deal_messages')
      .update({ status: 'failed', error_text: msg })
      .eq('id', inserted.id)
    return NextResponse.json(
      { message: { ...inserted, status: 'failed', error_text: msg } },
      { status: 201 },
    )
  }
}
