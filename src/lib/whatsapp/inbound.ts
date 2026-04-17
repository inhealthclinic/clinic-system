// ============================================================
// src/lib/whatsapp/inbound.ts
// ────────────────────────────────────────────────────────────
// Single processing pipeline for an incoming WhatsApp message.
// Called from the webhook (or any provider adapter):
//
//     await processInboundMessage(supabase, {
//       clinicId, fromPhone, toPhone, text, waMessageId,
//       contactName, mediaUrl, rawPayload,
//     })
//
// The function:
//   1. Normalises the sender's phone (+77XXXXXXXXX).
//   2. Idempotently de-dups by wa_message_id.
//   3. Finds existing patient by normalized phone — or creates
//      a fresh "lead" patient if none exists.
//   4. Finds the patient's open lead-funnel deal — or creates
//      one at stage='new' (so the kanban lights up immediately).
//   5. Inserts the whatsapp_messages row, linked to deal +
//      patient + assigned_to (deal owner) and tagged with the
//      normalised phone for fast filtering.
//   6. Fires a staff notification:
//        - 'whatsapp_new_lead'    if we just created the patient
//        - 'whatsapp_new_message' otherwise
//      Routing is decided by the DB function — defaults to
//      "ответственный по сделке" (with owner/admin fallback).
//
// Best-effort and idempotent. Returns a small summary object
// the webhook handler can log/return.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneKZ } from '@/lib/utils/phone'
import { ensureMedicalDealForPatient } from '@/lib/crm/sync'
import { notify } from '@/lib/notifications/create'

export interface InboundArgs {
  clinicId:    string
  fromPhone:   string         // raw, may be +7..., 87..., 77...
  toPhone:     string         // clinic's WA number — stored as-is
  text:        string
  waMessageId?: string | null  // provider's external id, used for de-dup
  contactName?: string | null  // sender's display name from WhatsApp
  mediaUrl?:   string | null
  rawPayload?: unknown         // full provider payload, stored as JSONB
}

export interface InboundResult {
  status: 'created' | 'duplicate' | 'invalid_phone' | 'error'
  messageId?: string
  patientId?: string
  dealId?: string
  isNewLead?: boolean
  error?: string
}

