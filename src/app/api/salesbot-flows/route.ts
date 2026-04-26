import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/salesbot-flows
 *   body: { name, steps, start_step, trigger_event?, is_default?, is_active? }
 *
 * Сохранить flow, собранный во встроенном визуальном редакторе
 * (отличие от /import — не парсит amoCRM-обёртку, а принимает уже
 * нормализованный JSON шагов).
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

  let body: {
    name?: string
    steps?: Record<string, unknown>
    start_step?: number
    trigger_event?: string
    is_default?: boolean
    is_active?: boolean
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const name = (body.name ?? '').toString().trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!body.steps || typeof body.steps !== 'object') {
    return NextResponse.json({ error: 'steps required' }, { status: 400 })
  }
  const startStep = Number.isFinite(body.start_step) ? Number(body.start_step) : 0
  const triggerEvent = body.trigger_event === 'manual' || body.trigger_event === 'on_deal_create'
    ? body.trigger_event
    : 'on_first_inbound'

  if (body.is_default && triggerEvent === 'on_first_inbound') {
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
      steps: body.steps,
      start_step: startStep,
      trigger_event: triggerEvent,
      is_active: body.is_active !== false,
      is_default: !!body.is_default,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: row?.id })
}
