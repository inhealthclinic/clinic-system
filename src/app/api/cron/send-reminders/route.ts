import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { send } from '@/lib/notifications/providers'
import { render, formatTime, formatDateRu } from '@/lib/notifications/render'

/**
 * GET /api/cron/send-reminders
 *
 * Вызывается Vercel Cron каждые 15 минут. Сканирует приёмы, которым
 * нужно отправить напоминание за 24ч или 2ч, собирает тексты из
 * шаблонов в clinics.settings.notification_templates и шлёт через
 * Twilio/WhatsApp. Помечает reminder_sent_24h/2h, пишет в
 * notifications_log. Идемпотентно благодаря флагам: если упадём в
 * середине батча, повторный запуск не пошлёт то, что уже помечено.
 *
 * Защита: Authorization: Bearer $CRON_SECRET (Vercel Cron шлёт его
 * автоматически, если CRON_SECRET задан в env).
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface Tmpl {
  key: string
  channel: 'sms' | 'whatsapp' | 'both'
  text: string
  enabled: boolean
}

interface ClinicRow {
  id: string
  name: string
  address: string | null
  phone: string | null
  settings: { notification_templates?: Tmpl[] } | null
}

interface AppointmentRow {
  id: string
  clinic_id: string
  date: string
  time_start: string
  reminder_sent_24h: boolean
  reminder_sent_2h: boolean
  status: string
  patient: { id: string; full_name: string; phones: string[] | null } | null
  doctor: { first_name: string; last_name: string } | null
}

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'supabase env missing' }, { status: 500 })
  }
  const sb = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Окна напоминаний ────────────────────────────────────
  // 24ч: приёмы на «завтра» в текущем часу (±30мин от «сейчас + 24ч»)
  // 2ч:  приёмы через 1.5–2.5 часа
  const now = new Date()
  const in24hFrom = new Date(now.getTime() + 23.5 * 3600_000)
  const in24hTo = new Date(now.getTime() + 24.5 * 3600_000)
  const in2hFrom = new Date(now.getTime() + 1.5 * 3600_000)
  const in2hTo = new Date(now.getTime() + 2.5 * 3600_000)

  // Грузим приёмы в ближайшие 25 часов — фильтр по окнам дальше в JS
  // (комбинировать date+time в SQL-условии через Supabase REST неудобно).
  const todayIso = now.toISOString().slice(0, 10)
  const tomorrowIso = new Date(now.getTime() + 26 * 3600_000).toISOString().slice(0, 10)

  const { data: appts, error: apptErr } = await sb
    .from('appointments')
    .select(`
      id, clinic_id, date, time_start, reminder_sent_24h, reminder_sent_2h, status,
      patient:patients(id, full_name, phones),
      doctor:doctors(first_name, last_name)
    `)
    .in('status', ['pending', 'confirmed'])
    .gte('date', todayIso)
    .lte('date', tomorrowIso)
    .returns<AppointmentRow[]>()

  if (apptErr) {
    console.error('[cron/send-reminders] load appts failed:', apptErr)
    return NextResponse.json({ error: apptErr.message }, { status: 500 })
  }

  // ── Загружаем клиники с шаблонами (по одному select на все) ─
  const clinicIds = Array.from(new Set((appts ?? []).map(a => a.clinic_id)))
  const { data: clinics } = await sb
    .from('clinics')
    .select('id, name, address, phone, settings')
    .in('id', clinicIds)
    .returns<ClinicRow[]>()
  const clinicById = new Map<string, ClinicRow>((clinics ?? []).map(c => [c.id, c]))

  // ── Обработка ───────────────────────────────────────────
  let sent24 = 0
  let sent2 = 0
  let skipped = 0
  let failed = 0

  for (const a of appts ?? []) {
    if (!a.patient) continue
    const at = new Date(`${a.date}T${a.time_start}`)
    const need24 = !a.reminder_sent_24h && at >= in24hFrom && at <= in24hTo
    const need2 = !a.reminder_sent_2h && at >= in2hFrom && at <= in2hTo
    if (!need24 && !need2) { skipped++; continue }

    const clinic = clinicById.get(a.clinic_id)
    const templates = clinic?.settings?.notification_templates ?? []
    const key = need24 ? 'appointment_reminder_24h' : 'appointment_reminder_2h'
    const tmpl = templates.find(t => t.key === key && t.enabled)
    if (!tmpl) { skipped++; continue }

    const phone = a.patient.phones?.[0]
    if (!phone) { skipped++; continue }

    const doctorName = a.doctor
      ? `${a.doctor.last_name} ${a.doctor.first_name}`.trim()
      : ''
    const body = render(tmpl.text, {
      'ФИО': a.patient.full_name,
      'имя': a.patient.full_name.split(' ')[1] ?? a.patient.full_name,
      'дата': formatDateRu(a.date),
      'время': formatTime(a.time_start),
      'врач': doctorName,
      'клиника': clinic?.name ?? '',
      'адрес': clinic?.address ?? '',
      'телефон': clinic?.phone ?? '',
    })

    // Канал: если tmpl.channel === 'both' — шлём whatsapp, а при
    // ошибке фолбэчимся на sms. Так дешевле и лучше доходит.
    const channels: Array<'whatsapp' | 'sms'> =
      tmpl.channel === 'both' ? ['whatsapp', 'sms']
      : tmpl.channel === 'whatsapp' ? ['whatsapp']
      : ['sms']

    let delivered = false
    let lastErr = ''
    let usedChannel: 'whatsapp' | 'sms' = channels[0]
    let providerId: string | undefined

    for (const ch of channels) {
      const res = await send(ch, phone, body, a.clinic_id)
      usedChannel = ch
      if (res.ok) {
        delivered = true
        providerId = res.providerId
        break
      }
      lastErr = res.error ?? 'unknown'
    }

    // Лог ВСЕГДА пишем, даже при провале — чтобы админ видел попытки.
    await sb.from('notifications_log').insert({
      clinic_id: a.clinic_id,
      patient_id: a.patient.id,
      appointment_id: a.id,
      channel: usedChannel,
      recipient: phone,
      body,
      status: delivered ? 'sent' : 'failed',
      provider_id: providerId ?? null,
      error: delivered ? null : lastErr,
      sent_at: delivered ? new Date().toISOString() : null,
    })

    if (delivered) {
      const update = need24 ? { reminder_sent_24h: true } : { reminder_sent_2h: true }
      await sb.from('appointments').update(update).eq('id', a.id)
      if (need24) sent24++
      else sent2++
    } else {
      failed++
    }
  }

  return NextResponse.json({
    ok: true,
    checked: appts?.length ?? 0,
    sent24,
    sent2,
    skipped,
    failed,
    at: now.toISOString(),
  })
}
