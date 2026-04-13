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

type NewPatientForm = {
  full_name: string
  phone: string
  birth_date: string
  gender: string
  source: string
}

const EMPTY_FORM: NewPatientForm = {
  full_name: '',
  phone: '',
  birth_date: '',
  gender: 'female',
  source: 'Instagram',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid #D1D5DB',
  borderRadius: 8,
  fontSize: 14,
  color: '#141414',
  outline: 'none',
  boxSizing: 'border-box' as const,
  background: '#fff',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  color: '#374151',
  marginBottom: 5,
}

function getInitials(name: string): string {
  if (!name) return '?'
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('')
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

export default function PatientsPage() {
  const router = useRouter()
  const toast = useToast()

  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<NewPatientForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadPatients()
  }, [])

  async function loadPatients() {
    setLoading(true)
    const { data } = await supabase
      .from('patients')
      .select('id,full_name,phone,birth_date,gender,source,created_at')
      .order('created_at', { ascending: false })
    setPatients(data || [])
    setLoading(false)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('patients').insert({
      full_name: form.full_name,
      phone: form.phone || null,
      birth_date: form.birth_date || null,
      gender: form.gender,
      source: form.source,
    })
    setSaving(false)
    if (!error) {
      setShowModal(false)
      setForm(EMPTY_FORM)
      await loadPatients()
      toast.show('Сохранено', 'success')
    } else {
      toast.show('Ошибка при сохранении', 'error')
    }
  }

  const filtered = patients.filter(p => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.phone?.toLowerCase().includes(q)
    )
  })

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #E8EDF5',
    borderRadius: 12,
  }

  return (
    <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#141414', margin: '0 0 4px' }}>
            Пациенты
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            Всего: {patients.length} пациентов
          </p>
        </div>
        <button
          onClick={() => { setForm(EMPTY_FORM); setShowModal(true) }}
          style={{
            background: '#0B63C2',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '9px 18px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          + Новый пациент
        </button>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          style={inputStyle}
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Patient list */}
      {loading ? (
        <p style={{ fontSize: 14, color: '#6B7280' }}>Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>
            {search ? 'Ничего не найдено' : 'Пациентов пока нет'}
          </p>
        </div>
      ) : (
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          {filtered.map((p, i) => (
            <div
              key={p.id}
              onClick={() => router.push(`/patients/${p.id}`)}
              onMouseEnter={() => setHoveredRow(p.id)}
              onMouseLeave={() => setHoveredRow(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '13px 20px',
                cursor: 'pointer',
                background: hoveredRow === p.id ? '#F9FAFB' : '#fff',
                borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none',
                transition: 'background 0.1s',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                background: '#EEF4FF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                color: '#0B63C2',
                flexShrink: 0,
              }}>
                {getInitials(p.full_name)}
              </div>

              {/* Name + phone + source */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.full_name}
                </p>
                <p style={{ fontSize: 13, color: '#6B7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.phone || '—'}
                  {p.source ? <span style={{ color: '#9CA3AF' }}> · {p.source}</span> : null}
                </p>
              </div>

              {/* Birth date */}
              <div style={{ width: 110, flexShrink: 0, textAlign: 'right' }}>
                <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
                  {p.birth_date ? formatDate(p.birth_date) : '—'}
                </p>
              </div>

              {/* Chevron */}
              <div style={{ color: '#D1D5DB', fontSize: 16, flexShrink: 0, marginLeft: 4 }}>›</div>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
          padding: 16,
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 16,
            padding: '32px',
            width: '100%',
            maxWidth: 460,
            maxHeight: '90vh',
            overflowY: 'auto',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginTop: 0, marginBottom: 24 }}>
              Новый пациент
            </h2>
            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>ФИО *</label>
                <input
                  style={inputStyle}
                  required
                  placeholder="Иванова Айгерим Сериковна"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Телефон</label>
                <input
                  style={inputStyle}
                  placeholder="+7 708 000 00 00"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Дата рождения</label>
                <input
                  type="date"
                  style={inputStyle}
                  value={form.birth_date}
                  onChange={e => setForm(f => ({ ...f, birth_date: e.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={labelStyle}>Пол</label>
                  <select
                    style={inputStyle}
                    value={form.gender}
                    onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
                  >
                    <option value="female">Женский</option>
                    <option value="male">Мужской</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Источник</label>
                  <select
                    style={inputStyle}
                    value={form.source}
                    onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
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
                  onClick={() => setShowModal(false)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    border: '1px solid #D1D5DB',
                    borderRadius: 8,
                    background: '#fff',
                    fontSize: 14,
                    cursor: 'pointer',
                    color: '#374151',
                  }}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    border: 'none',
                    borderRadius: 8,
                    background: '#0B63C2',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
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
