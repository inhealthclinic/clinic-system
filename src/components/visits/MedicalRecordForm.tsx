'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ICD10Search } from '@/components/medical-card/ICD10Search'
import { AllergyAlert } from '@/components/medical-card/AllergyAlert'
import type { MedicalRecord, Prescription, Vitals } from '@/types/app'

interface PrescriptionTemplate {
  id: string; name: string; drug_name: string; dosage: string
  form?: string; frequency: string; duration?: string
  route?: string; instructions?: string; use_count: number
}

interface Props {
  visitId: string
  patientId: string
  doctorId: string
  existing?: MedicalRecord
  onSave: (record: MedicalRecord) => void
}

const TEMPLATES = [
  { value: 'general', label: 'Общий приём' },
  { value: 'therapy', label: 'Терапия' },
  { value: 'endocrinology', label: 'Эндокринология' },
  { value: 'gynecology', label: 'Гинекология' },
  { value: 'cardiology', label: 'Кардиология' },
  { value: 'urology', label: 'Урология' },
  { value: 'anemia', label: 'Анемия' },
  { value: 'thyroid', label: 'Щитовидная железа' },
  { value: 'weight_loss', label: 'Снижение веса' },
]

export function MedicalRecordForm({ visitId, patientId, doctorId, existing, onSave }: Props) {
  const supabase = createClient()

  const [form, setForm] = useState<Partial<MedicalRecord>>({
    complaints: '', anamnesis: '', objective: '',
    vitals: {}, icd10_code: '', icd10_secondary: [],
    diagnosis_text: '', diagnosis_type: 'preliminary',
    prescriptions: [], recommendations: '', treatment_plan: '',
    control_date: '', template: 'general',
    ...existing,
  })

  const [prescTemplates, setPrescTemplates] = useState<PrescriptionTemplate[]>([])
  const [checkDrug, setCheckDrug] = useState('')
  const [allergyConfirmed, setAllergyConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('subjective')

  useEffect(() => {
    supabase.from('prescription_templates')
      .select('*').eq('doctor_id', doctorId)
      .order('use_count', { ascending: false })
      .limit(20)
      .then(({ data }) => setPrescTemplates(data || []))
  }, [doctorId])

  const set = (field: string, value: any) =>
    setForm(f => ({ ...f, [field]: value }))

  const setVital = (key: string, value: string) =>
    setForm(f => ({ ...f, vitals: { ...f.vitals, [key]: value ? Number(value) : undefined } }))

  // Добавить назначение
  const addPrescription = (p?: Partial<Prescription>) => {
    setForm(f => ({
      ...f,
      prescriptions: [...(f.prescriptions || []), {
        drug_name: '', dosage: '', frequency: '', form: '',
        duration: '', route: '', instructions: '', ...p
      }]
    }))
  }

  const addFromTemplate = async (tpl: PrescriptionTemplate) => {
    addPrescription({
      drug_name: tpl.drug_name, dosage: tpl.dosage,
      form: tpl.form, frequency: tpl.frequency,
      duration: tpl.duration, route: tpl.route, instructions: tpl.instructions,
    })
    // Увеличить счётчик использования
    await supabase.from('prescription_templates')
      .update({ use_count: tpl.use_count + 1 }).eq('id', tpl.id)
  }

  const updatePrescription = (idx: number, field: string, value: string) => {
    const list = [...(form.prescriptions || [])]
    list[idx] = { ...list[idx], [field]: value }
    set('prescriptions', list)
    if (field === 'drug_name') setCheckDrug(value)
  }

  const removePrescription = (idx: number) => {
    set('prescriptions', (form.prescriptions || []).filter((_, i) => i !== idx))
  }

  const save = async (sign = false) => {
    setSaving(true)
    const payload = { ...form, visit_id: visitId, patient_id: patientId, doctor_id: doctorId }
    if (sign) payload.is_signed = true

    let data, error
    if (existing) {
      ;({ data, error } = await supabase.from('medical_records')
        .update(payload).eq('id', existing.id).select('*').single())
    } else {
      ;({ data, error } = await supabase.from('medical_records')
        .insert(payload).select('*').single())
    }
    if (data) onSave(data as MedicalRecord)
    setSaving(false)
  }

  const sections = [
    { key: 'subjective', label: 'Жалобы' },
    { key: 'objective',  label: 'Осмотр' },
    { key: 'diagnosis',  label: 'Диагноз' },
    { key: 'treatment',  label: 'Лечение' },
  ]

  return (
    <div className="space-y-4">
      {/* Шаблон специализации */}
      <div className="flex gap-2 flex-wrap">
        {TEMPLATES.map(t => (
          <button key={t.value} onClick={() => set('template', t.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              form.template === t.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Навигация по секциям */}
      <div className="flex border-b border-gray-200">
        {sections.map(s => (
          <button key={s.key} onClick={() => setActiveSection(s.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeSection === s.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* СУБЪЕКТИВНО */}
      {activeSection === 'subjective' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Жалобы *</label>
            <textarea value={form.complaints || ''} onChange={e => set('complaints', e.target.value)}
              rows={3} placeholder="Жалобы пациента..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Анамнез</label>
            <textarea value={form.anamnesis || ''} onChange={e => set('anamnesis', e.target.value)}
              rows={3} placeholder="Анамнез заболевания..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
        </div>
      )}

      {/* ОБЪЕКТИВНО */}
      {activeSection === 'objective' && (
        <div className="space-y-3">
          {/* Витальные показатели */}
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">Витальные показатели</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { key: 'temperature', label: 'Температура', unit: '°C', placeholder: '36.6' },
                { key: 'pulse',       label: 'Пульс',       unit: 'уд/мин', placeholder: '72' },
                { key: 'bp_systolic', label: 'АД сист.',    unit: 'мм рт.ст.', placeholder: '120' },
                { key: 'bp_diastolic',label: 'АД диаст.',   unit: 'мм рт.ст.', placeholder: '80' },
                { key: 'spo2',        label: 'SpO2',        unit: '%', placeholder: '98' },
                { key: 'weight',      label: 'Вес',         unit: 'кг', placeholder: '70' },
                { key: 'height',      label: 'Рост',        unit: 'см', placeholder: '170' },
                { key: 'glucose',     label: 'Глюкоза',     unit: 'ммоль/л', placeholder: '5.5' },
              ].map(v => (
                <div key={v.key}>
                  <label className="text-xs text-gray-400 mb-0.5 block">{v.label}</label>
                  <div className="flex items-center gap-1">
                    <input type="number" step="0.1"
                      value={(form.vitals as any)?.[v.key] || ''}
                      onChange={e => setVital(v.key, e.target.value)}
                      placeholder={v.placeholder}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                    <span className="text-xs text-gray-400 whitespace-nowrap">{v.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Данные осмотра</label>
            <textarea value={form.objective || ''} onChange={e => set('objective', e.target.value)}
              rows={4} placeholder="Объективные данные осмотра..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
          </div>
        </div>
      )}

      {/* ДИАГНОЗ */}
      {activeSection === 'diagnosis' && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Диагноз МКБ-10</label>
            <ICD10Search
              value={form.icd10_code ? `${form.icd10_code}` : ''}
              onChange={(code) => set('icd10_code', code)}
              placeholder="Введите код или название..."
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Описание диагноза *</label>
            <textarea value={form.diagnosis_text || ''} onChange={e => set('diagnosis_text', e.target.value)}
              rows={2} placeholder="Клинический диагноз..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
          </div>
          <div className="flex gap-3">
            {(['preliminary', 'final'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="diag_type" value={t}
                  checked={form.diagnosis_type === t}
                  onChange={() => set('diagnosis_type', t)}
                  className="accent-blue-600" />
                <span className="text-sm text-gray-700">
                  {t === 'preliminary' ? 'Предварительный' : 'Окончательный'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ЛЕЧЕНИЕ */}
      {activeSection === 'treatment' && (
        <div className="space-y-4">
          {/* Назначения */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Назначения</label>
              <div className="flex gap-2">
                {/* Шаблоны препаратов */}
                {prescTemplates.length > 0 && (
                  <div className="relative group">
                    <button className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg">
                      Из шаблона ▾
                    </button>
                    <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 min-w-48 hidden group-hover:block">
                      {prescTemplates.map(t => (
                        <button key={t.id} onClick={() => addFromTemplate(t)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0">
                          <p className="font-medium">{t.name}</p>
                          <p className="text-gray-400">{t.drug_name} {t.dosage}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => addPrescription()}
                  className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg">
                  + Добавить
                </button>
              </div>
            </div>

            {(form.prescriptions || []).map((p, idx) => (
              <div key={idx} className="border border-gray-200 rounded-xl p-3 mb-2 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <input value={p.drug_name} placeholder="Название препарата *"
                      onChange={e => updatePrescription(idx, 'drug_name', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    <AllergyAlert patientId={patientId} checkDrug={p.drug_name} />
                  </div>
                  <input value={p.dosage} placeholder="Дозировка (500 мг)"
                    onChange={e => updatePrescription(idx, 'dosage', e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <input value={p.frequency} placeholder="Частота (2 р/день)"
                    onChange={e => updatePrescription(idx, 'frequency', e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <input value={p.duration || ''} placeholder="Длительность (7 дней)"
                    onChange={e => updatePrescription(idx, 'duration', e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <input value={p.instructions || ''} placeholder="Примечание (после еды)"
                    onChange={e => updatePrescription(idx, 'instructions', e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button onClick={() => removePrescription(idx)}
                  className="text-xs text-red-400 hover:text-red-600">
                  Удалить
                </button>
              </div>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Рекомендации</label>
            <textarea value={form.recommendations || ''} onChange={e => set('recommendations', e.target.value)}
              rows={3} placeholder="Рекомендации пациенту..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">План лечения</label>
            <textarea value={form.treatment_plan || ''} onChange={e => set('treatment_plan', e.target.value)}
              rows={2} placeholder="План лечения..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Контрольная дата</label>
            <input type="date" value={form.control_date || ''} onChange={e => set('control_date', e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
        </div>
      )}

      {/* Кнопки */}
      <div className="flex gap-3 pt-2 border-t border-gray-100">
        <button onClick={() => save(false)} disabled={saving}
          className="flex-1 border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm hover:bg-gray-50 disabled:opacity-50">
          {saving ? 'Сохранение...' : 'Сохранить черновик'}
        </button>
        <button onClick={() => save(true)} disabled={saving}
          className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          ✏️ Подписать
        </button>
      </div>
    </div>
  )
}
