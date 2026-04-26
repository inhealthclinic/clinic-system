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

  // 1) Авторизация по Bearer (тот же приём, что и в /api/settings/whatsapp).
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json({ error: 'Нужна авторизация' }, { status: 401 })
  }
  const jwt = authHeader.slice('bearer '.length).trim()
  const { data: userInfo, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userInfo?.user) {
    return NextResponse.json({ error: 'Сессия недействительна' }, { status: 401 })
  }

  // 2) Достаём clinic_id юзера.
  const { data: profile, error: profileErr } = await admin
    .from('user_profiles')
    .select('id, clinic_id')
    .eq('id', userInfo.user.id)
    .maybeSingle()
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 })
  }
  if (!profile?.clinic_id) {
    return NextResponse.json({ error: 'Профиль не найден' }, { status: 403 })
  }

  // 3) Тянем сделки клиники + связанные справочники.
  const owner = req.nextUrl.searchParams.get('owner') ?? 'all'

  // Пагинируем через .range(), потому что PostgREST имеет жёсткий
  // server-side cap (по умолчанию 1000 строк): даже с .limit(10000)
  // одним запросом приходит не больше 1000. У нас 1565+ сделок —
  // без пагинации ранние 1000 это самые свежие по stage_entered_at,
  // а это в основном «Закрыто»/«Успешно»; колонки активных этапов
  // оказываются пустыми. Тянем чанками по 1000, пока приходит ровно
  // PAGE_SIZE — значит, есть следующая страница.
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

  // Диагностика: считаем все сделки в БД БЕЗ фильтра по клинике.
  // Если service-role реально bypass'ит RLS — count покажет суммарное
  // число сделок (порядка 1565). Если ключ невалидный (anon вместо
  // service_role на Vercel), RLS ляжет, и count тоже будет 0 — это
  // прямой индикатор misconfig'а, видимый прямо в UI-баннере.
  const { count: globalDeals } = await admin
    .from('deals')
    .select('id', { count: 'exact', head: true })

  // 4) Подгружаем пациентов чанками, без embed-ов (PostgREST на больших
  //    выборках с FK на удалённые/недоступные patients схлопывает родителей).
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
  const patients: PatientLite[] = []
  for (let i = 0; i < patientIds.length; i += 500) {
    const slice = patientIds.slice(i, i + 500)
    const { data } = await admin
      .from('patients')
      .select('id, full_name, phones, birth_date, city')
      .in('id', slice)
    if (data) patients.push(...(data as PatientLite[]))
  }

  return NextResponse.json({
    clinic_id: profile.clinic_id,
    deals: dealRows,
    patients,
    global_deals_count: globalDeals ?? null,
  })
}
