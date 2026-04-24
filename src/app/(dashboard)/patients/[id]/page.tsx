'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { Patient, Appointment } from '@/types'
import PatientHistory from '@/components/PatientHistory'
import PatientTimeline from '@/components/patients/PatientTimeline'

// ─── constants ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  pending:     { cls: 'bg-gray-100 text-gray-600',     label: 'Ожидает' },
  confirmed:   { cls: 'bg-green-100 text-green-700',   label: 'Подтверждено' },
  arrived:     { cls: 'bg-yellow-100 text-yellow-700', label: 'Пришёл' },
  completed:   { cls: 'bg-blue-100 text-blue-700',     label: 'Завершено' },
  no_show:     { cls: 'bg-red-100 text-red-600',       label: 'Не явился' },
  cancelled:   { cls: 'bg-gray-50 text-gray-400',      label: 'Отменено' },
  rescheduled: { cls: 'bg-purple-100 text-purple-600', label: 'Перенесено' },
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый', active: 'Активный', in_treatment: 'На лечении',
  completed: 'Завершён', lost: 'Потерян', vip: 'VIP',
}
const STATUS_CLR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600', active: 'bg-blue-100 text-blue-700',
  in_treatment: 'bg-green-100 text-green-700', completed: 'bg-purple-100 text-purple-700',
  lost: 'bg-red-100 text-red-600', vip: 'bg-yellow-100 text-yellow-700',
}

// ─── types ────────────────────────────────────────────────────────────────────

type Tab = 'profile' | 'timeline' | 'medcard' | 'lab' | 'finance' | 'history'

// ─── lab order types ──────────────────────────────────────────────────────────

interface LabOrderItem { id: string; name: string }
interface LabOrder {
  id: string
  order_number: string
  status: string
  urgent: boolean
  ordered_at: string
  doctor: { id: string; first_name: string; last_name: string } | null
  items: LabOrderItem[]
}

const LAB_STATUS_CLR: Record<string, string> = {
  ordered: 'bg-gray-100 text-gray-600', agreed: 'bg-blue-50 text-blue-600',
  in_progress: 'bg-blue-100 text-blue-700', ready: 'bg-green-100 text-green-700',
  verified: 'bg-purple-100 text-purple-700', delivered: 'bg-gray-50 text-gray-400',
  rejected: 'bg-red-100 text-red-600', paid: 'bg-teal-100 text-teal-700',
  sample_taken: 'bg-yellow-100 text-yellow-700',
}

// ─── patient lab results (flat history) ──────────────────────────────────────

interface PatientLabResult {
  id: string
  service_id: string | null
  service_name_snapshot: string
  result_value: number | null
  result_text: string | null
  unit_snapshot: string | null
  reference_min: number | null
  reference_max: number | null
  reference_text: string | null
  flag: 'normal' | 'low' | 'high' | 'critical' | null
  result_date: string
  lab_order_id: string | null
}

const FLAG_CLR: Record<string, string> = {
  normal:   'bg-green-100 text-green-700',
  low:      'bg-blue-100 text-blue-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}
const FLAG_RU: Record<string, string> = {
  normal: 'норма', low: '↓ низкий', high: '↑ высокий', critical: '‼ критический',
}

type LabSubTab = 'results' | 'orders'

// ─── payment types ────────────────────────────────────────────────────────────

interface Payment {
  id: string
  amount: number
  method: string
  type: string
  status: string
  paid_at: string | null
  notes: string | null
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Наличные', kaspi: 'Kaspi', halyk: 'Halyk', credit: 'Кредит', balance: 'Депозит',
}
const PAYMENT_TYPE_LABEL: Record<string, string> = {
  payment: 'Оплата', prepayment: 'Предоплата', refund: 'Возврат', writeoff: 'Списание',
}

interface MedicalCard {
  id: string
  patient_id: string
  clinic_id: string
  blood_type: string | null
  rh_factor: string | null
  height_cm: number | null
  weight_kg: number | null
}

type AllergyType = 'drug' | 'food' | 'environmental' | 'other'
type AllergySeverity = 'mild' | 'moderate' | 'severe' | 'life-threatening'

interface Allergy {
  id: string
  patient_id: string
  allergen: string
  type: AllergyType
  severity: AllergySeverity
  reaction: string | null
  confirmed: boolean
  created_at: string
}

type ConditionStatus = 'active' | 'remission' | 'resolved'

interface ChronicCondition {
  id: string
  patient_id: string
  name: string
  icd10_code: string | null
  status: ConditionStatus
  diagnosed_at: string | null
  created_at: string
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const ALLERGY_TYPE_LABEL: Record<AllergyType, string> = {
  drug: 'Лекарство', food: 'Пищевая', environmental: 'Окружающая среда', other: 'Другое',
}
const ALLERGY_TYPE_CLS: Record<AllergyType, string> = {
  drug: 'bg-red-100 text-red-700', food: 'bg-orange-100 text-orange-700',
  environmental: 'bg-green-100 text-green-700', other: 'bg-gray-100 text-gray-600',
}
const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  mild: 'Лёгкая', moderate: 'Средняя', severe: 'Тяжёлая', 'life-threatening': 'Угроза жизни',
}
const CONDITION_STATUS_CLS: Record<ConditionStatus, string> = {
  active: 'bg-red-100 text-red-700',
  remission: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
}
const CONDITION_STATUS_LABEL: Record<ConditionStatus, string> = {
  active: 'Активное', remission: 'Ремиссия', resolved: 'Выздоровление',
}

const BLOOD_TYPES = ['', '0(I)', 'A(II)', 'B(III)', 'AB(IV)']

// ─── OpenVisitButton ──────────────────────────────────────────────────────────
// Позволяет открыть визит прямо с карточки пациента

function OpenVisitButton({ patientId }: { patientId: string }) {
  const supabase = createClient()
  const router   = useRouter()
  const [hasOpen, setHasOpen] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (!patientId) return
    supabase.from('visits').select('id').eq('patient_id', patientId)
      .in('status', ['open', 'in_progress']).maybeSingle()
      .then(({ data }) => { if (data) setHasOpen(data.id); setChecked(true) })
  }, [patientId])

  if (!checked) return null

  if (hasOpen) {
    return (
      <button onClick={() => router.push(`/visits/${hasOpen}`)}
        className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
        ▶ Открытый визит
      </button>
    )
  }

  return (
    <Link href="/visits"
      className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors inline-block">
      + Открыть визит
    </Link>
  )
}

// ─── component ───────────────────────────────────────────────────────────────

