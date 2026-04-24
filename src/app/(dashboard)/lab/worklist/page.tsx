'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type Item = {
  id: string
  order_id: string
  service_id: string | null
  name: string
  status: string
  analyzer_group: string | null
  verified_at: string | null
  ordered_at: string
  patient_name: string | null
  sample_code: string | null
  urgent: boolean
}

const GROUP_LABEL: Record<string, string> = {
  hematology:   '🩸 Гематология',
  coagulation:  '🧪 Коагулограмма',
  biochemistry: '⚗️ Биохимия',
  immunoassay:  '🔬 Гормоны / ИФА',
  urinalysis:   '🧴 Моча',
  coprology:    '💩 Кал',
  microscopy:   '🔍 Микроскопия',
  other:        '📦 Прочее',
}

const STATUS_RU: Record<string, string> = {
  pending:     'Ожидает',
  collected:   'Взят',
  in_progress: 'В работе',
  done:        'Готов',
  completed:   'Черновик',
  verified:    'Верифицирован',
  delivered:   'Выдан',
  rejected:    'Отклонён',
}

const STATUS_CLR: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-600',
  collected:   'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  done:        'bg-green-100 text-green-700',
  completed:   'bg-green-100 text-green-700',
  verified:    'bg-purple-100 text-purple-700',
  delivered:   'bg-gray-100 text-gray-500',
  rejected:    'bg-red-100 text-red-700',
}

function csvEscape(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function WorklistPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [rows, setRows] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('lab_order_items')
      .select(`
        id, order_id, service_id, name, status, verified_at,
        services ( analyzer_group ),
        lab_orders ( ordered_at, order_number, urgent, patients ( full_name ) )
      `)
      .eq('clinic_id', profile?.clinic_id as string)
      .order('created_at', { ascending: false })
      .limit(500)

    const mapped: Item[] = (data ?? []).map(r => {
      const ord = (r as any).lab_orders
      return {
        id:            r.id,
        order_id:      r.order_id,
        service_id:    r.service_id,
        name:          r.name,
        status:        r.status,
        analyzer_group: (r as any).services?.analyzer_group ?? null,
        verified_at:   r.verified_at,
        ordered_at:    ord?.ordered_at ?? '',
        patient_name:  ord?.patients?.full_name ?? null,
        sample_code:   ord?.order_number ?? null,
        urgent:        ord?.urgent ?? false,
      }
    })
    setRows(mapped)
    setLoading(false)
  }

  useEffect(() => {
    if (profile?.clinic_id) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.clinic_id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyActive && ['delivered', 'rejected'].includes(r.status)) return false
      if (!q) return true
      return r.name.toLowerCase().includes(q)
          || (r.patient_name ?? '').toLowerCase().includes(q)
          || (r.sample_code ?? '').toLowerCase().includes(q)
    })
  }, [rows, search, onlyActive])

  const groups = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const r of filtered) {
      const g = r.analyzer_group ?? 'other'
      ;(m[g] ??= []).push(r)
    }
    return m
  }, [filtered])

  const toggleInProgress = async (it: Item) => {
    const next = it.status === 'in_progress' ? 'collected' : 'in_progress'
    await supabase.from('lab_order_items').update({ status: next }).eq('id', it.id)
    setRows(prev => prev.map(r => r.id === it.id ? { ...r, status: next } : r))
  }

  const exportCsv = (group: string, items: Item[]) => {
    const header = ['sample_code', 'patient', 'analyte', 'status', 'ordered_at', 'urgent']
    const lines = [header.join(',')]
    for (const it of items) {
      lines.push([
        csvEscape(it.sample_code ?? it.order_id.slice(0, 8)),
        csvEscape(it.patient_name ?? ''),
        csvEscape(it.name),
        csvEscape(it.status),
        csvEscape(it.ordered_at),
        csvEscape(it.urgent ? 'YES' : ''),
      ].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `worklist_${group}_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const orderedGroups = Object.keys(GROUP_LABEL).filter(k => groups[k]?.length)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Worklist лаборатории</h1>
          <p className="text-xs text-gray-500">Заявки, сгруппированные по анализатору / методу</p>
        </div>
        <Link href="/lab" className="text-sm text-blue-600 hover:text-blue-800">← К заявкам</Link>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: аналит / пациент / код пробы"
          className="flex-1 min-w-[240px] border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
          Скрывать выданные/отклонённые
        </label>
        <button
          onClick={load}
          className="px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-sm">
          ↻ Обновить
        </button>
      </div>

      {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

      {!loading && orderedGroups.length === 0 && (
        <div className="text-sm text-gray-400 bg-white border border-gray-100 rounded-xl p-6 text-center">
          Нет заявок под критерии.
        </div>
      )}

      {orderedGroups.map(gk => {
        const items = groups[gk]
        const isCollapsed = collapsed[gk]
        return (
          <div key={gk} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <button
                onClick={() => setCollapsed(s => ({ ...s, [gk]: !s[gk] }))}
                className="text-left flex items-center gap-2">
                <span className="text-gray-400 text-xs">{isCollapsed ? '▸' : '▾'}</span>
                <span className="font-medium text-gray-900">{GROUP_LABEL[gk] ?? gk}</span>
                <span className="text-xs text-gray-400">· {items.length}</span>
              </button>
              <button
                onClick={() => exportCsv(gk, items)}
                className="text-xs px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg">
                ⬇ CSV для анализатора
              </button>
            </div>
            {!isCollapsed && (
              <div className="divide-y divide-gray-50">
                {items.map(it => (
                  <div key={it.id} className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={it.status === 'in_progress'}
                      onChange={() => toggleInProgress(it)}
                      title="В работе"
                      className="w-4 h-4"
                    />
                    <span className="font-mono text-xs text-gray-400 w-24 truncate">
                      {it.sample_code ?? it.order_id.slice(0, 8)}
                    </span>
                    <span className="flex-1 text-gray-800 truncate">{it.name}</span>
                    <span className="text-xs text-gray-500 w-48 truncate">{it.patient_name ?? '—'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLR[it.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {STATUS_RU[it.status] ?? it.status}
                    </span>
                    {it.urgent && <span className="text-xs text-red-600 font-semibold">СРОЧНО</span>}
                    <Link
                      href={`/lab/${it.order_id}`}
                      className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap">
                      Открыть →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
