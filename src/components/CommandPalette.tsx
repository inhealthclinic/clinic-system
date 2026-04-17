'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Global Cmd+K / Ctrl+K search palette.
 * - Patients (full_name, iin, phone)
 * - Visits (by patient)
 * - Lab orders (order_number, patient)
 * - Quick nav links (hard-coded)
 *
 * Mount once in the dashboard layout.
 */

interface PatientHit  { kind: 'patient'; id: string; label: string; sub: string }
interface VisitHit    { kind: 'visit';   id: string; label: string; sub: string }
interface LabHit      { kind: 'lab';     id: string; label: string; sub: string }
interface NavHit      { kind: 'nav';     id: string; label: string; sub: string; href: string }
type Hit = PatientHit | VisitHit | LabHit | NavHit

const NAV_LINKS: Array<{ label: string; href: string; hint: string }> = [
  { label: 'Расписание',     href: '/schedule',          hint: 'записи на приём' },
  { label: 'Пациенты',       href: '/patients',          hint: 'картотека' },
  { label: 'Лаборатория',    href: '/lab',               hint: 'направления' },
  { label: 'Визиты',         href: '/visits',            hint: 'открытые визиты' },
  { label: 'Финансы',        href: '/finance',           hint: 'платежи и долги' },
  { label: 'Задачи',         href: '/tasks',             hint: 'задачи сотрудников' },
  { label: 'CRM',            href: '/crm',               hint: 'лиды и сделки' },
  { label: 'Аналитика',      href: '/analytics',         hint: 'отчёты' },
  { label: 'Склад',          href: '/inventory',         hint: 'расходники' },
  { label: 'Настройки',      href: '/settings',          hint: 'услуги, врачи' },
  { label: 'Пакеты анализов', href: '/settings/packages', hint: 'чек-апы' },
]

export function CommandPalette() {
  const router = useRouter()
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isK = e.key === 'k' || e.key === 'K' || e.key === 'л' || e.key === 'Л'
      if (isK && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Autofocus on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setHits([])
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Search with debounce
  const search = useCallback((q: string) => {
    if (debRef.current) clearTimeout(debRef.current)
    const qt = q.trim()
    if (!qt) {
      // When empty — show nav shortcuts only
      setHits(NAV_LINKS.map(n => ({
        kind: 'nav' as const, id: n.href, label: n.label, sub: n.hint, href: n.href,
      })))
      setLoading(false)
      return
    }
    setLoading(true)
    debRef.current = setTimeout(async () => {
      const [pRes, lRes] = await Promise.all([
        // Patients: by full_name, iin, phones (text search)
        supabase.from('patients')
          .select('id,full_name,iin,phones,patient_number')
          .or(`full_name.ilike.%${qt}%,iin.ilike.%${qt}%,patient_number.ilike.%${qt}%`)
          .limit(6),
        // Lab orders: by order_number
        supabase.from('lab_orders')
          .select('id,order_number,patient:patients(full_name),status')
          .ilike('order_number', `%${qt}%`)
          .limit(4),
      ])

      const pHits: Hit[] = ((pRes.data ?? []) as Array<{
        id: string; full_name: string; iin: string | null; phones: string[] | null; patient_number: string | null
      }>).map(p => ({
        kind: 'patient',
        id: p.id,
        label: p.full_name,
        sub: [p.patient_number, p.iin, p.phones?.[0]].filter(Boolean).join(' · '),
      }))

      const lHits: Hit[] = ((lRes.data ?? []) as unknown as Array<{
        id: string; order_number: string | null; status: string;
        patient: { full_name: string } | { full_name: string }[] | null;
      }>).map(l => {
        const pat = Array.isArray(l.patient) ? l.patient[0] : l.patient
        return {
          kind: 'lab' as const,
          id: l.id,
          label: l.order_number ?? 'Направление',
          sub: `${pat?.full_name ?? '—'} · ${l.status}`,
        }
      })

      const nHits: Hit[] = NAV_LINKS
        .filter(n =>
          n.label.toLowerCase().includes(qt.toLowerCase()) ||
          n.hint.toLowerCase().includes(qt.toLowerCase()))
        .map(n => ({
          kind: 'nav', id: n.href, label: n.label, sub: n.hint, href: n.href,
        }))

      setHits([...pHits, ...lHits, ...nHits])
      setActive(0)
      setLoading(false)
    }, 220)
  }, [supabase])

  // Fire search whenever query changes
  useEffect(() => { search(query) }, [query, search])

  const go = useCallback((h: Hit) => {
    setOpen(false)
    switch (h.kind) {
      case 'patient': router.push(`/patients/${h.id}`); break
      case 'visit':   router.push(`/visits/${h.id}`);   break
      case 'lab':     router.push('/lab');              break // drawer opens from list
      case 'nav':     router.push(h.href);              break
    }
  }, [router])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && hits[active]) { e.preventDefault(); go(hits[active]) }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] px-4 bg-black/30 backdrop-blur-sm"
      onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className="text-gray-400 text-lg">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Пациент, ИИН, № направления, раздел..."
            className="flex-1 text-sm outline-none placeholder:text-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded">ESC</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-xs text-gray-400">Поиск…</div>
          ) : hits.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              {query ? 'Ничего не найдено' : 'Наберите запрос'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    onClick={() => go(h)}
                    onMouseEnter={() => setActive(i)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                      i === active ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-lg flex-shrink-0">
                      {h.kind === 'patient' ? '👤' :
                       h.kind === 'lab'     ? '🧪' :
                       h.kind === 'visit'   ? '📋' :
                       '➡'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{h.label}</p>
                      {h.sub && <p className="text-xs text-gray-400 truncate">{h.sub}</p>}
                    </div>
                    <span className="text-[10px] text-gray-400 uppercase tracking-wider flex-shrink-0">
                      {h.kind === 'patient' ? 'пациент' :
                       h.kind === 'lab'     ? 'анализы' :
                       h.kind === 'visit'   ? 'визит' :
                       'раздел'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-[10px] text-gray-400">
          <div className="flex gap-3">
            <span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded">↑↓</kbd> навигация</span>
            <span><kbd className="bg-gray-100 px-1.5 py-0.5 rounded">Enter</kbd> открыть</span>
          </div>
          <span>Cmd+K в любое время</span>
        </div>
      </div>
    </div>
  )
}
