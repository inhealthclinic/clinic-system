'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { MedicalRecord } from '@/types/app'

interface Props {
  patientId: string
  currentVisitId: string
}

export function LastVisitPanel({ patientId, currentVisitId }: Props) {
  const [record, setRecord] = useState<(MedicalRecord & { visit_date: string; doctor_name: string }) | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('medical_records')
      .select(`
        *,
        visit:visits!inner(id, created_at, appointment:appointments(date)),
        doctor:doctors(first_name, last_name)
      `)
      .eq('patient_id', patientId)
      .neq('visit_id', currentVisitId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) {
          setRecord({
            ...data,
            visit_date: (data as any).visit?.appointment?.date || '',
            doctor_name: `${(data as any).doctor?.first_name} ${(data as any).doctor?.last_name}`,
          })
        }
      })
  }, [patientId, currentVisitId])

  if (!record) return null

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-amber-800">
            📋 Последний визит
          </span>
          <span className="text-xs text-amber-600">
            {record.visit_date
              ? new Date(record.visit_date).toLocaleDateString('ru', { day:'numeric', month:'long', year:'numeric' })
              : ''} — {record.doctor_name}
          </span>
        </div>
        <span className="text-amber-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2 border-t border-amber-200 pt-3">
          {record.diagnosis_text && (
            <div>
              <p className="text-xs font-medium text-amber-700 mb-0.5">Диагноз</p>
              <p className="text-sm text-gray-800">
                {record.icd10_code && <span className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded mr-2">{record.icd10_code}</span>}
                {record.diagnosis_text}
              </p>
            </div>
          )}

          {record.complaints && (
            <div>
              <p className="text-xs font-medium text-amber-700 mb-0.5">Жалобы</p>
              <p className="text-sm text-gray-700 line-clamp-2">{record.complaints}</p>
            </div>
          )}

          {record.prescriptions?.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-700 mb-1">Назначения</p>
              <div className="space-y-0.5">
                {record.prescriptions.map((p, i) => (
                  <p key={i} className="text-xs text-gray-700">
                    • {p.drug_name} {p.dosage} — {p.frequency}
                    {p.duration ? `, ${p.duration}` : ''}
                  </p>
                ))}
              </div>
            </div>
          )}

          {record.recommendations && (
            <div>
              <p className="text-xs font-medium text-amber-700 mb-0.5">Рекомендации</p>
              <p className="text-sm text-gray-700 line-clamp-2">{record.recommendations}</p>
            </div>
          )}

          {record.control_date && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                📅 Контроль: {new Date(record.control_date).toLocaleDateString('ru')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
