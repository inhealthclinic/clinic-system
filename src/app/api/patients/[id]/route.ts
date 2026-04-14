import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('patients').select('*').eq('id', params.id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ patient: data })
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const body = await req.json()
  const { data, error } = await supabase
    .from('patients').update(body).eq('id', params.id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ patient: data })
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const supabase = await createClient()

  // Только owner — проверяем роль
  const { data: profile } = await supabase
    .from('user_profiles').select('role:roles(slug)')
    .eq('id', (await supabase.auth.getUser()).data.user?.id!).single()

  if ((profile as any)?.role?.slug !== 'owner') {
    return NextResponse.json({ error: 'Только владелец может удалять пациентов' }, { status: 403 })
  }

  await supabase.from('patients')
    .update({ deleted_at: new Date().toISOString() }).eq('id', params.id)

  return NextResponse.json({ ok: true })
}
