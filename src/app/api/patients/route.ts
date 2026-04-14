import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()
  const search = searchParams.get('search')
  const status = searchParams.get('status')
  const page   = parseInt(searchParams.get('page') || '0')
  const limit  = parseInt(searchParams.get('limit') || '25')

  let q = supabase.from('patients')
    .select('*', { count: 'exact' })
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1)

  if (search) q = q.or(`full_name.ilike.%${search}%,iin.ilike.%${search}%`)
  if (status && status !== 'all') q = q.eq('status', status)

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ patients: data, total: count })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  // Проверка обязательного согласия ПДн
  if (!body.consent_given) {
    return NextResponse.json({ error: 'Требуется согласие на обработку персональных данных' }, { status: 422 })
  }

  const { consent_given, ...patientData } = body
  const { data: patient, error } = await supabase
    .from('patients').insert(patientData).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Создать запись согласия
  await supabase.from('patient_consents').insert({
    clinic_id: patient.clinic_id,
    patient_id: patient.id,
    type: 'personal_data',
    agreed: true,
    signed_by: (await supabase.auth.getUser()).data.user?.id,
  })

  // Создать запись депозита
  await supabase.from('patient_balance').insert({
    patient_id: patient.id,
    clinic_id: patient.clinic_id,
    balance: 0,
  })

  return NextResponse.json({ patient }, { status: 201 })
}
