'use client'

import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface Payment {
  id: string
  patient_id: string | null
  patient_name: string
  amount: number
  method: string
  status: string
  date: string
  notes: string | null
  created_at: string
}

interface PatientHit {
  id: string
  full_name: string
  phones: string[]
}

const METHOD_RU: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
  deposit: 'Депозит',
}

const STATUS_COLOR: Record<string, string> = {
  paid:     'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-700',
  refunded: 'bg-red-100 text-red-600',
}

/* ─── Payment modal ──────────────────────────────────────── */
function PaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const supabase = createClient()

  const [patientQuery, setPatientQuery] = useState('')
  const [patientHits, setPatientHits]   = useState<PatientHit[]>([])
  const [selectedPatient, setSelectedPatient] = useState<PatientHit | null>(null)

  const [amount, setAmount]   = useState('')
  const [method, setMethod]   = useState('cash')
  const [notes, setNotes]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchPatients = (q: string) => {
    setPatientQuery(q)
    setSelectedPatient(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setPatientHits([]); return }
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, phones')
        .ilike('full_name', `%${q}%`)
        .limit(6)
      setPatientHits(data ?? [])
    }, 300)
  }

  const pickPatient = (p: PatientHit) => {
    setSelectedPatient(p)
    setPatientQuery(p.full_name)
    setPatientHits([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) { setError('Укажите корректную сумму'); return }
    setSaving(true)
    setError('')

    const today = new Date().toISOString().slice(0, 10)
    const { error: err } = await supabase.from('payments').insert({
      patient_id:   selectedPatient?.id ?? null,
      patient_name: (selectedPatient?.full_name ?? patientQuery.trim()) || 'Неизвестно',
      amount:       Number(amount),
      method,
      status:       'paid',
      date:         today,
      notes:        notes.trim() || null,
    })

    if (err) { setError(err.message); setSaving(false); return }
    onSaved()
    onClose()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Принять оплату</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Patient */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Пациент</label>
            <input
              className={inputCls}
              placeholder="Поиск по ФИО…"
              value={patientQuery}
              onChange={e => searchPatients(e.target.value)}
              autoFocus
            />
            {patientHits.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {patientHits.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPatient(p)}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors"
                  >
                    <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                    {p.phones[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Amount + Method */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Сумма (₸) *</label>
              <input
                type="number"
                min="1"
                step="1"
                className={inputCls}
                placeholder="5000"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Метод</label>
              <select className={inputCls} value={method} onChange={e => setMethod(e.target.value)}>
                <option value="cash">Наличные</option>
                <option value="card">Карта</option>
                <option value="transfer">Перевод</option>
                <option value="deposit">Депозит</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Комментарий</label>
            <textarea
              className={inputCls + ' resize-none'}
              rows={2}
              placeholder="За услугу / за приём…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
            >
              {saving ? 'Сохранение...' : '✓ Принять'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────────── */
export default function FinancePage() {
  const supabase = createClient()
  const [payments, setPayments]     = useState<Payment[]>([])
  const [loading, setLoading]       = useState(true)
  const [period, setPeriod]         = useState<'today' | 'week' | 'month'>('today')
  const [showModal, setShowModal]   = useState(false)

  const getRange = () => {
    const now = new Date()
    const end = new Date(now)
    end.setHours(23, 59, 59, 999)
    if (period === 'today') {
      const start = new Date(now); start.setHours(0, 0, 0, 0)
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
    }
    if (period === 'week') {
      const start = new Date(now); start.setDate(now.getDate() - 7)
      return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
    }
    const start = new Date(now); start.setDate(now.getDate() - 30)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
  }

  const load = () => {
    setLoading(true)
    const { start, end } = getRange()
    supabase
      .from('payments')
      .select('*')
      .gte('date', start)
      .lte('date', end)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setPayments(data ?? [])
        setLoading(false)
      })
  }

  useEffect(() => { load() }, [period])

  const paid     = payments.filter(p => p.status === 'paid')
  const totalPaid = paid.reduce((s, p) => s + p.amount, 0)
  const byMethod = paid.reduce<Record<string, number>>((acc, p) => {
    acc[p.method] = (acc[p.method] ?? 0) + p.amount
    return acc
  }, {})

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

  return (
    <div className="max-w-4xl mx-auto">
      {showModal && (
        <PaymentModal
          onClose={() => setShowModal(false)}
          onSaved={load}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex gap-2 flex-1">
          {(['today', 'week', 'month'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={[
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : '30 дней'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
        >
          + Принять оплату
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-400 mb-1">Выручка</p>
          <p className="text-2xl font-bold text-green-600">{fmt(totalPaid)}</p>
          <p className="text-xs text-gray-400 mt-1">{paid.length} оплат</p>
        </div>
        {Object.entries(byMethod).map(([m, sum]) => (
          <div key={m} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{METHOD_RU[m] ?? m}</p>
            <p className="text-lg font-semibold text-gray-900">{fmt(sum)}</p>
          </div>
        ))}
      </div>

      {/* Payments table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Платежи</h3>
          <span className="text-xs text-gray-400">{payments.length} записей</span>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : payments.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Платежей нет</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-50 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Пациент</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Сумма</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Метод</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Дата</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 text-sm text-gray-900">{p.patient_name}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-gray-900">{fmt(p.amount)}</td>
                  <td className="px-5 py-3 text-sm text-gray-500">{METHOD_RU[p.method] ?? p.method}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[p.status] ?? ''}`}>
                      {{ paid: 'Оплачено', pending: 'Ожидает', refunded: 'Возврат' }[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {new Date(p.date + 'T12:00:00').toLocaleDateString('ru-RU', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
