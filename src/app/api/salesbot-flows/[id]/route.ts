import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * PATCH /api/salesbot-flows/[id] — переключить is_active / is_default / переименовать.
 * DELETE /api/salesbot-flows/[id]
 */

interface RouteCtx { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const sb = await createClient()
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as Partial<{
    name: string; is_active: boolean; is_default: boolean
    steps: Record<string, unknown>; start_step: number
    trigger_event: 'on_first_inbound' | 'manual' | 'on_deal_create'
  }>

  const patch: Record<string, unknown> = {}
  if (typeof body.name === 'string') patch.name = body.name.trim()
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
  if (body.steps && typeof body.steps === 'object') patch.steps = body.steps
  if (typeof body.start_step === 'number') patch.start_step = body.start_step
  if (body.trigger_event === 'on_first_inbound' || body.trigger_event === 'manual' || body.trigger_event === 'on_deal_create') {
    patch.trigger_event = body.trigger_event
  }

  // Если делаем default — снимаем default с прочих ботов клиники.
  if (body.is_default === true) {
    const { data: cur } = await sb
      .from('salesbot_flows')
      .select('clinic_id, trigger_event')
      .eq('id', id)
      .single<{ clinic_id: string; trigger_event: string }>()
    if (cur) {
      await sb
        .from('salesbot_flows')
        .update({ is_default: false })
        .eq('clinic_id', cur.clinic_id)
        .eq('trigger_event', cur.trigger_event)
        .eq('is_default', true)
    }
    patch.is_default = true
  } else if (body.is_default === false) {
    patch.is_default = false
  }

  const { error } = await sb.from('salesbot_flows').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const sb = await createClient()
  const { id } = await ctx.params
  const { error } = await sb.from('salesbot_flows').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
