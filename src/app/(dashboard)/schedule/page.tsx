'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { Appointment, Doctor } from '@/types'

// ─── constants ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  pending:    { cls: 'bg-gray-100 border-gray-200 text-gray-600',       label: 'Ожидает' },
  confirmed:  { cls: 'bg-green-100 border-green-300 text-green-800',    label: 'Подтверждено' },
  arrived:    { cls: 'bg-yellow-100 border-yellow-300 text-yellow-800', label: 'Пришёл' },
  completed:  { cls: 'bg-blue-100 border-blue-200 text-blue-700',       label: 'Завершено' },
  no_show:    { cls: 'bg-red-100 border-red-200 text-red-600',          label: 'Не явился' },
  cancelled:  { cls: 'bg-gray-50 border-gray-200 text-gray-400',        label: 'Отменено' },
  rescheduled:{ cls: 'bg-purple-100 border-purple-200 text-purple-600', label: 'Перенесено' },
}

type DoctorRow = Pick<Doctor, 'id' | 'first_name' | 'last_name' | 'color' | 'consultation_duration'>

// ─── TimeGrid ─────────────────────────────────────────────────────────────────

function TimeGrid({ appointments, onCardClick }: {
  appointments: Appointment[]
  onCardClick: (a: Appointment) => void
}) {
  const HOUR_HEIGHT = 60 // px per hour
  const START_HOUR = 8
  const END_HOUR = 20
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  function timeToMinutes(t: string) {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return h * 60 + m
  }

  const startMinutes = START_HOUR * 60

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex">
        {/* Time labels column */}
        <div className="w-16 flex-shrink-0 border-r border-gray-100">
          {hours.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT }} className="flex items-start justify-end pr-3 pt-1 border-b border-gray-50">
              <span className="text-xs text-gray-400 font-mono">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {/* Appointments area */}
        <div className="flex-1 relative" style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
          {/* Hour lines */}
          {hours.map(h => (
            <div key={h} className="absolute left-0 right-0 border-b border-gray-50"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT }} />
          ))}
          {/* Half-hour lines */}
          {hours.map(h => (
            <div key={`${h}-half`} className="absolute left-0 right-0 border-b border-dashed border-gray-50"
              style={{ top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
          ))}

          {/* Appointment blocks */}
          {appointments.map(a => {
            const startMin = timeToMinutes(a.time_start) - startMinutes
            const duration = a.duration_min ?? 30
            const topPx = (startMin / 60) * HOUR_HEIGHT
            const heightPx = Math.max((duration / 60) * HOUR_HEIGHT, 24)
            const doctor = a.doctor as { color?: string; first_name: string; last_name: string } | undefined
            const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.pending

            return (
              <div
                key={a.id}
                onClick={() => onCardClick(a)}
                className="absolute left-2 right-2 rounded-lg px-2 py-1 cursor-pointer shadow-sm hover:shadow-md transition-all overflow-hidden border-l-4"
                style={{
                  top: topPx,
                  height: heightPx,
                  backgroundColor: doctor?.color ? `${doctor.color}20` : '#eff6ff',
                  borderLeftColor: doctor?.color ?? '#3b82f6',
                }}
              >
                <p className="text-xs font-semibold text-gray-900 truncate leading-tight">
                  {a.patient?.full_name ?? 'Walk-in'}
                </p>
                {heightPx > 36 && (
                  <p className="text-xs text-gray-500 truncate leading-tight">
                    {a.time_start.slice(0,5)} · {doctor ? `${doctor.last_name}` : ''}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function getDatesForSpan(anchorDate: string, spanDays: 1 | 5 | 7): string[] {
  if (spanDays === 1) return [anchorDate]
  const d = new Date(anchorDate + 'T12:00:00')
  const dow = d.getDay() // 0=Sun
  const monday = new Date(d)
  monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: spanDays }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return day.toISOString().slice(0, 10)
  })
}

// ─── MultiDayGrid ─────────────────────────────────────────────────────────────

function MultiDayGrid({ dates, appointments, onCardClick }: {
  dates: string[]
  appointments: Appointment[]
  onCardClick: (a: Appointment) => void
}) {
  const HOUR_HEIGHT = 56
  const START_HOUR  = 8
  const END_HOUR    = 20
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
  const startMinutes = START_HOUR * 60
  const today = new Date().toISOString().slice(0, 10)
  const DAY_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

  function toMin(t: string) {
    const [h, m] = t.slice(0, 5).split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      {/* Day header row */}
      <div className="flex border-b border-gray-100 sticky top-0 bg-white z-10">
        <div className="w-14 flex-shrink-0 border-r border-gray-100" />
        {dates.map(d => {
          const obj = new Date(d + 'T12:00:00')
          const isToday = d === today
          return (
            <div key={d} className={`flex-1 text-center py-2 border-l border-gray-100 ${isToday ? 'bg-blue-50' : ''}`}>
              <p className={`text-[11px] font-medium uppercase tracking-wide ${isToday ? 'text-blue-500' : 'text-gray-400'}`}>
                {DAY_RU[obj.getDay()]}
              </p>
              <p className={`text-sm font-bold ${isToday ? 'text-blue-700' : 'text-gray-800'}`}>
                {obj.getDate()}
              </p>
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div className="flex overflow-y-auto" style={{ maxHeight: 640 }}>
        {/* Time labels */}
        <div className="w-14 flex-shrink-0 border-r border-gray-100">
          {hours.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT }}
              className="flex items-start justify-end pr-2 pt-1 border-b border-gray-50">
              <span className="text-[11px] text-gray-400 font-mono">{String(h).padStart(2, '0')}:00</span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {dates.map(d => {
          const dayAppts = appointments.filter(a => a.date === d)
          const isToday = d === today
          return (
            <div key={d} className={`flex-1 relative border-l border-gray-100 min-w-0 ${isToday ? 'bg-blue-50/20' : ''}`}
              style={{ height: (END_HOUR - START_HOUR) * HOUR_HEIGHT }}>
              {hours.map(h => (
                <div key={h} className="absolute left-0 right-0 border-b border-gray-50"
                  style={{ top: (h - START_HOUR) * HOUR_HEIGHT }} />
              ))}
              {hours.map(h => (
                <div key={`${h}h`} className="absolute left-0 right-0 border-b border-dashed border-gray-50"
                  style={{ top: (h - START_HOUR) * HOUR_HEIGHT + HOUR_HEIGHT / 2 }} />
              ))}
              {dayAppts.map(a => {
                const startMin = toMin(a.time_start) - startMinutes
                const dur = a.duration_min ?? 30
                const topPx  = (startMin / 60) * HOUR_HEIGHT
                const htPx   = Math.max((dur / 60) * HOUR_HEIGHT, 22)
                const doc = a.doctor as { color?: string; last_name: string } | undefined
                return (
                  <div key={a.id} onClick={() => onCardClick(a)}
                    className="absolute left-0.5 right-0.5 rounded-md px-1 py-0.5 cursor-pointer hover:brightness-95 transition-all overflow-hidden border-l-2 shadow-sm"
                    style={{ top: topPx, height: htPx,
                      backgroundColor: doc?.color ? `${doc.color}22` : '#eff6ff',
                      borderLeftColor: doc?.color ?? '#3b82f6' }}>
                    <p className="text-[11px] font-semibold text-gray-900 truncate leading-tight">
                      {a.patient?.full_name ?? 'Walk-in'}
                    </p>
                    {htPx > 32 && (
                      <p className="text-[10px] text-gray-500 truncate leading-tight">
                        {a.time_start.slice(0, 5)}
                        {doc ? ` · ${doc.last_name}` : ''}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── CreateAppointmentModal ───────────────────────────────────────────────────

type PatientMode = 'search' | 'new'

function CreateAppointmentModal({ clinicId, defaultDate, onClose, onCreated }: {
  clinicId: string
  defaultDate: string
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()

  /* ── doctors ── */
  const [doctors, setDoctors]       = useState<DoctorRow[]>([])
  const [doctorsLoading, setDocLoad] = useState(true)
  const [doctorsError, setDocErr]   = useState('')

  /* ── patient ── */
  const [patientMode, setPatientMode]   = useState<PatientMode>('search')
  const [patientSearch, setPatientSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; full_name: string; phones: string[] }[]>([])
  const [showDropdown, setShowDropdown]  = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  /* selected patient */
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string; phone: string } | null>(null)

  /* new patient form */
  const [newPat, setNewPat] = useState({ full_name: '', phone: '+7 7', gender: 'other' as 'male' | 'female' | 'other', birth_date: '' })
  const [newPatSaving, setNewPatSaving] = useState(false)
  const [newPatError, setNewPatError]   = useState('')

  /* ── booking form ── */
  const [form, setForm] = useState({
    doctor_id: '',
    date: defaultDate,
    time_start: '09:00',
    notes: '',
    is_walkin: false,
  })
  const [customDuration, setCustomDuration] = useState<number | null>(null) // null = use doctor default
  const [takenSlots, setTakenSlots]   = useState<string[]>([])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  /* ── clinic working hours + slot interval ── */
  const [workStart, setWorkStart]     = useState('08:00')
  const [workEnd, setWorkEnd]         = useState('20:00')
  const [workDayOff, setWorkDayOff]   = useState(false)
  const [slotInterval, setSlotInterval] = useState(15)

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  /* ── load doctors (no deleted_at filter — not all tables have it) ── */
  useEffect(() => {
    setDocLoad(true)
    setDocErr('')
    supabase
      .from('doctors')
      .select('id, first_name, last_name, color, consultation_duration')
      .eq('is_active', true)
      .order('last_name')
      .then(({ data, error: err }) => {
        setDocLoad(false)
        if (err) { setDocErr(err.message); return }
        const list = data ?? []
        setDoctors(list)
        if (list[0]) setForm(f => ({ ...f, doctor_id: list[0].id }))
      })
  }, [])

  /* ── load clinic working hours ── */
  useEffect(() => {
    if (!clinicId) return
    supabase
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .single()
      .then(({ data }) => {
        const wh = data?.settings?.working_hours
        if (!wh) return
        // map day of week from date
        // Read slot interval
        if (data?.settings?.slot_interval_min) {
          setSlotInterval(data.settings.slot_interval_min as number)
        }
        const applyDay = (dateStr: string) => {
          const dayIdx = new Date(dateStr + 'T12:00:00').getDay() // 0=Sun
          const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
          const key = KEYS[dayIdx]
          const day = wh[key]
          if (!day) return
          if (!day.active) { setWorkDayOff(true); return }
          setWorkDayOff(false)
          setWorkStart(day.from ?? '08:00')
          setWorkEnd(day.to ?? '20:00')
        }
        applyDay(form.date)
      })
  }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── re-apply working hours when date changes ── */
  useEffect(() => {
    if (!clinicId) return
    supabase
      .from('clinics')
      .select('settings')
      .eq('id', clinicId)
      .single()
      .then(({ data }) => {
        const wh = data?.settings?.working_hours
        if (!wh) return
        const dayIdx = new Date(form.date + 'T12:00:00').getDay()
        const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        const day = wh[KEYS[dayIdx]]
        if (!day) return
        if (!day.active) { setWorkDayOff(true); return }
        setWorkDayOff(false)
        setWorkStart(day.from ?? '08:00')
        setWorkEnd(day.to ?? '20:00')
      })
  }, [form.date]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── load taken slots when doctor or date changes ── */
  useEffect(() => {
    if (!form.doctor_id || !form.date) return
    supabase
      .from('appointments')
      .select('time_start')
      .eq('doctor_id', form.doctor_id)
      .eq('date', form.date)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .then(({ data }) => {
        setTakenSlots((data ?? []).map(a => a.time_start.slice(0, 5)))
      })
  }, [form.doctor_id, form.date])

  /* ── patient search ── */
  const searchDebRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (patientSearch.length < 2) { setSearchResults([]); return }
    if (searchDebRef.current) clearTimeout(searchDebRef.current)
    searchDebRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, phones')
        .or(`full_name.ilike.%${patientSearch}%,phones.cs.{${patientSearch}}`)
        .limit(8)
      setSearchResults(data ?? [])
      setShowDropdown(true)
    }, 250)
    return () => { if (searchDebRef.current) clearTimeout(searchDebRef.current) }
  }, [patientSearch])

  /* close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const pickPatient = (p: { id: string; full_name: string; phones: string[] }) => {
    setSelectedPatient({ id: p.id, full_name: p.full_name, phone: p.phones?.[0] ?? '' })
    setShowDropdown(false)
    setPatientSearch('')
  }

  const clearPatient = () => {
    setSelectedPatient(null)
    setPatientSearch('')
    setPatientMode('search')
  }

  /* ── register new patient ── */
  const registerNewPatient = async () => {
    if (!newPat.full_name.trim()) { setNewPatError('Укажите ФИО'); return }
    setNewPatSaving(true); setNewPatError('')
    const { data: pat, error: pErr } = await supabase.from('patients').insert({
      clinic_id: clinicId,
      full_name: newPat.full_name.trim(),
      phones: newPat.phone.trim() ? [newPat.phone.trim()] : [],
      gender: newPat.gender,
      birth_date: newPat.birth_date || null,
      status: 'new',
      is_vip: false,
      balance_amount: 0,
      debt_amount: 0,
      tags: [],
    }).select('id, full_name, phones').single()
    setNewPatSaving(false)
    if (pErr || !pat) { setNewPatError(pErr?.message ?? 'Ошибка создания'); return }
    setSelectedPatient({ id: pat.id, full_name: pat.full_name, phone: pat.phones?.[0] ?? '' })
    setPatientMode('search')
  }

  /* ── helpers ── */
  const selectedDoctor = doctors.find(d => d.id === form.doctor_id)
  const duration = customDuration ?? selectedDoctor?.consultation_duration ?? 30

  const calcEnd = (start: string, min: number) => {
    const [h, m] = start.split(':').map(Number)
    const total = h * 60 + m + min
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  /* generate slots from workStart to workEnd at slotInterval */
  const ALL_SLOTS = (() => {
    const [sh, sm] = workStart.split(':').map(Number)
    const [eh, em] = workEnd.split(':').map(Number)
    const startMin = (sh ?? 8) * 60 + (sm ?? 0)
    const endMin   = (eh ?? 20) * 60 + (em ?? 0)
    const step     = slotInterval ?? 15
    const slots: string[] = []
    for (let t = startMin; t < endMin; t += step) {
      slots.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`)
    }
    return slots
  })()

  /* current time in minutes (for greying out past slots on today) */
  const todayStr   = new Date().toISOString().slice(0, 10)
  const isToday    = form.date === todayStr
  const nowMinutes = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() })()

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedPatient) { setError('Выберите или зарегистрируйте пациента'); return }
    if (!form.doctor_id)  { setError('Выберите врача'); return }
    setError(''); setSaving(true)

    const timeEnd = calcEnd(form.time_start, duration)
    const timeEndCheck = timeEnd + ':00'

    /* conflict check */
    const { data: conflicts } = await supabase
      .from('appointments').select('id')
      .eq('doctor_id', form.doctor_id).eq('date', form.date)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .lt('time_start', timeEndCheck)
      .gt('time_end', form.time_start + ':00')

    if (conflicts && conflicts.length > 0) {
      setError(`Конфликт: у врача уже есть запись в ${form.time_start}`)
      setSaving(false); return
    }

    const { data: appt, error: err } = await supabase.from('appointments').insert({
      clinic_id: clinicId,
      patient_id: selectedPatient.id,
      doctor_id: form.doctor_id,
      date: form.date,
      time_start: form.time_start + ':00',
      time_end: timeEnd + ':00',
      duration_min: duration,
      status: 'pending',
      is_walkin: form.is_walkin,
      source: 'admin',
      notes: form.notes.trim() || null,
    }).select('id').single()

    if (err || !appt) { setError(err?.message ?? 'Ошибка'); setSaving(false); return }

    /* auto-create open visit */
    await supabase.from('visits').insert({
      clinic_id: clinicId,
      patient_id: selectedPatient.id,
      doctor_id: form.doctor_id,
      appointment_id: appt.id,
      status: 'open',
    })

    onCreated(); onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md z-10 max-h-[96vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Новая запись</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* ── 1. PATIENT ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Пациент <span className="text-red-400">*</span></label>
              {!selectedPatient && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => setPatientMode('search')}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${patientMode === 'search' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                    Поиск
                  </button>
                  <button type="button" onClick={() => { setPatientMode('new'); setShowDropdown(false) }}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${patientMode === 'new' ? 'bg-green-600 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                    + Новый пациент
                  </button>
                </div>
              )}
            </div>

            {/* Selected */}
            {selectedPatient ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedPatient.full_name}</p>
                  {selectedPatient.phone && <p className="text-xs text-gray-500 mt-0.5">{selectedPatient.phone}</p>}
                </div>
                <button type="button" onClick={clearPatient}
                  className="text-gray-400 hover:text-red-500 transition-colors ml-3 text-lg leading-none">×</button>
              </div>

            ) : patientMode === 'search' ? (
              /* Search mode */
              <div ref={searchRef} className="relative">
                <input
                  className={inputCls}
                  placeholder="Имя или телефон пациента..."
                  value={patientSearch}
                  onChange={e => { setPatientSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => patientSearch.length >= 2 && setShowDropdown(true)}
                  autoFocus
                />
                {showDropdown && patientSearch.length >= 2 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden max-h-52 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <div className="px-4 py-3 text-sm text-gray-400">Не найдено — зарегистрируйте нового</div>
                    ) : (
                      searchResults.map(p => (
                        <button key={p.id} type="button" onClick={() => pickPatient(p)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0">
                          <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                          {p.phones?.[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                        </button>
                      ))
                    )}
                    <button type="button" onClick={() => { setPatientMode('new'); setNewPat(n => ({ ...n, full_name: patientSearch })); setShowDropdown(false) }}
                      className="w-full text-left px-4 py-3 bg-green-50 hover:bg-green-100 transition-colors flex items-center gap-2 border-t border-gray-100">
                      <span className="text-green-600 text-base font-bold leading-none">+</span>
                      <span className="text-sm font-medium text-green-700">
                        {searchResults.length === 0 ? `Создать «${patientSearch}»` : 'Новый пациент'}
                      </span>
                    </button>
                  </div>
                )}
              </div>

            ) : (
              /* New patient mode */
              <div className="border border-green-200 rounded-xl p-4 bg-green-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Новый пациент</p>
                  <button type="button" onClick={() => { setPatientMode('search'); setNewPat({ full_name: '', phone: '+7 7', gender: 'other', birth_date: '' }) }}
                    className="text-xs text-gray-400 hover:text-gray-600">← Назад к поиску</button>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">ФИО <span className="text-red-400">*</span></label>
                  <input className={inputCls} placeholder="Айгерим Бекова" autoFocus
                    value={newPat.full_name}
                    onChange={e => {
                      const val = e.target.value.replace(/\b(\S)/g, c => c.toUpperCase())
                      setNewPat(p => ({ ...p, full_name: val }))
                    }} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Телефон</label>
                    <input className={inputCls} placeholder="+7 700 000 0000"
                      value={newPat.phone}
                      maxLength={15}
                      onChange={e => {
                        const raw = e.target.value
                        // Extract only digits after "+7 "
                        if (!raw.startsWith('+7 ')) return
                        const digits = raw.slice(3).replace(/\D/g, '').slice(0, 10)
                        // Format: 7XX XXX XXXX
                        let formatted = '+7 '
                        if (digits.length === 0) { formatted = '+7 7'; setNewPat(p => ({ ...p, phone: formatted })); return }
                        formatted += digits.slice(0, 1)
                        if (digits.length > 1) formatted += digits.slice(1, 3)
                        if (digits.length > 3) formatted += ' ' + digits.slice(3, 6)
                        if (digits.length > 6) formatted += ' ' + digits.slice(6, 10)
                        setNewPat(p => ({ ...p, phone: formatted }))
                      }}
                      onFocus={e => {
                        if (!newPat.phone || newPat.phone === '+7 ') setNewPat(p => ({ ...p, phone: '+7 7' }))
                        setTimeout(() => e.target.setSelectionRange(e.target.value.length, e.target.value.length), 0)
                      }} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Пол</label>
                    <select className={inputCls} value={newPat.gender}
                      onChange={e => setNewPat(p => ({ ...p, gender: e.target.value as 'male' | 'female' | 'other' }))}>
                      <option value="female">Женский</option>
                      <option value="male">Мужской</option>
                      <option value="other">Не указан</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">
                    Дата рождения
                    {newPat.birth_date && (() => {
                      const diff = Date.now() - new Date(newPat.birth_date).getTime()
                      const age  = Math.floor(diff / (365.25 * 24 * 3600 * 1000))
                      return age >= 0 ? <span className="text-gray-400 font-normal ml-1">({age} лет)</span> : null
                    })()}
                  </label>
                  <input type="date" className={inputCls} value={newPat.birth_date}
                    onChange={e => setNewPat(p => ({ ...p, birth_date: e.target.value }))} />
                </div>
                {newPatError && <p className="text-xs text-red-600">{newPatError}</p>}
                <button type="button" onClick={registerNewPatient}
                  disabled={newPatSaving || !newPat.full_name.trim()}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
                  {newPatSaving ? 'Создание...' : '✓ Зарегистрировать и продолжить'}
                </button>
              </div>
            )}
          </div>

          {/* ── 2. DOCTOR ── */}
          <div>
            <label className={labelCls}>Врач <span className="text-red-400">*</span></label>
            {doctorsLoading ? (
              <div className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-400 animate-pulse">Загрузка врачей...</div>
            ) : doctorsError ? (
              <div className="border border-red-200 bg-red-50 rounded-lg px-3 py-2.5 text-sm text-red-600">
                ⚠ Не удалось загрузить врачей: {doctorsError}
              </div>
            ) : doctors.length === 0 ? (
              <div className="border border-yellow-200 bg-yellow-50 rounded-lg px-3 py-2.5 text-sm text-yellow-700">
                Нет активных врачей. Добавьте врача в Настройках → Врачи.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {doctors.map(d => (
                  <label key={d.id}
                    className={[
                      'flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition-colors',
                      form.doctor_id === d.id
                        ? 'border-blue-400 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                    ].join(' ')}>
                    <input type="radio" name="doctor" value={d.id} checked={form.doctor_id === d.id}
                      onChange={() => setForm(f => ({ ...f, doctor_id: d.id }))}
                      className="accent-blue-600 flex-shrink-0" />
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: d.color ?? '#9ca3af' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{d.last_name} {d.first_name}</p>
                      <p className="text-xs text-gray-400">{d.consultation_duration ?? 30} мин/приём</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* ── 3. DATE + TIME SLOT ── */}
          <div>
            <label className={labelCls}>Дата <span className="text-red-400">*</span></label>
            <input type="date" className={inputCls} value={form.date} required
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Время <span className="text-red-400">*</span></label>
              <span className="text-xs text-gray-300">{workStart}–{workEnd}</span>
            </div>

            {/* Duration selector */}
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-400 flex-shrink-0">Длительность:</span>
              {[15, 30, 45, 60, 90, 120].map(min => (
                <button key={min} type="button"
                  onClick={() => setCustomDuration(min === (selectedDoctor?.consultation_duration ?? 30) && customDuration === null ? null : min)}
                  className={[
                    'px-2 py-0.5 rounded-md text-xs font-medium transition-colors flex-shrink-0',
                    duration === min
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  ].join(' ')}>
                  {min < 60 ? `${min}м` : min === 60 ? '1ч' : `${min / 60}ч`}
                </button>
              ))}
              {form.time_start && (
                <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                  до {calcEnd(form.time_start, duration)}
                </span>
              )}
            </div>

            {/* Day-off warning */}
            {workDayOff ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 text-sm text-orange-700">
                🚫 В этот день клиника не работает по расписанию.{' '}
                <a href="/settings/clinic" target="_blank" className="underline font-medium">
                  Изменить расписание
                </a>
              </div>
            ) : (
              <>
                {/* Visual slot grid */}
                <div className="grid grid-cols-6 gap-1.5">
                  {ALL_SLOTS.map(slot => {
                    const taken    = takenSlots.includes(slot)
                    const selected = form.time_start === slot
                    const [slotH, slotM] = slot.split(':').map(Number)
                    const isPast   = isToday && (slotH! * 60 + (slotM ?? 0)) < nowMinutes
                    const disabled = taken || isPast
                    return (
                      <button
                        key={slot} type="button"
                        disabled={disabled}
                        onClick={() => setForm(f => ({ ...f, time_start: slot }))}
                        className={[
                          'py-1.5 rounded-lg text-xs font-medium transition-colors',
                          taken    ? 'bg-red-100 text-red-400 cursor-not-allowed line-through'
                          : isPast   ? 'bg-gray-50 text-gray-300 cursor-not-allowed'
                          : selected ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700',
                        ].join(' ')}
                      >
                        {slot}
                      </button>
                    )
                  })}
                </div>
                {takenSlots.length > 0 && (
                  <p className="text-xs text-gray-400 mt-1.5">🔴 — занято</p>
                )}
              </>
            )}
          </div>

          {/* ── 4. NOTES + WALK-IN ── */}
          <div>
            <label className={labelCls}>Причина обращения</label>
            <textarea className={inputCls + ' resize-none'} rows={2}
              placeholder="Первичный приём / боль в спине / контроль..."
              value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => setForm(f => ({ ...f, is_walkin: !f.is_walkin }))}
              className={['w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                form.is_walkin ? 'bg-blue-600' : 'bg-gray-200'].join(' ')}>
              <span className={['absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                form.is_walkin ? 'translate-x-5' : 'translate-x-0.5'].join(' ')} />
            </div>
            <span className="text-sm text-gray-700">Walk-in (пришёл без предварительной записи)</span>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</p>
          )}
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            Отмена
          </button>
          <button
            type="button"
            disabled={saving || !selectedPatient || !form.doctor_id || doctorsLoading}
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving ? 'Сохранение...' : 'Создать запись'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── AMO CRM: Print appointment slip (талон на приём) ────────────────────────

function printAppointmentSlip(appt: Appointment) {
  const w = window.open('', '_blank', 'width=420,height=480')
  if (!w) return
  const patient = appt.patient as { full_name: string; phones: string[] } | undefined
  const doctor  = appt.doctor  as { last_name: string; first_name: string } | undefined
  const dateStr = new Date(appt.date + 'T12:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const statusRu = ({ pending: 'Ожидает', confirmed: 'Подтверждено', arrived: 'Прибыл', completed: 'Завершено', no_show: 'Не явился', cancelled: 'Отменено' } as Record<string, string>)[appt.status] ?? appt.status

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Талон на приём</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:360px;margin:24px auto;font-size:13px;color:#111}
    .logo{text-align:center;font-size:18px;font-weight:700;margin-bottom:2px}
    .sub{text-align:center;font-size:11px;color:#777;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #111}
    .big{font-size:22px;font-weight:700;text-align:center;margin:12px 0 4px;letter-spacing:-0.5px}
    .time-row{display:flex;justify-content:center;gap:12px;margin-bottom:14px}
    .timebox{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:8px 18px;text-align:center}
    .timebox .lbl{font-size:10px;color:#0284c7;text-transform:uppercase;letter-spacing:.5px}
    .timebox .val{font-size:20px;font-weight:700;color:#0369a1}
    .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px dotted #eee}
    .lbl2{color:#777}
    .status{text-align:center;margin:14px 0 0;font-size:12px;color:#16a34a;font-weight:600}
    .foot{text-align:center;font-size:10px;color:#ccc;margin-top:16px;border-top:1px dashed #ddd;padding-top:8px}
  </style></head><body>
  <div class="logo">IN HEALTH</div>
  <div class="sub">Медицинский центр — Талон на приём</div>
  <div class="big">${patient?.full_name ?? 'Walk-in'}</div>
  <div class="time-row">
    <div class="timebox"><div class="lbl">Начало</div><div class="val">${appt.time_start.slice(0,5)}</div></div>
    <div class="timebox"><div class="lbl">Конец</div><div class="val">${appt.time_end.slice(0,5)}</div></div>
  </div>
  <div class="row"><span class="lbl2">Дата</span><span>${dateStr}</span></div>
  <div class="row"><span class="lbl2">Врач</span><span>${doctor ? `${doctor.last_name} ${doctor.first_name}` : '—'}</span></div>
  <div class="row"><span class="lbl2">Длительность</span><span>${appt.duration_min ?? 30} мин</span></div>
  ${patient?.phones?.[0] ? `<div class="row"><span class="lbl2">Телефон</span><span>${patient.phones[0]}</span></div>` : ''}
  ${appt.notes ? `<div class="row"><span class="lbl2">Примечание</span><span style="max-width:180px;text-align:right">${appt.notes}</span></div>` : ''}
  <div class="status">Статус: ${statusRu}</div>
  <div class="foot">IN HEALTH · Распечатано: ${new Date().toLocaleString('ru-RU')}</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

// ─── AppointmentDetailDrawer ──────────────────────────────────────────────────

function AppointmentDetailDrawer({ appt, onClose, onUpdate }: {
  appt: Appointment
  onClose: () => void
  onUpdate: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)

  const updateStatus = async (status: string) => {
    setSaving(true)
    await supabase.from('appointments').update({ status }).eq('id', appt.id)
    if (status === 'no_show') {
      await supabase.from('tasks').insert({
        clinic_id: appt.clinic_id,
        title: `Выяснить причину неявки: ${appt.patient?.full_name}`,
        type: 'call',
        priority: 'high',
        status: 'new',
        patient_id: appt.patient_id,
        due_at: new Date(Date.now() + 2*60*60*1000).toISOString(),
      })
    }
    setSaving(false)
    onUpdate()
    onClose()
  }

  const doctor = appt.doctor as { last_name: string; first_name: string; color: string } | undefined
  const patient = appt.patient as { full_name: string; phones: string[] } | undefined
  const st = STATUS_STYLE[appt.status] ?? STATUS_STYLE.pending

  const NEXT: Record<string, { status: string; label: string; cls: string }[]> = {
    pending:   [
      { status: 'confirmed', label: '✓ Подтвердить', cls: 'bg-green-600 hover:bg-green-700' },
      { status: 'cancelled', label: 'Отменить',       cls: 'bg-red-500 hover:bg-red-600' },
    ],
    confirmed: [
      { status: 'arrived',   label: '✓ Пришёл',      cls: 'bg-yellow-500 hover:bg-yellow-600' },
      { status: 'no_show',   label: 'Не явился',      cls: 'bg-red-500 hover:bg-red-600' },
    ],
    arrived:   [
      { status: 'completed', label: '✓ Завершить',    cls: 'bg-blue-600 hover:bg-blue-700' },
    ],
  }
  const nextActions = NEXT[appt.status] ?? []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <p className="text-base font-semibold text-gray-900">{patient?.full_name ?? 'Walk-in'}</p>
            {patient?.phones?.[0] && <p className="text-xs text-gray-400 mt-0.5">{patient.phones[0]}</p>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <button
              onClick={() => printAppointmentSlip(appt)}
              title="Печать талона"
              className="text-gray-400 hover:text-blue-600 transition-colors text-sm px-2 py-1 rounded-lg hover:bg-blue-50">
              🖨
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {doctor && (
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: doctor.color ?? '#6B7280' }} />
              <p className="text-sm text-gray-700">{doctor.last_name} {doctor.first_name}</p>
            </div>
          )}
          <p className="text-sm text-gray-700">
            📅 {new Date(appt.date + 'T12:00:00').toLocaleDateString('ru-RU', {
              weekday: 'short', day: 'numeric', month: 'long',
            })}
          </p>
          <p className="text-sm text-gray-700">
            🕐 {appt.time_start.slice(0, 5)} — {appt.time_end.slice(0, 5)}
            <span className="text-gray-400 text-xs ml-2">({appt.duration_min} мин)</span>
          </p>
          {appt.is_walkin && (
            <span className="inline-block text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Walk-in</span>
          )}
          <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full border ${st.cls}`}>
            {st.label}
          </span>
          {appt.notes && (
            <div className="pt-1">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Заметка</p>
              <p className="text-sm text-gray-600">{appt.notes}</p>
            </div>
          )}
        </div>

        {nextActions.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
            {nextActions.map(a => (
              <button
                key={a.status}
                onClick={() => updateStatus(a.status)}
                disabled={saving}
                className={`w-full ${a.cls} disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [span, setSpan] = useState<1 | 5 | 7>(1)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')

  const dates = getDatesForSpan(date, span)

  const load = useCallback(async () => {
    setLoading(true)
    const dateRange = getDatesForSpan(date, span)
    let q = supabase
      .from('appointments')
      .select('*, patient:patients(id, full_name, phones), doctor:doctors(id, first_name, last_name, color)')
      .neq('status', 'cancelled')
      .order('date').order('time_start')

    if (span === 1) {
      q = q.eq('date', dateRange[0]!)
    } else {
      q = q.gte('date', dateRange[0]!).lte('date', dateRange[dateRange.length - 1]!)
    }

    const { data } = await q
    setAppointments((data ?? []) as Appointment[])
    setLoading(false)
  }, [date, span])

  useEffect(() => { load() }, [load])

  const shiftDate = (dir: 1 | -1) => {
    const step = span === 1 ? 1 : 7
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + dir * step)
    setDate(d.toISOString().slice(0, 10))
  }

  const dateLabel = (() => {
    if (span === 1) {
      return new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    }
    const first = new Date(dates[0]! + 'T12:00:00')
    const last  = new Date(dates[dates.length - 1]! + 'T12:00:00')
    const sameMonth = first.getMonth() === last.getMonth()
    const fmt = (d: Date, withMonth: boolean) =>
      d.toLocaleDateString('ru-RU', { day: 'numeric', ...(withMonth ? { month: 'long' } : {}) })
    return `${fmt(first, !sameMonth)} — ${fmt(last, true)}`
  })()

  // Shared filter logic for both list and grid views
  const filteredAppts = appointments.filter(a => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const patName = (a.patient?.full_name ?? '').toLowerCase()
    const doc = a.doctor as { last_name: string; first_name: string } | undefined
    const docName = doc ? `${doc.last_name} ${doc.first_name}`.toLowerCase() : ''
    return patName.includes(q) || docName.includes(q)
  })

  return (
    <div className={span === 1 ? 'max-w-3xl mx-auto' : 'w-full'}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* Span selector */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {([1, 5, 7] as const).map(s => (
            <button key={s} onClick={() => setSpan(s)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                span === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}>
              {s === 1 ? '1 день' : s === 5 ? '5 дней' : '7 дней'}
            </button>
          ))}
        </div>

        <button onClick={() => shiftDate(-1)}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-lg leading-none">‹</button>

        <div className="flex-1 text-center min-w-[180px]">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="sr-only" id="sched-date" />
          <label htmlFor="sched-date"
            className="text-sm font-semibold text-gray-900 capitalize cursor-pointer hover:text-blue-600">
            {dateLabel}
          </label>
        </div>

        <button onClick={() => shiftDate(1)}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-lg leading-none">›</button>

        <button onClick={() => setDate(new Date().toISOString().slice(0, 10))}
          className="text-sm text-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-50">
          Сегодня
        </button>

        <span className="text-sm text-gray-400">{appointments.length} записей</span>

        {/* View toggle — only for 1-day */}
        {span === 1 && (
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['list', 'grid'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={[
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}>
                {v === 'list' ? '☰ Список' : '⊞ Сетка'}
              </button>
            ))}
          </div>
        )}

        <button onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          Записать
        </button>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени пациента или врача..."
          className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Загрузка...
        </div>
      ) : span > 1 ? (
        <MultiDayGrid dates={dates} appointments={filteredAppts} onCardClick={setSelected} />
      ) : appointments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-sm text-gray-400 mb-3">Записей на этот день нет</p>
          <button onClick={() => setShowCreate(true)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            + Создать первую запись
          </button>
        </div>
      ) : filteredAppts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Ничего не найдено по запросу «{search}»
        </div>
      ) : view === 'list' ? (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="divide-y divide-gray-50">
            {filteredAppts.map(a => {
              const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.pending
              const doctor = a.doctor as { last_name: string; first_name: string; color: string } | undefined
              return (
                <div
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <div className="w-20 flex-shrink-0">
                    <p className="text-sm font-mono text-gray-700">{a.time_start.slice(0, 5)}</p>
                    <p className="text-xs text-gray-300">{a.time_end.slice(0, 5)}</p>
                  </div>
                  {doctor && (
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: doctor.color ?? '#6B7280' }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {a.patient?.full_name ?? 'Walk-in'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {doctor ? `${doctor.last_name} ${doctor.first_name}` : ''}
                      {a.is_walkin && <span className="ml-2 text-orange-400">walk-in</span>}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full border flex-shrink-0 ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <TimeGrid appointments={filteredAppts} onCardClick={setSelected} />
      )}

      {showCreate && clinicId && (
        <CreateAppointmentModal
          clinicId={clinicId}
          defaultDate={date}
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); setShowCreate(false) }}
        />
      )}

      {selected && (
        <AppointmentDetailDrawer
          appt={selected}
          onClose={() => setSelected(null)}
          onUpdate={load}
        />
      )}
    </div>
  )
}
