// ============================================================
// src/lib/crm/sync.ts
// ────────────────────────────────────────────────────────────
// Bidirectional glue between scheduling and CRM.
//
// Why:
//   In amoCRM the deal moves through its funnel automatically as
//   external events happen (call recorded, meeting booked,
//   appointment marked "completed", payment received). Our
//   clinic system has the same data — it just wasn't wired up.
//   The schedule module created appointments and the CRM kanban
//   stayed frozen until a manager dragged the card by hand.
//
// What this module does:
//   1. ensureMedicalDealForPatient() — call after creating an
//      appointment so there's always at least one open
//      medical-funnel deal per active patient.
//   2. syncDealStageOnAppointmentStatus() — call after the
//      AppointmentDetailDrawer changes appointment.status.
//      It moves the matching open deal to the corresponding
//      stage and writes a small audit row to crm_interactions.
//
// All operations are best-effort: failures are logged but never
// thrown so they cannot crash the calling UI.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { notify } from '@/lib/notifications/create'

// ---- Stage mapping (kept in step with DEFAULT_MEDICAL_STAGES in /crm) ----

/** Default medical-funnel stage assigned to a brand-new appointment. */
export const NEW_APPT_DEFAULT_STAGE = 'primary_scheduled'

/**
 * Map an appointments.status value to the medical-funnel stage it
 * implies. `null` means "no stage move — leave the deal alone".
 *
 * `currentStage` lets us treat secondary visits differently:
 * if the deal was already past primary_done we move to
 * secondary_done instead of overwriting it.
 */
export function appointmentStatusToStage(
  status: string,
  currentStage: string | null,
): string | null {
  switch (status) {
    case 'no_show':
      return 'no_show'
    case 'completed':
      // If the deal already passed the primary visit, the next
      // appointment is treated as the secondary one.
      if (currentStage && [
        'primary_done', 'secondary_scheduled', 'deciding',
        'treatment', 'tirzepatide_tx', 'control_tests',
      ].includes(currentStage)) {
        return 'secondary_done'
      }
      return 'primary_done'
    case 'confirmed':
      // Don't downgrade if the deal is already further along.
      if (currentStage === 'no_show' || currentStage === 'pending' || !currentStage) {
        return 'primary_scheduled'
      }
      return null
    default:
      return null
  }
}

// ---- Public API ----------------------------------------------------------

interface EnsureDealArgs {
  clinicId:  string
  patientId: string
  /** Optional: fall back to this stage if no deal exists. */
  defaultStage?: string
  /** Optional: source to record on the auto-created deal. */
  source?: string | null
}

/**
 * Make sure the patient has at least one open deal in the medical
 * funnel. If not, create one. Returns the deal id (existing or new),
 * or null if the call failed.
 */
export async function ensureMedicalDealForPatient(
  supabase: SupabaseClient,
  { clinicId, patientId, defaultStage = NEW_APPT_DEFAULT_STAGE, source = null }: EnsureDealArgs,
): Promise<string | null> {
  try {
    const { data: existing } = await supabase
      .from('deals')
      .select('id, stage')
      .eq('patient_id', patientId)
      .eq('funnel', 'medical')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.id) return existing.id as string

    const { data: created, error } = await supabase
      .from('deals')
      .insert({
        clinic_id: clinicId,
        patient_id: patientId,
        funnel: 'medical',
        stage: defaultStage,
        priority: 'warm',
        source,           // already-normalised by caller
      })
      .select('id')
      .single()

    if (error) { console.warn('[crm/sync] ensureMedicalDealForPatient insert failed', error); return null }
    return (created?.id as string) ?? null
  } catch (err) {
    console.warn('[crm/sync] ensureMedicalDealForPatient threw', err)
    return null
  }
}

interface SyncPaymentArgs {
  clinicId:  string
  patientId: string
  paymentId: string
  amount:    number
  type:      string   // 'payment' | 'prepayment' | 'refund' | 'writeoff'
  method?:   string
}

/**
 * After a payment row is inserted, drop a note into the patient's open
 * medical-funnel deal and — if the cumulative payments now cover
 * deal_value — auto-mark the deal as won (status='won', stage='success').
 *
 * Refunds are recorded but never auto-close the deal.
 */
