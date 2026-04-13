'use client'
import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Payment = {
  id: string
  patient_id: string | null
  patient_name: string
  appointment_id: string | null
  service: string
  doctor_name: string
  amount: number
  method: string
  status: string
  date: string
  notes: string
  created_at: string
}

type PatientHint = { id: string; full_name: string; phone: string }

const METHOD_LABELS: Record<string, string> = {
  cash:     'Наличные',
  card:     'Карта',
  transfer: 'Перевод',
}
const STATUS_LABELS: Record<string, string> = {
  paid:    'Оплачено',
  pending: 'Ожидает',
  refund:  'Возврат',
}
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  paid:    { bg: '#ECFDF5', text: '#059669' },
  pending: { bg: '#FFFBEB', text: '#D97706' },
  refund:  { bg: '#FEF2F2', text: '#DC2626' },
}
const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  cash:     { bg: '#F3F4F6', text: '#374151' },
  card:     { bg: '#EEF4FF', text: '#0B63C2' },
  transfer: { bg: '#F5F3FF', text: '#7C3AED' },
}

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU')
}

export default function FinancePage() {
  const router = useRouter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterMethod, setFilterMethod] = useState('all')
  const [periodDays, setPeriodDays] = useState(30)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [patientQuery, setPatientQuery] = useState('')
  const [patientHints, setPatientHints] = useState<PatientHint[]>([])
  const [showHints, setShowHints] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const emptyForm = {
    patient_id: '', patient_name: '', service: '',
    doctor_name: '', amount: '', method: 'cash',
    status: 'paid', date: today, notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadPayments()
  }, [periodDays])

  async function loadPayments() {
    setLoading(true)
    const from = new Date()
    from.setDate(from.getDate() - periodDays)
    const { data } = await supabase.from('payments').select('*')
      .gte('date', from.toISOString().split('T')[0])
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    setPayments(data || [])
    setLoading(false)
  }

  async function searchPatients(q: string) {
    setPatientQuery(q)
    setForm(f => ({ ...f, patient_name: q, patient_id: '' }))
    if (q.length < 2) { setPatientHints([]); return }
    const { data } = await supabase.from('patients').select('id,full_name,phone')
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`).limit(6)
    setPatientHints(data || [])
    setShowHints(true)
  }

  function selectPatient(p: PatientHint) {
    setPatientQuery(p.full_name)
    setForm(f => ({ ...f, patient_id: p.id, patient_name: p.full_name }))
    setShowHints(false)
  }

  async function savePayment(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('payments').insert([{
      patient_id: form.patient_id || null,
      patient_name: form.patient_name,
      service: form.service,
      doctor_name: form.doctor_name,
      amount: parseFloat(form.amount),
      method: form.method,
      status: form.status,
      date: form.date,
      notes: form.notes,
    }])
    setSaving(false)
    setShowForm(false)
    setForm(emptyForm)
    setPatientQuery('')
    loadPayments()
  }

  const filtered = payments.filter(p => {
    const ms = filterStatus === 'all' || p.status === filterStatus
    const mm = filterMethod === 'all' || p.method === filterMethod
    return ms && mm
  })

  // Summary
  const todayStr = today
  const thisMonthStart = today.slice(0, 7) + '-01'
  const totalToday = payments.filter(p => p.date === todayStr && p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
  const totalMonth = payments.filter(p => p.date >= thisMonthStart && p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0)
  const totalPending = payments.filter(p => p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0)
  const countToday = payments.filter(p => p.date === todayStr && p.status === 'paid').length

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB',
    borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none',
    boxSizing: 'border-box', background: '#fff',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5,
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F5', fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E8EDF5', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 13, padding: 0 }}>← Назад</button>
          <span style={{ color: '#D1D5DB' }}>|</span>
          <div style={{ width: 28, height: 28, background: '#0B63C2', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#141414' }}>Финансы</span>
        </div>
        <button onClick={() => { setForm(emptyForm); setPatientQuery(''); setShowForm(true) }}
          style={{ background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          + Добавить оплату
        </button>
      </div>

      <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Сегодня', value: `${fmt(totalToday)} ₸`, sub: `${countToday} оплат`, color: '#059669' },
            { label: 'За месяц', value: `${fmt(totalMonth)} ₸`, sub: 'оплаченные', color: '#0B63C2' },
            { label: 'Ожидают', value: `${fmt(totalPending)} ₸`, sub: `${payments.filter(p => p.status === 'pending').length} записей`, color: '#D97706' },
          ].map(c => (
            <div key={c.label} style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '18px 20px' }}>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px', fontWeight: 500 }}>{c.label}</p>
              <p style={{ fontSize: 20, fontWeight: 700, color: c.color, margin: '0 0 2px' }}>{c.value}</p>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={periodDays} onChange={e => setPeriodDays(Number(e.target.value))}
            style={{ ...inputStyle, width: 'auto', padding: '6px 12px' }}>
            <option value={7}>7 дней</option>
            <option value={30}>30 дней</option>
            <option value={90}>3 месяца</option>
            <option value={365}>Год</option>
          </select>
          {[['all', 'Все статусы'], ['paid', 'Оплачено'], ['pending', 'Ожидает'], ['refund', 'Возврат']].map(([v, l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid', fontSize: 13, cursor: 'pointer', fontWeight: filterStatus === v ? 600 : 400,
                borderColor: filterStatus === v ? '#0B63C2' : '#D1D5DB',
                background: filterStatus === v ? '#0B63C2' : '#fff',
                color: filterStatus === v ? '#fff' : '#374151' }}>{l}</button>
          ))}
          {[['all', 'Все методы'], ['cash', 'Наличные'], ['card', 'Карта'], ['transfer', 'Перевод']].map(([v, l]) => (
            <button key={v} onClick={() => setFilterMethod(v)}
              style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid', fontSize: 13, cursor: 'pointer', fontWeight: filterMethod === v ? 600 : 400,
                borderColor: filterMethod === v ? '#374151' : '#D1D5DB',
                background: filterMethod === v ? '#374151' : '#fff',
                color: filterMethod === v ? '#fff' : '#374151' }}>{l}</button>
          ))}
        </div>

        {loading ? <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
          : filtered.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, color: '#141414', fontWeight: 500, margin: '0 0 6px' }}>Оплат нет</p>
              <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>Нажмите «+ Добавить оплату» чтобы добавить</p>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, overflow: 'hidden' }}>
              {filtered.map((p, i) => {
                const sc = STATUS_COLORS[p.status] || STATUS_COLORS.paid
                const mc = METHOD_COLORS[p.method] || METHOD_COLORS.cash
                return (
                  <div key={p.id} style={{ padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 3px' }}>{p.patient_name}</p>
                      <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
                        {p.service || '—'}
                        {p.doctor_name && <span style={{ color: '#D1D5DB' }}> · </span>}
                        {p.doctor_name}
                      </p>
                      <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>{p.date}</p>
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 700, color: p.status === 'refund' ? '#DC2626' : '#141414', minWidth: 100, textAlign: 'right' }}>
                      {p.status === 'refund' ? '−' : ''}{fmt(p.amount)} ₸
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, background: mc.bg, color: mc.text, borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                      {METHOD_LABELS[p.method]}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 500, background: sc.bg, color: sc.text, borderRadius: 12, padding: '3px 9px', whiteSpace: 'nowrap' }}>
                      {STATUS_LABELS[p.status]}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {/* Create modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginBottom: 24, marginTop: 0 }}>Добавить оплату</h2>
            <form onSubmit={savePayment}>
              <div style={{ marginBottom: 16, position: 'relative' }}>
                <label style={labelStyle}>Пациент</label>
                <input style={inputStyle} placeholder="Поиск по имени или телефону..." value={patientQuery} required
                  onChange={e => searchPatients(e.target.value)} onFocus={() => patientHints.length > 0 && setShowHints(true)} autoComplete="off" />
                {showHints && patientHints.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 2 }}>
                    {patientHints.map(p => (
                      <div key={p.id} onClick={() => selectPatient(p)}
                        style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #F3F4F6', fontSize: 14 }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                        <p style={{ margin: 0, fontWeight: 500, color: '#141414' }}>{p.full_name}</p>
                        <p style={{ margin: 0, fontSize: 12, color: '#6B7280' }}>{p.phone || '—'}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Услуга</label>
                <input style={inputStyle} value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} placeholder="Консультация, УЗИ..." />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Врач</label>
                <input style={inputStyle} value={form.doctor_name} onChange={e => setForm(f => ({ ...f, doctor_name: e.target.value }))} placeholder="ФИО врача" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Сумма (₸)</label>
                  <input type="number" style={inputStyle} required min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
                </div>
                <div>
                  <label style={labelStyle}>Дата</label>
                  <input type="date" style={inputStyle} required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Метод оплаты</label>
                  <select style={inputStyle} value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                    {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Статус</label>
                  <select style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Заметки</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Дополнительная информация..." />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowForm(false)} style={{ flex: 1, padding: '10px 0', border: '1px solid #D1D5DB', borderRadius: 8, background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151' }}>Отмена</button>
                <button type="submit" disabled={saving} style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, background: '#0B63C2', color: '#fff', fontSize: 14, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
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
