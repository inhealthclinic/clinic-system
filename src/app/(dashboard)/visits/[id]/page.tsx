'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import {
  printPrescription as printRxDoc,
  printMedCertificate as printCertDoc,
} from '@/lib/print/documents'

/* ─── Types ──────────────────────────────────────────────── */
interface Charge {
  id: string; name: string; quantity: number
  unit_price: number; discount: number; total: number
  status: string; procedure_status: string
}
interface VisitFull {
  id: string; clinic_id: string
  status: 'open' | 'in_progress' | 'completed' | 'partial'
  has_charges: boolean; finance_settled: boolean
  notes: string | null; started_at: string | null
  completed_at: string | null; created_at: string
  patient: { id: string; full_name: string; phones: string[] }
  doctor:  { id: string; first_name: string; last_name: string }
  charges: Charge[]
}
interface MedRecord {
  id: string; visit_id: string; patient_id: string; doctor_id: string
  complaints: string | null; anamnesis: string | null; objective: string | null
  vitals: Record<string, string>
  icd10_code: string | null; diagnosis_text: string | null
  diagnosis_type: 'preliminary' | 'final'
  prescriptions: Array<{ drug_name: string; dosage: string; frequency: string; duration: string }>
  recommendations: string | null; control_date: string | null
  is_signed: boolean; prescription_number: string | null
}
interface ICD10Hit { code: string; name: string }
interface Service { id: string; name: string; price: number | null }
interface Allergy { allergen: string; type: string; severity: string }

/* ─── Helpers ────────────────────────────────────────────── */
const STATUS_CLR: Record<string, string> = {
  open: 'bg-green-100 text-green-700', in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-gray-100 text-gray-600', partial: 'bg-yellow-100 text-yellow-700',
}
const STATUS_RU: Record<string, string> = {
  open: 'Открыт', in_progress: 'На приёме', completed: 'Завершён', partial: 'Частично',
}
const CHARGE_CLR: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500', pending_approval: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700', partial: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-50 text-red-400',
}
const SEVERITY_CLR: Record<string, string> = {
  mild: 'bg-yellow-50 text-yellow-600', moderate: 'bg-orange-100 text-orange-700',
  severe: 'bg-red-100 text-red-700', 'life-threatening': 'bg-red-600 text-white',
}
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

