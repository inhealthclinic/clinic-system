'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type Patient = {
  id: string
  full_name: string
  phone: string
  birth_date: string
  gender: string
  source: string
  created_at: string
}

type Appointment = {
  id: string
  date: string
  start_time: string
  doctor_name: string
  service: string
  status: string
}

type LabTest = {
  id: string
  test_name: string
  ordered_by: string
  status: string
  date_ordered: string
  price: number | null
  result_text: string
}

type Payment = {
  id: string
  date: string
  service: string
  doctor_name: string
  amount: number
  method: string
  status: string
}

const APPT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Запись',
  arrived:   'Пришёл',
  completed: 'Завершён',
  cancelled: 'Отменён',
  no_show:   'Не пришёл',
}
const APPT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  scheduled: { bg: '#EEF4FF', text: '#0B63C2' },
  arrived:   { bg: '#ECFDF5', text: '#059669' },
  completed: { bg: '#F3F4F6', text: '#6B7280' },
  cancelled: { bg: '#FEF2F2', text: '#DC2626' },
  no_show:   { bg: '#FFFBEB', text: '#D97706' },
}
const LAB_STATUS_LABELS: Record<string, string> = {
  pending:     'Ожидает',
  in_progress: 'В работе',
  ready:       'Готов',
}
const LAB_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: '#FFFBEB', text: '#D97706' },
  in_progress: { bg: '#EEF4FF', text: '#0B63C2' },
  ready:       { bg: '#ECFDF5', text: '#059669' },
}
const PAY_STATUS_LABELS: Record<string, string> = {
  paid:    'Оплачено',
  pending: 'Ожидает',
  refund:  'Возврат',
}
const PAY_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  paid:    { bg: '#ECFDF5', text: '#059669' },
  pending: { bg: '#FFFBEB', text: '#D97706' },
  refund:  { bg: '#FEF2F2', text: '#DC2626' },
}
const METHOD_LABELS: Record<string, string> = {
  cash:     'Наличные',
  card:     'Карта',
  transfer: 'Перевод',
}
const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  cash:     { bg: '#F3F4F6', text: '#374151' },
  card:     { bg: '#EEF4FF', text: '#0B63C2' },
  transfer: { bg: '#F5F3FF', text: '#7C3AED' },
}

function calcAge(birthDate: string): number | null {
  if (!birthDate) return null
  const dob = new Date(birthDate)
  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
  return age
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function getInitials(name: string): string {
  if (!name) return '?'
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('')
}

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU')
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB',
  borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none',
  boxSizing: 'border-box', background: '#fff',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5,
}

