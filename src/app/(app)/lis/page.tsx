'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type LabTest = {
  id: string
  patient_id: string | null
  patient_name: string
  patient_phone: string
  test_name: string
  ordered_by: string
  status: string
  result_text: string
  price: number | null
  date_ordered: string
  date_ready: string
  notes: string
  created_at: string
}

type PatientHint = { id: string; full_name: string; phone: string }

const STATUS_LABELS: Record<string, string> = {
  pending:     'Ожидает',
  in_progress: 'В работе',
  ready:       'Готов',
}
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:     { bg: '#FFFBEB', text: '#D97706' },
  in_progress: { bg: '#EEF4FF', text: '#0B63C2' },
  ready:       { bg: '#ECFDF5', text: '#059669' },
}

export default function LisPage() {
  const router = useRouter()
  const toast = useToast()
  const [tests, setTests] = useState<LabTest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [showResult, setShowResult] = useState<LabTest | null>(null)
  const [saving, setSaving] = useState(false)
  const [patientQuery, setPatientQuery] = useState('')
  const [patientHints, setPatientHints] = useState<PatientHint[]>([])
  const [showHints, setShowHints] = useState(false)

  const [doctors, setDoctors] = useState<{ id: string; full_name: string }[]>([])
  const [services, setServices] = useState<{ id: string; name: string; price: number | null; duration_minutes: number }[]>([])

  const emptyForm = {
    patient_id: '', patient_name: '', patient_phone: '',
    test_name: '', ordered_by: '', status: 'pending',
    result_text: '', price: '', date_ordered: new Date().toISOString().split('T')[0],
    date_ready: '', notes: '',
  }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    supabase.from('doctors').select('id,full_name').eq('is_active', true).order('full_name').then(({ data }) => setDoctors(data || []))
    supabase.from('services').select('id,name,price,duration_minutes').eq('is_active', true).order('name').then(({ data }) => setServices(data || []))
    loadTests()
  }, [])

  async function loadTests() {
    setLoading(true)
    const { data } = await supabase.from('lab_tests').select('*').order('created_at', { ascending: false })
    setTests(data || [])
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
    setForm(f => ({ ...f, patient_id: p.id, patient_name: p.full_name, patient_phone: p.phone || '' }))
    setShowHints(false)
  }

  async function saveTest(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('lab_tests').insert([{
      patient_id: form.patient_id || null,
      patient_name: form.patient_name,
      patient_phone: form.patient_phone,
      test_name: form.test_name,
      ordered_by: form.ordered_by,
      status: form.status,
      result_text: form.result_text,
      price: form.price ? parseFloat(form.price) : null,
      date_ordered: form.date_ordered,
      date_ready: form.date_ready || null,
      notes: form.notes,
    }])
    setSaving(false)
    setShowForm(false)
    setForm(emptyForm)
    setPatientQuery('')
    toast.show('Анализ добавлен')
    loadTests()
  }

  async function changeStatus(id: string, status: string) {
    await supabase.from('lab_tests').update({ status }).eq('id', id)
    setTests(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  const filtered = tests.filter(t => {
    const matchStatus = filterStatus === 'all' || t.status === filterStatus
    const matchSearch = t.patient_name.toLowerCase().includes(search.toLowerCase()) ||
      t.test_name.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB',
    borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none',
    boxSizing: 'border-box' as const, background: '#fff',
  }
  const labelStyle = {
    display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5,
  } as const

  const counts = {
    all: tests.length,
    pending: tests.filter(t => t.status === 'pending').length,
    in_progress: tests.filter(t => t.status === 'in_progress').length,
    ready: tests.filter(t => t.status === 'ready').length,
  }

  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#141414', margin: '0 0 2px' }}>Лаборатория</h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>{tests.length} анализов</p>
        </div>
        <button
          onClick={() => { setForm(emptyForm); setPatientQuery(''); setShowForm(true) }}
          style={{ background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
        >
          + Новый анализ
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([['all', 'Все'], ['pending', 'Ожидает'], ['in_progress', 'В работе'], ['ready', 'Готов']] as [string, string][]).map(([v, l]) => (
          <button key={v} onClick={() => setFilterStatus(v)}
            style={{ padding: '6px 14px', borderRadius: 20, border: '1px solid', fontSize: 13, cursor: 'pointer', fontWeight: filterStatus === v ? 600 : 400,
              borderColor: filterStatus === v ? '#0B63C2' : '#D1D5DB',
              background: filterStatus === v ? '#0B63C2' : '#fff',
              color: filterStatus === v ? '#fff' : '#374151' }}>
            {l} {counts[v as keyof typeof counts]}
          </button>
        ))}
        <input
          placeholder="Поиск по пациенту или анализу..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 200, marginLeft: 'auto' }}
        />
      </div>

      {/* List */}
      {loading ? (
        <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 15, color: '#141414', fontWeight: 500, margin: '0 0 6px' }}>Анализов нет</p>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>Нажмите «+ Новый анализ» чтобы добавить</p>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, overflow: 'hidden' }}>
          {filtered.map((t, i) => {
            const sc = STATUS_COLORS[t.status] || STATUS_COLORS.pending
            return (
              <div key={t.id} style={{ padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 3px' }}>{t.test_name}</p>
                  <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
                    {t.patient_name}
                    {t.ordered_by && <span style={{ color: '#D1D5DB' }}> · </span>}
                    {t.ordered_by && <span>Назначил: {t.ordered_by}</span>}
                  </p>
                  <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>
                    Заказан: {t.date_ordered}
                    {t.date_ready && ` · Готов: ${t.date_ready}`}
                    {t.price != null && ` · ${Number(t.price).toLocaleString('ru-RU')} ₸`}
                  </p>
                </div>
                {t.status === 'ready' && (
                  <button onClick={() => setShowResult(t)}
                    style={{ fontSize: 12, color: '#059669', background: '#ECFDF5', border: 'none', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    Результат
                  </button>
                )}
                <select
                  value={t.status}
                  onChange={e => changeStatus(t.id, e.target.value)}
                  style={{ background: sc.bg, color: sc.text, border: 'none', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', outline: 'none', appearance: 'none' }}
                >
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* Create modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginBottom: 24, marginTop: 0 }}>Новый анализ</h2>
            <form onSubmit={saveTest}>
              {/* Patient search */}
              <div style={{ marginBottom: 16, position: 'relative' }}>
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
                <label style={labelStyle}>Название анализа</label>
                <input style={inputStyle} required value={form.test_name} onChange={e => setForm(f => ({ ...f, test_name: e.target.value }))} placeholder="ОАК, биохимия, УЗИ..." />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Назначил</label>
                  <select
                    style={inputStyle}
                    value={form.ordered_by}
                    onChange={e => setForm(f => ({ ...f, ordered_by: e.target.value }))}
                  >
                    <option value="">—</option>
                    {doctors.map(d => (
                      <option key={d.id} value={d.full_name}>{d.full_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Цена (₸)</label>
                  <input type="number" style={inputStyle} value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0" />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Дата заказа</label>
                  <input type="date" style={inputStyle} required value={form.date_ordered} onChange={e => setForm(f => ({ ...f, date_ordered: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>Дата готовности</label>
                  <input type="date" style={inputStyle} value={form.date_ready} onChange={e => setForm(f => ({ ...f, date_ready: e.target.value }))} />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Статус</label>
                <select style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Результат</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} value={form.result_text}
                  onChange={e => setForm(f => ({ ...f, result_text: e.target.value }))} placeholder="Результаты анализа..." />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Заметки</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 50 }} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Дополнительная информация..." />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" onClick={() => setShowForm(false)}
                  style={{ flex: 1, padding: '10px 0', border: '1px solid #D1D5DB', borderRadius: 8, background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151' }}>
                  Отмена
                </button>
                <button type="submit" disabled={saving}
                  style={{ flex: 1, padding: '10px 0', border: 'none', borderRadius: 8, background: '#0B63C2', color: '#fff', fontSize: 14, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Сохраняем...' : 'Сохранить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Result modal */}
      {showResult && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 480 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginBottom: 4, marginTop: 0 }}>{showResult.test_name}</h2>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>{showResult.patient_name} · {showResult.date_ready || showResult.date_ordered}</p>
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: 16, fontSize: 14, color: '#141414', lineHeight: 1.6, marginBottom: 20, whiteSpace: 'pre-wrap', minHeight: 80 }}>
              {showResult.result_text || 'Результат не указан'}
            </div>
            {showResult.notes && <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>Заметки: {showResult.notes}</p>}
            <button onClick={() => setShowResult(null)}
              style={{ width: '100%', padding: '10px 0', border: '1px solid #D1D5DB', borderRadius: 8, background: '#fff', fontSize: 14, cursor: 'pointer', color: '#374151' }}>
              Закрыть
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
