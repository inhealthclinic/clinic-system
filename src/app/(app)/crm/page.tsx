'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

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
  { key: 'new',       label: 'Новый',     color: '#6B7280', bg: '#F3F4F6' },
  { key: 'contacted', label: 'Связались', color: '#0B63C2', bg: '#EEF4FF' },
  { key: 'scheduled', label: 'Записан',   color: '#7C3AED', bg: '#F5F3FF' },
  { key: 'converted', label: 'Пришёл',    color: '#059669', bg: '#ECFDF5' },
  { key: 'lost',      label: 'Потерян',   color: '#DC2626', bg: '#FEF2F2' },
]
const SOURCES = ['Instagram', 'WhatsApp', 'Телефон', 'Лично', 'Сайт', 'Рекомендация']

function sm(key: string) { return STATUSES.find(s => s.key === key) || STATUSES[0] }

const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none', boxSizing: 'border-box', background: '#fff' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5 }

export default function CrmPage() {
  const router = useRouter()
  const toast = useToast()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list' | 'kanban'>('kanban')
  const [filterSource, setFilterSource] = useState('all')
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  const emptyForm = { full_name: '', phone: '', source: 'Instagram', status: 'new', notes: '', assigned_to: '' }
  const [form, setForm] = useState(emptyForm)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (!data.user) router.push('/login') })
    loadLeads()
  }, [])

  async function loadLeads() {
    setLoading(true)
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    setLeads(data || [])
    setLoading(false)
  }

  function openCreate() { setEditLead(null); setForm(emptyForm); setShowForm(true) }
  function openEdit(l: Lead) {
    setEditLead(l)
    setForm({ full_name: l.full_name, phone: l.phone || '', source: l.source || 'Instagram', status: l.status, notes: l.notes || '', assigned_to: l.assigned_to || '' })
    setShowForm(true)
  }

  async function saveLead(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    if (editLead) {
      await supabase.from('leads').update(form).eq('id', editLead.id)
    } else {
      await supabase.from('leads').insert([form])
    }
    setSaving(false); setShowForm(false)
    toast.show(editLead ? 'Лид обновлён' : 'Лид добавлен')
    loadLeads()
  }

  async function changeStatus(id: string, status: string) {
    await supabase.from('leads').update({ status }).eq('id', id)
    setLeads(prev => prev.map(l => l.id === id ? { ...l, status } : l))
  }

  // Drag-and-drop for kanban
  function onDragStart(id: string) { setDragging(id) }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }
  async function onDrop(e: React.DragEvent, status: string) {
    e.preventDefault()
    if (!dragging) return
    await changeStatus(dragging, status)
    toast.show(`Статус обновлён: ${sm(status).label}`, 'info')
    setDragging(null)
  }

  const filtered = leads.filter(l => {
    const msrc = filterSource === 'all' || l.source === filterSource
    const mq = !search || l.full_name?.toLowerCase().includes(search.toLowerCase()) || l.phone?.includes(search)
    return msrc && mq
  })

  return (
    <div style={{ padding: '24px', maxWidth: view === 'kanban' ? 1100 : 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#141414', margin: '0 0 2px' }}>CRM</h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>
            {leads.length} лидов · {leads.filter(l => l.status === 'converted').length} конвертировано
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 3, gap: 2 }}>
            {(['kanban', 'list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{ padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 13, cursor: 'pointer', fontWeight: 500,
                  background: view === v ? '#fff' : 'transparent',
                  color: view === v ? '#141414' : '#6B7280',
                  boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                {v === 'kanban' ? '⊞ Канбан' : '☰ Список'}
              </button>
            ))}
          </div>
          <button onClick={openCreate}
            style={{ background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            + Новый лид
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '6px 12px' }}>
          <option value="all">Все источники</option>
          {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
      </div>

      {loading ? <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p> : (
        <>
          {/* ===== KANBAN VIEW ===== */}
          {view === 'kanban' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, alignItems: 'start' }}>
              {STATUSES.map(status => {
                const colLeads = filtered.filter(l => l.status === status.key)
                return (
                  <div key={status.key}
                    onDragOver={onDragOver}
                    onDrop={e => onDrop(e, status.key)}
                    style={{ background: '#F9FAFB', borderRadius: 12, padding: '10px 8px', minHeight: 120, border: `2px dashed transparent`, transition: 'border-color 0.15s' }}
                    onDragEnter={e => (e.currentTarget.style.borderColor = status.color)}
                    onDragLeave={e => (e.currentTarget.style.borderColor = 'transparent')}>
                    {/* Column header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 4px' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: status.color }}>{status.label}</span>
                      <span style={{ fontSize: 12, background: status.bg, color: status.color, borderRadius: 10, padding: '1px 7px', fontWeight: 600 }}>{colLeads.length}</span>
                    </div>
                    {/* Cards */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {colLeads.map(l => (
                        <div key={l.id}
                          draggable
                          onDragStart={() => onDragStart(l.id)}
                          onClick={() => openEdit(l)}
                          style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 10, padding: '10px 12px', cursor: 'grab', transition: 'box-shadow 0.15s' }}
                          onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)')}
                          onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#141414', margin: '0 0 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.full_name}</p>
                          <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px' }}>{l.phone || '—'}</p>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: 11, background: '#F3F4F6', color: '#6B7280', borderRadius: 8, padding: '2px 6px' }}>{l.source}</span>
                            <span style={{ fontSize: 11, color: '#9CA3AF' }}>{new Date(l.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span>
                          </div>
                          {l.notes && <p style={{ fontSize: 11, color: '#9CA3AF', margin: '6px 0 0', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.notes}</p>}
                        </div>
                      ))}
                      {colLeads.length === 0 && (
                        <p style={{ fontSize: 12, color: '#C4C9D4', textAlign: 'center', padding: '16px 0', margin: 0 }}>Перетащите сюда</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ===== LIST VIEW ===== */}
          {view === 'list' && (
            <>
              {/* Funnel summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
                {STATUSES.map(s => (
                  <div key={s.key} style={{ background: '#fff', border: `1px solid ${filterSource === s.key ? s.color : '#E8EDF5'}`, borderRadius: 10, padding: '12px 14px' }}>
                    <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 4px', fontWeight: 500 }}>{s.label}</p>
                    <p style={{ fontSize: 22, fontWeight: 700, color: s.color, margin: 0 }}>{leads.filter(l => l.status === s.key).length}</p>
                  </div>
                ))}
              </div>

              {filtered.length === 0 ? (
                <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
                  <p style={{ fontSize: 15, color: '#141414', fontWeight: 500, margin: '0 0 16px' }}>Лидов нет</p>
                  <button onClick={openCreate} style={{ background: '#EEF4FF', color: '#0B63C2', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>+ Добавить лид</button>
                </div>
              ) : (
                <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, overflow: 'hidden' }}>
                  {filtered.map((l, i) => {
                    const s = sm(l.status)
                    return (
                      <div key={l.id} style={{ padding: '13px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 20, background: '#EEF4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, color: '#0B63C2', flexShrink: 0 }}>
                          {l.full_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: 0 }}>{l.full_name}</p>
                            <span style={{ fontSize: 11, background: '#F3F4F6', color: '#6B7280', borderRadius: 10, padding: '2px 8px' }}>{l.source}</span>
                          </div>
                          <p style={{ fontSize: 13, color: '#6B7280', margin: '2px 0 0' }}>
                            {l.phone || '—'}
                            {l.notes && <><span style={{ color: '#D1D5DB' }}> · </span><span style={{ fontStyle: 'italic' }}>{l.notes}</span></>}
                          </p>
                        </div>
                        <span style={{ fontSize: 12, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                          {new Date(l.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                        </span>
                        <select value={l.status} onChange={e => changeStatus(l.id, e.target.value)}
                          style={{ background: s.bg, color: s.color, border: 'none', borderRadius: 20, padding: '4px 10px', fontSize: 12, fontWeight: 500, cursor: 'pointer', outline: 'none', appearance: 'none' }}>
                          {STATUSES.map(st => <option key={st.key} value={st.key}>{st.label}</option>)}
                        </select>
                        <button onClick={() => openEdit(l)}
                          style={{ background: 'none', border: '1px solid #E8EDF5', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', color: '#6B7280', fontSize: 12 }}>
                          Изменить
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Modal */}
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
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 60 } as React.CSSProperties}
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Интересует, пожелания..." />
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
