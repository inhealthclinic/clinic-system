import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const body = await req.json()
  const { status, rejected_reason } = body

  const updateData: Record<string, any> = { status }

  if (status === 'sample_taken') updateData.sample_taken_at = new Date().toISOString()
  if (status === 'verified')     updateData.verified_at = new Date().toISOString()
  if (status === 'rejected') {
    updateData.rejected_reason = rejected_reason
    updateData.rejected_at = new Date().toISOString()
  }

  const { data, error } = await supabase.from('lab_orders')
    .update(updateData).eq('id', params.id).select('*, patient:patients(full_name), doctor:doctors(user_id, first_name, last_name)').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Триггер при rejected → уведомить врача
  if (status === 'rejected' && data) {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          type: 'lab_rejected',
          order_id: params.id,
          patient_name: (data as any).patient?.full_name,
          rejected_reason,
        }),
      })
    } catch {}
  }

  // Триггер при ready → уведомить пациента
  if (status === 'ready' && data) {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ type: 'lab_ready', order_id: params.id }),
      })
    } catch {}
  }

  return NextResponse.json({ order: data })
}
