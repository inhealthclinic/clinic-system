'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Visit } from '@/types'

interface VisitFull extends Visit {
  patient: { id: string; full_name: string; phones: string[] }
  doctor: { id: string; first_name: string; last_name: string }
  charges?: Array<{ id: string; name: string; quantity: number; price: number; status: string }>
}

export default function VisitPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [visit, setVisit] = useState<VisitFull | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    Promise.all([
      supabase
        .from('visits')
        .select('*, patient:patients(id, full_name, phones), doctor:doctors(id, first_name, last_name)')
        .eq('id', id)
        .single(),
      supabase
        .from('charges')
        .select('id, name, quantity, price, status')
        .eq('visit_id', id),
    ]).then(([v, c]) => {
      if (!v.data) { router.push('/'); return }
      setVisit({ ...v.data, charges: c.data ?? [] })
      setLoading(false)
    })
  }, [id, router])

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  }
  if (!visit) return null

  const total = (visit.charges ?? []).reduce((s, c) => s + c.price * c.quantity, 0)
  const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

  return (
    <div className="max-w-2xl mx-auto">
      <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">← Назад</Link>

      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{visit.patient?.full_name}</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {visit.doctor?.last_name} {visit.doctor?.first_name}
            </p>
          </div>
          <span className={[
            'text-xs font-medium px-2.5 py-1 rounded-full',
            { open: 'bg-green-100 text-green-700', in_progress: 'bg-blue-100 text-blue-700', closed: 'bg-gray-100 text-gray-600', cancelled: 'bg-red-100 text-red-600' }[visit.status] ?? '',
          ].join(' ')}>
            {{ open: 'Открыт', in_progress: 'На приёме', closed: 'Закрыт', cancelled: 'Отменён' }[visit.status]}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Открыт: {new Date(visit.opened_at).toLocaleString('ru-RU')}
          {visit.closed_at && ` · Закрыт: ${new Date(visit.closed_at).toLocaleString('ru-RU')}`}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Начисления</h3>
          <span className="text-sm font-semibold text-gray-900">{fmt(total)}</span>
        </div>
        {(visit.charges ?? []).length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-400">Начислений нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visit.charges!.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-gray-900">{c.name}</p>
                  <p className="text-xs text-gray-400">× {c.quantity}</p>
                </div>
                <span className="text-sm font-medium text-gray-900">{fmt(c.price * c.quantity)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
