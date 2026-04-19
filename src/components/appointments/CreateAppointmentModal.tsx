'use client'

// Модалка «Новая запись». Используется на /schedule (как раньше) и в CRM
// (кнопка «Записать на приём» в карточке сделки).
//
// Новые пропсы для CRM:
//   • defaultPatient — подставить пациента (скрыть поиск/создание).
//   • dealId — на успешном INSERT appointments логируем deal_events row.

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Doctor } from '@/types'
import {
  ApptTypeItem,
  DEFAULT_APPT_TYPES,
  formatNotesMeta,
} from '@/lib/appointments'

type DoctorRow = Pick<Doctor, 'id' | 'first_name' | 'last_name' | 'color' | 'consultation_duration'>
type PatientMode = 'search' | 'new'
type PaymentMethodCode = 'cash' | 'kaspi' | 'halyk' | 'credit' | 'balance'
type PayMethodRow = { id: string; name: string; method_code: PaymentMethodCode }

const FALLBACK_PAY_METHODS: PayMethodRow[] = [
  { id: 'cash',  name: 'Наличные', method_code: 'cash' },
  { id: 'kaspi', name: 'Kaspi',    method_code: 'kaspi' },
  { id: 'halyk', name: 'Halyk',    method_code: 'halyk' },
  { id: 'credit',name: 'Карта',    method_code: 'credit' },
]

export interface DefaultPatient {
  id: string
  full_name: string
  phone?: string | null
}

export interface CreateAppointmentModalProps {
  clinicId: string
  defaultDate: string
  defaultDoctorId?: string
  defaultTime?: string
  /** Если передан — пациент уже выбран, UI поиска скрыт. */
  defaultPatient?: DefaultPatient | null
  /** Если передан — после создания записи пишется событие в deal_events. */
  dealId?: string | null
  onClose: () => void
  onCreated: (appointmentId?: string) => void
}

