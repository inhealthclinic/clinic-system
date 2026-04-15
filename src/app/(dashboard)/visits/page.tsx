'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type VisitStatus = 'open' | 'in_progress' | 'completed' | 'partial'

interface Doctor {
  id: string
  first_name: string
  last_name: string
  color: string | null
}

interface Patient {
  id: string
  full_name: string
  phones: string[]
}

interface Visit {
  id: string
  clinic_id: string
  patient_id: string
  doctor_id: string
  status: VisitStatus
  has_charges: boolean
  finance_settled: boolean
  started_at: string | null
  completed_at: string | null
  created_at: string
  notes: string | null
  appointment_id: string | null
  patient: Patient
  doctor: Doctor
}

interface DoctorOption {
  id: string
  first_name: string
  last_name: string
  color: string | null
  consultation_duration: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<VisitStatus, string> = {
  open:        'Открыт',
  in_progress: 'На приёме',
  completed:   'Завершён',
  partial:     'Частично',
}

const STATUS_COLOR: Record<VisitStatus, string> = {
  open:        'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-green-100 text-green-700',
  partial:     'bg-yellow-100 text-yellow-700',
}

type FilterTab = 'all' | 'open' | 'in_progress' | 'done'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all',         label: 'Все' },
  { key: 'open',        label: 'Открытые' },
  { key: 'in_progress', label: 'На приёме' },
  { key: 'done',        label: 'Завершённые' },
]

const EMPTY_STATE: Record<FilterTab, string> = {
  all:         'Сегодня визитов пока нет',
  open:        'Нет открытых визитов',
  in_progress: 'Никто не на приёме',
  done:        'Завершённых визитов нет',
}

// ─── WalkInModal ──────────────────────────────────────────────────────────────

