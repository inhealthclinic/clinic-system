'use client'

/**
 * CRM Kanban — воронки из БД, drag&drop карточек между этапами.
 * При попадании в этап с ролью 'lost' запрашивается причина.
 * Вся история переходов пишется триггером record_deal_stage_change.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { CreateAppointmentModal } from '@/components/appointments/CreateAppointmentModal'
import { DealFieldsSettingsModal } from '@/components/crm/DealFieldsSettingsModal'
import {
  type DealFieldConfig,
  DEFAULT_FIELD_CONFIGS,
  fieldDisplayLabel,
  isFieldRequired,
  mergeWithDefaults,
  validateRequiredFields,
} from '@/lib/dealFields'

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
  // NEW (мигр. 038):
  preferred_doctor_id: string | null
  appointment_type: string | null
  loss_reason_id: string | null
  contact_phone: string | null
  contact_city: string | null
  notes: string | null
  tags: string[]
  // Кастомные поля (мигр. 057): { [field_key]: value }
  custom_fields: Record<string, unknown> | null
  //
  stage_entered_at: string
  created_at: string
  updated_at: string
  patient?: { id: string; full_name: string; phones: string[]; birth_date?: string | null; city?: string | null } | null
  responsible?: { id: string; first_name: string; last_name: string | null } | null
  doctor?: { id: string; first_name: string; last_name: string | null } | null
}

interface LossReason { id: string; name: string; is_active: boolean }
interface LeadSource { id: string; name: string; is_active: boolean }
interface UserLite { id: string; first_name: string; last_name: string | null }
interface DoctorLite { id: string; first_name: string; last_name: string | null }
interface ApptType { key: string; label: string; color: string }

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
  const router = useRouter()
  const searchParams = useSearchParams()

  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [deals, setDeals] = useState<DealRow[]>([])
  const [counts, setCounts] = useState<StageCount[]>([])
  const [conversions, setConversions] = useState<Conversion[]>([])
  const [reasons, setReasons] = useState<LossReason[]>([])
  const [sources, setSources] = useState<LeadSource[]>([])
  const [users, setUsers] = useState<UserLite[]>([])
  const [doctors, setDoctors] = useState<DoctorLite[]>([])
  const [apptTypes, setApptTypes] = useState<ApptType[]>([])
  const [loading, setLoading] = useState(true)

  const [activePipelineId, setActivePipelineId] = useState<string>('')

  // Терминальные этапы (успешно реализовано / закрыто) по умолчанию скрыты —
  // менеджеры работают в основном с активными сделками. Выбор запоминается.
  const [showTerminal, setShowTerminal] = useState<boolean>(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('crm.showTerminalStages')
    if (v === '1') setShowTerminal(true)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('crm.showTerminalStages', showTerminal ? '1' : '0')
  }, [showTerminal])

  // Режим просмотра: канбан (этапы-колонки) или таблица (плоский список).
  // Персистим выбор, чтобы менеджер возвращался к привычному виду.
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('crm.viewMode')
    if (v === 'table' || v === 'kanban') setViewMode(v)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('crm.viewMode', viewMode)
  }, [viewMode])

  // Поиск по воронке: имя сделки / пациента / телефон / тег / город / заметка.
  const [listSearch, setListSearch] = useState('')

  // Сортировка карточек внутри этапа и в таблице. Как в амоCRM — список
  // опций + направление ↑/↓. Выбор запоминаем в localStorage.
  type SortField = 'updated_at' | 'stage_entered_at' | 'created_at' | 'name' | 'amount'
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const f = window.localStorage.getItem('crm.sortField') as SortField | null
    const d = window.localStorage.getItem('crm.sortDir') as 'asc' | 'desc' | null
    if (f && ['updated_at','stage_entered_at','created_at','name','amount'].includes(f)) setSortField(f)
    if (d === 'asc' || d === 'desc') setSortDir(d)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('crm.sortField', sortField)
    window.localStorage.setItem('crm.sortDir', sortDir)
  }, [sortField, sortDir])

  // Автообновление — периодически перегружаем список сделок (30 сек).
  const [autoRefresh, setAutoRefresh] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem('crm.autoRefresh') === '1') setAutoRefresh(true)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('crm.autoRefresh', autoRefresh ? '1' : '0')
  }, [autoRefresh])

  // Меню «Ещё» + модалки, которые из него открываются.
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [showPageFieldsSettings, setShowPageFieldsSettings] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showDupesModal, setShowDupesModal] = useState(false)

  // Массовые действия — множественный выбор строк в таблице.
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())

  // drag state
  const [dragging, setDragging] = useState<DealRow | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)

  // pending loss prompt
  const [lossPending, setLossPending] = useState<{ deal: DealRow; stageId: string } | null>(null)

  // selected deal — persisted in ?deal=<id> query param
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null)
  const pendingDealId = useRef<string | null>(searchParams.get('deal'))

  const openDeal = useCallback((d: DealRow) => {
    setSelectedDeal(d)
    if (d.id) router.replace(`?deal=${d.id}`, { scroll: false })
  }, [router])

  const closeDeal = useCallback(() => {
    setSelectedDeal(null)
    router.replace('?', { scroll: false })
  }, [router])

  // On initial load, restore selected deal from URL
  useEffect(() => {
    if (!pendingDealId.current || deals.length === 0) return
    const d = deals.find(x => x.id === pendingDealId.current)
    if (d) {
      setSelectedDeal(d)
      pendingDealId.current = null
    }
  }, [deals])

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const [p, d, r, ls, up, doc, cl] = await Promise.all([
      supabase.from('pipelines').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('deals').select(`
        id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel, status,
        responsible_user_id, source_id, amount,
        preferred_doctor_id, appointment_type, loss_reason_id, contact_phone, contact_city, notes, tags,
        custom_fields,
        stage_entered_at, created_at, updated_at,
        patient:patients(id, full_name, phones, birth_date, city),
        responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name),
        doctor:doctors!deals_preferred_doctor_id_fkey(id, first_name, last_name)
      `).eq('clinic_id', clinicId).is('deleted_at', null).order('stage_entered_at', { ascending: false }).limit(1000),
      supabase.from('deal_loss_reasons').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('lead_sources').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('user_profiles').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
      supabase.from('doctors').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
      supabase.from('clinics').select('settings').eq('id', clinicId).maybeSingle(),
    ])
    const ps = (p.data ?? []) as Pipeline[]
    setPipelines(ps)
    setDeals((d.data ?? []) as unknown as DealRow[])
    setReasons((r.data ?? []) as LossReason[])
    setSources((ls.data ?? []) as LeadSource[])
    setUsers((up.data ?? []) as UserLite[])
    setDoctors((doc.data ?? []) as DoctorLite[])
    const at = (cl.data?.settings as { appt_types?: ApptType[] } | null)?.appt_types
    setApptTypes(Array.isArray(at) ? at : [])

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

  // Все активные этапы воронки (включая терминальные won/closed).
  // Нужны для подсчёта counts и как источник для dealsByStage.
  const allActiveStages = useMemo(
    () => stages.filter(s => s.pipeline_id === activePipelineId && s.is_active).sort((a,b) => a.sort_order - b.sort_order),
    [stages, activePipelineId]
  )
  // Этапы, показываемые в канбане. По умолчанию прячем терминальные
  // won/closed (например «Успешно реализовано», «Закрыто»), но
  // оставляем «Записан»/«Записана» и подобные: у них в БД бывает
  // stage_role='won', но по смыслу это рабочий этап воронки.
  const isHiddenTerminal = (s: Stage) => {
    const n = (s.name ?? '').trim().toLowerCase()
    if (n.includes('запис')) return false // Записан/Записана/… — всегда видимо
    return s.stage_role === 'won' || s.stage_role === 'closed'
  }
  const isListCrmAdmin = profile?.role?.slug === 'admin'
  const hiddenTerminalCount = useMemo(
    () => allActiveStages.filter(isHiddenTerminal).length,
    [allActiveStages]
  )
  const activeStages = useMemo(
    () => (showTerminal && isListCrmAdmin)
      ? allActiveStages
      : allActiveStages.filter(s => !isHiddenTerminal(s)),
    [allActiveStages, showTerminal, isListCrmAdmin]
  )
  const activePipeline = pipelines.find(p => p.id === activePipelineId) ?? null
  const conversion = conversions.find(c => c.pipeline_id === activePipelineId)

  // Совпадение сделки с поисковым запросом. Сравниваем по имени сделки,
  // ФИО пациента, всем телефонам, городам, заметкам и тегам.
  const matchesSearch = useCallback((d: DealRow, q: string) => {
    if (!q) return true
    const hay = [
      d.name ?? '',
      d.patient?.full_name ?? '',
      ...(d.patient?.phones ?? []),
      d.contact_phone ?? '',
      d.contact_city ?? '',
      d.patient?.city ?? '',
      d.notes ?? '',
      ...(d.tags ?? []),
    ].join(' ').toLowerCase()
    return hay.includes(q)
  }, [])

  // Универсальный компаратор по выбранному полю/направлению.
  const compareDeals = useCallback((a: DealRow, b: DealRow) => {
    const mul = sortDir === 'asc' ? 1 : -1
    const toTime = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0)
    let cmp = 0
    switch (sortField) {
      case 'created_at':
        cmp = toTime(a.created_at) - toTime(b.created_at); break
      case 'updated_at':
        cmp = toTime(a.updated_at) - toTime(b.updated_at); break
      case 'stage_entered_at':
        cmp = toTime(a.stage_entered_at) - toTime(b.stage_entered_at); break
      case 'amount':
        cmp = (a.amount ?? 0) - (b.amount ?? 0); break
      case 'name': {
        const na = (a.name ?? a.patient?.full_name ?? '').toLowerCase()
        const nb = (b.name ?? b.patient?.full_name ?? '').toLowerCase()
        cmp = na.localeCompare(nb, 'ru')
        break
      }
    }
    return cmp * mul
  }, [sortField, sortDir])

  const dealsByStage = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    const map = new Map<string, DealRow[]>()
    for (const s of activeStages) map.set(s.id, [])
    for (const d of deals) {
      if (d.pipeline_id !== activePipelineId) continue
      if (!d.stage_id) continue
      if (!matchesSearch(d, q)) continue
      const arr = map.get(d.stage_id)
      if (arr) arr.push(d)
    }
    for (const arr of map.values()) arr.sort(compareDeals)
    return map
  }, [deals, activeStages, activePipelineId, listSearch, matchesSearch, compareDeals])

  // Плоский список для табличного вида.
  const tableDeals = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    const activeStageIds = new Set(activeStages.map(s => s.id))
    return deals
      .filter(d => d.pipeline_id === activePipelineId)
      .filter(d => d.stage_id != null && activeStageIds.has(d.stage_id))
      .filter(d => matchesSearch(d, q))
      .sort(compareDeals)
  }, [deals, activePipelineId, activeStages, listSearch, matchesSearch, compareDeals])

  // Автообновление — тихо перезагружаем список сделок раз в 30 секунд.
  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => { load() }, 30_000)
    return () => window.clearInterval(id)
  }, [autoRefresh, load])

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

  // Переключаем сортировку: повторный клик по активному полю инвертирует
  // направление, клик по новому — выставляет desc по умолчанию.
  function changeSort(field: SortField) {
    if (field === sortField) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  // Экспорт текущего отфильтрованного списка сделок в CSV. Разделитель — ';'
  // (совместим с Excel по-русски), перевод строк — \r\n, кодировка UTF-8 с BOM.
  function exportDealsCsv() {
    const esc = (v: unknown) => {
      if (v == null) return ''
      const s = String(v).replace(/"/g, '""')
      return /[;"\r\n]/.test(s) ? `"${s}"` : s
    }
    const header = [
      'ID', 'Сделка', 'Пациент', 'Телефон', 'Город',
      'Воронка', 'Этап', 'Статус', 'Сумма', 'Ответственный',
      'Теги', 'Создана', 'Обновлена',
    ]
    const rows = tableDeals.map(d => {
      const stage = activeStages.find(s => s.id === d.stage_id)
      const pipeline = pipelines.find(p => p.id === d.pipeline_id)
      const resp = d.responsible ? `${d.responsible.first_name ?? ''} ${d.responsible.last_name ?? ''}`.trim() : ''
      return [
        d.id,
        d.name ?? '',
        d.patient?.full_name ?? '',
        d.patient?.phones?.[0] ?? d.contact_phone ?? '',
        d.patient?.city ?? d.contact_city ?? '',
        pipeline?.name ?? '',
        stage?.name ?? '',
        d.status,
        d.amount ?? '',
        resp,
        (d.tags ?? []).join(', '),
        d.created_at,
        d.updated_at,
      ]
    })
    const csv = [header, ...rows].map(r => r.map(esc).join(';')).join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const today = new Date().toISOString().slice(0, 10)
    const pipelineSlug = (activePipeline?.code || activePipeline?.name || 'crm').replace(/[^a-zа-я0-9_-]+/gi, '_')
    a.href = url
    a.download = `deals_${pipelineSlug}_${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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
    <div className="min-h-screen">
      {/* Header — только действия, без заголовка */}
      <div className="flex items-center justify-end mb-3 flex-wrap gap-2">
        <Link href="/crm/analytics" className="text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
          Аналитика
        </Link>
        <Link href="/settings/pipelines" className="text-sm px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50">
          Настройка этапов
        </Link>

        {/* Кнопка «…» — меню сортировки, автообновления, импорта/экспорта и т. п. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMoreMenuOpen(v => !v)}
            onBlur={() => setTimeout(() => setMoreMenuOpen(false), 150)}
            title="Ещё"
            aria-label="Ещё"
            className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
              moreMenuOpen
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            •••
          </button>
          {moreMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-40 w-64 bg-white border border-gray-200 rounded-md shadow-lg py-1 text-sm"
              onMouseDown={e => e.preventDefault()}
            >
              <MoreMenuItem
                label="Импорт"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 4v12m0 0l-5-5m5 5l5-5M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                onClick={() => { setShowImportModal(true); setMoreMenuOpen(false) }}
              />
              <MoreMenuItem
                label="Экспорт"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20V8m0 0l-5 5m5-5l5 5M4 4h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                onClick={() => { exportDealsCsv(); setMoreMenuOpen(false) }}
              />
              <MoreMenuItem
                label="Внешний вид карточки"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 5h16M4 12h10M4 19h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                onClick={() => { setShowPageFieldsSettings(true); setMoreMenuOpen(false) }}
              />
              <MoreMenuItem
                label="Поиск дублей"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8"/><path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
                onClick={() => { setShowDupesModal(true); setMoreMenuOpen(false) }}
              />
              <MoreMenuItem
                label={bulkMode ? 'Выйти из массовых действий' : 'Массовые действия'}
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.8"/><path d="M14 9l2.5 2.5L22 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                onClick={() => {
                  const next = !bulkMode
                  setBulkMode(next)
                  if (next) setViewMode('table') // массовый выбор — только в таблице
                  else setBulkSelected(new Set())
                  setMoreMenuOpen(false)
                }}
              />

              <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-gray-400 border-t border-gray-100 mt-1">
                Сортировка
              </div>
              {([
                ['updated_at',       'По последнему сообщению'],
                ['stage_entered_at', 'По последнему событию'],
                ['created_at',       'По дате создания'],
                ['name',             'По названию'],
                ['amount',           'По бюджету'],
              ] as [SortField, string][]).map(([f, lbl]) => {
                const active = sortField === f
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => changeSort(f)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 ${
                      active ? 'text-blue-600 font-medium' : 'text-gray-700'
                    }`}
                  >
                    <span>{lbl}</span>
                    <span className="text-xs text-gray-400">
                      {active ? (sortDir === 'asc' ? '↑' : '↓') : '↓'}
                    </span>
                  </button>
                )
              })}

              <div className="border-t border-gray-100 mt-1" />
              <button
                type="button"
                onClick={() => setAutoRefresh(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 text-gray-700"
              >
                <span>Автообновление</span>
                {autoRefresh ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-blue-600">
                    <path d="M4 12l5 5L20 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <span className="text-xs text-gray-400">выкл</span>
                )}
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => openDeal({
            id: '', clinic_id: clinicId ?? '', name: '', patient_id: null,
            pipeline_id: activePipelineId, stage_id: activeStages[0]?.id ?? null,
            stage: activeStages[0]?.code ?? null, funnel: activePipeline?.code ?? 'leads',
            status: 'open', responsible_user_id: null, source_id: null, amount: null,
            preferred_doctor_id: null, appointment_type: null, loss_reason_id: null,
            contact_phone: null, contact_city: null, notes: null, tags: [],
            custom_fields: {},
            stage_entered_at: new Date().toISOString(),
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          } as DealRow)}
          className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white"
        >
          + Сделка
        </button>
      </div>

      {/* Табы воронок (слева) + поиск (по центру) + вид сетка/таблица (справа) */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        {/* Воронки — слева */}
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

        {/* Поиск — по центру (flex-1 + justify-center) */}
        <div className="flex-1 flex justify-center min-w-[220px]">
          <div className="relative w-full max-w-md">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
            >
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
              <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              placeholder="Поиск по сделкам: имя, телефон, тег, город…"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-gray-200 bg-white hover:border-gray-300 focus:border-blue-400 outline-none"
            />
          </div>
        </div>

        {/* Правый блок: переключатель вида + скрытые этапы + KPI конверсии — всё в один ряд */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="inline-flex items-center bg-white border border-gray-200 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              title="Сетка (канбан)"
              aria-label="Сетка"
              className={`px-2.5 py-2 inline-flex items-center justify-center ${
                viewMode === 'kanban'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="4" width="5" height="16" rx="1" stroke="currentColor" strokeWidth="1.8" />
                <rect x="10" y="4" width="5" height="10" rx="1" stroke="currentColor" strokeWidth="1.8" />
                <rect x="17" y="4" width="4" height="13" rx="1" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              title="Таблица"
              aria-label="Таблица"
              className={`px-2.5 py-2 inline-flex items-center justify-center border-l border-gray-200 ${
                viewMode === 'table'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="1" stroke="currentColor" strokeWidth="1.8" />
                <path d="M3 10h18M3 15h18M9 5v14" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          </div>

          {isListCrmAdmin && hiddenTerminalCount > 0 && (
            <button
              type="button"
              onClick={() => setShowTerminal(v => !v)}
              className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border transition-colors ${
                showTerminal
                  ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
              title={showTerminal
                ? 'Скрыть этапы «Успешно реализовано» и «Закрыто»'
                : 'Показать этапы «Успешно реализовано» и «Закрыто»'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                {showTerminal ? (
                  <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7zM9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                ) : (
                  <path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 13.4 13.4M9.9 5.1a9 9 0 0 1 11 6.9 10 10 0 0 1-2.5 3.6M6.6 6.6A10.5 10.5 0 0 0 3 12s3.5 7 9 7a8.7 8.7 0 0 0 4.4-1.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                )}
              </svg>
              {showTerminal ? 'Скрыть закрытые' : `Показать закрытые (${hiddenTerminalCount})`}
            </button>
          )}

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
      </div>

      {/* Kanban / сетка — колонки по этапам с drag&drop */}
      {viewMode === 'kanban' && (
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
                    <DealCard key={d.id} deal={d} onDragStart={(e) => onDragStart(e, d)} onClick={() => openDeal(d)} />
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
      )}

      {/* Таблица — плоский список сделок активной воронки */}
      {viewMode === 'table' && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  {bulkMode && (
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={tableDeals.length > 0 && bulkSelected.size === tableDeals.length}
                        onChange={e => {
                          if (e.target.checked) setBulkSelected(new Set(tableDeals.map(d => d.id)))
                          else setBulkSelected(new Set())
                        }}
                        title="Выбрать все"
                      />
                    </th>
                  )}
                  <th className="text-left px-3 py-2 font-medium">Сделка</th>
                  <th className="text-left px-3 py-2 font-medium">Пациент</th>
                  <th className="text-left px-3 py-2 font-medium">Телефон</th>
                  <th className="text-left px-3 py-2 font-medium">Этап</th>
                  <th className="text-right px-3 py-2 font-medium">Сумма</th>
                  <th className="text-left px-3 py-2 font-medium">Ответственный</th>
                  <th className="text-left px-3 py-2 font-medium">Обновлено</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tableDeals.map(d => {
                  const stage = activeStages.find(s => s.id === d.stage_id)
                  const phone = d.patient?.phones?.[0] ?? d.contact_phone ?? ''
                  const resp = d.responsible
                  const respName = resp ? `${resp.first_name ?? ''} ${resp.last_name ?? ''}`.trim() : ''
                  const isChecked = bulkSelected.has(d.id)
                  return (
                    <tr
                      key={d.id}
                      onClick={() => {
                        if (bulkMode) {
                          setBulkSelected(prev => {
                            const n = new Set(prev)
                            if (n.has(d.id)) n.delete(d.id); else n.add(d.id)
                            return n
                          })
                        } else {
                          openDeal(d)
                        }
                      }}
                      className={`cursor-pointer ${isChecked ? 'bg-blue-50' : 'hover:bg-blue-50/40'}`}
                    >
                      {bulkMode && (
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setBulkSelected(prev => {
                                const n = new Set(prev)
                                if (n.has(d.id)) n.delete(d.id); else n.add(d.id)
                                return n
                              })
                            }}
                          />
                        </td>
                      )}
                      <td className="px-3 py-2 text-gray-900">{d.name || '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{d.patient?.full_name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{phone || '—'}</td>
                      <td className="px-3 py-2">
                        {stage ? (
                          <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border border-gray-200 bg-white">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: stage.color }} />
                            {stage.name}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-900 whitespace-nowrap">
                        {d.amount != null ? `${new Intl.NumberFormat('ru-RU').format(d.amount)} ₸` : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{respName || '—'}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {fmtAge(d.stage_entered_at || d.updated_at)}
                      </td>
                    </tr>
                  )
                })}
                {tableDeals.length === 0 && (
                  <tr>
                    <td colSpan={bulkMode ? 8 : 7} className="px-3 py-8 text-center text-sm text-gray-400">
                      {listSearch ? 'Ничего не найдено' : 'Нет сделок в этой воронке'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Плавающая панель действий для массового режима */}
      {bulkMode && bulkSelected.size > 0 && (
        <BulkActionBar
          count={bulkSelected.size}
          stages={activeStages}
          users={users}
          onCancel={() => { setBulkMode(false); setBulkSelected(new Set()) }}
          onMoveStage={async (stageId) => {
            const ids = Array.from(bulkSelected)
            const { error } = await supabase.from('deals').update({ stage_id: stageId }).in('id', ids)
            if (error) { alert(error.message); return }
            setBulkSelected(new Set())
            load()
          }}
          onAssign={async (userId) => {
            const ids = Array.from(bulkSelected)
            const { error } = await supabase.from('deals').update({ responsible_user_id: userId }).in('id', ids)
            if (error) { alert(error.message); return }
            setBulkSelected(new Set())
            load()
          }}
          onDelete={async () => {
            const ids = Array.from(bulkSelected)
            if (!confirm(`Удалить ${ids.length} сделок? Они пропадут из канбана, но останутся в истории (soft delete).`)) return
            const { error } = await supabase.from('deals')
              .update({ deleted_at: new Date().toISOString() })
              .in('id', ids)
            if (error) { alert(error.message); return }
            setBulkSelected(new Set())
            load()
          }}
        />
      )}

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
          doctors={doctors}
          reasons={reasons}
          apptTypes={apptTypes}
          allTags={Array.from(new Set(deals.flatMap(d => d.tags ?? []))).sort((a, b) => a.localeCompare(b, 'ru'))}
          onClose={() => closeDeal()}
          onSaved={(wasNew) => { if (wasNew) closeDeal(); load() }}
        />
      )}

      {/* Настройки внешнего вида карточки — открываются из меню «…» */}
      {showPageFieldsSettings && clinicId && (
        <DealFieldsSettingsModal
          clinicId={clinicId}
          pipelines={pipelines.map(p => ({ id: p.id, name: p.name }))}
          stages={stages.map(s => ({ id: s.id, name: s.name, pipeline_id: s.pipeline_id }))}
          onClose={() => setShowPageFieldsSettings(false)}
          onSaved={() => setShowPageFieldsSettings(false)}
        />
      )}

      {/* Импорт сделок из CSV */}
      {showImportModal && clinicId && (
        <ImportDealsModal
          clinicId={clinicId}
          pipelineId={activePipelineId}
          defaultStageId={activeStages[0]?.id ?? null}
          onClose={() => setShowImportModal(false)}
          onDone={() => { setShowImportModal(false); load() }}
        />
      )}

      {/* Поиск дублей — группируем сделки с одинаковым телефоном / пациентом */}
      {showDupesModal && (
        <DuplicatesModal
          deals={deals}
          onOpenDeal={(d) => { setShowDupesModal(false); openDeal(d) }}
          onClose={() => setShowDupesModal(false)}
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

// ─── MoreMenuItem ─────────────────────────────────────────────────────────────
// Строка выпадающего меню «…» — иконка + подпись, onMouseDown стоит на
// родителе меню, чтобы не гасить клик от onBlur.

function MoreMenuItem({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
    >
      <span className="text-gray-500">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
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

interface TimelineEvent {
  id: string
  deal_id: string
  kind: string
  actor_id: string | null
  actor_name: string | null
  ref_table: string | null
  ref_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

interface TaskRow {
  id: string
  deal_id: string
  clinic_id: string
  title: string
  description: string | null
  assignee_id: string | null
  due_at: string | null
  status: 'open' | 'done' | 'cancelled'
  created_at: string
  completed_at: string | null
  assignee?: { first_name: string; last_name: string | null } | null
}

interface CommentRow {
  id: string
  deal_id: string
  clinic_id: string
  body: string
  author_id: string | null
  created_at: string
  author?: { first_name: string; last_name: string | null } | null
}

interface MessageRow {
  id: string
  deal_id: string
  clinic_id: string
  direction: 'in' | 'out'
  channel: 'internal' | 'whatsapp' | 'sms' | 'telegram' | 'call_note' | 'email'
  author_id: string | null
  body: string
  attachments: unknown[]
  external_sender: string | null
  read_at: string | null
  created_at: string
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null
  error_text?: string | null
  author?: { first_name: string; last_name: string | null } | null
}

const CHANNEL_LABEL: Record<MessageRow['channel'], string> = {
  internal:  'Внутр.',
  whatsapp:  'WhatsApp',
  sms:       'SMS',
  telegram:  'Telegram',
  call_note: 'Звонок',
  email:     'Email',
}
const CHANNEL_COLOR: Record<MessageRow['channel'], string> = {
  internal:  '#64748b',
  whatsapp:  '#22c55e',
  sms:       '#3b82f6',
  telegram:  '#0ea5e9',
  call_note: '#f59e0b',
  email:     '#8b5cf6',
}

const EVENT_LABEL: Record<string, string> = {
  deal_created:       'Сделка создана',
  stage_changed:      'Этап',
  responsible_changed:'Ответственный',
  comment_added:      'Комментарий',
  task_created:       'Задача',
  task_done:          'Задача выполнена',
  appointment_linked: 'Приём',
  appointment_status: 'Статус приёма',
  charge_added:       'Начисление',
  payment_added:      'Оплата',
  lab_order_created:  'Лаб. заказ',
  field_changed:      'Поле',
  deal_won:           'Сделка выиграна',
  deal_lost:          'Сделка потеряна',
  message_in:         'Входящее',
  message_out:        'Исходящее',
}

// ── Шаблон сообщения «Получить предоплату» ───────────────────────────────
// Меняй текст/ссылку/сумму тут — больше нигде править не нужно.
const PREPAY_REQUEST_MESSAGE = `Жазылуды растау үшін алдын ала төлем қажет — 2 500 тг.

Төлем сілтемесі:
https://pay.kaspi.kz/pay/2xmddltf

Назар аударыңыз:
Бас тартқан жағдайда алдын ала төлем қайтарылмайды.`

const EVENT_COLOR: Record<string, string> = {
  deal_created:       '#64748b',
  stage_changed:      '#3b82f6',
  responsible_changed:'#8b5cf6',
  comment_added:      '#0ea5e9',
  task_created:       '#f59e0b',
  task_done:          '#10b981',
  appointment_linked: '#06b6d4',
  appointment_status: '#06b6d4',
  charge_added:       '#f97316',
  payment_added:      '#16a34a',
  lab_order_created:  '#a855f7',
  field_changed:      '#94a3b8',
  deal_won:           '#16a34a',
  deal_lost:          '#dc2626',
  message_in:         '#0ea5e9',
  message_out:        '#22c55e',
}

function DealModal({
  deal, pipelines, stages, sources, users, doctors, reasons, apptTypes,
  allTags,
  onClose, onSaved,
}: {
  deal: DealRow
  pipelines: Pipeline[]
  stages: Stage[]
  sources: LeadSource[]
  users: UserLite[]
  doctors: DoctorLite[]
  reasons: LossReason[]
  apptTypes: ApptType[]
  allTags: string[]
  onClose: () => void
  onSaved: (wasNew: boolean) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()

  const isNew = !deal.id
  // Счётчик + список непрочитанных по ВСЕМ сделкам клиники
  interface UnreadItem {
    id: string
    deal_id: string
    deal_name: string | null
    body: string
    external_sender: string | null
    created_at: string
  }
  const [totalUnread, setTotalUnread] = useState(0)
  const [unreadItems, setUnreadItems] = useState<UnreadItem[]>([])
  const [showUnreadPopup, setShowUnreadPopup] = useState(false)
  const [unreadSearch, setUnreadSearch] = useState('')
  const [unreadMenuOpen, setUnreadMenuOpen] = useState(false)
  const [unreadSort, setUnreadSort] = useState<'newest' | 'unread' | 'favorites'>('newest')
  const [unreadMuted, setUnreadMuted] = useState(false)
  const [unreadBulkMode, setUnreadBulkMode] = useState(false)
  const [unreadSelected, setUnreadSelected] = useState<Set<string>>(new Set())
  const dealClinicId = deal.clinic_id
  useEffect(() => {
    if (!dealClinicId) return
    const fetchUnread = async () => {
      const { data } = await supabase
        .from('deal_messages')
        .select('id, deal_id, body, external_sender, created_at, deal:deals(name)')
        .eq('clinic_id', dealClinicId)
        .eq('direction', 'in')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(30)
      const items = (data ?? []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        deal_id: m.deal_id as string,
        deal_name: (m.deal as { name?: string | null } | null)?.name ?? null,
        body: m.body as string,
        external_sender: m.external_sender as string | null,
        created_at: m.created_at as string,
      }))
      setUnreadItems(items)
      setTotalUnread(items.length)
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 8000)
    return () => clearInterval(interval)
  }, [dealClinicId, supabase])

  const [form, setForm] = useState<DealRow>({
    ...deal,
    // Старые сделки могут прийти без custom_fields — нормализуем.
    custom_fields: deal.custom_fields ?? {},
  })
  const [saving, setSaving] = useState(false)

  // Кнопка «Сохранить» появляется только при наличии изменений
  const DIRTY_KEYS: (keyof DealRow)[] = [
    'name','patient_id','pipeline_id','stage_id','responsible_user_id',
    'source_id','amount','preferred_doctor_id','appointment_type',
    'loss_reason_id','contact_phone','contact_city','notes','tags','custom_fields',
  ]
  const isDirty = isNew || DIRTY_KEYS.some(k => {
    const a = form[k], b = deal[k]
    return JSON.stringify(a) !== JSON.stringify(b)
  })
  // Доступ к «Хронологии» (аудит-лог событий по сделке) — только у админа.
  const isAdmin = profile?.role?.slug === 'admin'
  const [activeTab, setActiveTab] = useState<'chat' | 'timeline' | 'tasks'>('chat')

  // Конфигурация полей левой колонки (мигр. 057). До загрузки — дефолт,
  // чтобы карточка не «прыгала» при открытии.
  const [fieldConfigs, setFieldConfigs] = useState<DealFieldConfig[]>(DEFAULT_FIELD_CONFIGS)
  const [showFieldsSettings, setShowFieldsSettings] = useState(false)

  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [comments, setComments] = useState<CommentRow[]>([])
  const [messages, setMessages] = useState<MessageRow[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])
  const [search, setSearch] = useState('')
  const [msgDraft, setMsgDraft] = useState('')
  const msgChannel: MessageRow['channel'] = 'whatsapp'
  const [composerMode, setComposerMode] = useState<'chat'|'note'|'task'>('chat')
  const [composerTaskDue, setComposerTaskDue] = useState('')
  const [composerTaskAssignee, setComposerTaskAssignee] = useState('')
  // «Записать на приём» — модалка из /schedule, переиспользованная.
  const [showBookingModal, setShowBookingModal] = useState(false)
  // «Получить предоплату» — отправка шаблона с Kaspi-ссылкой в WhatsApp.
  const [sendingPrepay, setSendingPrepay] = useState(false)
  const [sending, setSending] = useState(false)
  // Статус WhatsApp-интеграции (Green API). null = ещё не проверяли.
  const [waConnected, setWaConnected] = useState<boolean | null>(null)
  // amoCRM-стиль: меню «…» в шапке карточки (удаление и т.п.).
  const [showHeaderMenu, setShowHeaderMenu] = useState(false)
  // Свёрнутый/развёрнутый список этапов под селектом «Воронка».
  const [stagesExpanded, setStagesExpanded] = useState(false)
  // Шаблоны сообщений (редактируются в /settings/message-templates).
  const [templates, setTemplates] = useState<Array<{
    id: string; title: string; body: string; is_favorite: boolean; sort_order: number
  }>>([])
  // Поповер со списком уже имеющихся записей при повторном клике
  // «Записать на приём» (amoCRM-style: не плодим дубликаты вслепую).
  const [showBookingsPopover, setShowBookingsPopover] = useState(false)
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
  const [labOrders, setLabOrders] = useState<Array<{
    id: string; created_at: string; status: string
  }>>([])

  // patient search
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<Array<{ id: string; full_name: string; phones: string[]; birth_date?: string | null; city?: string | null }>>([])

  // comment / task drafts
  const [commentDraft, setCommentDraft] = useState('')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDue, setNewTaskDue] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')

  const loadRelated = useCallback(() => {
    if (isNew || !deal.id) return
    supabase.from('v_deal_timeline')
      .select('*')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => setEvents((data ?? []) as TimelineEvent[]))
    supabase.from('deal_tasks')
      .select('*, assignee:user_profiles!deal_tasks_assignee_id_fkey(first_name,last_name)')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setTasks((data ?? []) as unknown as TaskRow[]))
    supabase.from('deal_comments')
      .select('*, author:user_profiles!deal_comments_author_id_fkey(first_name,last_name)')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setComments((data ?? []) as unknown as CommentRow[]))
    supabase.from('deal_messages')
      .select('*, author:user_profiles!deal_messages_author_id_fkey(first_name,last_name)')
      .eq('deal_id', deal.id)
      .order('created_at', { ascending: true })
      .limit(500)
      .then(({ data }) => {
        setMessages((data ?? []) as unknown as MessageRow[])
        // mark incoming as read
        supabase.rpc('mark_deal_messages_read', { p_deal_id: deal.id }).then(() => {})
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
    // lab orders via visits joined with deal_id
    supabase.from('visits')
      .select('id, lab_orders:lab_orders(id,created_at,status)')
      .eq('deal_id', deal.id)
      .then(({ data }) => {
        const flat: Array<{ id: string; created_at: string; status: string }> = []
        for (const v of (data ?? []) as Array<{ lab_orders: Array<{ id: string; created_at: string; status: string }> | null }>) {
          for (const o of (v.lab_orders ?? [])) flat.push(o)
        }
        flat.sort((a,b) => (b.created_at > a.created_at ? 1 : -1))
        setLabOrders(flat.slice(0, 20))
      })
  }, [deal.id, isNew, supabase])

  useEffect(() => { loadRelated() }, [loadRelated])

  // Realtime: подписка на deal_messages для текущей открытой сделки.
  // Пока модалка открыта — любые INSERT/UPDATE по этой сделке
  // немедленно попадают в список без reload-а страницы.
  useEffect(() => {
    if (isNew || !deal.id) return
    const ch = supabase.channel(`deal-messages:${deal.id}`)
    // Приводим к any: перегрузка .on('postgres_changes', …) требует
    // приватных типов из @supabase/realtime-js, а нам хватит рантайма.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ch as any).on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deal_messages',
        filter: `deal_id=eq.${deal.id}`,
      },
      (payload: { new: MessageRow }) => {
        const row = payload.new
        setMessages(prev => {
          // Дедуп на случай, если строку уже подставил оптимистичный setState
          if (prev.some(m => m.id === row.id)) return prev
          return [...prev, row]
        })
        // Входящее — сразу помечаем прочитанным, т.к. карточка открыта
        if (row.direction === 'in') {
          supabase.rpc('mark_deal_messages_read', { p_deal_id: deal.id }).then(() => {})
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ).on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'deal_messages',
        filter: `deal_id=eq.${deal.id}`,
      },
      (payload: { new: MessageRow }) => {
        const row = payload.new
        setMessages(prev => prev.map(m => (m.id === row.id ? { ...m, ...row } : m)))
      }
    )
    ch.subscribe()

    return () => {
      supabase.removeChannel(ch)
    }
  }, [deal.id, isNew, supabase])

  // Polling fallback для чата в открытой сделке.
  // wss://*.supabase.co часто блокируется VPN/прокси, и realtime-подписка
  // выше не работает. Каждые 5 сек добираем сообщения этой сделки новее
  // max(created_at) из уже загруженных и мержим в state с дедупом по id.
  useEffect(() => {
    if (isNew || !deal.id) return
    let stopped = false
    const id = setInterval(async () => {
      if (stopped) return
      // Определяем «с какого момента» искать новые. Берём max(created_at)
      // из текущего state через функциональный setMessages, чтобы не
      // лопатить deps и не ретриггерить интервал при каждом изменении.
      let since: string | null = null
      setMessages(prev => {
        if (prev.length > 0) {
          since = prev[prev.length - 1].created_at
        }
        return prev
      })
      const query = supabase
        .from('deal_messages')
        .select('*')
        .eq('deal_id', deal.id)
        .order('created_at', { ascending: true })
        .limit(50)
      const { data } = since
        ? await query.gt('created_at', since)
        : await query
      if (stopped || !data || data.length === 0) return
      setMessages(prev => {
        const known = new Set(prev.map(m => m.id))
        const toAdd = (data as MessageRow[]).filter(m => !known.has(m.id))
        if (toAdd.length === 0) return prev
        // Если появилось новое входящее — помечаем прочитанным
        if (toAdd.some(m => m.direction === 'in')) {
          supabase.rpc('mark_deal_messages_read', { p_deal_id: deal.id }).then(() => {})
        }
        return [...prev, ...toAdd]
      })
    }, 5000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [deal.id, isNew, supabase])

  // Загрузка конфигов полей по клинике сделки.
  useEffect(() => {
    const cid = form.clinic_id
    if (!cid) return
    let alive = true
    supabase
      .from('deal_field_configs')
      .select('*')
      .eq('clinic_id', cid)
      .order('sort_order')
      .then(({ data }) => {
        if (!alive) return
        setFieldConfigs(mergeWithDefaults((data ?? []) as DealFieldConfig[]))
      })
    return () => { alive = false }
  }, [form.clinic_id, supabase])

  // Разово спрашиваем статус WA у сервера, чтобы показывать или прятать
  // плашку «WhatsApp ещё не подключён» в композере.
  useEffect(() => {
    let alive = true
    fetch('/api/whatsapp/status', { cache: 'no-store' })
      .then(r => r.json())
      .then((j: { connected?: boolean }) => {
        if (alive) setWaConnected(Boolean(j?.connected))
      })
      .catch(() => { if (alive) setWaConnected(false) })
    return () => { alive = false }
  }, [])

  // Шаблоны сообщений для выпадашки в композере. Редактируются
  // в /settings/message-templates. Грузим один раз при открытии карточки.
  useEffect(() => {
    if (!profile?.clinic_id) return
    let alive = true
    supabase.from('message_templates')
      .select('id,title,body,is_favorite,sort_order')
      .eq('clinic_id', profile.clinic_id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (!alive) return
        setTemplates((data ?? []) as Array<{
          id: string; title: string; body: string; is_favorite: boolean; sort_order: number
        }>)
      })
    return () => { alive = false }
  }, [supabase, profile?.clinic_id])

  useEffect(() => {
    if (!patientSearch || patientSearch.length < 2) { setPatientResults([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('patients').select('id,full_name,phones,birth_date,city')
        .eq('clinic_id', profile?.clinic_id ?? '')
        .or(`full_name.ilike.%${patientSearch}%,phones.cs.{${patientSearch}}`)
        .limit(10)
      setPatientResults((data ?? []) as Array<{ id: string; full_name: string; phones: string[]; birth_date?: string | null; city?: string | null }>)
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch, supabase, profile?.clinic_id])

  // Только активные этапы текущей воронки — если менеджер снял галку
  // «Активен» в /settings/pipelines, этап исчезает из карточки сделки.
  const pipelineStages = stages
    .filter(s => s.pipeline_id === form.pipeline_id && s.is_active)
    .sort((a,b) => a.sort_order - b.sort_order)

  // Fallback-палитра в стиле amoCRM для старых этапов, у которых
  // в БД остался дефолтный серый #94a3b8 и ещё никто не перекрасил.
  const STAGE_NAME_COLORS: Record<string, string> = {
    'В работе':              '#3B82F6',
    'Касание':               '#A78BFA',
    'Записан':               '#A3E635',
    'Успешно реализовано':   '#22C55E',
    'Отказ':                 '#F87171',
    'Закрыто':               '#9CA3AF',
  }
  function stageColor(s?: { name?: string; color?: string } | null): string {
    if (!s) return '#94a3b8'
    if (s.color && s.color !== '#94a3b8') return s.color
    return STAGE_NAME_COLORS[s.name ?? ''] ?? '#94a3b8'
  }

  const currentStage = stages.find(s => s.id === form.stage_id)
  const isLostStage = currentStage?.stage_role === 'lost'

  async function save() {
    if (!form.pipeline_id || !form.stage_id) { alert('Выберите воронку и этап'); return }
    // If stage is 'lost' and no reason — prompt
    if (isLostStage && !form.loss_reason_id) {
      alert('Укажите причину отказа — этап помечен как «потеря».')
      return
    }

    // Валидация обязательных полей по конфигу.
    const formAsRecord = form as unknown as Record<string, unknown>
    const customFieldsObj = (form.custom_fields ?? {}) as Record<string, unknown>
    const { missing, blocking } = validateRequiredFields(
      fieldConfigs, formAsRecord, customFieldsObj, form.stage_id,
    )
    if (blocking.length > 0) {
      alert(
        'Нельзя сохранить: не заполнены обязательные поля с блокировкой — '
        + blocking.map(c => fieldDisplayLabel(c)).join(', ')
      )
      return
    }
    if (missing.length > 0) {
      const ok = confirm(
        'Не заполнены обязательные поля: '
        + missing.map(c => fieldDisplayLabel(c)).join(', ')
        + '\n\nСохранить всё равно?'
      )
      if (!ok) return
    }

    setSaving(true)
    const payload = {
      clinic_id: form.clinic_id,
      name: form.name?.trim() || null,
      patient_id: form.patient_id,
      pipeline_id: form.pipeline_id,
      stage_id: form.stage_id,
      funnel: pipelines.find(p => p.id === form.pipeline_id)?.code ?? form.funnel ?? 'leads',
      stage:  stages.find(s => s.id === form.stage_id)?.code ?? form.stage ?? 'new',
      responsible_user_id: form.responsible_user_id,
      source_id: form.source_id,
      amount: form.amount,
      preferred_doctor_id: form.preferred_doctor_id,
      appointment_type: form.appointment_type,
      loss_reason_id: form.loss_reason_id,
      contact_phone: form.contact_phone?.trim() || null,
      contact_city: form.contact_city?.trim() || null,
      notes: form.notes?.trim() || null,
      tags: form.tags ?? [],
      custom_fields: form.custom_fields ?? {},
    }
    const { error } = isNew
      ? await supabase.from('deals').insert(payload)
      : await supabase.from('deals').update(payload).eq('id', form.id)
    setSaving(false)
    if (error) { alert('Ошибка: ' + error.message); return }
    onSaved(isNew)
  }

  async function removeDeal() {
    if (isNew) return
    if (!confirm('Удалить сделку? Она будет помечена удалённой (deleted_at).')) return
    const { error } = await supabase.from('deals').update({ deleted_at: new Date().toISOString() }).eq('id', form.id)
    if (error) { alert(error.message); return }
    onSaved(true) // удаление — закрываем модалку
  }

  async function addComment() {
    const body = commentDraft.trim()
    if (!body || isNew) return
    const { error } = await supabase.from('deal_comments').insert({
      deal_id: form.id,
      clinic_id: form.clinic_id,
      body,
      author_id: profile?.id ?? null,
    })
    if (error) { alert(error.message); return }
    setCommentDraft('')
    loadRelated()
  }

  async function sendMessage() {
    const body = msgDraft.trim()
    if (!body || isNew || sending) return
    // Оптимистично очищаем черновик сразу — не ждём ответа API
    setMsgDraft('')
    setSending(true)
    try {
      // API-роут: инсёртит + дергает Green-API и проставляет статус
      const res = await fetch(`/api/deals/${form.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, channel: msgChannel }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { alert(json.error ?? 'Не удалось отправить'); setMsgDraft(body); return }
      // Дедуп по id: если Realtime позже принесёт ту же строку, выкинет её.
      const m = json.message as MessageRow | undefined
      if (m) {
        setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      }
    } finally {
      setSending(false)
    }
  }

  async function sendPrepayRequest() {
    if (isNew || sendingPrepay) return
    const ok = confirm('Отправить клиенту ссылку на предоплату в WhatsApp?')
    if (!ok) return
    setSendingPrepay(true)
    try {
      const res = await fetch(`/api/deals/${form.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: PREPAY_REQUEST_MESSAGE, channel: 'whatsapp' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { alert(json.error ?? 'Не удалось отправить'); return }
      const m = json.message as MessageRow | undefined
      if (m) {
        setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      }
    } finally {
      setSendingPrepay(false)
    }
  }

  async function submitComposer() {
    const body = msgDraft.trim()
    if (!body || isNew || sending) return

    if (composerMode === 'chat') {
      await sendMessage()
      return
    }
    setSending(true)
    try {
      if (composerMode === 'note') {
        // Примечание — внутреннее сообщение (channel='internal'), клиенту не уходит.
        setMsgDraft('')
        const res = await fetch(`/api/deals/${form.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, channel: 'internal' }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) { alert(json.error ?? 'Не удалось сохранить примечание'); setMsgDraft(body); return }
        const m = json.message as MessageRow | undefined
        if (m) {
          setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
        }
        return
      }
      if (composerMode === 'task') {
        setMsgDraft('')
        const { error } = await supabase.from('deal_tasks').insert({
          deal_id: form.id,
          clinic_id: form.clinic_id,
          title: body,
          due_at: composerTaskDue ? new Date(composerTaskDue).toISOString() : null,
          assignee_id: composerTaskAssignee || profile?.id || null,
          created_by: profile?.id ?? null,
        })
        if (error) { alert(error.message); setMsgDraft(body); return }
        setComposerTaskDue(''); setComposerTaskAssignee('')
        loadRelated()
        return
      }
    } finally {
      setSending(false)
    }
  }

  async function addTask() {
    const title = newTaskTitle.trim()
    if (!title || isNew) return
    const { error } = await supabase.from('deal_tasks').insert({
      deal_id: form.id,
      clinic_id: form.clinic_id,
      title,
      due_at: newTaskDue ? new Date(newTaskDue).toISOString() : null,
      assignee_id: newTaskAssignee || null,
      created_by: profile?.id ?? null,
    })
    if (error) { alert(error.message); return }
    setNewTaskTitle(''); setNewTaskDue(''); setNewTaskAssignee('')
    loadRelated()
  }

  async function toggleTask(t: TaskRow) {
    const next: TaskRow['status'] = t.status === 'done' ? 'open' : 'done'
    const { error } = await supabase.from('deal_tasks').update({
      status: next,
      completed_at: next === 'done' ? new Date().toISOString() : null,
      completed_by: next === 'done' ? profile?.id ?? null : null,
    }).eq('id', t.id)
    if (error) { alert(error.message); return }
    loadRelated()
  }

  async function deleteTask(t: TaskRow) {
    if (!confirm(`Удалить задачу «${t.title}»?`)) return
    const { error } = await supabase.from('deal_tasks').delete().eq('id', t.id)
    if (error) { alert(error.message); return }
    loadRelated()
  }

  function onStageClick(stageId: string) {
    const target = stages.find(s => s.id === stageId)
    if (!target) return

    // Блокировка перехода на этап с пустыми обязательными полями.
    const formAsRecord = form as unknown as Record<string, unknown>
    const customFields = (form.custom_fields ?? {}) as Record<string, unknown>
    const { blocking } = validateRequiredFields(fieldConfigs, formAsRecord, customFields, stageId)
    if (blocking.length > 0) {
      const names = blocking.map(c => fieldDisplayLabel(c)).join(', ')
      alert(
        `Нельзя перейти в этап «${target.name}»: не заполнены обязательные поля — ${names}.`
      )
      return
    }

    // moving into lost — ensure reason exists
    if (target.stage_role === 'lost' && !form.loss_reason_id && reasons.length > 0) {
      setForm({ ...form, stage_id: stageId, loss_reason_id: reasons[0].id })
      return
    }
    setForm({ ...form, stage_id: stageId })
  }

  function renderEventBody(e: TimelineEvent): string {
    const p = e.payload || {}
    switch (e.kind) {
      case 'stage_changed':
        return `${p.from ?? '—'} → ${p.to ?? '—'}`
      case 'comment_added':
        return String(p.preview ?? '')
      case 'task_created':
        return String(p.title ?? '')
      case 'task_done':
        return String(p.title ?? '')
      case 'appointment_linked':
        return `${p.date ?? ''} ${p.time_start ?? ''} · ${p.status ?? ''}`
      case 'appointment_status':
        return `${p.from ?? ''} → ${p.to ?? ''}`
      case 'charge_added':
        return `${Number(p.total ?? 0).toLocaleString('ru-RU')} ₸ · ${p.status ?? ''}`
      case 'payment_added':
        return `${Number(p.amount ?? 0).toLocaleString('ru-RU')} ₸ · ${p.type ?? ''} / ${p.method ?? ''}`
      case 'lab_order_created':
        return String(p.status ?? '')
      case 'field_changed':
        return `${p.field}: ${JSON.stringify(p.from)} → ${JSON.stringify(p.to)}`
      case 'deal_created':
        return String(p.name ?? '')
      case 'message_in':
      case 'message_out': {
        const ch = String(p.channel ?? '')
        const preview = String(p.preview ?? '')
        return `${ch ? `[${ch}] ` : ''}${preview}`
      }
      default:
        return ''
    }
  }

  const openTasksCount = tasks.filter(t => t.status === 'open').length

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch" onClick={onClose}>
      <div
        className="bg-gray-50 shadow-2xl w-full max-w-6xl ml-auto flex flex-col h-full overflow-hidden relative"
        onClick={e => e.stopPropagation()}
      >
        {/* Боковая панель непрочитанных — выезжает слева */}
        {showUnreadPopup && (
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white border-r border-gray-200 shadow-xl z-40 flex flex-col">
            {/* Шапка */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
              <span className="text-sm font-semibold text-gray-800">Непрочитанные {totalUnread > 0 && <span className="ml-1 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">{totalUnread}</span>}</span>
              <button onClick={() => setShowUnreadPopup(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            {/* Поиск + меню */}
            <div className="px-3 py-2 border-b border-gray-100 shrink-0 flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  value={unreadSearch}
                  onChange={e => setUnreadSearch(e.target.value)}
                  placeholder="Поиск…"
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md outline-none focus:border-blue-400"
                />
              </div>
              {/* Меню сортировки */}
              <div className="relative shrink-0">
                <button
                  onClick={() => setUnreadMenuOpen(v => !v)}
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
                  title="Ещё"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
                  </svg>
                </button>
                {unreadMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 text-xs">
                    {/* Действия */}
                    <button onClick={() => { setUnreadBulkMode(v => !v); setUnreadMenuOpen(false) }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2.5 text-gray-700">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.8"/><rect x="3" y="10" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.8"/><rect x="3" y="15" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.8"/><path d="M10 7h11M10 12h11M10 17h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                      Массовые действия
                    </button>
                    <button onClick={() => { setUnreadMuted(v => !v); setUnreadMenuOpen(false) }}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2.5 text-gray-700">
                      {unreadMuted
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M23 9l-6 6M17 9l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                        : <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                      }
                      {unreadMuted ? 'Включить звук' : 'Отключить звук'}
                    </button>
                    <div className="my-1 border-t border-gray-100" />
                    {/* Сортировка */}
                    <div className="px-3 py-1.5 text-gray-400 text-[10px] uppercase tracking-wider">Сортировка</div>
                    {(['newest','unread','favorites'] as const).map(opt => (
                      <button key={opt}
                        onClick={() => { setUnreadSort(opt); setUnreadMenuOpen(false) }}
                        className={`w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2 ${unreadSort === opt ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
                      >
                        {unreadSort === opt && <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        {opt === 'newest' ? 'Сначала новые' : opt === 'unread' ? 'Сначала непрочитанные' : 'Избранные'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Панель массовых действий */}
            {unreadBulkMode && (
              <div className="px-3 py-2 border-b border-gray-200 bg-white shrink-0">
                <div className="flex items-center gap-1.5">
                  {/* Прочитать */}
                  <button
                    disabled={unreadSelected.size === 0}
                    onClick={async () => {
                      await supabase.from('deal_messages')
                        .update({ read_at: new Date().toISOString() })
                        .in('id', Array.from(unreadSelected))
                      setUnreadSelected(new Set())
                      setUnreadBulkMode(false)
                    }}
                    className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Прочитать
                  </button>
                  {/* Удалить */}
                  <button
                    disabled={unreadSelected.size === 0}
                    onClick={async () => {
                      if (!confirm(`Удалить ${unreadSelected.size} сообщений?`)) return
                      await supabase.from('deal_messages')
                        .delete()
                        .in('id', Array.from(unreadSelected))
                      setUnreadSelected(new Set())
                      setUnreadBulkMode(false)
                    }}
                    className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-gray-200 text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    Удалить
                  </button>
                  <div className="flex-1" />
                  {/* × — выход из bulk-режима */}
                  <button
                    onClick={() => { setUnreadSelected(new Set()); setUnreadBulkMode(false) }}
                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-base leading-none"
                    title="Отмена"
                  >×</button>
                  {/* □ — выбрать всё / снять выбор */}
                  {(() => {
                    const allIds = unreadItems.map(m => m.id)
                    const allSelected = allIds.length > 0 && allIds.every(id => unreadSelected.has(id))
                    return (
                      <button
                        onClick={() => {
                          if (allSelected) {
                            setUnreadSelected(new Set())
                          } else {
                            setUnreadSelected(new Set(allIds))
                          }
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500"
                        title={allSelected ? 'Снять выбор' : 'Выбрать все'}
                      >
                        {allSelected
                          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" fill="currentColor" className="text-blue-500"/><path d="M8 12l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/></svg>
                        }
                      </button>
                    )
                  })()}
                </div>
                {unreadSelected.size > 0 && (
                  <div className="mt-1 text-[10px] text-gray-400">{unreadSelected.size} выбрано</div>
                )}
              </div>
            )}

            {/* Список */}
            {unreadItems.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Всё прочитано</div>
            ) : (
              <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
                {unreadItems
                  .filter(m => !unreadSearch || (m.deal_name ?? '').toLowerCase().includes(unreadSearch.toLowerCase()) || m.body.toLowerCase().includes(unreadSearch.toLowerCase()) || (m.external_sender ?? '').toLowerCase().includes(unreadSearch.toLowerCase()))
                  .map(m => {
                    const isSelected = unreadSelected.has(m.id)
                    return (
                  <li key={m.id}
                    className={`px-3 py-3 hover:bg-blue-50 cursor-pointer transition-colors flex items-start gap-2 ${isSelected ? 'bg-blue-50' : ''}`}
                    onClick={() => {
                      if (unreadBulkMode) {
                        setUnreadSelected(prev => { const n = new Set(prev); n.has(m.id) ? n.delete(m.id) : n.add(m.id); return n })
                      } else {
                        setShowUnreadPopup(false); onSaved(false)
                      }
                    }}>
                    {unreadBulkMode && (
                      <input type="checkbox" checked={isSelected} readOnly className="mt-0.5 shrink-0 accent-blue-600" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-gray-900 truncate">
                          {m.deal_name ?? `#${m.deal_id.slice(0, 8)}`}
                        </span>
                        <span className="text-[10px] text-gray-400 shrink-0">
                          {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {m.external_sender && <span className="text-gray-400 mr-1">{m.external_sender}:</span>}
                        {m.body}
                      </div>
                    </div>
                  </li>
                    )
                  })}
              </ul>
            )}
          </div>
        )}
        {/* Header */}
        <div className="px-6 py-3 bg-white border-b border-gray-200 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-400 uppercase tracking-wider">Сделка</div>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap">
              <input
                type="text"
                value={form.name ?? ''}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={form.patient?.full_name || 'Новая сделка'}
                className="text-lg font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none min-w-[260px]"
              />
              {/* Селектор этапа удалён — этапы теперь живут в левой колонке
                 под селектом «Воронка» (см. рендер pipeline ниже).
                 Плашка статуса (open/won/lost/closed) скрыта по запросу. */}
            </div>
          </div>

          {/* Поиск по чату/хронологии */}
          {!isNew && (
            <div className="relative w-72 shrink-0">
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по чату и хронологии…"
                className="w-full border border-gray-200 rounded-md pl-8 pr-3 py-1.5 text-sm focus:border-blue-400 outline-none"
              />
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            </div>
          )}

          {/* «…» меню — в стиле amoCRM. Удаление и прочие редкие действия. */}
          {!isNew && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowHeaderMenu(v => !v)}
                onBlur={() => setTimeout(() => setShowHeaderMenu(false), 150)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2 h-8 flex items-center"
                title="Действия"
                aria-label="Действия"
              >
                ⋯
              </button>
              {showHeaderMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg z-10 py-1">
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowHeaderMenu(false); setShowFieldsSettings(true) }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  >
                    ⚙ Настройки полей
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    type="button"
                    onMouseDown={e => { e.preventDefault(); setShowHeaderMenu(false); removeDeal() }}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  >
                    🗑 Удалить сделку
                  </button>
                </div>
              )}
            </div>
          )}

          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2">×</button>
        </div>

        {/* Body: 2 columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT: properties */}
          <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
            <div className="p-5 space-y-4 text-sm">
              {(() => {
                // Карта рендереров встроенных полей (ключи совпадают с DEFAULT_FIELD_CONFIGS).
                // Render-функции замыкают form/setForm и не зависят от порядка.
                const customFields = (form.custom_fields ?? {}) as Record<string, unknown>
                const setCustom = (key: string, value: unknown) => {
                  const next = { ...customFields, [key]: value }
                  setForm({ ...form, custom_fields: next })
                }
                const reqFor = (k: string) => isFieldRequired(fieldConfigs, k, form.stage_id)

                const builtinRenderers: Record<string, () => React.ReactNode> = {
                  pipeline: () => {
                    // Единый кастом-дроп в стиле amoCRM: закрытый — цветной чип
                    // активного этапа, открытый — сгруппированный список всех
                    // воронок; каждая воронка = серый заголовок с именем +
                    // цветные ряды этапов. Клик по этапу ставит pipeline_id
                    // + stage_id одним движением.
                    const activeStage = pipelineStages.find(s => s.id === form.stage_id) ?? pipelineStages[0]
                    const activeColor = stageColor(activeStage)
                    return (
                      <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'pipeline')!) || 'Воронка'} required={reqFor('pipeline')}>
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setStagesExpanded(v => !v)}
                            onBlur={() => setTimeout(() => setStagesExpanded(false), 150)}
                            style={activeStage ? { background: activeColor, borderColor: activeColor } : undefined}
                            className={
                              activeStage
                                ? 'w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-white rounded px-2.5 py-1.5 border hover:opacity-90 transition'
                                : 'w-full flex items-center justify-between text-sm text-gray-500 rounded px-2.5 py-1.5 border border-gray-200 bg-white hover:bg-gray-50 transition'
                            }
                          >
                            <span>{activeStage?.name ?? '— выберите этап —'}</span>
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 12 12"
                              className={`transition-transform ${stagesExpanded ? 'rotate-180' : ''}`}
                            >
                              <path
                                d="M3 5l3 3 3-3"
                                stroke={activeStage ? 'white' : '#6b7280'}
                                strokeWidth="1.8"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>

                          {stagesExpanded && (
                            <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-md border border-gray-200 bg-white shadow-lg py-1 max-h-[360px] overflow-y-auto">
                              {pipelines.map(p => {
                                // Только активные этапы — если менеджер снял галку
                                // «Активен» в /settings/pipelines, этап исчезает
                                // из комбинированного выпадающего списка воронки.
                                const pStages = stages
                                  .filter(s => s.pipeline_id === p.id && s.is_active)
                                  .sort((a, b) => a.sort_order - b.sort_order)
                                return (
                                  <div key={p.id} className="py-1">
                                    <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                                      {p.name}
                                    </div>
                                    {pStages.map(s => {
                                      const active = s.id === form.stage_id
                                      const color = stageColor(s)
                                      return (
                                        <button
                                          key={s.id}
                                          type="button"
                                          onMouseDown={e => {
                                            e.preventDefault()
                                            // Смена воронки: одним кликом ставим pipeline_id + stage_id.
                                            if (s.pipeline_id !== form.pipeline_id) {
                                              setForm({ ...form, pipeline_id: s.pipeline_id, stage_id: s.id })
                                            } else {
                                              onStageClick(s.id)
                                            }
                                            setStagesExpanded(false)
                                          }}
                                          style={{ background: color }}
                                          className="w-full flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-white px-3 py-2 hover:opacity-90 transition"
                                        >
                                          <span>{s.name}</span>
                                          {active && (
                                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                              <path d="M2 6l3 3 5-6" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                          )}
                                        </button>
                                      )
                                    })}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </Field>
                    )
                  },
                  responsible: () => (
                    <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'responsible')!) || 'Ответственный'} required={reqFor('responsible')}>
                      <select
                        value={form.responsible_user_id ?? ''}
                        onChange={e => setForm({ ...form, responsible_user_id: e.target.value || null })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white hover:border-gray-300"
                      >
                        <option value="">— не назначен —</option>
                        {users.map(u => (
                          <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''}</option>
                        ))}
                      </select>
                    </Field>
                  ),
                  source: () => (
                    <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'source')!) || 'Источник'} required={reqFor('source')}>
                      <select
                        value={form.source_id ?? ''}
                        onChange={e => setForm({ ...form, source_id: e.target.value || null })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white hover:border-gray-300"
                      >
                        <option value="">— не задан —</option>
                        {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                  ),
                  doctor: () => (
                    <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'doctor')!) || 'Врач'} required={reqFor('doctor')}>
                      <select
                        value={form.preferred_doctor_id ?? ''}
                        onChange={e => setForm({ ...form, preferred_doctor_id: e.target.value || null })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white hover:border-gray-300"
                      >
                        <option value="">— не назначен —</option>
                        {doctors.map(d => (
                          <option key={d.id} value={d.id}>{d.first_name} {d.last_name ?? ''}</option>
                        ))}
                      </select>
                    </Field>
                  ),
                  comment: () => (
                    <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'comment')!) || 'Комментарий'} required={reqFor('comment')}>
                      <textarea
                        value={form.notes ?? ''}
                        onChange={e => setForm({ ...form, notes: e.target.value })}
                        rows={3}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                        placeholder="Внутренние заметки менеджера…"
                      />
                    </Field>
                  ),
                  tags: () => (
                    <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'tags')!) || 'Теги'} required={reqFor('tags')}>
                      <TagEditor
                        tags={form.tags ?? []}
                        allTags={allTags}
                        onChange={(tags) => setForm({ ...form, tags })}
                      />
                    </Field>
                  ),
                  patient: () => (
                    <div className="pt-3 border-t border-gray-100">
                      <label className="block text-xs text-gray-500 mb-1.5">
                        {fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'patient')!) || 'Пациент'}
                        {reqFor('patient') && <span className="text-red-500 ml-0.5">*</span>}
                      </label>
                      {form.patient ? (
                        <div className="border border-gray-200 rounded-md p-2.5 bg-gray-50">
                          <div className="font-medium text-gray-900">{form.patient.full_name}</div>
                          <div className="text-xs text-gray-500 mt-0.5">{form.patient.phones?.[0] || form.contact_phone || '— нет телефона —'}</div>
                          {(form.patient.birth_date || form.patient.city) && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              {form.patient.birth_date && <>ДР: {form.patient.birth_date}</>}
                              {form.patient.city && <span className="ml-2">· {form.patient.city}</span>}
                            </div>
                          )}
                          <div className="flex gap-3 mt-2 text-xs">
                            <Link href={`/patients/${form.patient.id}`} className="text-blue-600 hover:underline">
                              → карточка
                            </Link>
                            <button
                              onClick={() => setForm({ ...form, patient_id: null, patient: null })}
                              className="text-red-600 hover:underline"
                            >
                              Открепить
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <input
                            type="text" value={patientSearch}
                            onChange={e => setPatientSearch(e.target.value)}
                            placeholder="Поиск по имени или телефону…"
                            className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                          />
                          {patientResults.length > 0 && (
                            <div className="mt-1 border border-gray-200 rounded max-h-48 overflow-y-auto bg-white shadow-sm">
                              {patientResults.map(p => (
                                <button key={p.id} onClick={() => {
                                  setForm({ ...form, patient_id: p.id, patient: p })
                                  setPatientSearch(''); setPatientResults([])
                                }} className="w-full text-left px-2 py-1.5 hover:bg-blue-50 text-sm">
                                  <div>{p.full_name}</div>
                                  <div className="text-xs text-gray-500">{p.phones?.[0]}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ),
                  contact_phone: () => (
                    !form.patient ? (
                      <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'contact_phone')!) || 'Телефон контакта'} required={reqFor('contact_phone')}>
                        <input type="tel" value={form.contact_phone ?? ''}
                          onChange={e => setForm({ ...form, contact_phone: e.target.value })}
                          placeholder="Телефон контакта"
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                        />
                      </Field>
                    ) : null
                  ),
                  contact_city: () => (
                    !form.patient ? (
                      <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'contact_city')!) || 'Город'} required={reqFor('contact_city')}>
                        <input type="text" value={form.contact_city ?? ''}
                          onChange={e => setForm({ ...form, contact_city: e.target.value })}
                          placeholder="Город"
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                        />
                      </Field>
                    ) : null
                  ),
                }

                function renderCustom(cfg: DealFieldConfig) {
                  const value = customFields[cfg.field_key]
                  const required = isFieldRequired(fieldConfigs, cfg.field_key, form.stage_id)
                  const label = fieldDisplayLabel(cfg)
                  switch (cfg.field_type) {
                    case 'number':
                      return (
                        <Field key={cfg.field_key} label={label} required={required}>
                          <input
                            type="number"
                            value={value == null ? '' : String(value)}
                            onChange={e => setCustom(cfg.field_key, e.target.value === '' ? null : Number(e.target.value))}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                          />
                        </Field>
                      )
                    case 'date':
                      return (
                        <Field key={cfg.field_key} label={label} required={required}>
                          <input
                            type="date"
                            value={typeof value === 'string' ? value : ''}
                            onChange={e => setCustom(cfg.field_key, e.target.value || null)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                          />
                        </Field>
                      )
                    case 'phone':
                      return (
                        <Field key={cfg.field_key} label={label} required={required}>
                          <input
                            type="tel"
                            value={typeof value === 'string' ? value : ''}
                            onChange={e => setCustom(cfg.field_key, e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                          />
                        </Field>
                      )
                    case 'textarea':
                      return (
                        <Field key={cfg.field_key} label={label} required={required}>
                          <textarea
                            value={typeof value === 'string' ? value : ''}
                            onChange={e => setCustom(cfg.field_key, e.target.value)}
                            rows={3}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                          />
                        </Field>
                      )
                    case 'select':
                      return (
                        <Field key={cfg.field_key} label={label} required={required}>
                          <select
                            value={typeof value === 'string' ? value : ''}
                            onChange={e => setCustom(cfg.field_key, e.target.value || null)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 bg-white hover:border-gray-300"
                          >
                            <option value="">— не задано —</option>
                            {cfg.options.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </Field>
                      )
                    case 'text':
                    default:
                      return (
                        <Field key={cfg.field_key} label={label} required={required}>
                          <input
                            type="text"
                            value={typeof value === 'string' ? value : ''}
                            onChange={e => setCustom(cfg.field_key, e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 hover:border-gray-300"
                          />
                        </Field>
                      )
                  }
                }

                return (
                  <>
                    {/* Теги — выносим в самый верх карточки без подписи «Теги»,
                        как в amoCRM: пустое состояние — серая pill-плашка
                        «#ТЕГИРОВАТЬ», с тегами — серые чипы в ряд. */}
                    {fieldConfigs.find(c => c.field_key === 'tags')?.is_visible !== false && (
                      <div className="-mx-1">
                        <TagEditor
                          tags={form.tags ?? []}
                          allTags={allTags}
                          onChange={(tags) => setForm({ ...form, tags })}
                        />
                      </div>
                    )}

                    {fieldConfigs.map(cfg => {
                      if (!cfg.is_visible) return null
                      // tags отрендерены выше, отдельно от общего списка.
                      if (cfg.field_key === 'tags') return null
                      if (cfg.is_builtin) {
                        const fn = builtinRenderers[cfg.field_key]
                        if (!fn) return null
                        const node = fn()
                        return node ? <div key={cfg.field_key}>{node}</div> : null
                      }
                      return renderCustom(cfg)
                    })}

                    {/* Причина отказа — динамическая, всегда вне основного списка
                        (нужна только когда этап имеет роль 'lost'). */}
                    {isLostStage && (
                      <Field label="Причина отказа" required>
                        <select
                          value={form.loss_reason_id ?? ''}
                          onChange={e => setForm({ ...form, loss_reason_id: e.target.value || null })}
                          className="w-full border border-red-300 rounded px-2 py-1.5 bg-white"
                        >
                          <option value="">— выберите —</option>
                          {reasons.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                      </Field>
                    )}
                  </>
                )
              })()}

              {!isNew && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Этап</span>
                    <span className="flex items-center gap-1.5">
                      {currentStage && (
                        <span className="w-2 h-2 rounded-full" style={{ background: stageColor(currentStage) }} />
                      )}
                      <span className="font-medium text-gray-900">{currentStage?.name ?? '—'}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">В этапе</span>
                    <span className="font-medium text-gray-900">{fmtAge(form.stage_entered_at)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Создано</span>
                    <span className="font-medium text-gray-900">
                      {new Date(form.created_at).toLocaleDateString('ru-RU')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: feed
             * flex-col layout: верхний блок (KPI / приёмы / лабы) — shrink-0 и
             * скроллится сам, если разрастётся; tabs-карточка занимает всё
             * оставшееся место по высоте, чтобы композер всегда был у футера. */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs + чат: растягиваемся на оставшуюся высоту, композер прилипает к низу */}
            <div className="flex-1 min-h-0 p-5 pt-4 flex flex-col overflow-hidden">
              {/* Tabs: chat / timeline / tasks */}
              {!isNew && (
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
                  <div className="flex border-b border-gray-100 flex-shrink-0">
                    <button
                      onClick={() => setActiveTab('chat')}
                      className={`px-4 py-2.5 text-sm font-medium ${
                        activeTab === 'chat' ? 'text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Чат {messages.filter(m => m.direction === 'in' && !m.read_at).length > 0 && (
                        <span className="ml-1 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                          {messages.filter(m => m.direction === 'in' && !m.read_at).length}
                        </span>
                      )}
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => setActiveTab('timeline')}
                        className={`px-4 py-2.5 text-sm font-medium ${
                          activeTab === 'timeline' ? 'text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        Хронология
                      </button>
                    )}
                    <button
                      onClick={() => setActiveTab('tasks')}
                      className={`px-4 py-2.5 text-sm font-medium ${
                        activeTab === 'tasks' ? 'text-blue-700 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      Задачи {openTasksCount > 0 && <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">{openTasksCount}</span>}
                    </button>
                  </div>

                  {activeTab === 'chat' && (
                    <div className="flex flex-col flex-1 min-h-0">
                      {/* Messages list */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
                        {(() => {
                          const q = search.toLowerCase()
                          // Системные события (кроме дублирующих message_in/out)
                          const SKIP_KINDS = new Set(['message_in', 'message_out'])
                          const evItems = events
                            .filter(e => !SKIP_KINDS.has(e.kind))
                            .filter(e => !q || (EVENT_LABEL[e.kind] ?? e.kind).toLowerCase().includes(q) || renderEventBody(e).toLowerCase().includes(q))
                            .map(e => ({ type: 'event' as const, ts: e.created_at, e }))
                          const msgItems = messages
                            .filter(m => !q || m.body.toLowerCase().includes(q))
                            .map(m => ({ type: 'msg' as const, ts: m.created_at, m }))
                          const combined = [...evItems, ...msgItems].sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)

                          if (combined.length === 0) {
                            return (
                              <div className="text-sm text-gray-400 py-8 text-center">
                                {search ? 'Ничего не найдено' : 'Пока нет сообщений'}
                              </div>
                            )
                          }
                          return combined.map(item => {
                            // Системное событие — центрированная серая строка
                            if (item.type === 'event') {
                              const e = item.e
                              const label = EVENT_LABEL[e.kind] ?? e.kind
                              const body = renderEventBody(e)
                              return (
                                <div key={`ev-${e.id}`} className="flex items-center gap-2 my-1">
                                  <div className="flex-1 h-px bg-gray-200" />
                                  <div className="text-[11px] text-gray-500 whitespace-nowrap max-w-[80%] text-center">
                                    <span className="font-medium text-gray-700">{label}</span>
                                    {body && <span className="text-gray-500"> — {body}</span>}
                                    {e.actor_name && <span className="text-gray-400"> · {e.actor_name}</span>}
                                    <span className="text-gray-400 ml-1">{new Date(e.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
                                  </div>
                                  <div className="flex-1 h-px bg-gray-200" />
                                </div>
                              )
                            }
                            const m = item.m
                            // Примечание — внутреннее, центрированное, мягкое жёлтое
                            if (m.channel === 'internal') {
                              return (
                                <div key={`msg-${m.id}`} className="flex justify-center">
                                  <div className="max-w-[85%] rounded-md px-3 py-2 text-sm bg-amber-100 text-gray-900">
                                    <div className="flex items-center gap-1.5 mb-0.5 text-[10px] uppercase tracking-wider text-gray-600">
                                      <span>📝 Примечание · только для команды</span>
                                      {m.author && (
                                        <span>· {m.author.first_name} {m.author.last_name?.[0] ?? ''}</span>
                                      )}
                                    </div>
                                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                    <div className="text-[10px] mt-1 text-gray-500">
                                      {new Date(m.created_at).toLocaleString('ru-RU')}
                                    </div>
                                  </div>
                                </div>
                              )
                            }
                            // Обычное сообщение — входящее (серое) / исходящее (синее)
                            return (
                              <div key={`msg-${m.id}`} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                                  m.direction === 'out'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-gray-900'
                                }`}>
                                  <div className={`flex items-center gap-1.5 mb-0.5 text-[10px] uppercase tracking-wider ${m.direction === 'out' ? 'text-blue-100' : 'text-gray-500'}`}>
                                    <span>{CHANNEL_LABEL[m.channel]}</span>
                                    {m.author && (
                                      <span>· {m.author.first_name} {m.author.last_name?.[0] ?? ''}</span>
                                    )}
                                    {m.external_sender && (
                                      <span>· {m.external_sender}</span>
                                    )}
                                  </div>
                                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                  <div className={`text-[10px] mt-1 flex items-center gap-1 ${m.direction === 'out' ? 'text-blue-100' : 'text-gray-500'}`}>
                                    <span>{new Date(m.created_at).toLocaleString('ru-RU')}</span>
                                    {m.direction === 'out' && (
                                      <span title={m.error_text ?? m.status ?? ''}>
                                        {m.status === 'pending'   ? '⏱'   :
                                         m.status === 'sent'      ? '✓'   :
                                         m.status === 'delivered' ? '✓✓'  :
                                         m.status === 'read'      ? '✓✓'  :
                                         m.status === 'failed'    ? '⚠'   : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })
                        })()}
                        <div ref={chatEndRef} />
                      </div>

                      {/* Composer (amoCRM-style: Чат / Примечание / Задача) */}
                      <div className="border-t border-gray-100 bg-white">
                        {/* Mode dropdown + канал слева; кнопки-действия справа (amoCRM-style) */}
                        <div className="flex items-center gap-2 px-3 pt-2 flex-wrap">
                          <ComposerModeDropdown
                            value={composerMode}
                            onChange={setComposerMode}
                          />
                          {composerMode === 'chat' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded bg-slate-100 text-gray-700">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.23 8.23 0 0 1-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.41a8.2 8.2 0 0 1 2.42 5.84c0 4.54-3.7 8.24-8.24 8.24z"/></svg>
                              WhatsApp
                            </span>
                          )}
                          {/* «Шаблоны» — рядом с WhatsApp, amoCRM-style */}
                          {composerMode !== 'task' && (
                            <TemplatesDropdown
                              templates={templates}
                              onPick={(t) => {
                                setMsgDraft(prev => prev ? `${prev}\n${t.body}` : t.body)
                              }}
                            />
                          )}
                          {/* Правая группа: действия по сделке */}
                          {!isNew && (() => {
                            // Активные записи — будущие (с учётом времени начала) и не отменённые.
                            const now = new Date()
                            const todayStr = now.toISOString().slice(0, 10)
                            const cancelledStatuses = new Set(['cancelled', 'canceled', 'no_show', 'отменён', 'отмена'])
                            const upcoming = appointments
                              .filter(a => !cancelledStatuses.has(String(a.status ?? '').toLowerCase()))
                              .filter(a => (a.date ?? '') >= todayStr)
                              .sort((a, b) => {
                                const k = (a.date ?? '').localeCompare(b.date ?? '')
                                return k !== 0 ? k : (a.time_start ?? '').localeCompare(b.time_start ?? '')
                              })
                            const nearest = upcoming[0]
                            const alreadyBooked = upcoming.length > 0
                            const nearestLabel = nearest
                              ? `${nearest.date?.split('-').reverse().slice(0, 2).join('.')} ${String(nearest.time_start ?? '').slice(0, 5)}`
                              : ''
                            return (
                            <div className="ml-auto flex items-center gap-2">
                              <div className="relative">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (alreadyBooked) setShowBookingsPopover(v => !v)
                                    else setShowBookingModal(true)
                                  }}
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                    alreadyBooked
                                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                      : 'bg-blue-600 text-white hover:bg-blue-700'
                                  }`}
                                  title={alreadyBooked
                                    ? `Уже записан: ${nearestLabel}. Нажмите, чтобы увидеть все записи или добавить ещё одну.`
                                    : 'Создать запись в расписании для этой сделки'}
                                >
                                  {alreadyBooked ? (
                                    <>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                                      </svg>
                                      Записан · {nearestLabel}
                                      {upcoming.length > 1 && (
                                        <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-emerald-600 text-white text-[9px]">
                                          {upcoming.length}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                        <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                                        <path d="M16 2v4M8 2v4M3 9h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                      </svg>
                                      Записать на приём
                                    </>
                                  )}
                                </button>

                                {/* Поповер со списком активных записей и кнопкой создания ещё одной */}
                                {showBookingsPopover && alreadyBooked && (
                                  <div
                                    className="absolute right-0 bottom-full mb-1 z-30 w-80 rounded-md border border-gray-200 bg-white shadow-lg"
                                    onMouseLeave={() => setShowBookingsPopover(false)}
                                  >
                                    <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                                      <div className="text-xs font-semibold text-gray-900">
                                        Активные записи ({upcoming.length})
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setShowBookingsPopover(false)}
                                        className="text-gray-400 hover:text-gray-600 text-sm leading-none"
                                      >×</button>
                                    </div>
                                    <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                                      {upcoming.map(a => (
                                        <li key={a.id} className="px-3 py-2 text-xs">
                                          <div className="font-medium text-gray-900">
                                            {a.date?.split('-').reverse().join('.')} · {String(a.time_start ?? '').slice(0, 5)}
                                          </div>
                                          <div className="text-gray-500 mt-0.5">
                                            {a.doctor ? `${a.doctor.first_name} ${a.doctor.last_name ?? ''}` : '— врач не указан —'}
                                            {a.service && <span> · {a.service.name}</span>}
                                          </div>
                                          <div className="text-[10px] text-gray-400 mt-0.5 uppercase tracking-wider">
                                            {a.status}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                    <div className="p-2 border-t border-gray-100 bg-slate-50 flex items-center justify-between gap-2">
                                      <button
                                        type="button"
                                        onClick={() => { setShowBookingsPopover(false); setShowBookingModal(true) }}
                                        className="text-[11px] px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                                      >+ Ещё запись</button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          // Открываем расписание в отдельном браузерном окне,
                                          // чтобы не уходить со сделки. Размер подобран под
                                          // реальную ширину сетки — без пустого поля справа.
                                          // max-w-5xl (1024px) + padding p-2 (16px) ≈ 1060px.
                                          const w = Math.min(1060, window.screen.availWidth - 40)
                                          const h = Math.min(760, window.screen.availHeight - 40)
                                          const left = Math.max(0, Math.round((window.screen.availWidth - w) / 2))
                                          const top = Math.max(0, Math.round((window.screen.availHeight - h) / 2))
                                          window.open(
                                            '/schedule-window',
                                            'inhealth-schedule',
                                            `width=${w},height=${h},left=${left},top=${top},noopener=false`,
                                          )
                                          setShowBookingsPopover(false)
                                        }}
                                        className="text-[11px] text-blue-600 hover:underline"
                                      >Открыть расписание →</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={sendPrepayRequest}
                                disabled={sendingPrepay}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                                title="Отправить клиенту в WhatsApp ссылку на предоплату (Kaspi)"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                  <path d="M12 1v22M5 8h10a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                                {sendingPrepay ? 'Отправляем…' : 'Получить предоплату'}
                              </button>
                            </div>
                            )
                          })()}
                        </div>

                        {/* Task-specific extra fields — amoCRM-style */}
                        {composerMode === 'task' && (
                          <div className="px-3 pt-2 space-y-2 bg-slate-50 border-t border-slate-200">
                            {/* Quick presets */}
                            <div className="flex flex-wrap gap-1">
                              {TASK_DUE_PRESETS.map(p => {
                                const val = p.compute()
                                const active = composerTaskDue === val
                                return (
                                  <button
                                    key={p.label}
                                    type="button"
                                    onClick={() => setComposerTaskDue(val)}
                                    className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                                      active
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-slate-100 border-slate-200 text-gray-700 hover:bg-slate-200'
                                    }`}
                                  >
                                    {p.label}
                                  </button>
                                )
                              })}
                            </div>
                            {/* на дата/время · для исполнитель */}
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-gray-500">на</span>
                              <input
                                type="datetime-local"
                                value={composerTaskDue}
                                onChange={e => setComposerTaskDue(e.target.value)}
                                className="border border-slate-200 rounded px-2 py-1 bg-white"
                              />
                              <span className="text-gray-500 ml-1">для</span>
                              <select
                                value={composerTaskAssignee}
                                onChange={e => setComposerTaskAssignee(e.target.value)}
                                className="border border-slate-200 rounded px-2 py-1 bg-white min-w-[140px]"
                              >
                                <option value="">мне ({profile?.first_name ?? '—'})</option>
                                {users.filter(u => u.id !== profile?.id).map(u => (
                                  <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''}</option>
                                ))}
                              </select>
                              {composerTaskDue && (
                                <span className="ml-auto text-[10px] text-gray-500">
                                  ⏰ {formatTaskDueHint(composerTaskDue)}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Input + send */}
                        <div className="flex gap-2 p-3">
                          <textarea
                            value={msgDraft}
                            onChange={e => setMsgDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                e.preventDefault(); submitComposer()
                              }
                            }}
                            placeholder={
                              composerMode === 'chat' ? 'Сообщение клиенту…  (⌘+Enter — отправить)' :
                              composerMode === 'note' ? 'Внутреннее примечание — видно только команде' :
                              'Название задачи…'
                            }
                            rows={composerMode === 'task' ? 1 : 2}
                            className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm resize-none focus:border-blue-400 outline-none"
                          />
                          <button
                            onClick={submitComposer}
                            disabled={!msgDraft.trim() || sending}
                            className="self-end px-4 py-1.5 text-sm text-white rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-gray-400"
                          >
                            {sending ? '…' :
                             composerMode === 'chat' ? 'Отправить' :
                             composerMode === 'note' ? 'Сохранить' :
                             'Поставить'}
                          </button>
                        </div>

                        {composerMode === 'chat' && waConnected === false && (
                          <div className="px-3 pb-2 text-[10px] text-gray-500">
                            ⚠ WhatsApp ещё не подключён — сообщение сохранится локально, клиенту не уйдёт
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'timeline' && isAdmin && (
                    <div className="p-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
                      {/* Comment composer */}
                      <div className="flex gap-2">
                        <textarea
                          value={commentDraft}
                          onChange={e => setCommentDraft(e.target.value)}
                          placeholder="Добавить комментарий…"
                          rows={2}
                          className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm resize-none hover:border-gray-300 focus:border-blue-400 outline-none"
                        />
                        <button
                          onClick={addComment}
                          disabled={!commentDraft.trim()}
                          className="self-start px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded"
                        >
                          Отправить
                        </button>
                      </div>

                      {/* Timeline list (с учётом поиска) */}
                      {(() => {
                        const q = search.toLowerCase()
                        const filtered = !q
                          ? events
                          : events.filter(e => {
                              const lbl = (EVENT_LABEL[e.kind] ?? e.kind).toLowerCase()
                              const body = renderEventBody(e).toLowerCase()
                              const actor = (e.actor_name ?? '').toLowerCase()
                              return lbl.includes(q) || body.includes(q) || actor.includes(q)
                            })
                        if (filtered.length === 0) {
                          return <div className="text-sm text-gray-400 py-4 text-center">
                            {q ? 'Ничего не найдено' : 'Событий пока нет'}
                          </div>
                        }
                        return (
                          <ol className="relative border-l-2 border-gray-100 space-y-3 ml-2 pt-1">
                            {filtered.map(e => {
                              const color = EVENT_COLOR[e.kind] ?? '#94a3b8'
                              const label = EVENT_LABEL[e.kind] ?? e.kind
                              const body = renderEventBody(e)
                              return (
                                <li key={e.id} className="ml-4 relative">
                                  <span className="absolute -left-[1.4rem] top-1 w-3 h-3 rounded-full border-2 border-white"
                                        style={{ background: color }} />
                                  <div className="flex items-baseline gap-2 text-xs text-gray-500">
                                    <span>{new Date(e.created_at).toLocaleString('ru-RU')}</span>
                                    {e.actor_name && <span>· {e.actor_name}</span>}
                                  </div>
                                  <div className="mt-0.5 text-sm">
                                    <span className="font-medium text-gray-800">{label}</span>
                                    {body && <span className="text-gray-600"> — {body}</span>}
                                  </div>
                                </li>
                              )
                            })}
                          </ol>
                        )
                      })()}
                    </div>
                  )}

                  {activeTab === 'tasks' && (
                    <div className="p-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
                      {/* New task composer */}
                      <div className="space-y-2 bg-gray-50 rounded p-2.5">
                        <input
                          type="text" value={newTaskTitle}
                          onChange={e => setNewTaskTitle(e.target.value)}
                          placeholder="Новая задача…"
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                        />
                        <div className="flex gap-2">
                          <input
                            type="datetime-local" value={newTaskDue}
                            onChange={e => setNewTaskDue(e.target.value)}
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm"
                          />
                          <select
                            value={newTaskAssignee}
                            onChange={e => setNewTaskAssignee(e.target.value)}
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm bg-white"
                          >
                            <option value="">— ответственный —</option>
                            {users.map(u => (
                              <option key={u.id} value={u.id}>{u.first_name} {u.last_name ?? ''}</option>
                            ))}
                          </select>
                          <button
                            onClick={addTask}
                            disabled={!newTaskTitle.trim()}
                            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Task list */}
                      {tasks.length === 0 && (
                        <div className="text-sm text-gray-400 py-4 text-center">Задач пока нет</div>
                      )}
                      <ul className="divide-y divide-gray-100">
                        {tasks.map(t => {
                          const overdue = t.status === 'open' && t.due_at && new Date(t.due_at) < new Date()
                          return (
                            <li key={t.id} className="py-2 flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={t.status === 'done'}
                                onChange={() => toggleTask(t)}
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0">
                                <div className={`text-sm ${t.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                  {t.title}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                  {t.due_at && (
                                    <span className={overdue ? 'text-red-600 font-medium' : ''}>
                                      {new Date(t.due_at).toLocaleString('ru-RU')}
                                    </span>
                                  )}
                                  {t.assignee && <span>· {t.assignee.first_name} {t.assignee.last_name ?? ''}</span>}
                                </div>
                              </div>
                              <button
                                onClick={() => deleteTask(t)}
                                className="text-xs text-gray-400 hover:text-red-600"
                              >×</button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Comments list (standalone block — for quick scan) */}
              {!isNew && comments.length > 0 && activeTab === 'tasks' && (
                <div className="bg-white border border-gray-200 rounded-lg mt-4 flex-shrink-0 max-h-[30%] overflow-hidden flex flex-col">
                  <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-medium text-gray-900 flex-shrink-0">
                    Комментарии
                  </div>
                  <ul className="divide-y divide-gray-100 overflow-y-auto">
                    {comments.map(c => (
                      <li key={c.id} className="px-4 py-2 text-sm">
                        <div className="text-xs text-gray-500">
                          {c.author ? `${c.author.first_name} ${c.author.last_name ?? ''}` : '—'}
                          <span className="ml-2">{new Date(c.created_at).toLocaleString('ru-RU')}</span>
                        </div>
                        <div className="text-gray-800 whitespace-pre-wrap mt-0.5">{c.body}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-gray-200 flex items-center gap-4 relative">
          {isDirty && (
            <button onClick={save} disabled={saving}
              className="px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md">
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </button>
          )}

          {/* Бейдж непрочитанных — слева, открывает боковую панель */}
          <button
            onClick={() => setShowUnreadPopup(v => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${showUnreadPopup ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100 text-gray-600'}`}
          >
            <span className="relative flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {totalUnread > 0 && (
                <span className="absolute -top-2 -right-2 min-w-[17px] h-[17px] px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                  {totalUnread > 99 ? '99+' : totalUnread}
                </span>
              )}
            </span>
            <span className="text-sm">
              {totalUnread > 0 ? `${totalUnread} непрочитанных` : 'Нет новых'}
            </span>
          </button>
        </div>
      </div>

      {showFieldsSettings && form.clinic_id && (
        <DealFieldsSettingsModal
          clinicId={form.clinic_id}
          pipelines={pipelines.map(p => ({ id: p.id, name: p.name }))}
          stages={stages.map(s => ({ id: s.id, name: s.name, pipeline_id: s.pipeline_id }))}
          onClose={() => setShowFieldsSettings(false)}
          onSaved={(next) => { setFieldConfigs(next); setShowFieldsSettings(false) }}
        />
      )}

      {showBookingModal && form.clinic_id && (
        <CreateAppointmentModal
          clinicId={form.clinic_id}
          defaultDate={new Date().toISOString().slice(0, 10)}
          defaultPatient={form.patient ? {
            id: form.patient.id,
            full_name: form.patient.full_name,
            phone: form.patient.phones?.[0] ?? form.contact_phone ?? null,
          } : null}
          // Если пациент ещё не привязан — подтягиваем имя/телефон из карточки сделки.
          suggestedNewPatient={!form.patient ? {
            full_name: form.name ?? null,
            phone: form.contact_phone ?? null,
          } : null}
          dealId={form.id}
          onClose={() => setShowBookingModal(false)}
          onCreated={() => { setShowBookingModal(false); loadRelated() }}
        />
      )}
    </div>
  )
}

// ─── small helpers ────────────────────────────────────────────────────────────

// Format YYYY-MM-DDTHH:mm for <input type="datetime-local">
function toLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const TASK_DUE_PRESETS: { label: string; compute: () => string }[] = [
  { label: 'Через 15 мин',  compute: () => { const d = new Date(); d.setMinutes(d.getMinutes()+15); d.setSeconds(0,0); return toLocalDateTime(d) } },
  { label: 'Через 30 мин',  compute: () => { const d = new Date(); d.setMinutes(d.getMinutes()+30); d.setSeconds(0,0); return toLocalDateTime(d) } },
  { label: 'Через час',     compute: () => { const d = new Date(); d.setHours(d.getHours()+1);     d.setSeconds(0,0); return toLocalDateTime(d) } },
  { label: 'Сегодня 18:00', compute: () => { const d = new Date(); d.setHours(18,0,0,0);           return toLocalDateTime(d) } },
  { label: 'Завтра 09:00',  compute: () => { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); return toLocalDateTime(d) } },
  { label: 'В пятницу',     compute: () => { const d = new Date(); const dow = d.getDay(); const add = ((5 - dow) + 7) % 7 || 7; d.setDate(d.getDate()+add); d.setHours(18,0,0,0); return toLocalDateTime(d) } },
  { label: 'Через неделю',  compute: () => { const d = new Date(); d.setDate(d.getDate()+7);   d.setHours(9,0,0,0); return toLocalDateTime(d) } },
  { label: 'Через месяц',   compute: () => { const d = new Date(); d.setMonth(d.getMonth()+1); d.setHours(9,0,0,0); return toLocalDateTime(d) } },
]

function formatTaskDueHint(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const min = Math.round(abs / 60000)
  const hr  = Math.round(abs / 3600000)
  const dy  = Math.round(abs / 86400000)
  const suffix = diffMs < 0 ? ' назад' : ''
  const pre    = diffMs < 0 ? '' : 'через '
  if (min < 60)  return `${pre}${min} мин${suffix}`
  if (hr  < 24)  return `${pre}${hr} ч${suffix}`
  if (dy  < 7)   return `${pre}${dy} дн${suffix}`
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const COMPOSER_MODES: { value: 'chat'|'note'|'task'; label: string; icon: string }[] = [
  { value: 'chat', label: 'Чат',        icon: '💬' },
  { value: 'note', label: 'Примечание', icon: '📝' },
  { value: 'task', label: 'Задача',     icon: '✅' },
]

function ComposerModeDropdown({
  value,
  onChange,
}: {
  value: 'chat'|'note'|'task'
  onChange: (m: 'chat'|'note'|'task') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const current = COMPOSER_MODES.find(m => m.value === value) ?? COMPOSER_MODES[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
      >
        <span>{current.icon}</span>
        <span>{current.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        // Дроп открываем вверх — кнопка сидит в самом низу чат-карточки,
        // у которой overflow-hidden. Вниз меню срезалось бы по «Задаче».
        <div className="absolute left-0 bottom-full mb-1 z-20 min-w-[160px] rounded border border-gray-200 bg-white shadow-lg py-1">
          {COMPOSER_MODES.map(m => (
            <button
              key={m.value}
              type="button"
              onClick={() => { onChange(m.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 ${
                m.value === value ? 'text-blue-600 font-medium' : 'text-gray-700'
              }`}
            >
              <span>{m.icon}</span>
              <span className="flex-1">{m.label}</span>
              {m.value === value && (
                <svg width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function TagEditor({
  tags, allTags, onChange,
}: {
  tags: string[]
  allTags: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Закрытие по клику вне компонента (как в amoCRM).
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  function add(raw: string) {
    const v = raw.trim()
    if (!v) return
    if (tags.includes(v)) { setDraft(''); return }
    onChange([...tags, v])
    setDraft('')
  }

  const q = draft.trim().toLowerCase()
  const suggestions = allTags
    .filter(t => !tags.includes(t))
    .filter(t => !q || t.toLowerCase().includes(q))
  const canCreate = q.length > 0
    && !allTags.some(t => t.toLowerCase() === q)
    && !tags.some(t => t.toLowerCase() === q)

  const empty = tags.length === 0 && !open
  return (
    <div ref={rootRef} className="relative">
      {empty ? (
        // Закрытое пустое состояние: серая pill-плашка «#ТЕГИРОВАТЬ» как в amoCRM.
        <button
          type="button"
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          className="inline-flex items-center text-[11px] font-medium uppercase tracking-wider text-gray-500 bg-gray-100 hover:bg-gray-200 rounded px-2 py-1 transition"
        >
          #ТЕГИРОВАТЬ
        </button>
      ) : (
        <div
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }}
          className="flex flex-wrap gap-1 cursor-text min-h-[28px] items-center"
        >
          {tags.map(t => (
            <span
              key={t}
              className="group inline-flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-medium uppercase tracking-wider px-2 py-1 rounded transition"
            >
              {t}
              <button
                type="button"
                onClick={e => { e.stopPropagation(); onChange(tags.filter(x => x !== t)) }}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-900 transition"
              >×</button>
            </span>
          ))}
          {open && (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={e => { setDraft(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  if (suggestions.length > 0 && !canCreate) add(suggestions[0])
                  else add(draft)
                } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
                  onChange(tags.slice(0, -1))
                }
              }}
              placeholder="добавить тег…"
              className="flex-1 min-w-[90px] text-xs outline-none bg-transparent px-1 py-0.5"
            />
          )}
        </div>
      )}

      {open && (suggestions.length > 0 || canCreate) && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[220px] max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg py-1">
          {suggestions.slice(0, 50).map(t => (
            <button
              key={t}
              type="button"
              onMouseDown={e => { e.preventDefault(); add(t) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50"
            >
              <span className="inline-block bg-gray-100 text-gray-700 text-[11px] font-medium uppercase tracking-wider px-2 py-0.5 rounded">{t}</span>
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); add(draft) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 border-t border-gray-100 text-gray-600"
            >
              + создать тег <span className="font-medium text-gray-900">«{draft.trim()}»</span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── TemplatesDropdown ────────────────────────────────────────────────────────
// Кнопка «Шаблоны» в композере. Показывает список шаблонов (message_templates),
// сверху — избранные. Клик по шаблону вставляет body в поле ввода через onPick.
// Редактирование шаблонов — /settings/message-templates.

function TemplatesDropdown({
  templates,
  onPick,
}: {
  templates: Array<{ id: string; title: string; body: string; is_favorite: boolean; sort_order: number }>
  onPick: (t: { id: string; title: string; body: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const needle = q.trim().toLowerCase()
  const filtered = templates.filter(t =>
    !needle ||
    t.title.toLowerCase().includes(needle) ||
    t.body.toLowerCase().includes(needle)
  )
  const favorites = filtered.filter(t => t.is_favorite)
  const others    = filtered.filter(t => !t.is_favorite)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-slate-100 text-gray-700 hover:bg-slate-200 transition-colors"
        title="Вставить шаблон сообщения"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <path d="M4 6h16M4 12h10M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <svg width="10" height="10" viewBox="0 0 10 10" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1 z-30 w-80 max-h-96 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Поиск шаблона…"
              className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-blue-400"
              autoFocus
            />
          </div>

          {templates.length === 0 ? (
            <div className="p-4 text-xs text-gray-500 space-y-2">
              <div>Шаблонов пока нет.</div>
              <a
                href="/settings/message-templates"
                className="inline-block text-blue-600 hover:underline"
              >Создать в настройках →</a>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-xs text-gray-500">Ничего не найдено.</div>
          ) : (
            <>
              {favorites.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                    Избранные
                  </div>
                  {favorites.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); onPick(t); setOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span className="text-amber-500 shrink-0">★</span>
                      <span className="truncate">{t.title}</span>
                    </button>
                  ))}
                </div>
              )}
              {others.length > 0 && (
                <div className="py-1 border-t border-gray-100">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-gray-400 font-medium">
                    Шаблоны
                  </div>
                  {others.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); onPick(t); setOpen(false) }}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 truncate"
                      title={t.body}
                    >
                      {t.title}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="border-t border-gray-100 p-2 bg-slate-50">
            <a
              href="/settings/message-templates"
              className="block text-[11px] text-blue-600 hover:underline"
            >Редактировать шаблоны →</a>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BulkActionBar ────────────────────────────────────────────────────────────
// Плавающая панель внизу экрана с действиями над выбранными сделками.

function BulkActionBar({
  count,
  stages,
  users,
  onMoveStage,
  onAssign,
  onDelete,
  onCancel,
}: {
  count: number
  stages: Stage[]
  users: UserLite[]
  onMoveStage: (stageId: string) => Promise<void>
  onAssign: (userId: string) => Promise<void>
  onDelete: () => Promise<void>
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function wrap(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-50 bg-gray-900 text-white rounded-xl shadow-2xl flex items-center gap-2 px-3 py-2">
      <span className="text-sm font-medium px-1">Выбрано: {count}</span>
      <div className="w-px h-5 bg-white/20 mx-1" />

      <select
        disabled={busy}
        defaultValue=""
        onChange={e => {
          const v = e.target.value
          e.currentTarget.value = ''
          if (v) wrap(() => onMoveStage(v))
        }}
        className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-white/10 disabled:opacity-60"
      >
        <option value="" disabled>→ В этап</option>
        {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      <select
        disabled={busy}
        defaultValue=""
        onChange={e => {
          const v = e.target.value
          e.currentTarget.value = ''
          if (v) wrap(() => onAssign(v))
        }}
        className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-white/10 disabled:opacity-60"
      >
        <option value="" disabled>Ответственный</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>{`${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()}</option>
        ))}
      </select>

      <button
        type="button"
        disabled={busy}
        onClick={() => wrap(onDelete)}
        className="text-xs px-2.5 py-1.5 rounded bg-red-600 hover:bg-red-700 disabled:opacity-60"
      >
        Удалить
      </button>

      <div className="w-px h-5 bg-white/20 mx-1" />
      <button
        type="button"
        onClick={onCancel}
        className="text-xs px-2 py-1.5 rounded hover:bg-white/10"
      >
        Отмена
      </button>
    </div>
  )
}

// ─── ImportDealsModal ─────────────────────────────────────────────────────────
// Минимальный импорт сделок из CSV (разделитель ; или ,). Ожидаемые заголовки
// на первой строке; русские и английские алиасы принимаются.

function ImportDealsModal({
  clinicId,
  pipelineId,
  defaultStageId,
  onClose,
  onDone,
}: {
  clinicId: string
  pipelineId: string
  defaultStageId: string | null
  onClose: () => void
  onDone: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)

  // Нормализация заголовков столбцов: кириллица/пробелы/регистр → канонические ключи.
  const ALIASES: Record<string, string> = {
    'название': 'name', 'сделка': 'name', 'name': 'name',
    'пациент': 'patient', 'фио': 'patient', 'patient': 'patient',
    'телефон': 'phone', 'phone': 'phone', 'tel': 'phone',
    'город': 'city', 'city': 'city',
    'сумма': 'amount', 'amount': 'amount', 'budget': 'amount',
    'заметка': 'notes', 'комментарий': 'notes', 'notes': 'notes',
    'теги': 'tags', 'tags': 'tags',
  }

  function parseCsv(text: string): Record<string, string>[] {
    // Простой CSV parser: ; или , как разделитель, двойные кавычки.
    const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
    const delim = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
    const lines: string[][] = []
    let cur: string[] = []
    let cell = ''
    let inQ = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
        else if (ch === '"') { inQ = false }
        else { cell += ch }
      } else {
        if (ch === '"') inQ = true
        else if (ch === delim) { cur.push(cell); cell = '' }
        else if (ch === '\n') { cur.push(cell); lines.push(cur); cur = []; cell = '' }
        else if (ch === '\r') { /* skip */ }
        else cell += ch
      }
    }
    if (cell.length || cur.length) { cur.push(cell); lines.push(cur) }
    if (lines.length === 0) return []
    const headers = (lines.shift() ?? []).map(h =>
      ALIASES[h.trim().toLowerCase().replace(/^\uFEFF/, '')] ?? h.trim().toLowerCase()
    )
    return lines
      .filter(r => r.some(c => c.trim().length > 0))
      .map(r => {
        const obj: Record<string, string> = {}
        headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim() })
        return obj
      })
  }

  async function onFile(file: File) {
    const text = await file.text()
    setRows(parseCsv(text))
    setFileName(file.name)
    setReport(null)
  }

  async function runImport() {
    if (busy || rows.length === 0) return
    setBusy(true)
    let created = 0, skipped = 0
    const errors: string[] = []
    for (const r of rows) {
      try {
        const name = r['name']?.trim() || r['patient']?.trim() || ''
        if (!name && !r['phone']) { skipped++; continue }
        const tags = (r['tags'] ?? '').split(/[;,]/).map(x => x.trim()).filter(Boolean)
        const amount = r['amount'] ? Number(r['amount'].replace(/[^\d.,-]/g, '').replace(',', '.')) : null
        const payload: Record<string, unknown> = {
          clinic_id: clinicId,
          pipeline_id: pipelineId,
          stage_id: defaultStageId,
          name: name || null,
          contact_phone: r['phone'] || null,
          contact_city: r['city'] || null,
          notes: r['notes'] || null,
          tags: tags.length ? tags : [],
          amount: amount != null && !Number.isNaN(amount) ? amount : null,
          funnel: 'leads',
          status: 'open',
        }
        const { error } = await supabase.from('deals').insert(payload)
        if (error) { errors.push(`${name || r['phone'] || '—'}: ${error.message}`); skipped++ }
        else created++
      } catch (e: unknown) {
        errors.push(String(e))
        skipped++
      }
    }
    setReport({ created, skipped, errors: errors.slice(0, 10) })
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl w-full max-w-xl shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Импорт сделок из CSV</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div>
            <p className="text-gray-600 mb-2">
              Загрузите CSV (разделитель «;» или «,»). Первая строка — заголовки. Распознаются:
              <span className="font-mono text-xs text-gray-500"> название, пациент, телефон, город, сумма, заметка, теги</span>.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
              className="block w-full text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded file:border-0 file:bg-blue-600 file:text-white hover:file:bg-blue-700"
            />
          </div>
          {fileName && (
            <div className="text-xs text-gray-500">
              Файл: <span className="text-gray-800">{fileName}</span> · распознано строк: <b>{rows.length}</b>
            </div>
          )}
          {rows.length > 0 && !report && (
            <div className="border border-gray-100 rounded-md overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-2 py-1 text-left">#</th>
                    <th className="px-2 py-1 text-left">Название</th>
                    <th className="px-2 py-1 text-left">Телефон</th>
                    <th className="px-2 py-1 text-left">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-400">{i + 1}</td>
                      <td className="px-2 py-1">{r['name'] || r['patient'] || '—'}</td>
                      <td className="px-2 py-1">{r['phone'] || '—'}</td>
                      <td className="px-2 py-1">{r['amount'] || '—'}</td>
                    </tr>
                  ))}
                  {rows.length > 10 && (
                    <tr><td colSpan={4} className="px-2 py-1 text-center text-gray-400">…и ещё {rows.length - 10}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {report && (
            <div className="bg-gray-50 border border-gray-100 rounded-md p-3 text-xs space-y-1">
              <div>Создано: <b className="text-green-700">{report.created}</b></div>
              <div>Пропущено: <b className="text-amber-700">{report.skipped}</b></div>
              {report.errors.length > 0 && (
                <div>
                  <div className="text-gray-500 mt-2">Ошибки (первые 10):</div>
                  <ul className="list-disc pl-4 text-red-700">
                    {report.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50">
            {report ? 'Закрыть' : 'Отмена'}
          </button>
          {!report ? (
            <button
              onClick={runImport}
              disabled={busy || rows.length === 0}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
            >
              {busy ? 'Импортируем…' : `Импортировать ${rows.length}`}
            </button>
          ) : (
            <button
              onClick={onDone}
              className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
            >
              Готово
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DuplicatesModal ──────────────────────────────────────────────────────────
// Группируем сделки по нормализованному телефону и ФИО пациента. Показываем
// только группы из ≥2 сделок.

function DuplicatesModal({
  deals,
  onOpenDeal,
  onClose,
}: {
  deals: DealRow[]
  onOpenDeal: (d: DealRow) => void
  onClose: () => void
}) {
  const groups = useMemo(() => {
    const normPhone = (p: string) => p.replace(/\D+/g, '').replace(/^8/, '7')
    const byPhone = new Map<string, DealRow[]>()
    const byName  = new Map<string, DealRow[]>()
    for (const d of deals) {
      const phones = [
        ...(d.patient?.phones ?? []),
        d.contact_phone ?? '',
      ].map(normPhone).filter(p => p.length >= 7)
      for (const p of phones) {
        if (!byPhone.has(p)) byPhone.set(p, [])
        byPhone.get(p)!.push(d)
      }
      const name = (d.patient?.full_name ?? d.name ?? '').trim().toLowerCase()
      if (name.length > 2) {
        if (!byName.has(name)) byName.set(name, [])
        byName.get(name)!.push(d)
      }
    }
    const seen = new Set<string>()
    const out: { key: string; kind: 'Телефон' | 'ФИО'; label: string; deals: DealRow[] }[] = []
    for (const [phone, arr] of byPhone) {
      const uniq = Array.from(new Map(arr.map(d => [d.id, d])).values())
      if (uniq.length >= 2) {
        uniq.forEach(d => seen.add(d.id))
        out.push({ key: `phone:${phone}`, kind: 'Телефон', label: phone, deals: uniq })
      }
    }
    for (const [name, arr] of byName) {
      const uniq = Array.from(new Map(arr.map(d => [d.id, d])).values())
      // Пропускаем группы, уже полностью покрытые телефонным совпадением.
      if (uniq.length >= 2 && uniq.some(d => !seen.has(d.id))) {
        out.push({ key: `name:${name}`, kind: 'ФИО', label: name, deals: uniq })
      }
    }
    return out.sort((a, b) => b.deals.length - a.deals.length)
  }, [deals])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h3 className="font-semibold text-gray-900">Поиск дублей</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-2 text-xs text-gray-500 border-b border-gray-100 flex-shrink-0">
          Группы сделок с одинаковыми телефонами или ФИО пациента.
          Найдено групп: <b className="text-gray-700">{groups.length}</b>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {groups.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-10">Дубликатов не найдено 🎉</div>
          ) : (
            groups.map(g => (
              <div key={g.key} className="border border-gray-100 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 text-xs text-gray-600 flex items-center gap-2">
                  <span className="uppercase tracking-wider text-[10px] text-gray-400">{g.kind}</span>
                  <span className="font-mono">{g.label}</span>
                  <span className="ml-auto text-gray-500">{g.deals.length} сделок</span>
                </div>
                <ul className="divide-y divide-gray-100 text-sm">
                  {g.deals.map(d => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => onOpenDeal(d)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-50/50 flex items-center gap-3"
                      >
                        <span className="text-gray-900 flex-1 truncate">{d.name || d.patient?.full_name || '—'}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{d.contact_phone ?? d.patient?.phones?.[0] ?? ''}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{fmtAge(d.updated_at)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
