import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()

  let q = supabase.from('payments')
    .select('*, patient:patients(full_name), charge:charges(name)')
    .order('paid_at', { ascending: false })

  const patient_id = searchParams.get('patient_id')
  const session_id = searchParams.get('session_id')
  const date_from  = searchParams.get('date_from')
  const date_to    = searchParams.get('date_to')

  if (patient_id) q = q.eq('patient_id', patient_id)
  if (session_id) q = q.eq('session_id', session_id)
  if (date_from)  q = q.gte('paid_at', `${date_from}T00:00:00`)
  if (date_to)    q = q.lte('paid_at', `${date_to}T23:59:59`)

  const limit = parseInt(searchParams.get('limit') || '50')
  q = q.limit(limit)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ payments: data })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  // Возврат — причина обязательна
  if (body.type === 'refund' && !body.refund_reason) {
    return NextResponse.json({ error: 'Причина возврата обязательна' }, { status: 422 })
  }

  const { data, error } = await supabase.from('payments')
    .insert(body).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ payment: data }, { status: 201 })
}
