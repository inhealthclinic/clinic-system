'use client'

/**
 * Аналитика CRM.
 * Источники данных:
 *  • v_pipeline_conversion       — per-pipeline: total/open/won/lost/conversion_pct
 *  • v_pipeline_stage_counts     — текущее распределение по этапам
 *  • v_pipeline_stage_avg_time   — среднее/медиана времени в этапе
 *  • deal_loss_logs              — причины потерь (группировка клиентом)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface Pipeline {
  id: string
  name: string
  code: string
  is_active: boolean
  sort_order: number
}

interface Stage {
  id: string
  pipeline_id: string
  code: string
  name: string
  color: string
  sort_order: number
  stage_role: 'normal' | 'won' | 'lost' | 'closed'
  counts_in_kpi: boolean
}

interface StageCount {
  pipeline_id: string
  stage_id: string
  deals_count: number
  open_count: number
}
interface StageAvg {
  stage_id: string
  transitions_count: number
  avg_seconds: number | null
  median_seconds: number | null
}
interface Conversion {
  pipeline_id: string
  pipeline_name: string
  total: number
  won: number
  lost: number
  open_count: number
  conversion_pct: number | null
}
interface LossLog {
  id: string
  deal_id: string
  reason_id: string | null
  reason_name: string | null
  comment: string | null
  created_at: string
  deal?: { pipeline_id: string | null } | null
}

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  if (d >= 2) return `${d} д`
  const h = Math.floor(seconds / 3600)
  if (h >= 2) return `${h} ч`
  const m = Math.floor(seconds / 60)
  if (m >= 1) return `${m} мин`
  return `${seconds} с`
}

export default function CRMAnalyticsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [counts, setCounts] = useState<StageCount[]>([])
  const [avgs, setAvgs] = useState<StageAvg[]>([])
  const [conversions, setConversions] = useState<Conversion[]>([])
  const [losses, setLosses] = useState<LossLog[]>([])
  const [activePipelineId, setActivePipelineId] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const p = await supabase.from('pipelines').select('*').eq('clinic_id', clinicId).order('sort_order')
    const ps = (p.data ?? []) as Pipeline[]
    setPipelines(ps)
    const pipelineIds = ps.map(x => x.id)
    if (pipelineIds.length === 0) { setLoading(false); return }

    const [st, cnt, avg, cv, ll] = await Promise.all([
      supabase.from('pipeline_stages').select('*').in('pipeline_id', pipelineIds).order('sort_order'),
      supabase.from('v_pipeline_stage_counts').select('*').in('pipeline_id', pipelineIds),
      supabase.from('v_pipeline_stage_avg_time').select('*'),
      supabase.from('v_pipeline_conversion').select('*').eq('clinic_id', clinicId),
      supabase.from('deal_loss_logs').select('id,deal_id,reason_id,reason_name,comment,created_at,deal:deals(pipeline_id)')
        .order('created_at', { ascending: false }).limit(500),
    ])

    setStages((st.data ?? []) as Stage[])
    setCounts((cnt.data ?? []) as StageCount[])
    setAvgs((avg.data ?? []) as StageAvg[])
    setConversions((cv.data ?? []) as Conversion[])
    setLosses((ll.data ?? []) as unknown as LossLog[])

    if (!activePipelineId) setActivePipelineId(ps[0].id)
    setLoading(false)
  }, [clinicId, supabase, activePipelineId])

  useEffect(() => { load() }, [load])

  const activeStages = useMemo(
    () => stages.filter(s => s.pipeline_id === activePipelineId).sort((a,b) => a.sort_order - b.sort_order),
    [stages, activePipelineId]
  )
  const conv = conversions.find(c => c.pipeline_id === activePipelineId)

  // Воронка-диаграмма: для каждого этапа берём open_count (реальная текущая нагрузка).
  const stageBars = useMemo(() => {
    if (activeStages.length === 0) return []
    const max = Math.max(
      1,
      ...activeStages.map(s => counts.find(c => c.stage_id === s.id)?.open_count ?? 0),
    )
    return activeStages.map(s => {
      const open = counts.find(c => c.stage_id === s.id)?.open_count ?? 0
      const total = counts.find(c => c.stage_id === s.id)?.deals_count ?? 0
      const avg = avgs.find(a => a.stage_id === s.id)
      return {
        stage: s,
        open,
        total,
        width: Math.max(4, Math.round((open / max) * 100)),
        avg_seconds: avg?.avg_seconds ?? null,
        median_seconds: avg?.median_seconds ?? null,
      }
    })
  }, [activeStages, counts, avgs])

  // Группировка причин потерь по выбранной воронке
  const lossBreakdown = useMemo(() => {
    const filtered = losses.filter(l => !activePipelineId || l.deal?.pipeline_id === activePipelineId)
    const map = new Map<string, number>()
    for (const l of filtered) {
      const key = l.reason_name ?? '— без причины —'
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a,b) => b.count - a.count)
  }, [losses, activePipelineId])

  const lossTotal = lossBreakdown.reduce((s, r) => s + r.count, 0)

  if (loading) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Аналитика CRM</h1>
        <Link href="/crm" className="text-sm text-blue-600 hover:underline">← К канбану</Link>
      </div>

      {/* Pipelines tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {pipelines.map(p => (
          <button key={p.id} onClick={() => setActivePipelineId(p.id)}
            className={`px-3 py-1.5 rounded-md text-sm border ${
              activePipelineId === p.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}>
            {p.name}
          </button>
        ))}
      </div>

      {/* Conversion cards */}
      {conv && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label="Всего сделок" value={conv.total} />
          <MetricCard label="Открытых"     value={conv.open_count} accent="text-blue-600" />
          <MetricCard label="Успех"         value={conv.won}  accent="text-green-600" />
          <MetricCard label="Потеря"        value={conv.lost} accent="text-red-600" />
          <MetricCard label="Конверсия"     value={conv.conversion_pct == null ? '—' : `${conv.conversion_pct}%`} accent="text-gray-900" />
        </div>
      )}

      {/* Stages */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 font-medium text-gray-900">
          Распределение по этапам
        </div>
        <div className="p-4 space-y-2">
          {stageBars.length === 0 && <div className="text-sm text-gray-400">Нет данных</div>}
          {stageBars.map(b => (
            <div key={b.stage.id} className="flex items-center gap-3 text-sm">
              <div className="w-48 shrink-0 truncate flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: b.stage.color }} />
                <span className="truncate">{b.stage.name}</span>
                {!b.stage.counts_in_kpi && <span className="text-xs text-gray-400">·ignore KPI</span>}
              </div>
              <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                <div
                  className="h-full flex items-center px-2 text-xs text-white"
                  style={{ width: `${b.width}%`, background: b.stage.color, minWidth: 24 }}
                >
                  {b.open}
                </div>
              </div>
              <div className="w-20 text-right text-xs text-gray-500">
                всего: {b.total}
              </div>
              <div className="w-28 text-right text-xs text-gray-500">
                ⌀ {fmtDuration(b.avg_seconds)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Loss reasons */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <div className="font-medium text-gray-900">Причины потерь</div>
          <div className="text-xs text-gray-500">всего: {lossTotal}</div>
        </div>
        <div className="p-4 space-y-2">
          {lossBreakdown.length === 0 && <div className="text-sm text-gray-400">Потерь ещё нет</div>}
          {lossBreakdown.map(r => {
            const pct = lossTotal > 0 ? Math.round((r.count / lossTotal) * 100) : 0
            return (
              <div key={r.name} className="flex items-center gap-3 text-sm">
                <div className="w-48 shrink-0 truncate">{r.name}</div>
                <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                  <div className="h-full bg-red-500" style={{ width: `${pct}%`, minWidth: 2 }} />
                </div>
                <div className="w-16 text-right text-xs text-gray-600">{r.count} · {pct}%</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, accent = 'text-gray-900' }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent}`}>{value}</div>
    </div>
  )
}