export async function processInboundMessage(
  supabase: SupabaseClient,
  args: InboundArgs,
): Promise<InboundResult> {
  try {
    const normalizedPhone = normalizePhoneKZ(args.fromPhone)
    if (!normalizedPhone) {
      return { status: 'invalid_phone', error: `Cannot normalise phone: ${args.fromPhone}` }
    }

    // ── 1. De-dup by provider id ─────────────────────────────
    if (args.waMessageId) {
      const { data: dup } = await supabase
        .from('whatsapp_messages')
        .select('id, deal_id, patient_id')
        .eq('wa_message_id', args.waMessageId)
        .maybeSingle()
      if (dup?.id) {
        return {
          status: 'duplicate',
          messageId: dup.id as string,
          patientId: (dup.patient_id as string) ?? undefined,
          dealId:    (dup.deal_id as string) ?? undefined,
        }
      }
    }

    // ── 2. Find or create patient ───────────────────────────
    let patientId: string | null = null
    let isNewLead = false

    {
      const { data: existing } = await supabase
        .from('patients')
        .select('id')
        .contains('phones', [normalizedPhone])
        .limit(1)
        .maybeSingle()

      if (existing?.id) {
        patientId = existing.id as string
      } else {
        const { data: created, error: pErr } = await supabase
          .from('patients')
          .insert({
            clinic_id:      args.clinicId,
            full_name:      args.contactName?.trim() || `WhatsApp ${normalizedPhone}`,
            phones:         [normalizedPhone],
            gender:         'other',
            status:         'new',
            is_vip:         false,
            balance_amount: 0,
            debt_amount:    0,
            tags:           ['whatsapp_lead'],
          })
          .select('id')
          .single()
        if (pErr || !created) {
          return { status: 'error', error: pErr?.message ?? 'patient insert failed' }
        }
        patientId = created.id as string
        isNewLead = true
      }
    }

    // ── 3. Find or create lead-funnel deal ──────────────────
    let dealId: string | null = null
    let dealAssignedTo: string | null = null

    {
      const { data: existing } = await supabase
        .from('deals')
        .select('id, assigned_to, first_owner_id')
        .eq('patient_id', patientId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existing?.id) {
        dealId = existing.id as string
        dealAssignedTo = (existing.assigned_to as string) ?? (existing.first_owner_id as string) ?? null
      } else {
        // Reuse the medical-funnel helper if we already have an ensure
        // flow elsewhere; for new WA leads we want LEADS funnel, so
        // create directly.
        const stage = isNewLead ? 'new' : 'in_progress'
        const { data: created, error: dErr } = await supabase
          .from('deals')
          .insert({
            clinic_id:  args.clinicId,
            patient_id: patientId,
            funnel:     'leads',
            stage,
            source:     'whatsapp',
            priority:   'warm',
          })
          .select('id, assigned_to, first_owner_id')
          .single()
        if (dErr || !created) {
          return { status: 'error', error: dErr?.message ?? 'deal insert failed' }
        }
        dealId = created.id as string
        dealAssignedTo = (created.assigned_to as string) ?? (created.first_owner_id as string) ?? null
      }
    }

    // ── 4. Insert message ───────────────────────────────────
    const { data: msg, error: mErr } = await supabase
      .from('whatsapp_messages')
      .insert({
        clinic_id:        args.clinicId,
        patient_id:       patientId,
        deal_id:          dealId,
        direction:        'inbound',
        from_phone:       args.fromPhone,
        to_phone:         args.toPhone,
        normalized_phone: normalizedPhone,
        message:          args.text,
        media_url:        args.mediaUrl ?? null,
        wa_message_id:    args.waMessageId ?? null,
        contact_name:     args.contactName ?? null,
        status:           'received',
        raw_payload:      args.rawPayload ?? null,
        assigned_to:      dealAssignedTo,
      })
      .select('id')
      .single()
    if (mErr || !msg) {
      return { status: 'error', error: mErr?.message ?? 'message insert failed' }
    }

    // ── 5. Notify the responsible staff member ──────────────
    const senderLabel = args.contactName?.trim() || normalizedPhone
    await notify(supabase, {
      clinicId:          args.clinicId,
      eventType:         isNewLead ? 'whatsapp_new_lead' : 'whatsapp_new_message',
      entityType:        'message',
      entityId:          msg.id as string,
      responsibleUserId: dealAssignedTo,
      title: isNewLead
        ? `Новый лид из WhatsApp: ${senderLabel}`
        : `Новое сообщение от ${senderLabel}`,
      body:  args.text.slice(0, 200),
      link:  `/crm?deal=${dealId}`,
    })

    return {
      status:    'created',
      messageId: msg.id as string,
      patientId: patientId ?? undefined,
      dealId:    dealId ?? undefined,
      isNewLead,
    }
  } catch (err) {
    console.warn('[wa/inbound] threw', err)
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Outbound (sending from CRM) ─────────────────────────────
// Adapter-agnostic stub: stores the row with status='sent' so the UI
// shows it in the conversation. A real provider adapter (360Dialog,
// Twilio, WaPi, …) would replace this body with an actual API call.

export interface OutboundArgs {
  clinicId:   string
  patientId:  string
  dealId?:    string | null
  toPhone:    string
  fromPhone:  string
  text:       string
  sentBy?:    string | null
  /** Set true to skip the (stub) provider call — useful in tests. */
  skipProviderCall?: boolean
}

export async function sendOutboundMessage(
  supabase: SupabaseClient,
  args: OutboundArgs,
) {
  const normalizedPhone = normalizePhoneKZ(args.toPhone)
  if (!normalizedPhone) {
    return { status: 'invalid_phone' as const, error: 'Bad phone' }
  }

  // TODO: real provider integration. For now we mark as 'sent'
  // immediately so the manager sees the bubble in the chat.
  const status: 'sent' | 'failed' = args.skipProviderCall ? 'sent' : 'sent'
  const errorText: string | null = null

  const { data: msg, error } = await supabase
    .from('whatsapp_messages')
    .insert({
      clinic_id:        args.clinicId,
      patient_id:       args.patientId,
      deal_id:          args.dealId ?? null,
      direction:        'outbound',
      from_phone:       args.fromPhone,
      to_phone:         args.toPhone,
      normalized_phone: normalizedPhone,
      message:          args.text,
      status,
      sent_at:          new Date().toISOString(),
      sent_by:          args.sentBy ?? null,
      error_text:       errorText,
    })
    .select('id')
    .single()

  if (error || !msg) {
    return { status: 'error' as const, error: error?.message ?? 'insert failed' }
  }
  return { status: 'sent' as const, messageId: msg.id as string }
}
