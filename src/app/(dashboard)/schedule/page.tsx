'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TimeGrid } from '@/components/schedule/TimeGrid'
import { AppointmentModal } from '@/components/schedule/AppointmentModal'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import { usePermissions } from '@/lib/hooks/usePermissions'
import type { Appointment, Doctor } from '@/types/app'
import { today, addDays, formatDate, APPOINTMENT_STATUS_LABELS } from '@/lib/utils/schedule'

export default function SchedulePage() {
  const { can } = usePermissions()
  const supabase = createClient()

  const [selectedDate, setSelectedDate] = useState(today())
  const [doctors,      setDoctors]      = useState<Doctor[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [modal,        setModal]        = useState<{
    open: boolean
    appointment?: Appointment | null
    defaultDoctorId?: string
    defaultTime?: string
  }>({ open: false })
  const [loading, setLoading] = useState(false)

  // Загрузка врачей (один раз)
  useEffect(() => {
    supabase.from('doctors')
      .select('*, specialization:specializations(name)')
      .eq('is_active', true)
      .order('last_name')
      .then(({ data }) => setDoctors(data || []))
  }, [])

  // Загрузка записей на дату
  const loadAppointments = useCallback(async (date: string) => {
    setLoading(true)
    const { data } = await supabase.from('appointments')
      .select(`
        *,
        patient:patients(id,full_name,phones,debt_amount),
        doctor:doctors(id,first_name,last_name,color),
        service:services(id,name,price)
      `)
      .eq('date', date)
      .order('time_start')
    setAppointments(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadAppointments(selectedDate) }, [selectedDate])

  // Realtime подписка
  useEffect(() => {
    const channel = supabase
      .channel('schedule-realtime')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'appointments',
        filter: `date=eq.${selectedDate}`
      }, () => loadAppointments(selectedDate))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedDate])

  const onSave = (apt: Appointment) => {
    setAppointments(prev => {
      const exists = prev.find(a => a.id === apt.id)
      return exists ? prev.map(a => a.id === apt.id ? apt : a) : [...prev, apt]
    })
    setModal({ open: false })
  }

  const onDelete = async (id: string) => {
    await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', id)
    setAppointments(prev => prev.filter(a => a.id !== id))
    setModal({ open: false })
  }

  // Статистика дня
  const stats = {
    total:     appointments.filter(a => !['cancelled','rescheduled'].includes(a.status)).length,
    confirmed: appointments.filter(a => a.status === 'confirmed').length,
    arrived:   appointments.filter(a => a.status === 'arrived').length,
    completed: appointments.filter(a => a.status === 'completed').length,
    no_show:   appointments.filter(a => a.status === 'no_show').length,
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Шапка */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 shrink-0">
        {/* Навигация по датам */}
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedDate(d => addDays(d, -1))}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">←</button>
          <button onClick={() => setSelectedDate(today())}
            className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg">
            Сегодня
          </button>
          <input type="date" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={() => setSelectedDate(d => addDays(d, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500">→</button>
        </div>

        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-800 capitalize">
            {formatDate(selectedDate)}
          </h1>
        </div>

        {/* Статистика */}
        <div className="hidden md:flex items-center gap-4 text-xs text-gray-500">
          <span>Всего: <b className="text-gray-800">{stats.total}</b></span>
          <span>Пришли: <b className="text-amber-600">{stats.arrived}</b></span>
          <span>Завершено: <b className="text-green-600">{stats.completed}</b></span>
          {stats.no_show > 0 && (
            <span>Не явились: <b className="text-red-500">{stats.no_show}</b></span>
          )}
        </div>

        {/* Кнопки */}
        <div className="flex gap-2">
          <PermissionGuard permission="schedule:create">
            <button
              onClick={() => setModal({ open: true, defaultDate: selectedDate })}
              className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700"
            >
              + Записать
            </button>
          </PermissionGuard>
          <PermissionGuard permission="schedule:create">
            <button
              onClick={() => setModal({ open: true, defaultDate: selectedDate, appointment: { is_walkin: true } as any })}
              className="border border-orange-300 text-orange-600 px-3 py-2 rounded-xl text-sm font-medium hover:bg-orange-50"
            >
              Walk-in
            </button>
          </PermissionGuard>
        </div>
      </div>

      {/* Тайм-грид */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            Загрузка...
          </div>
        ) : (
          <TimeGrid
            doctors={doctors}
            appointments={appointments}
            selectedDate={selectedDate}
            onSlotClick={(doctorId, time) => {
              if (!can('schedule:create')) return
              setModal({ open: true, defaultDoctorId: doctorId, defaultTime: time, defaultDate: selectedDate })
            }}
            onAppointmentClick={(apt) => setModal({ open: true, appointment: apt })}
          />
        )}
      </div>

      {/* Модальное окно */}
      {modal.open && (
        <AppointmentModal
          appointment={modal.appointment}
          defaultDoctorId={modal.defaultDoctorId}
          defaultTime={modal.defaultTime}
          defaultDate={modal.defaultDate || selectedDate}
          onClose={() => setModal({ open: false })}
          onSave={onSave}
          onDelete={can('schedule:delete') ? onDelete : undefined}
        />
      )}
    </div>
  )
}
