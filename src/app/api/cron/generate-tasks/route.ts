import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/cron/generate-tasks
 *
 * Ежедневный крон: создаёт задачи, которые не должны теряться вручную:
 *
 *   1. Дни рождения     — задача менеджеру поздравить (тип 'reminder')
 *   2. Контрольный визит— задача врачу перезвонить/проверить (тип 'control')
 *   3. Долг > 30 дней   — задача кассиру/менеджеру на звонок   (тип 'other')
 *
 * Идемпотентность: перед вставкой каждой задачи проверяем, нет ли уже
 * похожей (patient_id + type + день создания), чтобы повторный прогон
 * не плодил дубликаты.
 *
 * Запускается тем же GH Actions cron, что и send-reminders, только
 * по другому расписанию (раз в сутки).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Вспомогательный тип: Supabase SDK возвращает сложный дженерик со схемой,
// а мы хотим простую подпись хелперов. `any` здесь оправдан —
// cron-роут, никто другой эту функцию не вызывает.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any


interface Patient {
  id: string
  clinic_id: string
  full_name: string
  birth_date: string | null
  debt_amount: number | null
  manager_id: string | null
}

interface Record {
  id: string
  clinic_id: string
  patient_id: string | null
  doctor_id: string | null
  control_date: string | null
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

  const todayIso = new Date().toISOString().slice(0, 10)
  const todayMD = todayIso.slice(5) // "MM-DD"
  const in30 = new Date(Date.now() - 30 * 86400_000).toISOString()

  const stats = { birthdays: 0, controls: 0, debts: 0, skipped: 0 }

  // ── 1. Дни рождения ─────────────────────────────────────
  // Сравниваем MM-DD: Postgres REST не умеет EXTRACT, поэтому читаем
  // всех живых пациентов и фильтруем в памяти. Для клиники с 10–50k
  // пациентов это копейки (200 KB на проходе), не оптимизируем.
  const { data: allPatients } = await sb
    .from('patients')
    .select('id, clinic_id, full_name, birth_date, debt_amount, manager_id')
    .is('deleted_at', null)
    .returns<Patient[]>()

  const birthdayPatients = (allPatients ?? []).filter(p =>
    p.birth_date && p.birth_date.slice(5) === todayMD
  )

  for (const p of birthdayPatients) {
    const exists = await hasTaskToday(sb, p.id, 'reminder', 'birthday')
    if (exists) { stats.skipped++; continue }
    await sb.from('tasks').insert({
      clinic_id: p.clinic_id,
      title: `🎂 День рождения: ${p.full_name}`,
      description: 'Позвонить/написать пациенту, поздравить. Шаблон в /settings/notifications.',
      type: 'reminder',
      priority: 'low',
      assigned_to: p.manager_id,
      patient_id: p.id,
      due_at: new Date().toISOString(),
    })
    stats.birthdays++
  }

  // ── 2. Контрольные визиты ───────────────────────────────
  const { data: recs } = await sb
    .from('medical_records')
    .select('id, clinic_id, patient_id, doctor_id, control_date')
    .eq('control_date', todayIso)
    .returns<Record[]>()

  for (const r of recs ?? []) {
    if (!r.patient_id) continue
    const exists = await hasTaskToday(sb, r.patient_id, 'control', `record:${r.id}`)
    if (exists) { stats.skipped++; continue }

    // assigned_to: doctor_id (UUID в doctors) → ищем соответствующий user_profiles
    let assignTo: string | null = null
    if (r.doctor_id) {
      const { data: doc } = await sb
        .from('doctors').select('user_id').eq('id', r.doctor_id).maybeSingle()
      assignTo = (doc as { user_id?: string } | null)?.user_id ?? null
    }

    await sb.from('tasks').insert({
      clinic_id: r.clinic_id,
      title: 'Контрольный визит — связаться с пациентом',
      description: `Сегодня контрольная дата приёма (запись ${r.id.slice(0, 8)}).`,
      type: 'control',
      priority: 'normal',
      assigned_to: assignTo,
      patient_id: r.patient_id,
      due_at: new Date().toISOString(),
    })
    stats.controls++
  }

  // ── 3. Долги (есть задолженность + не напоминали 14 дней) ──
  // У пациентов нет last_payment_at — поэтому «старость» долга мы не
  // отслеживаем точечно. Вместо этого: раз в 14 дней создаём задачу
  // на любого пациента с debt_amount > 0. Если оплата пришла —
  // триггер finance обнулит debt_amount, и задача на следующий прогон
  // не создастся.
  void in30 // reserved для будущей привязки к дате последней оплаты
  const debtors = (allPatients ?? []).filter(p => Number(p.debt_amount ?? 0) > 0)

  for (const p of debtors) {
    const exists = await hasTaskWithinDays(sb, p.id, 'other', 'debt', 14)
    if (exists) { stats.skipped++; continue }
    await sb.from('tasks').insert({
      clinic_id: p.clinic_id,
      title: `💸 Долг ${Number(p.debt_amount).toLocaleString('ru-RU')} ₸: ${p.full_name}`,
      description: 'У пациента есть задолженность. Связаться, напомнить об оплате.',
      type: 'other',
      priority: 'high',
      assigned_to: p.manager_id,
      patient_id: p.id,
      due_at: new Date(Date.now() + 86400_000).toISOString(),
    })
    stats.debts++
  }

  return NextResponse.json({ ok: true, ...stats, at: new Date().toISOString() })
}

/* ─── Helpers ──────────────────────────────────────────── */

/**
 * Есть ли у пациента задача данного типа, созданная сегодня?
 * На пару задач в день хватит: если крон сорвался и перезапустили,
 * пациент не получит дубликат «🎂 День рождения».
 */
async function hasTaskToday(
  sb: SbClient,
  patientId: string,
  type: string,
  _marker: string,
): Promise<boolean> {
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const { data } = await sb
    .from('tasks')
    .select('id')
    .eq('patient_id', patientId)
    .eq('type', type)
    .gte('created_at', startOfDay.toISOString())
    .limit(1)
  return (data ?? []).length > 0
}

async function hasTaskWithinDays(
  sb: SbClient,
  patientId: string,
  type: string,
  _marker: string,
  days: number,
): Promise<boolean> {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data } = await sb
    .from('tasks')
    .select('id')
    .eq('patient_id', patientId)
    .eq('type', type)
    .gte('created_at', since)
    .limit(1)
  return (data ?? []).length > 0
}