export default function PatientPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()
  const toast = useToast()

  const [patient, setPatient] = useState<Patient | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'visits' | 'tests' | 'payments'>('visits')

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [labTests, setLabTests] = useState<LabTest[]>([])
  const [payments, setPayments] = useState<Payment[]>([])

  const [showEdit, setShowEdit] = useState(false)
  const [editForm, setEditForm] = useState({
    full_name: '', phone: '', birth_date: '', gender: 'female', source: 'Instagram',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadAll()
  }, [id])

  async function loadAll() {
    setLoading(true)
    const [patientRes, apptRes, labRes, payRes] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase.from('appointments').select('id,date,start_time,doctor_name,service,status')
        .eq('patient_id', id).order('date', { ascending: false }).limit(20),
      supabase.from('lab_tests').select('id,test_name,ordered_by,status,date_ordered,price,result_text')
        .eq('patient_id', id).order('date_ordered', { ascending: false }),
      supabase.from('payments').select('id,date,service,doctor_name,amount,method,status')
        .eq('patient_id', id).order('date', { ascending: false }),
    ])

    if (!patientRes.data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const p = patientRes.data as Patient
    setPatient(p)
    setEditForm({
      full_name:  p.full_name  || '',
      phone:      p.phone      || '',
      birth_date: p.birth_date || '',
      gender:     p.gender     || 'female',
      source:     p.source     || 'Instagram',
    })
    setAppointments(apptRes.data || [])
    setLabTests(labRes.data || [])
    setPayments(payRes.data || [])
    setLoading(false)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('patients').update({
      full_name:  editForm.full_name,
      phone:      editForm.phone,
      birth_date: editForm.birth_date || null,
      gender:     editForm.gender,
      source:     editForm.source,
    }).eq('id', id)
    setSaving(false)
    if (!error) {
      setPatient(prev => prev ? { ...prev, ...editForm } : prev)
      setShowEdit(false)
      toast.show('Сохранено', 'success')
    } else {
      toast.show('Ошибка при сохранении', 'error')
    }
  }

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #E8EDF5',
    borderRadius: 12,
  }

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>
        <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
      </div>
    )
  }

  if (notFound || !patient) {
    return (
      <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>
        <p style={{ fontSize: 15, color: '#141414' }}>Пациент не найден</p>
        <button onClick={() => router.back()} style={{ color: '#0B63C2', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0 }}>← Назад</button>
      </div>
    )
  }

  const age = calcAge(patient.birth_date)
  const paidTotal = payments.filter(p => p.status === 'paid').reduce((s, p) => s + Number(p.amount || 0), 0)
  const tabs: { key: 'visits' | 'tests' | 'payments'; label: string }[] = [
    { key: 'visits', label: 'Визиты' },
    { key: 'tests',  label: 'Анализы' },
    { key: 'payments', label: 'Оплаты' },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>

      {/* Top card: patient info */}
      <div style={{ ...cardStyle, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          {/* Left: avatar + info */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 24,
              background: '#0B63C2',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>
              {getInitials(patient.full_name)}
            </div>
            <div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: '#141414', margin: '0 0 4px' }}>
                {patient.full_name}
              </h1>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 3px' }}>
                {patient.phone || '—'}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 13, color: '#6B7280', marginTop: 4 }}>
                {patient.birth_date && (
                  <span>
                    {formatDate(patient.birth_date)}
                    {age !== null && <span style={{ color: '#9CA3AF' }}> · {age} лет</span>}
                  </span>
                )}
                {patient.gender && (
                  <span>{patient.gender === 'male' ? 'Мужской' : 'Женский'}</span>
                )}
                {patient.source && (
                  <span style={{ color: '#9CA3AF' }}>Источник: {patient.source}</span>
                )}
              </div>
            </div>
          </div>
          {/* Right: edit button */}
          <button
            onClick={() => setShowEdit(true)}
            style={{
              border: '1px solid #D1D5DB', borderRadius: 8, background: '#fff',
              fontSize: 14, cursor: 'pointer', color: '#374151', padding: '7px 16px',
              flexShrink: 0,
            }}
          >
            Редактировать
          </button>
        </div>
        {/* Created at */}
        {patient.created_at && (
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '14px 0 0' }}>
            Пациент с: {formatDate(patient.created_at)}
          </p>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #E8EDF5', marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid #0B63C2' : '2px solid transparent',
              marginBottom: -2,
              padding: '10px 18px',
              fontSize: 14,
              fontWeight: activeTab === t.key ? 600 : 400,
              color: activeTab === t.key ? '#0B63C2' : '#6B7280',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}

      {/* Visits */}
      {activeTab === 'visits' && (
        appointments.length === 0 ? (
          <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Визитов нет</p>
          </div>
        ) : (
          <div style={{ ...cardStyle, overflow: 'hidden', padding: 0 }}>
            {appointments.map((a, i) => {
              const sc = APPT_STATUS_COLORS[a.status] || APPT_STATUS_COLORS.scheduled
              return (
                <div key={a.id} style={{
                  padding: '13px 20px',
                  borderBottom: i < appointments.length - 1 ? '1px solid #F3F4F6' : 'none',
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{ width: 90, flexShrink: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: '#141414', margin: 0 }}>{formatDate(a.date)}</p>
                    {a.start_time && (
                      <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>{a.start_time.slice(0, 5)}</p>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.doctor_name || '—'}
                    </p>
                    <p style={{ fontSize: 12, color: '#6B7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.service || '—'}
                    </p>
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: 500,
                    background: sc.bg, color: sc.text,
                    borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap',
                  }}>
                    {APPT_STATUS_LABELS[a.status] || a.status}
                  </span>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Lab tests */}
      {activeTab === 'tests' && (
        labTests.length === 0 ? (
          <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Анализов нет</p>
          </div>
        ) : (
          <div style={{ ...cardStyle, overflow: 'hidden', padding: 0 }}>
            {labTests.map((t, i) => {
              const sc = LAB_STATUS_COLORS[t.status] || LAB_STATUS_COLORS.pending
              return (
                <div key={t.id} style={{
                  padding: '13px 20px',
                  borderBottom: i < labTests.length - 1 ? '1px solid #F3F4F6' : 'none',
                  display: 'flex', alignItems: 'center', gap: 16,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.test_name}
                    </p>
                    <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>
                      {t.ordered_by ? `Назначил: ${t.ordered_by} · ` : ''}
                      {formatDate(t.date_ordered)}
                      {t.price != null ? ` · ${fmt(t.price)} ₸` : ''}
                    </p>
                  </div>
                  {t.status === 'ready' && (
                    <button style={{
                      fontSize: 12, color: '#059669', background: '#ECFDF5',
                      border: 'none', borderRadius: 6, padding: '5px 10px',
                      cursor: 'pointer', whiteSpace: 'nowrap',
                    }}>
                      Результат
                    </button>
                  )}
                  <span style={{
                    fontSize: 12, fontWeight: 500,
                    background: sc.bg, color: sc.text,
                    borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap',
                  }}>
                    {LAB_STATUS_LABELS[t.status] || t.status}
                  </span>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Payments */}
      {activeTab === 'payments' && (
        payments.length === 0 ? (
          <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Оплат нет</p>
          </div>
        ) : (
          <>
            <div style={{ ...cardStyle, overflow: 'hidden', padding: 0 }}>
              {payments.map((p, i) => {
                const sc = PAY_STATUS_COLORS[p.status] || PAY_STATUS_COLORS.pending
                const mc = METHOD_COLORS[p.method] || METHOD_COLORS.cash
                return (
                  <div key={p.id} style={{
                    padding: '13px 20px',
                    borderBottom: i < payments.length - 1 ? '1px solid #F3F4F6' : 'none',
                    display: 'flex', alignItems: 'center', gap: 16,
                  }}>
                    <div style={{ width: 80, flexShrink: 0 }}>
                      <p style={{ fontSize: 13, color: '#141414', margin: 0 }}>{formatDate(p.date)}</p>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.service || '—'}
                      </p>
                      <p style={{ fontSize: 12, color: '#6B7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.doctor_name || '—'}
                      </p>
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 700, color: p.status === 'refund' ? '#DC2626' : '#141414', flexShrink: 0 }}>
                      {p.status === 'refund' ? '−' : ''}{fmt(p.amount)} ₸
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, background: mc.bg, color: mc.text, borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                      {METHOD_LABELS[p.method] || p.method}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, background: sc.bg, color: sc.text, borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                      {PAY_STATUS_LABELS[p.status] || p.status}
                    </span>
                  </div>
                )
              })}
            </div>
            {/* Total */}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#059669' }}>
                Итого оплачено: {fmt(paidTotal)} ₸
              </span>
            </div>
          </>
        )
      )}

      {/* Edit modal */}
      {showEdit && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16,
        }}>
          <div style={{
            background: '#fff', borderRadius: 16, padding: '32px',
            width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginTop: 0, marginBottom: 24 }}>
              Редактировать пациента
            </h2>
            <form onSubmit={saveEdit}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>ФИО</label>
                <input
                  style={inputStyle}
                  required
                  value={editForm.full_name}
                  onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Иванова Айгерим Сериковна"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Телефон</label>
                <input
                  style={inputStyle}
                  value={editForm.phone}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+7 708 000 00 00"
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Дата рождения</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={editForm.birth_date}
                  onChange={e => setEditForm(f => ({ ...f, birth_date: e.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={labelStyle}>Пол</label>
                  <select
                    style={inputStyle}
                    value={editForm.gender}
                    onChange={e => setEditForm(f => ({ ...f, gender: e.target.value }))}
                  >
                    <option value="female">Женский</option>
                    <option value="male">Мужской</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Источник</label>
                  <select
                    style={inputStyle}
                    value={editForm.source}
                    onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
                  >
                    <option>Instagram</option>
                    <option>WhatsApp</option>
                    <option>Телефон</option>
                    <option>Лично</option>
                    <option>Повторный</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setShowEdit(false)}
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
