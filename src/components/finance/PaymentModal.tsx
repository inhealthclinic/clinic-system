'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

type Method = 'cash' | 'kaspi' | 'halyk' | 'credit' | 'balance'

interface Charge {
  id: string
  name: string
  unit_price: number
  quantity: number
  discount: number
  total: number
  status: string
}

interface Props {
  patientId: string
  visitId?: string
  patientBalance: number
  charges: Charge[]
  sessionId?: string
  onClose: () => void
  onSuccess: () => void
}

const METHOD_LABELS: Record<Method, string> = {
  cash:    '💵 Наличные',
  kaspi:   '📱 Kaspi',
  halyk:   '💳 Halyk',
  credit:  '📋 В кредит',
  balance: '💰 Депозит',
}

export function PaymentModal({
  patientId, visitId, patientBalance, charges, sessionId, onClose, onSuccess
}: Props) {
  const supabase = createClient()
  const { user } = usePermissions()

  const unpaid = charges.filter(c => c.status !== 'paid' && c.status !== 'cancelled')
  const totalDue = unpaid.reduce((s, c) => s + c.total - c.discount, 0)

  // Смешанная оплата: несколько строк метод+сумма
  const [lines, setLines] = useState<{ method: Method; amount: string }[]>([
    { method: 'cash', amount: String(totalDue) }
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const totalPaying = lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)
  const remaining = totalDue - totalPaying
  const balanceAfter = lines.some(l => l.method === 'balance')
    ? patientBalance - (parseFloat(lines.find(l => l.method === 'balance')?.amount || '0') || 0)
    : patientBalance

  const addLine = () => setLines(l => [...l, { method: 'cash', amount: '' }])
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i))
  const updateLine = (i: number, field: 'method' | 'amount', val: string) =>
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [field]: val } : line))

  const save = async () => {
    setError('')
    if (totalPaying < totalDue - 0.01) {
      // Частичная оплата — разрешена, долг фиксируется
    }
    if (lines.some(l => l.method === 'balance') &&
        (parseFloat(lines.find(l => l.method === 'balance')?.amount || '0') || 0) > patientBalance) {
      setError('Недостаточно средств на депозите')
      return
    }

    setSaving(true)
    try {
      // 1. Обновить статус начислений → paid/partial
      const isPaid = totalPaying >= totalDue - 0.01
      for (const c of unpaid) {
        await supabase.from('charges')
          .update({ status: isPaid ? 'paid' : 'partial' })
          .eq('id', c.id)
      }

      // 2. Создать платежи
      for (const line of lines) {
        const amt = parseFloat(line.amount) || 0
        if (amt <= 0) continue
        await supabase.from('payments').insert({
          clinic_id: user?.clinic_id,
          patient_id: patientId,
          charge_id: unpaid[0]?.id,
          session_id: sessionId,
          amount: amt,
          method: line.method,
          type: 'payment',
          received_by: user?.id,
        })
      }

      onSuccess()
    } catch (e: any) {
      setError(e.message || 'Ошибка')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Принять оплату</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Начисления */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
            {unpaid.map(c => (
              <div key={c.id} className="flex justify-between text-sm">
                <span className="text-gray-700">{c.name}</span>
                <span className="font-medium">{(c.total - c.discount).toLocaleString()} ₸</span>
              </div>
            ))}
            <div className="pt-2 border-t border-gray-200 flex justify-between font-semibold">
              <span>Итого к оплате</span>
              <span>{totalDue.toLocaleString()} ₸</span>
            </div>
          </div>

          {/* Депозит */}
          {patientBalance > 0 && (
            <div className="flex items-center justify-between text-sm bg-green-50 rounded-xl px-3 py-2">
              <span className="text-green-700">Депозит пациента</span>
              <span className="font-semibold text-green-700">{patientBalance.toLocaleString()} ₸</span>
            </div>
          )}

          {/* Строки оплаты */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Способ оплаты</p>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-2">
                <select
                  value={line.method}
                  onChange={e => updateLine(i, 'method', e.target.value)}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                >
                  {(Object.entries(METHOD_LABELS) as [Method, string][]).map(([k, v]) => (
                    <option key={k} value={k}
                      disabled={k === 'balance' && patientBalance <= 0}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  type="number" value={line.amount}
                  onChange={e => updateLine(i, 'amount', e.target.value)}
                  placeholder="Сумма"
                  className="w-32 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right"
                />
                {lines.length > 1 && (
                  <button onClick={() => removeLine(i)}
                    className="text-gray-300 hover:text-red-400 px-1">×</button>
                )}
              </div>
            ))}
            <button onClick={addLine}
              className="text-xs text-blue-600 hover:text-blue-800">
              + Добавить способ оплаты
            </button>
          </div>

          {/* Итог */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Оплачивается</span>
              <span className="font-semibold">{totalPaying.toLocaleString()} ₸</span>
            </div>
            {remaining > 0.01 && (
              <div className="flex justify-between text-orange-600">
                <span>Долг</span>
                <span className="font-semibold">{remaining.toLocaleString()} ₸</span>
              </div>
            )}
            {remaining < -0.01 && (
              <div className="flex justify-between text-blue-600">
                <span>Сдача</span>
                <span className="font-semibold">{Math.abs(remaining).toLocaleString()} ₸</span>
              </div>
            )}
            {lines.some(l => l.method === 'balance') && (
              <div className="flex justify-between text-green-600 border-t border-gray-200 pt-1 mt-1">
                <span>Депозит после оплаты</span>
                <span className="font-semibold">{balanceAfter.toLocaleString()} ₸</span>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="p-5 border-t border-gray-100 flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm text-gray-700 hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={save} disabled={saving || totalPaying <= 0}
            className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {saving ? 'Проведение...' : `Принять ${totalPaying.toLocaleString()} ₸`}
          </button>
        </div>
      </div>
    </div>
  )
}
