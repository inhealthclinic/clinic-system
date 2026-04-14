import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SELECT = `*, patient:patients(id,full_name,phones,birth_date,balance_amount,debt_amount), doctor:doctors(id,first_name,last_name,color,specialization:specializations(name)), appointment:appointments(id,date,time_start,time_end,service:services(name))`

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()

  let q = supabase.from('visits').select(SELECT)

  const status     = searchParams.get('status')
  const doctor_id  = searchParams.get('doctor_id')
  const patient_id = searchParams.get('patient_id')
  const date       = searchParams.get('date')

  if (status)     q = q.eq('status', status)
  if (doctor_id)  q = q.eq('doctor_id', doctor_id)
  if (patient_id) q = q.eq('patient_id', patient_id)
  if (date) q = q.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59`)

  q = q.order('created_at', { ascending: false })

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ visits: data })
}
