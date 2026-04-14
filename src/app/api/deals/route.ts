import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SELECT = `*, patient:patients(id, full_name, phones, status)`

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()

  let q = supabase.from('deals').select(SELECT)
    .order('created_at', { ascending: false })

  const funnel      = searchParams.get('funnel')
  const stage       = searchParams.get('stage')
  const status      = searchParams.get('status') || 'open'
  const patient_id  = searchParams.get('patient_id')
  const assigned_to = searchParams.get('assigned_to')

  if (funnel)      q = q.eq('funnel', funnel)
  if (stage)       q = q.eq('stage', stage)
  if (status)      q = q.eq('status', status)
  if (patient_id)  q = q.eq('patient_id', patient_id)
  if (assigned_to) q = q.eq('first_owner_id', assigned_to)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ deals: data })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  const { data, error } = await supabase
    .from('deals').insert(body).select(SELECT).single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Автозадача при создании лида
  if (body.funnel === 'leads') {
    await supabase.from('tasks').insert({
      clinic_id: body.clinic_id,
      title: `Позвонить новому лиду — ${(data as any).patient?.full_name}`,
      type: 'call',
      priority: body.priority === 'hot' ? 'urgent' : 'high',
      patient_id: body.patient_id,
      deal_id: (data as any).id,
      assigned_to: body.first_owner_id,
      due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // +1 час
    })
  }

  return NextResponse.json({ deal: data }, { status: 201 })
}

export async function PATCH(req: Request) {
  const supabase = await createClient()
  const { id, stage, status, lost_reason, ...rest } = await req.json()

  const { data, error } = await supabase
    .from('deals')
    .update({ stage, status, lost_reason, ...rest })
    .eq('id', id)
    .select(SELECT).single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ deal: data })
}