/* ─── AddChargeModal ─────────────────────────────────────── */
function AddChargeModal({ visitId, patientId, clinicId, onClose, onSaved }: {
  visitId: string; patientId: string; clinicId: string
  onClose: () => void; onSaved: () => void
}) {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [services, setServices] = useState<Service[]>([])
  const [serviceId, setServiceId] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('services').select('id,name,price').eq('is_active', true).order('name').limit(200)
      .then(({ data }) => setServices(data ?? []))
  }, [])

  const pickService = (id: string) => {
    setServiceId(id)
    const s = services.find(x => x.id === id)
    if (s) { setName(s.name); setPrice(String(s.price ?? '')) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Укажите название'); return }
    const unitPrice = Number(price)
    if (!unitPrice) { setError('Укажите цену'); return }
    setSaving(true); setError('')
    const q2 = Number(qty) || 1
    const { error: err } = await supabase.from('charges').insert({
      clinic_id: clinicId, visit_id: visitId, patient_id: patientId,
      service_id: serviceId || null, name: name.trim(),
      quantity: q2, unit_price: unitPrice, discount: 0, total: unitPrice * q2,
      created_by: profile?.id,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onSaved(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Добавить начисление</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Из прайс-листа</label>
            <select className={inp} value={serviceId} onChange={e => pickService(e.target.value)}>
              <option value="">— ввести вручную —</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.price ? ` — ${s.price.toLocaleString('ru-RU')} ₸` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Название *</label>
            <input className={inp} value={name} onChange={e => setName(e.target.value)} required placeholder="Консультация / процедура" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Цена (₸) *</label>
              <input type="number" min="0" className={inp} value={price} onChange={e => setPrice(e.target.value)} placeholder="5000" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Кол-во</label>
              <input type="number" min="1" className={inp} value={qty} onChange={e => setQty(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium">Отмена</button>
            <button type="submit" disabled={saving} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Allergy check helper ───────────────────────────────── */
function checkAllergy(drugName: string, allergies: { allergen: string; type: string }[]): string | null {
  if (!drugName.trim()) return null
  const drug = drugName.toLowerCase()
  const match = allergies.find(a =>
    a.type === 'drug' && (
      drug.includes(a.allergen.toLowerCase()) ||
      a.allergen.toLowerCase().includes(drug)
    )
  )
  return match ? match.allergen : null
}

/* ─── MedElement: печать ────────────────────────────────── */

function printPrescription(record: MedRecord, visit: VisitFull) {
  void printRxDoc(visit.clinic_id, visit.patient.id, visit.doctor.id, {
    number: record.prescription_number,
    issued_at: null,
    icd10_code: record.icd10_code,
    diagnosis_text: record.diagnosis_text,
    items: (record.prescriptions ?? []).map(p => ({
      drug_name: p.drug_name,
      dosage: p.dosage,
      frequency: p.frequency,
      duration: p.duration,
    })),
    recommendations: record.recommendations,
    control_date: record.control_date,
  })
}

function printMedCertificate(record: MedRecord, visit: VisitFull) {
  void printCertDoc(visit.clinic_id, visit.patient.id, visit.doctor.id, {
    icd10_code: record.icd10_code,
    diagnosis_text: record.diagnosis_text,
    diagnosis_type: record.diagnosis_type,
    complaints: record.complaints,
    recommendations: record.recommendations,
    control_date: record.control_date,
  })
}

/* ─── MedRecordSection ───────────────────────────────────── */
function MedRecordSection({ visit, allergies }: { visit: VisitFull; allergies: Allergy[] }) {
  const supabase = createClient()
  const { profile } = useAuthStore()

  const [record, setRecord]     = useState<MedRecord | null>(null)
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(false)
  const [saving, setSaving]     = useState(false)

  /* Allergy warnings per prescription index */
  const [allergyWarnings, setAllergyWarnings] = useState<Record<number, string | null>>({})

  /* Last visit record */
  const [lastRecord, setLastRecord] = useState<{
    created_at: string
    icd10_code: string | null
    diagnosis_text: string | null
    prescriptions: Array<{ drug_name: string; dosage: string; frequency: string }>
    recommendations: string | null
  } | null>(null)
  const [showLastVisit, setShowLastVisit] = useState(false)

  /* ICD-10 search */
  const [icdQuery, setIcdQuery]   = useState('')
  const [icdHits, setIcdHits]     = useState<ICD10Hit[]>([])
  const icdDebRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* Prescription bundles */
  type Bundle = {
    id: string
    name: string
    icd10_hint: string | null
    prescriptions: Array<{ drug_name: string; dosage: string; frequency: string; duration: string }>
    use_count: number
    doctor_id: string | null
  }
  const [bundles, setBundles] = useState<Bundle[]>([])
  const [bundlesOpen, setBundlesOpen] = useState(false)
  const [saveBundleOpen, setSaveBundleOpen] = useState(false)
  const [newBundleName, setNewBundleName] = useState('')

  /* Medical record templates */
  type MRTemplate = {
    id: string
    name: string
    icd10_code: string | null
    icd10_name: string | null
    complaints: string | null
    anamnesis: string | null
    objective: string | null
    diagnosis_text: string | null
    recommendations: string | null
    prescriptions: Array<{ drug_name: string; dosage: string; frequency: string; duration: string }>
    use_count: number
    doctor_id: string | null
  }
  const [tpls, setTpls] = useState<MRTemplate[]>([])
  const [tplsOpen, setTplsOpen] = useState(false)
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [newTplName, setNewTplName] = useState('')

  const [form, setForm] = useState({
    complaints: '', anamnesis: '', objective: '',
    bp: '', pulse: '', temperature: '', spo2: '', weight: '', height: '',
    icd10_code: '', icd10_name: '', diagnosis_text: '',
    diagnosis_type: 'preliminary' as 'preliminary' | 'final',
    recommendations: '', control_date: '',
    prescriptions: [] as Array<{ drug_name: string; dosage: string; frequency: string; duration: string }>,
  })

  useEffect(() => {
    supabase.from('medical_records').select('*').eq('visit_id', visit.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          const v = data.vitals ?? {}
          setRecord(data as MedRecord)
          setForm({
            complaints: data.complaints ?? '',
            anamnesis: data.anamnesis ?? '',
            objective: data.objective ?? '',
            bp: v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : '',
            pulse: v.pulse ?? '', temperature: v.temperature ?? '',
            spo2: v.spo2 ?? '', weight: v.weight ?? '', height: v.height ?? '',
            icd10_code: data.icd10_code ?? '',
            icd10_name: '',
            diagnosis_text: data.diagnosis_text ?? '',
            diagnosis_type: data.diagnosis_type ?? 'preliminary',
            recommendations: data.recommendations ?? '',
            control_date: data.control_date ?? '',
            prescriptions: data.prescriptions ?? [],
          })
        }
        setLoading(false)
      })

    // Load last completed visit's medical record
    supabase.from('medical_records')
      .select('created_at, icd10_code, diagnosis_text, prescriptions, recommendations')
      .eq('patient_id', visit.patient.id)
      .neq('visit_id', visit.id)
      .eq('is_signed', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setLastRecord(data as typeof lastRecord) })
  }, [visit.id])

  /* Load prescription bundles (doctor's own + clinic-shared) */
  useEffect(() => {
    if (!visit.clinic_id) return
    supabase.from('prescription_bundles')
      .select('id, name, icd10_hint, prescriptions, use_count, doctor_id')
      .eq('clinic_id', visit.clinic_id)
      .eq('is_active', true)
      .or(`doctor_id.eq.${visit.doctor.id},doctor_id.is.null`)
      .order('use_count', { ascending: false })
      .limit(50)
      .then(({ data }) => setBundles((data ?? []) as Bundle[]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.clinic_id, visit.doctor.id])

  const applyBundle = async (b: Bundle) => {
    setForm(f => ({
      ...f,
      prescriptions: [...f.prescriptions, ...b.prescriptions.map(p => ({
        drug_name: p.drug_name, dosage: p.dosage,
        frequency: p.frequency, duration: p.duration ?? '',
      }))],
    }))
    setBundlesOpen(false)
    // bump use_count
    await supabase.from('prescription_bundles')
      .update({ use_count: b.use_count + 1 })
      .eq('id', b.id)
    setBundles(prev => prev.map(x => x.id === b.id ? { ...x, use_count: x.use_count + 1 } : x))
  }

  /* Load medrecord templates */
  useEffect(() => {
    if (!visit.clinic_id) return
    supabase.from('medrecord_templates')
      .select('id,name,icd10_code,icd10_name,complaints,anamnesis,objective,diagnosis_text,recommendations,prescriptions,use_count,doctor_id')
      .eq('clinic_id', visit.clinic_id)
      .eq('is_active', true)
      .or(`doctor_id.eq.${visit.doctor.id},doctor_id.is.null`)
      .order('use_count', { ascending: false })
      .limit(50)
      .then(({ data }) => setTpls((data ?? []) as MRTemplate[]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.clinic_id, visit.doctor.id])

  const applyTemplate = async (t: MRTemplate) => {
    setForm(f => ({
      ...f,
      complaints:      t.complaints      ?? f.complaints,
      anamnesis:       t.anamnesis       ?? f.anamnesis,
      objective:       t.objective       ?? f.objective,
      icd10_code:      t.icd10_code      ?? f.icd10_code,
      icd10_name:      t.icd10_name      ?? f.icd10_name,
      diagnosis_text:  t.diagnosis_text  ?? f.diagnosis_text,
      recommendations: t.recommendations ?? f.recommendations,
      prescriptions: [...f.prescriptions, ...(t.prescriptions ?? []).map(p => ({
        drug_name: p.drug_name, dosage: p.dosage,
        frequency: p.frequency, duration: p.duration ?? '',
      }))],
    }))
    if (t.icd10_code) setIcdQuery(`${t.icd10_code} — ${t.icd10_name ?? ''}`)
    setTplsOpen(false)
    await supabase.from('medrecord_templates')
      .update({ use_count: t.use_count + 1 }).eq('id', t.id)
    setTpls(prev => prev.map(x => x.id === t.id ? { ...x, use_count: x.use_count + 1 } : x))
  }

  const saveCurrentAsTemplate = async () => {
    if (!newTplName.trim()) return
    const { data } = await supabase.from('medrecord_templates').insert({
      clinic_id: visit.clinic_id,
      doctor_id: visit.doctor.id,
      name: newTplName.trim(),
      icd10_code: form.icd10_code || null,
      icd10_name: form.icd10_name || null,
      complaints: form.complaints || null,
      anamnesis: form.anamnesis || null,
      objective: form.objective || null,
      diagnosis_text: form.diagnosis_text || null,
      recommendations: form.recommendations || null,
      prescriptions: form.prescriptions.filter(p => p.drug_name.trim()),
    }).select().single()
    if (data) setTpls(prev => [data as MRTemplate, ...prev])
    setNewTplName('')
    setSaveTplOpen(false)
  }

  const saveCurrentAsBundle = async () => {
    if (!newBundleName.trim() || form.prescriptions.length === 0) return
    const { data } = await supabase.from('prescription_bundles').insert({
      clinic_id: visit.clinic_id,
      doctor_id: visit.doctor.id,
      name: newBundleName.trim(),
      icd10_hint: form.icd10_code || null,
      prescriptions: form.prescriptions.filter(p => p.drug_name.trim()),
    }).select().single()
    if (data) {
      setBundles(prev => [data as Bundle, ...prev])
    }
    setNewBundleName('')
    setSaveBundleOpen(false)
  }

  const searchICD = (q: string) => {
    setIcdQuery(q)
    setForm(f => ({ ...f, icd10_code: '', icd10_name: '' }))
    if (icdDebRef.current) clearTimeout(icdDebRef.current)
    if (q.length < 2) { setIcdHits([]); return }
    icdDebRef.current = setTimeout(async () => {
      const { data } = await supabase.from('icd10_codes')
        .select('code,name')
        .or(`name.ilike.%${q}%,code.ilike.${q}%`)
        .limit(8)
      setIcdHits(data ?? [])
    }, 300)
  }

  const pickICD = (hit: ICD10Hit) => {
    setForm(f => ({ ...f, icd10_code: hit.code, icd10_name: hit.name }))
    setIcdQuery(`${hit.code} — ${hit.name}`)
    setIcdHits([])
  }

  const addPrescription = () =>
    setForm(f => ({ ...f, prescriptions: [...f.prescriptions, { drug_name: '', dosage: '', frequency: '', duration: '' }] }))

  const updatePrescription = (i: number, field: string, val: string) => {
    setForm(f => ({ ...f, prescriptions: f.prescriptions.map((p, idx) => idx === i ? { ...p, [field]: val } : p) }))
    if (field === 'drug_name') {
      const match = checkAllergy(val, allergies)
      setAllergyWarnings(prev => ({ ...prev, [i]: match }))
    }
  }

  const removePrescription = (i: number) => {
    setForm(f => ({ ...f, prescriptions: f.prescriptions.filter((_, idx) => idx !== i) }))
    setAllergyWarnings(prev => {
      const next: Record<number, string | null> = {}
      Object.entries(prev).forEach(([k, v]) => {
        const ki = Number(k)
        if (ki < i) next[ki] = v
        else if (ki > i) next[ki - 1] = v
      })
      return next
    })
  }

  const buildVitals = () => {
    const vitals: Record<string, string> = {}
    const bp = form.bp.split('/')
    if (bp[0]) vitals.bp_systolic = bp[0].trim()
    if (bp[1]) vitals.bp_diastolic = bp[1].trim()
    if (form.pulse) vitals.pulse = form.pulse
    if (form.temperature) vitals.temperature = form.temperature
    if (form.spo2) vitals.spo2 = form.spo2
    if (form.weight) vitals.weight = form.weight
    if (form.height) vitals.height = form.height
    return vitals
  }

  const validateVitals = (): string | null => {
    if (form.bp) {
      const parts = form.bp.split('/')
      const sys = parseInt(parts[0] ?? '')
      const dia = parseInt(parts[1] ?? '')
      if (isNaN(sys) || isNaN(dia) || sys < 60 || sys > 260 || dia < 30 || dia > 160) {
        return 'АД указано некорректно. Формат: 120/80, диапазон: 60–260 / 30–160 мм рт.ст.'
      }
    }
    if (form.pulse) {
      const p = parseInt(form.pulse)
      if (isNaN(p) || p < 30 || p > 220) {
        return 'Пульс вне нормы: укажите значение 30–220 уд/мин.'
      }
    }
    if (form.temperature) {
      const t = parseFloat(form.temperature.replace(',', '.'))
      if (isNaN(t) || t < 34.0 || t > 43.0) {
        return 'Температура вне диапазона: 34–43°C.'
      }
    }
    if (form.spo2) {
      const s = parseInt(form.spo2)
      if (isNaN(s) || s < 70 || s > 100) {
        return 'SpO₂ вне диапазона: 70–100%.'
      }
    }
    if (form.weight) {
      const w = parseFloat(form.weight)
      if (isNaN(w) || w < 1 || w > 500) {
        return 'Вес вне диапазона: 1–500 кг.'
      }
    }
    if (form.height) {
      const h = parseFloat(form.height)
      if (isNaN(h) || h < 30 || h > 250) {
        return 'Рост вне диапазона: 30–250 см.'
      }
    }
    return null
  }

  const handleSave = async (sign = false) => {
    // Vitals validation
    const vitalsError = validateVitals()
    if (vitalsError) {
      alert(`⚠️ ${vitalsError}`)
      return
    }
    // Pre-sign checks
    if (sign) {
      if (!form.icd10_code && !form.diagnosis_text.trim()) {
        alert('⛔ Для подписания медзаписи необходимо указать диагноз (МКБ-10 или формулировку).')
        return
      }
      if (!form.complaints.trim() && !form.objective.trim()) {
        alert('⚠️ Рекомендуется заполнить жалобы или объективный статус перед подписанием.')
        // Not blocking — just warn
      }
    }
    setSaving(true)
    const payload = {
      clinic_id: visit.clinic_id, visit_id: visit.id,
      patient_id: visit.patient.id, doctor_id: visit.doctor.id,
      complaints: form.complaints || null,
      anamnesis: form.anamnesis || null,
      objective: form.objective || null,
      vitals: buildVitals(),
      icd10_code: form.icd10_code || null,
      diagnosis_text: form.diagnosis_text || null,
      diagnosis_type: form.diagnosis_type,
      prescriptions: form.prescriptions.filter(p => p.drug_name.trim()),
      recommendations: form.recommendations || null,
      control_date: form.control_date || null,
      is_signed: sign,
    }
    if (record) {
      const { data } = await supabase.from('medical_records').update(payload).eq('id', record.id).select().single()
      if (data) setRecord(data as MedRecord)
    } else {
      const { data } = await supabase.from('medical_records').insert(payload).select().single()
      if (data) setRecord(data as MedRecord)
    }
    setSaving(false)
    setEditing(false)
  }

  if (loading) return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 mt-4 text-sm text-gray-400 text-center">Загрузка медзаписи...</div>
  )

  /* ── Last visit: inline-бейдж + sticky-панель справа при раскрытии ── */
  const LastVisitPanel = () => lastRecord ? (
    <>
      {/* Inline-бейдж (виден всегда, чтобы было на что жать) */}
      <button onClick={() => setShowLastVisit(v => !v)}
        className="mb-4 w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-xl transition-colors text-left">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-blue-700">📋 Последний визит</span>
          <span className="text-xs text-blue-500">
            {new Date(lastRecord.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          {lastRecord.icd10_code && (
            <span className="text-xs font-mono bg-blue-200 text-blue-800 px-1.5 rounded">{lastRecord.icd10_code}</span>
          )}
          <span className="text-xs text-blue-400 ml-2">{showLastVisit ? '· скрыть боковую панель' : '· открыть рядом →'}</span>
        </div>
      </button>
      {/* Sticky side panel */}
      {showLastVisit && (
        <div className="hidden xl:block fixed right-4 top-24 w-80 max-h-[calc(100vh-7rem)] overflow-auto z-30 bg-white border border-blue-200 rounded-xl shadow-lg">
          <div className="sticky top-0 bg-blue-50 border-b border-blue-100 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-700">📋 Прошлый визит</span>
            <button onClick={() => setShowLastVisit(false)} className="text-blue-400 hover:text-blue-700 text-sm">×</button>
          </div>
          <div className="px-4 py-3 space-y-3 text-sm">
            <p className="text-xs text-gray-500">
              {new Date(lastRecord.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
              {lastRecord.icd10_code && <span className="ml-2 font-mono bg-blue-50 text-blue-700 px-1.5 rounded">{lastRecord.icd10_code}</span>}
            </p>
            {lastRecord.diagnosis_text && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Диагноз</p>
                <p className="text-gray-800">{lastRecord.diagnosis_text}</p>
              </div>
            )}
            {lastRecord.prescriptions?.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Назначения</p>
                <div className="space-y-1">
                  {lastRecord.prescriptions.map((p, i) => (
                    <div key={i} className="text-xs bg-gray-50 rounded px-2 py-1">
                      <span className="font-medium text-gray-800">{p.drug_name}</span>
                      {p.dosage && <span className="text-gray-600 ml-1">{p.dosage}</span>}
                      {p.frequency && <span className="text-gray-400 ml-1">· {p.frequency}</span>}
                    </div>
                  ))}
                </div>
                <button onClick={() => {
                  setForm(f => ({ ...f, prescriptions: [...f.prescriptions, ...lastRecord.prescriptions.map(p => ({
                    drug_name: p.drug_name, dosage: p.dosage, frequency: p.frequency, duration: ''
                  }))] }))
                }} className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium">
                  + Скопировать всё
                </button>
              </div>
            )}
            {lastRecord.recommendations && (
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Рекомендации</p>
                <p className="text-gray-700 text-xs">{lastRecord.recommendations}</p>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Mobile/tablet fallback — старый раскрывающийся блок */}
      {showLastVisit && (
        <div className="xl:hidden mb-4 border border-blue-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-white space-y-2">
            {lastRecord.diagnosis_text && (
              <p className="text-sm text-gray-700"><span className="text-xs text-gray-400 mr-2">Диагноз:</span>{lastRecord.diagnosis_text}</p>
            )}
            {lastRecord.prescriptions?.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Назначения:</p>
                <div className="flex flex-wrap gap-1">
                  {lastRecord.prescriptions.map((p, i) => (
                    <span key={i} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{p.drug_name} {p.dosage}</span>
                  ))}
                </div>
                <button onClick={() => {
                  setForm(f => ({ ...f, prescriptions: [...f.prescriptions, ...lastRecord.prescriptions.map(p => ({
                    drug_name: p.drug_name, dosage: p.dosage, frequency: p.frequency, duration: ''
                  }))] }))
                }} className="mt-2 text-xs text-blue-600 hover:text-blue-700 font-medium">
                  + Скопировать назначения
                </button>
              </div>
            )}
            {lastRecord.recommendations && (
              <p className="text-sm text-gray-600"><span className="text-xs text-gray-400 mr-2">Рекомендации:</span>{lastRecord.recommendations}</p>
            )}
          </div>
        </div>
      )}
    </>
  ) : null

  /* ── View mode ── */
  if (record && !editing) {
    const v = record.vitals ?? {}
    const bp = v.bp_systolic ? `${v.bp_systolic}/${v.bp_diastolic}` : null
    return (
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mt-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Медицинская запись</h3>
            {record.is_signed && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                ✓ Подписана · {record.prescription_number}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* MedElement: печать рецепта */}
            {record.prescriptions?.length > 0 && (
              <button
                onClick={() => printPrescription(record, visit)}
                className="text-xs text-purple-600 hover:text-purple-700 border border-purple-200 hover:border-purple-400 px-3 py-1.5 rounded-lg transition-colors"
                title="Распечатать рецепт"
              >
                🖨 Рецепт
              </button>
            )}
            {/* MedElement: печать направления/справки */}
            {record.is_signed && (
              <button
                onClick={() => printMedCertificate(record, visit)}
                className="text-xs text-teal-600 hover:text-teal-700 border border-teal-200 hover:border-teal-400 px-3 py-1.5 rounded-lg transition-colors"
                title="Справка / направление"
              >
                📄 Справка
              </button>
            )}
            {!record.is_signed && (
              <button onClick={() => setEditing(true)} className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg transition-colors">
                ✏️ Редактировать
              </button>
            )}
          </div>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <LastVisitPanel />
          {/* Vitals row */}
          {(bp || v.pulse || v.temperature || v.spo2) && (
            <div className="flex gap-4 flex-wrap">
              {bp && <span className="bg-red-50 text-red-700 px-3 py-1 rounded-lg font-mono text-xs">🩺 {bp} мм рт.ст.</span>}
              {v.pulse && <span className="bg-pink-50 text-pink-700 px-3 py-1 rounded-lg font-mono text-xs">💓 {v.pulse} уд/мин</span>}
              {v.temperature && <span className="bg-orange-50 text-orange-700 px-3 py-1 rounded-lg font-mono text-xs">🌡 {v.temperature}°C</span>}
              {v.spo2 && <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg font-mono text-xs">SpO₂ {v.spo2}%</span>}
              {v.weight && <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-lg font-mono text-xs">⚖ {v.weight} кг</span>}
            </div>
          )}
          {record.complaints && <div><p className="text-xs text-gray-400 mb-1">Жалобы</p><p className="text-gray-800">{record.complaints}</p></div>}
          {record.anamnesis && <div><p className="text-xs text-gray-400 mb-1">Анамнез</p><p className="text-gray-800">{record.anamnesis}</p></div>}
          {record.objective && <div><p className="text-xs text-gray-400 mb-1">Объективно</p><p className="text-gray-800">{record.objective}</p></div>}
          {(record.icd10_code || record.diagnosis_text) && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Диагноз
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                  {record.diagnosis_type === 'final' ? 'Окончательный' : 'Предварительный'}
                </span>
              </p>
              {record.icd10_code && <span className="font-mono text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded mr-2">{record.icd10_code}</span>}
              <span className="text-gray-900">{record.diagnosis_text}</span>
            </div>
          )}
          {record.prescriptions?.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Назначения</p>
              <div className="space-y-1">
                {record.prescriptions.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-blue-50 rounded-lg px-3 py-2">
                    <span className="font-medium text-blue-900">{p.drug_name}</span>
                    {p.dosage && <span className="text-blue-600">{p.dosage}</span>}
                    {p.frequency && <span className="text-gray-500">{p.frequency}</span>}
                    {p.duration && <span className="text-gray-400">{p.duration}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {record.recommendations && <div><p className="text-xs text-gray-400 mb-1">Рекомендации</p><p className="text-gray-800">{record.recommendations}</p></div>}
          {record.control_date && (
            <p className="text-xs text-gray-400">
              Контроль: <span className="text-gray-700">{new Date(record.control_date + 'T12:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
            </p>
          )}
        </div>
      </div>
    )
  }

  /* ── Edit / Create mode ── */
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mt-4">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between relative">
        <h3 className="text-sm font-semibold text-gray-900">
          {record ? 'Редактировать запись' : 'Медицинская запись'}
        </h3>
        <div className="flex items-center gap-2 relative">
          <button type="button" onClick={() => setTplsOpen(v => !v)}
            className="text-xs text-purple-600 hover:text-purple-700 border border-purple-200 hover:border-purple-400 rounded px-2 py-1">
            📝 Шаблон {tpls.length > 0 && `(${tpls.length})`}
          </button>
          {tplsOpen && (
            <div className="absolute right-0 top-8 z-30 w-96 bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-auto">
              <div className="sticky top-0 bg-gray-50 px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">Шаблоны медзаписи</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setSaveTplOpen(true); setTplsOpen(false) }}
                    className="text-xs text-purple-600 hover:text-purple-700">+ Сохранить текущую</button>
                  <button type="button" onClick={() => setTplsOpen(false)} className="text-gray-400 hover:text-gray-600">×</button>
                </div>
              </div>
              {tpls.length === 0 ? (
                <p className="px-3 py-4 text-xs text-gray-400 text-center">
                  Пусто. Нажмите «Сохранить текущую», чтобы создать первый шаблон из заполненной записи.
                </p>
              ) : tpls.map(t => (
                <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                  className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{t.name}</span>
                    {t.icd10_code && (
                      <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-1 rounded">{t.icd10_code}</span>
                    )}
                  </div>
                  {t.diagnosis_text && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">{t.diagnosis_text}</p>
                  )}
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {t.doctor_id ? '👤 мой' : '🏥 клиника'} · {t.use_count}×
                    {t.prescriptions?.length > 0 && ` · ${t.prescriptions.length} назнач.`}
                  </p>
                </button>
              ))}
            </div>
          )}
          {saveTplOpen && (
            <div className="absolute right-0 top-8 z-30 w-80 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
              <p className="text-xs font-semibold text-gray-600 mb-2">Сохранить медзапись как шаблон</p>
              <input value={newTplName} onChange={e => setNewTplName(e.target.value)}
                placeholder="Напр. «ОРВИ — стандарт»" className={inp + ' mb-2'} />
              <p className="text-[10px] text-gray-400 mb-2">
                Сохранится: жалобы, анамнез, объективно, диагноз (+ICD-10), рекомендации, все назначения.
              </p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setSaveTplOpen(false); setNewTplName('') }}
                  className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
                <button type="button" onClick={saveCurrentAsTemplate} disabled={!newTplName.trim()}
                  className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1 rounded">
                  Сохранить
                </button>
              </div>
            </div>
          )}
          {record && (
            <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
          )}
        </div>
      </div>
      <div className="p-5 space-y-5">

        <LastVisitPanel />

        {/* Vitals */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">O</span>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Объективно — витальные и осмотр</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { key: 'bp', label: 'АД (сист/диаст)', placeholder: '120/80' },
              { key: 'pulse', label: 'Пульс (уд/мин)', placeholder: '72' },
              { key: 'temperature', label: 'Температура °C', placeholder: '36.6' },
              { key: 'spo2', label: 'SpO₂ %', placeholder: '98' },
              { key: 'weight', label: 'Вес (кг)', placeholder: '70' },
              { key: 'height', label: 'Рост (см)', placeholder: '170' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input className={inp} placeholder={f.placeholder}
                  value={(form as unknown as Record<string, string>)[f.key]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>

        {/* Subjective */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">S</span>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Субъективно — жалобы и анамнез</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Жалобы</label>
              <textarea className={inp + ' resize-none'} rows={2} placeholder="Боль в области…"
                value={form.complaints} onChange={e => setForm(f => ({ ...f, complaints: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Анамнез</label>
              <textarea className={inp + ' resize-none'} rows={2} placeholder="Болеет с…"
                value={form.anamnesis} onChange={e => setForm(f => ({ ...f, anamnesis: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Объективно</label>
              <textarea className={inp + ' resize-none'} rows={2} placeholder="Состояние удовлетворительное…"
                value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Diagnosis */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">A</span>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Оценка — диагноз</p>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">МКБ-10 (поиск по коду или названию)</label>
              <input className={inp} placeholder="J06 или ОРВИ…" value={icdQuery}
                onChange={e => searchICD(e.target.value)} />
              {icdHits.length > 0 && (
                <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                  {icdHits.map(h => (
                    <button key={h.code} type="button" onClick={() => pickICD(h)}
                      className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors flex items-center gap-3">
                      <span className="text-xs font-mono bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">{h.code}</span>
                      <span className="text-sm text-gray-700 truncate">{h.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.icd10_code && (
                <p className="text-xs text-blue-600 mt-1">✓ {form.icd10_code}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Формулировка диагноза</label>
                <input className={inp} placeholder="Описание диагноза…"
                  value={form.diagnosis_text} onChange={e => setForm(f => ({ ...f, diagnosis_text: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Тип</label>
                <select className={inp} value={form.diagnosis_type}
                  onChange={e => setForm(f => ({ ...f, diagnosis_type: e.target.value as 'preliminary' | 'final' }))}>
                  <option value="preliminary">Предварительный</option>
                  <option value="final">Окончательный</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Prescriptions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">P</span>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">План — назначения</p>
            </div>
            <div className="flex items-center gap-2 relative">
              {bundles.length > 0 && (
                <>
                  <button type="button" onClick={() => setBundlesOpen(v => !v)}
                    className="text-xs text-purple-600 hover:text-purple-700 font-medium border border-purple-200 hover:border-purple-400 rounded px-2 py-1">
                    ⭐ Шаблоны ({bundles.length})
                  </button>
                  {bundlesOpen && (
                    <div className="absolute right-0 top-8 z-20 w-80 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-auto">
                      <div className="sticky top-0 bg-gray-50 px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-600">Выбрать шаблон</span>
                        <button type="button" onClick={() => setBundlesOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">×</button>
                      </div>
                      {bundles.map(b => (
                        <button key={b.id} type="button" onClick={() => applyBundle(b)}
                          className="w-full text-left px-3 py-2 hover:bg-purple-50 border-b border-gray-50">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{b.name}</span>
                            {b.icd10_hint && (
                              <span className="text-[10px] font-mono bg-blue-50 text-blue-700 px-1 rounded">{b.icd10_hint}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {b.prescriptions.map(p => p.drug_name).filter(Boolean).join(', ')}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {b.doctor_id ? '👤 мой' : '🏥 клиника'} · использован {b.use_count}×
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {form.prescriptions.length > 0 && (
                <>
                  <button type="button" onClick={() => setSaveBundleOpen(v => !v)}
                    className="text-xs text-gray-500 hover:text-gray-700 font-medium border border-gray-200 hover:border-gray-400 rounded px-2 py-1"
                    title="Сохранить текущие назначения как шаблон">
                    💾
                  </button>
                  {saveBundleOpen && (
                    <div className="absolute right-0 top-8 z-20 w-72 bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                      <p className="text-xs font-semibold text-gray-600 mb-2">Сохранить как шаблон</p>
                      <input value={newBundleName} onChange={e => setNewBundleName(e.target.value)}
                        placeholder="Напр. «Гипертония I ст.»" className={inp + ' mb-2'} />
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => { setSaveBundleOpen(false); setNewBundleName('') }}
                          className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
                        <button type="button" onClick={saveCurrentAsBundle} disabled={!newBundleName.trim()}
                          className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1 rounded">
                          Сохранить
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              <button type="button" onClick={addPrescription}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                + Добавить
              </button>
            </div>
          </div>
          {form.prescriptions.length === 0 && (
            <p className="text-sm text-gray-400">Нет назначений</p>
          )}
          <div className="space-y-2">
            {form.prescriptions.map((p, i) => {
              const allergyMatch = allergyWarnings[i] ?? null
              return (
                <div key={i} className="bg-gray-50 rounded-lg p-3 relative">
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <input className={inp} placeholder="Препарат" value={p.drug_name}
                        onChange={e => updatePrescription(i, 'drug_name', e.target.value)} />
                      {allergyMatch && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-1">
                          <span className="text-red-600 font-bold text-base">⚠</span>
                          <span className="text-sm text-red-700 font-medium">
                            Внимание! У пациента аллергия на <strong>{allergyMatch}</strong>
                          </span>
                        </div>
                      )}
                    </div>
                    <input className={inp} placeholder="Доза" value={p.dosage}
                      onChange={e => updatePrescription(i, 'dosage', e.target.value)} />
                    <input className={inp} placeholder="Частота" value={p.frequency}
                      onChange={e => updatePrescription(i, 'frequency', e.target.value)} />
                    <div className="flex gap-2">
                      <input className={inp} placeholder="Курс" value={p.duration}
                        onChange={e => updatePrescription(i, 'duration', e.target.value)} />
                      <button type="button" onClick={() => removePrescription(i)}
                        className="text-gray-400 hover:text-red-500 flex-shrink-0 text-lg leading-none">×</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Recommendations */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">P</span>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">План — рекомендации и контроль</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <textarea className={inp + ' resize-none'} rows={2} placeholder="Режим, диета, активность…"
                value={form.recommendations} onChange={e => setForm(f => ({ ...f, recommendations: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Дата контроля</label>
              <input type="date" className={inp} value={form.control_date}
                onChange={e => setForm(f => ({ ...f, control_date: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t border-gray-100">
          {record && (
            <button type="button" onClick={() => setEditing(false)}
              className="px-4 py-2.5 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg text-sm font-medium">
              Отмена
            </button>
          )}
          <button type="button" onClick={() => handleSave(false)} disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение...' : '💾 Сохранить'}
          </button>
          <button type="button" onClick={() => handleSave(true)} disabled={saving || !!record?.is_signed}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            title={record?.is_signed ? 'Уже подписана' : 'Подписать и сформировать номер рецепта'}>
            {saving ? '...' : '✍ Подписать'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────── */
export default function VisitPage() {
  const { id }   = useParams<{ id: string }>()
  const router   = useRouter()
  const supabase = createClient()

  const [visit, setVisit]       = useState<VisitFull | null>(null)
  const [loading, setLoading]   = useState(true)
  const [advancing, setAdv]     = useState(false)
  const [showCharge, setCharge] = useState(false)
  const [allergies, setAllergies] = useState<Allergy[]>([])

  const load = useCallback(async () => {
    const [v, c] = await Promise.all([
      supabase.from('visits')
        .select('*, patient:patients(id,full_name,phones), doctor:doctors(id,first_name,last_name)')
        .eq('id', id).single(),
      supabase.from('charges')
        .select('id,name,quantity,unit_price,discount,total,status,procedure_status')
        .eq('visit_id', id).order('created_at'),
    ])
    if (!v.data) { router.push('/'); return }
    const visitData = { ...v.data, charges: c.data ?? [] } as VisitFull
    setVisit(visitData)
    setLoading(false)

    const { data: allergyData } = await supabase
      .from('allergies')
      .select('allergen, type, severity')
      .eq('patient_id', visitData.patient.id)
    if (allergyData) setAllergies(allergyData)
  }, [id])

  useEffect(() => { load() }, [load])

  const advance = async (s: VisitFull['status']) => {
    if (!visit) return

    // V1, V2, V3 validation before closing
    if (s === 'completed') {
      if (!visit.has_charges) {
        alert('Нельзя завершить визит: нет ни одного начисления')
        return
      }
      // Check medical record exists
      const { data: rec } = await supabase
        .from('medical_records').select('id').eq('visit_id', visit.id).maybeSingle()
      if (!rec) {
        alert('Нельзя завершить визит: не заполнена медицинская запись')
        return
      }
      if (!visit.finance_settled) {
        alert('Нельзя завершить визит: финансы не зафиксированы (оплата или долг)')
        return
      }
    }

    setAdv(true)
    await supabase.from('visits').update({ status: s }).eq('id', visit.id)
    setAdv(false)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  )
  if (!visit) return null

  const total = visit.charges.reduce((s, c) => s + c.total, 0)
  const fmt   = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

  const severeAllergies = allergies.filter(a => a.severity === 'severe' || a.severity === 'life-threatening')

  return (
    <div className="max-w-2xl mx-auto">
      {showCharge && (
        <AddChargeModal
          visitId={visit.id} patientId={visit.patient.id} clinicId={visit.clinic_id}
          onClose={() => setCharge(false)} onSaved={load}
        />
      )}

      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
        ← Назад
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href={`/patients/${visit.patient.id}`} className="text-base font-semibold text-gray-900 hover:text-blue-600 transition-colors">
              {visit.patient.full_name}
            </Link>
            {severeAllergies.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {allergies.filter(a => a.type === 'drug').map((a, i) => (
                  <span key={i} className="text-xs bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-medium">
                    ⚠ {a.allergen}
                  </span>
                ))}
              </div>
            )}
            <p className="text-sm text-gray-400 mt-0.5">{visit.doctor.last_name} {visit.doctor.first_name}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_CLR[visit.status]}`}>
                {STATUS_RU[visit.status]}
              </span>
              {visit.has_charges && <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600">💳 Начисления</span>}
              {visit.finance_settled && <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-600">✓ Оплачено</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            {visit.status === 'open' && (
              <button onClick={() => advance('in_progress')} disabled={advancing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                {advancing ? '...' : '▶ В работу'}
              </button>
            )}
            {visit.status === 'in_progress' && (<>
              <button onClick={() => advance('completed')} disabled={advancing}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
                {advancing ? '...' : '✓ Завершить'}
              </button>
              <button onClick={() => advance('partial')} disabled={advancing}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
                {advancing ? '...' : '½ Частично'}
              </button>
            </>)}
            {visit.status === 'in_progress' && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1.5 text-xs">
                <p className="font-semibold text-gray-500 uppercase tracking-wide mb-2 text-[10px]">Чеклист</p>
                {[
                  { ok: visit.has_charges,      label: 'Начисления добавлены',   req: true },
                  { ok: visit.finance_settled,  label: 'Оплата зафиксирована',   req: false },
                ].map((item, i) => (
                  <p key={i} className={`flex items-center gap-1.5 ${item.ok ? 'text-green-600' : item.req ? 'text-red-500' : 'text-gray-400'}`}>
                    <span className="flex-shrink-0">{item.ok ? '✓' : item.req ? '✕' : '○'}</span>
                    {item.label}
                    {!item.ok && item.req && <span className="text-red-400 font-medium ml-auto">обязательно</span>}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Открыт: {new Date(visit.created_at).toLocaleString('ru-RU')}
          {visit.started_at && ` · Начат: ${new Date(visit.started_at).toLocaleString('ru-RU')}`}
          {visit.completed_at && ` · Завершён: ${new Date(visit.completed_at).toLocaleString('ru-RU')}`}
        </p>
      </div>

      {/* Charges */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mt-4">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Начисления</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900">{fmt(total)}</span>
            {visit.status !== 'completed' && (
              <button onClick={() => setCharge(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg">
                + Добавить
              </button>
            )}
          </div>
        </div>
        {visit.charges.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">Начислений нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visit.charges.map(c => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {fmt(c.unit_price)} × {c.quantity}
                    {c.discount > 0 && ` · скидка ${fmt(c.discount)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CHARGE_CLR[c.status] ?? ''}`}>
                    {{ pending: 'Ожидает', pending_approval: 'Согласование', paid: 'Оплачено', partial: 'Частично', cancelled: 'Отменено' }[c.status] ?? c.status}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{fmt(c.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Medical record */}
      <MedRecordSection visit={visit} allergies={allergies} />
    </div>
  )
}
