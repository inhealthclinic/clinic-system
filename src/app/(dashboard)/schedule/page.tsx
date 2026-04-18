'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { Appointment, Doctor } from '@/types'

// ─── constants ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  pending:    { cls: 'bg-gray-100 border-gray-200 text-gray-600',       label: 'Ожидает' },
  confirmed:  { cls: 'bg-green-100 border-green-300 text-green-800',    label: 'Подтверждено' },
  arrived:    { cls: 'bg-yellow-100 border-yellow-300 text-yellow-800', label: 'Пришёл' },
  completed:  { cls: 'bg-blue-100 border-blue-200 text-blue-700',       label: 'Завершено' },
  no_show:    { cls: 'bg-red-100 border-red-200 text-red-600',          label: 'Не явился' },
  cancelled:  { cls: 'bg-gray-50 border-gray-200 text-gray-400',        label: 'Отменено' },
  rescheduled:{ cls: 'bg-purple-100 border-purple-200 text-purple-600', label: 'Перенесено' },
}

type DoctorRow = Pick<Doctor, 'id' | 'first_name' | 'last_name' | 'color' | 'consultation_duration'>

// ─── Finance types (drawer) ───────────────────────────────────────────────────

interface VisitServiceRow {
  id: string
  service_id: string | null
  name: string
  quantity: number
  price_at_booking: number
  duration_at_booking: number
  is_lab: boolean
  created_at: string
}

interface VisitPaymentRow {
  id: string
  amount: number
  method: string
  type: string
  paid_at: string
  received_by: string | null
}

interface ServiceCatalogRow {
  id: string
  name: string
  price: number
  duration_min: number
  is_lab: boolean
  category: string
}

interface ServicePackageRow {
  id: string
  name: string
  sort_order: number
  service_ids: string[]  // collected from service_package_items
}

interface PayMethodRow {
  id: string
  name: string
  method_code: string
}

// ─── Appointment type presets ─────────────────────────────────────────────────

type ApptTypeItem = { key: string; label: string; color: string }

const DEFAULT_APPT_TYPES: ApptTypeItem[] = [
  { key: 'consultation', label: 'Консультация', color: '#3b82f6' },
  { key: 'procedure',    label: 'Процедура',    color: '#8b5cf6' },
  { key: 'checkup',      label: 'Осмотр',       color: '#10b981' },
  { key: 'followup',     label: 'Повторный',     color: '#06b6d4' },
  { key: 'surgery',      label: 'Операция',      color: '#f59e0b' },
  { key: 'emergency',    label: 'Срочно',        color: '#ef4444' },
  { key: 'other',        label: 'Другое',        color: '#6b7280' },
]

