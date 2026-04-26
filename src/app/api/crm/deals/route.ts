import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * GET /api/crm/deals?owner=mine|all&pipelineId=...&limit=5000
 *
 * Зачем нужен отдельный server-side роут вместо прямого supabase-from-client.
 * В PG15+ view v_pipeline_stage_counts по умолчанию запускается с
 * security_invoker=false и не применяет RLS — поэтому бейджи в шапке
 * показывают все сделки клиники. А вот прямая выборка из deals из
 * браузера идёт под пользовательским JWT, и если current_clinic_id()
 * не совпадает с deal.clinic_id (например, из-за того, что импорт
 * сложил сделки в другую клинику или role/profile не настроены), —
 * клиент видит 0 строк, и канбан выглядит пустым.
 *
 * Здесь:
 *   1. Проверяем JWT через service-role admin client.
 *   2. Из user_profiles достаём clinic_id ИМЕННО этого пользователя.
 *   3. Под service role читаем deals для этого clinic_id (без RLS-сюрпризов).
 *   4. Сами джойним patient/responsible/doctor — клиенту так удобнее.
 */

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(req: NextRequest) {
  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'Сервер не настроен' }, { status: 503 })

  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Нужна авторизация' }, { status: 401 })
  }
  const jwt = authHeader.slice('bearer '.length).trim()
  const { data: userInfo, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userInfo?.user) {
    return NextResponse.json({ error: 'Сессия недействительна' }, { status: 401 })
  }
  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, clinic_id')
    .eq('id', userInfo.user.id)
    .maybeSingle()
  if (!profile?.clinic_id) {
    return NextResponse.json({ error: 'Профиль не найден' }, { status: 403 })
  }
  const clinicId = profile.clinic_id as string

  const { searchParams } = new URL(req.url)
  const owner = searchParams.get('owner') ?? 'all'
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '5000', 10) || 5000, 20000)

  // ── deals (без embed-ов, по clinic_id, без RLS) ─────────────────────────
  let q = admin
    .from('deals')
    .select(`
      id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel, status,
      responsible_user_id, source_id, amount,
      preferred_doctor_id, appointment_type, loss_reason_id,
      contact_phone, contact_city, birth_date, notes, tags,
      custom_fields, bot_active, bot_state,
      stage_entered_at, created_at, updated_at
    `)
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
  if (owner === 'mine') q = q.eq('responsible_user_id', profile.id)
  q = q.order('stage_entered_at', { ascending: false }).limit(limit)

  const { data: deals, error: dealsErr } = await q
  if (dealsErr) {
    return NextResponse.json({ error: dealsErr.message }, { status: 500 })
  }

  // count(*) по тем же фильтрам — чтобы фронт мог сверить
  let countQ = admin
    .from('deals')
    .select('id', { count: 'exact', head: true })
    .eq('clinic_id', clinicId)
    .is('deleted_at', null)
  if (owner === 'mine') countQ = countQ.eq('responsible_user_id', profile.id)
  const { count } = await countQ

  // ── enrich: patients / users / doctors ──────────────────────────────────
  const patientIds = Array.from(
    new Set((deals ?? []).map(d => d.patient_id).filter((x): x is string => !!x)),
  )
  const userIds = Array.from(
    new Set((deals ?? []).map(d => d.responsible_user_id).filter((x): x is string => !!x)),
  )
  const doctorIds = Array.from(
    new Set((deals ?? []).map(d => d.preferred_doctor_id).filter((x): x is string => !!x)),
  )

  async function fetchByIds<T>(table: string, cols: string, ids: string[]): Promise<T[]> {
    if (ids.length === 0) return []
    const out: T[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const slice = ids.slice(i, i + 200)
      const { data } = await admin!.from(table).select(cols).in('id', slice)
      if (data) out.push(...(data as T[]))
    }
    return out
  }

  type PatientLite = { id: string; full_name: string; phones: string[]; birth_date?: string | null; city?: string | null }
  type UserLite = { id: string; first_name: string; last_name: string | null }
  type DoctorLite = { id: string; first_name: string; last_name: string | null }

  const [patients, users, doctors] = await Promise.all([
    fetchByIds<PatientLite>('patients', 'id, full_name, phones, birth_date, city', patientIds),
    fetchByIds<UserLite>('user_profiles', 'id, first_name, last_name', userIds),
    fetchByIds<DoctorLite>('doctors', 'id, first_name, last_name', doctorIds),
  ])

  const pById = new Map(patients.map(x => [x.id, x]))
  const uById = new Map(users.map(x => [x.id, x]))
  const dById = new Map(doctors.map(x => [x.id, x]))

  const enriched = (deals ?? []).map(d => ({
    ...d,
    patient: d.patient_id ? (pById.get(d.patient_id) ?? null) : null,
    responsible: d.responsible_user_id ? (uById.get(d.responsible_user_id) ?? null) : null,
    doctor: d.preferred_doctor_id ? (dById.get(d.preferred_doctor_id) ?? null) : null,
  }))

  return NextResponse.json({
    clinicId,
    count: count ?? null,
    deals: enriched,
  })
}