export function CreateAppointmentModal({
  clinicId,
  defaultDate,
  defaultDoctorId,
  defaultTime,
  defaultPatient,
  dealId,
  onClose,
  onCreated,
}: CreateAppointmentModalProps) {
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
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string; phone: string } | null>(
    defaultPatient
      ? { id: defaultPatient.id, full_name: defaultPatient.full_name, phone: defaultPatient.phone ?? '' }
      : null
  )

  /* new patient form */
  const [newPat, setNewPat] = useState({
    full_name: '',
    phone: defaultPatient?.phone ? defaultPatient.phone : '+7 7',
    gender: 'other' as 'male' | 'female' | 'other',
    birth_date: '',
  })
  const [newPatSaving, setNewPatSaving] = useState(false)
  const [newPatError, setNewPatError]   = useState('')

  /* ── appointment types from clinic settings ── */
  const [apptTypes, setApptTypes] = useState<ApptTypeItem[]>(DEFAULT_APPT_TYPES)

  /* ── booking form ── */
  const [form, setForm] = useState({
    doctor_id: defaultDoctorId ?? '',
    date: defaultDate,
    time_start: defaultTime ?? '09:00',
    notes: '',
    is_walkin: false,
  })
  const [apptTypeKey, setApptTypeKey] = useState<string>(DEFAULT_APPT_TYPES[0].key)
  const [apptColor, setApptColor] = useState<string>(DEFAULT_APPT_TYPES[0].color)
  const [customDuration, setCustomDuration] = useState<number | null>(null) // null = use doctor default
  const [takenSlots, setTakenSlots]   = useState<string[]>([])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  /* ── clinic working hours + slot interval ── */
  const [workStart, setWorkStart]     = useState('08:00')
  const [workEnd, setWorkEnd]         = useState('20:00')
  const [workDayOff, setWorkDayOff]   = useState(false)
  const [slotInterval, setSlotInterval] = useState(15)

  /* ── prepayment ── */
  const [payMethods, setPayMethods] = useState<PayMethodRow[]>(FALLBACK_PAY_METHODS)
  const [prepayEnabled, setPrepayEnabled] = useState(false)
  const [prepayAmount,  setPrepayAmount]  = useState('')
  const [prepayMethod,  setPrepayMethod]  = useState<PaymentMethodCode>('cash')
  const [prepayNotes,   setPrepayNotes]   = useState('')

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  /* ── load doctors ── */
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
        if (list[0] && !defaultDoctorId) setForm(f => ({ ...f, doctor_id: list[0].id }))
      })
  }, [])

  /* ── load clinic payment methods ── */
  useEffect(() => {
    if (!clinicId) return
    supabase
      .from('payment_methods')
      .select('id, name, method_code')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        const rows = (data ?? []) as PayMethodRow[]
        if (rows.length > 0) {
          setPayMethods(rows)
          setPrepayMethod(rows[0].method_code)
        }
      })
  }, [clinicId]) // eslint-disable-line react-hooks/exhaustive-deps

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
        const savedTypes = data?.settings?.appt_types as ApptTypeItem[] | undefined
        if (savedTypes?.length) { setApptTypes(savedTypes); setApptTypeKey(savedTypes[0].key); setApptColor(savedTypes[0].color) }
        if (data?.settings?.slot_interval_min) {
          setSlotInterval(data.settings.slot_interval_min as number)
        }
        if (!wh) return
        const applyDay = (dateStr: string) => {
          const dayIdx = new Date(dateStr + 'T12:00:00').getDay()
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

  /* ── load taken slots ── */
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

  const todayStr   = new Date().toISOString().slice(0, 10)
  const isToday    = form.date === todayStr
  const nowMinutes = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes() })()

  /* Quick date presets (CRM ask) */
  const setDateTo = (d: Date) => {
    const iso = d.toISOString().slice(0, 10)
    setForm(f => ({ ...f, date: iso }))
  }
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d })()

  /* ── submit ── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.doctor_id) { setError('Выберите врача'); return }
    setError(''); setSaving(true)

    // Auto-register new patient if needed
    let patientId = selectedPatient?.id ?? null
    if (!patientId) {
      if (patientMode !== 'new' || !newPat.full_name.trim()) { setError('Укажите пациента'); setSaving(false); return }
      const { data: pat, error: pErr } = await supabase.from('patients').insert({
        clinic_id: clinicId, full_name: newPat.full_name.trim(),
        phones: newPat.phone.replace(/\D/g,'').length > 3 ? [newPat.phone.trim()] : [],
        gender: newPat.gender, birth_date: newPat.birth_date || null,
        status: 'new', is_vip: false, balance_amount: 0, debt_amount: 0, tags: [],
      }).select('id, full_name, phones').single()
      if (pErr || !pat) { setError(pErr?.message ?? 'Ошибка создания пациента'); setSaving(false); return }
      patientId = pat.id
      setSelectedPatient({ id: pat.id, full_name: pat.full_name, phone: pat.phones?.[0] ?? '' })
    }

    const timeEnd = calcEnd(form.time_start, duration)
    const { data: conflicts } = await supabase.from('appointments').select('id')
      .eq('doctor_id', form.doctor_id).eq('date', form.date)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .lt('time_start', timeEnd + ':00').gt('time_end', form.time_start + ':00')
    if (conflicts && conflicts.length > 0) { setError(`Конфликт: уже есть запись в ${form.time_start}`); setSaving(false); return }

    const notesWithMeta = formatNotesMeta(apptTypeKey, apptColor, form.notes.trim())
    let insertData: Record<string, unknown> = {
      clinic_id: clinicId, patient_id: patientId, doctor_id: form.doctor_id,
      date: form.date, time_start: form.time_start + ':00', time_end: timeEnd + ':00',
      duration_min: duration, status: 'pending', is_walkin: form.is_walkin,
      source: 'admin', notes: notesWithMeta, color: apptColor, appt_type: apptTypeKey,
      ...(dealId ? { deal_id: dealId } : {}),
    }
    let { data: appt, error: err } = await supabase.from('appointments').insert(insertData).select('id').single()
    if (err?.message?.includes('appt_type') || err?.message?.includes('color')) {
      const { appt_type: _a, color: _c, ...basic } = insertData; void _a; void _c; insertData = basic
      const r2 = await supabase.from('appointments').insert(insertData).select('id').single()
      appt = r2.data; err = r2.error
    }
    if (err || !appt) { setError(err?.message ?? 'Ошибка'); setSaving(false); return }

    const { data: visit } = await supabase.from('visits').insert({
      clinic_id: clinicId, patient_id: patientId,
      doctor_id: form.doctor_id, appointment_id: appt.id, status: 'open',
    }).select('id').single()

    // Предоплата (если включена).
    const prepayNum = prepayEnabled ? Number(prepayAmount.replace(',', '.')) : 0
    let prepaymentInserted = false
    if (prepayEnabled && prepayNum > 0) {
      const { error: payErr } = await supabase.from('payments').insert({
        clinic_id:  clinicId,
        patient_id: patientId,
        visit_id:   visit?.id ?? null,
        amount:     prepayNum,
        method:     prepayMethod,
        type:       'prepayment',
        status:     'completed',
        notes:      prepayNotes.trim() || null,
      })
      if (payErr) {
        setError(`Запись создана, но предоплата не прошла: ${payErr.message}`)
        setSaving(false)
        return
      }
      prepaymentInserted = true
    }

    // Лог события в хронологию сделки.
    if (dealId) {
      const doctorName = selectedDoctor
        ? `${selectedDoctor.last_name ?? ''} ${selectedDoctor.first_name ?? ''}`.trim()
        : null
      const dateLabel = new Date(form.date + 'T12:00:00').toLocaleDateString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      })
      await supabase.from('deal_events').insert({
        clinic_id: clinicId,
        deal_id: dealId,
        kind: 'appointment_created',
        ref_table: 'appointments',
        ref_id: appt.id,
        payload: {
          doctor_name: doctorName,
          date: form.date,
          time: form.time_start,
          preview: `Запись на ${dateLabel} ${form.time_start}${doctorName ? ` · ${doctorName}` : ''}`,
          appt_type: apptTypeKey,
          patient_name: selectedPatient?.full_name ?? null,
        },
      })
      if (prepaymentInserted) {
        const methodLabel =
          payMethods.find(m => m.method_code === prepayMethod)?.name ?? prepayMethod
        await supabase.from('deal_events').insert({
          clinic_id: clinicId,
          deal_id: dealId,
          kind: 'prepayment_received',
          ref_table: 'appointments',
          ref_id: appt.id,
          payload: {
            amount: prepayNum,
            method: prepayMethod,
            method_label: methodLabel,
            preview: `Предоплата ${prepayNum.toLocaleString('ru-RU')} ₸ · ${methodLabel}`,
          },
        })
      }
    }

    onCreated(appt.id); onClose()
  }

  const patientLocked = Boolean(defaultPatient) // режим «из сделки»

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md z-10 max-h-[96vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-900">
            {dealId ? 'Записать на приём' : 'Новая запись'}
          </h3>
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
              {!selectedPatient && !patientLocked && (
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

            {selectedPatient ? (
              <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{selectedPatient.full_name}</p>
                  {selectedPatient.phone && <p className="text-xs text-gray-500 mt-0.5">{selectedPatient.phone}</p>}
                </div>
                {!patientLocked && (
                  <button type="button" onClick={clearPatient}
                    className="text-gray-400 hover:text-red-500 transition-colors ml-3 text-lg leading-none">×</button>
                )}
              </div>
            ) : patientMode === 'search' ? (
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
                        if (!raw.startsWith('+7 ')) return
                        const digits = raw.slice(3).replace(/\D/g, '').slice(0, 10)
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
                <button type="button" onClick={registerNewPatient} disabled={newPatSaving || !newPat.full_name.trim()}
                  className="text-xs text-gray-500 underline hover:text-gray-700 disabled:opacity-40">
                  {newPatSaving ? 'Создание…' : '(или создать сейчас)'}
                </button>
                <p className="text-xs text-gray-400">Пациент создастся автоматически при нажатии «Создать запись»</p>
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

          {/* ── 3. DATE + QUICK PRESETS ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Дата <span className="text-red-400">*</span></label>
              <div className="flex gap-1">
                <button type="button" onClick={() => setDateTo(new Date())}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${form.date === todayStr ? 'bg-blue-600 text-white' : 'bg-slate-100 text-gray-600 hover:bg-slate-200'}`}>
                  Сегодня
                </button>
                <button type="button" onClick={() => setDateTo(tomorrow)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${form.date === tomorrow.toISOString().slice(0, 10) ? 'bg-blue-600 text-white' : 'bg-slate-100 text-gray-600 hover:bg-slate-200'}`}>
                  Завтра
                </button>
              </div>
            </div>
            <input type="date" className={inputCls} value={form.date} required
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls + ' mb-0'}>Время <span className="text-red-400">*</span></label>
              <span className="text-xs text-gray-300">{workStart}–{workEnd}</span>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <input
                type="time"
                step={slotInterval * 60}
                value={form.time_start}
                onChange={e => setForm(f => ({ ...f, time_start: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none transition bg-white w-32 flex-shrink-0"
              />
              <div className="flex items-center gap-1 flex-wrap">
                {[15, 30, 45, 60, 90, 120].map(min => (
                  <button key={min} type="button"
                    onClick={() => setCustomDuration(min === (selectedDoctor?.consultation_duration ?? 30) && customDuration === null ? null : min)}
                    className={['px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
                      duration === min ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'].join(' ')}>
                    {min < 60 ? `${min}м` : min === 60 ? '1ч' : `${min / 60}ч`}
                  </button>
                ))}
              </div>
              {form.time_start && (
                <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                  → {calcEnd(form.time_start, duration)}
                </span>
              )}
            </div>

            {workDayOff ? (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5 text-sm text-orange-700">
                🚫 В этот день клиника не работает по расписанию.{' '}
                <a href="/settings/clinic" target="_blank" className="underline font-medium">Изменить расписание</a>
              </div>
            ) : (
              <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                {ALL_SLOTS.map(slot => {
                  const taken    = takenSlots.includes(slot)
                  const sel      = form.time_start === slot
                  const [slotH, slotM] = slot.split(':').map(Number)
                  const isPast   = isToday && ((slotH ?? 0) * 60 + (slotM ?? 0)) < nowMinutes
                  const disabled = taken || isPast
                  return (
                    <button
                      key={slot} type="button"
                      disabled={disabled}
                      onClick={() => setForm(f => ({ ...f, time_start: slot }))}
                      className={[
                        'flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border',
                        taken  ? 'bg-red-50 text-red-300 border-red-100 cursor-not-allowed line-through'
                        : isPast ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                        : sel  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600',
                      ].join(' ')}
                    >
                      {slot}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── 4. TYPE / COLOR ── */}
          <div>
            <label className={labelCls}>Тип приёма</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {apptTypes.map(t => (
                <button key={t.key} type="button"
                  onClick={() => { setApptTypeKey(t.key); setApptColor(t.color) }}
                  className={[
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                    apptTypeKey === t.key
                      ? 'text-white border-transparent shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                  ].join(' ')}
                  style={apptTypeKey === t.key ? { backgroundColor: t.color, borderColor: t.color } : {}}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Свой цвет:</span>
              <input type="color" value={apptColor}
                onChange={e => { setApptColor(e.target.value); setApptTypeKey('other') }}
                className="w-7 h-7 rounded-md border border-gray-200 cursor-pointer p-0.5 bg-white" />
              <span className="text-xs text-gray-400 font-mono">{apptColor}</span>
            </div>
          </div>

          {/* ── 4b. PREPAYMENT ── */}
          <div className="border border-gray-200 rounded-xl p-3 bg-slate-50/60">
            <label className="flex items-center justify-between cursor-pointer select-none">
              <span className="text-sm font-medium text-gray-700">Взять предоплату</span>
              <span
                onClick={() => setPrepayEnabled(v => !v)}
                className={['w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                  prepayEnabled ? 'bg-blue-600' : 'bg-gray-300'].join(' ')}
              >
                <span className={['absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                  prepayEnabled ? 'translate-x-5' : 'translate-x-0.5'].join(' ')} />
              </span>
            </label>
            {prepayEnabled && (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <label className={labelCls}>Сумма, ₸ <span className="text-red-400">*</span></label>
                    <input
                      type="number" inputMode="decimal" min="0" step="100"
                      className={inputCls}
                      placeholder="0"
                      value={prepayAmount}
                      onChange={e => setPrepayAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-1 pb-0.5">
                    {[5000, 10000, 20000].map(v => (
                      <button key={v} type="button"
                        onClick={() => setPrepayAmount(String(v))}
                        className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:border-blue-400 hover:text-blue-600">
                        {v.toLocaleString('ru-RU')}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Способ оплаты</label>
                  <div className="flex flex-wrap gap-1.5">
                    {payMethods.map(pm => (
                      <button key={pm.id} type="button"
                        onClick={() => setPrepayMethod(pm.method_code)}
                        className={[
                          'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                          prepayMethod === pm.method_code
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:text-blue-600',
                        ].join(' ')}>
                        {pm.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Комментарий к оплате</label>
                  <input type="text" className={inputCls}
                    placeholder="необязательно"
                    value={prepayNotes}
                    onChange={e => setPrepayNotes(e.target.value)} />
                </div>
                <p className="text-[11px] text-gray-400">
                  Сумма зачислится на депозит пациента и будет списана при оплате визита.
                </p>
              </div>
            )}
          </div>

          {/* ── 5. NOTES + WALK-IN ── */}
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

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 flex-shrink-0">
          <button type="button" onClick={onClose} disabled={saving}
            className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
            Отмена
          </button>
          <button
            type="button"
            disabled={
              saving || !form.doctor_id || doctorsLoading ||
              (patientMode === 'new' ? !newPat.full_name.trim() : !selectedPatient) ||
              (prepayEnabled && !(Number(prepayAmount.replace(',', '.')) > 0))
            }
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
            {saving
              ? 'Сохранение...'
              : prepayEnabled && Number(prepayAmount.replace(',', '.')) > 0
                ? `Создать + ${Number(prepayAmount.replace(',', '.')).toLocaleString('ru-RU')} ₸`
                : 'Создать запись'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CreateAppointmentModal
