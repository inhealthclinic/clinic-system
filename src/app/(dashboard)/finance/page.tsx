'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Payment {
  id: string
  patient_id: string
  amount: number
  method: string
  status: string
  created_at: string
  patient?: { full_name: string } | null
}

const METHOD_RU: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  transfer: 'Перевод',
  deposit: 'Депозит',
}

const STATUS_COLOR: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-red-100 text-red-600',
}

export default function FinancePage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today')

  const getRange = () => {
    const now = new Date()
    const end = now.toISOString()
    if (period === 'today') {
      const start = new Date(now.setHours(0, 0, 0, 0)).toISOString()
      return { start, end }
    }
    if (period === 'week') {
      const start = new Date(now.setDate(now.getDate() - 7)).toISOString()
      return { start, end }
    }
    const start = new Date(now.setDate(now.getDate() - 30)).toISOString()
    return { start, end }
  }

  useEffect(() => {
    setLoading(true)
    const { start, end } = getRange()
    const supabase = createClient()
    supabase
      .from('payments')
      .select('*, patient:patients(full_name)')
      .gte('created_at', start)
      .lte('created_at', end)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setPayments(data ?? [])
        setLoading(false)
      })
  }, [period])

  const totalPaid = payments
    .filter((p) => p.status === 'paid')
    .reduce((s, p) => s + p.amount, 0)

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

  return (
    <div className="max-w-4xl mx-auto">
      {/* Period tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(['today', 'week', 'month'] as const).map((p) => (
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

      {/* Summary */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Выручка</p>
        <p className="text-3xl font-bold text-green-600">{fmt(totalPaid)}</p>
        <p className="text-sm text-gray-400 mt-1">{payments.filter((p) => p.status === 'paid').length} оплат</p>
      </div>

      {/* Payments table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">Платежи</h3>
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
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 text-sm text-gray-900">
                    {p.patient?.full_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-gray-900">
                    {fmt(p.amount)}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">
                    {METHOD_RU[p.method] ?? p.method}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[p.status] ?? ''}`}>
                      {{paid: 'Оплачено', pending: 'Ожидает', refunded: 'Возврат'}[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {new Date(p.created_at).toLocaleDateString('ru-RU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
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
