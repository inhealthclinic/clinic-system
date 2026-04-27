import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

const ALLOWED_TABLES = ['pipeline_stages', 'clinics'] as const
type AllowedTable = typeof ALLOWED_TABLES[number]

export async function PATCH(req: NextRequest) {
  const { id, patch, table = 'pipeline_stages' } = await req.json()
  if (!id || !patch) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  if (!ALLOWED_TABLES.includes(table as AllowedTable))
    return NextResponse.json({ error: 'forbidden table' }, { status: 403 })

  const supabase = createAdminClient()
  const { error } = await supabase.from(table as AllowedTable).update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