// Notes-meta encoding: prefix `[t:KEY|c:#HEX] real_notes`
// Used to persist appointment type+color even when the dedicated DB columns
// (color, appt_type) haven't been migrated yet.
const NOTES_META_RE = /^\[t:([^|\]]*)(?:\|c:(#[0-9a-fA-F]{3,8}))?\]\s*/

function parseNotesMeta(notes: string | null | undefined): { type: string | null; color: string | null; rest: string } {
  if (!notes) return { type: null, color: null, rest: '' }
  const m = notes.match(NOTES_META_RE)
  if (!m) return { type: null, color: null, rest: notes }
  return { type: m[1] || null, color: m[2] || null, rest: notes.replace(NOTES_META_RE, '') }
}

function formatNotesMeta(typeKey: string | null | undefined, color: string | null | undefined, rest: string): string | null {
  const body = (rest ?? '').trim()
  if (!typeKey && !color) return body || null
  const t = typeKey ?? ''
  const c = color ? `|c:${color}` : ''
  const prefix = `[t:${t}${c}] `
  return body ? prefix + body : prefix.trim()
}

function apptType(appt: Appointment): string | null {
  if (appt.appt_type) return appt.appt_type
  return parseNotesMeta(appt.notes).type
}

function apptColor(appt: Appointment): string {
  if (appt.color) return appt.color
  const meta = parseNotesMeta(appt.notes)
  if (meta.color) return meta.color
  const doc = appt.doctor as { color?: string } | undefined
  return doc?.color ?? '#3b82f6'
}

function apptDisplayNotes(appt: Appointment): string {
  return parseNotesMeta(appt.notes).rest
}

// ─── TimeGrid ─────────────────────────────────────────────────────────────────

function TimeGrid({ appointments, onCardClick }: {
  appointments: Appointment[]
  onCardClick: (a: Appointment) => void
}) {
  const HOUR_HEIGHT = 60 // px per hour
  const START_HOUR = 8
  const END_HOUR = 20
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  function timeToMinutes(t: string) {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }

  const startMinutes = START_HOUR * 60

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex">
        {/* Time labels column */}
        <div className="w-16 flex-shrink-0 border-r border-gray-100">
          {hours.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT }} className="flex items-start justify-end pr-3 pt-1 border-b border-gray-50">
              <span className="text-xs text-gray-400 font-mono">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {/* Appointments area */}
        <div className="flex-1 relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
          {/* Hour lines */}
          {hours.map(h => (
            <div key={h} className="absolute left-0 right-0 border-b border-gray-50"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT }} />
          ))}
          {/* Half-hour lines */}
          {hours.map(h => (
            <div key={`${h}-half`} className="absolute left-0 right-0 border-b border-dashed border-gray-50"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
          ))}

          {/* Appointment blocks */}
          {appointments.map(a => {
            const startMin = timeToMinutes(a.time_start) - startMinutes
            const duration = a.duration_min ?? 30
            const topPx = (startMin / 60) * HOUR_HEIGHT
            const heightPx = Math.max((duration / 60) * HOUR_HEIGHT, 24)
            const color = apptColor(a)
            const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.pending

            return (
              <div
                key={a.id}
                onClick={() => onCardClick(a)}
                className="absolute left-2 right-2 rounded-lg px-2 py-1 cursor-pointer shadow-sm hover:shadow-md transition-all overflow-hidden border-l-4"
                style={{
                  top: topPx,
                  height: heightPx,
                  backgroundColor: `${color}22`,
                  borderLeftColor: color,
                }}
              >
                <p className="text-xs font-semibold text-gray-900 truncate leading-tight">
                  {a.patient?.full_name ?? 'Walk-in'}
                </p>
                {heightPx > 36 && (
                  <p className="text-xs text-gray-500 truncate leading-tight">
                    {a.time_start.slice(0,5)} · {(a.doctor as { last_name: string } | undefined)?.last_name ?? ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getDatesForSpan(anchorDate: string, spanDays: 1 | 5 | 7): string[] {
  if (spanDays === 1) return [anchorDate]
  const d = new Date(anchorDate + 'T12:00:00')
  const dow = d.getDay() // 0=Sun
  const monday = new Date(d)
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: spanDays }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return day.toISOString().slice(0, 10)
  })
}

// ─── MultiDayGrid ─────────────────────────────────────────────────────────────

function MultiDayGrid({ dates, appointments, birthdayCounts, onCardClick, onDayClick }: {
  dates: string[]
  appointments: Appointment[]
  birthdayCounts?: Record<string, number>
  onCardClick: (a: Appointment) => void
  onDayClick?: (d: string) => void
}) {
  const HOUR_HEIGHT = 56
  const START_HOUR  = 8
  const END_HOUR    = 20
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const startMinutes = START_HOUR * 60
  const today = new Date().toISOString().slice(0, 10)
  const DAY_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const nowObj = new Date()
  const nowTop = ((nowObj.getHours() * 60 + nowObj.getMinutes() - startMinutes) / 60) * HOUR_HEIGHT

  function toMin(t: string) {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="w-14 flex-shrink-0 border-r border-gray-100" />
        {dates.map(d => {
          const obj = new Date(d + 'T12:00:00')
          const isToday = d === today
          const bdays = birthdayCounts?.[d] ?? 0
          return (
            <div key={d} onClick={() => onDayClick?.(d)}
              className={['flex-1 text-center py-2 border-l border-gray-100 transition-colors',
                onDayClick ? 'cursor-pointer hover:bg-blue-50' : '',
                isToday ? 'bg-blue-50' : ''].join(' ')}>
              <p className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>{DAY_RU[obj.getDay()]}</p>
              <p className={`text-sm font-bold ${isToday ? 'text-blue-700' : 'text-gray-800'}`}>{obj.getDate()}</p>
              {bdays > 0 && <p className="text-[9px] text-pink-500 font-medium">🎂 {bdays}</p>}
            </div>
          )
        })}
      </div>

      <div className="flex overflow-y-auto" style={{ maxHeight: 640 }}>
        <div className="w-14 flex-shrink-0 border-r border-gray-100">
          {hours.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT }} className="flex items-start justify-end pr-2 pt-1 border-b border-gray-50">
              <span className="text-[11px] text-gray-400 font-mono">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>
        {dates.map(d => {
          const dayAppts = appointments.filter(a => a.date === d)
          const isToday = d === today
          return (
            <div key={d} className={`flex-1 relative border-l border-gray-100 min-w-0 ${isToday ? 'bg-blue-50/20' : ''}`}
              style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
              {hours.map(h => (
                <div key={h} className="absolute left-0 right-0 border-b border-gray-50" style={{ top: (h - START_HOUR) * HOUR_HEIGHT }} />
              ))}
              {hours.map(h => (
                <div key={`${h}h`} className="absolute left-0 right-0 border-b border-dashed border-gray-50" style={{ top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
              ))}
              {isToday && nowTop >= 0 && nowTop <= (END_HOUR - START_HOUR) * HOUR_HEIGHT && (
                <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-0.5 bg-red-400"><div className="absolute -left-0.5 -top-1 w-2 h-2 rounded-full bg-red-400" /></div>
                </div>
              )}
              {(() => {
                // Lay out overlapping appts side-by-side in lanes
                const sorted = [...dayAppts].sort((x, y) => toMin(x.time_start) - toMin(y.time_start))
                const lanes: Appointment[][] = []
                const positions = new Map<string, { lane: number; lanesTotal: number }>()
                for (const a of sorted) {
                  const aStart = toMin(a.time_start)
                  const aEnd   = aStart + (a.duration_min ?? 30)
                  let placed = false
                  for (let i = 0; i < lanes.length; i++) {
                    const last = lanes[i]![lanes[i]!.length - 1]!
                    const lEnd = toMin(last.time_start) + (last.duration_min ?? 30)
                    if (lEnd <= aStart) {
                      lanes[i]!.push(a); positions.set(a.id, { lane: i, lanesTotal: 0 }); placed = true; break
                    }
                    void aEnd
                  }
                  if (!placed) { lanes.push([a]); positions.set(a.id, { lane: lanes.length - 1, lanesTotal: 0 }) }
                }
                // Compute lanesTotal per cluster (group of overlapping appts)
                for (const a of sorted) {
                  const aStart = toMin(a.time_start)
                  const aEnd   = aStart + (a.duration_min ?? 30)
                  let total = 1
                  for (const b of sorted) {
                    if (b.id === a.id) continue
                    const bStart = toMin(b.time_start); const bEnd = bStart + (b.duration_min ?? 30)
                    if (bStart < aEnd && bEnd > aStart) total = Math.max(total, (positions.get(b.id)?.lane ?? 0) + 1)
                  }
                  const cur = positions.get(a.id)!
                  positions.set(a.id, { lane: cur.lane, lanesTotal: Math.max(total, cur.lane + 1) })
                }

                return dayAppts.map(a => {
                  const startMin = toMin(a.time_start) - startMinutes
                  const dur = a.duration_min ?? 30
                  const topPx = (startMin / 60) * HOUR_HEIGHT
                  const htPx  = Math.max((dur / 60) * HOUR_HEIGHT, 22)
                  const doc = a.doctor as { color?: string; last_name: string } | undefined
                  const aColor = apptColor(a)
                  const pos = positions.get(a.id) ?? { lane: 0, lanesTotal: 1 }
                  const widthPct = 100 / Math.max(pos.lanesTotal, 1)
                  const leftPct  = pos.lane * widthPct
                  return (
                    <div key={a.id} onClick={() => onCardClick(a)}
                      className="absolute rounded-md px-1.5 py-0.5 cursor-pointer hover:brightness-110 transition-all overflow-hidden shadow-sm"
                      style={{
                        top: topPx, height: htPx,
                        left: `calc(${leftPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
                        backgroundColor: aColor, color: '#fff',
                      }}>
                      <p className="text-[11px] font-semibold truncate leading-tight" style={{ color: '#fff' }}>{a.patient?.full_name ?? 'Walk-in'}</p>
                      {htPx > 32 && (
                        <p className="text-[10px] truncate leading-tight" style={{ color: 'rgba(255,255,255,0.85)' }}>
                          {a.time_start.slice(0, 5)}{doc ? ` · ${doc.last_name}` : ''}
                        </p>
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── DoctorDayGrid ────────────────────────────────────────────────────────────

function DoctorDayGrid({ date, doctors, appointments, birthdayCount, onCardClick, onSlotClick }: {
  date: string; doctors: DoctorRow[]; appointments: Appointment[]
  birthdayCount?: number; onCardClick: (a: Appointment) => void
  onSlotClick: (doctorId: string, time: string) => void
}) {
  const H = 60, S = 8, E = 20
  const hours = Array.from({ length: E - S }, (_, i) => S + i)
  const startMin = S * 60
  const isToday = date === new Date().toISOString().slice(0, 10)
  const nowObj = new Date()
  const nowTop = ((nowObj.getHours() * 60 + nowObj.getMinutes() - startMin) / 60) * H
  const DAY_RU = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']
  const dateObj = new Date(date + 'T12:00:00')

  const handleColClick = (e: React.MouseEvent<HTMLDivElement>, doctorId: string) => {
    if ((e.target as HTMLElement).closest('[data-appt]')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const mins = Math.round(((y / H) * 60 + startMin) / 15) * 15
    const hh = Math.floor(mins / 60), mm = mins % 60
    if (hh >= S && hh < E) onSlotClick(doctorId, `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-2.5 border-b border-gray-100 ${isToday ? 'bg-blue-50' : 'bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-semibold uppercase tracking-wide ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>{DAY_RU[dateObj.getDay()]}</span>
          <span className={`text-lg font-bold ${isToday ? 'text-blue-700' : 'text-gray-800'}`}>{dateObj.getDate()}</span>
          <span className="text-xs text-gray-400">{dateObj.toLocaleDateString('ru-RU', { month: 'long' })}</span>
        </div>
        {(birthdayCount ?? 0) > 0 && <span className="text-xs text-pink-600 font-medium bg-pink-50 px-2.5 py-1 rounded-full">🎂 {birthdayCount} дн. рождения</span>}
      </div>
      <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="w-14 flex-shrink-0 border-r border-gray-100" />
        {doctors.map(d => {
          const cnt = appointments.filter(a => a.doctor_id === d.id).length
          return (
            <div key={d.id} className="flex-1 min-w-[130px] py-2 px-2 border-l border-gray-100 text-center">
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color ?? '#9ca3af' }} />
                <p className="text-xs font-semibold text-gray-800 truncate">{d.last_name} {d.first_name.charAt(0)}.</p>
              </div>
              <span className={`text-[10px] ${cnt > 0 ? 'text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full' : 'text-gray-300'}`}>{cnt > 0 ? `${cnt} зап.` : 'свободен'}</span>
            </div>
          )
        })}
      </div>
      <div className="flex overflow-x-auto overflow-y-auto" style={{ maxHeight: 620 }}>
        <div className="w-14 flex-shrink-0 border-r border-gray-100">
          {hours.map(h => (
            <div key={h} style={{ height: H }} className="flex items-start justify-end pr-2 pt-1 border-b border-gray-50">
              <span className="text-[11px] text-gray-400 font-mono">{String(h).padStart(2,'0')}:00</span>
            </div>
          ))}
        </div>
        {doctors.map(d => {
          const docAppts = appointments.filter(a => a.doctor_id === d.id)
          return (
            <div key={d.id} className="flex-1 min-w-[130px] relative border-l border-gray-100 cursor-pointer hover:bg-gray-50/40"
              style={{ height: (E - S) * H }} onClick={e => handleColClick(e, d.id)}>
              {hours.map(h => <div key={h} className="absolute left-0 right-0 border-b border-gray-50 pointer-events-none" style={{ top: (h - S) * H }} />)}
              {hours.map(h => <div key={`${h}h`} className="absolute left-0 right-0 border-b border-dashed border-gray-50 pointer-events-none" style={{ top: (h - S) * H + H / 2 }} />)}
              {isToday && nowTop >= 0 && nowTop <= (E - S) * H && (
                <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                  <div className="h-0.5 bg-red-400"><div className="absolute -left-0.5 -top-1 w-2 h-2 rounded-full bg-red-400" /></div>
                </div>
              )}
              {docAppts.map(a => {
                const top = ((a.time_start.slice(0,5).split(':').reduce((h,m,i)=>i===0?+h*60:+h+ +m,0 as unknown as number) - startMin) / 60) * H
                const ht = Math.max(((a.duration_min ?? 30) / 60) * H, 24)
                const color = apptColor(a)
                return (
                  <div key={a.id} data-appt="1" onClick={e => { e.stopPropagation(); onCardClick(a) }}
                    className="absolute left-0.5 right-0.5 rounded-lg px-1.5 py-1 cursor-pointer hover:brightness-110 overflow-hidden shadow-sm z-10"
                    style={{ top, height: ht, backgroundColor: color, color: '#fff' }}>
                    <p className="text-[11px] font-semibold truncate leading-tight" style={{ color: '#fff' }}>{a.patient?.full_name ?? 'Walk-in'}</p>
                    {ht > 28 && <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>{a.time_start.slice(0,5)}–{a.time_end.slice(0,5)}</p>}
                    {ht > 46 && a.patient?.phones?.[0] && <p className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>{a.patient.phones[0]}</p>}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── ListView ─────────────────────────────────────────────────────────────────
// List of appointments grouped by day. Works for any span (1/5/7).

function ListView({ dates, appointments, onClick }: {
  dates: string[]
  appointments: Appointment[]
  onClick: (a: Appointment) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const DAY_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
  const dayLabel = (d: string) => {
    const obj = new Date(d + 'T12:00:00')
    return `${DAY_RU[obj.getDay()]}, ${obj.getDate()} ${obj.toLocaleDateString('ru-RU', { month: 'long' })}`
  }

  return (
    <div className="space-y-4">
      {dates.map(d => {
        const dayAppts = appointments.filter(a => a.date === d).sort((x, y) => x.time_start.localeCompare(y.time_start))
        const isToday = d === today
        return (
          <div key={d} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className={`px-5 py-2.5 border-b border-gray-100 flex items-center justify-between ${isToday ? 'bg-blue-50' : 'bg-gray-50'}`}>
              <p className={`text-sm font-semibold capitalize ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                {dayLabel(d)}{isToday && <span className="ml-2 text-xs font-medium text-blue-500">· сегодня</span>}
              </p>
              <span className="text-xs text-gray-400">{dayAppts.length} зап.</span>
            </div>
            {dayAppts.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-gray-300">Записей нет</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {dayAppts.map(a => {
                  const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.pending
                  const doctor = a.doctor as { last_name: string; first_name: string; color: string } | undefined
                  return (
                    <div key={a.id} onClick={() => onClick(a)}
                      className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer">
                      <div className="w-20 flex-shrink-0">
                        <p className="text-sm font-mono text-gray-700">{a.time_start.slice(0, 5)}</p>
                        <p className="text-xs text-gray-300">{a.time_end.slice(0, 5)}</p>
                      </div>
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: apptColor(a) }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{a.patient?.full_name ?? 'Walk-in'}</p>
                        <p className="text-xs text-gray-400">
                          {doctor ? `${doctor.last_name} ${doctor.first_name}` : ''}
                          {a.is_walkin && <span className="ml-2 text-orange-400">walk-in</span>}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border flex-shrink-0 ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── ScheduleSidebar ──────────────────────────────────────────────────────────

function ScheduleSidebar({ doctors, visibleIds, onToggle, counts, birthdayCount }: {
  doctors: DoctorRow[]; visibleIds: Set<string>
  onToggle: (id: string) => void; counts: Record<string, number>; birthdayCount: number
}) {
  const allVisible = doctors.every(d => visibleIds.has(d.id))
  return (
    <aside className="w-52 flex-shrink-0 self-start sticky top-4">
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {birthdayCount > 0 && (
          <div className="px-4 py-2.5 border-b border-gray-100 bg-pink-50">
            <p className="text-xs text-pink-600 font-medium">🎂 Дней рождения: {birthdayCount}</p>
          </div>
        )}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Врачи</p>
            <button onClick={() => doctors.forEach(d => { if (allVisible || !visibleIds.has(d.id)) onToggle(d.id) })}
              className="text-[10px] text-blue-500 hover:text-blue-700 font-medium">
              {allVisible ? 'скрыть все' : 'показать все'}
            </button>
          </div>
          <div className="space-y-2">
            {doctors.map(d => {
              const on = visibleIds.has(d.id)
              return (
                <label key={d.id} className="flex items-center gap-2.5 cursor-pointer">
                  <div onClick={() => onToggle(d.id)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${on ? 'border-transparent' : 'border-gray-300 bg-white'}`}
                    style={on ? { backgroundColor: d.color ?? '#3b82f6', borderColor: d.color ?? '#3b82f6' } : {}}>
                    {on && <svg width="9" height="9" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <p className={`text-xs truncate flex-1 ${on ? 'font-medium text-gray-800' : 'text-gray-400'}`}>{d.last_name} {d.first_name.charAt(0)}.</p>
                  {(counts[d.id] ?? 0) > 0 && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{counts[d.id]}</span>}
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </aside>
  )
}

// ─── CreateAppointmentModal ───────────────────────────────────────────────────

type PatientMode = 'search' | 'new'

function CreateAppointmentModal({ clinicId, defaultDate, defaultDoctorId, defaultTime, onClose, onCreated }: {
  clinicId: string
  defaultDate: string
  defaultDoctorId?: string
  defaultTime?: string
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()

  /* ── doctors ── */
  const [doctors, setDoctors]       = useState<DoctorRow[]>([])
  const [doctorsLoading, setDocLoad] = useState(true)
  const [doctorsError, setDocErr]   = useState('')

  /* ── patient ── */
  const [patientMode, setPatientMode]   = useState<PatientMode>('search')
  const [patientSearch, setPatientSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; full_name: string; phones: string[] }[]>([])
  const [showDropdown, setShowDropdown]  = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  /* selected patient */
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string; phone: string } | null>(null)

  /* new patient form */
  const [newPat, setNewPat] = useState({ full_name: '', phone: '+7 7', gender: 'other' as 'male' | 'female' | 'other', birth_date: '' })
  const [newPatSaving, setNewPatSaving] = useState(false)
  const [newPatError, setNewPatError]   = useState('')

  /* ── appointment types from clinic settings ── */
  const [apptTypes, setApptTypes] = useState<ApptTypeItem[]>(DEFAULT_APPT_TYPES)

  /* ── booking form ── */
  const [form, setForm] = useState({
    doctor_id: defaultDoctorId ?? '',
    date: defaultDate,
    time_start: defaultTime ?? '09:00',
    notes: '',
    is_walkin: false,
  })
  const [apptType, setApptType] = useState<string>(DEFAULT_APPT_TYPES[0].key)
  const [apptColor, setApptColor] = useState<string>(DEFAULT_APPT_TYPES[0].color)
  const [customDuration, setCustomDuration] = useState<number | null>(null) // null = use doctor default
  const [takenSlots, setTakenSlots]   = useState<string[]>([])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  /* ── clinic working hours + slot interval ── */
  const [workStart, setWorkStart]     = useState('08:00')
  const [workEnd, setWorkEnd]         = useState('20:00')
  const [workDayOff, setWorkDayOff]   = useState(false)
  const [slotInterval, setSlotInterval] = useState(15)

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  /* ── load doctors (no deleted_at filter — not all tables have it) ── */
  useEffect(() => {
    setDocLoad(true)
    setDocErr('')
    supabase
      .from('doctors')
      .select('id, first_name, last_name, color, consultation_duration')
      .eq('is_active', true)
      .order('last_name')
      .then(({ data, error: err }) => {
        setDocLoad(false)
        if (err) { setDocErr(err.message); return }
        const list = data ?? []
        setDoctors(list)
        if (list[0] && !defaultDoctorId) setForm(f => ({ ...f, doctor_id: list[0].id }))
      })
  }, [])

  /* ── load clinic working hours ── */
  useEffect(() => {
    if (!clinicId) return
    supabase
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .single()
      .then(({ data }) => {
        const wh = data?.settings?.working_hours
        // Load custom appointment types
        const savedTypes = data?.settings?.appt_types as ApptTypeItem[] | undefined
        if (savedTypes?.length) { setApptTypes(savedTypes); setApptType(savedTypes[0].key); setApptColor(savedTypes[0].color) }
        // Read slot interval
        if (data?.settings?.slot_interval_min) {
          setSlotInterval(data.settings.slot_interval_min as number)
        }
        if (!wh) return
        const applyDay = (dateStr: string) => {
          const dayIdx = new Date(dateStr + 'T12:00:00').getDay() // 0=Sun
          const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
          const key = KEYS[dayIdx]
          const day = wh[key]
          if (!day) return
          if (!day.active) { setWorkDayOff(true); return }
          setWorkDayOff(false)
          setWorkStart(day.from ?? '08:00')
          setWorkEnd(day.to ?? '20:00')
        }
        applyDay(form.date)
      })
  }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── re-apply working hours when date changes ── */
  useEffect(() => {
    if (!clinicId) return
    supabase
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .single()
      .then(({ data }) => {
        const wh = data?.settings?.working_hours
        if (!wh) return
        const dayIdx = new Date(form.date + 'T12:00:00').getDay()
        const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const day = wh[KEYS[dayIdx]]
        if (!day) return
        if (!day.active) { setWorkDayOff(true); return }
        setWorkDayOff(false)
        setWorkStart(day.from ?? '08:00')
        setWorkEnd(day.to ?? '20:00')
      })
  }, [form.date]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── load taken slots when doctor or date changes ── */
  useEffect(() => {
    if (!form.doctor_id || !form.date) return
    supabase
      .from('appointments')
      .select('time_start')
      .eq('doctor_id', form.doctor_id)
      .eq('date', form.date)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .then(({ data }) => {
        setTakenSlots((data ?? []).map(a => a.time_start.slice(0, 5)))
      })
  }, [form.doctor_id, form.date])

  /* ── patient search ── */
  const searchDebRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (patientSearch.length < 2) { setSearchResults([]); return }
    if (searchDebRef.current) clearTimeout(searchDebRef.current)
    searchDebRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, phones')
        .or(`full_name.ilike.%${patientSearch}%,phones.cs.{${patientSearch}}`)
        .limit(8)
      setSearchResults(data ?? [])
      setShowDropdown(true)
    }, 250)
    return () => { if (searchDebRef.current) clearTimeout(searchDebRef.current) }
  }, [patientSearch])

  /* close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pickPatient = (p: { id: string; full_name: string; phones: string[] }) => {
    setSelectedPatient({ id: p.id, full_name: p.full_name, phone: p.phones?.[0] ?? '' })
    setShowDropdown(false)
    setPatientSearch('')
  }

  const clearPatient = () => {
    setSelectedPatient(null)
    setPatientSearch('')
    setPatientMode('search')
  }

  /* ── register new patient ── */
  const registerNewPatient = async () => {
    if (!newPat.full_name.trim()) { setNewPatError('Укажите ФИО'); return }
    setNewPatSaving(true); setNewPatError('')
    const { data: pat, error: pErr } = await supabase.from('patients').insert({
      clinic_id: clinicId,
      full_name: newPat.full_name.trim(),
      phones: newPat.phone.trim() ? [newPat.phone.trim()] : [],
      gender: newPat.gender,
      birth_date: newPat.birth_date || null,
      status: 'new',
      is_vip: false,
      balance_amount: 0,
      debt_amount: 0,
      tags: [],
    }).select('id, full_name, phones').single()
    setNewPatSaving(false)
    if (pErr || !pat) { setNewPatError(pErr?.message ?? 'Ошибка создания'); return }
    setSelectedPatient({ id: pat.id, full_name: pat.full_name, phone: pat.phones?.[0] ?? '' })
    setPatientMode('search')
  }

  /* ── helpers ── */
  const selectedDoctor = doctors.find(d => d.id === form.doctor_id)
  const duration = customDuration ?? selectedDoctor?.consultation_duration ?? 30

  const calcEnd = (start: string, min: number) => {
    const [h, m] = start.split(':').map(Number)
    const total = h * 60 + m + min
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  /* generate slots from workStart to workEnd at slotInterval */
  const ALL_SLOTS = (() => {
    const [sh, sm] = workStart.split(':').map(Number)
    const [eh, em] = workEnd.split(':').map(Number)
    const startMin = (sh ?? 8) * 60 + (sm ?? 0)
    const endMin   = (eh ?? 20) * 60 + (em ?? 0)
    const step     = slotInterval ?? 15
    const slots: string[] = []
    for (let t = startMin; t < endMin; t += step) {
      slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    }
    return slots
  })()

  /* current time in minutes (for greying out past slots on today) */
  const todayStr   = new Date().toISOString().slice(0, 10)
  const isToday    = form.date === todayStr
  const nowMinutes = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() })()

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.doctor_id) { setError('Выберите врача'); return }
    setError(''); setSaving(true)

    // Auto-register new patient if needed
    let patientId = selectedPatient?.id ?? null
    if (!patientId) {
      if (patientMode !== 'new' || !newPat.full_name.trim()) { setError('Укажите пациента'); setSaving(false); return }
      const { data: pat, error: pErr } = await supabase.from('patients').insert({
        clinic_id: clinicId, full_name: newPat.full_name.trim(),
        phones: newPat.phone.replace(/\D/g,'').length > 3 ? [newPat.phone.trim()] : [],
        gender: newPat.gender, birth_date: newPat.birth_date || null,
        status: 'new', is_vip: false, balance_amount: 0, debt_amount: 0, tags: [],
      }).select('id, full_name, phones').single()
      if (pErr || !pat) { setError(pErr?.message ?? 'Ошибка создания пациента'); setSaving(false); return }
      patientId = pat.id
      setSelectedPatient({ id: pat.id, full_name: pat.full_name, phone: pat.phones?.[0] ?? '' })
    }

    const timeEnd = calcEnd(form.time_start, duration)
    const { data: conflicts } = await supabase.from('appointments').select('id')
      .eq('doctor_id', form.doctor_id).eq('date', form.date)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .lt('time_start', timeEnd + ':00').gt('time_end', form.time_start + ':00')
    if (conflicts && conflicts.length > 0) { setError(`Конфликт: уже есть запись в ${form.time_start}`); setSaving(false); return }

    // Encode type+color into notes prefix as a fallback (works without DB migration)
    const notesWithMeta = formatNotesMeta(apptType, apptColor, form.notes.trim())
    let insertData: Record<string, unknown> = {
      clinic_id: clinicId, patient_id: patientId, doctor_id: form.doctor_id,
      date: form.date, time_start: form.time_start + ':00', time_end: timeEnd + ':00',
      duration_min: duration, status: 'pending', is_walkin: form.is_walkin,
      source: 'admin', notes: notesWithMeta, color: apptColor, appt_type: apptType,
    }
    let { data: appt, error: err } = await supabase.from('appointments').insert(insertData).select('id').single()
    if (err?.message?.includes('appt_type') || err?.message?.includes('color')) {
      const { appt_type: _a, color: _c, ...basic } = insertData; void _a; void _c; insertData = basic
      const r2 = await supabase.from('appointments').insert(insertData).select('id').single()
      appt = r2.data; err = r2.error
    }
    if (err || !appt) { setError(err?.message ?? 'Ошибка'); setSaving(false); return }

    await supabase.from('visits').insert({
      clinic_id: clinicId, patient_id: patientId,
      doctor_id: form.doctor_id, appointment_id: appt.id, status: 'open',
    })
    onCreated(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md z-10 max-h-[96vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Новая запись</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* ── 1. PATIENT ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Пациент <span className="text-red-400">*</span></label>
              {!selectedPatient && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => setPatientMode('search')}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${patientMode === 'search' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                    Поиск
                  </button>
                  <button type="button" onClick={() => { setPatientMode('new'); setShowDropdown(false) }}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${patientMode === 'new' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                    + Новый пациент
                  </button>
                </div>
              )}
            </div>

            {/* Selected */}
            {selectedPatient ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedPatient.full_name}</p>
                  {selectedPatient.phone && <p className="text-xs text-gray-500 mt-0.5">{selectedPatient.phone}</p>}
                </div>
                <button type="button" onClick={clearPatient}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-3 text-lg leading-none">×</button>
              </div>

            ) : patientMode === 'search' ? (
              /* Search mode */
              <div ref={searchRef} className="relative">
                <input
                  className={inputCls}
                  placeholder="Имя или телефон пациента..."
                  value={patientSearch}
                  onChange={e => { setPatientSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => patientSearch.length >= 2 && setShowDropdown(true)}
                  autoFocus
                />
                {showDropdown && patientSearch.length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden max-h-52 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-400">Не найдено — зарегистрируйте нового</div>
                    ) : (
                      searchResults.map(p => (
                        <button key={p.id} type="button" onClick={() => pickPatient(p)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0">
                          <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                          {p.phones?.[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                        </button>
                      ))
                    )}
                    <button type="button" onClick={() => { setPatientMode('new'); setNewPat(n => ({ ...n, full_name: patientSearch })); setShowDropdown(false) }}
                      className="w-full text-left px-4 py-3 bg-green-50 hover:bg-green-100 transition-colors flex items-center gap-2 border-t border-gray-100">
                      <span className="text-green-600 text-base font-bold leading-none">+</span>
                      <span className="text-sm font-medium text-green-700">
                        {searchResults.length === 0 ? `Создать «${patientSearch}»` : 'Новый пациент'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

            ) : (
              /* New patient mode */
              <div className="border border-green-200 rounded-xl p-4 bg-green-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Новый пациент</p>
                  <button type="button" onClick={() => { setPatientMode('search'); setNewPat({ full_name: '', phone: '+7 7', gender: 'other', birth_date: '' }) }}
                    className="text-xs text-gray-400 hover:text-gray-600">← Назад к поиску</button>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">ФИО <span className="text-red-400">*</span></label>
                  <input className={inputCls} placeholder="Айгерим Бекова" autoFocus
                    value={newPat.full_name}
                    onChange={e => {
                      const val = e.target.value.replace(/\b(\S)/g, c => c.toUpperCase())
                      setNewPat(p => ({ ...p, full_name: val }))
                    }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Телефон</label>
                    <input className={inputCls} placeholder="+7 700 000 0000"
                      value={newPat.phone}
                      maxLength={15}
                      onChange={e => {
                        const raw = e.target.value
                        // Extract only digits after "+7 "
                        if (!raw.startsWith('+7 ')) return
                        const digits = raw.slice(3).replace(/\D/g, '').slice(0, 10)
                        // Format: 7XX XXX XXXX
                        let formatted = '+7 '
                        if (digits.length === 0) { formatted = '+7 7'; setNewPat(p => ({ ...p, phone: formatted })); return }
                        formatted += digits.slice(0, 1)
                        if (digits.length > 1) formatted += digits.slice(1, 3)
                        if (digits.length > 3) formatted += ' ' + digits.slice(3, 6)
                        if (digits.length > 6) formatted += ' ' + digits.slice(6, 10)
                        setNewPat(p => ({ ...p, phone: formatted }))
                      }}
                      onFocus={e => {
                        if (!newPat.phone || newPat.phone === '+7 ') setNewPat(p => ({ ...p, phone: '+7 7' }))
                        setTimeout(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length), 0)
                      }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Пол</label>
                    <select className={inputCls} value={newPat.gender}
                      onChange={e => setNewPat(p => ({ ...p, gender: e.target.value as 'male' | 'female' | 'other' }))}>
                      <option value="female">Женский</option>
                      <option value="male">Мужской</option>
                      <option value="other">Не указан</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Дата рождения
                    {newPat.birth_date && (() => {
                      const diff = Date.now() - new Date(newPat.birth_date).getTime()
                      const age  = Math.floor(diff / (365.25 * 24 * 3600 * 1000))
                      return age >= 0 ? <span className="text-gray-400 font-normal ml-1">({age} лет)</span> : null
                    })()}
                  </label>
                  <input type="date" className={inputCls} value={newPat.birth_date}
                    onChange={e => setNewPat(p => ({ ...p, birth_date: e.target.value }))} />
                </div>
                {newPatError && <p className="text-xs text-red-600">{newPatError}</p>}
                <p className="text-xs text-gray-400">Пациент создастся автоматически при нажатии «Создать запись»</p>
              </div>
            )}
          </div>

          {/* ── 2. DOCTOR ── */}
          <div>
            <label className={labelCls}>Врач <span className="text-red-400">*</span></label>
            {doctorsLoading ? (
              <div className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-400 animate-pulse">Загрузка врачей...</div>
            ) : doctorsError ? (
              <div className="border border-red-200 bg-red-50 rounded-lg px-3 py-2.5 text-sm text-red-600">
                ⚠ Не удалось загрузить врачей: {doctorsError}
              </div>
            ) : doctors.length === 0 ? (
              <div className="border border-yellow-200 bg-yellow-50 rounded-lg px-3 py-2.5 text-sm text-yellow-700">
                Нет активных врачей. Добавьте врача в Настройках → Врачи.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {doctors.map(d => (
                  <label key={d.id}
                    className={[
                      'flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors',
                      form.doctor_id === d.id
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                    ].join(' ')}>
                    <input type="radio" name="doctor" value={d.id} checked={form.doctor_id === d.id}
                      onChange={() => setForm(f => ({ ...f, doctor_id: d.id }))}
                      className="accent-blue-600 flex-shrink-0" />
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color ?? '#9ca3af' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{d.last_name} {d.first_name}</p>
                      <p className="text-xs text-gray-400">{d.consultation_duration ?? 30} мин/приём</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── 3. DATE + TIME SLOT ── */}
          <div>
            <label className={labelCls}>Дата <span className="text-red-400">*</span></label>
            <input type="date" className={inputCls} value={form.date} required
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Время <span className="text-red-400">*</span></label>
              <span className="text-xs text-gray-300">{workStart}–{workEnd}</span>
            </div>

            {/* Time input + duration row */}
            <div className="flex items-center gap-2 mb-2">
              <input
                type="time"
                step={slotInterval * 60}
                value={form.time_start}
                onChange={e => setForm(f => ({ ...f, time_start: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition bg-white w-32 flex-shrink-0"
              />
              <div className="flex items-center gap-1 flex-wrap">
                {[15, 30, 45, 60, 90, 120].map(min => (
                  <button key={min} type="button"
                    onClick={() => setCustomDuration(min === (selectedDoctor?.consultation_duration ?? 30) && customDuration === null ? null : min)}
                    className={['px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
                      duration === min ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'].join(' ')}>
                    {min < 60 ? `${min}м` : min === 60 ? '1ч' : `${min / 60}ч`}
                  </button>
                ))}
              </div>
              {form.time_start && (
                <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                  → {calcEnd(form.time_start, duration)}
                </span>
              )}
            </div>

            {/* Day-off warning */}
            {workDayOff ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 text-sm text-orange-700">
                🚫 В этот день клиника не работает по расписанию.{' '}
                <a href="/settings/clinic" target="_blank" className="underline font-medium">Изменить расписание</a>
              </div>
            ) : (
              /* Quick-pick slot strip */
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {ALL_SLOTS.map(slot => {
                  const taken    = takenSlots.includes(slot)
                  const sel      = form.time_start === slot
                  const [slotH, slotM] = slot.split(':').map(Number)
                  const isPast   = isToday && ((slotH ?? 0) * 60 + (slotM ?? 0)) < nowMinutes
                  const disabled = taken || isPast
                  return (
                    <button
                      key={slot} type="button"
                      disabled={disabled}
                      onClick={() => setForm(f => ({ ...f, time_start: slot }))}
                      className={[
                        'flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
                        taken  ? 'bg-red-50 text-red-300 border-red-100 cursor-not-allowed line-through'
                        : isPast ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : sel  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600',
                      ].join(' ')}
                    >
                      {slot}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── 4. TYPE / COLOR ── */}
          <div>
            <label className={labelCls}>Тип приёма</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {apptTypes.map(t => (
                <button key={t.key} type="button"
                  onClick={() => { setApptType(t.key); setApptColor(t.color) }}
                  className={[
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                    apptType === t.key
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                  ].join(' ')}
                  style={apptType === t.key ? { backgroundColor: t.color, borderColor: t.color } : {}}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
            {/* Custom color override */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Свой цвет:</span>
              <input type="color" value={apptColor}
                onChange={e => { setApptColor(e.target.value); setApptType('other') }}
                className="w-7 h-7 rounded-md border border-gray-200 cursor-pointer p-0.5 bg-white" />
              <span className="text-xs text-gray-400 font-mono">{apptColor}</span>
            </div>
          </div>

          {/* ── 5. NOTES + WALK-IN ── */}
          <div>
            <label className={labelCls}>Причина обращения</label>
            <textarea className={inputCls + ' resize-none'} rows={2}
              placeholder="Первичный приём / боль в спине / контроль..."
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => setForm(f => ({ ...f, is_walkin: !f.is_walkin }))}
              className={['w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                form.is_walkin ? 'bg-blue-600' : 'bg-gray-200'].join(' ')}>
              <span className={['absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                form.is_walkin ? 'translate-x-5' : 'translate-x-0.5'].join(' ')} />
            </div>
            <span className="text-sm text-gray-700">Walk-in (пришёл без предварительной записи)</span>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            Отмена
          </button>
          <button
            type="button"
            disabled={saving || !form.doctor_id || doctorsLoading || (patientMode === 'new' ? !newPat.full_name.trim() : !selectedPatient)}
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение...' : 'Создать запись'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AMO CRM: Print appointment slip (талон на приём) ────────────────────────

function printAppointmentSlip(appt: Appointment) {
  const w = window.open('', '_blank', 'width=420,height=480')
  if (!w) return
  const patient = appt.patient as { full_name: string; phones: string[] } | undefined
  const doctor  = appt.doctor  as { last_name: string; first_name: string } | undefined
  const dateStr = new Date(appt.date + 'T12:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const statusRu = ({ pending: 'Ожидает', confirmed: 'Подтверждено', arrived: 'Прибыл', completed: 'Завершено', no_show: 'Не явился', cancelled: 'Отменено' } as Record<string, string>)[appt.status] ?? appt.status

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Талон на приём</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:360px;margin:24px auto;font-size:13px;color:#111}
    .logo{text-align:center;font-size:18px;font-weight:700;margin-bottom:2px}
    .sub{text-align:center;font-size:11px;color:#777;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #111}
    .big{font-size:22px;font-weight:700;text-align:center;margin:12px 0 4px;letter-spacing:-0.5px}
    .time-row{display:flex;justify-content:center;gap:12px;margin-bottom:14px}
    .timebox{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:8px 18px;text-align:center}
    .timebox .lbl{font-size:10px;color:#0284c7;text-transform:uppercase;letter-spacing:.5px}
    .timebox .val{font-size:20px;font-weight:700;color:#0369a1}
    .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dotted #eee}
    .lbl2{color:#777}
    .status{text-align:center;margin:14px 0 0;font-size:12px;color:#16a34a;font-weight:600}
    .foot{text-align:center;font-size:10px;color:#ccc;margin-top:16px;border-top:1px dashed #ddd;padding-top:8px}
  </style></head><body>
  <div class="logo">IN HEALTH</div>
  <div class="sub">Медицинский центр — Талон на приём</div>
  <div class="big">${patient?.full_name ?? 'Walk-in'}</div>
  <div class="time-row">
    <div class="timebox"><div class="lbl">Начало</div><div class="val">${appt.time_start.slice(0,5)}</div></div>
    <div class="timebox"><div class="lbl">Конец</div><div class="val">${appt.time_end.slice(0,5)}</div></div>
  </div>
  <div class="row"><span class="lbl2">Дата</span><span>${dateStr}</span></div>
  <div class="row"><span class="lbl2">Врач</span><span>${doctor ? `${doctor.last_name} ${doctor.first_name}` : '—'}</span></div>
  <div class="row"><span class="lbl2">Длительность</span><span>${appt.duration_min ?? 30} мин</span></div>
  ${patient?.phones?.[0] ? `<div class="row"><span class="lbl2">Телефон</span><span>${patient.phones[0]}</span></div>` : ''}
  ${apptDisplayNotes(appt) ? `<div class="row"><span class="lbl2">Примечание</span><span style="max-width:180px;text-align:right">${apptDisplayNotes(appt)}</span></div>` : ''}
  <div class="status">Статус: ${statusRu}</div>
  <div class="foot">IN HEALTH · Распечатано: ${new Date().toLocaleString('ru-RU')}</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

// ─── RescheduleModal ─────────────────────────────────────────────────────────

function RescheduleModal({ appt, clinicId, mode, onClose, onDone }: {
  appt: Appointment
  clinicId: string
  mode: 'move' | 'copy'
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

  const [doctors, setDoctors]     = useState<DoctorRow[]>([])
  const [doctorId, setDoctorId]   = useState(appt.doctor_id ?? '')
  const [date, setDate]           = useState(tomorrow)
  const [timeStart, setTimeStart] = useState(appt.time_start.slice(0, 5))
  const [dur, setDur]             = useState(appt.duration_min ?? 30)
  const [notes, setNotes]         = useState(apptDisplayNotes(appt))
  const [workStart, setWorkStart] = useState('08:00')
  const [workEnd, setWorkEnd]     = useState('20:00')
  const [workDayOff, setWorkDayOff] = useState(false)
  const [slotInterval, setSlotInterval] = useState(15)
  const [takenSlots, setTakenSlots] = useState<string[]>([])
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  // load doctors
  useEffect(() => {
    supabase.from('doctors').select('id,first_name,last_name,color,consultation_duration')
      .eq('is_active', true).order('last_name')
      .then(({ data }) => setDoctors((data ?? []) as DoctorRow[]))
  }, [])

  // load working hours for selected date
  useEffect(() => {
    if (!clinicId) return
    supabase.from('clinics').select('settings').eq('id', clinicId).single()
      .then(({ data }) => {
        const s = data?.settings as { working_hours?: Record<string, { active: boolean; from: string; to: string }>; slot_interval_min?: number } | null
        const DAY_KEY = ['sun','mon','tue','wed','thu','fri','sat']
        const dow = new Date(date + 'T12:00:00').getDay()
        const dayKey = DAY_KEY[dow]!
        const wh = s?.working_hours?.[dayKey]
        setWorkDayOff(wh ? !wh.active : false)
        setWorkStart(wh?.from ?? '08:00')
        setWorkEnd(wh?.to ?? '20:00')
        setSlotInterval(s?.slot_interval_min ?? 15)
      })
  }, [clinicId, date])

  // load taken slots for doctor+date (exclude self if moving)
  useEffect(() => {
    if (!doctorId || !date) return
    let q = supabase.from('appointments').select('time_start')
      .eq('doctor_id', doctorId).eq('date', date).neq('status', 'cancelled')
    if (mode === 'move') q = q.neq('id', appt.id)
    q.then(({ data }) => setTakenSlots((data ?? []).map(r => r.time_start.slice(0, 5))))
  }, [doctorId, date])

  const ALL_SLOTS = (() => {
    const [sh, sm] = workStart.split(':').map(Number)
    const [eh, em] = workEnd.split(':').map(Number)
    const start = (sh ?? 8) * 60 + (sm ?? 0)
    const end   = (eh ?? 20) * 60 + (em ?? 0)
    const slots: string[] = []
    for (let t = start; t < end; t += slotInterval)
      slots.push(`${String(Math.floor(t / 60)).padStart(2,'0')}:${String(t % 60).padStart(2,'0')}`)
    return slots
  })()

  const calcEnd = (start: string, min: number) => {
    const [h, m] = start.split(':').map(Number)
    const total = (h ?? 0) * 60 + (m ?? 0) + min
    return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`
  }

  const todayStr   = new Date().toISOString().slice(0, 10)
  const isToday    = date === todayStr
  const nowMinutes = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() })()

  const handleSubmit = async () => {
    if (!doctorId || !date || !timeStart) { setError('Заполните все поля'); return }
    setSaving(true); setError('')
    const timeEndStr = calcEnd(timeStart, dur)

    // Preserve type+color meta when moving/copying
    const existingMeta = parseNotesMeta(appt.notes)
    const notesWithMeta = formatNotesMeta(existingMeta.type ?? appt.appt_type, existingMeta.color ?? appt.color, notes.trim())

    if (mode === 'move') {
      // update existing appointment in-place
      const { error: err } = await supabase.from('appointments').update({
        doctor_id: doctorId,
        date,
        time_start: timeStart + ':00',
        time_end:   timeEndStr + ':00',
        duration_min: dur,
        notes: notesWithMeta,
        status: 'pending',
      }).eq('id', appt.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      // duplicate: insert new appointment
      const { error: err } = await supabase.from('appointments').insert({
        clinic_id:   appt.clinic_id,
        patient_id:  appt.patient_id,
        doctor_id:   doctorId,
        date,
        time_start:  timeStart + ':00',
        time_end:    timeEndStr + ':00',
        duration_min: dur,
        notes: notesWithMeta,
        status: 'pending',
        is_walkin: appt.is_walkin ?? false,
      })
      if (err) { setError(err.message); setSaving(false); return }
    }
    setSaving(false)
    onDone()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition bg-white'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md z-10 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {mode === 'move' ? '📅 Перенести запись' : '📋 Дублировать запись'}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {(appt.patient as { full_name: string } | undefined)?.full_name ?? 'Пациент'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Doctor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Врач</label>
            <div className="space-y-1.5">
              {doctors.map(d => (
                <label key={d.id} className={['flex items-center gap-3 border rounded-xl px-3 py-2.5 cursor-pointer transition-colors',
                  doctorId === d.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'].join(' ')}>
                  <input type="radio" name="rs-doctor" value={d.id} checked={doctorId === d.id}
                    onChange={() => setDoctorId(d.id)} className="accent-blue-600" />
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: d.color ?? '#9ca3af' }} />
                  <p className="text-sm font-medium text-gray-900">{d.last_name} {d.first_name}</p>
                </label>
              ))}
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Дата</label>
            <input type="date" className={inputCls} value={date} onChange={e => setDate(e.target.value)} />
          </div>

          {/* Time + Duration */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Время</label>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <input type="time" step={slotInterval * 60} value={timeStart}
                onChange={e => setTimeStart(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition bg-white w-32 flex-shrink-0" />
              <div className="flex items-center gap-1 flex-wrap">
                {[15, 30, 45, 60, 90, 120].map(m => (
                  <button key={m} type="button" onClick={() => setDur(m)}
                    className={['px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
                      dur === m ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'].join(' ')}>
                    {m < 60 ? `${m}м` : m === 60 ? '1ч' : `${m/60}ч`}
                  </button>
                ))}
              </div>
              {timeStart && <span className="text-xs text-gray-400 ml-auto flex-shrink-0">→ {calcEnd(timeStart, dur)}</span>}
            </div>
            {workDayOff ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-sm text-orange-700">
                🚫 Клиника не работает в этот день
              </div>
            ) : (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {ALL_SLOTS.map(slot => {
                  const taken    = takenSlots.includes(slot)
                  const sel      = timeStart === slot
                  const [sh, sm] = slot.split(':').map(Number)
                  const isPast   = isToday && ((sh ?? 0) * 60 + (sm ?? 0)) < nowMinutes
                  return (
                    <button key={slot} type="button" disabled={taken || isPast}
                      onClick={() => setTimeStart(slot)}
                      className={['flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                        taken  ? 'bg-red-50 text-red-300 border-red-100 cursor-not-allowed line-through'
                        : isPast ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : sel  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600'].join(' ')}>
                      {slot}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Причина обращения</label>
            <textarea className={inputCls + ' resize-none'} rows={2} value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Первичный приём / контроль..." />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            Отмена
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving || !timeStart}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение...' : mode === 'move' ? 'Перенести' : 'Создать копию'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── EditAppointmentModal ─────────────────────────────────────────────────────

function EditAppointmentModal({ appt, clinicId, onClose, onSaved }: {
  appt: Appointment; clinicId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [doctors, setDoctors] = useState<DoctorRow[]>([])
  const [apptTypes, setApptTypes] = useState<ApptTypeItem[]>(DEFAULT_APPT_TYPES)
  const [doctorId, setDoctorId] = useState(appt.doctor_id)
  const [date, setDate] = useState(appt.date)
  const [timeStart, setTimeStart] = useState(appt.time_start.slice(0, 5))
  const [dur, setDur] = useState(appt.duration_min ?? 30)
  const [notes, setNotes] = useState(apptDisplayNotes(appt))
  const [isWalkin, setIsWalkin] = useState(appt.is_walkin ?? false)
  const [selType, setSelType] = useState(apptType(appt) ?? DEFAULT_APPT_TYPES[0].key)
  const [selColor, setSelColor] = useState(apptColor(appt))
  const [workStart, setWorkStart] = useState('08:00')
  const [workEnd, setWorkEnd] = useState('20:00')
  const [slotInterval, setSlotInterval] = useState(15)
  const [takenSlots, setTakenSlots] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white'

  useEffect(() => {
    supabase.from('doctors').select('id,first_name,last_name,color,consultation_duration').eq('is_active',true).order('last_name').then(({data})=>setDoctors((data??[]) as DoctorRow[]))
    if (clinicId) supabase.from('clinics').select('settings').eq('id',clinicId).single().then(({data})=>{
      const s = data?.settings as Record<string,unknown>|null
      const t = s?.appt_types as ApptTypeItem[]|undefined; if (t?.length) setApptTypes(t)
      if (s?.slot_interval_min) setSlotInterval(s.slot_interval_min as number)
      const wh = s?.working_hours as Record<string,{active:boolean;from:string;to:string}>|undefined
      const dow = new Date(date+'T12:00:00').getDay()
      const d2 = wh?.[['sun','mon','tue','wed','thu','fri','sat'][dow]!]
      if (d2?.active) { setWorkStart(d2.from); setWorkEnd(d2.to) }
    })
  }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doctorId||!date) return
    supabase.from('appointments').select('time_start').eq('doctor_id',doctorId).eq('date',date).not('status','in','(cancelled,no_show,rescheduled)').neq('id',appt.id).then(({data})=>setTakenSlots((data??[]).map(r=>r.time_start.slice(0,5))))
  }, [doctorId,date]) // eslint-disable-line react-hooks/exhaustive-deps

  const calcEnd = (s:string,m:number)=>{const[h,min]=s.split(':').map(Number);const t=(h??0)*60+(min??0)+m;return`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`}
  const slots=(()=>{const[sh,sm]=workStart.split(':').map(Number);const[eh,em]=workEnd.split(':').map(Number);const r=[];for(let t=(sh??8)*60+(sm??0);t<(eh??20)*60+(em??0);t+=slotInterval)r.push(`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`);return r})()
  const todayStr=new Date().toISOString().slice(0,10); const isToday=date===todayStr; const nowMin=new Date().getHours()*60+new Date().getMinutes()

  const handleSave = async () => {
    if (!doctorId||!date||!timeStart){setError('Заполните все поля');return}
    setSaving(true);setError('')
    const notesWithMeta = formatNotesMeta(selType, selColor, notes.trim())
    let u:Record<string,unknown>={doctor_id:doctorId,date,time_start:timeStart+':00',time_end:calcEnd(timeStart,dur)+':00',duration_min:dur,notes:notesWithMeta,is_walkin:isWalkin,color:selColor,appt_type:selType}
    let {error:err}=await supabase.from('appointments').update(u).eq('id',appt.id)
    if (err?.message?.includes('appt_type')||err?.message?.includes('color')){const{appt_type:_a,color:_c,...b}=u;void _a;void _c;u=b;const r2=await supabase.from('appointments').update(u).eq('id',appt.id);err=r2.error}
    setSaving(false); if(err){setError(err.message);return}; onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md z-10 max-h-[96vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Редактировать запись</h3>
            <p className="text-xs text-gray-400">{(appt.patient as {full_name:string}|undefined)?.full_name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Doctor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Врач</label>
            <div className="space-y-1.5">
              {doctors.map(d=>(
                <label key={d.id} className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors ${doctorId===d.id?'border-blue-400 bg-blue-50':'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="edit-doc" value={d.id} checked={doctorId===d.id} onChange={()=>setDoctorId(d.id)} className="accent-blue-600"/>
                  <div className="w-3 h-3 rounded-full" style={{background:d.color??'#9ca3af'}}/>
                  <p className="text-sm font-medium text-gray-900">{d.last_name} {d.first_name}</p>
                </label>
              ))}
            </div>
          </div>
          {/* Date */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Дата</label>
            <input type="date" className={ic} value={date} onChange={e=>setDate(e.target.value)}/>
          </div>
          {/* Time */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Время</label>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <input type="time" value={timeStart} onChange={e=>setTimeStart(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-white w-32 flex-shrink-0"/>
              <div className="flex gap-1 flex-wrap">
                {[15,30,45,60,90,120].map(m=>(
                  <button key={m} type="button" onClick={()=>setDur(m)} className={`px-2 py-0.5 rounded-md text-xs font-medium ${dur===m?'bg-blue-600 text-white':'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    {m<60?`${m}м`:m===60?'1ч':`${m/60}ч`}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-400 ml-auto">→ {calcEnd(timeStart,dur)}</span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
              {slots.map(slot=>{
                const taken=takenSlots.includes(slot);const sel=timeStart===slot
                const[sh,sm]=slot.split(':').map(Number);const past=isToday&&((sh??0)*60+(sm??0))<nowMin
                return(
                  <button key={slot} type="button" disabled={taken||past} onClick={()=>setTimeStart(slot)}
                    className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border ${taken?'bg-red-50 text-red-300 border-red-100 cursor-not-allowed line-through':past?'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed':sel?'bg-blue-600 text-white border-blue-600':'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}>
                    {slot}
                  </button>
                )
              })}
            </div>
          </div>
          {/* Type */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Тип приёма</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {apptTypes.map(t=>(
                <button key={t.key} type="button" onClick={()=>{setSelType(t.key);setSelColor(t.color)}}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${selType===t.key?'text-white border-transparent':'bg-white text-gray-600 border-gray-200'}`}
                  style={selType===t.key?{backgroundColor:t.color,borderColor:t.color}:{}}>
                  <span className="w-2 h-2 rounded-full" style={{background:t.color}}/>{t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Свой цвет:</span>
              <input type="color" value={selColor} onChange={e=>{setSelColor(e.target.value);setSelType('other')}} className="w-7 h-7 rounded-md border border-gray-200 cursor-pointer p-0.5 bg-white"/>
              <span className="text-xs text-gray-400 font-mono">{selColor}</span>
            </div>
          </div>
          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Причина обращения</label>
            <textarea className={ic+' resize-none'} rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/>
          </div>
          {/* Walk-in */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={()=>setIsWalkin(v=>!v)} className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${isWalkin?'bg-blue-600':'bg-gray-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isWalkin?'translate-x-5':'translate-x-0.5'}`}/>
            </div>
            <span className="text-sm text-gray-700">Walk-in</span>
          </label>
          {error&&<p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">Отмена</button>
          <button type="button" onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">{saving?'Сохранение...':'Сохранить'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── AppointmentDetailDrawer ──────────────────────────────────────────────────

const PAY_STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  unpaid:  { cls: 'bg-red-100 text-red-600 border-red-200',         label: 'Не оплачено' },
  partial: { cls: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'Частично' },
  paid:    { cls: 'bg-green-100 text-green-700 border-green-200',    label: 'Оплачено' },
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Наличные', kaspi: 'Kaspi', halyk: 'Halyk', credit: 'Рассрочка', balance: 'Баланс',
}

function AppointmentDetailDrawer({ appt, clinicId, onClose, onUpdate }: {
  appt: Appointment; clinicId: string; onClose: () => void; onUpdate: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const { profile } = useAuthStore()

  // ── Existing state ────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [rescheduleMode, setRescheduleMode] = useState<'move' | 'copy' | null>(null)
  const [visitId, setVisitId] = useState<string | null | 'loading'>('loading')
  const [openingVisit, setOpeningVisit] = useState(false)

  // ── Finance state ─────────────────────────────────────────────
  const [visitTotals, setVisitTotals] = useState({ total_price: 0, total_paid: 0, payment_status: 'unpaid' })
  const [visitServices, setVisitServices] = useState<VisitServiceRow[]>([])
  const [visitPayments, setVisitPayments] = useState<VisitPaymentRow[]>([])
  const [allServices, setAllServices] = useState<ServiceCatalogRow[]>([])
  const [payMethods, setPayMethods] = useState<PayMethodRow[]>([])
  const [finLoading, setFinLoading] = useState(true)

  // Service dropdown
  const [svcSearch, setSvcSearch] = useState('')
  const [showSvcDrop, setShowSvcDrop] = useState(false)
  const [addingSvc, setAddingSvc] = useState(false)
  const svcRef = useRef<HTMLDivElement>(null)

  // Payment form
  const [payAmount, setPayAmount] = useState('')
  const [payMethodCode, setPayMethodCode] = useState('cash')
  const [payType, setPayType] = useState<'payment' | 'prepayment'>('payment')
  const [savingPay, setSavingPay] = useState(false)

  // Inline payment editor
  const [editingPayId, setEditingPayId] = useState<string | null>(null)
  const [editPayAmount, setEditPayAmount] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('cash')
  const [busyPayId, setBusyPayId] = useState<string | null>(null)

  // Lab integration
  const [labOrderId, setLabOrderId] = useState<string | null>(null)
  const [transferringLab, setTransferringLab] = useState(false)
  const [labPickerOpen, setLabPickerOpen] = useState(false)
  const [nuanceOpen, setNuanceOpen]       = useState(false)
  const [cardOpen, setCardOpen]           = useState(false)
  const [packages, setPackages] = useState<ServicePackageRow[]>([])

  // Patient demographics for lab snapshot (fetched once drawer opens)
  const [patDemo, setPatDemo] = useState<{
    gender: 'male' | 'female' | 'other' | null
    birth_date: string | null
    pregnancy_status: 'yes' | 'no' | 'unknown' | null
    pregnancy_weeks: number | null
    menopause_status: 'no' | 'peri' | 'post' | 'unknown' | null
    lab_notes: string | null
    fasting_status: 'yes' | 'no' | 'unknown' | null
    taking_medications: 'yes' | 'no' | 'unknown' | null
    medications_note: string | null
    cycle_day: number | null
    full_name: string | null
  } | null>(null)
  // Editable nuance drafts — used for snapshot + persisted back to patient
  const [labPreg,       setLabPreg]      = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [labPregWeeks,  setLabPregWeeks] = useState<string>('')
  const [labMeno,       setLabMeno]      = useState<'no' | 'peri' | 'post' | 'unknown' | ''>('')
  const [labNotesDraft, setLabNotesDraft] = useState('')
  const [labFasting,    setLabFasting]   = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [labMeds,       setLabMeds]      = useState<'yes' | 'no' | 'unknown'>('unknown')
  const [labMedsNote,   setLabMedsNote]  = useState('')
  const [labCycleDay,   setLabCycleDay]  = useState<string>('')

  // ── Load finance data ─────────────────────────────────────────
  const loadFinance = useCallback(async () => {
    setFinLoading(true)
    const { data: v } = await supabase
      .from('visits')
      .select('id, total_price, total_paid, payment_status')
      .eq('appointment_id', appt.id)
      .maybeSingle()
    if (v) {
      setVisitId(v.id)
      setVisitTotals({
        total_price:    Number(v.total_price)    ?? 0,
        total_paid:     Number(v.total_paid)     ?? 0,
        payment_status: v.payment_status ?? 'unpaid',
      })
      const [{ data: svcs }, { data: pmts }, { data: lab }] = await Promise.all([
        supabase.from('visit_services').select('*').eq('visit_id', v.id).order('created_at'),
        supabase.from('payments').select('*').eq('visit_id', v.id).order('paid_at'),
        supabase.from('lab_orders').select('id').eq('visit_id', v.id).maybeSingle(),
      ])
      setVisitServices((svcs ?? []) as VisitServiceRow[])
      setVisitPayments((pmts ?? []) as VisitPaymentRow[])
      setLabOrderId(lab?.id ?? null)
    } else {
      setVisitId(null)
      setVisitTotals({ total_price: 0, total_paid: 0, payment_status: 'unpaid' })
      setVisitServices([])
      setVisitPayments([])
      setLabOrderId(null)
    }
    setFinLoading(false)
  }, [appt.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadFinance()
    supabase.from('services')
      .select('id, name, price, duration_min, is_lab, category')
      .eq('is_active', true).is('deleted_at', null).order('name')
      .then(({ data }) => setAllServices((data ?? []) as ServiceCatalogRow[]))
    supabase.from('payment_methods')
      .select('id, name, method_code')
      .eq('clinic_id', clinicId).eq('is_active', true).order('sort_order')
      .then(({ data }) => setPayMethods((data ?? []) as PayMethodRow[]))
    // Packages with their service_ids (for the lab picker modal)
    supabase.from('service_packages')
      .select('id, name, sort_order, service_package_items(service_id)')
      .eq('clinic_id', clinicId).eq('is_active', true).order('sort_order')
      .then(({ data }) => {
        const rows = (data ?? []) as Array<{
          id: string
          name: string
          sort_order: number
          service_package_items: Array<{ service_id: string }>
        }>
        setPackages(
          rows.map(p => ({
            id: p.id,
            name: p.name,
            sort_order: p.sort_order,
            service_ids: (p.service_package_items ?? []).map(i => i.service_id),
          }))
        )
      })
    // Patient demographic snapshot fields (for lab order snapshot)
    if (appt.patient_id) {
      supabase.from('patients')
        .select('full_name, gender, birth_date, pregnancy_status, pregnancy_weeks, menopause_status, lab_notes, fasting_status, taking_medications, medications_note, cycle_day')
        .eq('id', appt.patient_id).maybeSingle()
        .then(({ data }) => {
          if (!data) return
          const d = data as {
            full_name: string | null
            gender: 'male' | 'female' | 'other' | null
            birth_date: string | null
            pregnancy_status: 'yes' | 'no' | 'unknown' | null
            pregnancy_weeks: number | null
            menopause_status: 'no' | 'peri' | 'post' | 'unknown' | null
            lab_notes: string | null
            fasting_status: 'yes' | 'no' | 'unknown' | null
            taking_medications: 'yes' | 'no' | 'unknown' | null
            medications_note: string | null
            cycle_day: number | null
          }
          setPatDemo(d)
          setLabPreg(d.pregnancy_status ?? 'unknown')
          setLabPregWeeks(d.pregnancy_weeks != null ? String(d.pregnancy_weeks) : '')
          setLabMeno(d.menopause_status ?? '')
          setLabNotesDraft(d.lab_notes ?? '')
          setLabFasting(d.fasting_status ?? 'unknown')
          setLabMeds(d.taking_medications ?? 'unknown')
          setLabMedsNote(d.medications_note ?? '')
          setLabCycleDay(d.cycle_day != null ? String(d.cycle_day) : '')
        })
    }
  }, [appt.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close service dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (svcRef.current && !svcRef.current.contains(e.target as Node)) setShowSvcDrop(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Helpers ───────────────────────────────────────────────────
  const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

  const filteredServices = useMemo(() => {
    const q = svcSearch.trim().toLowerCase()
    if (!q) return allServices.slice(0, 8)
    return allServices.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8)
  }, [allServices, svcSearch])

  const PAY_METHOD_OPTIONS = payMethods.length > 0
    ? payMethods.map(m => ({ code: m.method_code, label: m.name }))
    : [
        { code: 'cash',   label: 'Наличные' },
        { code: 'kaspi',  label: 'Kaspi' },
        { code: 'halyk',  label: 'Halyk' },
        { code: 'credit', label: 'Рассрочка' },
      ]

  // ── Ensure visit exists ───────────────────────────────────────
  const ensureVisit = async (): Promise<string | null> => {
    if (visitId && visitId !== 'loading') return visitId
    const { data } = await supabase.from('visits').insert({
      clinic_id: appt.clinic_id, patient_id: appt.patient_id,
      doctor_id: appt.doctor_id, appointment_id: appt.id, status: 'open',
    }).select('id').single()
    if (data?.id) { setVisitId(data.id); return data.id }
    return null
  }

  // ── Recalculate totals ────────────────────────────────────────
  const recalc = async (vid: string) => {
    const [{ data: svcs }, { data: pmts }] = await Promise.all([
      supabase.from('visit_services').select('quantity, price_at_booking').eq('visit_id', vid),
      supabase.from('payments').select('amount').eq('visit_id', vid),
    ])
    const tp   = (svcs ?? []).reduce((s, x) => s + x.quantity * Number(x.price_at_booking), 0)
    const paid = (pmts ?? []).reduce((s, x) => s + Number(x.amount), 0)
    const ps   = paid === 0 ? 'unpaid' : paid >= tp ? 'paid' : 'partial'
    await supabase.from('visits').update({ total_price: tp, total_paid: paid, payment_status: ps }).eq('id', vid)
    setVisitTotals({ total_price: tp, total_paid: paid, payment_status: ps })
  }

  // ── Add service ───────────────────────────────────────────────
  const addService = async (svc: ServiceCatalogRow) => {
    setAddingSvc(true)
    setSvcSearch('')
    setShowSvcDrop(false)
    const vid = await ensureVisit()
    if (!vid) { setAddingSvc(false); return }
    const existing = visitServices.find(s => s.service_id === svc.id)
    if (existing) {
      const newQty = existing.quantity + 1
      await supabase.from('visit_services').update({ quantity: newQty }).eq('id', existing.id)
      setVisitServices(prev => prev.map(s => s.id === existing.id ? { ...s, quantity: newQty } : s))
    } else {
      const { data } = await supabase.from('visit_services').insert({
        visit_id: vid, service_id: svc.id, name: svc.name,
        quantity: 1, price_at_booking: svc.price, duration_at_booking: svc.duration_min,
        is_lab: svc.is_lab ?? false,
      }).select('*').single()
      if (data) setVisitServices(prev => [...prev, data as VisitServiceRow])
    }
    await recalc(vid)
    setAddingSvc(false)
  }

  // ── Bulk add services (used by lab picker) ───────────────────
  // Receives an array of { svc, qty }. For each row, if it's
  // already in visit_services — updates quantity; otherwise inserts.
  const bulkAddServices = async (selections: Array<{ svc: ServiceCatalogRow; qty: number }>) => {
    if (selections.length === 0) return
    const vid = await ensureVisit()
    if (!vid) return

    const existingByServiceId = new Map(
      visitServices.filter(s => s.service_id).map(s => [s.service_id!, s])
    )

    const toUpdate: Array<{ id: string; quantity: number }> = []
    const toInsert: Array<{
      visit_id: string
      service_id: string
      name: string
      quantity: number
      price_at_booking: number
      duration_at_booking: number
      is_lab: boolean
    }> = []

    for (const { svc, qty } of selections) {
      if (qty <= 0) continue
      const existing = existingByServiceId.get(svc.id)
      if (existing) {
        toUpdate.push({ id: existing.id, quantity: qty })
      } else {
        toInsert.push({
          visit_id:            vid,
          service_id:          svc.id,
          name:                svc.name,
          quantity:            qty,
          price_at_booking:    svc.price,
          duration_at_booking: svc.duration_min,
          is_lab:              svc.is_lab ?? false,
        })
      }
    }

    // Fire updates in parallel
    await Promise.all(
      toUpdate.map(u =>
        supabase.from('visit_services').update({ quantity: u.quantity }).eq('id', u.id)
      )
    )

    // Bulk insert new ones
    let inserted: VisitServiceRow[] = []
    if (toInsert.length > 0) {
      const { data } = await supabase.from('visit_services').insert(toInsert).select('*')
      inserted = (data ?? []) as VisitServiceRow[]
    }

    // Update local state
    setVisitServices(prev => {
      const updatedMap = new Map(toUpdate.map(u => [u.id, u.quantity]))
      const next = prev.map(r =>
        updatedMap.has(r.id) ? { ...r, quantity: updatedMap.get(r.id)! } : r
      )
      return [...next, ...inserted]
    })

    await recalc(vid)
  }

  // ── Remove service ────────────────────────────────────────────
  const removeService = async (row: VisitServiceRow) => {
    await supabase.from('visit_services').delete().eq('id', row.id)
    setVisitServices(prev => prev.filter(s => s.id !== row.id))
    if (visitId && visitId !== 'loading') await recalc(visitId)
  }

  // ── Update quantity ───────────────────────────────────────────
  const updateQty = async (row: VisitServiceRow, delta: number) => {
    const newQty = Math.max(1, row.quantity + delta)
    await supabase.from('visit_services').update({ quantity: newQty }).eq('id', row.id)
    setVisitServices(prev => prev.map(s => s.id === row.id ? { ...s, quantity: newQty } : s))
    if (visitId && visitId !== 'loading') await recalc(visitId)
  }

  // ── Add payment ───────────────────────────────────────────────
  const addPayment = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) return
    setSavingPay(true)
    const vid = await ensureVisit()
    if (!vid) { setSavingPay(false); return }
    const { data } = await supabase.from('payments').insert({
      clinic_id:   clinicId,
      patient_id:  appt.patient_id,
      visit_id:    vid,
      amount,
      method:      payMethodCode,
      type:        payType,
      status:      'completed',
      received_by: profile?.id ?? null,
    }).select('*').single()
    if (data) {
      setVisitPayments(prev => [...prev, data as VisitPaymentRow])
      setPayAmount('')
    }
    await recalc(vid)
    setSavingPay(false)
  }

  // ── Edit / Delete single payment ──────────────────────────────
  const startEditPayment = (p: VisitPaymentRow) => {
    setEditingPayId(p.id)
    setEditPayAmount(String(p.amount))
    setEditPayMethod(p.method)
  }
  const cancelEditPayment = () => {
    setEditingPayId(null)
    setEditPayAmount('')
  }
  const saveEditPayment = async (p: VisitPaymentRow) => {
    const amount = parseFloat(editPayAmount)
    if (!amount || amount <= 0) return
    setBusyPayId(p.id)
    const { error } = await supabase.from('payments')
      .update({ amount, method: editPayMethod })
      .eq('id', p.id)
    if (error) {
      alert('Не удалось сохранить: ' + error.message)
      setBusyPayId(null)
      return
    }
    setVisitPayments(prev => prev.map(x =>
      x.id === p.id ? { ...x, amount, method: editPayMethod } : x
    ))
    if (visitId && visitId !== 'loading') await recalc(visitId)
    setBusyPayId(null)
    setEditingPayId(null)
  }
  const deletePayment = async (p: VisitPaymentRow) => {
    if (!confirm(`Удалить оплату ${fmtMoney(Number(p.amount))} (${METHOD_LABELS[p.method] ?? p.method})?`)) return
    setBusyPayId(p.id)
    const { error } = await supabase.from('payments').delete().eq('id', p.id)
    if (error) {
      alert('Не удалось удалить: ' + error.message)
      setBusyPayId(null)
      return
    }
    setVisitPayments(prev => prev.filter(x => x.id !== p.id))
    if (visitId && visitId !== 'loading') await recalc(visitId)
    setBusyPayId(null)
  }

  // ── Existing handlers ─────────────────────────────────────────
  const handleOpenVisit = async () => {
    setOpeningVisit(true)
    if (visitId && visitId !== 'loading') { router.push(`/visits/${visitId}`); return }
    const { data } = await supabase.from('visits').insert({
      clinic_id: appt.clinic_id, patient_id: appt.patient_id,
      doctor_id: appt.doctor_id, appointment_id: appt.id, status: 'open',
    }).select('id').single()
    setOpeningVisit(false)
    if (data?.id) router.push(`/visits/${data.id}`)
  }

  const updateStatus = async (status: string) => {
    setSaving(true)
    const patch: Record<string, unknown> = { status }
    if (status === 'arrived') patch.arrived_at = new Date().toISOString()
    await supabase.from('appointments').update(patch).eq('id', appt.id)
    if (status === 'no_show') {
      await supabase.from('tasks').insert({
        clinic_id: appt.clinic_id,
        title: `Выяснить причину неявки: ${appt.patient?.full_name}`,
        type: 'call', priority: 'high', status: 'new',
        patient_id: appt.patient_id,
        due_at: new Date(Date.now() + 2*60*60*1000).toISOString(),
      })
    }
    setSaving(false)
    onUpdate()
    onClose()
  }

  const doctor = appt.doctor as { last_name: string; first_name: string; color: string } | undefined
  const patient = appt.patient as { id: string; full_name: string; phones: string[] } | undefined
  const st = STATUS_STYLE[appt.status] ?? STATUS_STYLE.pending

  const NEXT: Record<string, { status: string; label: string; cls: string }[]> = {
    pending:   [
      { status: 'confirmed', label: '✓ Подтвердить', cls: 'bg-green-600 hover:bg-green-700' },
      { status: 'cancelled', label: 'Отменить',       cls: 'bg-red-500 hover:bg-red-600' },
    ],
    confirmed: [
      { status: 'arrived',   label: '✓ Пришёл',      cls: 'bg-yellow-500 hover:bg-yellow-600' },
      { status: 'no_show',   label: 'Не явился',      cls: 'bg-red-500 hover:bg-red-600' },
    ],
    arrived:   [
      { status: 'completed', label: '✓ Завершить',    cls: 'bg-blue-600 hover:bg-blue-700' },
    ],
  }
  const nextActions = NEXT[appt.status] ?? []

  const debt = Math.max(0, visitTotals.total_price - visitTotals.total_paid)
  const psStyle = PAY_STATUS_STYLE[visitTotals.payment_status] ?? PAY_STATUS_STYLE.unpaid
  const hasUnpaid = visitTotals.total_price > 0 && visitTotals.payment_status !== 'paid'

  // ── Visit type ───────────────────────────────────────────────
  const hasLab     = visitServices.some(s => s.is_lab)
  const hasRegular = visitServices.some(s => !s.is_lab)
  const visitType: 'consultation' | 'lab' | 'mixed' | null =
    hasLab && hasRegular ? 'mixed'
      : hasLab           ? 'lab'
      : hasRegular       ? 'consultation'
      : null
  const vtStyle: Record<string, { cls: string; label: string }> = {
    consultation: { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', label: 'Консультация' },
    lab:          { cls: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Анализы' },
    mixed:        { cls: 'bg-teal-50 text-teal-700 border-teal-200',       label: 'Смешанный' },
  }

  // ── Transfer lab services to lab module ──────────────────────
  const transferToLab = async () => {
    if (!hasLab || labOrderId || transferringLab) return
    setTransferringLab(true)
    const vid = await ensureVisit()
    if (!vid) { setTransferringLab(false); return }

    const labRows = visitServices.filter(s => s.is_lab)

    // Pre-match service names to lab templates (same clinic, active)
    const names = Array.from(new Set(labRows.map(r => r.name.toLowerCase())))
    const { data: tpl } = await supabase
      .from('lab_test_templates')
      .select('id, name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
    const tplByName = new Map<string, string>()
    for (const t of (tpl ?? []) as { id: string; name: string }[]) {
      if (names.includes(t.name.toLowerCase())) tplByName.set(t.name.toLowerCase(), t.id)
    }

    // Snapshot: freeze patient demographics at order-creation time.
    // Priority: current draft (edited at transfer) > patDemo from DB.
    const age = patDemo?.birth_date
      ? Math.floor((Date.now() - new Date(patDemo.birth_date).getTime()) / (365.25 * 24 * 3600 * 1000))
      : null
    const pregWeeksNum = labPreg === 'yes' && labPregWeeks.trim()
      ? Math.max(1, Math.min(42, parseInt(labPregWeeks, 10) || 0)) || null
      : null
    const cycleDayNum = patDemo?.gender === 'female' && labPreg !== 'yes' && labCycleDay.trim()
      ? Math.max(1, Math.min(60, parseInt(labCycleDay, 10) || 0)) || null
      : null
    const labNotesClean = labNotesDraft.trim() || null
    const medsNoteClean = labMeds === 'yes' ? (labMedsNote.trim() || null) : null
    const menoSnap = patDemo?.gender === 'female' && labPreg !== 'yes' ? (labMeno || null) : null

    // Persist nuances back to patient card (source of truth)
    if (appt.patient_id) {
      const patientUpdate: Record<string, unknown> = {
        pregnancy_status:   labPreg,
        pregnancy_weeks:    pregWeeksNum,
        lab_notes:          labNotesClean,
        fasting_status:     labFasting,
        taking_medications: labMeds,
        medications_note:   medsNoteClean,
        cycle_day:          cycleDayNum,
      }
      if (patDemo?.gender === 'female') {
        patientUpdate.menopause_status = menoSnap
      }
      await supabase.from('patients').update(patientUpdate).eq('id', appt.patient_id)
    }

    // Create lab_order
    const { data: order, error: orderErr } = await supabase.from('lab_orders').insert({
      clinic_id:  clinicId,
      patient_id: appt.patient_id,
      doctor_id:  appt.doctor_id,
      visit_id:   vid,
      status:     'ordered',
      created_by: profile?.id ?? null,
      // Demographic snapshot — frozen for historical accuracy
      patient_name_snapshot:       patDemo?.full_name ?? null,
      sex_snapshot:                patDemo?.gender ?? null,
      age_snapshot:                age,
      pregnancy_snapshot:          labPreg,
      pregnancy_weeks_snapshot:    pregWeeksNum,
      lab_notes_snapshot:          labNotesClean,
      menopause_snapshot:          menoSnap,
      fasting_snapshot:            labFasting,
      taking_medications_snapshot: labMeds,
      medications_note_snapshot:   medsNoteClean,
      cycle_day_snapshot:          cycleDayNum,
    }).select('id').single()
    if (orderErr || !order) {
      setTransferringLab(false)
      alert('Не удалось создать заказ в лабораторию: ' + (orderErr?.message ?? 'unknown'))
      return
    }

    // Expand each visit_service by quantity into items
    const items: Array<{
      order_id: string; template_id: string | null; name: string; price: number; status: string
    }> = []
    for (const r of labRows) {
      const tid = tplByName.get(r.name.toLowerCase()) ?? null
      const qty = Math.max(1, r.quantity)
      for (let i = 0; i < qty; i++) {
        items.push({
          order_id:    order.id,
          template_id: tid,
          name:        r.name,
          price:       Number(r.price_at_booking),
          status:      'pending',
        })
      }
    }
    if (items.length > 0) {
      const { error: itemsErr } = await supabase.from('lab_order_items').insert(items)
      if (itemsErr) {
        alert('Заказ создан, но позиции не добавились: ' + itemsErr.message)
      }
    }

    setLabOrderId(order.id)
    setTransferringLab(false)
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-24px))] max-h-[calc(100vh-40px)] bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-base font-semibold text-gray-900">{patient?.full_name ?? 'Walk-in'}</p>
            {patient?.phones?.[0] && <p className="text-xs text-gray-400 mt-0.5">{patient.phones[0]}</p>}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {patient?.id && (
              <button
                type="button"
                onClick={() => setCardOpen(true)}
                title="Открыть карту пациента"
                className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-emerald-600 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200 transition-colors"
              >
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/></svg>
                Карта пациента
              </button>
            )}
            <button onClick={() => setEditOpen(true)} title="Редактировать"
              className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-blue-600 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 border border-gray-200 hover:border-blue-200 transition-colors">
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Изменить
            </button>
            <button onClick={() => printAppointmentSlip(appt)} title="Печать" className="text-gray-400 hover:text-blue-600 px-2 py-1.5 rounded-lg hover:bg-blue-50">🖨</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">

          {/* Appointment info */}
          {doctor && (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: doctor.color ?? '#6B7280' }} />
              <p className="text-sm text-gray-700">{doctor.last_name} {doctor.first_name}</p>
            </div>
          )}
          <p className="text-sm text-gray-700">
            📅 {new Date(appt.date + 'T12:00:00').toLocaleDateString('ru-RU', {
              weekday: 'short', day: 'numeric', month: 'long',
            })}
          </p>
          <p className="text-sm text-gray-700">
            🕐 {appt.time_start.slice(0, 5)} — {appt.time_end.slice(0, 5)}
            <span className="text-gray-400 text-xs ml-2">({appt.duration_min} мин)</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {apptType(appt) && (() => {
              const t = DEFAULT_APPT_TYPES.find(x => x.key === apptType(appt))
              return t ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full text-white"
                  style={{ backgroundColor: apptColor(appt) }}>
                  {t.label}
                </span>
              ) : null
            })()}
            {appt.is_walkin && (
              <span className="inline-block text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Walk-in</span>
            )}
            <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${st.cls}`}>
              {st.label}
            </span>
            {visitType && (
              <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${vtStyle[visitType].cls}`}>
                {vtStyle[visitType].label}
              </span>
            )}
            {labOrderId && (
              <span className="inline-block text-xs font-medium px-2.5 py-1 rounded-full border bg-purple-100 text-purple-700 border-purple-200">
                🧪 В лаборатории
              </span>
            )}
          </div>
          {apptDisplayNotes(appt) && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Заметка</p>
              <p className="text-sm text-gray-600">{apptDisplayNotes(appt)}</p>
            </div>
          )}

          {/* ── Services section ──────────────────────────────── */}
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Услуги</p>

            {/* Service search dropdown + lab picker trigger */}
            <div className="flex gap-1.5 mb-2">
            <div ref={svcRef} className="relative flex-1 min-w-0">
              <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition">
                <svg width="12" height="12" fill="none" viewBox="0 0 24 24" className="text-gray-400 flex-shrink-0">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  placeholder="Добавить услугу..."
                  value={svcSearch}
                  onChange={e => { setSvcSearch(e.target.value); setShowSvcDrop(true) }}
                  onFocus={() => setShowSvcDrop(true)}
                  className="flex-1 text-sm outline-none bg-transparent min-w-0"
                />
                {addingSvc && (
                  <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
              </div>
              {showSvcDrop && filteredServices.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  {filteredServices.map(svc => (
                    <button
                      key={svc.id}
                      onMouseDown={() => addService(svc)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-blue-50 transition-colors"
                    >
                      <span className="text-sm text-gray-800 truncate mr-2">{svc.name}</span>
                      <span className="text-xs text-gray-500 flex-shrink-0">{fmtMoney(svc.price)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setLabPickerOpen(true)}
              title="Выбрать из списка анализов"
              className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 text-xs font-medium hover:bg-purple-100 hover:border-purple-300 transition-colors"
            >
              <span className="text-sm leading-none">🧪</span>
              Анализы
            </button>
            </div>

            {/* Selected services list */}
            {visitServices.length > 0 ? (
              <div className="space-y-1.5">
                {visitServices.map(row => (
                  <div key={row.id} className="flex items-center gap-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{row.name}</p>
                      <p className="text-xs text-gray-400">{fmtMoney(row.price_at_booking)} × {row.quantity}</p>
                    </div>
                    <span className="text-xs font-semibold text-gray-700 flex-shrink-0">
                      {fmtMoney(row.quantity * row.price_at_booking)}
                    </span>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => updateQty(row, -1)}
                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                      >
                        <svg width="10" height="2" fill="none" viewBox="0 0 10 2"><path d="M1 1h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                      <span className="text-xs text-gray-700 w-4 text-center font-medium">{row.quantity}</span>
                      <button
                        onClick={() => updateQty(row, 1)}
                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                      >
                        <svg width="10" height="10" fill="none" viewBox="0 0 10 10"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                      <button
                        onClick={() => removeService(row)}
                        className="w-5 h-5 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded ml-0.5 transition-colors"
                      >
                        <svg width="10" height="10" fill="none" viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-between items-center px-2.5 py-1 text-sm font-semibold text-gray-800 border-t border-gray-200 mt-1">
                  <span>Итого</span>
                  <span>{fmtMoney(visitTotals.total_price)}</span>
                </div>
              </div>
            ) : (
              !finLoading && (
                <p className="text-xs text-gray-400 text-center py-1">Услуги не добавлены</p>
              )
            )}
          </div>

          {/* ── Payment section (shown when services added) ────── */}
          {visitServices.length > 0 && (
            <div className="border-t border-gray-100 pt-3 space-y-2.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Оплата</p>

              {/* Summary */}
              <div className="bg-gray-50 rounded-lg px-3 py-2.5 space-y-1.5">
                <div className="flex justify-between text-xs text-gray-600">
                  <span>К оплате</span>
                  <span className="font-medium">{fmtMoney(visitTotals.total_price)}</span>
                </div>
                {visitTotals.total_paid > 0 && (
                  <div className="flex justify-between text-xs text-gray-600">
                    <span>Оплачено</span>
                    <span className="font-medium text-green-600">{fmtMoney(visitTotals.total_paid)}</span>
                  </div>
                )}
                {debt > 0 && (
                  <div className="flex justify-between text-xs border-t border-gray-200 pt-1">
                    <span className="text-gray-500">Остаток</span>
                    <span className="font-semibold text-red-500">{fmtMoney(debt)}</span>
                  </div>
                )}
                <div className="flex justify-end">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${psStyle.cls}`}>
                    {psStyle.label}
                  </span>
                </div>
              </div>

              {/* Payment form */}
              <form onSubmit={addPayment} className="space-y-2">
                <input
                  type="number"
                  min="0"
                  step="100"
                  placeholder={debt > 0 ? `Сумма (долг ${fmtMoney(debt)})` : 'Сумма оплаты'}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                />
                <div className="flex flex-wrap gap-1">
                  {PAY_METHOD_OPTIONS.map(m => (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => setPayMethodCode(m.code)}
                      className={[
                        'text-xs px-2.5 py-1 rounded-lg border transition-colors',
                        payMethodCode === m.code
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600',
                      ].join(' ')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {([
                    { value: 'payment',    label: 'Оплата' },
                    { value: 'prepayment', label: 'Предоплата' },
                  ] as const).map(t => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setPayType(t.value)}
                      className={[
                        'flex-1 text-xs px-2 py-1.5 rounded-lg border transition-colors',
                        payType === t.value
                          ? 'bg-gray-800 border-gray-800 text-white'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                      ].join(' ')}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={savingPay || !payAmount}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors"
                >
                  {savingPay ? 'Сохранение...' : 'Принять оплату'}
                </button>
              </form>
            </div>
          )}

          {/* ── Payment history (editable) ───────────────────── */}
          {visitPayments.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">История оплат</p>
              <div className="space-y-1">
                {visitPayments.map(p => (
                  <div key={p.id}
                    className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-gray-50 transition-colors">
                    <div className="text-xs text-gray-500 flex-1 min-w-0">
                      {new Date(p.paid_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                      {' '}
                      {new Date(p.paid_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      <span className="mx-1 text-gray-300">·</span>
                      {METHOD_LABELS[p.method] ?? p.method}
                      {p.type === 'prepayment' && (
                        <span className="ml-1 text-[10px] text-gray-400">(предоплата)</span>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-gray-800 mr-2">{fmtMoney(Number(p.amount))}</span>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => startEditPayment(p)}
                        title="Редактировать оплату"
                        className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 border border-blue-100 rounded-md"
                      >
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => deletePayment(p)}
                        title="Удалить оплату"
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 border border-red-100 rounded-md"
                      >
                        <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Open visit / Lab transfer ───────────────────────── */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 space-y-2">
          {hasLab && !labOrderId && (
            <>
              <button
                onClick={transferToLab}
                disabled={transferringLab || visitId === 'loading' || debt > 0}
                title={debt > 0 ? `Сначала примите оплату (остаток ${fmtMoney(debt)})` : undefined}
                className="w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
              >
                <span className="text-base leading-none">🧪</span>
                {transferringLab
                  ? 'Передача...'
                  : debt > 0
                    ? `Оплатите, чтобы передать (${fmtMoney(debt)})`
                    : 'Передать в лабораторию'}
              </button>
              {patDemo && (
                <button
                  onClick={() => setNuanceOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg py-1.5 text-[11px] font-medium transition-colors"
                >
                  🧪 Нюансы для лаборатории
                  {(patDemo.pregnancy_status === 'yes' || patDemo.lab_notes) && (
                    <span className="text-[10px] text-amber-500">(заполнено)</span>
                  )}
                </button>
              )}
            </>
          )}
          {hasLab && labOrderId && (
            <button
              onClick={() => router.push(`/lab/${labOrderId}`)}
              className="w-full flex items-center justify-center gap-2 border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg py-2 text-sm font-medium transition-colors"
            >
              <span className="text-base leading-none">🧪</span>
              Открыть заказ в лаборатории
            </button>
          )}
          {visitType !== 'lab' && (
            <button
              onClick={handleOpenVisit}
              disabled={openingVisit || visitId === 'loading'}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              <svg width="15" height="15" fill="none" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {openingVisit ? 'Открытие...' : 'Открыть приём'}
            </button>
          )}
          {hasUnpaid && (
            <p className="text-xs text-amber-600 text-center">
              ⚠ Есть неоплаченные услуги
            </p>
          )}
        </div>

        {/* ── Reschedule / Duplicate ───────────────────────────── */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex gap-2">
          <button onClick={() => setRescheduleMode('move')}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-300 hover:text-orange-600 rounded-lg py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1-4l-3 3m0 0l-3-3m3 3V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Перенести
          </button>
          <button onClick={() => setRescheduleMode('copy')}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 rounded-lg py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Дублировать
          </button>
        </div>

        {/* ── Status transitions ───────────────────────────────── */}
        {nextActions.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
            {nextActions.map(a => (
              <button
                key={a.status}
                onClick={() => updateStatus(a.status)}
                disabled={saving}
                className={`w-full ${a.cls} disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {rescheduleMode && (
        <RescheduleModal
          appt={appt}
          clinicId={clinicId}
          mode={rescheduleMode}
          onClose={() => setRescheduleMode(null)}
          onDone={() => { setRescheduleMode(null); onUpdate(); onClose() }}
        />
      )}
      {editOpen && <EditAppointmentModal appt={appt} clinicId={clinicId} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); onUpdate(); onClose() }}/>}
      {editingPayId && (() => {
        const p = visitPayments.find(x => x.id === editingPayId)
        if (!p) return null
        const isBusy = busyPayId === p.id
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => !isBusy && cancelEditPayment()} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden">
              <div className="px-5 py-4 border-b border-blue-100 bg-blue-50 flex items-center gap-2">
                <span className="text-lg">💳</span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Редактировать оплату</h3>
                  <p className="text-[11px] text-blue-700 mt-0.5">
                    {new Date(p.paid_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                  </p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Сумма (₸)</label>
                  <input
                    type="number" min={0} step="0.01" autoFocus
                    value={editPayAmount}
                    onChange={e => setEditPayAmount(e.target.value)}
                    placeholder="Введите сумму"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Способ оплаты</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PAY_METHOD_OPTIONS.map(m => (
                      <button
                        key={m.code}
                        type="button"
                        onClick={() => setEditPayMethod(m.code)}
                        className={[
                          'text-sm px-3 py-2 rounded-lg border transition-colors',
                          editPayMethod === m.code
                            ? 'bg-blue-600 border-blue-600 text-white font-medium'
                            : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600',
                        ].join(' ')}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="text-[11px] text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
                  💡 После сохранения автоматически пересчитается остаток визита
                </div>
              </div>
              <div className="px-5 pb-5 flex gap-3">
                <button
                  onClick={() => deletePayment(p)}
                  disabled={isBusy}
                  title="Удалить эту оплату"
                  className="px-3 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-lg py-2.5 text-sm font-medium transition-colors flex items-center gap-1.5"
                >
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                  Удалить
                </button>
                <button
                  onClick={cancelEditPayment}
                  disabled={isBusy}
                  className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  Отмена
                </button>
                <button
                  onClick={() => saveEditPayment(p)}
                  disabled={isBusy || !editPayAmount || parseFloat(editPayAmount) <= 0}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  {isBusy ? 'Сохранение…' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
      {labPickerOpen && (
        <LabServicesPicker
          allServices={allServices}
          visitServices={visitServices}
          packages={packages}
          onClose={() => setLabPickerOpen(false)}
          onAccept={async selections => {
            await bulkAddServices(selections)
            setLabPickerOpen(false)
            // After adding lab analyses, prompt for demographic nuances
            // that will drive reference-range selection downstream.
            const anyLab = selections.some(s => s.svc.is_lab)
            if (anyLab && patDemo) setNuanceOpen(true)
          }}
        />
      )}
      {cardOpen && patient?.id && (
        <PatientCardModal
          patientId={patient.id}
          onClose={() => setCardOpen(false)}
        />
      )}
      {nuanceOpen && patDemo && (
        <LabNuancesModal
          gender={patDemo.gender}
          preg={labPreg} setPreg={setLabPreg}
          pregWeeks={labPregWeeks} setPregWeeks={setLabPregWeeks}
          meno={labMeno} setMeno={setLabMeno}
          notes={labNotesDraft} setNotes={setLabNotesDraft}
          fasting={labFasting} setFasting={setLabFasting}
          meds={labMeds} setMeds={setLabMeds}
          medsNote={labMedsNote} setMedsNote={setLabMedsNote}
          cycleDay={labCycleDay} setCycleDay={setLabCycleDay}
          onClose={() => setNuanceOpen(false)}
          onSave={async () => {
            if (!appt.patient_id) { setNuanceOpen(false); return }
            const pregWeeksNum = labPreg === 'yes' && labPregWeeks.trim()
              ? Math.max(1, Math.min(42, parseInt(labPregWeeks, 10) || 0)) || null
              : null
            const cycleDayNum = patDemo.gender === 'female' && labPreg !== 'yes' && labCycleDay.trim()
              ? Math.max(1, Math.min(60, parseInt(labCycleDay, 10) || 0)) || null
              : null
            const medsNoteClean = labMeds === 'yes' ? (labMedsNote.trim() || null) : null
            const patientUpdate: Record<string, unknown> = {
              pregnancy_status:   labPreg,
              pregnancy_weeks:    pregWeeksNum,
              lab_notes:          labNotesDraft.trim() || null,
              fasting_status:     labFasting,
              taking_medications: labMeds,
              medications_note:   medsNoteClean,
              cycle_day:          cycleDayNum,
            }
            if (patDemo.gender === 'female') {
              patientUpdate.menopause_status = labPreg !== 'yes' ? (labMeno || null) : null
            }
            await supabase.from('patients').update(patientUpdate).eq('id', appt.patient_id)
            // Refresh local patDemo so transferToLab uses fresh values
            setPatDemo(prev => prev ? {
              ...prev,
              pregnancy_status:   labPreg,
              pregnancy_weeks:    pregWeeksNum,
              menopause_status:   patDemo.gender === 'female' && labPreg !== 'yes' ? (labMeno || null) : null,
              lab_notes:          labNotesDraft.trim() || null,
              fasting_status:     labFasting,
              taking_medications: labMeds,
              medications_note:   medsNoteClean,
              cycle_day:          cycleDayNum,
            } : prev)
            setNuanceOpen(false)
          }}
        />
      )}
    </>
  )
}

// ─── LabServicesPicker ────────────────────────────────────────────────────────
// Modal for bulk-picking lab services (grouped by category, searchable,
// multi-select with qty editor). Returns { svc, qty }[] via onAccept.
function LabServicesPicker({
  allServices, visitServices, packages, onClose, onAccept,
}: {
  allServices: ServiceCatalogRow[]
  visitServices: VisitServiceRow[]
  packages: ServicePackageRow[]
  onClose: () => void
  onAccept: (selections: Array<{ svc: ServiceCatalogRow; qty: number }>) => void | Promise<void>
}) {
  const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
  // Show: all lab services + any services referenced by an active package
  // (so packages like "Чекап" that contain non-lab services, e.g. consultations,
  // can display those items too — without cluttering the picker with everything).
  const labServices = useMemo(() => {
    const pkgServiceIds = new Set(packages.flatMap(p => p.service_ids))
    return allServices.filter(s => s.is_lab || pkgServiceIds.has(s.id))
  }, [allServices, packages])

  // Initial qty map from already-in-visit rows (only for services visible here)
  const initialQty: Record<string, number> = useMemo(() => {
    const m: Record<string, number> = {}
    const visibleIds = new Set(labServices.map(s => s.id))
    for (const row of visitServices) {
      if (row.service_id && visibleIds.has(row.service_id)) {
        m[row.service_id] = row.quantity
      }
    }
    return m
  }, [visitServices, labServices])

  const [qty, setQty] = useState<Record<string, number>>(initialQty)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string>('__all__')
  const [saving, setSaving] = useState(false)

  // Group by category
  const { categories, byCategory } = useMemo(() => {
    const map = new Map<string, ServiceCatalogRow[]>()
    for (const s of labServices) {
      const cat = (s.category || '').trim() || 'Без категории'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(s)
    }
    const cats = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'ru'))
    return { categories: cats, byCategory: map }
  }, [labServices])

  // Visible rows after search + category filter
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows: ServiceCatalogRow[] = []
    if (activeCat === '__all__' || q) {
      rows = labServices
    } else {
      rows = byCategory.get(activeCat) ?? []
    }
    if (q) rows = rows.filter(s => s.name.toLowerCase().includes(q))
    return rows
  }, [labServices, byCategory, activeCat, search])

  // When searching globally, group visible rows by category for readability
  const visibleGrouped = useMemo(() => {
    const map = new Map<string, ServiceCatalogRow[]>()
    for (const s of visibleRows) {
      const cat = (s.category || '').trim() || 'Без категории'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(s)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, 'ru'))
  }, [visibleRows])

  const setOne = (id: string, value: number) => {
    setQty(prev => {
      const next = { ...prev }
      if (value <= 0) delete next[id]
      else next[id] = value
      return next
    })
  }
  const toggle = (s: ServiceCatalogRow) => {
    setOne(s.id, qty[s.id] ? 0 : 1)
  }

  // Packages: map of service ids that exist in catalog (by package)
  const labServiceIds = useMemo(() => new Set(labServices.map(s => s.id)), [labServices])
  const packagesWithItems = useMemo(
    () => packages
      .map(p => ({
        ...p,
        // keep only service_ids that exist among our lab services
        service_ids: p.service_ids.filter(id => labServiceIds.has(id)),
      }))
      .filter(p => p.service_ids.length > 0),
    [packages, labServiceIds],
  )

  // Is a package fully selected (all its items have qty>=1)
  const isPackageSelected = (pkg: ServicePackageRow) =>
    pkg.service_ids.length > 0 && pkg.service_ids.every(id => (qty[id] ?? 0) > 0)

  // Package price = sum of its items (at catalog price)
  const packagePrice = (pkg: ServicePackageRow) => {
    let sum = 0
    for (const id of pkg.service_ids) {
      const s = labServices.find(x => x.id === id)
      if (s) sum += s.price
    }
    return sum
  }

  // Click package: if fully selected — unselect all its items;
  // otherwise — set qty=1 on all missing items (don't touch others already picked).
  const togglePackage = (pkg: ServicePackageRow) => {
    setQty(prev => {
      const next = { ...prev }
      const allOn = pkg.service_ids.every(id => (next[id] ?? 0) > 0)
      if (allOn) {
        for (const id of pkg.service_ids) delete next[id]
      } else {
        for (const id of pkg.service_ids) {
          if (!next[id] || next[id] <= 0) next[id] = 1
        }
      }
      return next
    })
  }

  const selections = useMemo(() => {
    const out: Array<{ svc: ServiceCatalogRow; qty: number }> = []
    for (const s of labServices) {
      const q = qty[s.id]
      if (q && q > 0) out.push({ svc: s, qty: q })
    }
    return out
  }, [labServices, qty])

  const total = selections.reduce((a, x) => a + x.svc.price * x.qty, 0)
  const hasChanges = (() => {
    const initKeys = Object.keys(initialQty)
    const curKeys = Object.keys(qty)
    if (initKeys.length !== curKeys.length) return true
    for (const k of curKeys) if (initialQty[k] !== qty[k]) return true
    return false
  })()

  const handleAccept = async () => {
    if (saving) return
    setSaving(true)
    try {
      // Send ALL selections (including unchanged) so backend merges correctly;
      // bulkAddServices de-dups by service_id.
      await onAccept(selections)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[85vh] flex flex-col z-10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">🧪</span>
            <h3 className="text-base font-semibold text-gray-900">Анализы и пакеты</h3>
            <span className="text-xs text-gray-400">· {labServices.length} в каталоге</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="relative">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию анализа…"
              className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              autoFocus
            />
          </div>
        </div>

        {/* Body: sidebar + list */}
        <div className="flex-1 flex min-h-0">
          {/* Category sidebar */}
          <aside className="w-56 flex-shrink-0 border-r border-gray-100 overflow-y-auto py-2 bg-gray-50/50">
            {/* Packages section */}
            {packagesWithItems.length > 0 && (
              <>
                <div className="px-4 pt-1 pb-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Пакеты
                  </p>
                </div>
                {packagesWithItems.map(pkg => {
                  const sel = isPackageSelected(pkg)
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => togglePackage(pkg)}
                      title={`${pkg.service_ids.length} анализов · ${fmtMoney(packagePrice(pkg))}`}
                      className={[
                        'w-full text-left px-4 py-1.5 text-sm flex items-center justify-between transition-colors group',
                        sel
                          ? 'bg-purple-100 text-purple-800'
                          : 'text-gray-700 hover:bg-gray-100',
                      ].join(' ')}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={[
                          'w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0',
                          sel ? 'bg-purple-600 border-purple-600' : 'border-gray-300 bg-white',
                        ].join(' ')}>
                          {sel && (
                            <svg width="8" height="8" fill="none" viewBox="0 0 10 10">
                              <path d="M1.5 5l2 2 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </span>
                        <span className="truncate">{pkg.name}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 ml-1">
                        {pkg.service_ids.length}
                      </span>
                    </button>
                  )
                })}
                <div className="my-2 border-t border-gray-200 mx-4" />
                <div className="px-4 pb-1.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Категории
                  </p>
                </div>
              </>
            )}
            <button
              onClick={() => setActiveCat('__all__')}
              className={[
                'w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors',
                activeCat === '__all__' && !search
                  ? 'bg-purple-100 text-purple-800 font-medium'
                  : 'text-gray-600 hover:bg-gray-100',
              ].join(' ')}
            >
              <span>Все</span>
              <span className="text-xs text-gray-400">{labServices.length}</span>
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => { setActiveCat(cat); setSearch('') }}
                className={[
                  'w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors',
                  activeCat === cat && !search
                    ? 'bg-purple-100 text-purple-800 font-medium'
                    : 'text-gray-600 hover:bg-gray-100',
                ].join(' ')}
              >
                <span className="truncate mr-2">{cat}</span>
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {byCategory.get(cat)?.length ?? 0}
                </span>
              </button>
            ))}
          </aside>

          {/* Results list */}
          <div className="flex-1 overflow-y-auto">
            {visibleRows.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-400">
                {search ? 'Ничего не найдено' : 'В этой категории нет услуг'}
              </div>
            ) : (
              visibleGrouped.map(([cat, rows]) => (
                <div key={cat}>
                  <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 sticky top-0 z-0">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {cat}
                    </span>
                  </div>
                  {rows.map(s => {
                    const selected = (qty[s.id] ?? 0) > 0
                    const q = qty[s.id] ?? 0
                    return (
                      <div
                        key={s.id}
                        onClick={() => toggle(s)}
                        className={[
                          'flex items-center gap-3 px-4 py-2.5 border-b border-gray-50 cursor-pointer transition-colors',
                          selected ? 'bg-purple-50/50' : 'hover:bg-gray-50',
                        ].join(' ')}
                      >
                        {/* Checkbox */}
                        <div
                          className={[
                            'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors',
                            selected ? 'bg-purple-600 border-purple-600' : 'border-gray-300 bg-white',
                          ].join(' ')}
                        >
                          {selected && (
                            <svg width="10" height="10" fill="none" viewBox="0 0 10 10">
                              <path d="M1.5 5l2 2 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 truncate">{s.name}</p>
                        </div>

                        {/* Price */}
                        <span className="text-sm font-medium text-gray-700 flex-shrink-0 tabular-nums">
                          {fmtMoney(s.price)}
                        </span>

                        {/* Qty stepper (only when selected) */}
                        {selected && (
                          <div
                            onClick={e => e.stopPropagation()}
                            className="flex items-center gap-1 flex-shrink-0 bg-white border border-purple-200 rounded-md px-1"
                          >
                            <button
                              type="button"
                              onClick={() => setOne(s.id, Math.max(0, q - 1))}
                              className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-800"
                            >
                              <svg width="10" height="2" fill="none" viewBox="0 0 10 2">
                                <path d="M1 1h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            </button>
                            <span className="text-xs font-medium w-4 text-center tabular-nums">{q}</span>
                            <button
                              type="button"
                              onClick={() => setOne(s.id, q + 1)}
                              className="w-5 h-5 flex items-center justify-center text-gray-500 hover:text-gray-800"
                            >
                              <svg width="10" height="10" fill="none" viewBox="0 0 10 10">
                                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-3 flex-shrink-0 bg-gray-50/50">
          <div className="flex-1 flex items-baseline gap-2">
            {selections.length > 0 ? (
              <>
                <span className="text-xs text-gray-500">Выбрано:</span>
                <span className="text-sm font-semibold text-gray-900">
                  {selections.length}
                </span>
                <span className="text-xs text-gray-400">·</span>
                <span className="text-xs text-gray-500">Сумма:</span>
                <span className="text-base font-semibold text-purple-700">
                  {fmtMoney(total)}
                </span>
              </>
            ) : (
              <span className="text-xs text-gray-400">Отметьте нужные анализы</span>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleAccept}
            disabled={saving || !hasChanges}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? 'Сохранение…' : selections.length > 0 ? `Добавить (${selections.length})` : 'Готово'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── LabNuancesModal ──────────────────────────────────────────────────────────
// Post-picker modal: captures physiological state (pregnancy/menopause/lab notes)
// that drives reference-range selection for the lab order. Values are persisted
// to the patient record and become the source of truth for the snapshot on
// "Передать в лабораторию".
function LabNuancesModal({
  gender, preg, setPreg, pregWeeks, setPregWeeks, meno, setMeno,
  notes, setNotes,
  fasting, setFasting, meds, setMeds, medsNote, setMedsNote,
  cycleDay, setCycleDay,
  onClose, onSave,
}: {
  gender: 'male' | 'female' | 'other' | null
  preg: 'yes' | 'no' | 'unknown'; setPreg: (v: 'yes' | 'no' | 'unknown') => void
  pregWeeks: string; setPregWeeks: (v: string) => void
  meno: 'no' | 'peri' | 'post' | 'unknown' | ''
  setMeno: (v: 'no' | 'peri' | 'post' | 'unknown' | '') => void
  notes: string; setNotes: (v: string) => void
  fasting: 'yes' | 'no' | 'unknown'; setFasting: (v: 'yes' | 'no' | 'unknown') => void
  meds: 'yes' | 'no' | 'unknown'; setMeds: (v: 'yes' | 'no' | 'unknown') => void
  medsNote: string; setMedsNote: (v: string) => void
  cycleDay: string; setCycleDay: (v: string) => void
  onClose: () => void
  onSave: () => void | Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try { await onSave() } finally { setSaving(false) }
  }
  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition'
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10 overflow-hidden max-h-[calc(100vh-40px)] flex flex-col">
        <div className="px-5 py-4 border-b border-amber-100 bg-amber-50 flex items-center gap-2 flex-shrink-0">
          <span className="text-lg">🧪</span>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Нюансы для лаборатории</h3>
            <p className="text-[11px] text-amber-700 mt-0.5">Влияют на подбор референсных значений</p>
          </div>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Fasting — universal */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Натощак?</label>
            <div className="grid grid-cols-3 gap-2">
              {([['yes', 'Да'], ['no', 'Нет'], ['unknown', '—']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setFasting(k)}
                  className={`py-2 rounded-lg border text-sm ${fasting === k ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Medications — universal */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Принимает лекарства?</label>
            <div className="grid grid-cols-3 gap-2">
              {([['yes', 'Да'], ['no', 'Нет'], ['unknown', '—']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setMeds(k)}
                  className={`py-2 rounded-lg border text-sm ${meds === k ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {l}
                </button>
              ))}
            </div>
            {meds === 'yes' && (
              <input className={inp + ' mt-2'} value={medsNote}
                onChange={e => setMedsNote(e.target.value)}
                placeholder="например: L-тироксин 50 мкг, метформин…" />
            )}
          </div>

          {/* Female-only: pregnancy, menopause, cycle day */}
          {gender === 'female' ? (
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Беременность</label>
                  <select className={inp} value={preg}
                    onChange={e => setPreg(e.target.value as 'yes' | 'no' | 'unknown')}>
                    <option value="unknown">Не уточнено</option>
                    <option value="no">Нет</option>
                    <option value="yes">🤰 Да</option>
                  </select>
                </div>
                {preg === 'yes' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Срок (нед.)</label>
                    <input type="number" min={1} max={42} className={inp}
                      value={pregWeeks} onChange={e => setPregWeeks(e.target.value)}
                      placeholder="24" />
                  </div>
                )}
              </div>
              {preg !== 'yes' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Менопауза</label>
                    <select className={inp} value={meno}
                      onChange={e => setMeno(e.target.value as 'no' | 'peri' | 'post' | 'unknown' | '')}>
                      <option value="">— не указано —</option>
                      <option value="unknown">Не знаю</option>
                      <option value="no">Нет</option>
                      <option value="peri">Пре-/перименопауза</option>
                      <option value="post">Постменопауза</option>
                    </select>
                  </div>
                  {(meno === 'no' || meno === '' || meno === 'unknown') && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        День менструального цикла <span className="text-gray-400 font-normal">(необязательно, 1–60)</span>
                      </label>
                      <input type="number" min={1} max={60} className={inp}
                        value={cycleDay} onChange={e => setCycleDay(e.target.value)}
                        placeholder="например, 3 или 21" />
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              Пол: {gender === 'male' ? '♂ мужской' : 'не указан'} — поля беременности/менопаузы/цикла не применимы.
            </p>
          )}

          <div className="border-t border-gray-100 pt-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Прочие заметки <span className="text-gray-400 font-normal">(хроника, аллергии)</span>
            </label>
            <textarea rows={2} className={inp + ' resize-none'}
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="например: диабет 2 типа, аллергия на латекс…" />
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
            Пропустить
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PatientCardModal ─────────────────────────────────────────────────────────
// Lightweight patient info panel — opens as overlay on top of schedule drawer.
// No navigation; shows key demographic/financial/lab fields in-place.

type PatientCardData = {
  id: string
  full_name: string
  phones: string[] | null
  iin: string | null
  gender: 'male' | 'female' | 'other' | null
  birth_date: string | null
  city: string | null
  email: string | null
  patient_number: string | null
  status: string | null
  is_vip: boolean | null
  balance_amount: number | null
  debt_amount: number | null
  tags: string[] | null
  notes: string | null
  pregnancy_status: 'yes' | 'no' | 'unknown' | null
  pregnancy_weeks: number | null
  menopause_status: 'no' | 'peri' | 'post' | 'unknown' | null
  lab_notes: string | null
  fasting_status: 'yes' | 'no' | 'unknown' | null
  taking_medications: 'yes' | 'no' | 'unknown' | null
  medications_note: string | null
  cycle_day: number | null
  created_at: string | null
}

const PATIENT_STATUS_LABEL: Record<string, string> = {
  new: 'Новый', active: 'Активный', in_treatment: 'На лечении',
  completed: 'Завершён', lost: 'Потерян', vip: 'VIP',
}

function PatientCardModal({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [p, setP] = useState<PatientCardData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Editable form state (initialised from p after fetch)
  const [fullName, setFullName] = useState('')
  const [phonesStr, setPhonesStr] = useState('')
  const [iin, setIin] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('')
  const [birthDate, setBirthDate] = useState('')
  const [city, setCity] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('')
  const [isVip, setIsVip] = useState(false)
  const [tagsStr, setTagsStr] = useState('')
  const [notes, setNotes] = useState('')
  const [preg, setPreg] = useState<'yes' | 'no' | 'unknown' | ''>('')
  const [pregWeeks, setPregWeeks] = useState('')
  const [meno, setMeno] = useState<'no' | 'peri' | 'post' | 'unknown' | ''>('')
  const [labNotes, setLabNotes] = useState('')
  const [fasting, setFasting] = useState<'yes' | 'no' | 'unknown' | ''>('')
  const [meds, setMeds] = useState<'yes' | 'no' | 'unknown' | ''>('')
  const [medsNote, setMedsNote] = useState('')
  const [cycleDay, setCycleDay] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    supabase
      .from('patients')
      .select('id, full_name, phones, iin, gender, birth_date, city, email, patient_number, status, is_vip, balance_amount, debt_amount, tags, notes, pregnancy_status, pregnancy_weeks, menopause_status, lab_notes, fasting_status, taking_medications, medications_note, cycle_day, created_at')
      .eq('id', patientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { setErr(error.message); setLoading(false); return }
        const d = data as PatientCardData | null
        setP(d)
        if (d) {
          setFullName(d.full_name ?? '')
          setPhonesStr((d.phones ?? []).join(', '))
          setIin(d.iin ?? '')
          setGender((d.gender as 'male' | 'female' | 'other' | null) ?? '')
          setBirthDate(d.birth_date ?? '')
          setCity(d.city ?? '')
          setEmail(d.email ?? '')
          setStatus(d.status ?? '')
          setIsVip(!!d.is_vip)
          setTagsStr((d.tags ?? []).join(', '))
          setNotes(d.notes ?? '')
          setPreg((d.pregnancy_status as 'yes' | 'no' | 'unknown' | null) ?? '')
          setPregWeeks(d.pregnancy_weeks != null ? String(d.pregnancy_weeks) : '')
          setMeno((d.menopause_status as 'no' | 'peri' | 'post' | 'unknown' | null) ?? '')
          setLabNotes(d.lab_notes ?? '')
          setFasting((d.fasting_status as 'yes' | 'no' | 'unknown' | null) ?? '')
          setMeds((d.taking_medications as 'yes' | 'no' | 'unknown' | null) ?? '')
          setMedsNote(d.medications_note ?? '')
          setCycleDay(d.cycle_day != null ? String(d.cycle_day) : '')
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [patientId, supabase])

  const age = birthDate
    ? Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))
    : null

  async function save() {
    if (!fullName.trim()) { alert('ФИО обязательно'); return }
    setSaving(true)
    const phones = phonesStr.split(',').map(s => s.trim()).filter(Boolean)
    const tags = tagsStr.split(',').map(s => s.trim()).filter(Boolean)
    const pregWeeksNum = preg === 'yes' && pregWeeks.trim()
      ? Math.max(1, Math.min(42, parseInt(pregWeeks, 10) || 0)) || null
      : null
    const cycleDayNum = gender === 'female' && preg !== 'yes' && cycleDay.trim()
      ? Math.max(1, Math.min(60, parseInt(cycleDay, 10) || 0)) || null
      : null
    const patch: Record<string, unknown> = {
      full_name:          fullName.trim(),
      phones,
      iin:                iin.trim() || null,
      gender:             gender || null,
      birth_date:         birthDate || null,
      city:               city.trim() || null,
      email:              email.trim() || null,
      status:             status || 'new',
      is_vip:             isVip,
      tags,
      notes:              notes.trim() || null,
      pregnancy_status:   preg || 'unknown',
      pregnancy_weeks:    pregWeeksNum,
      menopause_status:   gender === 'female' && preg !== 'yes' ? (meno || null) : null,
      lab_notes:          labNotes.trim() || null,
      fasting_status:     fasting || null,
      taking_medications: meds || null,
      medications_note:   meds === 'yes' ? (medsNote.trim() || null) : null,
      cycle_day:          cycleDayNum,
    }
    const { error } = await supabase.from('patients').update(patch).eq('id', patientId)
    setSaving(false)
    if (error) { alert('Ошибка сохранения: ' + error.message); return }
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(720px,calc(100vw-24px))] max-h-[calc(100vh-40px)] bg-white rounded-2xl shadow-2xl z-[61] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-base font-semibold text-gray-900">
              Карта пациента
              {isVip && <span className="ml-2 text-xs font-bold text-yellow-600">VIP</span>}
            </p>
            {p?.patient_number && <p className="text-xs text-gray-400 mt-0.5">№ {p.patient_number}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" title="Закрыть">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm space-y-4">
          {loading && <p className="text-gray-400">Загрузка…</p>}
          {err && <p className="text-red-600">Ошибка: {err}</p>}
          {!loading && p && (
            <>
              {/* ФИО + VIP */}
              <Field label="ФИО">
                <input value={fullName} onChange={e => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Статус">
                  <select value={status} onChange={e => setStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none">
                    {Object.entries(PATIENT_STATUS_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </Field>
                <Field label="VIP">
                  <label className="flex items-center gap-2 py-2">
                    <input type="checkbox" checked={isVip} onChange={e => setIsVip(e.target.checked)}
                      className="w-4 h-4 accent-yellow-500" />
                    <span className="text-sm text-gray-700">Отметить как VIP</span>
                  </label>
                </Field>
              </div>

              {/* Demographics */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">ДЕМОГРАФИЯ</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Пол">
                    <select value={gender} onChange={e => setGender(e.target.value as typeof gender)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none">
                      <option value="">—</option>
                      <option value="male">Мужской</option>
                      <option value="female">Женский</option>
                      <option value="other">Другой</option>
                    </select>
                  </Field>
                  <Field label={`Дата рождения${age != null ? ` · ${age} лет` : ''}`}>
                    <input type="date" value={birthDate} onChange={e => setBirthDate(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                  <Field label="ИИН">
                    <input value={iin} onChange={e => setIin(e.target.value)} maxLength={12}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                  <Field label="Город">
                    <input value={city} onChange={e => setCity(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                  <Field label="Телефоны (через запятую)">
                    <input value={phonesStr} onChange={e => setPhonesStr(e.target.value)}
                      placeholder="+7701…, +7702…"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                  <Field label="Email">
                    <input value={email} onChange={e => setEmail(e.target.value)} type="email"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                </div>
              </div>

              {/* Lab nuances */}
              <div className="border-t border-gray-100 pt-3 space-y-3">
                <p className="text-xs font-semibold text-gray-500">ЛАБОРАТОРНЫЕ НЮАНСЫ</p>

                {/* Fasting + meds (universal) */}
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Натощак?">
                    <div className="flex gap-1">
                      {([['yes', 'Да'], ['no', 'Нет'], ['unknown', '—'], ['', '']] as const).filter(([k]) => k !== '').map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setFasting(k as 'yes' | 'no' | 'unknown')}
                          className={`flex-1 py-1.5 rounded-lg border text-xs ${fasting === k ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Принимает лекарства?">
                    <div className="flex gap-1">
                      {([['yes', 'Да'], ['no', 'Нет'], ['unknown', '—']] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setMeds(k)}
                          className={`flex-1 py-1.5 rounded-lg border text-xs ${meds === k ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
                {meds === 'yes' && (
                  <Field label="Какие лекарства">
                    <input value={medsNote} onChange={e => setMedsNote(e.target.value)}
                      placeholder="L-тироксин 50 мкг, метформин…"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                )}

                {/* Female-only */}
                {gender === 'female' ? (
                  <div className="space-y-3 border-t border-gray-100 pt-3">
                    <Field label="Беременность">
                      <div className="flex gap-2">
                        {([['yes', 'Да'], ['no', 'Нет'], ['unknown', 'Неизвестно']] as const).map(([k, l]) => (
                          <button key={k} type="button" onClick={() => setPreg(k)}
                            className={`flex-1 py-2 rounded-lg border text-sm ${preg === k ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                    </Field>
                    {preg === 'yes' && (
                      <Field label="Срок (недели, 1–42)">
                        <input value={pregWeeks} onChange={e => setPregWeeks(e.target.value)}
                          type="number" min={1} max={42}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                      </Field>
                    )}
                    {preg !== 'yes' && (
                      <>
                        <Field label="Менопауза">
                          <div className="flex gap-2">
                            {([['', '—'], ['no', 'Нет'], ['peri', 'Пери'], ['post', 'Пост']] as const).map(([k, l]) => (
                              <button key={k || 'none'} type="button" onClick={() => setMeno(k)}
                                className={`flex-1 py-2 rounded-lg border text-sm ${meno === k ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </Field>
                        {(meno === 'no' || meno === '' || meno === 'unknown') && (
                          <Field label="День менструального цикла (1–60, необязательно)">
                            <input value={cycleDay} onChange={e => setCycleDay(e.target.value)}
                              type="number" min={1} max={60}
                              placeholder="например, 3 или 21"
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                          </Field>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">Беременность, менопауза и день цикла — только для женского пола.</p>
                )}

                <div>
                  <Field label="Прочие заметки (аллергии, хроника и т.п.)">
                    <textarea value={labNotes} onChange={e => setLabNotes(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                  </Field>
                </div>
              </div>

              {/* Tags + notes */}
              <div className="border-t border-gray-100 pt-3 space-y-3">
                <Field label="Теги (через запятую)">
                  <input value={tagsStr} onChange={e => setTagsStr(e.target.value)}
                    placeholder="vip, сложный случай, постоянный"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                </Field>
                <Field label="Общие заметки">
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none" />
                </Field>
              </div>

              {/* Finance (read-only) */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-semibold text-gray-500 mb-2">ФИНАНСЫ <span className="font-normal text-gray-400">(считается автоматически)</span></p>
                <div className="grid grid-cols-3 gap-3">
                  <InfoBlock label="Баланс" value={`${(p.balance_amount ?? 0).toLocaleString('ru-RU')} ₸`}
                    tone={(p.balance_amount ?? 0) > 0 ? 'green' : 'gray'} />
                  <InfoBlock label="Долг" value={`${(p.debt_amount ?? 0).toLocaleString('ru-RU')} ₸`}
                    tone={(p.debt_amount ?? 0) > 0 ? 'red' : 'gray'} />
                  <InfoBlock label="Создан" value={p.created_at ? new Date(p.created_at).toLocaleDateString('ru-RU') : '—'} tone="gray" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex-shrink-0 flex justify-between items-center gap-2">
          <a
            href={`/patients/${patientId}`}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 px-3 py-2 rounded-lg hover:bg-blue-50"
          >
            Полная карточка →
          </a>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-sm font-medium text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 disabled:opacity-40"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg disabled:opacity-40"
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      {children}
    </div>
  )
}

function InfoBlock({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' | 'gray' }) {
  const cls = tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-700' : 'text-gray-800'
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm font-medium ${cls}`}>{value}</p>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [span, setSpan] = useState<1 | 5 | 7>(1)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [view, setView] = useState<'list' | 'grid'>('list')
  const [pendingSlot, setPendingSlot] = useState<{ doctorId: string; time: string } | null>(null)

  // Sidebar state
  const [doctors, setDoctors] = useState<DoctorRow[]>([])
  const [activeDoctors, setActiveDoctors] = useState<Set<string>>(new Set())
  const [birthdays, setBirthdays] = useState<{ id: string; full_name: string }[]>([])
  const searchWrapRef = useRef<HTMLDivElement>(null)

  const dates = getDatesForSpan(date, span)

  // Load doctors once
  useEffect(() => {
    supabase.from('doctors')
      .select('id,first_name,last_name,color,consultation_duration')
      .eq('is_active', true).order('last_name')
      .then(({ data }) => {
        const list = (data ?? []) as DoctorRow[]
        setDoctors(list)
        setActiveDoctors(new Set(list.map(d => d.id)))
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load birthdays when date changes
  useEffect(() => {
    if (!date) return
    const d = new Date(date + 'T12:00:00')
    const month = d.getMonth() + 1
    const day = d.getDate()
    supabase.from('patients')
      .select('id, full_name, birth_date')
      .not('birth_date', 'is', null)
      .is('deleted_at', null)
      .then(({ data }) => {
        const bdays = (data ?? []).filter((p: { birth_date: string | null; id: string; full_name: string }) => {
          if (!p.birth_date) return false
          const bd = new Date(p.birth_date + 'T12:00:00')
          return bd.getMonth() + 1 === month && bd.getDate() === day
        })
        setBirthdays(bdays as { id: string; full_name: string }[])
      })
  }, [date]) // eslint-disable-line react-hooks/exhaustive-deps

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const dateRange = getDatesForSpan(date, span)
    let q = supabase
      .from('appointments')
      .select('*, patient:patients(id, full_name, phones), doctor:doctors(id, first_name, last_name, color)')
      .neq('status', 'cancelled')
      .order('date').order('time_start')

    if (span === 1) {
      q = q.eq('date', dateRange[0]!)
    } else {
      q = q.gte('date', dateRange[0]!).lte('date', dateRange[dateRange.length - 1]!)
    }

    const { data } = await q
    setAppointments((data ?? []) as Appointment[])
    setLoading(false)
  }, [date, span])

  useEffect(() => { load() }, [load])

  const shiftDate = (dir: 1 | -1) => {
    const step = span === 1 ? 1 : 7
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + dir * step)
    setDate(d.toISOString().slice(0, 10))
  }

  const dateLabel = (() => {
    if (span === 1) {
      return new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    }
    const first = new Date(dates[0]! + 'T12:00:00')
    const last  = new Date(dates[dates.length - 1]! + 'T12:00:00')
    const sameMonth = first.getMonth() === last.getMonth()
    const fmt = (d: Date, withMonth: boolean) =>
      d.toLocaleDateString('ru-RU', { day: 'numeric', ...(withMonth ? { month: 'long' } : {}) })
    return `${fmt(first, !sameMonth)} — ${fmt(last, true)}`
  })()

  // Shared filter logic for both list and grid views
  const filteredAppts = appointments.filter(a => {
    if (activeDoctors.size > 0 && !activeDoctors.has(a.doctor_id)) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const patName = (a.patient?.full_name ?? '').toLowerCase()
    const doc = a.doctor as { last_name: string; first_name: string } | undefined
    const docName = doc ? `${doc.last_name} ${doc.first_name}`.toLowerCase() : ''
    return patName.includes(q) || docName.includes(q)
  })

  // Search dropdown results (limited to 8)
  const searchDropdownResults = search.trim().length >= 2
    ? appointments.filter(a => {
        const q = search.toLowerCase()
        const patName = (a.patient?.full_name ?? '').toLowerCase()
        const doc = a.doctor as { last_name: string; first_name: string } | undefined
        const docName = doc ? `${doc.last_name} ${doc.first_name}`.toLowerCase() : ''
        return patName.includes(q) || docName.includes(q)
      }).slice(0, 8)
    : []

  // All doctors checked = show all
  const allActive = doctors.length > 0 && activeDoctors.size === doctors.length
  const toggleDoctor = (id: string) => {
    setActiveDoctors(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const countByDoctor = (docId: string) => appointments.filter(a => a.doctor_id === docId).length

  return (
    <div className={span === 1 ? 'max-w-5xl mx-auto' : 'w-full'}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">

        {/* LEFT: create */}
        <button onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5 flex-shrink-0">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          Записать
        </button>

        {/* CENTER: date navigation */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => shiftDate(-1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-base transition-colors">‹</button>
          <div className="relative">
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="sr-only" id="sched-date" />
            <label htmlFor="sched-date"
              className="text-sm font-semibold text-gray-900 capitalize cursor-pointer hover:text-blue-600 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors block">
              {dateLabel}
            </label>
          </div>
          <button onClick={() => shiftDate(1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 text-base transition-colors">›</button>
        </div>

        <button onClick={() => setDate(new Date().toISOString().slice(0, 10))}
          className="text-xs text-blue-600 font-medium px-2.5 py-1.5 rounded-lg border border-blue-200 hover:bg-blue-50 transition-colors flex-shrink-0">
          Сегодня
        </button>

        <span className="text-xs text-gray-400 flex-shrink-0">{appointments.length} зап.</span>

        {/* SPACER */}
        <div className="flex-1" />

        {/* RIGHT: view mode + span */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* View mode: list / grid */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([
              { label: 'Список', v: 'list' as const },
              { label: 'Сетка',  v: 'grid' as const },
            ] as const).map(opt => {
              const active = view === opt.v
              return (
                <button key={opt.label} onClick={() => setView(opt.v)}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                    active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}>
                  {opt.label}
                </button>
              )
            })}
          </div>

          {/* Span: 1 / 5 / 7 */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {([
              { label: '1 день', s: 1 as const },
              { label: '5 дней', s: 5 as const },
              { label: '7 дней', s: 7 as const },
            ] as const).map(opt => {
              const active = span === opt.s
              return (
                <button key={opt.label}
                  onClick={() => {
                    if (opt.s === 1 && span > 1) {
                      const todayStr = new Date().toISOString().slice(0, 10)
                      const inRange = dates.includes(todayStr)
                      setDate(inRange ? todayStr : dates[0]!)
                    }
                    setSpan(opt.s)
                  }}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                    active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}>
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

      </div>

      {/* Body: sidebar + main */}
      <div className="flex gap-3">

        {/* ── Left sidebar ── */}
        <div className="w-44 flex-shrink-0 space-y-2">

          {/* Birthdays */}
          {birthdays.length > 0 && (
            <div className="bg-pink-50 border border-pink-100 rounded-lg px-2.5 py-2">
              <p className="text-xs text-pink-600 font-medium flex items-center gap-1">
                🎂 <span>{birthdays.length} дн. рождения</span>
              </p>
              <div className="mt-1 space-y-0.5">
                {birthdays.map(b => (
                  <p key={b.id} className="text-[11px] text-pink-500 truncate">{b.full_name}</p>
                ))}
              </div>
            </div>
          )}

          {/* Doctors */}
          {doctors.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-lg px-2.5 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Врачи</span>
                <button
                  onClick={() => setActiveDoctors(allActive ? new Set() : new Set(doctors.map(d => d.id)))}
                  className="text-[10px] text-blue-500 hover:text-blue-700 font-medium"
                >
                  {allActive ? 'скрыть все' : 'показать все'}
                </button>
              </div>
              <div className="space-y-0.5">
                {doctors.map(d => {
                  const cnt = countByDoctor(d.id)
                  const checked = activeDoctors.has(d.id)
                  return (
                    <button key={d.id} onClick={() => toggleDoctor(d.id)}
                      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded text-left transition-colors ${checked ? 'opacity-100' : 'opacity-40'} hover:bg-gray-50`}>
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: d.color ?? '#94a3b8' }} />
                      <span className="text-[11px] text-gray-700 truncate flex-1">
                        {d.last_name} {d.first_name[0]}.
                      </span>
                      {cnt > 0 && (
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{cnt}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0">

          {/* Search bar with dropdown */}
          <div ref={searchWrapRef} className="relative mb-3">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setSearchOpen(true) }}
              onFocus={() => search.trim().length >= 2 && setSearchOpen(true)}
              placeholder="Поиск по пациенту или врачу..."
              className="w-full pl-9 pr-9 py-2 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            />
            {search && (
              <button onClick={() => { setSearch(''); setSearchOpen(false) }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              </button>
            )}
            {/* Dropdown */}
            {searchOpen && search.trim().length >= 2 && (
              <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                {searchDropdownResults.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-gray-400">Ничего не найдено</p>
                ) : (
                  searchDropdownResults.map(a => {
                    const doc = a.doctor as { last_name: string; first_name: string; color: string } | undefined
                    return (
                      <button key={a.id} type="button"
                        onClick={() => { setSelected(a); setSearchOpen(false) }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: apptColor(a) }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{a.patient?.full_name ?? 'Walk-in'}</p>
                          {doc && <p className="text-xs text-gray-400 truncate">{doc.last_name} {doc.first_name}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-mono text-gray-600">{a.time_start.slice(0, 5)}</p>
                          {span > 1 && <p className="text-[10px] text-gray-400">{new Date(a.date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</p>}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Content */}
          {loading ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Загрузка...
            </div>
          ) : appointments.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
              <p className="text-sm text-gray-400 mb-3">Записей на {span === 1 ? 'этот день' : 'этот период'} нет</p>
              <button onClick={() => setShowCreate(true)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                + Создать первую запись
              </button>
            </div>
          ) : filteredAppts.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Ничего не найдено по запросу «{search}»
            </div>
          ) : view === 'list' ? (
            <ListView dates={dates} appointments={filteredAppts} onClick={setSelected} />
          ) : span > 1 ? (
            <MultiDayGrid
              dates={dates}
              appointments={filteredAppts}
              onCardClick={setSelected}
              onDayClick={d => { setDate(d); setSpan(1); setView('list') }}
              birthdayCounts={{ [date]: birthdays.length }}
            />
          ) : (
            <DoctorDayGrid
              date={date}
              doctors={doctors.filter(d => activeDoctors.has(d.id))}
              appointments={filteredAppts}
              birthdayCount={birthdays.length}
              onCardClick={setSelected}
              onSlotClick={(doctorId, time) => setPendingSlot({ doctorId, time })}
            />
          )}

        </div>{/* /main content */}
      </div>{/* /body flex */}

      {showCreate && clinicId && (
        <CreateAppointmentModal
          clinicId={clinicId}
          defaultDate={date}
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); setShowCreate(false) }}
        />
      )}

      {pendingSlot && clinicId && (
        <CreateAppointmentModal
          clinicId={clinicId}
          defaultDate={date}
          defaultDoctorId={pendingSlot.doctorId}
          defaultTime={pendingSlot.time}
          onClose={() => setPendingSlot(null)}
          onCreated={() => { load(); setPendingSlot(null) }}
        />
      )}

      {selected && (
        <AppointmentDetailDrawer
          appt={selected}
          clinicId={clinicId}
          onClose={() => setSelected(null)}
          onUpdate={load}
        />
      )}
    </div>
  )
}
