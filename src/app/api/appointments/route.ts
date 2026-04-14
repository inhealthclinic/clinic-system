import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SELECT = `
  *,
  patient:patients(id,full_name,phones,birth_date,balance_amount,debt_amount),
  doctor:doctors(id,first_name,last_name,color,specialization:specializations(name)),
  service:services(id,name,price,duration_min)
`

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const date       = searchParams.get('date')
  const date_from  = searchParams.get('date_from')
  const date_to    = searchParams.get('date_to')
  const doctor_id  = searchParams.get('doctor_id')
  const patient_id = searchParams.get('patient_id')
  const status     = searchParams.get('status')

  const supabase = await createClient()
  let q = supabase.from('appointments').select(SELECT)

  if (date)       q = q.eq('date', date)
  if (date_from)  q = q.gte('date', date_from)
  if (date_to)    q = q.lte('date', date_to)
  if (doctor_id)  q = q.eq('doctor_id', doctor_id)
  if (patient_id) q = q.eq('patient_id', patient_id)
  if (status)     q = q.eq('status', status)

  q = q.order('time_start')

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ appointments: data })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  const { data, error } = await supabase
    .from('appointments')
    .insert(body)
    .select(SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ appointment: data }, { status: 201 })
}
