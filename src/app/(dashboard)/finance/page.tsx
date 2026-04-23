'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { exportCsv } from '@/lib/export/csv'

interface Payment {
  id: string
  patient_id: string
  amount: number
  method: string
  type: string
  status: string
  paid_at: string
  patient?: { full_name: string } | null
}

interface PatientHit { id: string; full_name: string; phones: string[] }

/* ─── AMO CRM: Print receipt (квитанция) ────────────────── */
function printReceipt(payment: Payment) {
  const w = window.open('', '_blank', 'width=420,height=520')
  if (!w) return
  const dt = new Date(payment.paid_at).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const method = METHOD_RU[payment.method] ?? payment.method
  const type   = TYPE_RU[payment.type]   ?? payment.type
  const status = ({ completed: 'ОПЛАЧЕНО ✓', pending_confirmation: 'ОЖИДАЕТ', failed: 'ОШИБКА ✕' } as Record<string, string>)[payment.status] ?? payment.status
  const amount = payment.amount.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Квитанция</title>
  <style>
    body{font-family:'Courier New',monospace;max-width:320px;margin:20px auto;font-size:13px;color:#111}
    h2{text-align:center;font-size:17px;margin:0 0 4px}
    .sub{text-align:center;font-size:11px;color:#666;border-bottom:1px dashed #ccc;padding-bottom:10px;margin-bottom:12px}
    .row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #eee}
    .lbl{color:#666}
    .total{display:flex;justify-content:space-between;padding:8px 0 4px;font-weight:bold;font-size:15px;border-top:2px solid #111;margin-top:6px}
    .st{text-align:center;margin:12px 0;font-size:14px;font-weight:bold;letter-spacing:1px;padding:6px;border:2px solid #111}
    .foot{text-align:center;font-size:10px;color:#bbb;margin-top:16px;border-top:1px dashed #ccc;padding-top:8px}
  </style></head><body>
  <h2>IN HEALTH</h2>
  <div class="sub">Медицинский центр — Квитанция</div>
  <div class="row"><span class="lbl">Пациент</span><span>${payment.patient?.full_name ?? '—'}</span></div>
  <div class="row"><span class="lbl">Тип</span><span>${type}</span></div>
  <div class="row"><span class="lbl">Метод</span><span>${method}</span></div>
  <div class="row"><span class="lbl">Дата</span><span>${dt}</span></div>
  <div class="total"><span>ИТОГО</span><span>${amount}</span></div>
  <div class="st">${status}</div>
  <div class="foot">IN HEALTH · Документ сформирован автоматически</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

const METHOD_RU: Record<string, string> = {
  cash:    'Наличные',
  kaspi:   'Kaspi',
  halyk:   'Halyk',
  credit:  'Кредит',
  balance: 'Депозит',
}
const TYPE_RU: Record<string, string> = {
  payment:    'Оплата',
  prepayment: 'Предоплата',
  refund:     'Возврат',
  writeoff:   'Списание',
}
const STATUS_CLR: Record<string, string> = {
  completed:            'bg-green-100 text-green-700',
  pending_confirmation: 'bg-yellow-100 text-yellow-700',
  failed:               'bg-red-100 text-red-600',
}

/* ─── Modal ─────────────────────────────────────────────── */
function PaymentModal({ clinicId, onClose, onSaved }: {
  clinicId: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [query, setQuery]     = useState('')
  const [hits, setHits]       = useState<PatientHit[]>([])
  const [patient, setPatient] = useState<PatientHit | null>(null)
  const [amount, setAmount]   = useState('')
  const [method, setMethod]   = useState('cash')
  const [type, setType]       = useState('payment')
  const [notes, setNotes]     = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (q: string) => {
    setQuery(q); setPatient(null)
    if (debRef.current) clearTimeout(debRef.current)
    if (q.length < 2) { setHits([]); return }
    debRef.current = setTimeout(async () => {
      const isPhone = /^[\d\s+\-()]{3,}$/.test(q.trim())
      const filter = isPhone
        ? `full_name.ilike.%${q}%,phones.cs.{"${q.trim()}"}`
        : `full_name.ilike.%${q}%`
      const { data } = await supabase
        .from('patients').select('id,full_name,phones')
        .or(filter).limit(6)
      setHits(data ?? [])
    }, 300)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patient) { setError('Выберите пациента'); return }
    if (!amount || Number(amount) <= 0) { setError('Укажите сумму'); return }
    if (type === 'refund' && !refundReason.trim()) {
      setError('Укажите причину возврата'); return
    }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('payments').insert({
      clinic_id:     clinicId,
      patient_id:    patient.id,
      amount:        Number(amount),
      method, type,
      status:        'completed',
      notes:         notes.trim() || null,
      refund_reason: type === 'refund' ? refundReason.trim() : null,
      received_by:   profile?.id ?? null,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onSaved(); onClose()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Принять оплату</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Patient search */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Пациент *</label>
            <input className={inp} placeholder="Поиск по ФИО…" value={query}
              onChange={e => search(e.target.value)} autoFocus />
            {hits.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {hits.map(p => (
                  <button key={p.id} type="button"
                    onClick={() => { setPatient(p); setQuery(p.full_name); setHits([]) }}
                    className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors">
                    <p className="text-sm font-medium text-gray-900">{p.full_name}</p>
                    {p.phones[0] && <p className="text-xs text-gray-400">{p.phones[0]}</p>}
                  </button>
                ))}
              </div>
            )}
            {patient && (
              <p className="text-xs text-green-600 mt-1">✓ {patient.full_name}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Сумма (₸) *</label>
              <input type="number" min="1" step="1" className={inp} placeholder="5000"
                value={amount} onChange={e => setAmount(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Тип</label>
              <select className={inp} value={type} onChange={e => setType(e.target.value)}>
                <option value="payment">Оплата</option>
                <option value="prepayment">Предоплата</option>
                <option value="refund">Возврат</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Метод оплаты</label>
            <div className="grid grid-cols-3 gap-2">
              {(['cash','kaspi','halyk','credit','balance'] as const).map(m => (
                <button key={m} type="button"
                  onClick={() => setMethod(m)}
                  className={[
                    'py-2 px-3 rounded-lg text-sm font-medium border transition-colors',
                    method === m
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                  ].join(' ')}>
                  {METHOD_RU[m]}
                </button>
              ))}
            </div>
          </div>

          {type === 'refund' && (
            <div>
              <label className="block text-xs font-medium text-red-600 mb-1.5">Причина возврата *</label>
              <input className={inp} value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                placeholder="Напр.: отмена услуги, ошибка при вводе…"
                required />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Комментарий</label>
            <textarea className={inp + ' resize-none'} rows={2}
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="За услугу / номер заказа…" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors">
              {saving ? 'Сохранение...' : '✓ Принять'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────── */
export default function FinancePage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [payments, setPayments]   = useState<Payment[]>([])
  const [loading, setLoading]     = useState(true)
  const [period, setPeriod]       = useState<'today' | 'week' | 'month'>('today')
  const [showModal, setShowModal] = useState(false)

  const getRange = () => {
    const now = new Date()
    if (period === 'today') {
      const s = new Date(now); s.setHours(0, 0, 0, 0)
      const e = new Date(now); e.setHours(23, 59, 59, 999)
      return { start: s.toISOString(), end: e.toISOString() }
    }
    const days = period === 'week' ? 7 : 30
    const s = new Date(now); s.setDate(now.getDate() - days)
    return { start: s.toISOString(), end: now.toISOString() }
  }

  const load = useCallback(() => {
    setLoading(true)
    const { start, end } = getRange()
    supabase
      .from('payments')
      .select('*, patient:patients(full_name)')
      .gte('paid_at', start)
      .lte('paid_at', end)
      .order('paid_at', { ascending: false })
      .limit(200)
      .then(({ data }) => { setPayments(data ?? []); setLoading(false) })
  }, [period])

  useEffect(() => { load() }, [load])

  const completed = payments.filter(p => p.status === 'completed' && p.type !== 'refund')
  const total     = completed.reduce((s, p) => s + p.amount, 0)
  const byMethod  = completed.reduce<Record<string, number>>((acc, p) => {
    acc[p.method] = (acc[p.method] ?? 0) + p.amount; return acc
  }, {})

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 })

  return (
    <div className="max-w-4xl mx-auto">
      {showModal && clinicId && (
        <PaymentModal clinicId={clinicId} onClose={() => setShowModal(false)} onSaved={load} />
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="flex gap-2">
          {(['today', 'week', 'month'] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={['px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                period === p ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
              ].join(' ')}>
              {p === 'today' ? 'Сегодня' : p === 'week' ? '7 дней' : '30 дней'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => exportCsv(`payments-${period}`, payments, [
            { key: 'Пациент', value: p => p.patient?.full_name ?? '' },
            { key: 'Тип',     value: p => TYPE_RU[p.type]   ?? p.type },
            { key: 'Метод',   value: p => METHOD_RU[p.method] ?? p.method },
            { key: 'Сумма, ₸', value: p => p.amount },
            { key: 'Статус',  value: p => p.status },
            { key: 'Дата',    value: p => new Date(p.paid_at).toLocaleString('ru-RU') },
          ])}
          disabled={payments.length === 0}
          className="px-4 py-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 text-sm font-medium rounded-lg transition-colors"
          title="Экспорт платежей за период в CSV">
          ⬇ CSV
        </button>
        <button onClick={() => setShowModal(true)} disabled={!clinicId}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
          + Принять оплату
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-gray-400 mb-1">Выручка</p>
          <p className="text-2xl font-bold text-green-600">{fmt(total)}</p>
          <p className="text-xs text-gray-400 mt-1">{completed.length} оплат</p>
        </div>
        {Object.entries(byMethod).map(([m, sum]) => (
          <div key={m} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-400 mb-1">{METHOD_RU[m] ?? m}</p>
            <p className="text-lg font-semibold text-gray-900">{fmt(sum)}</p>
          </div>
        ))}
      </div>

      {/* Table */}
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
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Тип</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Сумма</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Метод</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Дата</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3">
                    {p.patient_id ? (
                      <Link href={`/patients/${p.patient_id}`}
                        className="text-sm text-gray-900 hover:text-blue-600 hover:underline font-medium">
                        {p.patient?.full_name ?? '—'}
                      </Link>
                    ) : (
                      <span className="text-sm text-gray-900">{p.patient?.full_name ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500">{TYPE_RU[p.type] ?? p.type}</td>
                  <td className={`px-5 py-3 text-sm font-semibold ${p.type === 'refund' ? 'text-red-500' : 'text-gray-900'}`}>
                    {p.type === 'refund' ? '−' : ''}{fmt(p.amount)}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500">{METHOD_RU[p.method] ?? p.method}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_CLR[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {{ completed: 'Оплачено', pending_confirmation: 'Ожидает', failed: 'Ошибка' }[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {new Date(p.paid_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-5 py-3">
                    <button
                      onClick={() => printReceipt(p)}
                      title="Печать квитанции"
                      className="text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                      🖨 Чек
                    </button>
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
