'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AllergyAlert } from '@/components/medical-card/AllergyAlert'
import { QuickActions } from '@/components/patients/QuickActions'
import { PatientPaymentSummary } from '@/components/finance/PatientPaymentSummary'
import { DepositWidget } from '@/components/finance/DepositWidget'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import type { Patient, Appointment, Visit } from '@/types/app'

type Tab = 'feed' | 'visits' | 'medcard' | 'lab' | 'finance'

export default function PatientPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [patient,  setPatient]  = useState<Patient | null>(null)
  const [tab,      setTab]      = useState<Tab>('feed')
  const [visits,   setVisits]   = useState<any[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [balance,  setBalance]  = useState(0)
  const [showDeposit, setShowDeposit] = useState(false)

  useEffect(() => {
    supabase.from('patients').select('*').eq('id', id).single()
      .then(({ data }) => { setPatient(data); setBalance(data?.balance_amount || 0) })

    supabase.from('activity_logs')
      .select('*')
      .eq('entity_type', 'patient').eq('entity_id', id)
      .order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setActivity(data || []))
  }, [id])

  useEffect(() => {
    if (tab === 'visits') {
      supabase.from('visits')
        .select('*, appointment:appointments(date, time_start, service:services(name)), doctor:doctors(first_name, last_name)')
        .eq('patient_id', id)
        .order('created_at', { ascending: false })
        .then(({ data }) => setVisits(data || []))
    }
  }, [tab, id])

  if (!patient) return (
    <div className="flex items-center justify-center h-screen text-gray-400">Загрузка...</div>
  )

  const statusColors: Record<string, string> = {
    new: 'bg-gray-100 text-gray-600', active: 'bg-blue-100 text-blue-700',
    in_treatment: 'bg-green-100 text-green-700', completed: 'bg-purple-100 text-purple-700',
    lost: 'bg-red-100 text-red-500', vip: 'bg-amber-100 text-amber-700',
  }
  const statusLabels: Record<string, string> = {
    new: 'Новый', active: 'Активный', in_treatment: 'На лечении',
    completed: 'Завершён', lost: 'Потерян', vip: 'VIP',
  }

  const actionLabels: Record<string, string> = {
    created: 'Создан', updated: 'Обновлён', merged: 'Объединён',
    visit_started: 'Визит начат', visit_completed: 'Визит завершён',
    payment_received: 'Оплата принята', lab_order: 'Назначены анализы',
    appointment_created: 'Создана запись', appointment_cancelled: 'Запись отменена',
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Шапка пациента */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-600 mt-1">←</button>
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-lg font-bold shrink-0">
              {patient.full_name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{patient.full_name}</h1>
                {patient.is_vip && <span className="text-amber-400">★ VIP</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[patient.status]}`}>
                  {statusLabels[patient.status]}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-gray-500 flex-wrap">
                <span>{patient.patient_number}</span>
                {patient.phones?.[0] && <span>📞 {patient.phones[0]}</span>}
                {patient.birth_date && (
                  <span>🎂 {new Date().getFullYear() - new Date(patient.birth_date).getFullYear()} лет</span>
                )}
                {patient.gender && <span>{patient.gender === 'male' ? '♂' : '♀'}</span>}
              </div>
              {/* Аллергии — всегда видимо */}
              <div className="mt-2">
                <AllergyAlert patientId={id} />
              </div>
            </div>
          </div>

          {/* Финансы в шапке */}
          <div className="flex gap-3 shrink-0">
            {balance > 0 && (
              <div className="text-right">
                <p className="text-xs text-gray-400">Депозит</p>
                <p className="text-sm font-bold text-green-600">{balance.toLocaleString()} ₸</p>
              </div>
            )}
            {patient.debt_amount > 0 && (
              <div className="text-right">
                <p className="text-xs text-gray-400">Долг</p>
                <p className="text-sm font-bold text-red-500">{patient.debt_amount.toLocaleString()} ₸</p>
              </div>
            )}
          </div>
        </div>

        {/* Быстрые действия */}
        <div className="mt-4">
          <QuickActions
            patientId={id}
            patientName={patient.full_name}
            onDeposit={() => setShowDeposit(true)}
            onLabOrder={() => setTab('lab')}
            onTask={() => {}}
            onCompareResults={() => setTab('lab')}
          />
        </div>

        {/* Вкладки */}
        <div className="flex gap-1 mt-4 border-b border-gray-100 -mb-px">
          {([
            { key: 'feed',    label: '📋 Лента' },
            { key: 'visits',  label: '🏥 Визиты' },
            { key: 'medcard', label: '❤️ Медкарта' },
            { key: 'lab',     label: '🔬 Анализы' },
            { key: 'finance', label: '💰 Финансы' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Контент */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Лента событий */}
        {tab === 'feed' && (
          <div className="max-w-2xl mx-auto space-y-3">
            {activity.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Нет событий</p>
            ) : activity.map(log => (
              <div key={log.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm shrink-0">
                  {log.action === 'created' ? '✨'
                    : log.action.includes('payment') ? '💰'
                    : log.action.includes('visit') ? '🏥'
                    : log.action.includes('lab') ? '🔬'
                    : log.action.includes('appointment') ? '📅'
                    : '📝'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    {actionLabels[log.action] || log.action}
                  </p>
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {JSON.stringify(log.metadata).slice(0, 80)}
                    </p>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {new Date(log.created_at).toLocaleDateString('ru', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Визиты */}
        {tab === 'visits' && (
          <div className="max-w-2xl mx-auto space-y-3">
            {visits.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Нет визитов</p>
            ) : visits.map(v => (
              <div key={v.id}
                onClick={() => router.push(`/visits/${v.id}`)}
                className="bg-white rounded-xl border border-gray-200 px-5 py-4 cursor-pointer hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800">
                      {v.appointment?.date
                        ? new Date(v.appointment.date).toLocaleDateString('ru', { day:'numeric', month:'long', year:'numeric' })
                        : new Date(v.created_at).toLocaleDateString('ru')}
                      {v.appointment?.time_start && ` в ${v.appointment.time_start.slice(0,5)}`}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {v.doctor?.first_name} {v.doctor?.last_name}
                      {v.appointment?.service?.name && ` · ${v.appointment.service.name}`}
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full ${
                    v.status === 'completed' ? 'bg-green-100 text-green-700'
                    : v.status === 'in_progress' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-500'
                  }`}>
                    {v.status === 'completed' ? 'Завершён'
                      : v.status === 'in_progress' ? 'На приёме'
                      : v.status === 'partial' ? 'Частично'
                      : 'Открыт'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Медкарта */}
        {tab === 'medcard' && (
          <div className="max-w-2xl mx-auto text-center text-gray-400 py-8">
            Полная медкарта — Спринт 4 ✓
            <br />
            <button onClick={() => router.push(`/patients/${id}/medical-card`)}
              className="mt-3 text-blue-600 hover:text-blue-800 text-sm">
              Открыть медкарту →
            </button>
          </div>
        )}

        {/* Анализы */}
        {tab === 'lab' && (
          <div className="max-w-2xl mx-auto text-center text-gray-400 py-8">
            История анализов пациента — Спринт 5 ✓
          </div>
        )}

        {/* Финансы */}
        {tab === 'finance' && (
          <div className="max-w-md mx-auto space-y-4">
            <PatientPaymentSummary patientId={id} />
            <PermissionGuard permission="finance:create">
              <DepositWidget
                patientId={id}
                balance={balance}
                onSuccess={(newBalance) => {
                  setBalance(newBalance)
                  setPatient(p => p ? { ...p, balance_amount: newBalance } : p)
                }}
              />
            </PermissionGuard>
          </div>
        )}
      </div>

      {/* Модальное пополнение депозита */}
      {showDeposit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-4">Пополнение депозита</h2>
            <DepositWidget
              patientId={id}
              balance={balance}
              onSuccess={(nb) => {
                setBalance(nb)
                setShowDeposit(false)
              }}
            />
            <button onClick={() => setShowDeposit(false)}
              className="w-full mt-3 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-700 hover:bg-gray-50">
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
