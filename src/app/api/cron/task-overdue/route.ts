// ============================================================
// /api/cron/task-overdue
// ────────────────────────────────────────────────────────────
// Triggered by an external scheduler (Vercel Cron, Supabase
// scheduled function, GitHub Actions, etc.). Recommended cadence:
// every 5–15 minutes.
//
// Auth: header `x-cron-secret` must match env CRON_SECRET.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runTaskOverdueScan } from '@/lib/notifications/cron'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected && req.headers.get('x-cron-secret') !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'supabase env missing' }, { status: 500 })
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const result = await runTaskOverdueScan(supabase, { sinceMinutes: 15 })
  return NextResponse.json({ ok: true, ...result })
}

// GET ping for health checks
export async function GET() {
  return NextResponse.json({ ok: true, service: 'cron/task-overdue' })
}
