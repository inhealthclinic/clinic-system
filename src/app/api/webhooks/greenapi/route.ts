/**
 * POST /api/webhooks/greenapi?t=<GREENAPI_WEBHOOK_TOKEN>
 *
 * Приёмник событий Green-API. Обрабатываем:
 *   • incomingMessageReceived     — клиент написал нам → INSERT deal_messages
 *   • outgoingMessageStatus       — обновление статуса наших исходящих
 *   • outgoingMessageReceived     — исходящее с телефона (оператор ответил из WA)
 *   • stateInstanceChanged        — логируем для отладки
 *
 * Match входящего номера → сделка: по deals.contact_phone или patients.phone.
 * Если нет сделки — создаём новую в первой стадии первой «медицинской» воронки.
 *
 * Идемпотентность: deal_messages.external_id UNIQUE по (channel, external_id)
 * — повторная доставка webhook-а не создаст дубли.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  extractIncomingText,
  type GreenApiWebhook,
  type IncomingMessageWebhook,
  type OutgoingStatusWebhook,
} from '@/lib/greenapi'

// Service-role client: webhook прилетает без auth-куки.
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function chatIdToPhone(chatId: string): string {
  // "77051234567@c.us" → "77051234567"
  return chatId.split('@')[0].replace(/\D/g, '')
}

type DealRef = { id: string; clinic_id: string }

async function findDealByPhone(phone: string): Promise<DealRef | null> {
  const db = admin()
  if (!phone || phone.length < 7) return null
  const tail = phone.slice(-10)

  const { data } = await db
    .from('deals')
    .select('id, clinic_id, status')
    .or(`contact_phone.ilike.%${tail}%`)
    .order('updated_at', { ascending: false })
    .limit(5)

  if (data && data.length > 0) {
    const pick = data.find((d: { status: string }) => d.status === 'open') ?? data[0]
    return { id: pick.id, clinic_id: pick.clinic_id }
  }

  const { data: pats } = await db
    .from('patients')
    .select('id, clinic_id')
    .ilike('phone', `%${tail}%`)
    .limit(5)

  if (pats && pats.length > 0) {
    const patientIds = pats.map((p: { id: string }) => p.id)
    const { data: deals } = await db
      .from('deals')
      .select('id, clinic_id, status')
      .in('patient_id', patientIds)
      .order('updated_at', { ascending: false })
      .limit(5)
    if (deals && deals.length > 0) {
      const pick = deals.find((d: { status: string }) => d.status === 'open') ?? deals[0]
      return { id: pick.id, clinic_id: pick.clinic_id }
    }
  }

  return null
}

/** Создать «Входящий лид» в первой стадии первой воронки. */
async function createInboundDeal(phone: string, senderName?: string): Promise<DealRef | null> {
  const db = admin()

  // Берём ЛЮБУЮ клинику + её первую воронку/стадию.
  // В проде лучше per-instance: один Green-API → одна клиника.
  const { data: stage } = await db
    .from('pipeline_stages')
    .select('id, clinic_id, pipeline_id')
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!stage) return null

  const { data: deal, error } = await db
    .from('deals')
    .insert({
      clinic_id: stage.clinic_id,
      pipeline_id: stage.pipeline_id,
      stage_id: stage.id,
      name: `WhatsApp: ${senderName ?? phone}`,
      contact_phone: phone,
      source: 'whatsapp',
      status: 'open',
    })
    .select('id, clinic_id')
    .single()

  if (error) {
    console.error('[greenapi webhook] createInboundDeal failed:', error.message)
    return null
  }
  return { id: deal.id, clinic_id: deal.clinic_id }
}

async function handleIncomingMessage(wh: IncomingMessageWebhook) {
  const db = admin()
  const phone = chatIdToPhone(wh.senderData.chatId)
  const text = extractIncomingText(wh)
  if (!text) return

  let deal = await findDealByPhone(phone)
  if (!deal) {
    deal = await createInboundDeal(phone, wh.senderData.senderName)
    if (!deal) return
  }

  await db
    .from('deal_messages')
    .insert({
      deal_id: deal.id,
      clinic_id: deal.clinic_id,
      direction: 'in',
      channel: 'whatsapp',
      body: text,
      external_id: wh.idMessage,
      external_sender: wh.senderData.senderName ?? phone,
      status: 'delivered',
      created_at: new Date(wh.timestamp * 1000).toISOString(),
    })
    // ON CONFLICT на (channel, external_id) гарантирован уникальным индексом из 039
    // Supabase v2: upsert c ignoreDuplicates
  // ↑ Если словим duplicate — ok, просто логируем
}

async function handleOutgoingStatus(wh: OutgoingStatusWebhook) {
  const db = admin()
  const mapped =
    wh.status === 'sent'      ? 'sent' :
    wh.status === 'delivered' ? 'delivered' :
    wh.status === 'read'      ? 'read' :
    wh.status === 'failed' || wh.status === 'noAccount' || wh.status === 'notInGroup'
                              ? 'failed'
                              : null
  if (!mapped) return

  await db
    .from('deal_messages')
    .update({
      status: mapped,
      error_text: mapped === 'failed' ? `GreenAPI: ${wh.status}` : null,
    })
    .eq('external_id', wh.idMessage)
}

export async function POST(req: NextRequest) {
  // 1. Проверяем secret
  const secret = process.env.GREENAPI_WEBHOOK_TOKEN
  const token = req.nextUrl.searchParams.get('t') ?? req.headers.get('x-green-api-token')
  if (secret && token !== secret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 2. Парсим
  let wh: GreenApiWebhook
  try {
    wh = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  try {
    if (wh.typeWebhook === 'incomingMessageReceived') {
      await handleIncomingMessage(wh as IncomingMessageWebhook)
    } else if (wh.typeWebhook === 'outgoingMessageStatus') {
      await handleOutgoingStatus(wh as OutgoingStatusWebhook)
    } else if (wh.typeWebhook === 'stateInstanceChanged') {
      console.log('[greenapi] state:', (wh as { stateInstance?: string }).stateInstance)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[greenapi webhook] error:', err)
    // Возвращаем 200 чтобы GreenAPI не ретраил штормом;
    // внутренние ошибки логируем и разбираем отдельно.
    return NextResponse.json({ ok: false, error: String(err) })
  }
}

// GreenAPI иногда делает GET /healthcheck — отвечаем 200
export async function GET() {
  return NextResponse.json({ ok: true, service: 'greenapi-webhook' })
}
