'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

interface Session {
  id: string
  opened_at: string
  opening_cash: number
  status: 'open' | 'closed'
}

interface Props {
  onSessionChange?: (session: Session | null) => void
}

export function CashSessionBar({ onSessionChange }: Props) {
  const supabase = createClient()
  const { can, user } = usePermissions()
  const [session, setSession] = useState<Session | null>(null)
  const [showOpen, setShowOpen] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [openingCash, setOpeningCash] = useState('0')
  const [closingCash, setClosingCash] = useState('')
  const [todayRevenue, setTodayRevenue] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadSession()
  }, [])

  const loadSession = async () => {
    const { data } = await supabase
      .from('cash_sessions')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(1)
      .single()

    setSession(data || null)
    onSessionChange?.(data || null)

    if (data) {
      // Выручка за смену
      const { data: payments } = await supabase
        .from('payments')
        .select('amount')
        .eq('session_id', data.id)
        .eq('type', 'payment')
        .eq('status', 'completed')

      setTodayRevenue(payments?.reduce((s, p) => s + p.amount, 0) || 0)
    }
  }

  const openSession = async () => {
    if (!can('finance:cash_session')) return
    setLoading(true)
    const { data } = await supabase.from('cash_sessions').insert({
      clinic_id: user?.clinic_id,
      opened_by: user?.id,
      opening_cash: parseFloat(openingCash) || 0,
      status: 'open',
    }).select('*').single()

    setSession(data)
    onSessionChange?.(data)
    setShowOpen(false)
    setLoading(false)
  }

  const closeSession = async () => {
    if (!session) return
    setLoading(true)
    const cash = parseFloat(closingCash) || 0
    const expected = (session.opening_cash || 0) + todayRevenue
    await supabase.from('cash_sessions').update({
      status: 'closed',
      closed_by: user?.id,
      closing_cash: cash,
      expected_cash: expected,
      difference: cash - expected,
      closed_at: new Date().toISOString(),
    }).eq('id', session.id)

    setSession(null)
    onSessionChange?.(null)
    setShowClose(false)
    setLoading(false)
  }

  if (!can('finance:cash_session')) return null

  return (
    <>
      <div className={`flex items-center gap-3 px-4 py-2 rounded-xl text-sm ${
        session ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
      }`}>
        <div className={`w-2 h-2 rounded-full ${session ? 'bg-green-500' : 'bg-red-400'}`} />
        {session ? (
          <>
            <span className="text-green-700 font-medium">Касса открыта</span>
            <span className="text-green-600 text-xs">
              с {new Date(session.opened_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-green-600 font-semibold ml-2">{todayRevenue.toLocaleString()} ₸</span>
            <button onClick={() => setShowClose(true)}
              className="ml-auto text-xs text-green-600 hover:text-green-800 border border-green-300 px-2.5 py-1 rounded-lg">
              Закрыть
            </button>
          </>
        ) : (
          <>
            <span className="text-red-600 font-medium">Касса закрыта</span>
            <button onClick={() => setShowOpen(true)}
              className="ml-auto text-xs text-green-600 hover:text-green-800 bg-green-100 border border-green-300 px-2.5 py-1 rounded-lg font-medium">
              Открыть кассу
            </button>
          </>
        )}
      </div>

      {/* Открытие кассы */}
      {showOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-80 p-6">
            <h2 className="text-lg font-semibold mb-4">Открыть кассу</h2>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Начальная сумма в кассе (₸)</label>
              <input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowOpen(false)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
              <button onClick={openSession} disabled={loading}
                className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                Открыть
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Закрытие кассы */}
      {showClose && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-80 p-6">
            <h2 className="text-lg font-semibold mb-4">Закрыть кассу</h2>
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between text-gray-600">
                <span>Начало смены</span>
                <span>{session?.opening_cash?.toLocaleString()} ₸</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Выручка за смену</span>
                <span className="text-green-600 font-medium">+{todayRevenue.toLocaleString()} ₸</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-gray-100 pt-2">
                <span>Ожидается в кассе</span>
                <span>{((session?.opening_cash || 0) + todayRevenue).toLocaleString()} ₸</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Фактически в кассе (₸)</label>
              <input type="number" value={closingCash} onChange={e => setClosingCash(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right" />
              {closingCash && (
                <p className={`text-xs mt-1 ${
                  Math.abs(parseFloat(closingCash) - ((session?.opening_cash || 0) + todayRevenue)) < 1
                    ? 'text-green-600' : 'text-red-500'
                }`}>
                  Расхождение: {(parseFloat(closingCash) - (session?.opening_cash || 0) - todayRevenue).toLocaleString()} ₸
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowClose(false)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
              <button onClick={closeSession} disabled={loading || !closingCash}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                Закрыть смену
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
