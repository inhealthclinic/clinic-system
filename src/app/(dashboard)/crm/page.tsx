'use client'

/**
 * CRM Kanban — воронки из БД, drag&drop карточек между этапами.
 * При попадании в этап с ролью 'lost' запрашивается причина.
 * Вся история переходов пишется триггером record_deal_stage_change.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── types ────────────────────────────────────────────────────────────────────

interface Pipeline {
  id: string
  clinic_id: string
  code: string
  name: string
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
  is_active: boolean
  stage_role: 'normal' | 'won' | 'lost' | 'closed'
  counts_in_kpi: boolean
}

interface DealRow {
  id: string
  clinic_id: string
  name: string | null
  patient_id: string | null
  pipeline_id: string | null
  stage_id: string | null
  stage: string | null
  funnel: string
  status: 'open' | 'won' | 'lost' | 'closed'
  responsible_user_id: string | null
  source_id: string | null
  amount: number | null
  stage_entered_at: string
  created_at: string
  updated_at: string
  patient?: { id: string; full_name: string; phones: string[] } | null
  responsible?: { id: string; first_name: string; last_name: string | null } | null
}

interface LossReason { id: string; name: string; is_active: boolean }
interface LeadSource { id: string; name: string; is_active: boolean }
interface UserLite { id: string; first_name: string; last_name: string | null }

interface StageCount {
  pipeline_id: string
  stage_id: string
  deals_count: number
  open_count: number
}
interface Conversion {
  pipeline_id: string
  total: number
  won: number
  lost: number
  open_count: number
  conversion_pct: number | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const d = Math.floor(ms / 86_400_000)
  if (d >= 2) return `${d}д`
  const h = Math.floor(ms / 3_600_000)
  if (h >= 2) return `${h}ч`
  const m = Math.floor(ms / 60_000)
  if (m >= 2) return `${m}мин`
  return '<2мин'
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  if (d >= 2) return `${d} д`
  const h = Math.floor(seconds / 3600)
  if (h >= 2) return `${h} ч`
  const m = Math.floor(seconds / 60)
  if (m >= 1) return `${m} мин`
  return `${seconds} с`
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function CRMKanbanPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<DealRow[]>([])
  const [counts, setCounts] = useState<StageCount[]>([])
  const [conversions, setConversions] = useState<Conversion[]>([])
  const [reasons, setReasons] = useState<LossReason[]>([])
  const [sources, setSources] = useState<LeadSource[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [loading, setLoading] = useState(true)

  const [activePipelineId, setActivePipelineId] = useState<string>('')

  // drag state
  const [dragging, setDragging] = useState<DealRow | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)

  // pending loss prompt
  const [lossPending, setLossPending] = useState<{ deal: DealRow; stageId: string } | null>(null)

  // selected deal
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const [p, d, r, ls, up] = await Promise.all([
      supabase.from('pipelines').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('deals').select(`
        id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel, status,
        responsible_user_id, source_id, amount, stage_entered_at, created_at, updated_at,
        patient:patients(id, full_name, phones),
        responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name)
      `).eq('clinic_id', clinicId).is('deleted_at', null).order('stage_entered_at', { ascending: false }).limit(1000),
      supabase.from('deal_loss_reasons').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('lead_sources').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('user_profiles').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
    ])
    const ps = (p.data ?? []) as Pipeline[]
    setPipelines(ps)
    setDeals((d.data ?? []) as unknown as DealRow[])
    setReasons((r.data ?? []) as LossReason[])
    setSources((ls.data ?? []) as LeadSource[])
    setUsers((up.data ?? []) as UserLite[])

    const stageIdsByPipeline = ps.map(x => x.id)
    if (stageIdsByPipeline.length > 0) {
      const [st, c, cv] = await Promise.all([
        supabase.from('pipeline_stages').select('*').in('pipeline_id', stageIdsByPipeline).order('sort_order'),
        supabase.from('v_pipeline_stage_counts').select('pipeline_id,stage_id,deals_count,open_count'),
        supabase.from('v_pipeline_conversion').select('pipeline_id,total,won,lost,open_count,conversion_pct').eq('clinic_id', clinicId),
      ])
      setStages((st.data ?? []) as Stage[])
      setCounts((c.data ?? []) as StageCount[])
      setConversions((cv.data ?? []) as Conversion[])
    }

    if (!activePipelineId && ps.length > 0) setActivePipelineId(ps[0].id)
    setLoading(false)
  }, [clinicId, supabase, activePipelineId])

  useEffect(() => { load() }, [load])

  const activeStages = useMemo(
    () => stages.filter(s => s.pipeline_id === activePipelineId && s.is_active).sort((a,b) => a.sort_order - b.sort_order),
    [stages, activePipelineId]
  )
  const activePipeline = pipelines.find(p => p.id === activePipelineId) ?? null
  const conversion = conversions.find(c => c.pipeline_id === activePipelineId)

  const dealsByStage = useMemo(() => {
    const map = new Map<string, DealRow[]>()
    for (const s of activeStages) map.set(s.id, [])
    for (const d of deals) {
      if (d.pipeline_id !== activePipelineId) continue
      if (!d.stage_id) continue
      const arr = map.get(d.stage_id)
      if (arr) arr.push(d)
    }
    return map
  }, [deals, activeStages, activePipelineId])

  // ── drag & drop ────────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, d: DealRow) {
    setDragging(d)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', d.id)
  }
  function onDragOver(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overStage !== stageId) setOverStage(stageId)
  }
  function onDragLeave(stageId: string) {
    if (overStage === stageId) setOverStage(null)
  }
  async function onDrop(e: React.DragEvent, stageId: string) {
    e.preventDefault()
    setOverStage(null)
    const d = dragging
    setDragging(null)
    if (!d || d.stage_id === stageId) return
    const targetStage = activeStages.find(s => s.id === stageId)
    if (!targetStage) return

    // Optimistic update
    setDeals(prev => prev.map(x => x.id === d.id
      ? { ...x, stage_id: stageId, stage: targetStage.code, stage_entered_at: new Date().toISOString() }
      : x))

    if (targetStage.stage_role === 'lost') {
      setLossPending({ deal: d, stageId })
      return
    }
    await moveDeal(d.id, stageId)
  }

  async function moveDeal(dealId: string, stageId: string) {
    const { error } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', dealId)
    if (error) { alert('Не удалось сохранить: ' + error.message); load(); return }
    load()
  }

  async function confirmLoss(reasonId: string | null, reasonName: string | null, comment: string) {
    if (!lossPending) return
    const { deal, stageId } = lossPending
    // Переводим стадию → триггер сам выставит status='lost'
    const { error: upErr } = await supabase.from('deals').update({ stage_id: stageId }).eq('id', deal.id)
    if (upErr) { alert('Не удалось перевести: ' + upErr.message); setLossPending(null); load(); return }
    // Пишем лог причины
    const { error: logErr } = await supabase.from('deal_loss_logs').insert({
      deal_id: deal.id,
      reason_id: reasonId,
      reason_name: reasonName,
      comment: comment || null,
      created_by: profile?.id ?? null,
    })
    if (logErr) { alert('Этап переведён, но причина не записана: ' + logErr.message) }
    setLossPending(null)
    load()
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  if (loading) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>
  if (pipelines.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">Нет доступных воронок.</p>
        <Link href="/settings/pipelines" className="text-sm text-blue-600 hover:underline">Создать воронку →</Link>
      </div>
    )
  }

  return (
    <div className="p-4 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Воронка продаж</h1>
          <p className="text-xs text-gray-500">Перетаскивайте карточки между этапами — история фиксируется автоматически.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/crm/analytics" className="text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
            Аналитика
          </Link>
          <Link href="/settings/pipelines" className="text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
            Настройка этапов
          </Link>
          <button
            onClick={() => setSelectedDeal({
              id: '', clinic_id: clinicId ?? '', name: '', patient_id: null,
              pipeline_id: activePipelineId, stage_id: activeStages[0]?.id ?? null,
              stage: activeStages[0]?.code ?? null, funnel: activePipeline?.code ?? 'leads',
              status: 'open', responsible_user_id: null, source_id: null, amount: null,
              stage_entered_at: new Date().toISOString(),
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            } as DealRow)}
            className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white"
          >
            + Сделка
          </button>
        </div>
      </div>

      {/* Pipeline tabs + KPI */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
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
        <div className="flex-1" />
        {conversion && (
          <div className="flex gap-3 text-xs text-gray-600">
            <KPI label="Всего" value={conversion.total} />
            <KPI label="Открытых" value={conversion.open_count} accent="text-blue-600" />
            <KPI label="Успех" value={conversion.won} accent="text-green-600" />
            <KPI label="Потерь" value={conversion.lost} accent="text-red-600" />
            <KPI label="Конверсия" value={conversion.conversion_pct == null ? '—' : `${conversion.conversion_pct}%`} accent="text-gray-900" />
          </div>
        )}
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {activeStages.map(stage => {
          const cards = dealsByStage.get(stage.id) ?? []
          const count = counts.find(c => c.stage_id === stage.id)
          const isOver = overStage === stage.id
          return (
            <div
              key={stage.id}
              className={`min-w-[280px] w-[280px] bg-gray-50 border rounded-lg transition-colors ${
                isOver ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200'
              }`}
              onDragOver={(e) => onDragOver(e, stage.id)}
              onDragLeave={() => onDragLeave(stage.id)}
              onDrop={(e) => onDrop(e, stage.id)}
            >
              <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
                <span className="text-sm font-medium text-gray-900 flex-1 truncate">{stage.name}</span>
                <span className="text-xs text-gray-500">{count?.open_count ?? cards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[40px] max-h-[calc(100vh-240px)] overflow-y-auto">
                {cards.map(d => (
                  <DealCard key={d.id} deal={d} onDragStart={(e) => onDragStart(e, d)} onClick={() => setSelectedDeal(d)} />
                ))}
                {cards.length === 0 && <div className="text-xs text-gray-300 text-center py-4">—</div>}
              </div>
            </div>
          )
        })}
        {activeStages.length === 0 && (
          <div className="text-sm text-gray-500 p-6">
            В воронке нет активных этапов. <Link href="/settings/pipelines" className="text-blue-600 hover:underline">Настроить →</Link>
          </div>
        )}
      </div>

      {/* Modals */}
      {lossPending && (
        <LossReasonModal
          reasons={reasons}
          onCancel={() => { setLossPending(null); load() }}
          onConfirm={(rid, rname, c) => confirmLoss(rid, rname, c)}
        />
      )}

      {selectedDeal && (
        <DealModal
          deal={selectedDeal}
          pipelines={pipelines}
          stages={stages}
          sources={sources}
          users={users}
          onClose={() => setSelectedDeal(null)}
          onSaved={() => { setSelectedDeal(null); load() }}
        />
      )}
    </div>
  )
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

