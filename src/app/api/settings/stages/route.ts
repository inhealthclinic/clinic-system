import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function PATCH(req: NextRequest) {
  const { id, patch } = await req.json()
  if (!id || !patch) return NextResponse.json({ error: 'bad request' }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase.from('pipeline_stages').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
