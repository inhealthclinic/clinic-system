'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Patient = {
  id: string
  full_name: string
  phone: string
  birth_date: string
  gender: string
  source: string
  created_at: string
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', phone: '', birth_date: '', gender: 'female', source: 'Instagram' })
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadPatients()
  }, [])

  async function loadPatients() {
    setLoading(true)
    const { data } = await supabase.from('patients').select('*').order('created_at', { ascending: false })
    setPatients(data || [])
    setLoading(false)
  }

  async function savePatient(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('patients').insert([form])
    setSaving(false)
    setShowForm(false)
    setForm({ full_name: '', phone: '', birth_date: '', gender: 'female', source: 'Instagram' })
    loadPatients()
  }

  const filtered = patients.filter(p =>
    p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.phone?.includes(search)
  )

  const inputStyle = { width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none', boxSizing: 'border-box' as const }
  const labelStyle = { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 5 } as const

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F5', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #E8EDF5', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 13, padding: 0 }}>← Назад</button>
          <span style={{ color: '#D1D5DB' }}>|</span>
          <div style={{ width: 28, height: 28, background: '#0B63C2', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 48 48" fill="none"><path d="M24 10C24 10 14 16 14 24C14 32 24 38 24 38C24 38 34 32 34 24C34 16 24 10Z" stroke="white" strokeWidth="1.5" fill="none"/><path d="M14 24C14 24 19 19 24 24C29 29 34 24 34 24" stroke="white" strokeWidth="1.5" fill="none"/><circle cx="24" cy="13" r="1.5" fill="white"/></svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#141414' }}>Пациенты</span>
        </div>
        <button onClick={() => setShowForm(true)} style={{ background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          + Новый пациент
        </button>
      </div>

      <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
        <input
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, marginBottom: 20, background: '#fff' }}
        />
        {loading ? (
          <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#6B7280' }}>
            <p style={{ fontSize: 15, marginBottom: 8 }}>Пациентов пока нет</p>
            <p style={{ fontSize: 13 }}>Нажмите «+ Новый пациент» чтобы добавить</p>
          </div>
        ) : (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8EDF5', overflow: 'hidden' }}>
            {filtered.map((p, i) => (
              <div key={p.id} style={{ padding: '14px 20px', borderBottom: i < filtered.length - 1 ? '1px solid #F3F4F6' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 20, background: '#EEF4FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, color: '#0B63C2' }}>
                    {p.full_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: '#141414', margin: 0 }}>{p.full_name}</p>
                    <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>{p.phone || '—'} · {p.source || '—'}</p>
                  </div>
                </div>
                <span style={{ fontSize: 12, color: '#6B7280' }}>{p.birth_date || '—'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px', width: '100%', maxWidth: 460 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#141414', marginBottom: 24 }}>Новый пациент</h2>
            <form onSubmit={savePatient}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>ФИО</label>
                <input style={inputStyle} required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Иванова Айгерим Сериковна" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Телефон</label>
                <input style={inputStyle} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+7 708 000 00 00" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Дата рождения</label>
                <input type="date" style={inputStyle} value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={labelStyle}>Пол</label>
                  <select style={inputStyle} value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
                    <option value="female">Женский</option>
                    <option value="male">Мужской</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Источник</label>
                  <select style={inputStyle} value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
                    <option>Instagram</option>
                    <option>WhatsApp</option>
                    <option>Телефон</option>
                    <option>Лично</option>
                    <option>Повторный</option>
                  </select>
                </div>
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