function WalkInModal({
  clinicId,
  onClose,
  onCreated,
}: {
  clinicId: string
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [doctors, setDoctors] = useState<DoctorOption[]>([])
  const [patients, setPatients] = useState<Patient[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [doctorId, setDoctorId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Load active doctors
  useEffect(() => {
    supabase
      .from('doctors')
      .select('id, first_name, last_name, color, consultation_duration')
      .eq('is_active', true)
      .is('deleted_at', null)
      .then(({ data }) => {
        const list = (data ?? []) as DoctorOption[]
        setDoctors(list)
        if (list[0]) setDoctorId(list[0].id)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Patient typeahead
  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, phones')
        .is('deleted_at', null)
        .ilike('full_name', `%${patientSearch}%`)
        .limit(8)
      setPatients((data ?? []) as Patient[])
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPatient) { setError('Выберите пациента'); return }
    if (!doctorId)        { setError('Выберите врача'); return }
    setError('')
    setSaving(true)

    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const timeStr = now.toTimeString().slice(0, 8) // HH:MM:SS

    const doctor = doctors.find(d => d.id === doctorId)
    const duration = doctor?.consultation_duration ?? 30
    const endMs = now.getTime() + duration * 60_000
    const endTime = new Date(endMs).toTimeString().slice(0, 8)

    // Insert appointment (walk-in)
    const { data: apptData, error: apptErr } = await supabase
      .from('appointments')
      .insert({
        clinic_id:     clinicId,
        patient_id:    selectedPatient.id,
        doctor_id:     doctorId,
        date:          todayStr,
        time_start:    timeStr,
        time_end:      endTime,
        duration_min:  duration,
        status:        'arrived',
        is_walkin:     true,
        source:        'admin',
      })
      .select('id')
      .single()

    if (apptErr || !apptData) {
      setError(apptErr?.message ?? 'Ошибка при создании записи')
      setSaving(false)
      return
    }

    // Insert visit
    const { error: visitErr } = await supabase
      .from('visits')
      .insert({
        clinic_id:      clinicId,
        patient_id:     selectedPatient.id,
        doctor_id:      doctorId,
        appointment_id: apptData.id,
        status:         'in_progress',
        started_at:     now.toISOString(),
      })

    if (visitErr) {
      setError(visitErr.message)
      setSaving(false)
      return
    }

    onCreated()
    onClose()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Быстрый приём</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Patient search */}
          <div className="relative">
            <label className={labelCls}>Пациент <span className="text-red-400">*</span></label>
            {selectedPatient ? (
              <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{selectedPatient.full_name}</p>
                  {selectedPatient.phones?.[0] && (
                    <p className="text-xs text-gray-400">{selectedPatient.phones[0]}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedPatient(null); setPatientSearch('') }}
                  className="text-gray-400 hover:text-gray-600 text-xs ml-2"
                >
                  ✕
                </button>
              </div>
            ) : (
              <>
                <input
                  className={inputCls}
                  placeholder="Поиск по имени..."
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                  autoFocus
                />
                {patients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {patients.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setSelectedPatient(p); setPatientSearch(p.full_name); setPatients([]) }}
                        className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors"
                      >
                        <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                        {p.phones?.[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                      </button>
                    ))}
                  </div>
                )}
                {patientSearch.length >= 2 && patients.length === 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 px-4 py-3">
                    <p className="text-sm text-gray-400">Ничего не найдено</p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Doctor select */}
          <div>
            <label className={labelCls}>Врач <span className="text-red-400">*</span></label>
            <select
              className={inputCls}
              value={doctorId}
              onChange={e => setDoctorId(e.target.value)}
              required
            >
              {doctors.length === 0 && <option value="">Загрузка...</option>}
              {doctors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.last_name} {d.first_name} ({d.consultation_duration} мин)
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {saving ? 'Создание...' : 'Принять пациента'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── VisitCard ────────────────────────────────────────────────────────────────

function VisitCard({ visit }: { visit: Visit }) {
  const statusCls = STATUS_COLOR[visit.status] ?? 'bg-gray-100 text-gray-600'
  const statusLabel = STATUS_LABEL[visit.status] ?? visit.status
  const timeStr = visit.started_at ?? visit.created_at
  const time = new Date(timeStr).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

  return (
    <Link
      href={`/visits/${visit.id}`}
      className="block bg-white rounded-xl border border-gray-100 px-5 py-4 hover:border-blue-200 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-4">
        {/* Patient avatar */}
        <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
          {visit.patient?.full_name?.[0] ?? '?'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {visit.patient?.full_name ?? 'Неизвестный пациент'}
          </p>
          {visit.patient?.phones?.[0] && (
            <p className="text-xs text-gray-400 mt-0.5">{visit.patient.phones[0]}</p>
          )}
          {visit.doctor && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: visit.doctor.color ?? '#6B7280' }}
              />
              <p className="text-xs text-gray-500">
                {visit.doctor.last_name} {visit.doctor.first_name}
              </p>
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusCls}`}>
            {statusLabel}
          </span>
          <p className="text-xs text-gray-400">{time}</p>
        </div>
      </div>
    </Link>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VisitsPage() {
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [showWalkIn, setShowWalkIn] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const todayEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString()

    const { data, error } = await supabase
      .from('visits')
      .select('*, patient:patients(id, full_name, phones), doctor:doctors(id, first_name, last_name, color)')
      .gte('created_at', todayStart)
      .lte('created_at', todayEnd)
      .order('created_at', { ascending: false })

    if (!error) {
      setVisits((data ?? []) as Visit[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = visits.filter(v => {
    if (activeTab === 'all')         return true
    if (activeTab === 'open')        return v.status === 'open'
    if (activeTab === 'in_progress') return v.status === 'in_progress'
    if (activeTab === 'done')        return v.status === 'completed' || v.status === 'partial'
    return true
  })

  const todayLabel = new Date().toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  // Tab counts
  const counts: Record<FilterTab, number> = {
    all:         visits.length,
    open:        visits.filter(v => v.status === 'open').length,
    in_progress: visits.filter(v => v.status === 'in_progress').length,
    done:        visits.filter(v => v.status === 'completed' || v.status === 'partial').length,
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 capitalize">
            Сегодня, {todayLabel}
          </h2>
          <p className="text-sm text-gray-400">{visits.length} визитов</p>
        </div>
        <button
          onClick={() => setShowWalkIn(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Быстрый приём
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 bg-gray-100 rounded-xl p-1">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={[
              'flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all',
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {tab.label}
            {counts[tab.key] > 0 && (
              <span className={[
                'ml-1.5 text-xs px-1.5 py-0.5 rounded-full',
                activeTab === tab.key ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-500',
              ].join(' ')}>
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Visit list */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Загрузка...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-sm text-gray-400 mb-3">{EMPTY_STATE[activeTab]}</p>
          {activeTab === 'all' && (
            <button
              onClick={() => setShowWalkIn(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              + Принять первого пациента
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map(v => (
            <VisitCard key={v.id} visit={v} />
          ))}
        </div>
      )}

      {/* Walk-in modal */}
      {showWalkIn && clinicId && (
        <WalkInModal
          clinicId={clinicId}
          onClose={() => setShowWalkIn(false)}
          onCreated={() => { load(); setShowWalkIn(false) }}
        />
      )}
    </div>
  )
}
