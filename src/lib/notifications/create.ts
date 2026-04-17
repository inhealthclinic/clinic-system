// ============================================================
// src/lib/notifications/create.ts
// ────────────────────────────────────────────────────────────
// Single entry point used everywhere in the app to fire an
// in-app notification:
//
//     await notify(supabase, {
//       clinicId, eventType: 'whatsapp_new_message',
//       entityType: 'deal', entityId: deal.id,
//       responsibleUserId: deal.assigned_to,
//       title: 'Новое сообщение от Айгерим',
//       body:  'Здравствуйте, можно записаться?',
//       link:  `/crm?deal=${deal.id}`,
//       triggeredBy: senderId ?? null,
//     })
//
// All routing logic lives in the Postgres function
// resolve_notification_recipients(clinic, event, responsible) —
// see migration 017. We just RPC into it, then bulk-insert one
// staff_notifications row per recipient.
//
// Best-effort: errors are logged, never thrown — a notification
// failure must NEVER crash the operation that triggered it.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventType, EntityType } from './types'

export interface NotifyArgs {
  clinicId:           string
  eventType:          EventType
  title:              string
  body?:              string | null
  link?:              string | null
  entityType?:        EntityType
  entityId?:          string | null
  /** ответственный за объект — главный получатель в стратегии 'responsible' */
  responsibleUserId?: string | null
  triggeredBy?:       string | null
}

export async function notify(
  supabase: SupabaseClient,
  args: NotifyArgs,
): Promise<void> {
  try {
    // 1. Resolve recipients via DB function (single source of truth).
    const { data: recipients, error: rErr } = await supabase
      .rpc('resolve_notification_recipients', {
        p_clinic_id:   args.clinicId,
        p_event_type:  args.eventType,
        p_responsible: args.responsibleUserId ?? null,
      })

    if (rErr) {
      console.warn('[notify] resolve recipients failed', rErr)
      return
    }

    const userIds: string[] = Array.from(new Set(
      (recipients ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean),
    ))

    if (userIds.length === 0) return

    // 2. One row per recipient.
    const rows = userIds.map(uid => ({
      clinic_id:    args.clinicId,
      user_id:      uid,
      event_type:   args.eventType,
      entity_type:  args.entityType ?? 'none',
      entity_id:    args.entityId ?? null,
      title:        args.title,
      body:         args.body  ?? null,
      link:         args.link  ?? null,
      triggered_by: args.triggeredBy ?? null,
    }))

    const { error: iErr } = await supabase
      .from('staff_notifications')
      .insert(rows)

    if (iErr) console.warn('[notify] insert failed', iErr)
  } catch (err) {
    console.warn('[notify] threw', err)
  }
}

// ── Convenience markers ──────────────────────────────────────

export async function markRead(supabase: SupabaseClient, id: string) {
  return supabase
    .from('staff_notifications')
    .update({ status: 'read', read_at: new Date().toISOString() })
    .eq('id', id)
}

export async function markAllRead(supabase: SupabaseClient, userId: string) {
  return supabase
    .from('staff_notifications')
    .update({ status: 'read', read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'unread')
}

export async function dismiss(supabase: SupabaseClient, id: string) {
  return supabase
    .from('staff_notifications')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', id)
}
