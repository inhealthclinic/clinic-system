import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const body = await req.json()
  const { action } = body

  if (action === 'close') {
    // Валидация перед закрытием
    const { data: validation } = await supabase.rpc('validate_visit_close', { p_visit_id: params.id })
    const result = validation?.[0]

    if (!result?.ok) {
      return NextResponse.json({ error: result?.reason }, { status: 422 })
    }

    const { data, error } = await supabase.from('visits')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', params.id).select('*').single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ visit: data })
  }

  if (action === 'start') {
    const { data, error } = await supabase.from('visits')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', params.id).select('*').single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ visit: data })
  }

  // Обычное обновление
  const { data, error } = await supabase.from('visits')
    .update(body).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ visit: data })
}
