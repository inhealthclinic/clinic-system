// ============================================================
// /api/whatsapp/webhook
// ────────────────────────────────────────────────────────────
// Provider-agnostic intake endpoint. Real providers call this URL
// when they receive a message on the clinic's WhatsApp number.
//
// Expected JSON body (provider-neutral shape):
//   {
//     clinic_id:    "<uuid>",     // which clinic this number belongs to
//     from_phone:   "+77081234567",
//     to_phone:     "+77001234567",
//     text:         "Здравствуйте, ...",
//     wa_message_id?: "<provider id, used for de-dup>",
//     contact_name?: "Айгерим",
//     media_url?:   "https://...",
//   }
//
// Most providers (360Dialog, Twilio, Whapi, WhatsApp Cloud API) send
// their own envelopes; the proper way to support them is a thin
// adapter that maps the provider payload to the shape above and
// then calls processInboundMessage(). We keep that adapter outside
// this file so the core stays simple.
//
// Security: in production this endpoint MUST verify a shared secret
// or HMAC signature from the provider. For now we accept a header
// `x-webhook-secret` and compare against env WHATSAPP_WEBHOOK_SECRET
// when set; if env is unset we allow (dev mode) and log a warning.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { processInboundMessage } from '@/lib/whatsapp/inbound'

export const runtime = 'nodejs'  // service-role key shouldn't run on edge

function unauthorized(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 401 })
}

function badRequest(reason: string) {
  return NextResponse.json({ ok: false, error: reason }, { status: 400 })
}

export async function POST(req: NextRequest) {
  // ── 1. Auth — shared secret (HMAC TODO) ─────────────────
  const expected = process.env.WHATSAPP_WEBHOOK_SECRET
  const provided = req.headers.get('x-webhook-secret')
  if (expected) {
    if (provided !== expected) return unauthorized('bad secret')
  } else {
    console.warn('[wa/webhook] WHATSAPP_WEBHOOK_SECRET not set — accepting unverified requests')
  }

  // ── 2. Parse ───────────────────────────────────────────
  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return badRequest('invalid json')
  }

  const clinicId  = String(payload.clinic_id  ?? '')
  const fromPhone = String(payload.from_phone ?? '')
  const toPhone   = String(payload.to_phone   ?? '')
  const text      = String(payload.text       ?? '')
  if (!clinicId || !fromPhone || !toPhone || !text) {
    return badRequest('missing required fields: clinic_id, from_phone, to_phone, text')
  }

  // ── 3. Supabase service client (bypass RLS for inserts) ─
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: 'supabase env not configured' },
      { status: 500 },
    )
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // ── 4. Process ─────────────────────────────────────────
  const result = await processInboundMessage(supabase, {
    clinicId,
    fromPhone,
    toPhone,
    text,
    waMessageId: payload.wa_message_id ? String(payload.wa_message_id) : null,
    contactName: payload.contact_name ? String(payload.contact_name) : null,
    mediaUrl:    payload.media_url    ? String(payload.media_url)    : null,
    rawPayload:  payload,
  })

  const httpStatus =
    result.status === 'invalid_phone' ? 400 :
    result.status === 'error'         ? 500 :
    200

  return NextResponse.json({ ok: result.status !== 'error', ...result }, { status: httpStatus })
}

// Some providers verify the URL via GET (echo back challenge).
export async function GET(req: NextRequest) {
  const challenge = req.nextUrl.searchParams.get('hub.challenge')
                 ?? req.nextUrl.searchParams.get('challenge')
  if (challenge) return new NextResponse(challenge, { status: 200 })
  return NextResponse.json({ ok: true, service: 'whatsapp_webhook' })
}
