'use client'

import type { Appointment } from '@/types/app'
import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_LABELS } from '@/lib/utils/schedule'

interface Props {
  appointment: Appointment
  onClick: () => void
}

export function AppointmentCard({ appointment: apt, onClick }: Props) {
  const colorClass = APPOINTMENT_STATUS_COLORS[apt.status] || APPOINTMENT_STATUS_COLORS.pending
  const isShort = apt.duration_min <= 30

  return (
    <div
      onClick={onClick}
      className={`h-full w-full rounded-md border px-2 py-1 cursor-pointer overflow-hidden
        hover:shadow-md transition-shadow select-none ${colorClass}`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className={`font-semibold truncate ${isShort ? 'text-xs' : 'text-xs'}`}>
          {apt.patient?.full_name || 'Пациент'}
        </p>
        <span className="text-xs opacity-70 shrink-0">
          {apt.time_start.slice(0,5)}
        </span>
      </div>

      {!isShort && (
        <>
          <p className="text-xs opacity-80 truncate mt-0.5">
            {apt.service?.name || ''}
          </p>
          <p className="text-xs opacity-60 mt-0.5">
            {APPOINTMENT_STATUS_LABELS[apt.status]}
          </p>
        </>
      )}

      {apt.is_walkin && (
        <span className="text-xs bg-orange-200 text-orange-700 px-1 rounded">walk-in</span>
      )}
    </div>
  )
}
