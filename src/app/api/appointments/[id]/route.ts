import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SELECT = `
  *,
  patient:patients(id,full_name,phones,birth_date,balance_amount,debt_amount),
  doctor:doctors(id,first_name,last_name,color,specialization:specializations(name)),
  service:services(id,name,price,duration_min)
`

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('appointments').select(SELECT).eq('id', params.id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ appointment: data })
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const body = await req.json()
  const { data, error } = await supabase
    .from('appointments').update(body).eq('id', params.id).select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ appointment: data })
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { status, cancel_reason, arrived_at } = await req.json()
  const { data, error } = await supabase
    .from('appointments')
    .update({ status, cancel_reason, arrived_at })
    .eq('id', params.id)
    .select(SELECT).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ appointment: data })
}
