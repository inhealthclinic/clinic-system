import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH/POST /api/settings/stages — апдейт справочников клиники
 * (pipeline_stages, clinics, message_templates).
 *
 * Раньше использовали admin (service-role) клиент БЕЗ единой проверки
 * авторизации — любой анонимный запрос мог переименовать чужие этапы,
 * подменить настройки чужой клиники или залить шаблоны куда угодно.
 * См. SEC-инцидент: critical authorization bypass.
 *
 * Теперь:
 *   • RLS-aware client (createClient через cookies) — RLS политики
 *     режут любые операции вне clinic_id юзера.
 *   • Defense-in-depth: проверяем что user аутентифицирован и
 *     резолвим его clinic_id, чтобы дать понятный 401/403, а не
 *     молчаливый «no rows updated» от RLS.
 *   • Для POST upsert — все строки должны быть для clinic_id юзера.
 */

const ALLOWED_TABLES = ['pipeline_stages', 'clinics', 'message_templates'] as const
type AllowedTable = typeof ALLOWED_TABLES[number]

async function getUserClinicId(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user?.id) return null
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('clinic_id')
    .eq('id', auth.user.id)
    .maybeSingle<{ clinic_id: string | null }>()
  return profile?.clinic_id ?? null
}

/** Проверка что строка id принадлежит клинике юзера. */
async function ownsRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: AllowedTable,
  id: string,
  clinicId: string,
): Promise<boolean> {
  if (table === 'clinics') return id === clinicId
  if (table === 'pipeline_stages') {
    // pipeline_stages → pipeline_id → pipelines.clinic_id
    const { data } = await supabase
      .from('pipeline_stages')
      .select('pipeline_id, pipeline:pipelines(clinic_id)')
      .eq('id', id)
      .maybeSingle<{ pipeline: { clinic_id: string } | { clinic_id: string }[] | null }>()
    const pipe = Array.isArray(data?.pipeline) ? data?.pipeline[0] : data?.pipeline
    return pipe?.clinic_id === clinicId
  }
  if (table === 'message_templates') {
    const { data } = await supabase
      .from('message_templates')
      .select('clinic_id')
      .eq('id', id)
      .maybeSingle<{ clinic_id: string }>()
    return data?.clinic_id === clinicId
  }
  return false
}

export async function PATCH(req: NextRequest) {
  const { id, patch, table = 'pipeline_stages' } = await req.json()
  if (!id || !patch) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  if (!ALLOWED_TABLES.includes(table as AllowedTable))
    return NextResponse.json({ error: 'forbidden table' }, { status: 403 })

  const supabase = await createClient()
  const clinicId = await getUserClinicId(supabase)
  if (!clinicId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  if (!(await ownsRow(supabase, table as AllowedTable, id, clinicId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Защита от подмены clinic_id через patch — выкидываем поле, даже
  // если оно прилетело. Менять принадлежность строки чужой клинике нельзя.
  const safePatch = { ...patch }
  delete safePatch.clinic_id

  const { error } = await supabase.from(table as AllowedTable).update(safePatch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const { table, rows, onConflict } = await req.json()
  if (!ALLOWED_TABLES.includes(table as AllowedTable))
    return NextResponse.json({ error: 'forbidden table' }, { status: 403 })
  if (!Array.isArray(rows)) return NextResponse.json({ error: 'rows must be array' }, { status: 400 })

  const supabase = await createClient()
  const clinicId = await getUserClinicId(supabase)
  if (!clinicId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Все строки должны быть для clinic_id юзера. На clinics — id === clinicId.
  for (const r of rows as Array<Record<string, unknown>>) {
    if (table === 'clinics') {
      if (r.id !== clinicId) return NextResponse.json({ error: 'forbidden row' }, { status: 403 })
    } else {
      if (r.clinic_id !== clinicId) {
        return NextResponse.json({ error: 'forbidden row' }, { status: 403 })
      }
    }
  }

  const { error } = await supabase.from(table as AllowedTable).upsert(rows, { onConflict })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
