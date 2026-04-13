'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Lead = {
  id: string
  full_name: string
  phone: string
  source: string
  status: string
  notes: string
  assigned_to: string
  created_at: string
}

const STATUSES = [
  { key: 'new',        label: 'Новый',     color: '#6B7280', bg: '#F3F4F6' },
  { key: 'contacted',  label: 'Связались', color: '#0B63C2', bg: '#EEF4FF' },
  { key: 'scheduled',  label: 'Записан',   color: '#7C3AED', bg: '#F5F3FF' },
  { key: 'converted',  label: 'Пришёл',    color: '#059669', bg: '#ECFDF5' },
  { key: 'lost',       label: 'Потерян',   color: '#DC2626', bg: '#FEF2F2' },
]

const SOURCES = ['Instagram', 'WhatsApp', 'Телефон', 'Лично', 'Сайт', 'Рекомендация']

function statusMeta(key: string) {
  return STATUSES.find(s => s.key === key) || STATUSES[0]
}

export default function CrmPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSource, setFilterSource] = useState('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [saving, setSaving] = useState(false)

  const emptyForm = { full_name: '', phone: '', source: 'Instagram', status: 'new', notes: '', assigned_to: '' }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadLeads()
  }, [])

  async function loadLeads() {
    setLoading(true)
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    setLeads(data || [])
    setLoading(false)
  }

  function openCreate() {
    setEditLead(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function openEdit(l: Lead) {
    setEditLead(l)
    setForm({ full_name: l.full_name, phone: l.phone || '', source: l.source || 'Instagram', status: l.status, notes: l.notes || '', assigned_to: l.assigned_to || '' })
    setShowForm(true)
  }

  async function saveLead(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    if (editLead) {
      await supabase.from('leads').update(form).eq('id', editLead.id)
    } else {
      await supabase.from('leads').insert([form])
    }
    setSaving(false)
    setShowForm(false)
    loadLeads()
  }

  async function changeStatus(id: string, status: string) {
    await supabase.from('leads').update({ status }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l))
  }

  const filtered = leads.filter(l => {
    const ms = filterStatus === 'all' || l.status === filterStatus
    const msrc = filterSource === 'all' || l.source === filterSource
    const mq = l.full_name?.toLowerCase().includes(search.toLowerCase()) || l.phone?.includes(search)
    return ms && msrc && mq
  })

  // Count by status for kanban header
  const countByStatus = (key: string) => leads.filter(l => l.status === key).length

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
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#141414' }}>CRM</span>
        </div>
        <button onClick={openCreate} style={{ background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          + Новый лид
        </button>
      </div>

      <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
        {/* Funnel summary */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 20 }}>
          {STATUSES.map((s, i) => (
            <div key={s.key} style={{ background: '#fff', border: `1px solid ${filterStatus === s.key ? s.color : '#E8EDF5'}`, borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onClick={() => setFilterStatus(filterStatus === s.key ? 'all' : s.key)}>
              <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 4px', fontWeight: 500 }}>{s.label}</p>
              <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{countByStatus(s.key)}</p>
              {i < STATUSES.length - 1 && <div style={{ height: 2, background: s.bg, borderRadius: 1, marginTop: 8 }} />}
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
            style={{ ...inputStyle, width: 'auto', padding: '6px 12px' }}>
            <option value="all">Все источники</option>
            {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Поиск по имени или телефону..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
        </div>

        {loading ? <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
          : filtered.length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
              <p style={{ fontSize: 15, color: '#141414', fontWeight: 500, margin: '0 0 6px' }}>Лидов нет</p>
              <p style={{ fontSize: 13, color: '#6B7280', margin: '0 0 20px' }}>Добавьте первого потенциального пациента</p>
              <button onClick={openCreate} style={{ background: '#EEF4FF', color: '#0B63C2', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                + Добавить лид
              </button>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, overflow: 'hidden' }}>
              {filtered.map((l, i) => {
                const sm = statusMeta(l.status)
                return (
                  <div key={l.id} style={{ padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
                    {/* Avatar */}
                    <div style={{ width: 40, height: 40, borderRadius: 20, background: '#EEF4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, color: '#0B63C2', flexShrink: 0 }}>
                      {l.full_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: 0 }}>{l.full_name}</p>
                        <span style={{ fontSize: 11, background: '#F3F4F6', color: '#6B7280', borderRadius: 10, padding: '2px 8px' }}>{l.source}</span>
                      </div>
                      <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0 0' }}>
                        {l.phone || '—'}
                        {l.notes && <span style={{ color: '#D1D5DB' }}> · </span>}
                        {l.notes && <span style={{ fontStyle: 'italic' }}>{l.notes}</span>}
                      </p>
                    </div>
                    {/* Date */}
                    <span style={{ fontSize: 12, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                      {new Date(l.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                    </span>
                    {/* Status */}
                    <select value={l.status} onChange={e => changeStatus(l.id, e.target.value)}
                      style={{ background: sm.bg, color: sm.color, border: 'none', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                      {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    {/* Edit */}
                    <button onClick={() => openEdit(l)}
                      style={{ background: 'none', border: '1px solid #E8EDF5', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: '#6B7280', fontSize: 12 }}>
                      Изменить
                    </button>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {/* Create/Edit modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginBottom: 24, marginTop: 0 }}>
              {editLead ? 'Редактировать лид' : 'Новый лид'}
            </h2>
            <form onSubmit={saveLead}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Имя</label>
                <input style={inputStyle} required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Иванова Айгерим" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Телефон</label>
                <input style={inputStyle} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7 708 000 00 00" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Источник</label>
                  <select style={inputStyle} value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Статус</label>
                  <select style={inputStyle} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Ответственный</label>
                <input style={inputStyle} value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} placeholder="Имя администратора" />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Заметки</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 }} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Интересует, пожелания, откуда узнал..." />
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