function KPI({ label, value, accent = 'text-gray-900' }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-md px-2.5 py-1.5">
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className={`text-sm font-semibold ${accent}`}>{value}</div>
    </div>
  )
}

// ─── DealCard ─────────────────────────────────────────────────────────────────

function DealCard({ deal, onDragStart, onClick }: {
  deal: DealRow
  onDragStart: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const title = deal.name || deal.patient?.full_name || '(без названия)'
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="bg-white border border-gray-200 rounded-md p-2 cursor-grab active:cursor-grabbing hover:shadow-sm"
    >
      <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
      {deal.patient?.phones?.[0] && (
        <div className="text-xs text-gray-500 truncate">{deal.patient.phones[0]}</div>
      )}
      <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
        <span>⏱ {fmtAge(deal.stage_entered_at)}</span>
        {deal.responsible && (
          <span className="ml-auto truncate max-w-[100px]">
            {deal.responsible.first_name}{deal.responsible.last_name ? ` ${deal.responsible.last_name[0]}.` : ''}
          </span>
        )}
      </div>
      {deal.amount != null && (
        <div className="text-xs text-gray-600 mt-1">{Number(deal.amount).toLocaleString('ru-RU')} ₸</div>
      )}
    </div>
  )
}

// ─── LossReasonModal ──────────────────────────────────────────────────────────

