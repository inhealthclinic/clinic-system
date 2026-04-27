import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * GET /api/crm/deals?owner=all|mine
 *
 * Тянет сделки текущей клиники user'а через service-role клиент,
 * в обход RLS на таблице deals. Это нужно, потому что в проде у части
 * сессий `current_clinic_id()` возвращает NULL (из-за рассинхрона
 * auth.uid ↔ user_profiles.id или просроченного refresh-токена), и
 * RLS-политика `clinic_id = current_clinic_id()` режет всё в 0 — при
 * том что view v_pipeline_stage_counts корректно показывает счётчики
 * (view bypass'ит RLS deals, потому что owned by postgres).
 *
 * Сервер сам:
 *   1) валидирует Bearer-токен из Authorization,
 *   2) поднимает user_profiles → clinic_id,
 *   3) фильтрует deals по этому clinic_id (+ optional responsible_user_id).
 *
 * Ничего не возвращаем «чужого» — клиника пользователя берётся из БД,
 * а не из тела запроса, обход RLS безопасен.
 */

// Серверный in-memory кэш: все пользователи одной клиники получают один ответ.
// Fluid Compute переиспользует инстанс между запросами — кэш живёт в памяти процесса.
// TTL 30 сек: свежесть достаточная для CRM, нагрузка на БД снижается в 10×.
const _cache = new Map<string, { data: unknown; exp: number }>()
const CACHE_TTL = 30_000

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const DEAL_COLUMNS = `
  id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel, status,
  responsible_user_id, source_id, amount,
  preferred_doctor_id, appointment_type, loss_reason_id, contact_phone, contact_city,
  birth_date, notes, tags, custom_fields, bot_active, bot_state,
  stage_entered_at, created_at, updated_at, deleted_at
`

export async function GET(req: NextRequest) {
  const admin = adminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Сервер не настроен' }, { status: 503 })
  }

  // 1) Декодируем JWT локально (без сетевого вызова к Supabase Auth).
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Нужна авторизация' }, { status: 401 })
  }
  const jwt = authHeader.slice('bearer '.length).trim()
  let userId: string
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
    if (!payload?.sub || payload.exp < Date.now() / 1000) throw new Error('invalid')
    userId = payload.sub as string
  } catch {
    return NextResponse.json({ error: 'Сессия недействительна' }, { status: 401 })
  }

  // 2) Достаём clinic_id юзера.
  const { data: profile, error: profileErr } = await admin
    .from('user_profiles')
    .select('id, clinic_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }
  if (!profile?.clinic_id) {
    return NextResponse.json({ error: 'Профиль не найден' }, { status: 403 })
  }

  // 3) Тянем сделки клиники + связанные справочники.
  const owner = req.nextUrl.searchParams.get('owner') ?? 'all'
  const showClosed = req.nextUrl.searchParams.get('closed') === '1'

  // Серверный кэш: owner=all (общий вид) кэшируем на 30 сек.
  // owner=mine не кэшируем — у каждого свой набор.
  const cacheKey = `${profile.clinic_id}:${owner}:${showClosed ? '1' : '0'}`
  if (owner === 'all') {
    const hit = _cache.get(cacheKey)
    if (hit && hit.exp > Date.now()) {
      return NextResponse.json(hit.data)
    }
  }

  // По умолчанию — только открытые сделки (status = 'open').
  // Закрытые грузим только если явно запрошено closed=1.
  type DealRowSrv = { id: string; patient_id: string | null }
  const PAGE_SIZE = 1000
  const all: DealRowSrv[] = []
  let dealsErr: { message: string } | null = null
  for (let from = 0; from < 100_000; from += PAGE_SIZE) {
    let q = admin
      .from('deals')
      .select(DEAL_COLUMNS)
      .eq('clinic_id', profile.clinic_id)
      .is('deleted_at', null)
    if (!showClosed) q = q.eq('status', 'open')
    if (owner === 'mine') q = q.eq('responsible_user_id', profile.id)
    q = q.order('stage_entered_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
    const { data, error } = await q
    if (error) { dealsErr = error; break }
    const chunk = (data ?? []) as DealRowSrv[]
    all.push(...chunk)
    if (chunk.length < PAGE_SIZE) break
  }
  if (dealsErr) {
    return NextResponse.json({ error: dealsErr.message }, { status: 500 })
  }
  const deals = all

  // 4) Подгружаем пациентов + глобальный счётчик параллельно
  const dealRows = deals as Array<{ id: string; patient_id: string | null }>
  const patientIds = Array.from(
    new Set(dealRows.map(d => d.patient_id).filter((x): x is string => !!x)),
  )
  type PatientLite = {
    id: string
    full_name: string
    phones: string[]
    birth_date?: string | null
    city?: string | null
  }

  const patientBatches = []
  for (let i = 0; i < patientIds.length; i += 500) {
    patientBatches.push(patientIds.slice(i, i + 500))
  }
  const [patientResults, countResult] = await Promise.all([
    Promise.all(patientBatches.map(slice =>
      admin.from('patients').select('id, full_name, phones, birth_date, city').in('id', slice)
    )),
    admin.from('deals').select('id', { count: 'exact', head: true }),
  ])
  const patients: PatientLite[] = patientResults.flatMap(r => (r.data ?? []) as PatientLite[])
  const globalDeals = countResult.count

  const result = {
    clinic_id: profile.clinic_id,
    deals: dealRows,
    patients,
    global_deals_count: globalDeals ?? null,
  }

  if (owner === 'all') {
    _cache.set(cacheKey, { data: result, exp: Date.now() + CACHE_TTL })
  }

  return NextResponse.json(result)
}
