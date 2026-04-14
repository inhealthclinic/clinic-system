'use client'

import { useMemo } from 'react'
import type { Appointment, Doctor } from '@/types/app'
import { AppointmentCard } from './AppointmentCard'
import {
  generateTimeSlots, timeToGridPosition, durationToHeight,
  HOUR_START, HOUR_END, SLOT_MIN
} from '@/lib/utils/schedule'

const ROW_HEIGHT = 48  // px на 30 минут
const TIME_COL_W = 56  // px для колонки времени

interface Props {
  doctors: Doctor[]
  appointments: Appointment[]
  selectedDate: string
  onSlotClick: (doctorId: string, time: string) => void
  onAppointmentClick: (appointment: Appointment) => void
}

export function TimeGrid({
  doctors, appointments, selectedDate,
  onSlotClick, onAppointmentClick
}: Props) {
  const slots = useMemo(() => generateTimeSlots(), [])
  const totalHeight = slots.length * ROW_HEIGHT

  // Группируем записи по врачу
  const byDoctor = useMemo(() => {
    const map: Record<string, Appointment[]> = {}
    doctors.forEach(d => { map[d.id] = [] })
    appointments.forEach(a => {
      if (map[a.doctor_id]) map[a.doctor_id].push(a)
    })
    return map
  }, [doctors, appointments])

  // Текущее время — линия
  const now = new Date()
  const isToday = selectedDate === now.toISOString().split('T')[0]
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const currentLineTop = isToday
    ? timeToGridPosition(`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`, ROW_HEIGHT)
    : null

  return (
    <div className="flex overflow-auto h-full">
      {/* Колонка времени */}
      <div className="shrink-0 sticky left-0 z-20 bg-white border-r border-gray-100"
           style={{ width: TIME_COL_W }}>
        {/* Заголовок */}
        <div className="h-12 border-b border-gray-100" />
        {/* Временные метки */}
        <div style={{ position: 'relative', height: totalHeight }}>
          {slots.map((slot, i) => (
            <div
              key={slot}
              style={{ position: 'absolute', top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
              className="flex items-start pt-1 pr-2 justify-end w-full"
            >
              {slot.endsWith(':00') && (
                <span className="text-xs text-gray-400 font-medium">{slot}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Колонки врачей */}
      <div className="flex flex-1 min-w-0">
        {doctors.map(doctor => (
          <div key={doctor.id} className="flex-1 min-w-[160px] border-r border-gray-100 last:border-0">
            {/* Заголовок врача */}
            <div className="h-12 border-b border-gray-100 px-3 flex items-center gap-2 sticky top-0 bg-white z-10">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: doctor.color }}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800 truncate">
                  {doctor.last_name} {doctor.first_name[0]}.
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {(doctor as any).specialization?.name || ''}
                </p>
              </div>
            </div>

            {/* Сетка */}
            <div style={{ position: 'relative', height: totalHeight }}>

              {/* Линия сетки */}
              {slots.map((slot, i) => (
                <div
                  key={slot}
                  style={{ position: 'absolute', top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                  className={`w-full border-b cursor-pointer hover:bg-blue-50/30 transition-colors ${
                    slot.endsWith(':00') ? 'border-gray-200' : 'border-gray-100'
                  }`}
                  onClick={() => onSlotClick(doctor.id, slot)}
                />
              ))}

              {/* Текущее время */}
              {currentLineTop !== null && (
                <div
                  style={{ position: 'absolute', top: currentLineTop, left: 0, right: 0 }}
                  className="flex items-center z-10 pointer-events-none"
                >
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 h-px bg-red-400" />
                </div>
              )}

              {/* Записи */}
              {byDoctor[doctor.id]?.map(apt => {
                const top = timeToGridPosition(apt.time_start, ROW_HEIGHT)
                const height = Math.max(durationToHeight(apt.duration_min, ROW_HEIGHT), ROW_HEIGHT * 0.8)
                return (
                  <div
                    key={apt.id}
                    style={{
                      position: 'absolute',
                      top: top + 1,
                      height: height - 2,
                      left: 4,
                      right: 4,
                      zIndex: 5,
                    }}
                  >
                    <AppointmentCard
                      appointment={apt}
                      onClick={() => onAppointmentClick(apt)}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {doctors.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
            Нет активных врачей
          </div>
        )}
      </div>
    </div>
  )
}
