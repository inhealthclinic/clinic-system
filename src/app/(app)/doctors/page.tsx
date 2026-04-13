'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type Doctor = {
  id: string
  full_name: string
  specialty: string
  phone: string
  color: string
  is_active: boolean
}

type DoctorForm = {
  full_name: string
  specialty: string
  phone: string
  color: string
  is_active: boolean
}

const EMPTY_FORM: DoctorForm = {
  full_name: '',
  specialty: '',
  phone: '',
  color: '#0B63C2',
  is_active: true,
}

const PRESET_COLORS = ['#0B63C2', '#059669', '#7C3AED', '#D97706', '#DC2626', '#0891B2']

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

export default function DoctorsPage() {
  const router = useRouter()
  const toast = useToast()

  const [doctors, setDoctors] = useState<Doctor[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<DoctorForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadDoctors()
  }, [])

  async function loadDoctors() {
    setLoading(true)
    const { data } = await supabase
      .from('doctors')
      .select('id,full_name,specialty,phone,color,is_active')
      .order('full_name', { ascending: true })
    setDoctors(data || [])
    setLoading(false)
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  function openEdit(doc: Doctor) {
    setEditingId(doc.id)
    setForm({
      full_name: doc.full_name || '',
      specialty: doc.specialty || '',
      phone: doc.phone || '',
      color: doc.color || '#0B63C2',
      is_active: doc.is_active !== false,
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    let error
    if (editingId) {
      const res = await supabase.from('doctors').update({
        full_name: form.full_name,
        specialty: form.specialty || null,
        phone: form.phone || null,
        color: form.color,
        is_active: form.is_active,
      }).eq('id', editingId)
      error = res.error
    } else {
      const res = await supabase.from('doctors').insert({
        full_name: form.full_name,
        specialty: form.specialty || null,
        phone: form.phone || null,
        color: form.color,
        is_active: form.is_active,
      })
      error = res.error
    }
    setSaving(false)
    if (!error) {
      setShowModal(false)
      setForm(EMPTY_FORM)
      await loadDoctors()
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

  return (
    <div style={{ padding: '24px', maxWidth: 860, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#141414', margin: '0 0 4px' }}>
            Врачи
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            Всего: {doctors.length} врачей
          </p>
        </div>
        <button
          onClick={openCreate}
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
          + Добавить врача
        </button>
      </div>

      {/* Doctors list */}
      {loading ? (
        <p style={{ fontSize: 14, color: '#6B7280' }}>Загрузка...</p>
      ) : doctors.length === 0 ? (
        <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Врачей пока нет</p>
        </div>
      ) : (
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          {doctors.map((doc, i) => (
            <div
              key={doc.id}
              onMouseEnter={() => setHoveredRow(doc.id)}
              onMouseLeave={() => setHoveredRow(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '13px 20px',
                background: hoveredRow === doc.id ? '#F9FAFB' : '#fff',
                borderBottom: i < doctors.length - 1 ? '1px solid #F3F4F6' : 'none',
                transition: 'background 0.1s',
              }}
            >
              {/* Color dot */}
              <div style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                background: doc.color || '#0B63C2',
                flexShrink: 0,
              }} />

              {/* Name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.full_name}
                  {!doc.is_active && (
                    <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 400, marginLeft: 8 }}>неактивный</span>
                  )}
                </p>
                <p style={{ fontSize: 13, color: '#6B7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.specialty || '—'}
                </p>
              </div>

              {/* Phone */}
              <div style={{ width: 150, flexShrink: 0 }}>
                <p style={{ fontSize: 13, color: '#6B7280', margin: 0, textAlign: 'right' }}>
                  {doc.phone || '—'}
                </p>
              </div>

              {/* Edit button */}
              <button
                onClick={() => openEdit(doc)}
                style={{
                  fontSize: 13,
                  color: '#0B63C2',
                  background: 'none',
                  border: '1px solid #DBEAFE',
                  borderRadius: 6,
                  padding: '5px 12px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                Изм.
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
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
              {editingId ? 'Редактировать врача' : 'Добавить врача'}
            </h2>
            <form onSubmit={handleSave}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>ФИО *</label>
                <input
                  style={inputStyle}
                  required
                  placeholder="Иванов Иван Иванович"
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Специализация</label>
                <input
                  style={inputStyle}
                  placeholder="Терапевт, Гинеколог..."
                  value={form.specialty}
                  onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
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

              {/* Color picker */}
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Цвет</label>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, color: c }))}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 14,
                        background: c,
                        border: form.color === c ? '3px solid #141414' : '3px solid transparent',
                        cursor: 'pointer',
                        padding: 0,
                        outline: form.color === c ? '2px solid #fff' : 'none',
                        outlineOffset: -4,
                        flexShrink: 0,
                        boxSizing: 'border-box' as const,
                      }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>

              {/* is_active checkbox */}
              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#374151' }}>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  Активный
                </label>
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
