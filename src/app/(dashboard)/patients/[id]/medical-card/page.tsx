'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── types ────────────────────────────────────────────────────────────────────

interface MedCard {
  id: string
  blood_type: string | null
  rh_factor: string | null
  height_cm: number | null
  weight_kg: number | null
}

interface Allergy {
  id: string
  allergen: string
  type: string | null
  severity: string | null
  reaction: string | null
  confirmed: boolean
  noted_at: string | null
  notes: string | null
}

interface ChronicCondition {
  id: string
  icd10_code: string | null
  name: string
  diagnosed_at: string | null
  status: string
  notes: string | null
}

interface FamilyHistory {
  id: string
  relation: string
  condition: string
  icd10_code: string | null
  notes: string | null
}

interface SocialHistory {
  smoking: string
  smoking_packs: number | null
  alcohol: string
  drugs: string
  occupation: string | null
  notes: string | null
}

interface Vaccination {
  id: string
  vaccine_name: string
  dose_number: number
  administered_at: string
  next_due_at: string | null
  batch_number: string | null
  notes: string | null
}

interface MedRecord {
  id: string
  visit_id: string
  created_at: string
  icd10_code: string | null
  diagnosis_text: string | null
  diagnosis_type: string
  complaints: string | null
  is_signed: boolean
  prescription_number: string | null
  prescriptions: Prescription[]
  doctor: { first_name: string; last_name: string } | null
}

interface Prescription {
  drug_name: string
  dosage: string
  form?: string
  frequency: string
  duration?: string
  instructions?: string
}

interface Patient {
  id: string
  full_name: string
  birth_date: string | null
}

// ─── constants ────────────────────────────────────────────────────────────────

const SEVERITY_CLR: Record<string, string> = {
  mild:             'bg-yellow-50 text-yellow-700 border-yellow-200',
  moderate:         'bg-orange-50 text-orange-700 border-orange-200',
  severe:           'bg-red-50 text-red-700 border-red-200',
  'life-threatening': 'bg-red-100 text-red-800 border-red-300 font-semibold',
}
const SEVERITY_LABEL: Record<string, string> = {
  mild: 'Лёгкая', moderate: 'Умеренная', severe: 'Тяжёлая', 'life-threatening': 'Угроза жизни',
}
const ALLERGY_TYPE_LABEL: Record<string, string> = {
  drug: 'Лекарственная', food: 'Пищевая', environmental: 'Окружающая среда', other: 'Другое',
}
const RELATION_LABEL: Record<string, string> = {
  father: 'Отец', mother: 'Мать', sibling: 'Брат/сестра', grandparent: 'Дедушка/бабушка', other: 'Другое',
}
const CHRONIC_STATUS_CLR: Record<string, string> = {
  active:    'bg-red-50 text-red-700',
  remission: 'bg-yellow-50 text-yellow-700',
  resolved:  'bg-green-50 text-green-700',
}
const CHRONIC_STATUS_LABEL: Record<string, string> = {
  active: 'Активное', remission: 'Ремиссия', resolved: 'Разрешено',
}

type Section = 'vitals' | 'allergies' | 'chronic' | 'family' | 'social' | 'vaccinations' | 'records'

// ─── helper ───────────────────────────────────────────────────────────────────

function bmi(h: number | null, w: number | null) {
  if (!h || !w) return null
  const b = w / ((h / 100) ** 2)
  return b.toFixed(1)
}

// ─── AddAllergyModal ──────────────────────────────────────────────────────────

