'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface Charge {
  id: string
  name: string
  quantity: number
  unit_price: number
  discount: number
  total: number
  status: string
  procedure_status: string
}

interface VisitFull {
  id: string
  clinic_id: string
  status: 'open' | 'in_progress' | 'completed' | 'partial'
  has_charges: boolean
  finance_settled: boolean
  notes: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  patient: { id: string; full_name: string; phones: string[] }
  doctor:  { id: string; first_name: string; last_name: string }
  charges: Charge[]
}

interface Service { id: string; name: string; price: number | null }

const STATUS_CLR: Record<string, string> = {
  open:        'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed:   'bg-gray-100 text-gray-600',
  partial:     'bg-yellow-100 text-yellow-700',
}
const STATUS_RU: Record<string, string> = {
  open: 'Открыт', in_progress: 'На приёме', completed: 'Завершён', partial: 'Частично',
}
const CHARGE_CLR: Record<string, string> = {
  pending:          'bg-gray-100 text-gray-500',
  pending_approval: 'bg-yellow-100 text-yellow-700',
  paid:             'bg-green-100 text-green-700',
  partial:          'bg-blue-100 text-blue-700',
  cancelled:        'bg-red-50 text-red-400',
}

/* ─── Add charge modal ────────────────────────────────────── */
function AddChargeModal({ visitId, patientId, clinicId, onClose, onSaved }: {
  visitId: string
  patientId: string
  clinicId: string
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [services, setServices] = useState<Service[]>([])
  const [serviceId, setServiceId] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('services').select('id,name,price').eq('is_active', true).order('name').limit(200)
      .then(({ data }) => setServices(data ?? []))
  }, [])

  const pickService = (id: string) => {
    setServiceId(id)
    const svc = services.find(s => s.id === id)
    if (svc) { setName(svc.name); setPrice(String(svc.price ?? '')) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Укажите название'); return }
    const unitPrice = Number(price)
    if (!unitPrice) { setError('Укажите цену'); return }
    setSaving(true); setError('')
    const qty2 = Number(qty) || 1
    const { error: err } = await supabase.from('charges').insert({
      clinic_id:   clinicId,
      visit_id:    visitId,
      patient_id:  patientId,
      service_id:  serviceId || null,
      name:        name.trim(),
      quantity:    qty2,
      unit_price:  unitPrice,
      discount:    0,
      total:       unitPrice * qty2,
      created_by:  profile?.id,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onSaved(); onClose()
  }

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Добавить начисление</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Услуга (выбрать из прайса)</label>
            <select className={inp} value={serviceId} onChange={e => pickService(e.target.value)}>
              <option value="">— ввести вручную —</option>
              {services.map(s => (
                <option key={s.id} value={s.id}>{s.name}{s.price ? ` — ${s.price.toLocaleString('ru-RU')} ₸` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Название *</label>
            <input className={inp} value={name} onChange={e => setName(e.target.value)}
              placeholder="Консультация / услуга" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Цена (₸) *</label>
              <input type="number" min="0" step="1" className={inp} value={price}
                onChange={e => setPrice(e.target.value)} placeholder="5000" required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Кол-во</label>
              <input type="number" min="1" step="1" className={inp} value={qty}
                onChange={e => setQty(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ─── Page ───────────────────────────────────────────────── */
export default function VisitPage() {
  const { id }    = useParams<{ id: string }>()
  const router    = useRouter()
  const supabase  = createClient()

  const [visit, setVisit]       = useState<VisitFull | null>(null)
  const [loading, setLoading]   = useState(true)
  const [advancing, setAdv]     = useState(false)
  const [showCharge, setCharge] = useState(false)

  const load = useCallback(async () => {
    const [v, c] = await Promise.all([
      supabase.from('visits')
        .select('*, patient:patients(id,full_name,phones), doctor:doctors(id,first_name,last_name)')
        .eq('id', id).single(),
      supabase.from('charges')
        .select('id,name,quantity,unit_price,discount,total,status,procedure_status')
        .eq('visit_id', id).order('created_at'),
    ])
    if (!v.data) { router.push('/'); return }
    setVisit({ ...v.data, charges: c.data ?? [] } as VisitFull)
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const advance = async (newStatus: VisitFull['status']) => {
    if (!visit) return
    setAdv(true)
    await supabase.from('visits').update({ status: newStatus }).eq('id', visit.id)
    setAdv(false)
    load()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  )
  if (!visit) return null

  const total = visit.charges.reduce((s, c) => s + c.total, 0)
  const fmt   = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

  return (
    <div className="max-w-2xl mx-auto">
      {showCharge && (
        <AddChargeModal
          visitId={visit.id}
          patientId={visit.patient.id}
          clinicId={visit.clinic_id}
          onClose={() => setCharge(false)}
          onSaved={load}
        />
      )}

      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">← Назад</Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{visit.patient.full_name}</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {visit.doctor.last_name} {visit.doctor.first_name}
            </p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_CLR[visit.status]}`}>
                {STATUS_RU[visit.status]}
              </span>
              {visit.has_charges && (
                <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600">
                  💳 Есть начисления
                </span>
              )}
              {visit.finance_settled && (
                <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-600">
                  ✓ Оплачено
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 flex-shrink-0">
            {visit.status === 'open' && (
              <button onClick={() => advance('in_progress')} disabled={advancing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                {advancing ? '...' : '▶ В работу'}
              </button>
            )}
            {visit.status === 'in_progress' && (
              <>
                <button onClick={() => advance('completed')} disabled={advancing}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                  {advancing ? '...' : '✓ Завершить'}
                </button>
                <button onClick={() => advance('partial')} disabled={advancing}
                  className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors">
                  {advancing ? '...' : '½ Частично'}
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-3">
          Открыт: {new Date(visit.created_at).toLocaleString('ru-RU')}
          {visit.started_at && ` · Начат: ${new Date(visit.started_at).toLocaleString('ru-RU')}`}
          {visit.completed_at && ` · Завершён: ${new Date(visit.completed_at).toLocaleString('ru-RU')}`}
        </p>

        {visit.notes && <p className="text-sm text-gray-500 italic mt-2">{visit.notes}</p>}
      </div>

      {/* Charges */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Начисления</h3>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900">{fmt(total)}</span>
            {visit.status !== 'completed' && (
              <button onClick={() => setCharge(true)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors">
                + Добавить
              </button>
            )}
          </div>
        </div>

        {visit.charges.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">Начислений нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visit.charges.map(c => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">{c.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {fmt(c.unit_price)} × {c.quantity}
                    {c.discount > 0 && ` · скидка ${fmt(c.discount)}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CHARGE_CLR[c.status] ?? ''}`}>
                    {{ pending: 'Ожидает', pending_approval: 'Согласование', paid: 'Оплачено',
                       partial: 'Частично', cancelled: 'Отменено' }[c.status] ?? c.status}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">{fmt(c.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
