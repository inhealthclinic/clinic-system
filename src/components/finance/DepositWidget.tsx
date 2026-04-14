'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

interface Props {
  patientId: string
  balance: number
  sessionId?: string
  onSuccess: (newBalance: number) => void
}

export function DepositWidget({ patientId, balance, sessionId, onSuccess }: Props) {
  const supabase = createClient()
  const { user } = usePermissions()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'kaspi' | 'halyk'>('cash')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const topUp = async () => {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return
    setSaving(true)

    await supabase.from('payments').insert({
      clinic_id: user?.clinic_id,
      patient_id: patientId,
      session_id: sessionId,
      amount: amt,
      method,
      type: 'prepayment',
      received_by: user?.id,
      status: 'completed',
    })

    onSuccess(balance + amt)
    setAmount('')
    setOpen(false)
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-xs text-gray-500">Депозит</p>
          <p className={`text-xl font-bold ${balance > 0 ? 'text-green-600' : 'text-gray-400'}`}>
            {balance.toLocaleString()} ₸
          </p>
        </div>
        <button onClick={() => setOpen(o => !o)}
          className="text-sm text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50">
          + Пополнить
        </button>
      </div>

      {open && (
        <div className="space-y-3 pt-3 border-t border-gray-100">
          <div className="flex gap-2">
            {(['cash', 'kaspi', 'halyk'] as const).map(m => (
              <button key={m} onClick={() => setMethod(m)}
                className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                  method === m ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600'
                }`}>
                {m === 'cash' ? '💵 Наличные' : m === 'kaspi' ? '📱 Kaspi' : '💳 Halyk'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="Сумма пополнения"
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-right" />
            <button onClick={topUp} disabled={saving || !amount}
              className="bg-green-600 text-white px-4 rounded-xl text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {saving ? '...' : 'OK'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
