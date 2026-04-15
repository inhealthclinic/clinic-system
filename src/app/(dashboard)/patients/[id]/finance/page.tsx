'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── types ────────────────────────────────────────────────────────────────────

interface PatientSummary {
  id: string
  full_name: string
  balance_amount: number
  debt_amount: number
}

interface Charge {
  id: string
  name: string
  quantity: number
  unit_price: number
  discount: number
  total: number
  status: string
  created_at: string
  visit_id: string | null
}

interface Payment {
  id: string
  amount: number
  method: string
  type: string
  status: string
  paid_at: string
  notes: string | null
}

type Tab = 'charges' | 'payments'

// ─── constants ────────────────────────────────────────────────────────────────

const CHARGE_STATUS: Record<string, { cls: string; label: string }> = {
  pending:          { cls: 'bg-yellow-100 text-yellow-700', label: 'Ожидает' },
  pending_approval: { cls: 'bg-orange-100 text-orange-700', label: 'На согласовании' },
  paid:             { cls: 'bg-green-100 text-green-700',   label: 'Оплачено' },
  partial:          { cls: 'bg-blue-100 text-blue-700',     label: 'Частично' },
  cancelled:        { cls: 'bg-gray-100 text-gray-500',     label: 'Отменено' },
}

const PAYMENT_STATUS: Record<string, { cls: string; label: string }> = {
  completed:            { cls: 'bg-green-100 text-green-700',   label: 'Выполнено' },
  pending_confirmation: { cls: 'bg-yellow-100 text-yellow-700', label: 'Ожидает' },
  failed:               { cls: 'bg-red-100 text-red-600',       label: 'Ошибка' },
}

const METHOD_RU: Record<string, string> = {
  cash:    'Наличные',
  kaspi:   'Kaspi',
  halyk:   'Halyk',
  credit:  'В кредит',
  balance: 'Депозит',
}

const TYPE_RU: Record<string, string> = {
  payment:    'Оплата',
  prepayment: 'Предоплата',
  refund:     'Возврат',
  writeoff:   'Списание',
}

const TYPE_CLR: Record<string, string> = {
  payment:    'text-green-700',
  prepayment: 'text-blue-700',
  refund:     'text-red-600',
  writeoff:   'text-red-600',
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── component ────────────────────────────────────────────────────────────────

export default function PatientFinancePage() {
  const { id: patientId } = useParams<{ id: string }>()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [patient, setPatient]   = useState<PatientSummary | null>(null)
  const [charges, setCharges]   = useState<Charge[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [tab, setTab]           = useState<Tab>('charges')
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  const load = useCallback(async () => {
    if (!patientId) return
    setLoading(true)
    setError('')
    const supabase = createClient()

    const [patRes, chRes, pyRes] = await Promise.all([
      supabase
        .from('patients')
        .select('id, full_name, balance_amount, debt_amount')
        .eq('id', patientId)
        .single(),
      supabase
        .from('charges')
        .select('*')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false }),
      supabase
        .from('payments')
        .select('*')
        .eq('patient_id', patientId)
        .order('paid_at', { ascending: false }),
    ])

    if (patRes.error) { setError(patRes.error.message); setLoading(false); return }
    setPatient(patRes.data)
    setCharges(chRes.data ?? [])
    setPayments(pyRes.data ?? [])
    setLoading(false)
  }, [patientId])

  useEffect(() => { load() }, [load])

  // ─── derived totals ──────────────────────────────────────────────────────────
  const totalPaid = payments
    .filter(p => p.status === 'completed' && p.type === 'payment')
    .reduce((s, p) => s + p.amount, 0)

  const totalPrepay = payments
    .filter(p => p.type === 'prepayment')
    .reduce((s, p) => s + p.amount, 0)

  // ─── render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        Загрузка…
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600 text-sm">{error}</p>
        <button
          onClick={load}
          className="mt-3 text-sm text-blue-600 hover:underline"
        >
          Повторить
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link href="/patients" className="hover:text-gray-700 transition-colors">
          Пациенты
        </Link>
        <span>/</span>
        <Link href={`/patients/${patientId}`} className="hover:text-gray-700 transition-colors">
          {patient?.full_name ?? '…'}
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Финансы</span>
      </nav>

      {/* Page title */}
      <h1 className="text-xl font-semibold text-gray-900">
        Финансовая история
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Баланс"
          value={fmt(patient?.balance_amount ?? 0)}
          suffix="₸"
          colorClass={
            (patient?.balance_amount ?? 0) >= 0
              ? 'text-green-700'
              : 'text-red-600'
          }
        />
        <SummaryCard
          label="Долг"
          value={fmt(patient?.debt_amount ?? 0)}
          suffix="₸"
          colorClass={
            (patient?.debt_amount ?? 0) > 0
              ? 'text-red-600'
              : 'text-gray-900'
          }
        />
        <SummaryCard
          label="Всего оплачено"
          value={fmt(totalPaid)}
          suffix="₸"
          colorClass="text-gray-900"
        />
        <SummaryCard
          label="Предоплата"
          value={fmt(totalPrepay)}
          suffix="₸"
          colorClass="text-blue-700"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0" aria-label="Tabs">
          {(['charges', 'payments'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              {t === 'charges' ? 'Начисления' : 'Платежи'}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {tab === 'charges' && (
        <ChargesTable charges={charges} />
      )}
      {tab === 'payments' && (
        <PaymentsTable payments={payments} />
      )}
    </div>
  )
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  suffix,
  colorClass,
}: {
  label: string
  value: string
  suffix: string
  colorClass: string
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-semibold ${colorClass}`}>
        {value}
        <span className="text-base font-normal text-gray-400 ml-1">{suffix}</span>
      </p>
    </div>
  )
}

function ChargesTable({ charges }: { charges: Charge[] }) {
  if (charges.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
        Начислений нет
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Дата
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Услуга
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Кол-во
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Цена
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Скидка
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Итого
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Статус
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {charges.map(c => {
              const st = CHARGE_STATUS[c.status] ?? { cls: 'bg-gray-100 text-gray-500', label: c.status }
              return (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(c.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-900 max-w-[200px] truncate" title={c.name}>
                    {c.name}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {c.quantity}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums whitespace-nowrap">
                    {fmt(c.unit_price)} ₸
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {c.discount > 0
                      ? <span className="text-orange-600">{fmt(c.discount)} ₸</span>
                      : <span className="text-gray-400">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
                    {fmt(c.total)} ₸
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PaymentsTable({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
        Платежей нет
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Дата
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Сумма
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Метод
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Тип
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Статус
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Заметка
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {payments.map(p => {
              const st = PAYMENT_STATUS[p.status] ?? { cls: 'bg-gray-100 text-gray-500', label: p.status }
              const typeClr = TYPE_CLR[p.type] ?? 'text-gray-700'
              return (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {fmtDate(p.paid_at)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums whitespace-nowrap">
                    {fmt(p.amount)} ₸
                  </td>
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                    {METHOD_RU[p.method] ?? p.method}
                  </td>
                  <td className={`px-4 py-3 whitespace-nowrap font-medium ${typeClr}`}>
                    {TYPE_RU[p.type] ?? p.type}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate" title={p.notes ?? ''}>
                    {p.notes || <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