function LossReasonModal({
  reasons, onCancel, onConfirm,
}: {
  reasons: LossReason[]
  onCancel: () => void
  onConfirm: (reasonId: string | null, reasonName: string | null, comment: string) => void
}) {
  const [rid, setRid] = useState<string>(reasons[0]?.id ?? '')
  const [comment, setComment] = useState('')

  function submit() {
    const r = reasons.find(x => x.id === rid)
    if (!r) { alert('Выберите причину'); return }
    onConfirm(r.id, r.name, comment)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-3">Причина потери</h2>
        <p className="text-xs text-gray-500 mb-4">
          Сделка переводится в проигранную. Выберите причину — она попадёт в аналитику.
        </p>
        <div className="space-y-2 mb-4">
          {reasons.map(r => (
            <label key={r.id} className="flex items-center gap-2 text-sm p-2 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
              <input type="radio" name="reason" checked={rid === r.id} onChange={() => setRid(r.id)} />
              {r.name}
            </label>
          ))}
          {reasons.length === 0 && (
            <p className="text-xs text-gray-500">Причин нет — добавьте их в <Link href="/settings/pipelines" className="text-blue-600 hover:underline">настройках</Link>.</p>
          )}
        </div>
        <label className="block text-xs text-gray-500 mb-1">Комментарий (опционально)</label>
        <textarea
          value={comment} onChange={e => setComment(e.target.value)} rows={3}
          className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md">
            Отмена
          </button>
          <button onClick={submit} disabled={!rid}
            className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-md">
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── DealModal ────────────────────────────────────────────────────────────────

interface HistoryRow {
  id: string
  deal_id: string
  from_stage: string | null
  to_stage: string
  from_stage_id: string | null
  to_stage_id: string | null
  time_in_stage_seconds: number | null
  changed_by: string | null
  created_at: string
}

function DealModal({
  deal, pipelines, stages, sources, users, onClose, onSaved,
}: {
  deal: DealRow
  pipelines: Pipeline[]
  stages: Stage[]
  sources: LeadSource[]
  users: UserLite[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()

  const isNew = !deal.id
  const [form, setForm] = useState<DealRow>(deal)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [journey, setJourney] = useState<{
    appointments_count: number
    visits_count: number
    visits_completed: number
    charges_total: number
    payments_total: number
    refunds_total: number
  } | null>(null)
  const [appointments, setAppointments] = useState<Array<{
    id: string; date: string; time_start: string; status: string
    doctor?: { first_name: string; last_name: string | null } | null
    service?: { name: string } | null
  }>>([])

  // patient search (minimal)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<Array<{ id: string; full_name: string; phones: string[] }>>([])

  useEffect(() => {
    if (isNew || !deal.id) return
    supabase.from('deal_stage_history')
      .select('*')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setHistory((data ?? []) as HistoryRow[])
        setHistoryLoaded(true)
      })
    supabase.from('v_deal_journey')
      .select('appointments_count,visits_count,visits_completed,charges_total,payments_total,refunds_total')
      .eq('deal_id', deal.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setJourney(data) })
    supabase.from('appointments')
      .select('id,date,time_start,status,doctor:doctors(first_name,last_name),service:services(name)')
      .eq('deal_id', deal.id)
      .order('date', { ascending: false })
      .limit(20)
      .then(({ data }) => setAppointments((data ?? []) as unknown as Array<{
        id: string; date: string; time_start: string; status: string
        doctor?: { first_name: string; last_name: string | null } | null
        service?: { name: string } | null
      }>))
  }, [deal.id, isNew, supabase])

  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) { setPatientResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients').select('id,full_name,phones')
        .eq('clinic_id', profile?.clinic_id ?? '')
        .or(`full_name.ilike.%${patientSearch}%,phones.cs.{${patientSearch}}`)
        .limit(10)
      setPatientResults((data ?? []) as Array<{ id: string; full_name: string; phones: string[] }>)
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch, supabase, profile?.clinic_id])

  const pipelineStages = stages
    .filter(s => s.pipeline_id === form.pipeline_id)
    .sort((a,b) => a.sort_order - b.sort_order)

  async function save() {
    if (!form.pipeline_id || !form.stage_id) { alert('Выберите воронку и этап'); return }
    setSaving(true)
    const payload = {
      clinic_id: form.clinic_id,
      name: form.name?.trim() || null,
      patient_id: form.patient_id,
      pipeline_id: form.pipeline_id,
      stage_id: form.stage_id,
      // legacy:
      funnel: pipelines.find(p => p.id === form.pipeline_id)?.code ?? form.funnel ?? 'leads',
      stage:  stages.find(s => s.id === form.stage_id)?.code ?? form.stage ?? 'new',
      responsible_user_id: form.responsible_user_id,
      source_id: form.source_id,
      amount: form.amount,
    }
    const { error } = isNew
      ? await supabase.from('deals').insert(payload)
      : await supabase.from('deals').update(payload).eq('id', form.id)
    setSaving(false)
    if (error) { alert('Ошибка: ' + error.message); return }
    onSaved()
  }

  async function removeDeal() {
    if (isNew) return
    if (!confirm('Удалить сделку? Она будет помечена удалённой (deleted_at).')) return
    const { error } = await supabase.from('deals').update({ deleted_at: new Date().toISOString() }).eq('id', form.id)
    if (error) { alert(error.message); return }
    onSaved()
  }

  function stageName(id: string | null | undefined): string {
    if (!id) return '—'
    return stages.find(s => s.id === id)?.name ?? id
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">
            {isNew ? 'Новая сделка' : (form.name || form.patient?.full_name || 'Сделка')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Название</label>
              <input
                type="text" value={form.name ?? ''}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5"
                placeholder="напр. Иванов И.И. — чек-ап"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Воронка</label>
              <select
                value={form.pipeline_id ?? ''}
                onChange={e => {
                  const pid = e.target.value
                  const firstStage = stages.find(s => s.pipeline_id === pid)
                  setForm({ ...form, pipeline_id: pid, stage_id: firstStage?.id ?? null })
                }}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5"
              >
                {pipelines.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Этап</label>
              <select
                value={form.stage_id ?? ''}
                onChange={e => setForm({ ...form, stage_id: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5"
              >
                {pipelineStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Ответственный</label>
              <select
                value={form.responsible_user_id ?? ''}
                onChange={e => setForm({ ...form, responsible_user_id: e.target.value || null })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5"
              >
                <option value="">— не назначен —</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Источник</label>
              <select
                value={form.source_id ?? ''}
                onChange={e => setForm({ ...form, source_id: e.target.value || null })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5"
              >
                <option value="">— не задан —</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Сумма (₸)</label>
              <input
                type="number" step="any" value={form.amount ?? ''}
                onChange={e => setForm({ ...form, amount: e.target.value === '' ? null : Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 font-mono"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Пациент</label>
              {form.patient ? (
                <div className="flex items-center justify-between border border-gray-200 rounded-md px-2 py-1.5">
                  <div>
                    <div>{form.patient.full_name}</div>
                    <div className="text-xs text-gray-500">{form.patient.phones?.[0]}</div>
                  </div>
                  <button onClick={() => setForm({ ...form, patient_id: null, patient: null })}
                    className="text-xs text-red-600 hover:text-red-700">Открепить</button>
                </div>
              ) : (
                <>
                  <input
                    type="text" value={patientSearch}
                    onChange={e => setPatientSearch(e.target.value)}
                    placeholder="Поиск по имени или телефону…"
                    className="w-full border border-gray-300 rounded-md px-2 py-1.5"
                  />
                  {patientResults.length > 0 && (
                    <div className="mt-1 border border-gray-200 rounded-md max-h-40 overflow-y-auto">
                      {patientResults.map(p => (
                        <button key={p.id} onClick={() => {
                          setForm({ ...form, patient_id: p.id, patient: p })
                          setPatientSearch(''); setPatientResults([])
                        }} className="w-full text-left px-2 py-1.5 hover:bg-blue-50">
                          <div>{p.full_name}</div>
                          <div className="text-xs text-gray-500">{p.phones?.[0]}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* KPI block */}
          {!isNew && (
            <div className="grid grid-cols-3 gap-2 bg-gray-50 border border-gray-200 rounded-md p-3">
              <div>
                <div className="text-xs text-gray-500">Этап</div>
                <div className="text-sm font-medium">{stageName(form.stage_id)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">В этапе</div>
                <div className="text-sm font-medium">{fmtAge(form.stage_entered_at)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">Статус</div>
                <div className="text-sm font-medium">{form.status}</div>
              </div>
            </div>
          )}

          {/* Journey: money + visits */}
          {!isNew && journey && (
            <div className="grid grid-cols-3 gap-2 bg-emerald-50 border border-emerald-200 rounded-md p-3">
              <div>
                <div className="text-xs text-emerald-800">Приёмы</div>
                <div className="text-sm font-medium">
                  {journey.appointments_count} · визитов {journey.visits_completed}/{journey.visits_count}
                </div>
              </div>
              <div>
                <div className="text-xs text-emerald-800">Начислено</div>
                <div className="text-sm font-medium font-mono">
                  {Number(journey.charges_total).toLocaleString('ru-RU')} ₸
                </div>
              </div>
              <div>
                <div className="text-xs text-emerald-800">Оплачено</div>
                <div className="text-sm font-medium font-mono">
                  {Number(journey.payments_total).toLocaleString('ru-RU')} ₸
                  {Number(journey.refunds_total) > 0 && (
                    <span className="text-red-600 ml-1">
                      (возврат {Number(journey.refunds_total).toLocaleString('ru-RU')})
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Linked appointments */}
          {!isNew && appointments.length > 0 && (
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">Привязанные приёмы</div>
              <div className="border border-gray-200 rounded-md divide-y divide-gray-100 text-xs">
                {appointments.map(a => (
                  <div key={a.id} className="px-3 py-2 flex items-center gap-2">
                    <span className="text-gray-500">{a.date} {a.time_start?.slice(0,5)}</span>
                    <span className="flex-1 text-gray-700">
                      {a.doctor ? `${a.doctor.first_name} ${a.doctor.last_name ?? ''}` : '—'}
                      {a.service ? ` · ${a.service.name}` : ''}
                    </span>
                    <span className="text-gray-400">{a.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          {!isNew && (
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">История этапов</div>
              {!historyLoaded && <div className="text-xs text-gray-400">Загрузка…</div>}
              {historyLoaded && history.length === 0 && <div className="text-xs text-gray-400">Переходов ещё не было</div>}
              {historyLoaded && history.length > 0 && (
                <div className="border border-gray-200 rounded-md divide-y divide-gray-100 text-xs">
                  {history.map(h => (
                    <div key={h.id} className="px-3 py-2 flex items-center gap-2">
                      <span className="text-gray-500">{new Date(h.created_at).toLocaleString('ru-RU')}</span>
                      <span className="flex-1 text-gray-700">
                        {(h.from_stage_id && stageName(h.from_stage_id)) || h.from_stage || '—'}
                        {' → '}
                        <span className="font-medium">{(h.to_stage_id && stageName(h.to_stage_id)) || h.to_stage}</span>
                      </span>
                      <span className="text-gray-400">{fmtDuration(h.time_in_stage_seconds)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
          <div>
            {!isNew && (
              <button onClick={removeDeal} className="text-sm text-red-600 hover:text-red-700">
                Удалить
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md">
              Отмена
            </button>
            <button onClick={save} disabled={saving}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md">
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
