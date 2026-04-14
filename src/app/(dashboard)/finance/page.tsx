'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import { CashSessionBar } from '@/components/finance/CashSessionBar'
import { PaymentModal } from '@/components/finance/PaymentModal'

type FinanceTab = 'today' | 'debtors' | 'discounts'

interface Payment {
  id: string
  amount: number
  method: string
  type: string
  status: string
  paid_at: string
  patient: { full_name: string }
  charge?: { name: string }
}

interface Debtor {
  patient_id: string
  full_name: string
  phone: string
  total_debt: number
  oldest_debt_date: string
  days_overdue: number
}

interface DiscountApproval {
  id: string
  name: string
  discount: number
  total: number
  unit_price: number
  patient: { full_name: string }
  created_by_user?: { first_name: string; last_name: string }
}

export default function FinancePage() {
  const supabase = createClient()
  const { can, user } = usePermissions()
  const [tab, setTab] = useState<FinanceTab>('today')
  const [session, setSession] = useState<any>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [pending, setPending] = useState<DiscountApproval[]>([])
  const [debtFilter, setDebtFilter] = useState<7 | 30 | 90>(7)
  const [refundModal, setRefundModal] = useState<Payment | null>(null)
  const [refundReason, setRefundReason] = useState('')

  useEffect(() => {
    if (tab === 'today') loadPayments()
    if (tab === 'debtors') loadDebtors()
    if (tab === 'discounts') loadPendingDiscounts()
  }, [tab, debtFilter])

  const loadPayments = async () => {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('payments')
      .select('*, patient:patients(full_name), charge:charges(name)')
      .gte('paid_at', `${today}T00:00:00`)
      .order('paid_at', { ascending: false })
    setPayments(data || [])
  }

  const loadDebtors = async () => {
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, phones, debt_amount, updated_at')
      .gt('debt_amount', 0)
      .is('deleted_at', null)
      .order('debt_amount', { ascending: false })

    const now = new Date()
    const filtered = (data || [])
      .map(p => ({
        patient_id: p.id,
        full_name: p.full_name,
        phone: p.phones?.[0] || '',
        total_debt: p.debt_amount,
        oldest_debt_date: p.updated_at,
        days_overdue: Math.floor((now.getTime() - new Date(p.updated_at).getTime()) / 86400000),
      }))
      .filter(d => d.days_overdue >= debtFilter)

    setDebtors(filtered)
  }

  const loadPendingDiscounts = async () => {
    const { data } = await supabase
      .from('charges')
      .select('*, patient:patients(full_name)')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })
    setPending(data || [])
  }

  const approveDiscount = async (chargeId: string) => {
    await supabase.from('charges').update({
      status: 'pending',
      discount_approved_by: user?.id,
    }).eq('id', chargeId)
    loadPendingDiscounts()
  }

  const rejectDiscount = async (chargeId: string) => {
    await supabase.from('charges').update({
      status: 'pending',
      discount: 0,
    }).eq('id', chargeId)
    loadPendingDiscounts()
  }

  const processRefund = async () => {
    if (!refundModal || !refundReason) return
    await supabase.from('payments').insert({
      clinic_id: user?.clinic_id,
      patient_id: (refundModal as any).patient_id,
      charge_id: (refundModal as any).charge_id,
      session_id: session?.id,
      amount: refundModal.amount,
      method: refundModal.method,
      type: 'refund',
      refund_reason: refundReason,
      status: refundModal.method === 'cash' ? 'pending_confirmation' : 'completed',
      received_by: user?.id,
    })
    setRefundModal(null)
    setRefundReason('')
    loadPayments()
  }

  const todayTotal = payments.filter(p => p.type === 'payment' && p.status === 'completed')
    .reduce((s, p) => s + p.amount, 0)
  const byCash   = payments.filter(p => p.method === 'cash' && p.type === 'payment').reduce((s, p) => s + p.amount, 0)
  const byKaspi  = payments.filter(p => p.method === 'kaspi' && p.type === 'payment').reduce((s, p) => s + p.amount, 0)

  const methodLabels: Record<string, string> = {
    cash: '💵', kaspi: '📱', halyk: '💳', credit: '📋', balance: '💰'
  }
  const methodNames: Record<string, string> = {
    cash: 'Нал', kaspi: 'Kaspi', halyk: 'Halyk', credit: 'Кредит', balance: 'Депозит'
  }
  const typeNames: Record<string, string> = {
    payment: 'Оплата', prepayment: 'Депозит', refund: 'Возврат', writeoff: 'Списание'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Касса */}
      <CashSessionBar onSessionChange={setSession} />

      {/* Статистика дня */}
      <PermissionGuard permission="finance:view">
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Выручка сегодня', value: `${todayTotal.toLocaleString()} ₸`, color: 'text-green-600' },
            { label: 'Наличные', value: `${byCash.toLocaleString()} ₸`, color: 'text-gray-800' },
            { label: 'Kaspi', value: `${byKaspi.toLocaleString()} ₸`, color: 'text-gray-800' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </PermissionGuard>

      {/* Вкладки */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'today',     label: '📋 Сегодня' },
          { key: 'debtors',   label: '⚠️ Должники' },
          { key: 'discounts', label: `🏷️ Скидки${pending.length > 0 ? ` (${pending.length})` : ''}` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Сегодняшние платежи */}
      {tab === 'today' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-800">Платежи за сегодня</h3>
          </div>
          {payments.length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-sm">Нет платежей</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Пациент</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Услуга</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Метод</th>
                  <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Тип</th>
                  <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Сумма</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payments.map(p => (
                  <tr key={p.id} className={p.type === 'refund' ? 'bg-red-50' : ''}>
                    <td className="px-4 py-3 font-medium text-gray-800">{p.patient?.full_name}</td>
                    <td className="px-4 py-3 text-gray-500">{p.charge?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-gray-600">
                        {methodLabels[p.method]} {methodNames[p.method]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        p.type === 'refund' ? 'bg-red-100 text-red-600'
                        : p.type === 'prepayment' ? 'bg-blue-100 text-blue-600'
                        : 'bg-green-100 text-green-700'
                      }`}>
                        {typeNames[p.type] || p.type}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      p.type === 'refund' ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {p.type === 'refund' ? '−' : ''}{p.amount.toLocaleString()} ₸
                    </td>
                    <td className="px-4 py-3">
                      {p.type === 'payment' && can('finance:refund') && (
                        <button onClick={() => setRefundModal(p)}
                          className="text-xs text-red-400 hover:text-red-600">
                          Возврат
                        </button>
                      )}
                      {p.status === 'pending_confirmation' && (
                        <button onClick={async () => {
                          await supabase.from('payments').update({
                            status: 'completed',
                            cash_refund_confirmed_by: user?.id,
                            cash_refund_confirmed_at: new Date().toISOString(),
                          }).eq('id', p.id)
                          loadPayments()
                        }}
                          className="text-xs text-orange-500 hover:text-orange-700 font-medium">
                          ✓ Подтвердить выдачу
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Должники */}
      {tab === 'debtors' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {([7, 30, 90] as const).map(d => (
              <button key={d} onClick={() => setDebtFilter(d)}
                className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                  debtFilter === d ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600'
                }`}>
                &gt; {d} дней
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {debtors.length === 0 ? (
              <p className="text-center py-8 text-gray-400 text-sm">Должников нет</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Пациент</th>
                    <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Телефон</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Долг</th>
                    <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Просрочка</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {debtors.map(d => (
                    <tr key={d.patient_id} className={d.days_overdue > 30 ? 'bg-red-50/50' : ''}>
                      <td className="px-4 py-3 font-medium text-gray-800">{d.full_name}</td>
                      <td className="px-4 py-3 text-gray-500">{d.phone}</td>
                      <td className="px-4 py-3 text-right font-semibold text-red-600">
                        {d.total_debt.toLocaleString()} ₸
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          d.days_overdue > 30 ? 'bg-red-100 text-red-600'
                          : 'bg-amber-100 text-amber-600'
                        }`}>
                          {d.days_overdue} дн.
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 justify-end">
                          <a href={`tel:${d.phone}`}
                            className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200 px-2 py-1 rounded-lg">
                            📞
                          </a>
                          <a href={`https://wa.me/${d.phone?.replace(/\D/g,'')}`}
                            target="_blank" rel="noreferrer"
                            className="text-xs text-green-500 hover:text-green-700 border border-green-200 px-2 py-1 rounded-lg">
                            💬
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Скидки на одобрение — только owner */}
      {tab === 'discounts' && (
        <PermissionGuard permission="finance:approve_discount" fallback={
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
            Только владелец может одобрять скидки
          </div>
        }>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">Запросы на скидку</h3>
            </div>
            {pending.length === 0 ? (
              <p className="text-center py-8 text-gray-400 text-sm">Нет запросов</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {pending.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-5 py-4">
                    <div>
                      <p className="font-medium text-gray-800">{c.patient?.full_name}</p>
                      <p className="text-sm text-gray-500">{c.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400 line-through">{c.unit_price?.toLocaleString()} ₸</span>
                        <span className="text-xs bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded font-medium">
                          − {c.discount?.toLocaleString()} ₸
                        </span>
                        <span className="text-sm font-semibold">{(c.total - (c.discount || 0)).toLocaleString()} ₸</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => rejectDiscount(c.id)}
                        className="text-xs text-red-500 border border-red-200 px-3 py-1.5 rounded-xl hover:bg-red-50">
                        Отклонить
                      </button>
                      <button onClick={() => approveDiscount(c.id)}
                        className="text-xs text-white bg-green-600 px-3 py-1.5 rounded-xl hover:bg-green-700">
                        Одобрить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PermissionGuard>
      )}

      {/* Возврат */}
      {refundModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-80 p-6">
            <h2 className="text-lg font-semibold mb-3">Возврат</h2>
            <p className="text-sm text-gray-600 mb-1">Пациент: <b>{refundModal.patient?.full_name}</b></p>
            <p className="text-sm text-gray-600 mb-3">Сумма: <b>{refundModal.amount.toLocaleString()} ₸</b></p>
            {refundModal.method === 'cash' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-700">
                ⚠️ Наличный возврат — потребуется подтвердить выдачу средств
              </div>
            )}
            <div className="mb-4">
              <label className="text-xs text-gray-500 mb-1 block">Причина возврата *</label>
              <textarea value={refundReason} onChange={e => setRefundReason(e.target.value)}
                rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRefundModal(null)}
                className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
              <button onClick={processRefund} disabled={!refundReason}
                className="flex-1 bg-red-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
                Оформить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
