import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseAmoSalesbot } from '@/lib/automation/salesbot-flow'

/**
 * POST /api/salesbot-flows/import
 *   body: { name: string, json: object|string, make_default?: boolean }
 *
 * Парсит amoCRM-экспорт Salesbot, нормализует в наш формат шагов и сохраняет
 * в salesbot_flows. Если make_default=true — снимает default с прежнего бота
 * клиники для on_first_inbound и проставляет на новый.
 */
export async function POST(req: NextRequest) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data: profile } = await sb
    .from('user_profiles')
    .select('clinic_id')
    .eq('id', user.id)
    .single<{ clinic_id: string }>()
  if (!profile?.clinic_id) return NextResponse.json({ error: 'no clinic' }, { status: 400 })

  let body: { name?: string; json?: unknown; make_default?: boolean }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const name = (body.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  let raw: unknown = body.json
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) }
    catch { return NextResponse.json({ error: 'json field is not valid JSON' }, { status: 400 }) }
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'json must be an object' }, { status: 400 })
  }

  let parsed
  try { parsed = parseAmoSalesbot(raw) }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }

  // Если хотим сделать default — снимаем флаг с предыдущего.
  if (body.make_default) {
    await sb
      .from('salesbot_flows')
      .update({ is_default: false })
      .eq('clinic_id', profile.clinic_id)
      .eq('trigger_event', 'on_first_inbound')
      .eq('is_default', true)
  }

  const { data: row, error } = await sb
    .from('salesbot_flows')
    .insert({
      clinic_id: profile.clinic_id,
      name,
      steps: parsed.steps,
      start_step: parsed.start,
      source_json: raw,
      trigger_event: 'on_first_inbound',
      is_active: true,
      is_default: !!body.make_default,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    id: row?.id,
    steps_count: Object.keys(parsed.steps).length,
    start_step: parsed.start,
    warnings: parsed.warnings,
  })
}
