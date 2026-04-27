'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { printPrescription as printRxDoc } from '@/lib/print/documents'

/* Types */

interface RxItem {
  id?: string
  name: string
  form: string
  dosage: string
  frequency: string
  duration: string
  route: string
  instructions: string
}

interface Prescription {
  id: string
  issued_at: string
  diagnosis: string | null
  notes: string | null
  doctor: { id: string; first_name: string; last_name: string } | null
  items: RxItem[]
}

interface Doctor { id: string; first_name: string; last_name: string }

interface Patient {
  id: string
  full_name: string
  birth_date: string | null
  iin: string | null
  phones: string[]
}

const EMPTY_ITEM: RxItem = {
  name: '', form: '', dosage: '', frequency: '', duration: '', route: '', instructions: '',
}

/* Print a single prescription via shared letterhead template */
function printRx(clinicId: string, patientId: string, rx: Prescription) {
  if (!rx.doctor?.id) {
    alert('У рецепта не указан врач — печать невозможна.')
    return
  }
  void printRxDoc(clinicId, patientId, rx.doctor.id, {
    number: rx.id.slice(0, 8).toUpperCase(),
    issued_at: rx.issued_at,
    icd10_code: null,
    diagnosis_text: rx.diagnosis,
    items: rx.items.map(it => ({
      drug_name: it.name,
      dosage: it.dosage,
      frequency: it.frequency,
      duration: it.duration,
      form: it.form,
      route: it.route,
      instructions: it.instructions,
    })),
    recommendations: rx.notes,
  })
}