function AddAllergyModal({ patientId, clinicId, onClose, onSaved }: {
  patientId: string; clinicId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    allergen: '', type: 'drug', severity: 'moderate', reaction: '', confirmed: false, noted_at: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('allergies').insert({
      clinic_id: clinicId, patient_id: patientId,
      allergen: form.allergen.trim(),
      type: form.type, severity: form.severity,
      reaction: form.reaction.trim() || null,
      confirmed: form.confirmed,
      noted_at: form.noted_at || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    onSaved()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <Modal title="Добавить аллергию" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Аллерген *</label>
          <input className={inp} placeholder="Пенициллин" value={form.allergen}
            onChange={e => setForm(p => ({ ...p, allergen: e.target.value }))} required autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Тип</label>
            <select className={inp} value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
              {Object.entries(ALLERGY_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Тяжесть</label>
            <select className={inp} value={form.severity} onChange={e => setForm(p => ({ ...p, severity: e.target.value }))}>
              {Object.entries(SEVERITY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Реакция</label>
          <input className={inp} placeholder="Крапивница, отёк..." value={form.reaction}
            onChange={e => setForm(p => ({ ...p, reaction: e.target.value }))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Дата выявления</label>
            <input type="date" className={inp} value={form.noted_at}
              onChange={e => setForm(p => ({ ...p, noted_at: e.target.value }))} />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.confirmed}
                onChange={e => setForm(p => ({ ...p, confirmed: e.target.checked }))}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-sm text-gray-700">Подтверждена</span>
            </label>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Заметки</label>
          <textarea className={inp + ' resize-none'} rows={2} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <ModalFooter onClose={onClose} saving={saving} saveLabel="Добавить" />
      </form>
    </Modal>
  )
}

// ─── AddChronicModal ──────────────────────────────────────────────────────────

function AddChronicModal({ patientId, clinicId, onClose, onSaved }: {
  patientId: string; clinicId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({ name: '', icd10_code: '', diagnosed_at: '', status: 'active', notes: '' })
  const [saving, setSaving] = useState(false)
  const [icdQuery, setIcdQuery] = useState('')
  const [icdResults, setIcdResults] = useState<{ code: string; name: string }[]>([])

  useEffect(() => {
    if (icdQuery.length < 2) { setIcdResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('icd10_codes').select('code, name')
        .or(`code.ilike.${icdQuery}%,name.ilike.%${icdQuery}%`).limit(8)
      setIcdResults(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [icdQuery])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('chronic_conditions').insert({
      clinic_id: clinicId, patient_id: patientId,
      name: form.name.trim(),
      icd10_code: form.icd10_code.trim() || null,
      diagnosed_at: form.diagnosed_at || null,
      status: form.status,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    onSaved()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <Modal title="Хроническое заболевание" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Название *</label>
          <input className={inp} placeholder="Сахарный диабет 2 типа" value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required autoFocus />
        </div>
        <div className="relative">
          <label className="text-xs font-medium text-gray-600 block mb-1">МКБ-10 код</label>
          <input className={inp} placeholder="E11 — поиск по коду или названию" value={icdQuery}
            onChange={e => { setIcdQuery(e.target.value); setForm(p => ({ ...p, icd10_code: '' })) }} />
          {form.icd10_code && (
            <p className="text-xs text-blue-600 mt-1">✓ {form.icd10_code}</p>
          )}
          {icdResults.length > 0 && !form.icd10_code && (
            <div className="absolute z-10 top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-40 overflow-y-auto">
              {icdResults.map(r => (
                <button key={r.code} type="button"
                  onClick={() => { setForm(p => ({ ...p, icd10_code: r.code })); setIcdQuery(`${r.code} — ${r.name}`); setIcdResults([]) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors">
                  <span className="font-mono font-medium text-blue-600">{r.code}</span>
                  <span className="text-gray-600 ml-2">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Дата выявления</label>
            <input type="date" className={inp} value={form.diagnosed_at}
              onChange={e => setForm(p => ({ ...p, diagnosed_at: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Статус</label>
            <select className={inp} value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              {Object.entries(CHRONIC_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Заметки</label>
          <textarea className={inp + ' resize-none'} rows={2} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <ModalFooter onClose={onClose} saving={saving} saveLabel="Добавить" />
      </form>
    </Modal>
  )
}

// ─── AddFamilyModal ───────────────────────────────────────────────────────────

function AddFamilyModal({ patientId, clinicId, onClose, onSaved }: {
  patientId: string; clinicId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({ relation: 'father', condition: '', icd10_code: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('family_history').insert({
      clinic_id: clinicId, patient_id: patientId,
      relation: form.relation, condition: form.condition.trim(),
      icd10_code: form.icd10_code.trim() || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    onSaved()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <Modal title="Семейный анамнез" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Родственник</label>
            <select className={inp} value={form.relation} onChange={e => setForm(p => ({ ...p, relation: e.target.value }))}>
              {Object.entries(RELATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">МКБ-10 (опц.)</label>
            <input className={inp} placeholder="E11" value={form.icd10_code}
              onChange={e => setForm(p => ({ ...p, icd10_code: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Заболевание *</label>
          <input className={inp} placeholder="Сахарный диабет 2 типа" value={form.condition}
            onChange={e => setForm(p => ({ ...p, condition: e.target.value }))} required autoFocus />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Заметки</label>
          <textarea className={inp + ' resize-none'} rows={2} value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
        <ModalFooter onClose={onClose} saving={saving} saveLabel="Добавить" />
      </form>
    </Modal>
  )
}

// ─── AddVaccinationModal ──────────────────────────────────────────────────────

function AddVaccinationModal({ patientId, clinicId, onClose, onSaved }: {
  patientId: string; clinicId: string; onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    vaccine_name: '', dose_number: 1, administered_at: '', next_due_at: '', batch_number: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('vaccinations').insert({
      clinic_id: clinicId, patient_id: patientId,
      vaccine_name: form.vaccine_name.trim(),
      dose_number: form.dose_number,
      administered_at: form.administered_at,
      next_due_at: form.next_due_at || null,
      batch_number: form.batch_number.trim() || null,
      notes: form.notes.trim() || null,
    })
    setSaving(false)
    onSaved()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'
  return (
    <Modal title="Добавить прививку" onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Вакцина *</label>
          <input className={inp} placeholder="Гриппол Плюс" value={form.vaccine_name}
            onChange={e => setForm(p => ({ ...p, vaccine_name: e.target.value }))} required autoFocus />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Доза</label>
            <input type="number" min={1} max={10} className={inp} value={form.dose_number}
              onChange={e => setForm(p => ({ ...p, dose_number: Number(e.target.value) }))} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-gray-600 block mb-1">Дата введения *</label>
            <input type="date" className={inp} value={form.administered_at}
              onChange={e => setForm(p => ({ ...p, administered_at: e.target.value }))} required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Следующая доза</label>
            <input type="date" className={inp} value={form.next_due_at}
              onChange={e => setForm(p => ({ ...p, next_due_at: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Серия</label>
            <input className={inp} placeholder="B2401" value={form.batch_number}
              onChange={e => setForm(p => ({ ...p, batch_number: e.target.value }))} />
          </div>
        </div>
        <ModalFooter onClose={onClose} saving={saving} saveLabel="Добавить" />
      </form>
    </Modal>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalFooter({ onClose, saving, saveLabel }: { onClose: () => void; saving: boolean; saveLabel: string }) {
  return (
    <div className="flex gap-3 pt-1">
      <button type="button" onClick={onClose} disabled={saving}
        className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
        Отмена
      </button>
      <button type="submit" disabled={saving}
        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
        {saving ? 'Сохранение...' : saveLabel}
      </button>
    </div>
  )
}

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
      <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
      {label}
    </button>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MedicalCardPage() {
  const { id: patientId } = useParams<{ id: string }>()
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [patient, setPatient]           = useState<Patient | null>(null)
  const [medCard, setMedCard]           = useState<MedCard | null>(null)
  const [allergies, setAllergies]       = useState<Allergy[]>([])
  const [chronic, setChronic]           = useState<ChronicCondition[]>([])
  const [family, setFamily]             = useState<FamilyHistory[]>([])
  const [social, setSocial]             = useState<SocialHistory | null>(null)
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([])
  const [records, setRecords]           = useState<MedRecord[]>([])
  const [loading, setLoading]           = useState(true)

  // editing
  const [editVitals, setEditVitals]   = useState(false)
  const [editSocial, setEditSocial]   = useState(false)
  const [vitalsForm, setVitalsForm]   = useState({ blood_type: '', rh_factor: '', height_cm: '', weight_kg: '' })
  const [socialForm, setSocialForm]   = useState<Omit<SocialHistory, never>>({ smoking: 'never', smoking_packs: null, alcohol: 'none', drugs: 'none', occupation: null, notes: null })
  const [savingVitals, setSavingVitals] = useState(false)
  const [savingSocial, setSavingSocial] = useState(false)

  // modals
  const [showAddAllergy, setShowAddAllergy]     = useState(false)
  const [showAddChronic, setShowAddChronic]     = useState(false)
  const [showAddFamily, setShowAddFamily]       = useState(false)
  const [showAddVacc, setShowAddVacc]           = useState(false)
  const [expandedRecord, setExpandedRecord]     = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!patientId) return
    setLoading(true)

    const [
      { data: pat },
      { data: card },
      { data: alrg },
      { data: chr },
      { data: fam },
      { data: soc },
      { data: vacc },
      { data: rec },
    ] = await Promise.all([
      supabase.from('patients').select('id, full_name, birth_date').eq('id', patientId).single(),
      supabase.from('medical_cards').select('*').eq('patient_id', patientId).maybeSingle(),
      supabase.from('allergies').select('*').eq('patient_id', patientId).order('severity'),
      supabase.from('chronic_conditions').select('*').eq('patient_id', patientId).order('diagnosed_at', { ascending: false }),
      supabase.from('family_history').select('*').eq('patient_id', patientId),
      supabase.from('social_history').select('*').eq('patient_id', patientId).maybeSingle(),
      supabase.from('vaccinations').select('*').eq('patient_id', patientId).order('administered_at', { ascending: false }),
      supabase.from('medical_records')
        .select('id, visit_id, created_at, icd10_code, diagnosis_text, diagnosis_type, complaints, is_signed, prescription_number, prescriptions, doctor:doctors(first_name, last_name)')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(30),
    ])

    setPatient(pat)
    setMedCard(card ?? null)
    setAllergies((alrg ?? []) as Allergy[])
    setChronic((chr ?? []) as ChronicCondition[])
    setFamily((fam ?? []) as FamilyHistory[])
    setSocial(soc ?? null)
    setVaccinations((vacc ?? []) as Vaccination[])
    setRecords((rec ?? []) as unknown as MedRecord[])

    // init vitals form
    if (card) {
      setVitalsForm({
        blood_type: card.blood_type ?? '',
        rh_factor: card.rh_factor ?? '',
        height_cm: card.height_cm?.toString() ?? '',
        weight_kg: card.weight_kg?.toString() ?? '',
      })
    }
    if (soc) setSocialForm(soc)

    setLoading(false)
  }, [patientId])

  useEffect(() => { load() }, [load])

  // ── save vitals ──────────────────────────────────────────────────────────────
  const saveVitals = async () => {
    setSavingVitals(true)
    const payload = {
      clinic_id: clinicId,
      patient_id: patientId,
      blood_type: vitalsForm.blood_type || null,
      rh_factor: vitalsForm.rh_factor || null,
      height_cm: vitalsForm.height_cm ? parseFloat(vitalsForm.height_cm) : null,
      weight_kg: vitalsForm.weight_kg ? parseFloat(vitalsForm.weight_kg) : null,
    }
    if (medCard) {
      await supabase.from('medical_cards').update(payload).eq('id', medCard.id)
    } else {
      await supabase.from('medical_cards').insert(payload)
    }
    setSavingVitals(false)
    setEditVitals(false)
    load()
  }

  // ── save social ──────────────────────────────────────────────────────────────
  const saveSocial = async () => {
    setSavingSocial(true)
    const payload = { clinic_id: clinicId, patient_id: patientId, ...socialForm }
    if (social) {
      await supabase.from('social_history').update(payload).eq('patient_id', patientId as string)
    } else {
      await supabase.from('social_history').insert(payload)
    }
    setSavingSocial(false)
    setEditSocial(false)
    load()
  }

  const deleteAllergy = async (id: string) => {
    await supabase.from('allergies').delete().eq('id', id)
    setAllergies(prev => prev.filter(a => a.id !== id))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-sm text-gray-400">Загрузка...</div>
  )

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500'

  return (
    <div className="max-w-3xl mx-auto py-6 space-y-5">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link href={`/patients/${patientId}`} className="text-blue-600 hover:underline">
          {patient?.full_name ?? 'Пациент'}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-500">Медицинская карта</span>
      </div>

      {/* ── 1. Витальные / базовые данные ───────────────────────────────────── */}
      <SectionCard
        title="Базовые данные"
        action={
          editVitals
            ? <div className="flex gap-2">
                <button onClick={() => setEditVitals(false)} className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
                <button onClick={saveVitals} disabled={savingVitals}
                  className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg font-medium disabled:opacity-50">
                  {savingVitals ? '...' : 'Сохранить'}
                </button>
              </div>
            : <button onClick={() => setEditVitals(true)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium">Изменить</button>
        }
      >
        {editVitals ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Группа крови</label>
              <select className={inp} value={vitalsForm.blood_type} onChange={e => setVitalsForm(p => ({ ...p, blood_type: e.target.value }))}>
                <option value="">—</option>
                {['0(I)','A(II)','B(III)','AB(IV)'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Резус</label>
              <select className={inp} value={vitalsForm.rh_factor} onChange={e => setVitalsForm(p => ({ ...p, rh_factor: e.target.value }))}>
                <option value="">—</option>
                <option value="+">Rh+</option>
                <option value="-">Rh−</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Рост (см)</label>
              <input type="number" className={inp} placeholder="170" value={vitalsForm.height_cm}
                onChange={e => setVitalsForm(p => ({ ...p, height_cm: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Вес (кг)</label>
              <input type="number" className={inp} placeholder="70" value={vitalsForm.weight_kg}
                onChange={e => setVitalsForm(p => ({ ...p, weight_kg: e.target.value }))} />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: 'Группа крови', value: medCard?.blood_type ?? '—' },
              { label: 'Резус-фактор', value: medCard?.rh_factor ? `Rh${medCard.rh_factor}` : '—' },
              { label: 'Рост', value: medCard?.height_cm ? `${medCard.height_cm} см` : '—' },
              { label: 'Вес', value: medCard?.weight_kg ? `${medCard.weight_kg} кг` : '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                <p className="text-sm font-medium text-gray-900">{value}</p>
              </div>
            ))}
            {medCard?.height_cm && medCard?.weight_kg && (
              <div className="col-span-2 sm:col-span-4 mt-2 pt-3 border-t border-gray-50">
                <p className="text-xs text-gray-400 mb-0.5">ИМТ</p>
                <p className="text-sm font-medium text-gray-900">
                  {bmi(medCard.height_cm, medCard.weight_kg)}
                  <span className="text-xs text-gray-400 ml-1.5">кг/м²</span>
                </p>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── 2. Аллергии ─────────────────────────────────────────────────────── */}
      <SectionCard
        title={`Аллергии${allergies.length ? ` (${allergies.length})` : ''}`}
        action={<AddBtn onClick={() => setShowAddAllergy(true)} label="Добавить" />}
      >
        {allergies.length === 0 ? (
          <p className="text-sm text-gray-300 italic">Аллергии не указаны</p>
        ) : (
          <div className="space-y-2">
            {allergies.map(a => (
              <div key={a.id} className={`flex items-start justify-between rounded-xl border px-4 py-3 ${SEVERITY_CLR[a.severity ?? 'mild'] ?? 'bg-gray-50 border-gray-200'}`}>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{a.allergen}</span>
                    {a.confirmed && <span className="text-xs bg-white/60 rounded px-1.5 py-0.5 border border-current/20">✓ подтверждена</span>}
                    <span className="text-xs opacity-70">{ALLERGY_TYPE_LABEL[a.type ?? ''] ?? a.type}</span>
                  </div>
                  {a.reaction && <p className="text-xs mt-0.5 opacity-80">Реакция: {a.reaction}</p>}
                  {a.severity && <p className="text-xs mt-0.5 opacity-70">{SEVERITY_LABEL[a.severity]}</p>}
                  {a.noted_at && <p className="text-xs mt-0.5 opacity-60">Выявлена: {new Date(a.noted_at).toLocaleDateString('ru-RU')}</p>}
                </div>
                <button onClick={() => deleteAllergy(a.id)} className="ml-2 opacity-40 hover:opacity-80 transition-opacity flex-shrink-0">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
                    <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── 3. Хронические заболевания ──────────────────────────────────────── */}
      <SectionCard
        title={`Хронические заболевания${chronic.length ? ` (${chronic.length})` : ''}`}
        action={<AddBtn onClick={() => setShowAddChronic(true)} label="Добавить" />}
      >
        {chronic.length === 0 ? (
          <p className="text-sm text-gray-300 italic">Хронические заболевания не указаны</p>
        ) : (
          <div className="space-y-2">
            {chronic.map(c => (
              <div key={c.id} className="flex items-start justify-between rounded-xl bg-gray-50 px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {c.icd10_code && (
                      <span className="text-xs font-mono font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{c.icd10_code}</span>
                    )}
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${CHRONIC_STATUS_CLR[c.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {CHRONIC_STATUS_LABEL[c.status] ?? c.status}
                    </span>
                  </div>
                  {c.diagnosed_at && (
                    <p className="text-xs text-gray-400 mt-0.5">Диагностировано: {new Date(c.diagnosed_at).toLocaleDateString('ru-RU')}</p>
                  )}
                  {c.notes && <p className="text-xs text-gray-500 mt-0.5">{c.notes}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── 4. Семейный анамнез ─────────────────────────────────────────────── */}
      <SectionCard
        title={`Семейный анамнез${family.length ? ` (${family.length})` : ''}`}
        action={<AddBtn onClick={() => setShowAddFamily(true)} label="Добавить" />}
      >
        {family.length === 0 ? (
          <p className="text-sm text-gray-300 italic">Семейный анамнез не указан</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {family.map(f => (
              <div key={f.id} className="py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-start gap-3">
                  <span className="text-xs font-medium text-gray-500 w-24 flex-shrink-0 mt-0.5">{RELATION_LABEL[f.relation] ?? f.relation}</span>
                  <div>
                    <span className="text-sm text-gray-900">{f.condition}</span>
                    {f.icd10_code && <span className="text-xs font-mono text-blue-500 ml-2">{f.icd10_code}</span>}
                    {f.notes && <p className="text-xs text-gray-400 mt-0.5">{f.notes}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── 5. Социальный анамнез ───────────────────────────────────────────── */}
      <SectionCard
        title="Социальный анамнез"
        action={
          editSocial
            ? <div className="flex gap-2">
                <button onClick={() => setEditSocial(false)} className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
                <button onClick={saveSocial} disabled={savingSocial}
                  className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg font-medium disabled:opacity-50">
                  {savingSocial ? '...' : 'Сохранить'}
                </button>
              </div>
            : <button onClick={() => setEditSocial(true)}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium">Изменить</button>
        }
      >
        {editSocial ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Курение</label>
              <select className={inp} value={socialForm.smoking ?? 'never'}
                onChange={e => setSocialForm(p => ({ ...p, smoking: e.target.value }))}>
                <option value="never">Никогда</option>
                <option value="former">Бывший курильщик</option>
                <option value="current">Курит</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Алкоголь</label>
              <select className={inp} value={socialForm.alcohol ?? 'none'}
                onChange={e => setSocialForm(p => ({ ...p, alcohol: e.target.value }))}>
                <option value="none">Не употребляет</option>
                <option value="occasional">Редко</option>
                <option value="regular">Регулярно</option>
                <option value="heavy">Злоупотребляет</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Профессия</label>
              <input className={inp} placeholder="Учитель" value={socialForm.occupation ?? ''}
                onChange={e => setSocialForm(p => ({ ...p, occupation: e.target.value || null }))} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 block mb-1">Пачки/год (курение)</label>
              <input type="number" step="0.1" className={inp} placeholder="0.5"
                value={socialForm.smoking_packs ?? ''}
                onChange={e => setSocialForm(p => ({ ...p, smoking_packs: e.target.value ? parseFloat(e.target.value) : null }))} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-gray-500 block mb-1">Заметки</label>
              <textarea className={inp + ' resize-none'} rows={2} value={socialForm.notes ?? ''}
                onChange={e => setSocialForm(p => ({ ...p, notes: e.target.value || null }))} />
            </div>
          </div>
        ) : !social ? (
          <p className="text-sm text-gray-300 italic">Не заполнено</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {[
              { label: 'Курение',    value: { never: 'Никогда', former: 'Бывший', current: 'Курит' }[social.smoking] ?? '—' },
              { label: 'Алкоголь',  value: { none: 'Нет', occasional: 'Редко', regular: 'Регулярно', heavy: 'Злоупотребляет' }[social.alcohol] ?? '—' },
              { label: 'Профессия', value: social.occupation ?? '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                <p className="text-sm text-gray-800">{value}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── 6. Прививки ─────────────────────────────────────────────────────── */}
      <SectionCard
        title={`Прививки${vaccinations.length ? ` (${vaccinations.length})` : ''}`}
        action={<AddBtn onClick={() => setShowAddVacc(true)} label="Добавить" />}
      >
        {vaccinations.length === 0 ? (
          <p className="text-sm text-gray-300 italic">Прививки не добавлены</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {vaccinations.map(v => (
              <div key={v.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{v.vaccine_name}</span>
                    <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">Доза {v.dose_number}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(v.administered_at).toLocaleDateString('ru-RU')}
                    {v.next_due_at && (
                      <span className="ml-2 text-orange-500">→ {new Date(v.next_due_at).toLocaleDateString('ru-RU')}</span>
                    )}
                    {v.batch_number && <span className="ml-2 text-gray-300">#{v.batch_number}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── 7. Записи приёма ────────────────────────────────────────────────── */}
      <SectionCard title={`Записи приёма${records.length ? ` (${records.length})` : ''}`}>
        {records.length === 0 ? (
          <p className="text-sm text-gray-300 italic">Приёмы не найдены</p>
        ) : (
          <div className="space-y-2">
            {records.map(r => {
              const expanded = expandedRecord === r.id
              const prescs = Array.isArray(r.prescriptions) ? r.prescriptions : []
              return (
                <div key={r.id} className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedRecord(prev => prev === r.id ? null : r.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-medium text-gray-900 flex-shrink-0">
                        {new Date(r.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {r.icd10_code && (
                        <span className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex-shrink-0">{r.icd10_code}</span>
                      )}
                      {r.diagnosis_text && (
                        <span className="text-sm text-gray-600 truncate">{r.diagnosis_text}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      {r.is_signed && (
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ подписано</span>
                      )}
                      {r.doctor && (
                        <span className="text-xs text-gray-400 hidden sm:block">
                          {r.doctor.last_name} {r.doctor.first_name[0]}.
                        </span>
                      )}
                      <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                        className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
                        <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </button>

                  {expanded && (
                    <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50 space-y-3">
                      {r.complaints && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Жалобы</p>
                          <p className="text-sm text-gray-700">{r.complaints}</p>
                        </div>
                      )}
                      {r.diagnosis_text && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                            Диагноз {r.diagnosis_type === 'preliminary' ? '(предварительный)' : '(окончательный)'}
                          </p>
                          <p className="text-sm text-gray-700">
                            {r.icd10_code && <span className="font-mono text-blue-600 mr-2">{r.icd10_code}</span>}
                            {r.diagnosis_text}
                          </p>
                        </div>
                      )}
                      {prescs.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Назначения</p>
                          <div className="space-y-1">
                            {prescs.map((p: Prescription, i: number) => (
                              <div key={i} className="flex items-start gap-2">
                                <span className="text-blue-400 text-sm flex-shrink-0">•</span>
                                <p className="text-sm text-gray-700">
                                  <span className="font-medium">{p.drug_name}</span>
                                  {p.dosage && <span className="text-gray-500"> {p.dosage}</span>}
                                  {p.frequency && <span className="text-gray-400"> — {p.frequency}</span>}
                                  {p.duration && <span className="text-gray-400">, {p.duration}</span>}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-gray-400">
                          {r.doctor ? `${r.doctor.last_name} ${r.doctor.first_name}` : '—'}
                          {r.prescription_number && <span className="ml-2 font-mono">#{r.prescription_number}</span>}
                        </span>
                        <Link href={`/visits/${r.visit_id}`}
                          className="text-xs text-blue-600 hover:underline">
                          Открыть визит →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Modals */}
      {showAddAllergy   && <AddAllergyModal    patientId={patientId} clinicId={clinicId} onClose={() => setShowAddAllergy(false)}   onSaved={() => { setShowAddAllergy(false);   load() }} />}
      {showAddChronic   && <AddChronicModal    patientId={patientId} clinicId={clinicId} onClose={() => setShowAddChronic(false)}   onSaved={() => { setShowAddChronic(false);   load() }} />}
      {showAddFamily    && <AddFamilyModal     patientId={patientId} clinicId={clinicId} onClose={() => setShowAddFamily(false)}    onSaved={() => { setShowAddFamily(false);    load() }} />}
      {showAddVacc      && <AddVaccinationModal patientId={patientId} clinicId={clinicId} onClose={() => setShowAddVacc(false)}     onSaved={() => { setShowAddVacc(false);      load() }} />}
    </div>
  )
}
