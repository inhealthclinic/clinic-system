'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type Appointment = {
  id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string
  doctor_name: string
  service: string
  date: string
  start_time: string
  end_time: string
  status: string
  notes: string
  created_at: string
}

type PatientHint = {
  id: string
  full_name: string
  phone: string
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Запись',
  arrived:   'Пришёл',
  completed: 'Завершён',
  cancelled: 'Отменён',
  no_show:   'Не пришёл',
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  scheduled: { bg: '#EEF4FF', text: '#0B63C2' },
  arrived:   { bg: '#ECFDF5', text: '#059669' },
  completed: { bg: '#F3F4F6', text: '#6B7280' },
  cancelled: { bg: '#FEF2F2', text: '#DC2626' },
  no_show:   { bg: '#FFFBEB', text: '#D97706' },
}

const DAY_NAMES_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function getMondayOf(d: Date) {
  const date = new Date(d)
  const day = date.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
}

function formatDateRu(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatDateHeader(d: Date) {
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function formatWeekRange(monday: Date) {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('ru-RU', opts)} — ${sunday.toLocaleDateString('ru-RU', opts)}`
}

function addMinutesToTime(timeStr: string, minutes: number): string {
  const [h, m] = timeStr.split(':').map(Number)
  const total = h * 60 + m + minutes
  const nh = Math.floor(total / 60) % 24
  const nm = total % 60
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
}

export default function SchedulePage() {
  const router = useRouter()
  const toast = useToast()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()))
  const [selectedDate, setSelectedDate] = useState(() => toDateStr(new Date()))
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [patientQuery, setPatientQuery] = useState('')
  const [patientHints, setPatientHints] = useState<PatientHint[]>([])
  const [showHints, setShowHints] = useState(false)
  const patientSearchRef = useRef<HTMLDivElement>(null)

  const [doctors, setDoctors] = useState<{ id: string; full_name: string }[]>([])
  const [services, setServices] = useState<{ id: string; name: string; price: number | null; duration_minutes: number }[]>([])

  const emptyForm = {
    patient_id: '',
    patient_name: '',
    patient_phone: '',
    doctor_name: '',
    service: '',
    date: selectedDate,
    start_time: '09:00',
    end_time: '09:30',
    status: 'scheduled',
    notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    supabase.from('doctors').select('id,full_name').eq('is_active', true).order('full_name').then(({ data }) => setDoctors(data || []))
    supabase.from('services').select('id,name,price,duration_minutes').eq('is_active', true).order('name').then(({ data }) => setServices(data || []))
  }, [router])

  useEffect(() => {
    loadWeek()
  }, [weekStart])

  async function loadWeek() {
    setLoading(true)
    const from = toDateStr(weekStart)
    const to = toDateStr(new Date(weekStart.getTime() + 6 * 86400000))
    const { data } = await supabase
      .from('appointments')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('start_time', { ascending: true })
    setAppointments(data || [])
    setLoading(false)
  }

  function weekDays(): Date[] {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d
    })
  }

  function countFor(dateStr: string) {
    return appointments.filter(a => a.date === dateStr).length
  }

  function appointmentsForDay() {
    return appointments.filter(a => a.date === selectedDate)
  }

  function prevWeek() {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    setWeekStart(d)
    setSelectedDate(toDateStr(d))
  }

  function nextWeek() {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    setWeekStart(d)
    setSelectedDate(toDateStr(d))
  }

  async function searchPatients(q: string) {
    setPatientQuery(q)
    setForm(f => ({ ...f, patient_name: q, patient_id: '' }))
    if (q.length < 2) { setPatientHints([]); return }
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, phone')
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(6)
    setPatientHints(data || [])
    setShowHints(true)
  }

  function selectPatient(p: PatientHint) {
    setPatientQuery(p.full_name)
    setForm(f => ({ ...f, patient_id: p.id, patient_name: p.full_name, patient_phone: p.phone || '' }))
    setShowHints(false)
  }

  function openForm() {
    setForm({ ...emptyForm, date: selectedDate })
    setPatientQuery('')
    setPatientHints([])
    setShowForm(true)
  }

  function handleServiceChange(serviceId: string) {
    const svc = services.find(s => s.id === serviceId)
    if (!svc) {
      setForm(f => ({ ...f, service: '' }))
      return
    }
    const newEnd = svc.duration_minutes
      ? addMinutesToTime(form.start_time, svc.duration_minutes)
      : form.end_time
    setForm(f => ({ ...f, service: svc.name, end_time: newEnd }))
  }

  async function saveAppointment(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      patient_id: form.patient_id || null,
      patient_name: form.patient_name,
      patient_phone: form.patient_phone,
      doctor_name: form.doctor_name,
      service: form.service,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      status: form.status,
      notes: form.notes,
    }
    await supabase.from('appointments').insert([payload])
    setSaving(false)
    setShowForm(false)
    toast.show('Приём добавлен')
    loadWeek()
  }

  async function changeStatus(id: string, status: string) {
    await supabase.from('appointments').update({ status }).eq('id', id)
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  const todayStr = toDateStr(new Date())
  const days = weekDays()
  const dayAppts = appointmentsForDay()

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB',
    borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none',
    boxSizing: 'border-box' as const, background: '#fff',
  }
  const labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5,
  } as const

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#141414', margin: '0 0 2px' }}>Расписание</h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            {formatDateRu(new Date(selectedDate + 'T00:00:00'))}
          </p>
        </div>
        <button onClick={openForm} style={{ background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          + Новый приём
        </button>
      </div>

      {/* Week navigation */}
      <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #F3F4F6' }}>
          <button onClick={prevWeek} style={{ background: 'none', border: '1px solid #E8EDF5', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: '#374151', fontSize: 13 }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#141414' }}>{formatWeekRange(weekStart)}</span>
          <button onClick={nextWeek} style={{ background: 'none', border: '1px solid #E8EDF5', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', color: '#374151', fontSize: 13 }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {days.map((d, i) => {
            const ds = toDateStr(d)
            const isSelected = ds === selectedDate
            const isToday = ds === todayStr
            const count = countFor(ds)
            return (
              <button
                key={ds}
                onClick={() => setSelectedDate(ds)}
                style={{
                  background: isSelected ? '#0B63C2' : 'transparent',
                  border: 'none',
                  borderRight: i < 6 ? '1px solid #F3F4F6' : 'none',
                  padding: '12px 6px',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  transition: 'background 0.1s',
                }}
              >
                <span style={{ fontSize: 11, color: isSelected ? 'rgba(255,255,255,0.75)' : '#6B7280', fontWeight: 500 }}>{DAY_NAMES_SHORT[i]}</span>
                <span style={{
                  fontSize: 15, fontWeight: 600,
                  color: isSelected ? '#fff' : isToday ? '#0B63C2' : '#141414',
                  background: isToday && !isSelected ? '#EEF4FF' : 'transparent',
                  width: 28, height: 28, borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{d.getDate()}</span>
                {count > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    background: isSelected ? 'rgba(255,255,255,0.25)' : '#EEF4FF',
                    color: isSelected ? '#fff' : '#0B63C2',
                    borderRadius: 10, padding: '1px 6px',
                    minWidth: 18, textAlign: 'center',
                  }}>{count}</span>
                )}
                {count === 0 && <span style={{ height: 18 }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Day header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: '#141414', margin: 0 }}>
          {formatDateHeader(new Date(selectedDate + 'T00:00:00'))}
          <span style={{ fontSize: 13, fontWeight: 400, color: '#6B7280', marginLeft: 8 }}>
            {dayAppts.length > 0 ? `${dayAppts.length} приём${dayAppts.length === 1 ? '' : dayAppts.length < 5 ? 'а' : 'ов'}` : 'нет приёмов'}
          </span>
        </h2>
      </div>

      {/* Appointments list */}
      {loading ? (
        <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
      ) : dayAppts.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📅</div>
          <p style={{ fontSize: 15, color: '#141414', fontWeight: 500, margin: '0 0 6px' }}>На этот день записей нет</p>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Нажмите «+ Новый приём» чтобы добавить запись</p>
          <button onClick={openForm} style={{ background: '#EEF4FF', color: '#0B63C2', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            + Добавить приём
          </button>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, overflow: 'hidden' }}>
          {dayAppts.map((a, i) => {
            const sc = STATUS_COLORS[a.status] || STATUS_COLORS.scheduled
            return (
              <div key={a.id} style={{ padding: '14px 20px', borderBottom: i < dayAppts.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ minWidth: 60, textAlign: 'center' }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: 0 }}>{a.start_time.slice(0, 5)}</p>
                  {a.end_time && <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>{a.end_time.slice(0, 5)}</p>}
                </div>
                <div style={{ width: 3, height: 40, background: '#0B63C2', borderRadius: 2, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.patient_name}</p>
                  <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
                    {a.doctor_name}
                    {a.service && <span style={{ color: '#D1D5DB' }}> · </span>}
                    {a.service}
                  </p>
                  {a.patient_phone && <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>{a.patient_phone}</p>}
                </div>
                <select
                  value={a.status}
                  onChange={e => changeStatus(a.id, e.target.value)}
                  style={{
                    background: sc.bg, color: sc.text, border: 'none',
                    borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer', outline: 'none', appearance: 'none',
                  }}
                >
                  {Object.entries(STATUS_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* Create appointment modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginBottom: 24, marginTop: 0 }}>Новый приём</h2>
            <form onSubmit={saveAppointment}>
              {/* Patient search */}
              <div style={{ marginBottom: 16, position: 'relative' }} ref={patientSearchRef}>
                <label style={labelStyle}>Пациент</label>
                <input
                  style={inputStyle}
                  placeholder="Поиск по имени или телефону..."
                  value={patientQuery}
                  required
                  onChange={e => searchPatients(e.target.value)}
                  onFocus={() => patientHints.length > 0 && setShowHints(true)}
                  autoComplete="off"
                />
                {showHints && patientHints.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 2 }}>
                    {patientHints.map(p => (
                      <div
                        key={p.id}
                        onClick={() => selectPatient(p)}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #F3F4F6', fontSize: 14 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                      >
                        <p style={{ margin: 0, fontWeight: 500, color: '#141414' }}>{p.full_name}</p>
                        <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}>{p.phone || '—'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Doctor dropdown */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Врач</label>
                <select
                  style={inputStyle}
                  required
                  value={form.doctor_name}
                  onChange={e => setForm(f => ({ ...f, doctor_name: e.target.value }))}
                >
                  <option value="">Выберите врача</option>
                  {doctors.map(d => (
                    <option key={d.id} value={d.full_name}>{d.full_name}</option>
                  ))}
                </select>
              </div>

              {/* Service dropdown */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Услуга</label>
                <select
                  style={inputStyle}
                  value={services.find(s => s.name === form.service)?.id || ''}
                  onChange={e => handleServiceChange(e.target.value)}
                >
                  <option value="">—</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Date + Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Дата</label>
                  <input type="date" style={inputStyle} required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Статус</label>
                  <select style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>

              {/* Time */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Начало</label>
                  <input type="time" style={inputStyle} required value={form.start_time}
                    onChange={e => {
                      const svc = services.find(s => s.name === form.service)
                      const newEnd = svc?.duration_minutes
                        ? addMinutesToTime(e.target.value, svc.duration_minutes)
                        : form.end_time
                      setForm(f => ({ ...f, start_time: e.target.value, end_time: newEnd }))
                    }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Конец</label>
                  <input type="time" style={inputStyle} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
                </div>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Заметки</label>
                <textarea
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Дополнительная информация..."
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  style={{ flex: 1, padding: '10px 0', border: '1px solid #D1D5DB', borderRadius: 8, background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151' }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, background: '#0B63C2', color: '#fff', fontSize: 14, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? 'Сохраняем...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
