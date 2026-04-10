'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Неверный email или пароль')
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 400, border: '1px solid #E8EDF5' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: 16 }}>
            <rect width="48" height="48" rx="12" fill="#0B63C2"/>
            <path d="M24 10C24 10 14 16 14 24C14 32 24 38 24 38C24 38 34 32 34 24C34 16 24 10Z" stroke="white" strokeWidth="1.5" fill="none"/>
            <path d="M14 24C14 24 19 19 24 24C29 29 34 24 34 24" stroke="white" strokeWidth="1.5" fill="none"/>
            <circle cx="24" cy="13" r="1.5" fill="white"/>
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: '#141414', margin: '0 0 4px' }}>in health</h1>
          <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>medical center</p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="doctor@inhealth.kz"
              required
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{ width: '100%', padding: '10px 14px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 14, color: '#141414', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {error && <p style={{ fontSize: 13, color: '#DC2626', marginBottom: 16 }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', background: '#0B63C2', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 0', fontSize: 15, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Входим...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}