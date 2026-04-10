'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const modules = [
  { key: 'schedule', label: 'Расписание', desc: 'Запись и приёмы', color: '#0B63C2', path: '/schedule' },
  { key: 'patients', label: 'Пациенты', desc: 'Карточки и история', color: '#0B63C2', path: '/patients' },
  { key: 'lis', label: 'Лаборатория', desc: 'Анализы и результаты', color: '#0B63C2', path: '/lis' },
  { key: 'finance', label: 'Финансы', desc: 'Оплаты и касса', color: '#0B63C2', path: '/finance' },
  { key: 'crm', label: 'CRM', desc: 'Лиды и WhatsApp', color: '#0B63C2', path: '/crm' },
  { key: 'analytics', label: 'Аналитика', desc: 'Отчёты и дашборд', color: '#0B63C2', path: '/analytics' },
]

export default function Dashboard() {
  const [user, setUser] = useState<any>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
      else setUser(data.user)
    })
  }, [router])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  if (!user) return null

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F5', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ background: '#fff', borderBottom: '1px solid #E8EDF5', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, background: '#0B63C2', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
              <path d="M24 10C24 10 14 16 14 24C14 32 24 38 24 38C24 38 34 32 34 24C34 16 24 10Z" stroke="white" strokeWidth="1.5" fill="none"/>
              <path d="M14 24C14 24 19 19 24 24C29 29 34 24 34 24" stroke="white" strokeWidth="1.5" fill="none"/>
              <circle cx="24" cy="13" r="1.5" fill="white"/>
            </svg>
          </div>
          <div>
            <span style={{ fontSize: 15, fontWeight: 600, color: '#141414' }}>in health</span>
            <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 6 }}>medical center</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, color: '#6B7280' }}>{user.email}</span>
          <button onClick={handleLogout} style={{ fontSize: 13, color: '#0B63C2', background: 'none', border: '1px solid #0B63C2', borderRadius: 6, padding: '5px 14px', cursor: 'pointer' }}>
            Выйти
          </button>
        </div>
      </div>

      <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: '#141414', marginBottom: 4 }}>Добро пожаловать</h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 32 }}>Выберите раздел для работы</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {modules.map(m => (
            <div
              key={m.key}
              onClick={() => router.push(m.path)}
              style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px', cursor: 'pointer', transition: 'border-color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#0B63C2')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#E8EDF5')}
            >
              <div style={{ width: 40, height: 40, background: '#EEF4FF', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                <div style={{ width: 18, height: 18, background: '#0B63C2', borderRadius: 4 }} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: '#141414', margin: '0 0 4px' }}>{m.label}</p>
              <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>{m.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}