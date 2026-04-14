'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props { patientId: string }

interface Summary {
  balance: number
  total_debt: number
  last_payment_at: string | null
  recent: { date: string; amount: number; method: string; service: string }[]
  open_charges: { id: string; service_name: string; amount: number; visit_date: string }[]
}

const methodLabel: Record<string, string> = {
  cash:'💵', kaspi:'📱', halyk:'💳', credit:'📋', balance:'💰'
}

export function PatientPaymentSummary({ patientId }: Props) {
  const [data, setData] = useState<Summary | null>(null)
  const supabase = createClient()

  useEffect(() => {
    Promise.all([
      supabase.from('patient_balance').select('balance').eq('patient_id', patientId).single(),
      supabase.from('patients').select('debt_amount').eq('id', patientId).single(),
      supabase.from('payments').select('paid_at, amount, method, charge:charges(name)')
        .eq('patient_id', patientId).eq('type', 'payment').eq('status', 'completed')
        .order('paid_at', { ascending: false }).limit(5),
      supabase.from('charges').select('id, name, total, discount, visit:visits(created_at)')
        .eq('patient_id', patientId).not('status', 'in', '("paid","cancelled")')
        .order('created_at', { ascending: false }),
    ]).then(([bal, pat, pays, charges]) => {
      setData({
        balance: bal.data?.balance || 0,
        total_debt: pat.data?.debt_amount || 0,
        last_payment_at: pays.data?.[0]?.paid_at || null,
        recent: (pays.data || []).map((p: any) => ({
          date: p.paid_at,
          amount: p.amount,
          method: p.method,
          service: p.charge?.name || '—',
        })),
        open_charges: (charges.data || []).map((c: any) => ({
          id: c.id,
          service_name: c.name,
          amount: c.total - (c.discount || 0),
          visit_date: (c.visit as any)?.created_at || '',
        })),
      })
    })
  }, [patientId])

  if (!data) return null

  return (
    <div className="space-y-3">
      {/* Баланс и долг */}
      <div className="grid grid-cols-2 gap-3">
        <div className={`rounded-xl p-3 ${data.balance > 0 ? 'bg-green-50' : 'bg-gray-50'}`}>
          <p className="text-xs text-gray-500">Депозит</p>
          <p className={`text-lg font-bold ${data.balance > 0 ? 'text-green-600' : 'text-gray-400'}`}>
            {data.balance.toLocaleString()} ₸
          </p>
        </div>
        <div className={`rounded-xl p-3 ${data.total_debt > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
          <p className="text-xs text-gray-500">Долг</p>
          <p className={`text-lg font-bold ${data.total_debt > 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {data.total_debt.toLocaleString()} ₸
          </p>
        </div>
      </div>

      {/* Открытые начисления */}
      {data.open_charges.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Неоплачено</p>
          {data.open_charges.map(c => (
            <div key={c.id} className="flex justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
              <span className="text-gray-700">{c.service_name}</span>
              <span className="font-medium text-red-500">{c.amount.toLocaleString()} ₸</span>
            </div>
          ))}
        </div>
      )}

      {/* История оплат */}
      {data.recent.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1.5">Последние платежи</p>
          {data.recent.map((p, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1.5">
              <div className="flex items-center gap-1.5">
                <span>{methodLabel[p.method]}</span>
                <span className="text-gray-600">{p.service}</span>
              </div>
              <div className="text-right">
                <span className="font-medium text-gray-800">{p.amount.toLocaleString()} ₸</span>
                <p className="text-gray-400">
                  {new Date(p.date).toLocaleDateString('ru', { day:'numeric', month:'short' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
