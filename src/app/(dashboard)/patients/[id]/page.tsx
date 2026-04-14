'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Patient, Appointment } from '@/types'

export default function PatientCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [patient, setPatient] = useState<Patient | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase
        .from('appointments')
        .select('*, doctor:doctors(id, first_name, last_name, color)')
        .eq('patient_id', id)
        .order('start_at', { ascending: false })
        .limit(10),
    ]).then(([p, a]) => {
      if (!p.data) { router.push('/patients'); return }
      setPatient(p.data)
      setAppointments(a.data ?? [])
      setLoading(false)
    })
  }, [id, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">
        Загрузка...
      </div>
    )
  }

  if (!patient) return null

  const STATUS_COLOR: Record<string, string> = {
    scheduled: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-green-100 text-green-700',
    arrived: 'bg-yellow-100 text-yellow-700',
    in_visit: 'bg-orange-100 text-orange-700',
    completed: 'bg-gray-100 text-gray-600',
    no_show: 'bg-red-100 text-red-600',
    cancelled: 'bg-gray-100 text-gray-400',
  }

  const STATUS_RU: Record<string, string> = {
    scheduled: 'Запись',
    confirmed: 'Подтверждено',
    arrived: 'Пришёл',
    in_visit: 'На приёме',
    completed: 'Завершено',
    no_show: 'Не явился',
    cancelled: 'Отменено',
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">
        ← Назад к списку
      </Link>

      {/* Patient header */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xl flex-shrink-0">
            {patient.full_name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold text-gray-900">{patient.full_name}</h2>
              {patient.is_vip && (
                <span className="text-xs font-medium bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                  VIP
                </span>
              )}
              <span className="text-xs text-gray-400">{patient.patient_number}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
              {patient.phones[0] && <span>{patient.phones[0]}</span>}
              {patient.birth_date && (
                <span>
                  {new Date(patient.birth_date).toLocaleDateString('ru-RU')} •{' '}
                  {new Date().getFullYear() - new Date(patient.birth_date).getFullYear()} лет
                </span>
              )}
              {patient.gender && (
                <span>{patient.gender === 'male' ? 'Мужской' : patient.gender === 'female' ? 'Женский' : 'Другой'}</span>
              )}
            </div>
          </div>

          {/* Balance */}
          <div className="text-right flex-shrink-0">
            {patient.balance_amount > 0 && (
              <div>
                <p className="text-xs text-gray-400">Депозит</p>
                <p className="text-base font-semibold text-green-600">
                  +{patient.balance_amount.toLocaleString('ru-RU')} ₸
                </p>
              </div>
            )}
            {patient.debt_amount > 0 && (
              <div>
                <p className="text-xs text-gray-400">Долг</p>
                <p className="text-base font-semibold text-red-500">
                  {patient.debt_amount.toLocaleString('ru-RU')} ₸
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Appointments */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">История записей</h3>
          <span className="text-xs text-gray-400">{appointments.length} записей</span>
        </div>
        {appointments.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">Записей нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {appointments.map((a) => (
              <div key={a.id} className="px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(a.start_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    в{' '}
                    {new Date(a.start_at).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  {a.doctor && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {a.doctor.last_name} {a.doctor.first_name}
                    </p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[a.status] ?? ''}`}>
                  {STATUS_RU[a.status] ?? a.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
