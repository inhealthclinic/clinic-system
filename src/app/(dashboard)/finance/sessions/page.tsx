'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── Types ──────────────────────────────────────────────────────────────── */
interface CashSession {
  id: string
  clinic_id: string
  opened_by: string
  closed_by: string | null
  opening_cash: number
  closing_cash: number | null
  expected_cash: number | null
  difference: number | null
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  notes: string | null
  opener?: { first_name: string; last_name: string } | null
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

function formatDt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/* ─── Modal: Open session ────────────────────────────────────────────────── */
function OpenSessionModal({
  onClose,
  onOpened,
  profileId,
  clinicId,
}: {
  onClose: () => void
  onOpened: () => void
  profileId: string
  clinicId: string
}) {
  const supabase = createClient()
  const [cash, setCash]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    const { error: err } = await supabase.from('cash_sessions').insert({
      clinic_id:    clinicId,
      opened_by:    profileId,
      opening_cash: Number(cash) || 0,
      status:       'open',
    })
    if (err) { setError(err.message); setSaving(false); return }
    onOpened(); onClose()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Открыть смену</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleOpen} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Наличные в кассе (₸)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              className={inp}
              placeholder="0"
              value={cash}
              onChange={e => setCash(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">Сумма, которая уже есть в кассе на начало смены</p>
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Открытие...' : 'Открыть смену'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Modal: Close session ───────────────────────────────────────────────── */
function CloseSessionModal({
  session,
  cashTotal,
  onClose,
  onClosed,
  profileId,
}: {
  session: CashSession
  cashTotal: number
  onClose: () => void
  onClosed: () => void
  profileId: string
}) {
  const supabase = createClient()
  const expected = session.opening_cash + cashTotal
  const [closingCash, setClosingCash] = useState(String(expected))
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const diff = Number(closingCash) - expected

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError('')
    const { error: err } = await supabase
      .from('cash_sessions')
      .update({
        status:        'closed',
        closed_by:     profileId,
        closing_cash:  Number(closingCash),
        expected_cash: expected,
        difference:    Number(closingCash) - expected,
        closed_at:     new Date().toISOString(),
      })
      .eq('id', session.id)
    if (err) { setError(err.message); setSaving(false); return }
    onClosed(); onClose()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Закрыть смену</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleClose} className="p-6 space-y-4">
          {/* Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Остаток на начало</span>
              <span className="font-medium">{fmt(session.opening_cash)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Наличные оплаты</span>
              <span className="font-medium text-green-600">+ {fmt(cashTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-2">
              <span className="text-gray-700 font-medium">Ожидаемая сумма</span>
              <span className="font-bold">{fmt(expected)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Фактическая сумма в кассе (₸) *
            </label>
            <input
              type="number"
              min="0"
              step="1"
              className={inp}
              value={closingCash}
              onChange={e => setClosingCash(e.target.value)}
              required
              autoFocus
            />
          </div>

          {/* Difference */}
          {closingCash !== '' && (
            <div className={`flex justify-between rounded-lg px-4 py-3 text-sm font-medium ${
              diff === 0
                ? 'bg-green-50 text-green-700'
                : diff > 0
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-red-50 text-red-700'
            }`}>
              <span>Расхождение</span>
              <span>{diff > 0 ? '+' : ''}{fmt(diff)}</span>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Закрытие...' : 'Закрыть смену'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function CashSessionsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()

  const [sessions, setSessions]         = useState<CashSession[]>([])
  const [currentSession, setCurrentSession] = useState<CashSession | null>(null)
  const [cashTotal, setCashTotal]       = useState(0)
  const [loading, setLoading]           = useState(true)
  const [showOpen, setShowOpen]         = useState(false)
  const [showClose, setShowClose]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)

    // Load all sessions with opener profile
    const { data } = await supabase
      .from('cash_sessions')
      .select('*, opener:user_profiles!opened_by(first_name, last_name)')
      .order('opened_at', { ascending: false })
      .limit(50)

    const all = (data ?? []) as CashSession[]
    setSessions(all)

    const open = all.find(s => s.status === 'open') ?? null
    setCurrentSession(open)

    // Running cash total for open session
    if (open) {
      const { data: pmts } = await supabase
        .from('payments')
        .select('amount')
        .eq('session_id', open.id)
        .eq('method', 'cash')
        .eq('status', 'completed')
      const total = (pmts ?? []).reduce((s: number, p: { amount: number }) => s + (p.amount ?? 0), 0)
      setCashTotal(total)
    } else {
      setCashTotal(0)
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const profileId = profile?.id ?? ''
  const clinicId  = profile?.clinic_id ?? ''

  const history = sessions.filter(s => s.status === 'closed')

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Modals */}
      {showOpen && (
        <OpenSessionModal
          profileId={profileId}
          clinicId={clinicId}
          onClose={() => setShowOpen(false)}
          onOpened={load}
        />
      )}
      {showClose && currentSession && (
        <CloseSessionModal
          session={currentSession}
          cashTotal={cashTotal}
          profileId={profileId}
          onClose={() => setShowClose(false)}
          onClosed={load}
        />
      )}

      {/* Current session banner */}
      {loading ? (
        <div className="h-40 animate-pulse bg-gray-100 rounded-xl" />
      ) : currentSession ? (
        <div className="bg-white rounded-xl border-2 border-green-200 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm font-semibold text-green-700">Смена открыта</span>
              </div>
              <p className="text-xs text-gray-400 mb-4">
                {formatDt(currentSession.opened_at)}
                {currentSession.opener && (
                  <> · {currentSession.opener.first_name} {currentSession.opener.last_name}</>
                )}
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Остаток на начало</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(currentSession.opening_cash)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Наличные оплаты</p>
                  <p className="text-lg font-bold text-green-600">+ {fmt(cashTotal)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">В кассе сейчас</p>
                  <p className="text-lg font-bold text-gray-900">{fmt(currentSession.opening_cash + cashTotal)}</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowClose(true)}
              className="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Закрыть смену
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-12 flex flex-col items-center justify-center text-center">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mb-4">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="text-gray-400">
              <path d="M3 9h18M9 21V9M3 5.5A2.5 2.5 0 015.5 3h13A2.5 2.5 0 0121 5.5V9H3V5.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-gray-900 font-semibold mb-1">Нет открытой смены</p>
          <p className="text-sm text-gray-400 mb-6">Откройте смену, чтобы начать принимать наличные платежи</p>
          <button
            onClick={() => setShowOpen(true)}
            disabled={!clinicId || !profileId}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors"
          >
            Открыть смену
          </button>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">История смен</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {history.map(s => {
              const diff = s.difference ?? 0
              return (
                <div key={s.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900 font-medium">
                      {formatDt(s.opened_at)}
                      {s.closed_at && (
                        <span className="text-gray-400 font-normal"> — {formatDt(s.closed_at)}</span>
                      )}
                    </p>
                    {s.opener && (
                      <p className="text-xs text-gray-400">
                        {s.opener.first_name} {s.opener.last_name}
                      </p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0 space-y-0.5">
                    <p className="text-sm font-semibold text-gray-900">
                      {s.closing_cash !== null ? fmt(s.closing_cash) : '—'}
                    </p>
                    {diff !== 0 && (
                      <p className={`text-xs font-medium ${diff > 0 ? 'text-blue-600' : 'text-red-500'}`}>
                        {diff > 0 ? '+' : ''}{fmt(diff)}
                      </p>
                    )}
                    {diff === 0 && s.closing_cash !== null && (
                      <p className="text-xs text-green-600">Без расхождений</p>
                    )}
                  </div>
                  <span className="flex-shrink-0 text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full">
                    Закрыта
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
