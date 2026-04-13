'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info'
type Toast = { id: number; message: string; type: ToastType }

const ToastContext = createContext<{ show: (message: string, type?: ToastType) => void }>({
  show: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  let nextId = 0

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }, [])

  const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: { bg: '#ECFDF5', border: '#6EE7B7', icon: '✓' },
    error:   { bg: '#FEF2F2', border: '#FCA5A5', icon: '✕' },
    info:    { bg: '#EEF4FF', border: '#93C5FD', icon: 'i' },
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 999, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => {
          const c = COLORS[t.type]
          return (
            <div key={t.id} style={{
              background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
              padding: '12px 16px', fontSize: 14, color: '#141414', fontFamily: "'Inter', sans-serif",
              display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              animation: 'fadeIn 0.2s ease',
            }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{c.icon}</span>
              {t.message}
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
