// ============================================================
// src/lib/notifications/cron.ts
// ────────────────────────────────────────────────────────────
// Scheduled jobs that scan the DB and fire notify() for overdue
// situations the UI doesn't catch in real time:
//
//   • runTaskOverdueScan()        — tasks with due_at < now()
//                                    that are still 'new'/'in_progress'
//                                    and not already flagged 'overdue'.
//   • runWhatsAppNoReplyScan()    — inbound WA message whose deal has
//                                    no outbound reply > N minutes.
//
// To avoid double-notifying we look back only at the LAST scan window
// (controlled by `sinceMinutes`, default 15) and dedupe per
// (user_id, event_type, entity_id) within that window.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from './create'

interface TaskRow {
  id:          string
  clinic_id:   string
  title:       string
  due_at:      string | null
  status:      string
  assigned_to: string | null
  deal_id:     string | null
}

export async function runTaskOverdueScan(
  supabase: SupabaseClient,
  opts: { sinceMinutes?: number } = {},
): Promise<{ scanned: number; notified: number }> {
  const sinceMinutes = opts.sinceMinutes ?? 15
  const sinceIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString()
  const now = new Date().toISOString()

  // Tasks that JUST became overdue (due_at < now AND > sinceIso).
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, clinic_id, title, due_at, status, assigned_to, deal_id')
    .in('status', ['new', 'in_progress'])
    .lt('due_at', now)
    .gte('due_at', sinceIso)
    .limit(500)

  let notified = 0
  for (const t of (tasks ?? []) as TaskRow[]) {
    // Dedup: skip if a 'task_overdue' row for this task was already
    // created in the past `sinceMinutes`.
    const { data: dup } = await supabase
      .from('staff_notifications')
      .select('id')
      .eq('event_type', 'task_overdue')
      .eq('entity_id', t.id)
      .gte('created_at', sinceIso)
      .limit(1)
    if (dup && dup.length > 0) continue

    await notify(supabase, {
      clinicId:          t.clinic_id,
      eventType:         'task_overdue',
      entityType:        'task',
      entityId:          t.id,
      responsibleUserId: t.assigned_to,
      title:             `⚠ Задача просрочена: ${t.title}`,
      body:              t.due_at ? `Срок был ${new Date(t.due_at).toLocaleString('ru-RU')}` : null,
      link:              `/tasks`,
    })
    notified++
  }

  // Also flip status to 'overdue' so the kanban shows it.
  if ((tasks ?? []).length > 0) {
    await supabase.from('tasks')
      .update({ status: 'overdue' })
      .in('id', (tasks ?? []).map(t => t.id))
      .in('status', ['new', 'in_progress'])
  }

  return { scanned: tasks?.length ?? 0, notified }
}

interface UnrepliedRow {
  id:           string
  clinic_id:    string
  deal_id:      string | null
  patient_id:   string | null
  assigned_to:  string | null
  contact_name: string | null
  message:      string
  created_at:   string
}

export async function runWhatsAppNoReplyScan(
  supabase: SupabaseClient,
  opts: { thresholdMinutes?: number; sinceMinutes?: number } = {},
): Promise<{ scanned: number; notified: number }> {
  const thresholdMinutes = opts.thresholdMinutes ?? 30
  const sinceMinutes     = opts.sinceMinutes     ?? 60
  const olderThanIso = new Date(Date.now() - thresholdMinutes * 60_000).toISOString()
  const newerThanIso = new Date(Date.now() - sinceMinutes     * 60_000).toISOString()

  // Inbound messages older than N minutes but younger than the
  // scan window (so we don't keep nagging forever about ancient ones).
  const { data: candidates } = await supabase
    .from('whatsapp_messages')
    .select('id, clinic_id, deal_id, patient_id, assigned_to, contact_name, message, created_at')
    .eq('direction', 'inbound')
    .in('status', ['received', 'read'])
    .lte('created_at', olderThanIso)
    .gte('created_at', newerThanIso)
    .limit(500)

  let notified = 0
  for (const m of (candidates ?? []) as UnrepliedRow[]) {
    if (!m.deal_id) continue

    // Skip if there has been any outbound reply for this deal AFTER this message.
    const { data: replied } = await supabase
      .from('whatsapp_messages')
      .select('id')
      .eq('deal_id', m.deal_id)
      .eq('direction', 'outbound')
      .gte('created_at', m.created_at)
      .limit(1)
    if (replied && replied.length > 0) continue

    // Dedup: don't fire twice for the same message in the same window.
    const { data: dup } = await supabase
      .from('staff_notifications')
      .select('id')
      .eq('event_type', 'whatsapp_no_reply')
      .eq('entity_id', m.id)
      .gte('created_at', newerThanIso)
      .limit(1)
    if (dup && dup.length > 0) continue

    const who = m.contact_name?.trim() || 'клиент'
    await notify(supabase, {
      clinicId:          m.clinic_id,
      eventType:         'whatsapp_no_reply',
      entityType:        'message',
      entityId:          m.id,
      responsibleUserId: m.assigned_to,
      title:             `⏰ ${thresholdMinutes} мин без ответа: ${who}`,
      body:              m.message.slice(0, 180),
      link:              `/crm?deal=${m.deal_id}`,
    })
    notified++
  }

  return { scanned: candidates?.length ?? 0, notified }
}
