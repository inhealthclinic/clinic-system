import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const supabase = await createClient()
  const body = await req.json()

  const { data, error } = await supabase
    .from('lab_results').insert(body).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Если критические значения → уведомить врача немедленно
  if (data.has_critical) {
    const { data: order } = await supabase
      .from('lab_orders')
      .select('doctor_id, patient_id, order_number, patient:patients(full_name)')
      .eq('id', data.order_id).single()

    if (order) {
      // Создать срочную задачу врачу
      await supabase.from('tasks').insert({
        clinic_id: (await supabase.auth.getUser()).data.user?.id,
        title: `⚠️ КРИТИЧНО: Анализы готовы — ${(order as any).patient?.full_name}`,
        type: 'lab_critical',
        priority: 'urgent',
        patient_id: (order as any).patient_id,
        assigned_to: (order as any).doctor_id,
        due_at: new Date().toISOString(),
      })

      // Уведомить через Edge Function
      try {
        await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            type: 'lab_critical',
            order_id: data.order_id,
            notify_doctor: true,
          }),
        })
      } catch {}
    }
  }

  return NextResponse.json({ result: data }, { status: 201 })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const { id, results, conclusion, edit_reason } = await req.json()

  // Только owner может редактировать
  const { data: current } = await supabase
    .from('lab_results').select('results, edit_history').eq('id', id).single()

  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: userProfile } = await supabase
    .from('user_profiles')
    .select('role:roles(slug)')
    .eq('id', (await supabase.auth.getUser()).data.user?.id!)
    .single()

  if ((userProfile as any)?.role?.slug !== 'owner') {
    return NextResponse.json({ error: 'Только владелец может редактировать результаты' }, { status: 403 })
  }

  const editEntry = {
    edited_by: (await supabase.auth.getUser()).data.user?.id,
    edited_at: new Date().toISOString(),
    old_results: current.results,
    reason: edit_reason,
  }

  const { data, error } = await supabase.from('lab_results')
    .update({
      results,
      conclusion,
      is_edited: true,
      edit_history: [...(current.edit_history || []), editEntry],
    })
    .eq('id', id).select('*').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ result: data })
}
