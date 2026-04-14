import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SELECT = `
  *,
  patient:patients(id, full_name, phones, birth_date, gender),
  doctor:doctors(first_name, last_name),
  items:lab_order_items(*, template:lab_test_templates(name, parameters))
`

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const supabase = await createClient()

  let q = supabase.from('lab_orders').select(SELECT)
    .order('urgent', { ascending: false })
    .order('ordered_at', { ascending: false })

  const status     = searchParams.get('status')
  const patient_id = searchParams.get('patient_id')
  const visit_id   = searchParams.get('visit_id')

  if (status)     q = q.eq('status', status)
  if (patient_id) q = q.eq('patient_id', patient_id)
  if (visit_id)   q = q.eq('visit_id', visit_id)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ orders: data })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { items, ...order } = await req.json()

  // Создать заказ
  const { data: newOrder, error } = await supabase
    .from('lab_orders').insert(order).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Добавить позиции
  if (items?.length) {
    await supabase.from('lab_order_items').insert(
      items.map((i: any) => ({ ...i, order_id: newOrder.id }))
    )
  }

  const { data: full } = await supabase
    .from('lab_orders').select(SELECT).eq('id', newOrder.id).single()

  return NextResponse.json({ order: full }, { status: 201 })
}