export default function PrescriptionsPage() {
  const { id: patientId } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()
  const { profile } = useAuthStore()

  const [patient, setPatient]   = useState<Patient | null>(null)
  const [doctors, setDoctors]   = useState<Doctor[]>([])
  const [list, setList]         = useState<Prescription[]>([])
  const [loading, setLoading]   = useState(true)

  // create form
  const [showForm, setShowForm] = useState(false)
  const [doctorId, setDoctorId] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<RxItem[]>([{ ...EMPTY_ITEM }])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [p, d, r] = await Promise.all([
      supabase.from('patients').select('id,full_name,birth_date,iin,phones').eq('id', patientId).maybeSingle(),
      supabase.from('doctors').select('id,first_name,last_name').eq('is_active', true).order('last_name'),
      supabase.from('prescriptions')
        .select('id,issued_at,diagnosis,notes,doctor:doctors(id,first_name,last_name),items:prescription_items(id,name,form,dosage,frequency,duration,route,instructions,sort_order)')
        .eq('patient_id', patientId)
        .order('issued_at', { ascending: false })
        .limit(50),
    ])
    if (!p.data) { router.push('/patients'); return }
    setPatient(p.data as Patient)
    setDoctors((d.data ?? []) as Doctor[])
    setList(((r.data ?? []) as unknown as Prescription[]).map(row => ({
      ...row,
      items: [...(row.items ?? [])].sort(
        (a: RxItem & { sort_order?: number }, b: RxItem & { sort_order?: number }) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0)
      ),
    })))
    setLoading(false)
  }, [patientId, router])

  useEffect(() => { load() }, [load])

  const addItem = () => setItems(p => [...p, { ...EMPTY_ITEM }])
  const removeItem = (i: number) => setItems(p => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)
  const updItem = (i: number, k: keyof RxItem, v: string) =>
    setItems(p => p.map((it, idx) => idx === i ? { ...it, [k]: v } : it))

  const save = async () => {
    if (!profile?.clinic_id) return
    const filled = items.filter(i => i.name.trim())
    if (filled.length === 0) { alert('Добавьте хотя бы один препарат'); return }
    setSaving(true)
    const { data: rx, error } = await supabase.from('prescriptions').insert({
      clinic_id:  profile.clinic_id,
      patient_id: patientId,
      doctor_id:  doctorId || null,
      diagnosis:  diagnosis.trim() || null,
      notes:      notes.trim()   || null,
      created_by: profile.id ?? null,
    }).select('id').single()
    if (error || !rx) { setSaving(false); alert(error?.message ?? 'Ошибка'); return }
    const rows = filled.map((i, idx) => ({
      prescription_id: rx.id,
      name: i.name.trim(),
      form: i.form.trim() || null,
      dosage: i.dosage.trim() || null,
      frequency: i.frequency.trim() || null,
      duration: i.duration.trim() || null,
      route: i.route.trim() || null,
      instructions: i.instructions.trim() || null,
      sort_order: idx,
    }))
    await supabase.from('prescription_items').insert(rows)
    setSaving(false)
    setShowForm(false)
    setDoctorId(''); setDiagnosis(''); setNotes(''); setItems([{ ...EMPTY_ITEM }])
    load()
  }

  const deleteRx = async (id: string) => {
    if (!confirm('Удалить рецепт?')) return
    await supabase.from('prescriptions').delete().eq('id', id)
    load()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link href={`/patients/${patientId}`}
        className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
        ← {patient?.full_name}
      </Link>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">💊 Рецепты и назначения</h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            + Новый рецепт
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Врач</label>
              <select className={inp} value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="">— не указан —</option>
                {doctors.map(d => <option key={d.id} value={d.id}>{d.last_name} {d.first_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Диагноз</label>
              <input className={inp} value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
                placeholder="Например: J06.9 Острая инфекция ВДП" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-500">Препараты</label>
              <button onClick={addItem} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                + ещё
              </button>
            </div>
            <div className="space-y-3">
              {items.map((it, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-2 relative">
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)}
                      className="absolute top-1 right-2 text-gray-300 hover:text-red-500 text-sm"
                      title="Убрать"> × </button>
                  )}
                  <input className={inp} placeholder="Название препарата *"
                    value={it.name} onChange={e => updItem(i, 'name', e.target.value)} />
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <input className={inp} placeholder="Форма (табл.)" value={it.form}
                      onChange={e => updItem(i, 'form', e.target.value)} />
                    <input className={inp} placeholder="Дозировка (500 мг)" value={it.dosage}
                      onChange={e => updItem(i, 'dosage', e.target.value)} />
                    <input className={inp} placeholder="Путь (внутрь)" value={it.route}
                      onChange={e => updItem(i, 'route', e.target.value)} />
                    <input className={inp} placeholder="Кратность (2 р/д)" value={it.frequency}
                      onChange={e => updItem(i, 'frequency', e.target.value)} />
                    <input className={inp} placeholder="Длительность (7 дней)" value={it.duration}
                      onChange={e => updItem(i, 'duration', e.target.value)} />
                  </div>
                  <input className={inp} placeholder="Дополнительно (до еды, запивать водой...)"
                    value={it.instructions} onChange={e => updItem(i, 'instructions', e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Примечание</label>
            <textarea className={inp + ' resize-none'} rows={2}
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2 text-sm">
              Отмена
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium">
              {saving ? 'Сохранение...' : 'Выписать'}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {list.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Рецептов нет
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(rx => (
            <div key={rx.id} className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {new Date(rx.issued_at).toLocaleDateString('ru-RU')} {new Date(rx.issued_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {rx.doctor && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {rx.doctor.last_name} {rx.doctor.first_name}
                    </p>
                  )}
                  {rx.diagnosis && (
                    <p className="text-xs text-gray-700 mt-1"><b>Диагноз:</b> {rx.diagnosis}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => printRx(profile?.clinic_id ?? '', patientId, rx)}
                    title="Печать"
                    className="text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                    🖨
                  </button>
                  <button onClick={() => deleteRx(rx.id)}
                    title="Удалить"
                    className="text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors">
                    🗑
                  </button>
                </div>
              </div>
              <ul className="space-y-1.5 mt-2 border-t border-gray-50 pt-2">
                {rx.items.map((i, idx) => (
                  <li key={idx} className="text-sm text-gray-800">
                    <span className="font-medium">{idx + 1}. {i.name}</span>
                    {i.form && <span>, {i.form}</span>}
                    <span className="text-gray-500 ml-1">
                      {[i.dosage, i.route, i.frequency, i.duration].filter(Boolean).join(' · ')}
                    </span>
                    {i.instructions && (
                      <div className="text-xs text-gray-400 italic ml-4">{i.instructions}</div>
                    )}
                  </li>
                ))}
              </ul>
              {rx.notes && (
                <p className="text-xs text-gray-500 mt-2 italic border-t border-gray-50 pt-2">{rx.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
