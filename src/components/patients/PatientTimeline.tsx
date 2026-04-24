'use client'

/**
 * PatientTimeline — единая хронология пациента.
 * Объединяет в одну ленту: визиты (медзаписи), назначения, лабораторные результаты,
 * оплаты. Сортировка по дате (новые сверху). Фильтры по типу событий.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

type EvtKind = 'visit' | 'rx' | 'lab' | 'pay'

type TLEvent = {
  id: string
  kind: EvtKind
  at: string
  title: string
  subtitle?: string | null
  tag?: string | null
  tagCls?: string
  href?: string
  amount?: number | null
  flag?: 'normal' | 'low' | 'high' | 'critical' | null
}

const KIND_META: Record<EvtKind, { label: string; color: string; icon: string }> = {
  visit: { label: 'Визит',     color: 'bg-blue-100 text-blue-700',    icon: '🩺' },
  rx:    { label: 'Рецепт',    color: 'bg-purple-100 text-purple-700', icon: '💊' },
  lab:   { label: 'Анализ',    color: 'bg-teal-100 text-teal-700',    icon: '🧪' },
  pay:   { label: 'Оплата',    color: 'bg-green-100 text-green-700',  icon: '₸' },
}

const FLAG_CLR: Record<string, string> = {
  normal: 'text-green-700',
  low: 'text-blue-700',
  high: 'text-orange-700',
  critical: 'text-red-700 font-semibold',
}

export default function PatientTimeline({ patientId }: { patientId: string }) {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<TLEvent[]>([])
  const [filter, setFilter] = useState<Set<EvtKind>>(new Set(['visit', 'rx', 'lab', 'pay']))

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [mr, rx, lab, pay] = await Promise.all([
        supabase.from('medical_records')
          .select(`id, created_at, icd10_code, diagnosis_text, visit_id,
                   doctor:doctors(id, first_name, last_name)`)
          .eq('patient_id', patientId)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('prescriptions')
          .select(`id, issued_at, diagnosis,
                   doctor:doctors(id, first_name, last_name),
                   items:prescription_items(name)`)
          .eq('patient_id', patientId)
          .order('issued_at', { ascending: false })
          .limit(200),
        supabase.from('lab_results')
          .select(`id, result_date, service_name_snapshot, result_value, result_text,
                   unit_snapshot, flag, lab_order_id`)
          .eq('patient_id', patientId)
          .order('result_date', { ascending: false })
          .limit(400),
        supabase.from('payments')
          .select(`id, paid_at, amount, method, type, status`)
          .eq('patient_id', patientId)
          .eq('status', 'completed')
          .order('paid_at', { ascending: false })
          .limit(200),
      ])

      if (cancelled) return

      const out: TLEvent[] = []

      for (const r of (mr.data ?? []) as any[]) {
        const doc = r.doctor as { first_name: string; last_name: string } | null
        out.push({
          id: `mr-${r.id}`,
          kind: 'visit',
          at: r.created_at,
          title: r.diagnosis_text || 'Медицинская запись',
          subtitle: [r.icd10_code, doc ? `${doc.last_name} ${doc.first_name}` : null]
            .filter(Boolean).join(' · ') || null,
          href: r.visit_id ? `/visits/${r.visit_id}` : undefined,
        })
      }

      for (const r of (rx.data ?? []) as any[]) {
        const doc = r.doctor as { first_name: string; last_name: string } | null
        const items = (r.items ?? []) as { name: string }[]
        const drugs = items.map(i => i.name).filter(Boolean).slice(0, 5).join(', ')
        out.push({
          id: `rx-${r.id}`,
          kind: 'rx',
          at: r.issued_at,
          title: drugs || 'Рецепт',
          subtitle: [r.diagnosis, doc ? `${doc.last_name} ${doc.first_name}` : null,
            items.length > 5 ? `+${items.length - 5} ещё` : null]
            .filter(Boolean).join(' · ') || null,
          href: `/patients/${patientId}/prescriptions`,
        })
      }

      for (const r of (lab.data ?? []) as any[]) {
        const val = r.result_value != null
          ? `${r.result_value}${r.unit_snapshot ? ' ' + r.unit_snapshot : ''}`
          : (r.result_text || '—')
        out.push({
          id: `lab-${r.id}`,
          kind: 'lab',
          at: r.result_date,
          title: r.service_name_snapshot || 'Анализ',
          subtitle: val,
          flag: r.flag,
          href: `/patients/${patientId}/lab`,
        })
      }

      for (const r of (pay.data ?? []) as any[]) {
        if (!r.paid_at) continue
        const methodLabel: Record<string, string> = {
          cash: 'Наличные', kaspi: 'Kaspi', halyk: 'Halyk', credit: 'Кредит', balance: 'Депозит',
        }
        const typeLabel: Record<string, string> = {
          payment: 'Оплата', prepayment: 'Предоплата', refund: 'Возврат', writeoff: 'Списание',
        }
        out.push({
          id: `pay-${r.id}`,
          kind: 'pay',
          at: r.paid_at,
          title: `${typeLabel[r.type] ?? r.type}: ${Number(r.amount).toLocaleString('ru-RU')} ₸`,
          subtitle: methodLabel[r.method] ?? r.method,
          amount: Number(r.amount),
        })
      }

      out.sort((a, b) => b.at.localeCompare(a.at))
      setEvents(out)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [supabase, patientId])

  const filtered = useMemo(
    () => events.filter(e => filter.has(e.kind)),
    [events, filter]
  )

  // группировка по датам
  const groups = useMemo(() => {
    const m = new Map<string, TLEvent[]>()
    for (const e of filtered) {
      const d = e.at.slice(0, 10)
      if (!m.has(d)) m.set(d, [])
      m.get(d)!.push(e)
    }
    return Array.from(m.entries())
  }, [filtered])

  function toggle(k: EvtKind) {
    setFilter(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      if (next.size === 0) return new Set(['visit', 'rx', 'lab', 'pay'])
      return next
    })
  }

  const counts = useMemo(() => {
    const c: Record<EvtKind, number> = { visit: 0, rx: 0, lab: 0, pay: 0 }
    for (const e of events) c[e.kind]++
    return c
  }, [events])

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">Лента событий</h3>
        <span className="text-xs text-gray-400">{filtered.length} из {events.length}</span>
        <div className="flex-1" />
        {(Object.keys(KIND_META) as EvtKind[]).map(k => {
          const active = filter.has(k)
          const m = KIND_META[k]
          return (
            <button
              key={k}
              onClick={() => toggle(k)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                active
                  ? `${m.color} border-transparent`
                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
              }`}
            >
              {m.icon} {m.label} · {counts[k]}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-gray-400">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">
          {events.length === 0 ? 'Событий пока нет' : 'По фильтрам ничего не найдено'}
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {groups.map(([date, items]) => (
            <div key={date} className="px-5 py-3">
              <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">
                {new Date(date + 'T12:00:00').toLocaleDateString('ru-RU', {
                  day: 'numeric', month: 'long', year: 'numeric',
                })}
              </div>
              <div className="space-y-1.5">
                {items.map(e => {
                  const m = KIND_META[e.kind]
                  const Inner = (
                    <div className="flex items-start gap-3 py-1.5">
                      <span className={`flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${m.color}`}>
                        {m.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-gray-900 truncate">{e.title}</span>
                          {e.flag && (
                            <span className={`text-[11px] ${FLAG_CLR[e.flag] ?? 'text-gray-500'}`}>
                              {e.flag === 'normal' ? 'норма' : e.flag === 'low' ? '↓ низкий'
                                : e.flag === 'high' ? '↑ высокий' : '‼ критический'}
                            </span>
                          )}
                        </div>
                        {e.subtitle && (
                          <p className="text-xs text-gray-500 mt-0.5 truncate">{e.subtitle}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-gray-400 flex-shrink-0 tabular-nums">
                        {new Date(e.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )
                  return e.href ? (
                    <Link key={e.id} href={e.href} className="block hover:bg-gray-50 -mx-5 px-5 rounded">
                      {Inner}
                    </Link>
                  ) : (
                    <div key={e.id} className="-mx-5 px-5">{Inner}</div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