export async function syncDealOnPayment(
  supabase: SupabaseClient,
  { clinicId, patientId, paymentId, amount, type, method }: SyncPaymentArgs,
): Promise<void> {
  try {
    const { data: deal } = await supabase
      .from('deals')
      .select('id, deal_value, stage, status, assigned_to, first_owner_id')
      .eq('patient_id', patientId)
      .eq('funnel', 'medical')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!deal?.id) return  // no open deal — nothing to sync
    const dealResponsible = (deal.assigned_to as string) ?? (deal.first_owner_id as string) ?? null

    // Audit trail entry — `outcome` carries the structured ref.
    const verb = type === 'refund' ? 'Возврат' : type === 'prepayment' ? 'Предоплата' : 'Оплата'
    const summary = `${verb} ${Math.abs(amount).toLocaleString('ru-RU')} ₸${method ? ` · ${method}` : ''}`
    await supabase.from('crm_interactions').insert({
      clinic_id:  clinicId,
      deal_id:    deal.id,
      patient_id: patientId,
      type:       'note',
      direction:  null,
      summary,
      outcome:    `payment:${paymentId}`,
    })

    // Notify the deal's responsible — every payment is interesting to them.
    if (type !== 'refund' && type !== 'writeoff') {
      await notify(supabase, {
        clinicId,
        eventType:         'payment_received',
        entityType:        'payment',
        entityId:          paymentId,
        responsibleUserId: dealResponsible,
        title:             summary,
        link:              `/crm?deal=${deal.id}`,
      })
    }

    // Auto-close on full payment.  Skip for refunds, writeoffs, and
    // deals where deal_value is not set yet (manager hasn't priced it).
    if (type === 'refund' || type === 'writeoff') return
    const dealValue = Number(deal.deal_value ?? 0)
    if (dealValue <= 0) return
    if (deal.stage === 'success' || deal.status === 'won') return

    // Sum every completed non-refund payment for this patient.
    const { data: prior } = await supabase
      .from('payments')
      .select('amount, type')
      .eq('patient_id', patientId)
      .eq('status', 'completed')
      .neq('type', 'refund')
      .neq('type', 'writeoff')

    const totalPaid = (prior ?? []).reduce((sum, p) => sum + Number(p.amount ?? 0), 0)
    if (totalPaid + 0.01 < dealValue) return  // not yet covered

    await supabase
      .from('deals')
      .update({ status: 'won', stage: 'success' })
      .eq('id', deal.id)

    await supabase.from('crm_interactions').insert({
      clinic_id:  clinicId,
      deal_id:    deal.id,
      patient_id: patientId,
      type:       'note',
      direction:  null,
      summary:    `Сделка автоматически закрыта как «успешная»: оплачено ${totalPaid.toLocaleString('ru-RU')} ₸ из ${dealValue.toLocaleString('ru-RU')} ₸`,
      outcome:    `payment:${paymentId}:auto_won`,
    })

    await notify(supabase, {
      clinicId,
      eventType:         'deal_won',
      entityType:        'deal',
      entityId:          deal.id as string,
      responsibleUserId: dealResponsible,
      title:             '🏆 Сделка закрыта как успешная',
      body:              `Оплачено ${totalPaid.toLocaleString('ru-RU')} ₸ из ${dealValue.toLocaleString('ru-RU')} ₸`,
      link:              `/crm?deal=${deal.id}`,
    })
  } catch (err) {
    console.warn('[crm/sync] syncDealOnPayment threw', err)
  }
}

interface SyncStatusArgs {
  clinicId:    string
  patientId:   string
  appointmentId: string
  newStatus:   string
}

/**
 * After an appointment status changes, mirror it onto the patient's
 * open medical deal (creating one if needed). Best-effort.
 */
export async function syncDealStageOnAppointmentStatus(
  supabase: SupabaseClient,
  { clinicId, patientId, appointmentId, newStatus }: SyncStatusArgs,
): Promise<void> {
  try {
    const { data: deal } = await supabase
      .from('deals')
      .select('id, stage, assigned_to, first_owner_id')
      .eq('patient_id', patientId)
      .eq('funnel', 'medical')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const dealId       = deal?.id as string | undefined
    const currentStage = (deal?.stage as string | null) ?? null
    let dealResponsible = (deal?.assigned_to as string) ?? (deal?.first_owner_id as string) ?? null
    const targetStage  = appointmentStatusToStage(newStatus, currentStage)
    if (!targetStage) return

    // Create the deal first if the patient didn't have one open.
    let id = dealId
    if (!id) {
      id = await ensureMedicalDealForPatient(supabase, {
        clinicId, patientId, defaultStage: targetStage,
      }) ?? undefined
      if (!id) return
      // Refetch responsible — newly created deal may have first_owner_id
      // assigned by other triggers.
      const { data: fresh } = await supabase
        .from('deals')
        .select('assigned_to, first_owner_id')
        .eq('id', id)
        .maybeSingle()
      dealResponsible = (fresh?.assigned_to as string) ?? (fresh?.first_owner_id as string) ?? null
    } else if (currentStage !== targetStage) {
      const { error } = await supabase.from('deals').update({ stage: targetStage }).eq('id', id)
      if (error) { console.warn('[crm/sync] update stage failed', error); return }
    }

    // Audit trail — a short note in crm_interactions so the manager
    // can see why the card moved. (appointment_id is encoded in the
    // outcome field since the table has no JSONB meta column.)
    await supabase.from('crm_interactions').insert({
      clinic_id:  clinicId,
      deal_id:    id,
      patient_id: patientId,
      type:       'note',
      direction:  null,
      summary:    `Этап сделки обновлён автоматически: статус записи → ${newStatus} → этап ${targetStage}`,
      outcome:    `appointment:${appointmentId}`,
    })

    // Notify responsible — different events for different transitions.
    const eventType =
      newStatus === 'no_show'    ? 'appointment_no_show'  :
      newStatus === 'cancelled'  ? 'appointment_cancelled':
                                   'deal_stage_changed'
    const titleByEvent: Record<string, string> = {
      appointment_no_show:   'Пациент не явился на запись',
      appointment_cancelled: 'Запись отменена',
      deal_stage_changed:    `Этап сделки → ${targetStage}`,
    }
    await notify(supabase, {
      clinicId,
      eventType,
      entityType:        'deal',
      entityId:          id,
      responsibleUserId: dealResponsible,
      title:             titleByEvent[eventType],
      body:              `Запись от ${appointmentId.slice(0, 8)}`,
      link:              `/crm?deal=${id}`,
    })
  } catch (err) {
    console.warn('[crm/sync] syncDealStageOnAppointmentStatus threw', err)
  }
}
