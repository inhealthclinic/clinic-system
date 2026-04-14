import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()

  let q = supabase.from('charges')
    .select('*, service:services(name, duration_min)')
    .order('created_at', { ascending: false })

  const visit_id   = searchParams.get('visit_id')
  const patient_id = searchParams.get('patient_id')
  const status     = searchParams.get('status')

  if (visit_id)   q = q.eq('visit_id', visit_id)
  if (patient_id) q = q.eq('patient_id', patient_id)
  if (status)     q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ charges: data })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  // Проверяем лимит скидки роли
  if (body.discount > 0) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role:roles(max_discount_percent, slug)')
      .eq('id', (await supabase.auth.getUser()).data.user?.id!)
      .single()

    const role = (profile as any)?.role
    const maxDiscount = role?.max_discount_percent

    const discountPercent = (body.discount / body.unit_price) * 100

    if (role?.slug !== 'owner' && maxDiscount !== null && discountPercent > maxDiscount) {
      // Превышает лимит — на одобрение
      body.status = 'pending_approval'
    }
  }

  const { data, error } = await supabase.from('charges')
    .insert(body).select('*, service:services(name)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ charge: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const { id, ...body } = await req.json()
  const { data, error } = await supabase.from('charges')
    .update(body).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ charge: data })
}