export default function PatientCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { profile } = useAuthStore()

  // ── patient / appointments
  const [patient, setPatient] = useState<Patient | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Patient>>({})
  const [saving, setSaving] = useState(false)

  // ── tabs
  const [activeTab, setActiveTab] = useState<Tab>('profile')

  // ── medical card
  const [medCard, setMedCard] = useState<MedicalCard | null>(null)
  const [medForm, setMedForm] = useState<Partial<MedicalCard>>({})
  const [medLoading, setMedLoading] = useState(false)
  const [medSaving, setMedSaving] = useState(false)
  const [medLoaded, setMedLoaded] = useState(false)

  // ── allergies
  const [allergies, setAllergies] = useState<Allergy[]>([])
  const [showAllergyForm, setShowAllergyForm] = useState(false)
  const [allergyForm, setAllergyForm] = useState({
    allergen: '', type: 'drug' as AllergyType, severity: 'mild' as AllergySeverity,
    reaction: '', confirmed: false,
  })
  const [allergySaving, setAllergySaving] = useState(false)

  // ── chronic conditions
  const [conditions, setConditions] = useState<ChronicCondition[]>([])
  const [showConditionForm, setShowConditionForm] = useState(false)
  const [conditionForm, setConditionForm] = useState({
    name: '', icd10_code: '', status: 'active' as ConditionStatus, diagnosed_at: '',
  })
  const [conditionSaving, setConditionSaving] = useState(false)

  // ── lab orders
  const [labOrders, setLabOrders] = useState<LabOrder[]>([])
  const [labLoading, setLabLoading] = useState(false)
  const [labLoaded, setLabLoaded] = useState(false)

  // ── lab subtab + flat results (patient_lab_results)
  const [labSubTab, setLabSubTab] = useState<LabSubTab>('results')
  const [labResults, setLabResults] = useState<PatientLabResult[]>([])
  const [labResultsLoaded, setLabResultsLoaded] = useState(false)
  const [labResultsLoading, setLabResultsLoading] = useState(false)
  const [resFilterService, setResFilterService] = useState<string>('')   // service_id
  const [resFilterFrom, setResFilterFrom] = useState<string>('')         // YYYY-MM-DD
  const [resFilterTo, setResFilterTo] = useState<string>('')             // YYYY-MM-DD
  const [resFilterAbnormalOnly, setResFilterAbnormalOnly] = useState(false)

  // ── finances
  const [payments, setPayments] = useState<Payment[]>([])
  const [finLoading, setFinLoading] = useState(false)
  const [finLoaded, setFinLoaded] = useState(false)

  // ── load patient + appointments
  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase
        .from('appointments')
        .select('*, doctor:doctors(id, first_name, last_name, color)')
        .eq('patient_id', id)
        .order('date', { ascending: false })
        .order('time_start', { ascending: false })
        .limit(20),
    ])
    if (!p.data) { router.push('/patients'); return }
    setPatient(p.data)
    setEditForm(p.data)
    setAppointments((a.data ?? []) as Appointment[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  // ── load medical card data (lazy, on tab activation)
  const loadMedCard = useCallback(async () => {
    if (medLoaded) return
    setMedLoading(true)
    const [mc, al, cc] = await Promise.all([
      supabase.from('medical_cards').select('*').eq('patient_id', id).maybeSingle(),
      supabase.from('allergies').select('*').eq('patient_id', id).order('created_at', { ascending: false }),
      supabase.from('chronic_conditions').select('*').eq('patient_id', id).order('created_at', { ascending: false }),
    ])
    const card = mc.data as MedicalCard | null
    setMedCard(card)
    setMedForm(card ?? { blood_type: '', rh_factor: null, height_cm: null, weight_kg: null })
    setAllergies((al.data ?? []) as Allergy[])
    setConditions((cc.data ?? []) as ChronicCondition[])
    setMedLoaded(true)
    setMedLoading(false)
  }, [id, medLoaded])

  useEffect(() => {
    if (activeTab === 'medcard') loadMedCard()
  }, [activeTab, loadMedCard])

  // ── load lab orders (lazy)
  const loadLab = useCallback(async () => {
    if (labLoaded) return
    setLabLoading(true)
    const { data } = await supabase
      .from('lab_orders')
      .select('*, doctor:doctors(id,first_name,last_name), items:lab_order_items(id,name)')
      .eq('patient_id', id)
      .order('ordered_at', { ascending: false })
      .limit(30)
    setLabOrders((data ?? []) as LabOrder[])
    setLabLoaded(true)
    setLabLoading(false)
  }, [id, labLoaded])

  useEffect(() => {
    if (activeTab === 'lab') loadLab()
  }, [activeTab, loadLab])

  // ── load flat patient_lab_results (lazy)
  const loadLabResults = useCallback(async () => {
    if (labResultsLoaded) return
    setLabResultsLoading(true)
    const { data } = await supabase
      .from('patient_lab_results')
      .select('id, service_id, service_name_snapshot, result_value, result_text, unit_snapshot, reference_min, reference_max, reference_text, flag, result_date, lab_order_id')
      .eq('patient_id', id)
      .order('result_date', { ascending: false })
      .limit(500)
    setLabResults((data ?? []) as PatientLabResult[])
    setLabResultsLoaded(true)
    setLabResultsLoading(false)
  }, [id, labResultsLoaded])

  useEffect(() => {
    if (activeTab === 'lab' && labSubTab === 'results') loadLabResults()
  }, [activeTab, labSubTab, loadLabResults])

  // ── load payments (lazy)
  const loadFinance = useCallback(async () => {
    if (finLoaded) return
    setFinLoading(true)
    const { data } = await supabase
      .from('payments')
      .select('id,amount,method,type,status,paid_at,notes')
      .eq('patient_id', id)
      .order('paid_at', { ascending: false })
      .limit(50)
    setPayments((data ?? []) as Payment[])
    setFinLoaded(true)
    setFinLoading(false)
  }, [id, finLoaded])

  useEffect(() => {
    if (activeTab === 'finance') loadFinance()
  }, [activeTab, loadFinance])

  // ── save patient edit (with validation)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})

  const saveEdit = async () => {
    if (!patient) return
    const errors: Record<string, string> = {}
    if (!editForm.full_name?.trim() || editForm.full_name.trim().length < 3) {
      errors.full_name = 'ФИО должно содержать минимум 3 символа'
    }
    if (editForm.iin && editForm.iin.trim().length !== 12) {
      errors.iin = 'ИИН должен содержать ровно 12 цифр'
    }
    if (editForm.iin && !/^\d{12}$/.test(editForm.iin.trim())) {
      errors.iin = 'ИИН должен состоять только из цифр (12 штук)'
    }
    if (editForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email)) {
      errors.email = 'Укажите корректный email'
    }
    if (editForm.phones?.[0] && editForm.phones[0].trim().length < 7) {
      errors.phone = 'Укажите корректный номер телефона'
    }
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors)
      return
    }
    setEditErrors({})
    setSaving(true)
    const { data } = await supabase
      .from('patients')
      .update({
        full_name: editForm.full_name?.trim(),
        phones: editForm.phones,
        gender: editForm.gender,
        birth_date: editForm.birth_date || null,
        city: editForm.city || null,
        email: editForm.email || null,
        iin: editForm.iin?.trim() || null,
        notes: editForm.notes || null,
        pregnancy_status: editForm.gender === 'female' ? (editForm.pregnancy_status ?? 'unknown') : 'unknown',
        pregnancy_weeks:  editForm.gender === 'female' && editForm.pregnancy_status === 'yes'
                            ? (editForm.pregnancy_weeks ?? null) : null,
        menopause_status: editForm.gender === 'female' ? (editForm.menopause_status ?? null) : null,
        lab_notes:        editForm.lab_notes?.trim() || null,
      })
      .eq('id', patient.id)
      .select()
      .single()
    if (data) { setPatient(data); setEditForm(data) }
    setSaving(false)
    setEditing(false)
  }

  // ── save medical card
  const saveMedCard = async () => {
    if (!profile?.clinic_id) return
    setMedSaving(true)
    const payload = {
      blood_type: medForm.blood_type || null,
      rh_factor: medForm.rh_factor || null,
      height_cm: medForm.height_cm ?? null,
      weight_kg: medForm.weight_kg ?? null,
    }
    if (medCard) {
      const { data } = await supabase
        .from('medical_cards')
        .update(payload)
        .eq('id', medCard.id)
        .select()
        .single()
      if (data) setMedCard(data as MedicalCard)
    } else {
      const { data } = await supabase
        .from('medical_cards')
        .insert({ ...payload, patient_id: id, clinic_id: profile.clinic_id })
        .select()
        .single()
      if (data) setMedCard(data as MedicalCard)
    }
    setMedSaving(false)
  }

  // ── add allergy
  const addAllergy = async () => {
    if (!allergyForm.allergen.trim()) return
    setAllergySaving(true)
    const { data } = await supabase
      .from('allergies')
      .insert({
        patient_id: id,
        allergen: allergyForm.allergen.trim(),
        type: allergyForm.type,
        severity: allergyForm.severity,
        reaction: allergyForm.reaction.trim() || null,
        confirmed: allergyForm.confirmed,
      })
      .select()
      .single()
    if (data) {
      setAllergies(prev => [data as Allergy, ...prev])
      setAllergyForm({ allergen: '', type: 'drug', severity: 'mild', reaction: '', confirmed: false })
      setShowAllergyForm(false)
    }
    setAllergySaving(false)
  }

  // ── add chronic condition
  const addCondition = async () => {
    if (!conditionForm.name.trim()) return
    setConditionSaving(true)
    const { data } = await supabase
      .from('chronic_conditions')
      .insert({
        patient_id: id,
        name: conditionForm.name.trim(),
        icd10_code: conditionForm.icd10_code.trim() || null,
        status: conditionForm.status,
        diagnosed_at: conditionForm.diagnosed_at || null,
      })
      .select()
      .single()
    if (data) {
      setConditions(prev => [data as ChronicCondition, ...prev])
      setConditionForm({ name: '', icd10_code: '', status: 'active', diagnosed_at: '' })
      setShowConditionForm(false)
    }
    setConditionSaving(false)
  }

  // ── render guards
  if (loading) return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  )
  if (!patient) return null

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
  const age = patient.birth_date
    ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear()
    : null

  // ── tab definitions
  const TABS: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Профиль' },
    { key: 'timeline', label: 'Лента' },
    { key: 'medcard', label: 'Медкарта' },
    { key: 'lab', label: 'Анализы' },
    { key: 'finance', label: 'Финансы' },
    { key: 'history', label: 'История' },
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
        ← Пациенты
      </Link>

      {/* ── Header card ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-1">
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">ФИО *</label>
                <input
                  className={inputCls + (editErrors.full_name ? ' border-red-300 ring-1 ring-red-300' : '')}
                  value={editForm.full_name ?? ''}
                  onChange={e => { setEditForm(f => ({ ...f, full_name: e.target.value })); setEditErrors(er => ({ ...er, full_name: '' })) }}
                />
                {editErrors.full_name && <p className="text-xs text-red-500 mt-1">{editErrors.full_name}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Телефон</label>
                <input
                  className={inputCls + (editErrors.phone ? ' border-red-300 ring-1 ring-red-300' : '')}
                  value={editForm.phones?.[0] ?? ''}
                  onChange={e => { setEditForm(f => ({ ...f, phones: e.target.value ? [e.target.value] : [] })); setEditErrors(er => ({ ...er, phone: '' })) }}
                  placeholder="+7 700 000 0000"
                />
                {editErrors.phone && <p className="text-xs text-red-500 mt-1">{editErrors.phone}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Пол</label>
                <select
                  className={inputCls}
                  value={editForm.gender ?? 'other'}
                  onChange={e => setEditForm(f => ({ ...f, gender: e.target.value as 'male' | 'female' | 'other' }))}
                >
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="other">Не указан</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата рождения</label>
                <input
                  type="date"
                  className={inputCls}
                  value={editForm.birth_date ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, birth_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ИИН (12 цифр)</label>
                <input
                  className={inputCls + (editErrors.iin ? ' border-red-300 ring-1 ring-red-300' : '')}
                  value={editForm.iin ?? ''}
                  onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 12); setEditForm(f => ({ ...f, iin: v })); setEditErrors(er => ({ ...er, iin: '' })) }}
                  placeholder="000000000000"
                  maxLength={12}
                  inputMode="numeric"
                />
                {editErrors.iin && <p className="text-xs text-red-500 mt-1">{editErrors.iin}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  className={inputCls + (editErrors.email ? ' border-red-300 ring-1 ring-red-300' : '')}
                  value={editForm.email ?? ''}
                  onChange={e => { setEditForm(f => ({ ...f, email: e.target.value })); setEditErrors(er => ({ ...er, email: '' })) }}
                />
                {editErrors.email && <p className="text-xs text-red-500 mt-1">{editErrors.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Город</label>
                <input
                  className={inputCls}
                  value={editForm.city ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="Актау"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Заметки</label>
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={2}
                  value={editForm.notes ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* ── Лабораторно-релевантные поля ── */}
              {editForm.gender === 'female' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Беременность</label>
                    <select
                      className={inputCls}
                      value={editForm.pregnancy_status ?? 'unknown'}
                      onChange={e => setEditForm(f => ({
                        ...f,
                        pregnancy_status: e.target.value as 'yes' | 'no' | 'unknown',
                        pregnancy_weeks: e.target.value === 'yes' ? (f.pregnancy_weeks ?? null) : null,
                      }))}
                    >
                      <option value="unknown">Неизвестно</option>
                      <option value="no">Нет</option>
                      <option value="yes">🤰 Да</option>
                    </select>
                  </div>
                  {editForm.pregnancy_status === 'yes' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Срок (недель)</label>
                      <input
                        type="number"
                        min={1}
                        max={42}
                        className={inputCls}
                        value={editForm.pregnancy_weeks ?? ''}
                        onChange={e => setEditForm(f => ({
                          ...f,
                          pregnancy_weeks: e.target.value === '' ? null : Number(e.target.value),
                        }))}
                        placeholder="22"
                      />
                    </div>
                  )}
                  <div className={editForm.pregnancy_status === 'yes' ? '' : 'col-span-1'}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Менопауза</label>
                    <select
                      className={inputCls}
                      value={editForm.menopause_status ?? ''}
                      onChange={e => setEditForm(f => ({
                        ...f,
                        menopause_status: (e.target.value || null) as 'no' | 'peri' | 'post' | null,
                      }))}
                    >
                      <option value="">—</option>
                      <option value="no">Нет</option>
                      <option value="peri">Пременопауза</option>
                      <option value="post">Постменопауза</option>
                    </select>
                  </div>
                </>
              )}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Примечание для лаборатории
                  <span className="text-gray-400 font-normal ml-1">(будет видно лаборанту)</span>
                </label>
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={2}
                  value={editForm.lab_notes ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, lab_notes: e.target.value }))}
                  placeholder="Взять строго натощак; склонность к обмороку…"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setEditing(false); setEditForm(patient) }}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium"
              >
                Отмена
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xl flex-shrink-0">
              {patient.full_name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900">{patient.full_name}</h2>
                {patient.is_vip && (
                  <span className="text-xs font-medium bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">VIP ⭐</span>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLR[patient.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[patient.status] ?? patient.status}
                </span>
                {patient.patient_number && (
                  <span className="text-xs text-gray-400 font-mono">{patient.patient_number}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                {patient.phones[0] && <span>📞 {patient.phones[0]}</span>}
                {patient.birth_date && (
                  <span>🎂 {new Date(patient.birth_date).toLocaleDateString('ru-RU')}{age ? ` (${age} лет)` : ''}</span>
                )}
                {patient.gender && patient.gender !== 'other' && (
                  <span>{patient.gender === 'male' ? '♂ Мужской' : '♀ Женский'}</span>
                )}
                {patient.pregnancy_status === 'yes' && (
                  <span className="text-pink-600 font-medium">
                    🤰 Беременна{patient.pregnancy_weeks ? ` (${patient.pregnancy_weeks} нед.)` : ''}
                  </span>
                )}
                {patient.city && <span>📍 {patient.city}</span>}
                {patient.email && <span>✉️ {patient.email}</span>}
                {patient.iin && <span className="font-mono">ИИН: {patient.iin}</span>}
              </div>
              {patient.notes && (
                <p className="mt-2 text-sm text-gray-500 italic">{patient.notes}</p>
              )}
              {patient.tags?.length > 0 && (
                <div className="mt-2 flex gap-1 flex-wrap">
                  {patient.tags.map(t => (
                    <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {/* Quick action: open visit */}
              <OpenVisitButton patientId={patient.id} />
              <div className="flex gap-1.5">
                <Link
                  href={`/patients/${patient.id}/prescriptions`}
                  className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  💊 Рецепты
                </Link>
                <Link
                  href={`/patients/${patient.id}/certificates`}
                  className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  📄 Справки
                </Link>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-gray-400 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                ✏️ Редактировать
              </button>
              {patient.balance_amount > 0 && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">Депозит</p>
                  <p className="text-base font-semibold text-green-600">+{patient.balance_amount.toLocaleString('ru-RU')} ₸</p>
                </div>
              )}
              {patient.debt_amount > 0 && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">Долг</p>
                  <p className="text-base font-semibold text-red-500">-{patient.debt_amount.toLocaleString('ru-RU')} ₸</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Safety alerts banner ─── */}
      {(() => {
        const severe = allergies.filter(a => a.severity === 'severe' || a.severity === 'life-threatening')
        const otherAllergies = allergies.filter(a => a.severity !== 'severe' && a.severity !== 'life-threatening')
        const active = conditions.filter(c => c.status === 'active')
        if (severe.length === 0 && otherAllergies.length === 0 && active.length === 0) return null
        const hasCritical = severe.length > 0
        return (
          <div
            className={`mb-4 rounded-xl border p-3 flex flex-wrap items-start gap-x-4 gap-y-2 ${
              hasCritical
                ? 'bg-red-50 border-red-200'
                : 'bg-amber-50 border-amber-200'
            }`}
          >
            {severe.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-red-700">⚠️ Опасные аллергии:</span>
                {severe.map(a => (
                  <span
                    key={a.id}
                    title={`${ALLERGY_TYPE_LABEL[a.type]} · ${SEVERITY_LABEL[a.severity]}${a.reaction ? ` · ${a.reaction}` : ''}`}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-600 text-white"
                  >
                    {a.allergen}
                  </span>
                ))}
              </div>
            )}
            {otherAllergies.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-amber-800">Аллергии:</span>
                {otherAllergies.map(a => (
                  <span
                    key={a.id}
                    title={`${ALLERGY_TYPE_LABEL[a.type]} · ${SEVERITY_LABEL[a.severity]}${a.reaction ? ` · ${a.reaction}` : ''}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 border border-amber-200"
                  >
                    {a.allergen}
                  </span>
                ))}
              </div>
            )}
            {active.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-gray-700">Хронические:</span>
                {active.map(c => (
                  <span
                    key={c.id}
                    title={c.icd10_code ?? ''}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-white text-gray-700 border border-gray-200"
                  >
                    {c.icd10_code ? <span className="font-mono text-[10px] text-gray-500">{c.icd10_code}</span> : null}
                    {c.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-xl mb-4 px-4 flex gap-0">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Профиль ────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Данные пациента</h3>
          <div className="grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <div>
              <p className="text-xs text-gray-400 mb-0.5">ФИО</p>
              <p className="text-gray-800 font-medium">{patient.full_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Телефон</p>
              <p className="text-gray-800">{patient.phones?.[0] ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Дата рождения</p>
              <p className="text-gray-800">
                {patient.birth_date
                  ? `${new Date(patient.birth_date).toLocaleDateString('ru-RU')}${age ? ` (${age} лет)` : ''}`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Пол</p>
              <p className="text-gray-800">
                {patient.gender === 'male' ? 'Мужской' : patient.gender === 'female' ? 'Женский' : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">ИИН</p>
              <p className="text-gray-800 font-mono">{patient.iin ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Email</p>
              <p className="text-gray-800">{patient.email ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Город</p>
              <p className="text-gray-800">{patient.city ?? '—'}</p>
            </div>
            {patient.notes && (
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-0.5">Заметки</p>
                <p className="text-gray-700 italic">{patient.notes}</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="mt-5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            ✏️ Редактировать профиль
          </button>

          {/* CRM-сделки */}
          <PatientDealsBlock patientId={patient.id} />

          {/* Портал пациента */}
          <PortalShareBlock patient={patient} onChange={setPatient} />
        </div>
      )}

      {/* ── Tab: Медкарта ───────────────────────────────────────────────────── */}
      {activeTab === 'medcard' && (
        <div className="space-y-4">
          {medLoading ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Загрузка медкарты...
            </div>
          ) : (
            <>
              {/* Базовые данные */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-4">Базовые данные</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Группа крови</label>
                    <select
                      className={inputCls}
                      value={medForm.blood_type ?? ''}
                      onChange={e => setMedForm(f => ({ ...f, blood_type: e.target.value }))}
                    >
                      {BLOOD_TYPES.map(bt => (
                        <option key={bt} value={bt}>{bt === '' ? 'Не указана' : bt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Резус-фактор</label>
                    <div className="flex gap-2">
                      {['+', '-'].map(rh => (
                        <button
                          key={rh}
                          onClick={() => setMedForm(f => ({ ...f, rh_factor: f.rh_factor === rh ? null : rh }))}
                          className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                            medForm.rh_factor === rh
                              ? rh === '+' ? 'bg-blue-600 text-white border-blue-600' : 'bg-red-500 text-white border-red-500'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {rh}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Рост, см</label>
                    <input
                      type="number"
                      className={inputCls}
                      value={medForm.height_cm ?? ''}
                      onChange={e => setMedForm(f => ({ ...f, height_cm: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="170"
                      min={50}
                      max={250}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Вес, кг</label>
                    <input
                      type="number"
                      className={inputCls}
                      value={medForm.weight_kg ?? ''}
                      onChange={e => setMedForm(f => ({ ...f, weight_kg: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="70"
                      min={1}
                      max={500}
                    />
                  </div>
                </div>
                <button
                  onClick={saveMedCard}
                  disabled={medSaving}
                  className="mt-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg px-5 py-2 text-sm font-medium"
                >
                  {medSaving ? 'Сохранение...' : 'Сохранить'}
                </button>
              </div>

              {/* Аллергии */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Аллергии</h3>
                  <button
                    onClick={() => setShowAllergyForm(v => !v)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 hover:border-blue-400 px-3 py-1 rounded-lg transition-colors"
                  >
                    + Добавить аллергию
                  </button>
                </div>

                {showAllergyForm && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Аллерген</label>
                        <input
                          className={inputCls}
                          value={allergyForm.allergen}
                          onChange={e => setAllergyForm(f => ({ ...f, allergen: e.target.value }))}
                          placeholder="Название аллергена"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Тип</label>
                        <select
                          className={inputCls}
                          value={allergyForm.type}
                          onChange={e => setAllergyForm(f => ({ ...f, type: e.target.value as AllergyType }))}
                        >
                          <option value="drug">Лекарство</option>
                          <option value="food">Пищевая</option>
                          <option value="environmental">Окружающая среда</option>
                          <option value="other">Другое</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Тяжесть</label>
                        <select
                          className={inputCls}
                          value={allergyForm.severity}
                          onChange={e => setAllergyForm(f => ({ ...f, severity: e.target.value as AllergySeverity }))}
                        >
                          <option value="mild">Лёгкая</option>
                          <option value="moderate">Средняя</option>
                          <option value="severe">Тяжёлая</option>
                          <option value="life-threatening">Угроза жизни</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Реакция</label>
                        <input
                          className={inputCls}
                          value={allergyForm.reaction}
                          onChange={e => setAllergyForm(f => ({ ...f, reaction: e.target.value }))}
                          placeholder="Описание реакции (необязательно)"
                        />
                      </div>
                      <div className="col-span-2 flex items-center gap-2">
                        <input
                          id="allergy-confirmed"
                          type="checkbox"
                          checked={allergyForm.confirmed}
                          onChange={e => setAllergyForm(f => ({ ...f, confirmed: e.target.checked }))}
                          className="rounded border-gray-300"
                        />
                        <label htmlFor="allergy-confirmed" className="text-sm text-gray-600">Подтверждено</label>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAllergyForm(false)}
                        className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-100 rounded-lg py-2 text-sm"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={addAllergy}
                        disabled={allergySaving || !allergyForm.allergen.trim()}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium"
                      >
                        {allergySaving ? 'Добавление...' : 'Добавить'}
                      </button>
                    </div>
                  </div>
                )}

                {allergies.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Аллергии не указаны</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {allergies.map(al => (
                      <span
                        key={al.id}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${ALLERGY_TYPE_CLS[al.type]}`}
                        title={`${ALLERGY_TYPE_LABEL[al.type]} · ${SEVERITY_LABEL[al.severity]}${al.reaction ? ` · ${al.reaction}` : ''}`}
                      >
                        {al.allergen}
                        {(al.severity === 'severe' || al.severity === 'life-threatening') && (
                          <span title={SEVERITY_LABEL[al.severity]}>⚠</span>
                        )}
                        {al.confirmed && (
                          <span className="text-xs opacity-70">✓</span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Хронические заболевания */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-900">Хронические заболевания</h3>
                  <button
                    onClick={() => setShowConditionForm(v => !v)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium border border-blue-200 hover:border-blue-400 px-3 py-1 rounded-lg transition-colors"
                  >
                    + Добавить
                  </button>
                </div>

                {showConditionForm && (
                  <div className="mb-4 p-4 bg-gray-50 rounded-xl border border-gray-100 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Название</label>
                        <input
                          className={inputCls}
                          value={conditionForm.name}
                          onChange={e => setConditionForm(f => ({ ...f, name: e.target.value }))}
                          placeholder="Название заболевания"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Код МКБ-10</label>
                        <input
                          className={inputCls}
                          value={conditionForm.icd10_code}
                          onChange={e => setConditionForm(f => ({ ...f, icd10_code: e.target.value }))}
                          placeholder="E11.9"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Статус</label>
                        <select
                          className={inputCls}
                          value={conditionForm.status}
                          onChange={e => setConditionForm(f => ({ ...f, status: e.target.value as ConditionStatus }))}
                        >
                          <option value="active">Активное</option>
                          <option value="remission">Ремиссия</option>
                          <option value="resolved">Выздоровление</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Дата постановки диагноза</label>
                        <input
                          type="date"
                          className={inputCls}
                          value={conditionForm.diagnosed_at}
                          onChange={e => setConditionForm(f => ({ ...f, diagnosed_at: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowConditionForm(false)}
                        className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-100 rounded-lg py-2 text-sm"
                      >
                        Отмена
                      </button>
                      <button
                        onClick={addCondition}
                        disabled={conditionSaving || !conditionForm.name.trim()}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium"
                      >
                        {conditionSaving ? 'Добавление...' : 'Добавить'}
                      </button>
                    </div>
                  </div>
                )}

                {conditions.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Хронических заболеваний не указано</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {conditions.map(c => (
                      <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-gray-900">{c.name}</p>
                            {c.icd10_code && (
                              <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                                {c.icd10_code}
                              </span>
                            )}
                          </div>
                          {c.diagnosed_at && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              Диагноз: {new Date(c.diagnosed_at).toLocaleDateString('ru-RU')}
                            </p>
                          )}
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full flex-shrink-0 ${CONDITION_STATUS_CLS[c.status]}`}>
                          {CONDITION_STATUS_LABEL[c.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Анализы ────────────────────────────────────────────────────── */}
      {activeTab === 'lab' && (
        <div className="space-y-3">
          {/* subtabs */}
          <div className="bg-white border border-gray-100 rounded-xl px-4 flex gap-0">
            {([
              { key: 'results' as LabSubTab, label: 'Результаты' },
              { key: 'orders' as LabSubTab,  label: 'Заказы' },
            ]).map(t => (
              <button
                key={t.key}
                onClick={() => setLabSubTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  labSubTab === t.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── subtab: РЕЗУЛЬТАТЫ (patient_lab_results) ──────────────────── */}
          {labSubTab === 'results' && (() => {
            // Unique services for filter dropdown
            const serviceOptions = Array.from(
              labResults.reduce((m, r) => {
                const key = r.service_id ?? `name:${r.service_name_snapshot}`
                if (!m.has(key)) m.set(key, { key, label: r.service_name_snapshot })
                return m
              }, new Map<string, { key: string; label: string }>()).values()
            ).sort((a, b) => a.label.localeCompare(b.label, 'ru'))

            const filtered = labResults.filter(r => {
              if (resFilterService) {
                const k = r.service_id ?? `name:${r.service_name_snapshot}`
                if (k !== resFilterService) return false
              }
              if (resFilterFrom && r.result_date < resFilterFrom) return false
              if (resFilterTo) {
                // include whole day
                const cutoff = resFilterTo + 'T23:59:59'
                if (r.result_date > cutoff) return false
              }
              if (resFilterAbnormalOnly && (!r.flag || r.flag === 'normal')) return false
              return true
            })

            return (
              <>
                {/* Filters */}
                <div className="bg-white rounded-xl border border-gray-100 p-4 grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Анализ</label>
                    <select
                      className={inputCls}
                      value={resFilterService}
                      onChange={e => setResFilterService(e.target.value)}
                    >
                      <option value="">Все анализы</option>
                      {serviceOptions.map(o => (
                        <option key={o.key} value={o.key}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">С</label>
                    <input
                      type="date"
                      className={inputCls}
                      value={resFilterFrom}
                      onChange={e => setResFilterFrom(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">По</label>
                    <input
                      type="date"
                      className={inputCls}
                      value={resFilterTo}
                      onChange={e => setResFilterTo(e.target.value)}
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-between">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                      <input
                        type="checkbox"
                        checked={resFilterAbnormalOnly}
                        onChange={e => setResFilterAbnormalOnly(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Только отклонения
                    </label>
                    {(resFilterService || resFilterFrom || resFilterTo || resFilterAbnormalOnly) && (
                      <button
                        onClick={() => {
                          setResFilterService('')
                          setResFilterFrom('')
                          setResFilterTo('')
                          setResFilterAbnormalOnly(false)
                        }}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        Сбросить
                      </button>
                    )}
                  </div>
                </div>

                {/* Dynamics chart: shown when single analyte is selected */}
                {resFilterService && (() => {
                  const points = filtered
                    .filter(r => r.result_value !== null && !isNaN(Number(r.result_value)))
                    .map(r => ({
                      t: new Date(r.result_date).getTime(),
                      v: Number(r.result_value),
                      flag: r.flag,
                      min: r.reference_min,
                      max: r.reference_max,
                      unit: r.unit_snapshot,
                      name: r.service_name_snapshot,
                    }))
                    .sort((a, b) => a.t - b.t)
                  if (points.length < 2) return null
                  const W = 640, H = 160, PL = 40, PR = 12, PT = 16, PB = 24
                  const iw = W - PL - PR, ih = H - PT - PB
                  const tMin = points[0].t, tMax = points[points.length - 1].t
                  const refMin = points[0].min, refMax = points[0].max
                  const values = points.map(p => p.v)
                  let vMin = Math.min(...values), vMax = Math.max(...values)
                  if (refMin != null) vMin = Math.min(vMin, Number(refMin))
                  if (refMax != null) vMax = Math.max(vMax, Number(refMax))
                  if (vMin === vMax) { vMin -= 1; vMax += 1 }
                  const pad = (vMax - vMin) * 0.1
                  vMin -= pad; vMax += pad
                  const xOf = (t: number) => PL + (tMax === tMin ? iw / 2 : ((t - tMin) / (tMax - tMin)) * iw)
                  const yOf = (v: number) => PT + ih - ((v - vMin) / (vMax - vMin)) * ih
                  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ')
                  const unit = points[0].unit ? ` ${points[0].unit}` : ''
                  return (
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-gray-900">📈 Динамика: {points[0].name}</h3>
                        <span className="text-xs text-gray-400">{points.length} значен{points.length === 1 ? 'ие' : points.length < 5 ? 'ия' : 'ий'}</span>
                      </div>
                      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40">
                        {/* Reference band */}
                        {refMin != null && refMax != null && (
                          <rect x={PL} y={yOf(Number(refMax))} width={iw}
                            height={Math.max(0, yOf(Number(refMin)) - yOf(Number(refMax)))}
                            fill="#dcfce7" opacity="0.5" />
                        )}
                        {/* Axes */}
                        <line x1={PL} y1={PT} x2={PL} y2={PT + ih} stroke="#e5e7eb" />
                        <line x1={PL} y1={PT + ih} x2={PL + iw} y2={PT + ih} stroke="#e5e7eb" />
                        {/* Y labels */}
                        <text x={PL - 4} y={PT + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{vMax.toFixed(1)}</text>
                        <text x={PL - 4} y={PT + ih} textAnchor="end" fontSize="10" fill="#9ca3af">{vMin.toFixed(1)}</text>
                        {refMin != null && (
                          <text x={PL - 4} y={yOf(Number(refMin)) + 3} textAnchor="end" fontSize="9" fill="#16a34a">{refMin}</text>
                        )}
                        {refMax != null && (
                          <text x={PL - 4} y={yOf(Number(refMax)) + 3} textAnchor="end" fontSize="9" fill="#16a34a">{refMax}</text>
                        )}
                        {/* Line */}
                        <path d={path} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
                        {/* Points */}
                        {points.map((p, i) => {
                          const color = p.flag === 'high' || p.flag === 'critical' ? '#ea580c'
                                      : p.flag === 'low' ? '#2563eb'
                                      : '#16a34a'
                          return (
                            <g key={i}>
                              <circle cx={xOf(p.t)} cy={yOf(p.v)} r="3.5" fill={color} />
                              <title>{new Date(p.t).toLocaleDateString('ru-RU')}: {p.v}{unit}</title>
                            </g>
                          )
                        })}
                        {/* X labels (first + last) */}
                        <text x={PL} y={H - 6} fontSize="10" fill="#9ca3af">
                          {new Date(tMin).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </text>
                        <text x={PL + iw} y={H - 6} textAnchor="end" fontSize="10" fill="#9ca3af">
                          {new Date(tMax).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </text>
                      </svg>
                    </div>
                  )
                })()}

                {/* List */}
                {labResultsLoading ? (
                  <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
                    Загрузка результатов...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
                    {labResults.length === 0 ? 'Результатов нет' : 'По фильтрам ничего не найдено'}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Результаты ({filtered.length})
                      </h3>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {filtered.map(r => {
                        const dateStr = new Date(r.result_date).toLocaleDateString('ru-RU', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                        })
                        const value = r.result_value !== null
                          ? `${r.result_value}${r.unit_snapshot ? ` ${r.unit_snapshot}` : ''}`
                          : (r.result_text ?? '—')
                        const refRange =
                          r.reference_min !== null && r.reference_max !== null
                            ? `${r.reference_min}–${r.reference_max}${r.unit_snapshot ? ` ${r.unit_snapshot}` : ''}`
                            : (r.reference_text ?? null)
                        return (
                          <div key={r.id} className="px-5 py-3 flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {r.service_name_snapshot}
                                </p>
                                {r.flag && (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FLAG_CLR[r.flag] ?? 'bg-gray-100 text-gray-500'}`}>
                                    {FLAG_RU[r.flag] ?? r.flag}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {dateStr}
                                {refRange && <span className="ml-2">норма: {refRange}</span>}
                              </p>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              <p className={`text-sm font-semibold ${
                                r.flag === 'high' || r.flag === 'critical' ? 'text-orange-600' :
                                r.flag === 'low' ? 'text-blue-600' :
                                'text-gray-900'
                              }`}>
                                {value}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {/* ── subtab: ЗАКАЗЫ (lab_orders) ───────────────────────────────── */}
          {labSubTab === 'orders' && (
            labLoading ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
                Загрузка анализов...
              </div>
            ) : labOrders.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
                Заказов нет
              </div>
            ) : (
              <div className="space-y-3">
                {labOrders.map(order => (
                  <Link key={order.id} href="/lab" className="block bg-white rounded-xl border border-gray-100 p-4 hover:border-gray-200 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-gray-400">{order.order_number}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LAB_STATUS_CLR[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {order.status}
                          </span>
                          {order.urgent && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600">Срочно</span>
                          )}
                        </div>
                        {order.items.length > 0 && (
                          <p className="text-sm text-gray-800 truncate">{order.items.map(i => i.name).join(', ')}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                          {order.doctor && (
                            <span>{order.doctor.last_name} {order.doctor.first_name}</span>
                          )}
                          {order.ordered_at && (
                            <span>{new Date(order.ordered_at).toLocaleDateString('ru-RU')}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* ── Tab: Финансы ────────────────────────────────────────────────────── */}
      {activeTab === 'finance' && (
        <div className="space-y-4">
          {finLoading ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Загрузка финансов...
            </div>
          ) : (
            <>
              {/* Summary card */}
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Сводка</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Оплачено</p>
                    <p className="text-base font-semibold text-gray-900">
                      {payments
                        .filter(p => p.type === 'payment' && p.status === 'completed')
                        .reduce((s, p) => s + p.amount, 0)
                        .toLocaleString('ru-RU')} ₸
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Депозит</p>
                    <p className="text-base font-semibold text-green-600">
                      +{(patient.balance_amount ?? 0).toLocaleString('ru-RU')} ₸
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Долг</p>
                    <p className="text-base font-semibold text-red-500">
                      -{(patient.debt_amount ?? 0).toLocaleString('ru-RU')} ₸
                    </p>
                  </div>
                </div>
              </div>

              {/* Payments table */}
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Платежи</h3>
                </div>
                {payments.length === 0 ? (
                  <div className="p-8 text-center text-sm text-gray-400">Платежей нет</div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {payments.map(p => (
                      <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900">
                            {PAYMENT_TYPE_LABEL[p.type] ?? p.type}
                            {p.method && (
                              <span className="text-gray-400 ml-2 text-xs">{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                            )}
                          </p>
                          {p.paid_at && (
                            <p className="text-xs text-gray-400 mt-0.5">
                              {new Date(p.paid_at).toLocaleDateString('ru-RU')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            p.status === 'completed' ? 'bg-green-100 text-green-700' :
                            p.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>{p.status}</span>
                          <span className={`text-sm font-semibold ${p.type === 'refund' || p.type === 'writeoff' ? 'text-red-500' : 'text-gray-900'}`}>
                            {p.type === 'refund' || p.type === 'writeoff' ? '-' : ''}{p.amount.toLocaleString('ru-RU')} ₸
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab: Лента ──────────────────────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <PatientTimeline patientId={patient.id} />
      )}

      {/* ── Tab: История ────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">История записей</h3>
            <span className="text-xs text-gray-400">{appointments.length} записей</span>
          </div>
          {appointments.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Записей нет</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {appointments.map(a => {
                const st = STATUS_STYLE[a.status] ?? { cls: 'bg-gray-100 text-gray-600', label: a.status }
                const doctor = a.doctor as { last_name: string; first_name: string; color?: string } | undefined
                return (
                  <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(a.date + 'T12:00:00').toLocaleDateString('ru-RU', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                        <span className="text-gray-400 ml-2 font-normal">{a.time_start.slice(0, 5)}</span>
                      </p>
                      {doctor && (
                        <p className="text-xs text-gray-400 mt-0.5">{doctor.last_name} {doctor.first_name}</p>
                      )}
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.cls}`}>
                      {st.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Audit history ── */}
          <div className="mt-4">
            <PatientHistory patientId={patient.id} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PortalShareBlock ────────────────────────────────────────────────────────
// Генерация / отзыв / копирование публичной ссылки на портал пациента.
// Пациент в портале подтверждает дату рождения, поэтому утечка токена
// одна — не даёт доступа к данным, но её всё равно стоит ротировать
// при подозрении на компрометацию.

function PortalShareBlock({
  patient,
  onChange,
}: {
  patient: Patient
  onChange: (p: Patient) => void
}) {
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const token = patient.portal_token ?? null
  const createdAt = patient.portal_token_created_at ?? null

  const url =
    token && typeof window !== 'undefined'
      ? `${window.location.origin}/portal/${token}`
      : ''

  async function rotate() {
    if (busy) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_patient_portal_rotate', {
      p_patient_id: patient.id,
    })
    setBusy(false)
    if (error || !data) {
      alert('Не удалось создать ссылку')
      return
    }
    onChange({
      ...patient,
      portal_token: data as string,
      portal_token_created_at: new Date().toISOString(),
    })
  }

  async function revoke() {
    if (busy) return
    if (!confirm('Отозвать ссылку на портал? Пациент больше не сможет её открыть.')) return
    setBusy(true)
    const { error } = await supabase.rpc('fn_patient_portal_revoke', {
      p_patient_id: patient.id,
    })
    setBusy(false)
    if (error) { alert('Не удалось отозвать ссылку'); return }
    onChange({ ...patient, portal_token: null, portal_token_created_at: null })
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // fallback
      prompt('Скопируйте ссылку:', url)
    }
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Портал пациента</h3>
      <p className="text-xs text-gray-500 mb-3">
        Персональная ссылка для доступа к результатам анализов. Пациент подтверждает
        личность датой рождения.
      </p>

      {!token && (
        <button
          onClick={rotate}
          disabled={busy}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md"
        >
          {busy ? 'Создаём…' : 'Создать ссылку'}
        </button>
      )}

      {token && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-xs font-mono bg-gray-50"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              onClick={copy}
              className="px-3 py-1.5 text-sm border border-gray-200 hover:bg-gray-50 rounded-md"
            >
              {copied ? '✓ Скопировано' : 'Копировать'}
            </button>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {createdAt && (
              <span>Создана: {new Date(createdAt).toLocaleString('ru-RU')}</span>
            )}
            <button
              onClick={rotate}
              disabled={busy}
              className="text-blue-600 hover:text-blue-700 disabled:text-gray-400"
            >
              Обновить токен
            </button>
            <button
              onClick={revoke}
              disabled={busy}
              className="text-red-600 hover:text-red-700 disabled:text-gray-400"
            >
              Отозвать
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── PatientDealsBlock — CRM-сделки пациента + сумма денег по каждой ─────────

interface PatientDealRow {
  deal_id: string
  deal_name: string | null
  deal_amount: number | null
  deal_status: string
  deal_created_at: string
  pipeline_id: string | null
  stage_id: string | null
  appointments_count: number
  visits_completed: number
  visits_count: number
  charges_total: number
  payments_total: number
}

function PatientDealsBlock({ patientId }: { patientId: string }) {
  const [rows, setRows] = useState<PatientDealRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pipelineMap, setPipelineMap] = useState<Record<string, string>>({})
  const [stageMap, setStageMap] = useState<Record<string, { name: string; color: string }>>({})

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const [journeyRes, pipesRes, stagesRes] = await Promise.all([
        supabase.from('v_deal_journey').select('*').eq('patient_id', patientId).order('deal_created_at', { ascending: false }),
        supabase.from('pipelines').select('id,name'),
        supabase.from('pipeline_stages').select('id,name,color'),
      ])
      setRows((journeyRes.data ?? []) as PatientDealRow[])
      setPipelineMap(Object.fromEntries(((pipesRes.data ?? []) as Array<{id:string;name:string}>).map(p => [p.id, p.name])))
      setStageMap(Object.fromEntries(((stagesRes.data ?? []) as Array<{id:string;name:string;color:string}>).map(s => [s.id, { name: s.name, color: s.color }])))
      setLoading(false)
    })()
  }, [patientId])

  if (loading) return null
  if (rows.length === 0) return null

  return (
    <div className="mt-6 bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">CRM-сделки</h3>
        <Link href="/crm" className="text-xs text-blue-600 hover:underline">→ канбан</Link>
      </div>
      <div className="space-y-2">
        {rows.map(r => {
          const stage = r.stage_id ? stageMap[r.stage_id] : null
          return (
            <div key={r.deal_id} className="flex items-center gap-3 text-sm border border-gray-100 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: stage?.color ?? '#94a3b8' }} />
              <div className="flex-1 min-w-0">
                <div className="truncate">{r.deal_name || 'Без названия'}</div>
                <div className="text-xs text-gray-500">
                  {r.pipeline_id ? pipelineMap[r.pipeline_id] : '—'} · {stage?.name ?? r.deal_status}
                </div>
              </div>
              <div className="text-xs text-gray-500 text-right shrink-0">
                приёмов {r.appointments_count} · визитов {r.visits_completed}/{r.visits_count}
              </div>
              <div className="text-xs font-mono text-right shrink-0 w-28">
                {Number(r.payments_total).toLocaleString('ru-RU')} / {Number(r.charges_total).toLocaleString('ru-RU')} ₸
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
