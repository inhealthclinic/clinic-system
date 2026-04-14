'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { LastVisitPanel } from '@/components/visits/LastVisitPanel'
import { MedicalRecordForm } from '@/components/visits/MedicalRecordForm'
import { AllergyAlert } from '@/components/medical-card/AllergyAlert'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import type { Visit, MedicalRecord, Patient, Doctor } from '@/types/app'

export default function VisitPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { can, user } = usePermissions()
  const supabase = createClient()

  const [visit,  setVisit]  = useState<Visit & { patient: Patient; doctor: Doctor } | null>(null)
  const [record, setRecord] = useState<MedicalRecord | null>(null)
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState('')
  const [tab, setTab] = useState<'medcard'|'charges'|'lab'>('medcard')

  useEffect(() => {
    // Загрузка визита
    supabase.from('visits')
      .select(`*, patient:patients(*), doctor:doctors(*, specialization:specializations(name))`)
      .eq('id', id).single()
      .then(({ data }) => setVisit(data as any))

    // Загрузка медзаписи
    supabase.from('medical_records')
      .select('*').eq('visit_id', id).single()
      .then(({ data }) => setRecord(data))
  }, [id])

  // Старт визита
  const startVisit = async () => {
    await supabase.from('visits').update({ status: 'in_progress' }).eq('id', id)
    setVisit(v => v ? { ...v, status: 'in_progress' } : v)
  }

  // Закрытие визита с валидацией
  const closeVisit = async () => {
    setClosing(true); setCloseError('')
    const { data } = await supabase.rpc('validate_visit_close', { p_visit_id: id })
    const result = data?.[0]

    if (!result?.ok) {
      setCloseError(result?.reason || 'Ошибка валидации')
      setClosing(false)
      return
    }

    await supabase.from('visits')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id)

    setVisit(v => v ? { ...v, status: 'completed' } : v)
    setClosing(false)
  }

  if (!visit) return (
    <div className="flex items-center justify-center h-screen text-gray-400">
      Загрузка визита...
    </div>
  )

  const statusColors: Record<string, string> = {
    open: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-green-100 text-green-700',
    completed: 'bg-blue-100 text-blue-700',
    partial: 'bg-amber-100 text-amber-700',
  }
  const statusLabels: Record<string, string> = {
    open: 'Ожидает', in_progress: 'На приёме',
    completed: 'Завершён', partial: 'Частично'
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Шапка */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4 shrink-0">
        <button onClick={() => router.back()}
          className="text-gray-400 hover:text-gray-600">← Назад</button>

        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-gray-900">
              {visit.patient.full_name}
            </h1>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[visit.status]}`}>
              {statusLabels[visit.status]}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {visit.doctor.first_name} {visit.doctor.last_name}
            {visit.started_at && ` · Начат в ${new Date(visit.started_at).toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'})}`}
          </p>
        </div>

        {/* Аллергии в шапке */}
        <AllergyAlert patientId={visit.patient_id} />

        {/* Действия */}
        <div className="flex gap-2">
          {visit.status === 'open' && (
            <PermissionGuard permission="visit:edit">
              <button onClick={startVisit}
                className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-700">
                Начать приём
              </button>
            </PermissionGuard>
          )}
          {visit.status === 'in_progress' && (
            <PermissionGuard permission="visit:close">
              <button onClick={closeVisit} disabled={closing}
                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {closing ? 'Проверка...' : 'Закрыть визит'}
              </button>
            </PermissionGuard>
          )}
          {visit.status === 'completed' && (
            <span className="text-sm text-green-600 font-medium">✓ Визит завершён</span>
          )}
        </div>
      </div>

      {/* Ошибка закрытия */}
      {closeError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-700 flex items-center gap-2">
          <span>🚫</span> {closeError}
        </div>
      )}

      {/* Контент */}
      <div className="flex flex-1 overflow-hidden">
        {/* Основная область */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Вкладки */}
          <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1 w-fit">
            {([
              { key: 'medcard', label: '📋 Медкарта' },
              { key: 'charges', label: '💰 Начисления' },
              { key: 'lab',     label: '🔬 Анализы' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Медкарта */}
          {tab === 'medcard' && (
            <div>
              <LastVisitPanel patientId={visit.patient_id} currentVisitId={id} />
              <PermissionGuard permission="medcard:create" fallback={
                record ? <RecordReadonly record={record} /> : <p className="text-gray-400 text-sm">Нет доступа</p>
              }>
                <MedicalRecordForm
                  visitId={id}
                  patientId={visit.patient_id}
                  doctorId={visit.doctor_id}
                  existing={record || undefined}
                  onSave={setRecord}
                />
              </PermissionGuard>
            </div>
          )}

          {/* Начисления */}
          {tab === 'charges' && (
            <ChargesTab visitId={id} patientId={visit.patient_id} />
          )}

          {/* Анализы */}
          {tab === 'lab' && (
            <div className="text-gray-400 text-sm text-center py-8">
              Раздел лаборатории — Спринт 5
            </div>
          )}
        </div>

        {/* Правая панель — краткая инфо */}
        <div className="w-64 bg-white border-l border-gray-200 p-4 overflow-y-auto shrink-0 hidden lg:block">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Пациент</p>
              <p className="text-sm font-medium">{visit.patient.full_name}</p>
              <p className="text-xs text-gray-400">{visit.patient.phones?.[0]}</p>
              {visit.patient.birth_date && (
                <p className="text-xs text-gray-400">
                  {new Date().getFullYear() - new Date(visit.patient.birth_date).getFullYear()} лет
                </p>
              )}
            </div>
            {(visit.patient.debt_amount || 0) > 0 && (
              <div className="bg-red-50 rounded-xl p-3">
                <p className="text-xs font-medium text-red-700">Долг</p>
                <p className="text-sm font-bold text-red-600">
                  {visit.patient.debt_amount.toLocaleString()} ₸
                </p>
              </div>
            )}
            {(visit.patient.balance_amount || 0) > 0 && (
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-xs font-medium text-green-700">Депозит</p>
                <p className="text-sm font-bold text-green-600">
                  {visit.patient.balance_amount.toLocaleString()} ₸
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Readonly просмотр записи (для не-врачей)
function RecordReadonly({ record }: { record: MedicalRecord }) {
  return (
    <div className="space-y-3">
      {record.diagnosis_text && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-400 mb-1">Диагноз</p>
          <p className="text-sm">{record.icd10_code && <span className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded mr-2">{record.icd10_code}</span>}{record.diagnosis_text}</p>
        </div>
      )}
      {record.prescriptions?.length > 0 && (
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs font-medium text-gray-400 mb-2">Назначения</p>
          {record.prescriptions.map((p, i) => (
            <p key={i} className="text-sm">• {p.drug_name} {p.dosage} — {p.frequency}</p>
          ))}
        </div>
      )}
    </div>
  )
}

// Начисления (упрощённо)
function ChargesTab({ visitId, patientId }: { visitId: string; patientId: string }) {
  const supabase = createClient()
  const [charges, setCharges] = useState<any[]>([])
  const [services, setServices] = useState<any[]>([])

  useEffect(() => {
    supabase.from('charges').select('*, service:services(name)')
      .eq('visit_id', visitId).then(({ data }) => setCharges(data || []))
    supabase.from('services').select('id,name,price').eq('is_active', true)
      .then(({ data }) => setServices(data || []))
  }, [visitId])

  const addCharge = async (svc: any) => {
    const { data } = await supabase.from('charges').insert({
      visit_id: visitId, patient_id: patientId,
      service_id: svc.id, name: svc.name,
      unit_price: svc.price, total: svc.price,
    }).select('*, service:services(name)').single()
    if (data) setCharges(prev => [...prev, data])
  }

  const total = charges.reduce((s, c) => s + (c.total - c.discount), 0)

  return (
    <div className="space-y-4">
      {/* Список начислений */}
      {charges.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {charges.map(c => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0">
              <p className="text-sm text-gray-800">{c.name}</p>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  c.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {c.status === 'paid' ? 'Оплачено' : 'Ожидает'}
                </span>
                <span className="text-sm font-medium">{c.total.toLocaleString()} ₸</span>
              </div>
            </div>
          ))}
          <div className="px-4 py-3 bg-gray-50 flex justify-between">
            <span className="text-sm font-semibold text-gray-700">Итого</span>
            <span className="text-sm font-bold">{total.toLocaleString()} ₸</span>
          </div>
        </div>
      )}

      {/* Добавить услугу */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">Добавить услугу</p>
        <div className="grid grid-cols-2 gap-2">
          {services.slice(0, 8).map(s => (
            <button key={s.id} onClick={() => addCharge(s)}
              className="text-left border border-gray-200 rounded-xl px-3 py-2.5 hover:border-blue-300 hover:bg-blue-50 transition-colors">
              <p className="text-sm text-gray-800">{s.name}</p>
              <p className="text-xs text-gray-400">{s.price.toLocaleString()} ₸</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
