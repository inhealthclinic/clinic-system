// ============================================================
// /api/cron/whatsapp-no-reply
// ────────────────────────────────────────────────────────────
// Triggered by an external scheduler. Recommended cadence:
// every 10–15 minutes. Defaults: SLA = 30 min without an
// outbound reply; window = 60 min lookback.
//
// Auth: header `x-cron-secret` must match env CRON_SECRET.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { runWhatsAppNoReplyScan } from '@/lib/notifications/cron'

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

  // Allow override via query string for ad-hoc tuning.
  const threshold = Number(req.nextUrl.searchParams.get('threshold') ?? 30)
  const window    = Number(req.nextUrl.searchParams.get('window')    ?? 60)

  const result = await runWhatsAppNoReplyScan(supabase, {
    thresholdMinutes: Math.max(1, threshold),
    sinceMinutes:     Math.max(threshold, window),
  })
  return NextResponse.json({ ok: true, ...result })
}

export async function GET() {
  return NextResponse.json({ ok: true, service: 'cron/whatsapp-no-reply' })
}
