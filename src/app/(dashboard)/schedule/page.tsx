'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { Appointment, Doctor } from '@/types'
import {
  PHONE_PREFIX,
  formatPhoneInput,
  normalizePhoneKZ,
  onPhoneKeyDown,
} from '@/lib/utils/phone'

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

// ─── CreateAppointmentModal ───────────────────────────────────────────────────

function CreateAppointmentModal({ clinicId, defaultDate, prefilledPatientId, onClose, onCreated }: {
  clinicId: string
  defaultDate: string
  prefilledPatientId?: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [doctors, setDoctors] = useState<DoctorRow[]>([])
  const [patients, setPatients] = useState<{ id: string; full_name: string; phones: string[] }[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatientName, setSelectedPatientName] = useState('')
  const [selectedPatientPhone, setSelectedPatientPhone] = useState('')

  // New patient registration inline
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [newPatient, setNewPatient] = useState({ full_name: '', phone: PHONE_PREFIX, gender: 'other' as 'male' | 'female' | 'other', birth_date: '' })
  const [registeringPatient, setRegisteringPatient] = useState(false)

  const [form, setForm] = useState({
    doctor_id: '',
    patient_id: prefilledPatientId ?? '',
    date: defaultDate,
    time_start: '09:00',
    notes: '',
    is_walkin: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('doctors')
      .select('id, first_name, last_name, color, consultation_duration')
      .eq('is_active', true)
      .is('deleted_at', null)
      .then(({ data }) => {
        setDoctors(data ?? [])
        if (data?.[0]) setForm(f => ({ ...f, doctor_id: data[0].id }))
      })
  }, [])

  // When opened from a deep link (?patient=…), preload that patient's
  // name + phone so the search field shows the selected pill straight away.
  useEffect(() => {
    if (!prefilledPatientId) return
    supabase
      .from('patients')
      .select('id, full_name, phones')
      .eq('id', prefilledPatientId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSelectedPatientName(data.full_name)
          setSelectedPatientPhone((data.phones?.[0] as string) ?? '')
        }
      })
  }, [prefilledPatientId])

  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, phones')
        .is('deleted_at', null)
        .ilike('full_name', `%${patientSearch}%`)
        .limit(8)
      setPatients(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch])

  const selectedDoctor = doctors.find(d => d.id === form.doctor_id)
  const duration = selectedDoctor?.consultation_duration ?? 30

  const calcEnd = (start: string, min: number) => {
    const [h, m] = start.split(':').map(Number)
    const total = h * 60 + m + min
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  const registerNewPatient = async () => {
    if (!newPatient.full_name.trim()) return
    setRegisteringPatient(true)
    const normalizedPhone = normalizePhoneKZ(newPatient.phone)
    const { data: pat, error: pErr } = await supabase.from('patients').insert({
      clinic_id: clinicId,
      full_name: newPatient.full_name.trim(),
      phones: normalizedPhone ? [normalizedPhone] : [],
      gender: newPatient.gender,
      birth_date: newPatient.birth_date || null,
      status: 'new',
      is_vip: false,
      balance_amount: 0,
      debt_amount: 0,
      tags: [],
    }).select('id, full_name, phones').single()
    setRegisteringPatient(false)
    if (pErr || !pat) { setError(pErr?.message ?? 'Ошибка регистрации'); return }
    setForm(f => ({ ...f, patient_id: pat.id }))
    setSelectedPatientName(pat.full_name)
    setSelectedPatientPhone(pat.phones?.[0] ?? '')
    setShowNewPatient(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.patient_id) { setError('Выберите или зарегистрируйте пациента'); return }
    if (!form.doctor_id)  { setError('Выберите врача'); return }
    setError('')
    setSaving(true)

    const timeEnd = calcEnd(form.time_start, duration)

    // Check for overlapping appointments for same doctor (rule A1)
    const timeEndForCheck = calcEnd(form.time_start, duration) + ':00'
    const { data: conflicts } = await supabase
      .from('appointments')
      .select('id, time_start, time_end')
      .eq('doctor_id', form.doctor_id)
      .eq('date', form.date)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .lt('time_start', timeEndForCheck)
      .gt('time_end', form.time_start + ':00')

    if (conflicts && conflicts.length > 0) {
      setError(`Конфликт: у врача уже есть запись в это время`)
      setSaving(false)
      return
    }

    const { data: appt, error: err } = await supabase.from('appointments').insert({
      clinic_id: clinicId,
      patient_id: form.patient_id,
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

    if (err) { setError(err.message); setSaving(false); return }

    // Auto-create open visit (rule A5)
    await supabase.from('visits').insert({
      clinic_id: clinicId,
      patient_id: form.patient_id,
      doctor_id: form.doctor_id,
      appointment_id: appt.id,
      status: 'open',
    })

    onCreated()
    onClose()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Новая запись</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Patient search / select / register */}
          <div>
            <label className={labelCls}>Пациент <span className="text-red-400">*</span></label>

            {form.patient_id ? (
              /* Selected state */
              <div className="flex items-center justify-between border border-green-200 bg-green-50 rounded-lg px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">{selectedPatientName}</p>
                  {selectedPatientPhone && <p className="text-xs text-gray-400">{selectedPatientPhone}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => { setForm(f => ({ ...f, patient_id: '' })); setPatientSearch(''); setShowNewPatient(false) }}
                  className="text-gray-400 hover:text-gray-600 text-xs ml-2"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Search input */}
                <div className="relative">
                  <input
                    className={inputCls}
                    placeholder="Поиск по имени или телефону..."
                    value={patientSearch}
                    onChange={e => { setPatientSearch(e.target.value); setShowNewPatient(false) }}
                    autoFocus
                  />
                  {/* Dropdown results */}
                  {patientSearch.length >= 2 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                      {patients.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setForm(f => ({ ...f, patient_id: p.id }))
                            setSelectedPatientName(p.full_name)
                            setSelectedPatientPhone(p.phones?.[0] ?? '')
                          }}
                          className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 last:border-0"
                        >
                          <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                          {p.phones?.[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                        </button>
                      ))}
                      {/* Register new patient option */}
                      <button
                        type="button"
                        onClick={() => setShowNewPatient(v => !v)}
                        className="w-full text-left px-4 py-2.5 bg-blue-50 hover:bg-blue-100 transition-colors flex items-center gap-2"
                      >
                        <span className="text-blue-600 font-bold text-base leading-none">+</span>
                        <span className="text-sm text-blue-600 font-medium">
                          {patients.length === 0
                            ? `Зарегистрировать «${patientSearch}»`
                            : 'Зарегистрировать нового пациента'}
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                {/* New patient inline form */}
                {showNewPatient && (
                  <div className="border border-blue-200 rounded-xl p-4 bg-blue-50/50 space-y-3">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Регистрация нового пациента</p>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">ФИО <span className="text-red-400">*</span></label>
                      <input
                        className={inputCls}
                        placeholder="Айгерим Бекова"
                        value={newPatient.full_name}
                        onChange={e => setNewPatient(p => ({ ...p, full_name: e.target.value }))}
                        autoFocus
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Телефон</label>
                        <input
                          type="tel"
                          className={inputCls}
                          placeholder={PHONE_PREFIX + ' XXXXXXXXX'}
                          value={newPatient.phone}
                          onChange={e => setNewPatient(p => ({ ...p, phone: formatPhoneInput(e.target.value) }))}
                          onKeyDown={onPhoneKeyDown}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Пол</label>
                        <select className={inputCls} value={newPatient.gender}
                          onChange={e => setNewPatient(p => ({ ...p, gender: e.target.value as 'male' | 'female' | 'other' }))}>
                          <option value="female">Женский</option>
                          <option value="male">Мужской</option>
                          <option value="other">Не указан</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Дата рождения</label>
                      <input type="date" className={inputCls} value={newPatient.birth_date}
                        onChange={e => setNewPatient(p => ({ ...p, birth_date: e.target.value }))} />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => setShowNewPatient(false)}
                        className="flex-1 border border-gray-200 text-gray-600 rounded-lg py-2 text-xs font-medium hover:bg-white">
                        Отмена
                      </button>
                      <button type="button" onClick={registerNewPatient}
                        disabled={registeringPatient || !newPatient.full_name.trim()}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg py-2 text-xs font-medium">
                        {registeringPatient ? 'Создание...' : '✓ Зарегистрировать'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Doctor */}
          <div>
            <label className={labelCls}>Врач <span className="text-red-400">*</span></label>
            <select
              className={inputCls}
              value={form.doctor_id}
              onChange={e => setForm(f => ({ ...f, doctor_id: e.target.value }))}
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

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Дата <span className="text-red-400">*</span></label>
              <input
                type="date"
                className={inputCls}
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Время <span className="text-red-400">*</span></label>
              <input
                type="time"
                className={inputCls}
                value={form.time_start}
                onChange={e => setForm(f => ({ ...f, time_start: e.target.value }))}
                step="900"
                required
              />
            </div>
          </div>

          {selectedDoctor && (
            <p className="text-xs text-gray-400 -mt-2">
              ⏱ {duration} мин · конец в {calcEnd(form.time_start, duration)}
            </p>
          )}

          {/* Notes */}
          <div>
            <label className={labelCls}>Заметка</label>
            <textarea
              className={inputCls + ' resize-none'}
              placeholder="Причина обращения..."
              rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          {/* Walk-in */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setForm(f => ({ ...f, is_walkin: !f.is_walkin }))}
              className={[
                'w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                form.is_walkin ? 'bg-blue-600' : 'bg-gray-200',
              ].join(' ')}
            >
              <span className={[
                'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                form.is_walkin ? 'translate-x-5' : 'translate-x-0.5',
              ].join(' ')} />
            </div>
            <span className="text-sm text-gray-700">Walk-in (без записи заранее)</span>
          </label>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
            >
              Отмена
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              {saving ? 'Сохранение...' : 'Создать запись'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
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

  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  // Deep link from CRM deal drawer: /schedule?patient=<uuid>
  const prefilledPatientId = searchParams.get('patient')

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState<boolean>(Boolean(prefilledPatientId))
  const [selected, setSelected] = useState<Appointment | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'grid'>('list')

  // When the modal closes after a deep link, scrub `patient` from the URL
  // so a subsequent manual close+open doesn't auto-reopen with stale id.
  const closeCreate = useCallback(() => {
    setShowCreate(false)
    if (prefilledPatientId) router.replace(pathname)
  }, [prefilledPatientId, pathname, router])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('appointments')
      .select('*, patient:patients(id, full_name, phones), doctor:doctors(id, first_name, last_name, color)')
      .eq('date', date)
      .neq('status', 'cancelled')
      .order('time_start')
    setAppointments((data ?? []) as Appointment[])
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

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
    <div className="max-w-3xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => shiftDate(-1)}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-lg leading-none"
        >‹</button>
        <div className="flex-1 text-center min-w-[200px]">
          <input
            type="date" value={date}
            onChange={e => setDate(e.target.value)}
            className="sr-only" id="sched-date"
          />
          <label
            htmlFor="sched-date"
            className="text-base font-semibold text-gray-900 capitalize cursor-pointer hover:text-blue-600"
          >
            {dateLabel}
          </label>
        </div>
        <button
          onClick={() => shiftDate(1)}
          className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-500 text-lg leading-none"
        >›</button>
        <button
          onClick={() => setDate(new Date().toISOString().slice(0, 10))}
          className="text-sm text-blue-600 font-medium px-3 py-2 rounded-lg hover:bg-blue-50"
        >
          Сегодня
        </button>
        <span className="text-sm text-gray-400">{appointments.length} записей</span>

        {/* View toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['list', 'grid'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {v === 'list' ? '☰ Список' : '⊞ Сетка'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
        >
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
          prefilledPatientId={prefilledPatientId}
          onClose={closeCreate}
          onCreated={() => { load(); closeCreate() }}
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
