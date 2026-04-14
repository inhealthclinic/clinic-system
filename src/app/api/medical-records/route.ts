import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()
  const patient_id = searchParams.get('patient_id')
  const visit_id   = searchParams.get('visit_id')

  let q = supabase.from('medical_records')
    .select('*, doctor:doctors(first_name,last_name), visit:visits(created_at,appointment:appointments(date))')

  if (patient_id) q = q.eq('patient_id', patient_id).order('created_at', { ascending: false })
  if (visit_id)   q = q.eq('visit_id', visit_id).single() as any

  const { data, error } = await q as any
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ record: data })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  const { data, error } = await supabase.from('medical_records')
    .insert(body).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ record: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const { id, ...body } = await req.json()

  const { data, error } = await supabase.from('medical_records')
    .update(body).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ record: data })
}
