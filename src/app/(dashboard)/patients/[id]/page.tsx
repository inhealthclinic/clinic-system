'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { Patient, Appointment } from '@/types'

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

type Tab = 'profile' | 'medcard' | 'lab' | 'finance' | 'history'

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

  // ── save patient edit
  const saveEdit = async () => {
    if (!patient) return
    setSaving(true)
    const { data } = await supabase
      .from('patients')
      .update({
        full_name: editForm.full_name,
        phones: editForm.phones,
        gender: editForm.gender,
        birth_date: editForm.birth_date || null,
        city: editForm.city || null,
        email: editForm.email || null,
        iin: editForm.iin || null,
        notes: editForm.notes || null,
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
                <label className="block text-xs font-medium text-gray-500 mb-1">ФИО</label>
                <input
                  className={inputCls}
                  value={editForm.full_name ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Телефон</label>
                <input
                  className={inputCls}
                  value={editForm.phones?.[0] ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, phones: e.target.value ? [e.target.value] : [] }))}
                  placeholder="+7 700 000 0000"
                />
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
                <label className="block text-xs font-medium text-gray-500 mb-1">ИИН</label>
                <input
                  className={inputCls}
                  value={editForm.iin ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, iin: e.target.value }))}
                  placeholder="000000000000"
                  maxLength={12}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={editForm.email ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                />
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
          {labLoading ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Загрузка анализов...
            </div>
          ) : labOrders.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
              Анализов нет
            </div>
          ) : (
            labOrders.map(order => (
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
            ))
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
        </div>
      )}
    </div>
  )
}
