import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const doctor_id = searchParams.get('doctor_id')
  const date      = searchParams.get('date')
  const start     = searchParams.get('start')
  const end       = searchParams.get('end')
  const exclude   = searchParams.get('exclude')

  if (!doctor_id || !date || !start || !end) {
    return NextResponse.json({ conflicts: [] })
  }

  const supabase = await createClient()
  const conflicts: { type: string; message: string }[] = []

  // 1. Двойная запись
  let q = supabase.from('appointments')
    .select('id, time_start, time_end, patient:patients(full_name)')
    .eq('doctor_id', doctor_id)
    .eq('date', date)
    .not('status', 'in', '("cancelled","no_show","rescheduled")')
    .lt('time_start', end)
    .gt('time_end', start)

  if (exclude) q = q.neq('id', exclude)

  const { data: overlapping } = await q

  if (overlapping?.length) {
    overlapping.forEach(apt => {
      conflicts.push({
        type: 'double_booking',
        message: `Пересечение с записью ${apt.time_start.slice(0,5)}–${apt.time_end.slice(0,5)} (${(apt.patient as any)?.full_name || 'пациент'})`
      })
    })
  }

  // 2. Блокировка врача
  const { data: blocks } = await supabase.from('schedule_blocks')
    .select('reason, date_from, date_to')
    .eq('doctor_id', doctor_id)
    .lte('date_from', date)
    .gte('date_to', date)
    .limit(1)

  if (blocks?.length) {
    const reasonLabels: Record<string, string> = {
      vacation: 'Отпуск', sick: 'Больничный',
      training: 'Обучение', other: 'Недоступен'
    }
    conflicts.push({
      type: 'doctor_blocked',
      message: `Врач недоступен: ${reasonLabels[blocks[0].reason] || blocks[0].reason}`
    })
  }

  // 3. Вне рабочего времени
  const { data: doctor } = await supabase.from('doctors')
    .select('working_hours').eq('id', doctor_id).single()

  if (doctor?.working_hours) {
    const dayMap: Record<number, string> = {
      0:'sun', 1:'mon', 2:'tue', 3:'wed', 4:'thu', 5:'fri', 6:'sat'
    }
    const dow = dayMap[new Date(date).getDay()]
    const hours = doctor.working_hours[dow]

    if (!hours || hours.length === 0) {
      conflicts.push({
        type: 'outside_hours',
        message: 'Нерабочий день врача'
      })
    } else {
      const withinAny = hours.some((h: { from: string; to: string }) =>
        start >= h.from && end <= h.to
      )
      if (!withinAny) {
        conflicts.push({
          type: 'outside_hours',
          message: `Вне рабочего времени врача (${hours.map((h: any) => `${h.from}–${h.to}`).join(', ')})`
        })
      }
    }
  }

  return NextResponse.json({ conflicts })
}
