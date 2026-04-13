'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type Service = {
  id: string
  name: string
  category: string
  price: number
  duration_minutes: number
  is_active: boolean
}

type ServiceForm = {
  name: string
  category: string
  price: string
  duration_minutes: string
  is_active: boolean
}

const EMPTY_FORM: ServiceForm = {
  name: '',
  category: '',
  price: '',
  duration_minutes: '30',
  is_active: true,
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

function formatPrice(price: number): string {
  return price.toLocaleString('ru-RU') + ' ₸'
}

export default function ServicesPage() {
  const router = useRouter()
  const toast = useToast()

  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState<string>('Все')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadServices()
  }, [])

  async function loadServices() {
    setLoading(true)
    const { data } = await supabase
      .from('services')
      .select('id,name,category,price,duration_minutes,is_active')
      .order('category', { ascending: true })
    setServices(data || [])
    setLoading(false)
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowModal(true)
  }

  function openEdit(svc: Service) {
    setEditingId(svc.id)
    setForm({
      name: svc.name || '',
      category: svc.category || '',
      price: svc.price != null ? String(svc.price) : '',
      duration_minutes: svc.duration_minutes != null ? String(svc.duration_minutes) : '30',
      is_active: svc.is_active !== false,
    })
    setShowModal(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const payload = {
      name: form.name,
      category: form.category || null,
      price: form.price !== '' ? Number(form.price) : null,
      duration_minutes: form.duration_minutes !== '' ? Number(form.duration_minutes) : 30,
      is_active: form.is_active,
    }
    let error
    if (editingId) {
      const res = await supabase.from('services').update(payload).eq('id', editingId)
      error = res.error
    } else {
      const res = await supabase.from('services').insert(payload)
      error = res.error
    }
    setSaving(false)
    if (!error) {
      setShowModal(false)
      setForm(EMPTY_FORM)
      await loadServices()
      toast.show('Сохранено', 'success')
    } else {
      toast.show('Ошибка при сохранении', 'error')
    }
  }

  // Unique categories
  const categories = ['Все', ...Array.from(new Set(services.map(s => s.category).filter(Boolean)))]

  const filtered = activeCategory === 'Все'
    ? services
    : services.filter(s => s.category === activeCategory)

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
            Услуги
          </h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            Всего: {services.length} услуг
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
          + Добавить услугу
        </button>
      </div>

      {/* Category filter tabs */}
      {categories.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                border: activeCategory === cat ? '1px solid #0B63C2' : '1px solid #E5E7EB',
                background: activeCategory === cat ? '#EEF4FF' : '#fff',
                color: activeCategory === cat ? '#0B63C2' : '#6B7280',
                transition: 'all 0.1s',
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Services list */}
      {loading ? (
        <p style={{ fontSize: 14, color: '#6B7280' }}>Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div style={{ ...cardStyle, padding: '48px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Услуг пока нет</p>
        </div>
      ) : (
        <div style={{ ...cardStyle, overflow: 'hidden' }}>
          {filtered.map((svc, i) => (
            <div
              key={svc.id}
              onMouseEnter={() => setHoveredRow(svc.id)}
              onMouseLeave={() => setHoveredRow(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '13px 20px',
                background: hoveredRow === svc.id ? '#F9FAFB' : '#fff',
                borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none',
                transition: 'background 0.1s',
              }}
            >
              {/* Name */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: svc.is_active ? '#141414' : '#9CA3AF',
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {svc.name}
                </p>
              </div>

              {/* Category badge */}
              {svc.category && (
                <span style={{
                  fontSize: 12,
                  fontWeight: 500,
                  background: '#F3F4F6',
                  color: '#374151',
                  borderRadius: 12,
                  padding: '3px 10px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}>
                  {svc.category}
                </span>
              )}

              {/* Duration */}
              <span style={{ fontSize: 13, color: '#6B7280', whiteSpace: 'nowrap', flexShrink: 0, minWidth: 50, textAlign: 'right' }}>
                {svc.duration_minutes ? `${svc.duration_minutes} мин` : '—'}
              </span>

              {/* Price */}
              <span style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#141414',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                minWidth: 90,
                textAlign: 'right',
              }}>
                {svc.price != null ? formatPrice(svc.price) : '—'}
              </span>

              {/* Edit button */}
              <button
                onClick={() => openEdit(svc)}
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
              {editingId ? 'Редактировать услугу' : 'Добавить услугу'}
            </h2>
            <form onSubmit={handleSave}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Название *</label>
                <input
                  style={inputStyle}
                  required
                  placeholder="Консультация врача"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Категория</label>
                <input
                  style={inputStyle}
                  placeholder="Консультация, Диагностика, Процедура..."
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Цена (₸)</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    style={inputStyle}
                    placeholder="5000"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Длительность (мин)</label>
                  <input
                    type="number"
                    min="1"
                    step="5"
                    style={inputStyle}
                    placeholder="30"
                    value={form.duration_minutes}
                    onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  />
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
                  Активная
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
