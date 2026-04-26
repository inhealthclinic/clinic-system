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
import { notify, confirmAction } from '@/lib/ui/notify'
import { CreateAppointmentModal } from '@/components/appointments/CreateAppointmentModal'
import { DealFieldsSettingsModal } from '@/components/crm/DealFieldsSettingsModal'
import { VoiceBubble } from '@/components/crm/VoiceBubble'
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
  birth_date: string | null  // ISO YYYY-MM-DD; для лидов без пациента
  notes: string | null
  tags: string[]
  // Кастомные поля (мигр. 057): { [field_key]: value }
  custom_fields: Record<string, unknown> | null
  // Состояние приветственного бота (мигр. 083):
  //   bot_active=true     — бот ещё может что-то прислать (cron подхватит)
  //   bot_state='greeted' — приветствие отправлено, ждём 1ч ответа
  //   bot_state='followup_sent' — фоллоуап ушёл, бот завершён
  //   bot_state='done'    — клиент ответил / менеджер взял сделку
  bot_active?: boolean
  bot_state?: string | null
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

/**
 * Bulk-апдейт сделок чанками. У PostgREST лимит длины URL ~16k символов,
 * а `.in('id', [...UUIDs])` уезжает в query-string. На пачке >300 ID
 * запрос отлетает с 400 Bad Request. Поэтому режем на батчи.
 *
 * Возвращает строку с ошибкой первого упавшего чанка либо null, если ок.
 */
async function bulkUpdateDeals(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
  patch: Record<string, unknown>,
  chunkSize = 200,
): Promise<string | null> {
  if (ids.length === 0) return null
  for (let i = 0; i < ids.length; i += chunkSize) {
    const slice = ids.slice(i, i + chunkSize)
    const { error } = await supabase.from('deals').update(patch).in('id', slice)
    if (error) return error.message
  }
  return null
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
  // Инпут контролируется listSearch (мгновенный отклик при вводе), а тяжёлый
  // фильтр по списку сделок читает debouncedSearch — обновляется через 300мс
  // после последнего нажатия, чтобы не пересчитывать фильтр на каждую букву.
  const [listSearch, setListSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(listSearch), 300)
    return () => window.clearTimeout(t)
  }, [listSearch])

  // Фильтр «Только мои / Все сделки» — разделение видимости между
  // менеджерами. По умолчанию manager видит только свои сделки
  // (responsible_user_id = profile.id); admin/owner — все.
  // Выбор запоминается в localStorage.
  const roleSlug = profile?.role?.slug ?? ''
  const isManagerOnly = roleSlug === 'manager'
  const [ownerFilter, setOwnerFilter] = useState<'mine' | 'all'>(
    isManagerOnly ? 'mine' : 'all'
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('crm.ownerFilter')
    if (v === 'mine' || v === 'all') setOwnerFilter(v)
    else setOwnerFilter(isManagerOnly ? 'mine' : 'all')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleSlug])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('crm.ownerFilter', ownerFilter)
  }, [ownerFilter])

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
  // Подтверждение массового удаления — отдельная модалка с typed-confirm
  // ('УДАЛИТЬ'), чтобы случайный клик не сносил пол-воронки. Реальный кейс:
  // менеджер выделил 278 сделок и нажал «Удалить» → потеряли всю CRM.
  const [bulkDeletePending, setBulkDeletePending] = useState(false)
  // Быстрое создание сделки — мини-модалка имя+телефон, чтобы не открывать
  // большой DealModal на каждый входящий звонок.
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  // Глобальный поиск по телефону: ищет ПО ВСЕМ сделкам клиники (не только
  // загруженные 1000), потому что менеджеру звонят, а сделка может лежать
  // в другой воронке или ниже в очереди.
  const [phoneSearchOpen, setPhoneSearchOpen] = useState(false)

  // drag state
  const [dragging, setDragging] = useState<DealRow | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)

  // pending loss prompt
  const [lossPending, setLossPending] = useState<{ deal: DealRow; stageId: string } | null>(null)

  // Счётчики непрочитанных входящих сообщений по каждой сделке — для бейджей
  // на карточках канбана. Обновляем каждые 8 сек + подписываемся на realtime,
  // чтобы новое WhatsApp/SMS сообщение мгновенно поднимало цифру.
  const [unreadByDeal, setUnreadByDeal] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!clinicId) return
    let cancelled = false
    const fetchUnread = async () => {
      const { data } = await supabase
        .from('deal_messages')
        .select('deal_id')
        .eq('clinic_id', clinicId)
        .eq('direction', 'in')
        .is('read_at', null)
        .limit(2000)
      if (cancelled) return
      const map: Record<string, number> = {}
      for (const row of (data ?? []) as { deal_id: string }[]) {
        map[row.deal_id] = (map[row.deal_id] ?? 0) + 1
      }
      setUnreadByDeal(map)
    }
    fetchUnread()
    const interval = setInterval(fetchUnread, 8000)
    const ch = supabase.channel(`crm-unread:${clinicId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'deal_messages', filter: `clinic_id=eq.${clinicId}` },
        () => { fetchUnread() })
      .subscribe()
    return () => {
      cancelled = true
      clearInterval(interval)
      supabase.removeChannel(ch)
    }
  }, [clinicId, supabase])

  // selected deal — local state only, не пишем в URL чтобы перезагрузка
  // страницы не открывала автоматически последнюю сделку.
  const [selectedDeal, setSelectedDeal] = useState<DealRow | null>(null)

  // Сохраняем открытую сделку в sessionStorage (живёт пока открыта вкладка,
  // не утекает в URL, не делится между вкладками). Закрытие — стираем.
  // Это ЕДИНСТВЕННОЕ место, где состояние модалки переживает рефреш.
  // Заодно чистим устаревший ?deal= из URL, если остался от прошлых версий.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (searchParams.get('deal')) {
      const sp = new URLSearchParams(searchParams.toString())
      sp.delete('deal')
      const qs = sp.toString()
      router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // На старте: восстанавливаем открытую сделку ДО того, как эффект «сохранить»
  // успеет затереть ключ при selectedDeal=null. Поэтому save-эффект гейтим
  // флагом restoredFromStorageRef.
  const restoredFromStorageRef = useRef(false)
  useEffect(() => {
    if (restoredFromStorageRef.current) return
    if (typeof window === 'undefined') return
    const id = window.sessionStorage.getItem('crm.openDeal')
    if (!id) { restoredFromStorageRef.current = true; return }
    if (selectedDeal?.id === id) { restoredFromStorageRef.current = true; return }
    const inList = deals.find(d => d.id === id)
    if (inList) {
      setSelectedDeal(inList)
      restoredFromStorageRef.current = true
      return
    }
    if (deals.length === 0) return  // подождём загрузки
    ;(async () => {
      const { data } = await supabase.from('deals').select('*').eq('id', id).maybeSingle()
      if (data) setSelectedDeal(data as unknown as DealRow)
      else window.sessionStorage.removeItem('crm.openDeal')
      restoredFromStorageRef.current = true
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!restoredFromStorageRef.current) return  // не трогаем хранилище до восстановления
    if (selectedDeal) {
      window.sessionStorage.setItem('crm.openDeal', selectedDeal.id)
    } else {
      window.sessionStorage.removeItem('crm.openDeal')
    }
  }, [selectedDeal?.id])

  const openDeal = useCallback((d: DealRow) => {
    setSelectedDeal(d)
  }, [])

  const closeDeal = useCallback(() => {
    setSelectedDeal(null)
  }, [])

  // Если в URL остался старый ?deal=<id> (от прошлой версии) — чистим
  // его при первой загрузке, не открывая сделку.
  // Если пришёл одноразовый ?openDeal=<id> (permalink из /crm/[id] или
  // уведомления) — открываем сделку и сразу зачищаем URL, чтобы F5 её
  // не переоткрывал.
  useEffect(() => {
    const stale = searchParams.get('deal')
    const intent = searchParams.get('openDeal')
    if (!stale && !intent) return

    if (intent && clinicId) {
      // Сначала пробуем найти в текущем стейте; если нет — тянем из БД.
      // (Запрашиваем те же поля, что и основная выборка, чтобы DealCard
      // / DealModal не падали на отсутствующих джойнах.)
      ;(async () => {
        let row: DealRow | null = deals.find(d => d.id === intent) || null
        if (!row) {
          const { data } = await supabase.from('deals').select(`
              id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel, status,
              responsible_user_id, source_id, amount,
              preferred_doctor_id, appointment_type, loss_reason_id, contact_phone, contact_city, birth_date, notes, tags,
              custom_fields, bot_active, bot_state,
              stage_entered_at, created_at, updated_at,
              patient:patients(id, full_name, phones, birth_date, city),
              responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name),
              doctor:doctors!deals_preferred_doctor_id_fkey(id, first_name, last_name)
            `)
            .eq('id', intent)
            .eq('clinic_id', clinicId)
            .maybeSingle()
          row = (data as unknown as DealRow) || null
        }
        if (row) setSelectedDeal(row)
      })()
    }
    router.replace('/crm', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId])

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    // Базовый запрос сделок. При ownerFilter='mine' ограничиваем по
    // responsible_user_id на стороне БД (не в памяти).
    let dealsQuery = supabase.from('deals').select(`
        id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel, status,
        responsible_user_id, source_id, amount,
        preferred_doctor_id, appointment_type, loss_reason_id, contact_phone, contact_city, birth_date, notes, tags,
        custom_fields, bot_active, bot_state,
        stage_entered_at, created_at, updated_at,
        patient:patients(id, full_name, phones, birth_date, city),
        responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name),
        doctor:doctors!deals_preferred_doctor_id_fkey(id, first_name, last_name)
      `).eq('clinic_id', clinicId).is('deleted_at', null)
    if (ownerFilter === 'mine' && profile?.id) {
      dealsQuery = dealsQuery.eq('responsible_user_id', profile.id)
    }
    // Phase 1: воронки + этапы + словари. Сначала тянем pipelines+stages,
    // чтобы потом скопировать сделки только по stage_id-ам активной воронки —
    // это надёжнее, чем фильтр по pipeline_id у deal: у импортированных
    // amoCRM-сделок pipeline_id может быть пустым/устаревшим, но stage_id
    // верный (server-view v_pipeline_stage_counts тоже джойнит только
    // по stage_id, поэтому бейджи в шапке совпадают с карточками).
    const [p, r, ls, up, doc, cl] = await Promise.all([
      supabase.from('pipelines').select('*').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('deal_loss_reasons').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('lead_sources').select('id,name,is_active').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
      supabase.from('user_profiles').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
      supabase.from('doctors').select('id,first_name,last_name').eq('clinic_id', clinicId).eq('is_active', true).order('first_name'),
      supabase.from('clinics').select('settings').eq('id', clinicId).maybeSingle(),
    ])
    const ps = (p.data ?? []) as Pipeline[]
    setPipelines(ps)
    setReasons((r.data ?? []) as LossReason[])
    setSources((ls.data ?? []) as LeadSource[])
    setUsers((up.data ?? []) as UserLite[])
    setDoctors((doc.data ?? []) as DoctorLite[])
    const at = (cl.data?.settings as { appt_types?: ApptType[] } | null)?.appt_types
    setApptTypes(Array.isArray(at) ? at : [])

    // Phase 2: этапы + counts + conversion + сделки активной воронки.
    let allStages: Stage[] = []
    const pipelineIds = ps.map(x => x.id)
    if (pipelineIds.length > 0) {
      const [st, c, cv] = await Promise.all([
        supabase.from('pipeline_stages').select('*').in('pipeline_id', pipelineIds).order('sort_order'),
        supabase.from('v_pipeline_stage_counts').select('pipeline_id,stage_id,deals_count,open_count'),
        supabase.from('v_pipeline_conversion').select('pipeline_id,total,won,lost,open_count,conversion_pct').eq('clinic_id', clinicId),
      ])
      allStages = (st.data ?? []) as Stage[]
      setStages(allStages)
      setCounts((c.data ?? []) as StageCount[])
      setConversions((cv.data ?? []) as Conversion[])
    }

    // Какая воронка сейчас активна для пользователя.
    const effectivePipelineId = activePipelineId || ps[0]?.id || null
    const effectiveStageIds = effectivePipelineId
      ? allStages.filter(s => s.pipeline_id === effectivePipelineId && s.is_active).map(s => s.id)
      : []

    // Phase 3: сделки активной воронки — фильтр по stage_id, а не по
    // deal.pipeline_id. .in() по UUID-ам безопасен — этапов в воронке
    // обычно <30, длина URL мизерная.
    if (effectiveStageIds.length > 0) {
      dealsQuery = dealsQuery.in('stage_id', effectiveStageIds)
        .order('stage_entered_at', { ascending: false })
        .limit(5000)
      const d = await dealsQuery
      setDeals((d.data ?? []) as unknown as DealRow[])
    } else {
      setDeals([])
    }

    if (!activePipelineId && ps.length > 0) setActivePipelineId(ps[0].id)
    setLoading(false)
  }, [clinicId, supabase, activePipelineId, ownerFilter, profile?.id])

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
  // Кому показывать переключатель «Показать закрытые этапы».
  // Owner и admin — оба могут просматривать архив воронки.
  const isListCrmAdmin = profile?.role?.slug === 'admin' || profile?.role?.slug === 'owner'
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
    const q = debouncedSearch.trim().toLowerCase()
    const map = new Map<string, DealRow[]>()
    for (const s of activeStages) map.set(s.id, [])
    // Фильтруем по принадлежности этапа активной воронке, а не по deal.pipeline_id —
    // у импортированных сделок pipeline_id может быть пустым/устаревшим, тогда как
    // server-view v_pipeline_stage_counts тоже джойнит только по stage_id.
    for (const d of deals) {
      if (!d.stage_id) continue
      if (!map.has(d.stage_id)) continue
      if (!matchesSearch(d, q)) continue
      map.get(d.stage_id)!.push(d)
    }
    for (const arr of map.values()) arr.sort(compareDeals)
    return map
  }, [deals, activeStages, debouncedSearch, matchesSearch, compareDeals])

  // Плоский список для табличного вида.
  const tableDeals = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    const activeStageIds = new Set(activeStages.map(s => s.id))
    return deals
      .filter(d => d.stage_id != null && activeStageIds.has(d.stage_id))
      .filter(d => matchesSearch(d, q))
      .sort(compareDeals)
  }, [deals, activeStages, debouncedSearch, matchesSearch, compareDeals])

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
    if (error) { notify.error('Не удалось сохранить: ' + error.message); load(); return }
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
    if (upErr) { notify.error('Не удалось перевести: ' + upErr.message); setLossPending(null); load(); return }
    // Пишем лог причины
    const { error: logErr } = await supabase.from('deal_loss_logs').insert({
      deal_id: deal.id,
      reason_id: reasonId,
      reason_name: reasonName,
      comment: comment || null,
      created_by: profile?.id ?? null,
    })
    if (logErr) { notify.warning('Этап переведён, но причина не записана: ' + logErr.message) }
    setLossPending(null)
    load()
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  // Полноэкранный лоадер показываем только при первом монтировании.
  // На последующих перезагрузках (после DnD/импорта/Realtime) оставляем канбан
  // на месте, чтобы UI не моргал. Точечный спиннер можно дорисовать в шапке.
  if (loading && pipelines.length === 0) return <div className="p-6 text-sm text-gray-500">Загрузка…</div>
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
        <Link
          href="/settings/pipelines"
          className="text-sm px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white"
          title="Этапы, причины потери, источники, автоматизации (бот / касания / задачи)"
        >
          ⚙ Настроить воронку
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
              <MoreMenuItem
                label="Корзина"
                icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                onClick={() => { router.push('/crm/trash'); setMoreMenuOpen(false) }}
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

        {/* Фильтр «Только мои / Все сделки». По умолчанию manager видит
            только свои; admin/owner — все. Сегментированный toggle, стиль
            как у других контролов в хедере. */}
        <div
          role="group"
          aria-label="Фильтр сделок по ответственному"
          className="inline-flex rounded-md border border-gray-200 bg-white p-0.5 text-sm"
        >
          <button
            type="button"
            onClick={() => setOwnerFilter('mine')}
            className={`px-3 py-1 rounded-[5px] transition-colors ${
              ownerFilter === 'mine'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
            aria-pressed={ownerFilter === 'mine'}
            title="Показывать только сделки, где я ответственный"
          >
            Только мои
          </button>
          <button
            type="button"
            onClick={() => setOwnerFilter('all')}
            className={`px-3 py-1 rounded-[5px] transition-colors ${
              ownerFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
            aria-pressed={ownerFilter === 'all'}
            title="Показывать все сделки клиники"
          >
            Все сделки
          </button>
        </div>

        <button
          onClick={() => setQuickCreateOpen(true)}
          className="text-sm px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
          title="Быстрая сделка: имя + телефон"
        >
          ⚡ Быстро
        </button>
        <button
          onClick={() => openDeal({
            id: '', clinic_id: clinicId ?? '', name: '', patient_id: null,
            pipeline_id: activePipelineId, stage_id: activeStages[0]?.id ?? null,
            stage: activeStages[0]?.code ?? null, funnel: activePipeline?.code ?? 'leads',
            status: 'open',
            responsible_user_id: ownerFilter === 'mine' ? (profile?.id ?? null) : null,
            source_id: null, amount: null,
            preferred_doctor_id: null, appointment_type: null, loss_reason_id: null,
            contact_phone: null, contact_city: null, birth_date: null, notes: null, tags: [],
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
              className="w-full pl-9 pr-24 py-2 text-sm rounded-md border border-gray-200 bg-white hover:border-gray-300 focus:border-blue-400 outline-none"
            />
            <button
              type="button"
              onClick={() => setPhoneSearchOpen(true)}
              title="Поиск по телефону по всем сделкам клиники (горячая клавиша: /)"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200"
            >
              📞 Глобально
            </button>
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

      {/* Kanban / сетка — колонки по этапам с drag&drop.
          Контейнер занимает всю оставшуюся высоту вьюпорта, чтобы
          горизонтальная полоса прокрутки прижималась к низу экрана и
          не перекрывала карточки в верхней части рабочей зоны. */}
      {viewMode === 'kanban' && (
        <div className="overflow-auto h-[calc(100vh-220px)] pb-2">
          <div className="flex gap-3 items-start min-w-max">
            {activeStages.map(stage => {
              const cards = dealsByStage.get(stage.id) ?? []
              const count = counts.find(c => c.stage_id === stage.id)
              const isOver = overStage === stage.id
              return (
                <div
                  key={stage.id}
                  className={`min-w-[280px] w-[280px] flex flex-col bg-gray-50 border rounded-lg transition-colors ${
                    isOver ? 'border-blue-400 bg-blue-50/60' : 'border-gray-200'
                  }`}
                  onDragOver={(e) => onDragOver(e, stage.id)}
                  onDragLeave={() => onDragLeave(stage.id)}
                  onDrop={(e) => onDrop(e, stage.id)}
                >
                  <div className="px-3 py-2 border-b border-gray-200 flex items-center gap-2 sticky top-0 bg-gray-50 rounded-t-lg z-[1]">
                    <span className="w-2 h-2 rounded-full" style={{ background: stage.color }} />
                    <span className="text-sm font-medium text-gray-900 flex-1 truncate">{stage.name}</span>
                    <span className="text-xs text-gray-500">{count?.open_count ?? cards.length}</span>
                  </div>
                  <div className="p-2 space-y-2 min-h-[40px]">
                    {cards.map(d => (
                      <DealCard key={d.id} deal={d} unread={unreadByDeal[d.id] ?? 0} onDragStart={(e) => onDragStart(e, d)} onClick={() => openDeal(d)} />
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
                      {debouncedSearch ? 'Ничего не найдено' : 'Нет сделок в этой воронке'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Плавающая панель действий для массового режима.
          Показываем её ВСЕГДА пока режим включён — так видно, что
          массовый режим активен даже без выбранных сделок; кнопки
          внутри сами дизейблятся при count=0. */}
      {bulkMode && (
        <BulkActionBar
          count={bulkSelected.size}
          stages={activeStages}
          allStages={stages}
          pipelines={pipelines}
          users={users}
          onCancel={() => { setBulkMode(false); setBulkSelected(new Set()) }}
          onMoveStage={async (stageId) => {
            const ids = Array.from(bulkSelected)
            // Этап мог быть из другой воронки — обязательно проставляем
            // консистентный pipeline_id, иначе сделки выпадут из канбана
            // (фильтрация в kanban идёт по паре pipeline_id+stage_id).
            const target = stages.find(s => s.id === stageId)
            const patch: Record<string, unknown> = { stage_id: stageId }
            if (target?.pipeline_id) patch.pipeline_id = target.pipeline_id
            if (target?.code) patch.stage = target.code
            const err = await bulkUpdateDeals(supabase, ids, patch)
            if (err) { notify.error(err); return }
            setBulkSelected(new Set())
            load()
          }}
          onMovePipeline={async (pipelineId) => {
            // Перенос пачки в первый этап выбранной воронки.
            const targetStage = stages
              .filter(s => s.pipeline_id === pipelineId && s.is_active)
              .sort((a, b) => a.sort_order - b.sort_order)[0]
            if (!targetStage) { notify.error('В воронке нет активных этапов'); return }
            const ids = Array.from(bulkSelected)
            const err = await bulkUpdateDeals(supabase, ids, {
              pipeline_id: pipelineId,
              stage_id: targetStage.id,
              stage: targetStage.code,
            })
            if (err) { notify.error(err); return }
            setBulkSelected(new Set())
            load()
          }}
          onAssign={async (userId) => {
            const ids = Array.from(bulkSelected)
            const err = await bulkUpdateDeals(supabase, ids, { responsible_user_id: userId })
            if (err) { notify.error(err); return }
            setBulkSelected(new Set())
            load()
          }}
          onDelete={() => {
            // Не удаляем сразу. Открываем модалку с typed-confirm —
            // см. BulkDeleteConfirmModal ниже.
            if (bulkSelected.size === 0) return
            setBulkDeletePending(true)
          }}
          onAddTask={async ({ title, dueAt, assignedTo }) => {
            // Одна задача на каждую выбранную сделку. patient_id копируем
            // из сделки, чтобы задача показывалась и в карточке пациента.
            const ids = Array.from(bulkSelected)
            const selectedDeals = deals.filter(d => ids.includes(d.id))
            const payload = selectedDeals.map(d => ({
              clinic_id: clinicId,
              title,
              due_at: dueAt,
              assigned_to: assignedTo ?? d.responsible_user_id ?? profile?.id ?? null,
              created_by: profile?.id ?? null,
              deal_id: d.id,
              patient_id: d.patient_id ?? null,
              type: 'follow_up',
              priority: 'normal',
              status: 'new',
            }))
            const { error } = await supabase.from('tasks').insert(payload)
            if (error) { notify.error(error.message); return }
            setBulkSelected(new Set())
            load()
          }}
          onEditTags={async ({ addList, removeList, replaceList }) => {
            const ids = Array.from(bulkSelected)
            const selectedDeals = deals.filter(d => ids.includes(d.id))
            // Обновляем каждую сделку отдельно — у каждой свой текущий
            // набор tags, простого UPDATE массовым SQL не сделать.
            for (const d of selectedDeals) {
              let next: string[]
              if (replaceList) {
                next = replaceList
              } else {
                const cur = new Set(d.tags ?? [])
                for (const t of addList ?? []) cur.add(t)
                for (const t of removeList ?? []) cur.delete(t)
                next = Array.from(cur)
              }
              const { error } = await supabase.from('deals').update({ tags: next }).eq('id', d.id)
              if (error) { notify.error(error.message); return }
            }
            setBulkSelected(new Set())
            load()
          }}
          onEditField={async ({ field, value }) => {
            const ids = Array.from(bulkSelected)
            const patch: Record<string, unknown> = {}
            if (field === 'amount') {
              const num = value === '' || value == null ? null : Number(value)
              if (value !== '' && value != null && Number.isNaN(num)) { notify.error('Сумма должна быть числом'); return }
              patch.amount = num
            } else if (field === 'source_id') {
              patch.source_id = value || null
            } else if (field === 'city') {
              patch.contact_city = value || null
            } else {
              notify.error('Неизвестное поле'); return
            }
            const err = await bulkUpdateDeals(supabase, ids, patch)
            if (err) { notify.error(err); return }
            setBulkSelected(new Set())
            load()
          }}
          sources={sources}
        />
      )}

      {/* Глобальный поиск по телефону — по всем сделкам клиники. */}
      {phoneSearchOpen && (
        <PhoneSearchModal
          clinicId={clinicId ?? ''}
          onCancel={() => setPhoneSearchOpen(false)}
          onPick={(d) => { setPhoneSearchOpen(false); openDeal(d) }}
        />
      )}

      {/* Быстрое создание сделки — мини-модалка имя+телефон. */}
      {quickCreateOpen && (
        <QuickCreateDealModal
          clinicId={clinicId ?? ''}
          pipelineId={activePipelineId}
          stageId={activeStages[0]?.id ?? null}
          stageCode={activeStages[0]?.code ?? null}
          funnelCode={activePipeline?.code ?? 'leads'}
          responsibleId={profile?.id ?? null}
          onCancel={() => setQuickCreateOpen(false)}
          onCreated={() => { setQuickCreateOpen(false); load() }}
        />
      )}

      {/* Подтверждение массового удаления (typed-confirm). */}
      {bulkDeletePending && (
        <BulkDeleteConfirmModal
          count={bulkSelected.size}
          onCancel={() => setBulkDeletePending(false)}
          onConfirm={async () => {
            const ids = Array.from(bulkSelected)
            const err = await bulkUpdateDeals(supabase, ids, { deleted_at: new Date().toISOString() })
            if (err) { notify.error(err); return }
            setBulkDeletePending(false)
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
          stages={activeStages}
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

function DealCard({ deal, unread = 0, onDragStart, onClick }: {
  deal: DealRow
  unread?: number
  onDragStart: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const title = deal.name || deal.patient?.full_name || '(без названия)'
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`bg-white border rounded-md p-2 cursor-grab active:cursor-grabbing hover:shadow-sm ${unread > 0 ? 'border-green-300 ring-1 ring-green-100' : 'border-gray-200'}`}
    >
      <div className="flex items-start gap-2">
        <div className="text-sm font-medium text-gray-900 truncate flex-1">{title}</div>
        {/* Бейдж бота: зелёный — активен, серый — фоллоуап уже отправлен */}
        {deal.bot_active && (
          <span
            title="Приветственный бот сейчас работает по этой сделке"
            className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-semibold leading-none"
          >🤖</span>
        )}
        {!deal.bot_active && deal.bot_state === 'followup_sent' && (
          <span
            title="Бот отправил фоллоуап — клиент не ответил за час"
            className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[10px] font-semibold leading-none"
          >🤖</span>
        )}
        {unread > 0 && (
          <span
            title={`${unread} непрочитанных сообщений`}
            className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-500 text-white text-[10px] font-semibold leading-none"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>
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
  const [submitting, setSubmitting] = useState(false)

  function submit() {
    if (submitting) return
    const r = reasons.find(x => x.id === rid)
    if (!r) { notify.error('Выберите причину'); return }
    setSubmitting(true)
    // onConfirm закроет модалку — флаг сбрасывать не нужно.
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
          <button onClick={submit} disabled={!rid || submitting}
            className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white rounded-md">
            {submitting ? 'Сохранение…' : 'Подтвердить'}
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
  /** 'bot' — отправил приветственный/фоллоуап-бот; null — менеджер/клиент. */
  sender_type?: 'bot' | null
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
  call_logged:        'Звонок',
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
  call_logged:        '#f59e0b',
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
    'loss_reason_id','contact_phone','contact_city','birth_date','notes','tags','custom_fields',
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
  const [composerMode, setComposerMode] = useState<'chat'|'note'|'task'|'call'>('chat')
  const [composerTaskDue, setComposerTaskDue] = useState('')
  const [composerTaskAssignee, setComposerTaskAssignee] = useState('')
  // Параметры режима «Звонок»: входящий/исходящий + длительность (мм:сс).
  const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('outbound')
  const [callDurationMin, setCallDurationMin] = useState<string>('')
  // «Записать на приём» — модалка из /schedule, переиспользованная.
  const [showBookingModal, setShowBookingModal] = useState(false)
  // «Получить предоплату» — отправка шаблона с Kaspi-ссылкой в WhatsApp.
  const [sendingPrepay, setSendingPrepay] = useState(false)
  const [sending, setSending] = useState(false)
  // Голосовое сообщение: MediaRecorder + UI-таймер.
  // Хранится в ref, чтобы не пересоздавать рекордер на каждый ререндер.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordStartRef = useRef<number>(0)
  const [recording, setRecording] = useState(false)
  const [recordSecs, setRecordSecs] = useState(0)
  const [sendingVoice, setSendingVoice] = useState(false)
  // Превью записанного голосового перед отправкой: можно прослушать,
  // потом нажать «Отправить» или «✕». blob храним отдельно, url — для <audio>.
  const [pendingVoice, setPendingVoice] = useState<{ blob: Blob; url: string; duration_s: number } | null>(null)
  // Защита кнопок «добавить» от двойного клика → дубликаты в БД.
  const [addingComment, setAddingComment] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
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
      .eq('kind', 'quick_reply')
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
    if (!form.pipeline_id || !form.stage_id) { notify.error('Выберите воронку и этап'); return }
    // If stage is 'lost' and no reason — prompt
    if (isLostStage && !form.loss_reason_id) {
      notify.error('Укажите причину отказа — этап помечен как «потеря».')
      return
    }

    // Валидация обязательных полей по конфигу.
    const formAsRecord = form as unknown as Record<string, unknown>
    const customFieldsObj = (form.custom_fields ?? {}) as Record<string, unknown>
    const { missing, blocking } = validateRequiredFields(
      fieldConfigs, formAsRecord, customFieldsObj, form.stage_id,
    )
    if (blocking.length > 0) {
      notify.error(
        'Нельзя сохранить: не заполнены обязательные поля с блокировкой — '
        + blocking.map(c => fieldDisplayLabel(c)).join(', ')
      )
      return
    }
    if (missing.length > 0) {
      const ok = await confirmAction({
        title: 'Не заполнены обязательные поля',
        message: missing.map(c => fieldDisplayLabel(c)).join(', ') + '\n\nСохранить всё равно?',
        confirmText: 'Сохранить',
      })
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
      birth_date: form.birth_date || null,
      notes: form.notes?.trim() || null,
      tags: form.tags ?? [],
      custom_fields: form.custom_fields ?? {},
    }
    const { error } = isNew
      ? await supabase.from('deals').insert(payload)
      : await supabase.from('deals').update(payload).eq('id', form.id)
    setSaving(false)
    if (error) { notify.error('Ошибка: ' + error.message); return }
    onSaved(isNew)
  }

  async function removeDeal() {
    if (isNew) return
    if (!(await confirmAction({
      title: 'Удалить сделку?',
      message: 'Она будет помечена удалённой (deleted_at) и попадёт в корзину.',
      confirmText: 'Удалить',
      danger: true,
    }))) return
    const { error } = await supabase.from('deals').update({ deleted_at: new Date().toISOString() }).eq('id', form.id)
    if (error) { notify.error(error.message); return }
    onSaved(true) // удаление — закрываем модалку
  }

  async function addComment() {
    const body = commentDraft.trim()
    if (!body || isNew || addingComment) return
    setAddingComment(true)
    try {
      const { error } = await supabase.from('deal_comments').insert({
        deal_id: form.id,
        clinic_id: form.clinic_id,
        body,
        author_id: profile?.id ?? null,
      })
      if (error) { notify.error(error.message); return }
      setCommentDraft('')
      loadRelated()
    } finally {
      setAddingComment(false)
    }
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
      if (!res.ok) { notify.error(json.error ?? 'Не удалось отправить'); setMsgDraft(body); return }
      // Дедуп по id: если Realtime позже принесёт ту же строку, выкинет её.
      const m = json.message as MessageRow | undefined
      if (m) {
        setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
      }
    } finally {
      setSending(false)
    }
  }

  // ─── Voice recording ────────────────────────────────────────────────
  // Алгоритм: getUserMedia → MediaRecorder (opus) → onstop собирает Blob →
  // POST FormData в /api/deals/:id/voice. Таймер тикает каждую секунду из
  // setInterval, чтобы UI не зависел от MediaRecorder.requestData().
  async function startRecording() {
    if (recording || sendingVoice || isNew) return
    // Проверяем поддержку — Safari < 14.1 не умеет MediaRecorder, в iOS < 17 нет ogg.
    if (typeof window === 'undefined' || !navigator.mediaDevices || !window.MediaRecorder) {
      notify.error('Браузер не поддерживает запись звука')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // Предпочитаем audio/ogg;codecs=opus (нативный WhatsApp PTT).
      // Fallback — webm/opus (Chrome старее), внутри тот же opus, файл переименуется в .ogg на сервере.
      const mime = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : ''
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      audioChunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      rec.onstop = async () => {
        // Останавливаем дорожки микрофона — иначе у юзера светится индикатор «идёт запись» в браузере.
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/ogg' })
        const duration_s = Math.round((Date.now() - recordStartRef.current) / 1000)
        if (blob.size < 1024 || duration_s < 1) {
          // Слишком короткая запись — скорее всего случайный клик.
          notify.error('Слишком короткая запись')
          return
        }
        // Не отправляем сразу — даём прослушать в превью.
        const url = URL.createObjectURL(blob)
        setPendingVoice({ blob, url, duration_s })
      }
      mediaRecorderRef.current = rec
      recordStartRef.current = Date.now()
      setRecordSecs(0)
      rec.start()
      setRecording(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'mic error'
      notify.error(`Не удалось включить микрофон: ${msg}`)
    }
  }

  function stopRecording(send: boolean) {
    const rec = mediaRecorderRef.current
    if (!rec) { setRecording(false); return }
    if (!send) {
      // Отмена: подменяем onstop на чистильщик.
      rec.onstop = () => {
        rec.stream.getTracks().forEach(t => t.stop())
        audioChunksRef.current = []
      }
    }
    if (rec.state !== 'inactive') rec.stop()
    setRecording(false)
    mediaRecorderRef.current = null
  }

  function discardPendingVoice() {
    if (pendingVoice) URL.revokeObjectURL(pendingVoice.url)
    setPendingVoice(null)
  }

  async function sendPendingVoice() {
    if (!pendingVoice) return
    const { blob, url, duration_s } = pendingVoice
    setPendingVoice(null)
    URL.revokeObjectURL(url)
    await uploadVoice(blob, duration_s)
  }

  async function uploadVoice(blob: Blob, duration_s: number) {
    if (isNew) return
    setSendingVoice(true)
    try {
      const fd = new FormData()
      fd.append('file', blob, 'voice.ogg')
      fd.append('duration_s', String(duration_s))
      const res = await fetch(`/api/deals/${form.id}/voice`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { notify.error(json.error ?? 'Не удалось отправить'); return }
      const m = json.message as MessageRow | undefined
      if (m) setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
    } finally {
      setSendingVoice(false)
    }
  }

  // Таймер UI: каждую секунду пока идёт запись.
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => {
      setRecordSecs(Math.round((Date.now() - recordStartRef.current) / 1000))
    }, 250)
    return () => clearInterval(t)
  }, [recording])

  async function sendPrepayRequest() {
    if (isNew || sendingPrepay) return
    const ok = await confirmAction({
      message: 'Отправить клиенту ссылку на предоплату в WhatsApp?',
      confirmText: 'Отправить',
    })
    if (!ok) return
    setSendingPrepay(true)
    try {
      const res = await fetch(`/api/deals/${form.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: PREPAY_REQUEST_MESSAGE, channel: 'whatsapp' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { notify.error(json.error ?? 'Не удалось отправить'); return }
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
        if (!res.ok) { notify.error(json.error ?? 'Не удалось сохранить примечание'); setMsgDraft(body); return }
        const m = json.message as MessageRow | undefined
        if (m) {
          setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]))
        }
        return
      }
      if (composerMode === 'call') {
        // Звонок: запись в crm_interactions + событие в timeline.
        const summary = body
        setMsgDraft('')
        const durMin = callDurationMin.trim() ? Number(callDurationMin) : null
        const duration_s = durMin != null && !Number.isNaN(durMin) && durMin >= 0
          ? Math.round(durMin * 60)
          : null
        const { error: iErr } = await supabase.from('crm_interactions').insert({
          clinic_id: form.clinic_id,
          deal_id: form.id,
          patient_id: form.patient_id,
          type: 'call',
          direction: callDirection,
          summary,
          duration_s,
          created_by: profile?.id ?? null,
        })
        if (iErr) { notify.error(iErr.message); setMsgDraft(body); return }
        // Событие в timeline. payload содержит то, что покажет таб «Хронология».
        await supabase.from('deal_events').insert({
          deal_id: form.id,
          clinic_id: form.clinic_id,
          kind: 'call_logged',
          actor_id: profile?.id ?? null,
          ref_table: 'crm_interactions',
          payload: { direction: callDirection, summary, duration_s },
        })
        setCallDurationMin('')
        loadRelated()
        return
      }
      if (composerMode === 'task') {
        setMsgDraft('')
        const assignee = composerTaskAssignee || profile?.id || null
        const { data: inserted, error } = await supabase.from('deal_tasks').insert({
          deal_id: form.id,
          clinic_id: form.clinic_id,
          title: body,
          due_at: composerTaskDue ? new Date(composerTaskDue).toISOString() : null,
          assignee_id: assignee,
          created_by: profile?.id ?? null,
        }).select('id, title, assignee_id, status').single()
        if (error) { notify.error(error.message); setMsgDraft(body); return }
        // Same-tab fallback: если Realtime-публикация не подцепилась, всё
        // равно звеним в текущем браузере. TaskNotifier слушает это событие.
        if (typeof window !== 'undefined' && inserted) {
          window.dispatchEvent(new CustomEvent('task:assigned', { detail: inserted }))
        }
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
    if (!title || isNew || addingTask) return
    setAddingTask(true)
    try {
      const { data: inserted, error } = await supabase.from('deal_tasks').insert({
        deal_id: form.id,
        clinic_id: form.clinic_id,
        title,
        due_at: newTaskDue ? new Date(newTaskDue).toISOString() : null,
        assignee_id: newTaskAssignee || null,
        created_by: profile?.id ?? null,
      }).select('id, title, assignee_id, status').single()
      if (error) { notify.error(error.message); return }
      if (typeof window !== 'undefined' && inserted) {
        // Same-tab fallback — независимо от того, подцепилась ли Realtime-публикация.
        window.dispatchEvent(new CustomEvent('task:assigned', { detail: inserted }))
      }
      setNewTaskTitle(''); setNewTaskDue(''); setNewTaskAssignee('')
      loadRelated()
    } finally {
      setAddingTask(false)
    }
  }

  async function toggleTask(t: TaskRow) {
    const next: TaskRow['status'] = t.status === 'done' ? 'open' : 'done'
    const { error } = await supabase.from('deal_tasks').update({
      status: next,
      completed_at: next === 'done' ? new Date().toISOString() : null,
      completed_by: next === 'done' ? profile?.id ?? null : null,
    }).eq('id', t.id)
    if (error) { notify.error(error.message); return }
    loadRelated()
  }

  async function deleteTask(t: TaskRow) {
    if (!(await confirmAction({
      message: `Удалить задачу «${t.title}»?`,
      confirmText: 'Удалить',
      danger: true,
    }))) return
    const { error } = await supabase.from('deal_tasks').delete().eq('id', t.id)
    if (error) { notify.error(error.message); return }
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
      notify.error(
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
      case 'call_logged': {
        const dir = String(p.direction ?? '') === 'inbound' ? '📥 входящий' : '📤 исходящий'
        const dur = p.duration_s != null
          ? ` · ${Math.round(Number(p.duration_s) / 60)} мин`
          : ''
        const summary = String(p.summary ?? '')
        return `${dir}${dur}${summary ? ` · ${summary}` : ''}`
      }
      default:
        return ''
    }
  }

  const openTasksCount = tasks.filter(t => t.status === 'open').length

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch" onClick={onClose}>
      <div
        className="bg-gray-50 shadow-2xl w-full max-w-[1600px] ml-auto flex flex-col h-full overflow-hidden relative"
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
                      if (!(await confirmAction({
                        message: `Удалить ${unreadSelected.size} сообщений?`,
                        confirmText: 'Удалить',
                        danger: true,
                      }))) return
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
                  birth_date: () => (
                    <Field label={fieldDisplayLabel(fieldConfigs.find(c => c.field_key === 'birth_date')!) || 'День рождения'} required={reqFor('birth_date')}>
                      <input
                        type="date"
                        value={form.birth_date ?? ''}
                        onChange={e => setForm({ ...form, birth_date: e.target.value || null })}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                      />
                      {form.patient?.birth_date && form.birth_date == null && (
                        <p className="text-[11px] text-gray-400 mt-1">У пациента: {form.patient.birth_date}</p>
                      )}
                    </Field>
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
                      {/* Sticky банер с активными задачами сделки — висит сверху
                          чата, пока задача не будет закрыта (amoCRM-стиль).
                          Клик по зелёному кружку-чеку отмечает задачу выполненной. */}
                      {tasks.filter(t => t.status === 'open').length > 0 && (
                        <div className="flex-shrink-0 border-b border-gray-100 bg-white">
                          {tasks
                            .filter(t => t.status === 'open')
                            .sort((a, b) => {
                              // nulls last, раньше — выше
                              if (!a.due_at && !b.due_at) return 0
                              if (!a.due_at) return 1
                              if (!b.due_at) return -1
                              return a.due_at.localeCompare(b.due_at)
                            })
                            .map(t => {
                              // «Сегодня 11:30-12:00 для <пациента> · <title>»
                              const fmtWhen = (iso: string | null): string => {
                                if (!iso) return 'Без срока'
                                const d = new Date(iso)
                                const now = new Date()
                                const startOfDay = (x: Date) => {
                                  const c = new Date(x); c.setHours(0,0,0,0); return c
                                }
                                const dayDiff = Math.round(
                                  (startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000
                                )
                                const hhmm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                                const end = new Date(d.getTime() + 30 * 60_000)
                                const hhmm2 = end.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                                const slot = `${hhmm}-${hhmm2}`
                                if (dayDiff === 0)      return `Сегодня ${slot}`
                                if (dayDiff === 1)      return `Завтра ${slot}`
                                if (dayDiff === -1)     return `Вчера ${slot}`
                                if (dayDiff < 0)        return `Просрочено · ${d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit' })} ${hhmm}`
                                return `${d.toLocaleDateString('ru-RU', { day:'2-digit', month:'short' })} ${slot}`
                              }
                              const patientFirst = deal.patient?.full_name?.split(/\s+/)[1]
                                ?? deal.patient?.full_name?.split(/\s+/)[0]
                                ?? null
                              const isOverdue = t.due_at && new Date(t.due_at) < new Date()
                              return (
                                <div key={t.id}
                                  className={`flex items-center gap-3 px-4 py-2.5 border-l-4 ${
                                    isOverdue ? 'border-red-400 bg-red-50/40' : 'border-pink-400 bg-pink-50/30'
                                  }`}>
                                  {/* Clock icon */}
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                    className={isOverdue ? 'text-red-500 shrink-0' : 'text-pink-500 shrink-0'}>
                                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
                                    <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                                  </svg>
                                  <div className="flex-1 text-sm text-gray-800">
                                    <span>{fmtWhen(t.due_at)}</span>
                                    {patientFirst && <span> для {patientFirst}</span>}
                                  </div>
                                  {/* Complete button — «зелёный кружок с галочкой» как в амо */}
                                  <button onClick={() => toggleTask(t)}
                                    title="Выполнить задачу"
                                    className="shrink-0 w-6 h-6 rounded-full border-2 border-green-500 text-green-600 hover:bg-green-500 hover:text-white transition-colors flex items-center justify-center">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                      <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                                    </svg>
                                  </button>
                                  <span className="text-sm font-semibold text-gray-900 truncate max-w-[40%]">
                                    {t.title}
                                  </span>
                                </div>
                              )
                            })}
                        </div>
                      )}

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
                            // Обычное сообщение — входящее (серое) / исходящее (синее).
                            // Сообщения от приветственного бота (sender_type='bot') —
                            // отдельный фиолетовый стиль + иконка 🤖, чтобы менеджер
                            // сразу видел, где ответил автомат, а где он сам.
                            const isBot = m.sender_type === 'bot'
                            return (
                              <div key={`msg-${m.id}`} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                                  isBot
                                    ? 'bg-violet-50 border border-violet-200 text-gray-700 font-light'
                                    : m.direction === 'out'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-gray-900'
                                }`}>
                                  <div className={`flex items-center gap-1.5 mb-0.5 text-[10px] uppercase tracking-wider ${
                                    isBot ? 'text-violet-600' :
                                    m.direction === 'out' ? 'text-blue-100' : 'text-gray-500'
                                  }`}>
                                    {isBot && <span aria-label="Сообщение от бота">🤖</span>}
                                    {/* Для входящих показываем имя контакта из карточки (form.name).
                                        Если имени нет (только что созданная сделка) — fallback на external_sender/телефон. */}
                                    <span>
                                      {isBot
                                        ? 'Бот'
                                        : m.direction === 'in'
                                          ? (form.name?.trim() || m.external_sender || CHANNEL_LABEL[m.channel])
                                          : CHANNEL_LABEL[m.channel]}
                                    </span>
                                    {!isBot && m.direction === 'in' && form.contact_phone && (
                                      <span>· {form.contact_phone}</span>
                                    )}
                                    {m.author && !isBot && m.direction === 'out' && (
                                      <span>· {m.author.first_name} {m.author.last_name?.[0] ?? ''}</span>
                                    )}
                                    {m.external_sender && !isBot && m.direction === 'out' && (
                                      <span>· {m.external_sender}</span>
                                    )}
                                  </div>
                                  {/* Голосовое: рендерим <audio>, если в attachments[0].kind==='voice'.
                                      Иначе — обычный текст. */}
                                  {(() => {
                                    const att = (m.attachments?.[0] as { kind?: string; url?: string; duration_s?: number | null } | undefined)
                                    if (att?.kind === 'voice' && att.url) {
                                      return (
                                        <VoiceBubble
                                          url={att.url}
                                          duration_s={att.duration_s ?? null}
                                          direction={m.direction as 'in' | 'out'}
                                        />
                                      )
                                    }
                                    return <div className="whitespace-pre-wrap break-words">{m.body}</div>
                                  })()}
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

                        {composerMode === 'call' && (
                          <div className="px-3 pt-2 space-y-2 bg-amber-50 border-t border-amber-200">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="text-gray-500">направление:</span>
                              <button
                                type="button"
                                onClick={() => setCallDirection('outbound')}
                                className={`px-2 py-0.5 rounded-full border ${
                                  callDirection === 'outbound'
                                    ? 'bg-amber-600 text-white border-amber-600'
                                    : 'bg-white border-amber-200 text-gray-700'
                                }`}
                              >📤 исходящий</button>
                              <button
                                type="button"
                                onClick={() => setCallDirection('inbound')}
                                className={`px-2 py-0.5 rounded-full border ${
                                  callDirection === 'inbound'
                                    ? 'bg-amber-600 text-white border-amber-600'
                                    : 'bg-white border-amber-200 text-gray-700'
                                }`}
                              >📥 входящий</button>
                              <span className="text-gray-500 ml-2">длит., мин:</span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={callDurationMin}
                                onChange={e => setCallDurationMin(e.target.value)}
                                placeholder="—"
                                className="w-16 border border-amber-200 rounded px-2 py-0.5 bg-white"
                              />
                            </div>
                          </div>
                        )}

                        {/* Input + send */}
                        <div className="flex gap-2 p-3">
                          {recording ? (
                            // Режим записи: бегущий «эквалайзер» — наглядно, что мик активен.
                            <div className="flex-1 flex items-center gap-3 border border-red-200 rounded px-3 py-1.5 bg-red-50">
                              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                              <span className="text-sm text-red-700 font-mono tabular-nums">
                                {String(Math.floor(recordSecs / 60)).padStart(2, '0')}:{String(recordSecs % 60).padStart(2, '0')}
                              </span>
                              <span className="flex items-end gap-[3px] h-5 flex-1 min-w-0">
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(i => (
                                  <span
                                    key={i}
                                    className="w-[3px] bg-red-500/80 rounded-full animate-voice-bar"
                                    style={{
                                      animationDelay: `${(i % 7) * 0.09}s`,
                                      animationDuration: `${0.7 + (i % 5) * 0.12}s`,
                                    }}
                                  />
                                ))}
                              </span>
                              <span className="text-xs text-red-600/70 shrink-0">запись…</span>
                            </div>
                          ) : pendingVoice ? (
                            // Превью записанного голосового — можно прослушать перед отправкой.
                            <div className="flex-1 flex items-center gap-2 border border-blue-200 rounded px-3 py-1.5 bg-blue-50">
                              <audio controls src={pendingVoice.url} className="flex-1 h-8" />
                              <span className="text-xs text-blue-700/70 font-mono tabular-nums">
                                {String(Math.floor(pendingVoice.duration_s / 60)).padStart(2, '0')}:{String(pendingVoice.duration_s % 60).padStart(2, '0')}
                              </span>
                            </div>
                          ) : (
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
                                composerMode === 'call' ? 'О чём говорили: итог звонка, договорённости…' :
                                'Название задачи…'
                              }
                              rows={composerMode === 'task' ? 1 : 2}
                              className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm resize-none focus:border-blue-400 outline-none"
                            />
                          )}

                          {/* Микрофон — только в режиме чата (whatsapp). */}
                          {composerMode === 'chat' && (
                            recording ? (
                              <>
                                <button
                                  onClick={() => stopRecording(false)}
                                  title="Отменить запись"
                                  className="self-end px-3 py-1.5 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                                >
                                  ✕
                                </button>
                                <button
                                  onClick={() => stopRecording(true)}
                                  title="Остановить запись (можно будет прослушать)"
                                  className="self-end px-4 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white"
                                >
                                  ⏹ Стоп
                                </button>
                              </>
                            ) : pendingVoice ? (
                              <>
                                <button
                                  onClick={discardPendingVoice}
                                  title="Удалить и записать заново"
                                  className="self-end px-3 py-1.5 text-sm rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                                >
                                  ✕
                                </button>
                                <button
                                  onClick={sendPendingVoice}
                                  disabled={sendingVoice}
                                  title="Отправить голосовое"
                                  className="self-end px-4 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                                >
                                  {sendingVoice ? '…' : '▶ Отправить'}
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={startRecording}
                                disabled={sendingVoice || sending || !!msgDraft.trim()}
                                title={msgDraft.trim() ? 'Очистите текст, чтобы записать голосовое' : 'Записать голосовое'}
                                className="self-end px-3 py-1.5 text-base rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                {sendingVoice ? '…' : '🎙'}
                              </button>
                            )
                          )}

                          {!recording && !pendingVoice && (
                            <button
                              onClick={submitComposer}
                              disabled={!msgDraft.trim() || sending}
                              className="self-end px-4 py-1.5 text-sm text-white rounded bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-gray-400"
                            >
                              {sending ? '…' :
                               composerMode === 'chat' ? 'Отправить' :
                               composerMode === 'note' ? 'Сохранить' :
                               composerMode === 'call' ? 'Записать звонок' :
                               'Поставить'}
                            </button>
                          )}
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
                          disabled={!commentDraft.trim() || addingComment}
                          className="self-start px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded"
                        >
                          {addingComment ? '…' : 'Отправить'}
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
                            disabled={!newTaskTitle.trim() || addingTask}
                            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded"
                          >
                            {addingTask ? '…' : '+'}
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

type ComposerMode = 'chat' | 'note' | 'task' | 'call'
const COMPOSER_MODES: { value: ComposerMode; label: string; icon: string }[] = [
  { value: 'chat', label: 'Чат',        icon: '💬' },
  { value: 'note', label: 'Примечание', icon: '📝' },
  { value: 'task', label: 'Задача',     icon: '✅' },
  { value: 'call', label: 'Звонок',     icon: '📞' },
]

function ComposerModeDropdown({
  value,
  onChange,
}: {
  value: ComposerMode
  onChange: (m: ComposerMode) => void
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
  allStages,
  pipelines,
  users,
  sources,
  onMoveStage,
  onMovePipeline,
  onAssign,
  onDelete,
  onAddTask,
  onEditTags,
  onEditField,
  onCancel,
}: {
  count: number
  stages: Stage[]
  // Все этапы клиники — для смены воронки в одной операции.
  allStages: Stage[]
  pipelines: Pipeline[]
  users: UserLite[]
  sources: Array<{ id: string; name: string }>
  onMoveStage: (stageId: string) => Promise<void>
  onMovePipeline: (pipelineId: string) => Promise<void>
  onAssign: (userId: string) => Promise<void>
  onDelete: () => void | Promise<void>
  onAddTask: (p: { title: string; dueAt: string | null; assignedTo: string | null }) => Promise<void>
  onEditTags: (p: { addList?: string[]; removeList?: string[]; replaceList?: string[] }) => Promise<void>
  onEditField: (p: { field: 'amount' | 'source_id' | 'city'; value: string | null }) => Promise<void>
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  // Локальный стейт для модалок внутри панели — всё inline, без
  // отдельного компонента, чтобы не тащить props через три уровня.
  const [openMenu, setOpenMenu] = useState<null | 'task' | 'tags' | 'field'>(null)
  // Пока не отмечена ни одна сделка — все action-кнопки неактивны.
  // Режим уже виден (сама плашка), а в подписи — подсказка.
  const empty = count === 0
  const noop = busy || empty
  async function wrap(fn: () => void | Promise<void>) {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <>
      <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-50 bg-gray-900 text-white rounded-xl shadow-2xl flex items-center gap-2 px-3 py-2">
        <span className="text-sm font-medium px-1">
          {empty ? 'Отметьте сделки галочками' : `Выбрано: ${count}`}
        </span>
        <div className="w-px h-5 bg-white/20 mx-1" />

        <button
          type="button"
          disabled={noop}
          onClick={() => setOpenMenu('task')}
          className="text-xs px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-white/10 disabled:opacity-60"
        >
          + Задача
        </button>

        <select
          disabled={noop}
          defaultValue=""
          onChange={e => {
            const v = e.target.value
            e.currentTarget.value = ''
            if (v) wrap(() => onMoveStage(v))
          }}
          className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-white/10 disabled:opacity-60"
          title="Перенести в этап (любой воронки)"
        >
          <option value="" disabled>Изм. этап</option>
          {/* Группируем по воронкам, чтобы можно было переносить
              между воронками одним действием. pipeline_id обновится
              автоматически (см. onMoveStage в page-level). */}
          {pipelines.filter(p => p.is_active).map(p => {
            const stagesInPipe = allStages
              .filter(s => s.pipeline_id === p.id && s.is_active)
              .sort((a, b) => a.sort_order - b.sort_order)
            if (stagesInPipe.length === 0) return null
            return (
              <optgroup key={p.id} label={p.name}>
                {stagesInPipe.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )
          })}
        </select>

        <select
          disabled={noop}
          defaultValue=""
          onChange={e => {
            const v = e.target.value
            e.currentTarget.value = ''
            if (v) wrap(() => onMovePipeline(v))
          }}
          className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-white/10 disabled:opacity-60"
          title="Перенести в воронку (на её первый этап)"
        >
          <option value="" disabled>Изм. воронку</option>
          {pipelines.filter(p => p.is_active).map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <button
          type="button"
          disabled={noop}
          onClick={() => setOpenMenu('field')}
          className="text-xs px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-white/10 disabled:opacity-60"
        >
          Изм. поле
        </button>

        <button
          type="button"
          disabled={noop}
          onClick={() => setOpenMenu('tags')}
          className="text-xs px-2.5 py-1.5 rounded bg-gray-800 hover:bg-gray-700 border border-white/10 disabled:opacity-60"
        >
          Ред. теги
        </button>

        <select
          disabled={noop}
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
          disabled={noop}
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

      {openMenu === 'task' && (
        <BulkAddTaskModal
          count={count}
          users={users}
          onCancel={() => setOpenMenu(null)}
          onConfirm={async (p) => { setOpenMenu(null); await wrap(() => onAddTask(p)) }}
        />
      )}
      {openMenu === 'tags' && (
        <BulkEditTagsModal
          count={count}
          onCancel={() => setOpenMenu(null)}
          onConfirm={async (p) => { setOpenMenu(null); await wrap(() => onEditTags(p)) }}
        />
      )}
      {openMenu === 'field' && (
        <BulkEditFieldModal
          count={count}
          sources={sources}
          onCancel={() => setOpenMenu(null)}
          onConfirm={async (p) => { setOpenMenu(null); await wrap(() => onEditField(p)) }}
        />
      )}
    </>
  )
}

// ─── Модалки массовых действий ────────────────────────────────────────────────

/**
 * Подтверждение массового soft-delete сделок.
 *
 * Зачем typed-confirm, а не обычный confirm():
 * - реальный кейс: менеджер случайно выделил всю воронку (278 сделок)
 *   и снёс одним кликом, восстанавливать пришлось через SQL;
 * - native confirm() слишком легко проскочить «по инерции» (Enter).
 *
 * Кнопка «Удалить» активна только когда юзер ввёл «УДАЛИТЬ» строго
 * заглавными — это даёт паузу подумать.
 */
function BulkDeleteConfirmModal({
  count, onCancel, onConfirm,
}: {
  count: number
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = typed === 'УДАЛИТЬ'
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-red-700">
            Удалить {count} сделок?
          </h3>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none disabled:opacity-50"
          >×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-gray-700">
            Сделки пропадут из канбана и таблицы. Они останутся в БД (soft-delete) —
            восстановить можно из «Корзины».
          </p>
          <p className="text-gray-700">
            Чтобы подтвердить, введите{' '}
            <code className="px-1 py-0.5 bg-gray-100 rounded font-mono text-xs">УДАЛИТЬ</code>:
          </p>
          <input
            autoFocus
            value={typed}
            onChange={e => setTyped(e.target.value)}
            disabled={busy}
            placeholder="УДАЛИТЬ"
            className="w-full border border-gray-200 rounded px-2 py-1.5 font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true)
              try { await onConfirm() } finally { setBusy(false) }
            }}
            className="px-4 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:bg-red-300 disabled:cursor-not-allowed"
          >
            {busy ? 'Удаляю…' : `Удалить ${count}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Глобальный поиск сделки по телефону.
 *
 * Сценарий: менеджеру звонит клиент, надо за секунду найти его карточку.
 * Стандартный поиск на /crm работает только по уже загруженным 1000
 * сделкам и в рамках активной воронки — этого мало. Здесь идём прямо в
 * БД по контакт-телефону сделки И по массиву телефонов пациента.
 */
function PhoneSearchModal({
  clinicId,
  onCancel,
  onPick,
}: {
  clinicId: string
  onCancel: () => void
  onPick: (d: DealRow) => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DealRow[]>([])
  const [loading, setLoading] = useState(false)

  // Цифры из ввода — для сравнения. Работаем только с phoneNorm длиной >= 4.
  const digits = query.replace(/\D+/g, '').replace(/^8/, '7')

  useEffect(() => {
    if (digits.length < 4) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      // 1. По contact_phone сделки.
      const { data: byContact } = await supabase
        .from('deals')
        .select(`
          id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel,
          status, responsible_user_id, source_id, amount, preferred_doctor_id,
          appointment_type, loss_reason_id, contact_phone, contact_city, birth_date, notes,
          tags, custom_fields, stage_entered_at, created_at, updated_at,
          patient:patients(id, full_name, phones, birth_date, city),
          responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name)
        `)
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .ilike('contact_phone', `%${digits}%`)
        .order('updated_at', { ascending: false })
        .limit(20)

      // 2. По phones пациента (если совпало с пациентом — берём все его сделки).
      const { data: patients } = await supabase
        .from('patients')
        .select('id')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .contains('phones', [digits])
        .limit(20)
      const patientIds = (patients ?? []).map(p => p.id)
      let byPatient: DealRow[] = []
      if (patientIds.length > 0) {
        const { data: dealsByPat } = await supabase
          .from('deals')
          .select(`
            id, clinic_id, name, patient_id, pipeline_id, stage_id, stage, funnel,
            status, responsible_user_id, source_id, amount, preferred_doctor_id,
            appointment_type, loss_reason_id, contact_phone, contact_city, birth_date, notes,
            tags, custom_fields, stage_entered_at, created_at, updated_at,
            patient:patients(id, full_name, phones, birth_date, city),
            responsible:user_profiles!deals_responsible_user_id_fkey(id, first_name, last_name)
          `)
          .eq('clinic_id', clinicId)
          .is('deleted_at', null)
          .in('patient_id', patientIds)
          .order('updated_at', { ascending: false })
          .limit(40)
        byPatient = (dealsByPat ?? []) as unknown as DealRow[]
      }

      if (cancelled) return
      // Дедуп по id.
      const merged = new Map<string, DealRow>()
      for (const d of (byContact ?? []) as unknown as DealRow[]) merged.set(d.id, d)
      for (const d of byPatient) merged.set(d.id, d)
      setResults(Array.from(merged.values()).slice(0, 30))
      setLoading(false)
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [supabase, clinicId, digits])

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-start justify-center p-4 pt-24"
      onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white rounded-xl w-full max-w-xl shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">📞 Поиск по телефону</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-4">
          <input
            autoFocus
            type="tel"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="+7 ..."
            className="w-full border border-gray-200 rounded px-3 py-2 font-mono text-base focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="mt-2 text-xs text-gray-500">
            Ищет среди ВСЕХ сделок клиники, во всех воронках. Включая совпадения по телефонам пациента.
          </p>
        </div>
        <div className="max-h-[50vh] overflow-y-auto border-t border-gray-100">
          {digits.length < 4 && (
            <div className="px-5 py-6 text-center text-sm text-gray-400">
              Введите минимум 4 цифры.
            </div>
          )}
          {digits.length >= 4 && loading && (
            <div className="px-5 py-6 text-center text-sm text-gray-400">Ищу…</div>
          )}
          {digits.length >= 4 && !loading && results.length === 0 && (
            <div className="px-5 py-6 text-center text-sm text-gray-400">
              Ничего не найдено.
            </div>
          )}
          {results.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => onPick(d)}
              className="w-full text-left px-5 py-2.5 hover:bg-emerald-50 border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-gray-900 truncate">
                  {d.name ?? d.patient?.full_name ?? '(без имени)'}
                </span>
                <span className="text-xs text-gray-500 font-mono shrink-0">
                  {d.contact_phone ?? d.patient?.phones?.[0] ?? '—'}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-gray-500 truncate">
                {d.patient?.full_name ?? '—'}
                {d.responsible && ` · ${d.responsible.first_name} ${d.responsible.last_name ?? ''}`}
                {d.amount != null && ` · ${d.amount.toLocaleString('ru-RU')} ₸`}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Быстрое создание сделки: имя + телефон → готово.
 *
 * Логика:
 * - нормализуем телефон (только цифры, 8 → 7),
 * - ищем пациента по phone в массиве phones; если есть — линкуем,
 * - если нет — создаём пациента с full_name = «имя» из формы,
 * - создаём сделку в первом активном этапе текущей воронки,
 *   ответственный — текущий пользователь.
 *
 * Для повседневной работы менеджера: входящий звонок → 5 секунд
 * на ввод → сделка в работе. Полный DealModal — для деталей.
 */
function QuickCreateDealModal({
  clinicId,
  pipelineId,
  stageId,
  stageCode,
  funnelCode,
  responsibleId,
  onCancel,
  onCreated,
}: {
  clinicId: string
  pipelineId: string | null
  stageId: string | null
  stageCode: string | null
  funnelCode: string
  responsibleId: string | null
  onCancel: () => void
  onCreated: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function normalizePhone(raw: string): string {
    const digits = (raw ?? '').replace(/\D+/g, '')
    if (digits.length < 7) return ''
    return digits.replace(/^8/, '7')
  }

  async function submit() {
    setErr(null)
    const cleanName = name.trim()
    const phoneNorm = normalizePhone(phone)
    if (!cleanName) { setErr('Введите имя.'); return }
    if (!phoneNorm) { setErr('Введите телефон (минимум 7 цифр).'); return }
    if (!stageId || !pipelineId) { setErr('В воронке нет этапов.'); return }

    setBusy(true)
    try {
      // 1. Ищем пациента по телефону.
      const { data: existing, error: selErr } = await supabase
        .from('patients')
        .select('id, full_name, phones')
        .eq('clinic_id', clinicId)
        .contains('phones', [phoneNorm])
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (selErr && selErr.code !== 'PGRST116') throw selErr

      let patientId: string
      if (existing) {
        patientId = existing.id
      } else {
        // 2. Создаём пациента.
        const { data: created, error: insErr } = await supabase
          .from('patients')
          .insert({
            clinic_id: clinicId,
            full_name: cleanName,
            phones: [phoneNorm],
          })
          .select('id')
          .single()
        if (insErr) throw insErr
        patientId = created.id
      }

      // 3. Создаём сделку.
      const { error: dealErr } = await supabase.from('deals').insert({
        clinic_id: clinicId,
        name: cleanName,
        patient_id: patientId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        stage: stageCode,
        funnel: funnelCode,
        status: 'open',
        responsible_user_id: responsibleId,
        contact_phone: phoneNorm,
      })
      if (dealErr) throw dealErr

      onCreated()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget && !busy) onCancel() }}
    >
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">⚡ Быстрая сделка</h3>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none disabled:opacity-50"
          >×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <label className="block">
            <span className="text-gray-600">Имя пациента *</span>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={busy}
              placeholder="Иванов Иван"
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
          </label>
          <label className="block">
            <span className="text-gray-600">Телефон *</span>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              disabled={busy}
              placeholder="+7 ..."
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5 font-mono"
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
            />
          </label>
          <p className="text-xs text-gray-500">
            Если пациент с таким телефоном уже есть — сделка прилинкуется к нему.
            Иначе создастся новый пациент.
          </p>
          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {err}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 rounded-md border border-gray-200 hover:bg-gray-50 text-sm text-gray-700 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Создаю…' : 'Создать сделку'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkAddTaskModal({
  count, users, onCancel, onConfirm,
}: {
  count: number
  users: UserLite[]
  onCancel: () => void
  onConfirm: (p: { title: string; dueAt: string | null; assignedTo: string | null }) => void
}) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [assignedTo, setAssignedTo] = useState<string>('')
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Добавить задачу в {count} сделок</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <label className="block">
            <span className="text-gray-600">Название</span>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
              placeholder="Например: Перезвонить"
            />
          </label>
          <label className="block">
            <span className="text-gray-600">Срок (необязательно)</span>
            <input
              type="datetime-local"
              value={due}
              onChange={e => setDue(e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="text-gray-600">Ответственный за задачу</span>
            <select
              value={assignedTo}
              onChange={e => setAssignedTo(e.target.value)}
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
            >
              <option value="">— как у сделки —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>
                  {`${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Отмена</button>
          <button
            disabled={!title.trim()}
            onClick={() => onConfirm({
              title: title.trim(),
              dueAt: due ? new Date(due).toISOString() : null,
              assignedTo: assignedTo || null,
            })}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60"
          >
            Создать {count} задач
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkEditTagsModal({
  count, onCancel, onConfirm,
}: {
  count: number
  onCancel: () => void
  onConfirm: (p: { addList?: string[]; removeList?: string[]; replaceList?: string[] }) => void
}) {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [addRaw, setAddRaw] = useState('')
  const [removeRaw, setRemoveRaw] = useState('')
  const [replaceRaw, setReplaceRaw] = useState('')
  const parse = (s: string) => s.split(/[,;]/).map(t => t.trim()).filter(Boolean)
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Теги для {count} сделок</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              Добавить / удалить
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              Заменить целиком
            </label>
          </div>
          {mode === 'merge' ? (
            <>
              <label className="block">
                <span className="text-gray-600">Добавить теги (через запятую)</span>
                <input
                  value={addRaw}
                  onChange={e => setAddRaw(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
                  placeholder="vip, повторный"
                />
              </label>
              <label className="block">
                <span className="text-gray-600">Удалить теги (через запятую)</span>
                <input
                  value={removeRaw}
                  onChange={e => setRemoveRaw(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
                  placeholder="холодный"
                />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-gray-600">Новый набор тегов (через запятую)</span>
              <input
                value={replaceRaw}
                onChange={e => setReplaceRaw(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
                placeholder="vip, чекап"
              />
            </label>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Отмена</button>
          <button
            onClick={() => {
              if (mode === 'replace') onConfirm({ replaceList: parse(replaceRaw) })
              else onConfirm({ addList: parse(addRaw), removeList: parse(removeRaw) })
            }}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkEditFieldModal({
  count, sources, onCancel, onConfirm,
}: {
  count: number
  sources: Array<{ id: string; name: string }>
  onCancel: () => void
  onConfirm: (p: { field: 'amount' | 'source_id' | 'city'; value: string | null }) => void
}) {
  const [field, setField] = useState<'amount' | 'source_id' | 'city'>('amount')
  const [value, setValue] = useState('')
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Изменить поле в {count} сделках</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <label className="block">
            <span className="text-gray-600">Поле</span>
            <select
              value={field}
              onChange={e => { setField(e.target.value as typeof field); setValue('') }}
              className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
            >
              <option value="amount">Сумма</option>
              <option value="source_id">Источник</option>
              <option value="city">Город</option>
            </select>
          </label>
          <label className="block">
            <span className="text-gray-600">Новое значение</span>
            {field === 'source_id' ? (
              <select
                value={value}
                onChange={e => setValue(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
              >
                <option value="">— очистить —</option>
                {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : field === 'amount' ? (
              <input
                type="number"
                step="0.01"
                value={value}
                onChange={e => setValue(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
                placeholder="Пусто = очистить"
              />
            ) : (
              <input
                value={value}
                onChange={e => setValue(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded px-2 py-1.5"
                placeholder="Пусто = очистить"
              />
            )}
          </label>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Отмена</button>
          <button
            onClick={() => onConfirm({ field, value: value || null })}
            className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
          >
            Применить
          </button>
        </div>
      </div>
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
  stages,
  onClose,
  onDone,
}: {
  clinicId: string
  pipelineId: string
  defaultStageId: string | null
  stages: Stage[]
  onClose: () => void
  onDone: () => void
}) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState<string>('')
  const [detectedHeaders, setDetectedHeaders] = useState<
    { raw: string; mapped: string }[]
  >([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // Все воронки и этапы клиники — нужны для ручного маппинга этапов из CSV
  // на реальные этапы выбранной воронки (автоматический матч по имени
  // не работает, если в CRM названия сокращены, напр. «Назн 1 конс»
  // vs «НАЗНАЧЕНО ПЕРВИЧНАЯ КОНСУЛЬТАЦИЯ»).
  const [allPipelines, setAllPipelines] = useState<{ id: string; name: string }[]>([])
  const [allStagesState, setAllStagesState] = useState<
    { id: string; name: string; pipeline_id: string }[]
  >(stages.map(s => ({ id: s.id, name: s.name, pipeline_id: s.pipeline_id })))
  const [targetPipelineId, setTargetPipelineId] = useState<string>(pipelineId)
  // Ручной маппинг: CSV-имя этапа → stageId в targetPipelineId
  // (null = «в первый этап воронки»).
  const [stageMap, setStageMap] = useState<Record<string, string | null>>({})
  const [report, setReport] = useState<{
    total: number
    foundByPhone: number
    foundByName: number
    patientsCreated: number
    dealsCreated: number
    dealsUpdated: number
    dealsSkippedDeleted: number
    stageMatched: number
    stageFallback: number
    responsibleMatched: number
    skipped: number
    unrecognizedHeaders: string[]
    unknownStages: string[]
    unknownResponsibles: string[]
    unknownPipelines: string[]
    errors: string[]
    dbDistribution: { pipeline: string; count: number }[]
  } | null>(null)

  // Если родитель сменил активную воронку (пользователь кликнул другую
  // вкладку прямо во время открытой модалки) — синхронизируем выбор
  // воронки импорта с UI. useState<>(pipelineId) ловит только initial,
  // поэтому без эффекта state «застывает» на первом значении.
  useEffect(() => {
    setTargetPipelineId(pipelineId)
  }, [pipelineId])

  // Один раз подгружаем воронки и все этапы клиники, чтобы UI мог
  // предложить ручной маппинг CSV-этапов.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: pls }, { data: sts }] = await Promise.all([
        supabase.from('pipelines').select('id, name').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('pipeline_stages').select('id, name, pipeline_id').eq('is_active', true).order('sort_order'),
      ])
      if (cancelled) return
      if (pls) setAllPipelines(pls)
      if (sts) setAllStagesState(sts)
    })()
    return () => { cancelled = true }
  }, [supabase, clinicId])

  // Уникальные имена этапов, встретившиеся в CSV (в исходном регистре).
  const uniqueCsvStages = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of rows) {
      const s = (r['stage'] ?? '').trim()
      if (!s || seen.has(s)) continue
      seen.add(s)
      out.push(s)
    }
    return out
  }, [rows])

  // Инициализируем/пересчитываем stageMap при смене файла или воронки:
  // пытаемся автоматически сопоставить по имени, иначе — null (первый этап).
  useEffect(() => {
    if (uniqueCsvStages.length === 0) { setStageMap({}); return }
    const pipelineStages = allStagesState.filter(s => s.pipeline_id === targetPipelineId)
    const byNorm = new Map(pipelineStages.map(s => [normalizeName(s.name), s.id]))
    const next: Record<string, string | null> = {}
    for (const raw of uniqueCsvStages) {
      const needle = normalizeName(raw)
      const auto = byNorm.get(needle)
        ?? allStagesState.find(s => normalizeName(s.name) === needle && s.pipeline_id === targetPipelineId)?.id
      next[raw] = auto ?? null
    }
    setStageMap(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueCsvStages, targetPipelineId, allStagesState])

  // Нормализация заголовков столбцов: кириллица/пробелы/регистр → канонические ключи.
  // AmoCRM экспортирует с развёрнутыми названиями («Название сделки», «Основной
  // контакт», «Рабочий телефон» и т.д.) — поддерживаем все распространённые
  // варианты, чтобы менеджер не правил файл вручную перед импортом.
  const ALIASES: Record<string, string> = {
    // name — название сделки
    'название': 'name', 'название сделки': 'name', 'сделка': 'name', 'name': 'name',
    // patient — ФИО контакта
    'пациент': 'patient', 'фио': 'patient', 'полное имя': 'patient',
    'контакт': 'patient', 'основной контакт': 'patient', 'patient': 'patient',
    'полное имя контакта': 'patient', 'фио контакта': 'patient',
    // phone — любой из телефонов amoCRM
    'телефон': 'phone', 'рабочий телефон': 'phone', 'мобильный': 'phone',
    'мобильный телефон': 'phone', 'контактный телефон': 'phone',
    'основной телефон': 'phone', 'phone': 'phone', 'tel': 'phone',
    // city
    'город': 'city', 'city': 'city',
    // amount — сумма/бюджет сделки
    'сумма': 'amount', 'сумма сделки': 'amount', 'бюджет': 'amount',
    'стоимость': 'amount', 'amount': 'amount', 'budget': 'amount',
    // notes — заметка/комментарий/описание
    'заметка': 'notes', 'примечание': 'notes', 'комментарий': 'notes',
    'описание': 'notes', 'notes': 'notes',
    // tags
    'теги': 'tags', 'tags': 'tags',
    // birth_date — дата рождения пациента (формат DD.MM.YYYY)
    'дата рождения': 'birth_date', 'др': 'birth_date',
    'birth date': 'birth_date', 'birthday': 'birth_date', 'birth_date': 'birth_date',
    // created_at — дата создания сделки в amoCRM
    'date': 'created_at', 'дата создания сделки': 'created_at',
    'дата создания': 'created_at', 'created at': 'created_at',
    'created_at': 'created_at', 'created': 'created_at',
    // external_id — ID сделки во внешней системе, для upsert при повторном импорте.
    'id': 'external_id', 'id сделки': 'external_id',
    'id amocrm': 'external_id', 'id амо': 'external_id', 'id амокрм': 'external_id',
    'внешний id': 'external_id', 'external_id': 'external_id', 'external id': 'external_id',
    // stage — этап сделки, мапим на существующий pipeline_stage по названию
    'этап': 'stage', 'этап сделки': 'stage', 'стадия': 'stage',
    'статус': 'stage', 'stage': 'stage', 'status': 'stage',
    // pipeline — воронка, ищем по имени среди пайплайнов клиники
    'воронка': 'pipeline', 'pipeline': 'pipeline',
    // responsible — ответственный менеджер (попытаемся найти user_profile)
    'ответственный': 'responsible', 'ответственный за сделку': 'responsible',
    'менеджер': 'responsible', 'responsible': 'responsible', 'owner': 'responsible',
  }

  // Нормализация телефона: цифры, ведущая 8 → 7, убираем + и спецсимволы.
  // Результат — строка из цифр, например '77071234567'. Пустую строку
  // возвращаем, если нет хотя бы 7 цифр (значит это не телефон).
  function normalizePhone(raw: string): string {
    const digits = (raw ?? '').replace(/\D+/g, '')
    if (digits.length < 7) return ''
    return digits.replace(/^8/, '7')
  }

  function normalizeName(raw: string): string {
    // Толерантная нормализация: lowercase + убираем пунктуацию
    // (двоеточия, тире, скобки, точки, кавычки, emoji и т.п.) +
    // схлопываем пробелы. Нужно, чтобы «Назначено: первичная
    // консультация» и «НАЗНАЧЕНО ПЕРВИЧНАЯ КОНСУЛЬТАЦИЯ» матчились
    // на один и тот же этап. Оставляем только буквы (включая
    // кириллицу) и цифры.
    return (raw ?? '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ')
  }

  // Парсинг даты рождения из формата DD.MM.YYYY (как экспортирует amoCRM /
  // Google Sheets) в ISO YYYY-MM-DD для колонки patients.birth_date (DATE).
  // Также принимаем DD/MM/YYYY и DD-MM-YYYY. Невалидная/пустая → null.
  function parseBirthDate(raw: string): string | null {
    const s = (raw ?? '').trim()
    if (!s) return null
    const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/)
    if (!m) return null
    const [, d, mo, y] = m
    const dd = d.padStart(2, '0')
    const mm = mo.padStart(2, '0')
    const yy = Number(y)
    const di = Number(dd), mi = Number(mm)
    if (yy < 1900 || yy > 2100) return null
    if (mi < 1 || mi > 12) return null
    if (di < 1 || di > 31) return null
    return `${y}-${mm}-${dd}`
  }

  // Парсинг даты-времени создания сделки из amoCRM / Google Sheets.
  // Принимаем DD.MM.YYYY [HH:MM[:SS]] (а также через «/» или «-»),
  // и уже готовые ISO-строки. Возвращаем ISO с таймзоной +05:00
  // (Казахстан), чтобы Postgres сохранил правильный момент времени.
  function parseCreatedAt(raw: string): string | null {
    const s = (raw ?? '').trim()
    if (!s) return null
    // Уже ISO? Оставляем как есть — Postgres разберёт.
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s
    const m = s.match(
      /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    )
    if (!m) return null
    const [, d, mo, y, hh, mm2, ss] = m
    const yy = Number(y)
    const mi = Number(mo)
    const di = Number(d)
    if (yy < 1900 || yy > 2100) return null
    if (mi < 1 || mi > 12) return null
    if (di < 1 || di > 31) return null
    const H = (hh ?? '00').padStart(2, '0')
    const M = (mm2 ?? '00').padStart(2, '0')
    const S = (ss ?? '00').padStart(2, '0')
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${H}:${M}:${S}+05:00`
  }

  function parseCsv(text: string): {
    rows: Record<string, string>[]
    headers: { raw: string; mapped: string }[]
  } {
    // Простой CSV parser: ; или , как разделитель, двойные кавычки.
    // AmoCRM/Google Sheets умудряется класть РАЗНЫЕ разделители в
    // заголовок и в тело (заголовок через «,», данные через «;» — или
    // наоборот). Поэтому сначала режем текст на логические строки с
    // учётом кавычек, потом детектим разделитель ОТДЕЛЬНО для заголовка
    // и для данных, и каждую строку парсим своим разделителем.
    const rawLines: string[] = []
    {
      let buf = ''
      let inQ = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"') {
          if (inQ && text[i + 1] === '"') { buf += '""'; i++ }
          else { inQ = !inQ; buf += '"' }
        } else if (!inQ && ch === '\n') {
          rawLines.push(buf)
          buf = ''
        } else if (ch === '\r' && !inQ) {
          // skip
        } else {
          buf += ch
        }
      }
      if (buf.length) rawLines.push(buf)
    }
    const nonEmpty = rawLines.filter(l => l.trim().length > 0)
    if (nonEmpty.length === 0) return { rows: [], headers: [] }

    const pickDelim = (s: string): ',' | ';' => {
      const stripped = s.replace(/"[^"]*"/g, '')
      const semi = (stripped.match(/;/g)?.length ?? 0)
      const comma = (stripped.match(/,/g)?.length ?? 0)
      return semi > comma ? ';' : ','
    }
    const headerDelim = pickDelim(nonEmpty[0])
    const dataDelim = pickDelim(nonEmpty.slice(1, 21).join('\n'))

    const splitLine = (line: string, delim: string): string[] => {
      const out: string[] = []
      let cell = ''
      let inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (inQ) {
          if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++ }
          else if (ch === '"') { inQ = false }
          else { cell += ch }
        } else {
          if (ch === '"') inQ = true
          else if (ch === delim) { out.push(cell); cell = '' }
          else { cell += ch }
        }
      }
      out.push(cell)
      return out
    }

    const headerRow = splitLine(nonEmpty[0], headerDelim)
    const lines: string[][] = nonEmpty.slice(1).map(l => splitLine(l, dataDelim))
    // Нормализация заголовка: BOM → _ в пробел → пробелы → lowercase → collapse.
    // Подчёркивание в `_` → пробел, чтобы `id_amoCRM` и `дата_рождения`
    // (формат Google Sheets export) ловились теми же alias'ами, что
    // `id amoCRM` и `дата рождения`.
    const rawHeaders = headerRow.map(h =>
      h.replace(/^\uFEFF/, '').trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase()
    )
    const headers = rawHeaders.map(resolveHeader)
    const parsed = lines
      .filter(r => r.some(c => c.trim().length > 0))
      .map(r => {
        const obj: Record<string, string> = {}
        headers.forEach((h, i) => {
          const val = (r[i] ?? '').trim()
          if (!val) return
          if (!obj[h]) { obj[h] = val; return }
          // Несколько CSV-колонок на один канонический ключ:
          //   phone — БЕРЁМ ПЕРВЫЙ непустой (иначе normalizePhone склеит
          //     цифры двух разных номеров в мусор).
          //   notes — несколько «Примечание N» склеиваем через " | ".
          //   patient — «Имя» + «Фамилия» склеиваем через пробел.
          //   прочее — первое значение побеждает.
          if (h === 'phone') return
          if (h === 'notes') obj[h] = `${obj[h]} | ${val}`
          else if (h === 'patient') obj[h] = `${obj[h]} ${val}`
          // остальные каноны — оставляем первое (не перетираем)
        })
        return obj
      })
    const mapping = rawHeaders.map((raw, i) => ({ raw, mapped: headers[i] }))
    return { rows: parsed, headers: mapping }
  }

  // Определяем канонический ключ колонки. Сначала точное совпадение по
  // ALIASES, потом — нечёткий матчинг по подстроке, чтобы поймать
  // развёрнутые заголовки amoCRM вида «Рабочий телефон контакта» или
  // «Контакт. Имя».
  function resolveHeader(h: string): string {
    if (ALIASES[h]) return ALIASES[h]
    // Сначала отсекаем явно ненужные колонки amoCRM, чтобы они не
    // ловились по случайной подстроке («Компания контакта» → не patient,
    // «Дата создания сделки» → не name, «Sendapi телефон» → не phone).
    // birth_date — раньше других (чтобы «дата рождения» не утекла в общий
    // `^дата` exclude ниже).
    if (/^дата рожд|день рожд|^др$|birth/i.test(h)) return 'birth_date'
    // created_at — дата создания сделки amoCRM (колонка «date», «Дата создания сделки»)
    if (/^date$|^дата создания|^created/i.test(h)) return 'created_at'
    if (/^(дата|кем |источник|utm_|roistat|компан|должност|возраст|email|факс|sendapi|instagram|tiktok|telegram|vkontakte|\bref\b|ref source|from$|gcl|_ym|yclid|fbclid|openstat|referrer|тип записи|анкета|причина|врач|соглашение|пол\b)/i.test(h)) {
      return h
    }
    // external_id — первым, чтобы "ID" ушёл сюда, а не в patient через «имя»
    if (/^id$|id.*сделк|id.*amo|amocrm|external/i.test(h)) return 'external_id'
    if (/телефон|^phone|phone number|мобильн/i.test(h)) return 'phone'
    if (/полное имя|\bфио\b|имя контакт|контакт.*имя|фамили|\bклиент\b|\bпациент\b/i.test(h)) return 'patient'
    if (/назван|^сделка$|^title$|^name$/i.test(h)) return 'name'
    if (/бюджет|^сумма|стоимост|^budget$|^amount$|^price$/i.test(h)) return 'amount'
    if (/^город$|^city$/i.test(h)) return 'city'
    if (/примечан|коммент|заметк|описани|^notes$/i.test(h)) return 'notes'
    if (/^тег|^tags?$/i.test(h)) return 'tags'
    // stage / responsible — в самом конце, чтобы не перетягивать phone/patient.
    // «Ответственный за контакт» уже ушёл в exclude через `контакт` ниже —
    // но точнее: проверяем стоп-слово `контакт` внутри значения.
    if (/^этап|^стади|^статус$|^stage$|^status$/i.test(h)) return 'stage'
    if (/^воронк|^pipeline$/i.test(h)) return 'pipeline'
    if (/контакт/i.test(h)) return h // "ответственный за контакт" и пр. — игнор
    if (/^ответствен|^менеджер$|^responsible$|^owner$/i.test(h)) return 'responsible'
    return h
  }

  // AmoCRM экспортирует CSV в Windows-1251 без BOM — `file.text()` читает
  // его как UTF-8 и превращает кириллицу в мусор. Определяем кодировку
  // по BOM / валидности UTF-8 и падаем на cp1251, если UTF-8 невалиден.
  async function readFileSmart(file: File): Promise<string> {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3))
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return new TextDecoder('windows-1251').decode(bytes)
    }
  }

  async function onFile(file: File) {
    const text = await readFileSmart(file)
    const parsed = parseCsv(text)
    setRows(parsed.rows)
    setDetectedHeaders(parsed.headers)
    setFileName(file.name)
    setReport(null)
  }

  async function runImport() {
    if (busy || rows.length === 0) return
    setBusy(true)
    setProgress({ done: 0, total: rows.length })
    let foundByPhone = 0
    let foundByName = 0
    let patientsCreated = 0
    let dealsCreated = 0
    let dealsUpdated = 0
    let dealsSkippedDeleted = 0
    let stageMatched = 0
    let stageFallback = 0
    let responsibleMatched = 0
    let skipped = 0
    const errors: string[] = []
    const unknownStages = new Set<string>()
    const unknownResponsibles = new Set<string>()
    const unknownPipelines = new Set<string>()
    // Собираем external_id всех импортированных сделок — после прохода
    // делаем sanity-check: сколько фактически в каждой воронке. Помогает
    // отлавливать кейсы, когда update вроде прошёл без ошибки, но
    // pipeline_id в БД остался старый (триггеры, RLS, FK и т.п.).
    const importedExternalIds: string[] = []

    // Предзагружаем список пользователей клиники — нужен для маппинга
    // «ответственный» из CSV на user_profile.id. Дёшево один раз, чем
    // запрос на каждую строку.
    let clinicUsers: { id: string; full_name: string | null }[] = []
    if (detectedHeaders.some(h => h.mapped === 'responsible')) {
      const { data: us } = await supabase
        .from('user_profiles')
        .select('id, full_name')
        .eq('clinic_id', clinicId)
      clinicUsers = us ?? []
    }

    // Предзагружаем воронки + все их этапы, если в CSV есть колонка
    // «воронка» — нужно уметь переключить сделку в другой pipeline.
    // Иначе ограничиваемся уже переданным `stages` активной воронки.
    let pipelines: { id: string; name: string }[] = []
    let allStages: { id: string; name: string; pipeline_id: string }[] = stages.map(s => ({
      id: s.id, name: s.name, pipeline_id: s.pipeline_id,
    }))
    // Загружаем воронки/этапы ВСЕГДА (а не только если в CSV есть колонка
    // «воронка»): нужно, чтобы этап из CSV, совпавший с этапом другой
    // воронки клиники, автоматически уводил сделку туда. Иначе все
    // строки уходят в активную воронку UI, и stage из другой воронки
    // улетает в fallback.
    {
      const [{ data: pls }, { data: sts }] = await Promise.all([
        supabase.from('pipelines').select('id, name').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order'),
        supabase.from('pipeline_stages').select('id, name, pipeline_id').eq('is_active', true).order('sort_order'),
      ])
      pipelines = pls ?? []
      if (sts) allStages = sts
    }
    // Первая активная воронка клиники — fallback, если в CSV указана
    // воронка, которой нет в системе.
    const firstPipelineId = pipelines[0]?.id ?? pipelineId

    // Список нераспознанных колонок — для отчёта.
    const unrecognizedHeaders = detectedHeaders
      .filter(h => !['name','patient','phone','amount','external_id','city','notes','tags','stage','pipeline','responsible','birth_date','created_at'].includes(h.mapped))
      .map(h => h.raw)

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx]
      // Даём браузеру перерисовать UI каждые 10 строк — иначе всё
      // выглядит как «зависание» (278 строк × ~3 запроса ≈ минута
      // сетевых round-trip'ов в однопоточной JS-нитке).
      if (idx > 0 && idx % 10 === 0) {
        setProgress({ done: idx, total: rows.length })
        await new Promise(res => setTimeout(res, 0))
      }
      try {
        const dealName = (r['name'] ?? '').trim()
        const patientNameRaw = (r['patient'] ?? '').trim()
        const phoneNorm = normalizePhone(r['phone'] ?? '')
        const externalId = (r['external_id'] ?? '').trim()
        if (externalId) importedExternalIds.push(externalId)
        const birthIso = parseBirthDate(r['birth_date'] ?? '')
        const createdAtIso = parseCreatedAt(r['created_at'] ?? '')
        const cityRaw = (r['city'] ?? '').trim()

        // Правило: нужна хотя бы какая-то идентификация — ФИО пациента
        // или телефон или название сделки. Иначе пустая строка.
        if (!dealName && !patientNameRaw && !phoneNorm) {
          skipped++
          errors.push(`Строка без ФИО/телефона/названия — пропущена`)
          continue
        }

        // ── 1. Ищем пациента по нормализованному телефону ──────────────
        let patientId: string | null = null
        if (phoneNorm) {
          const { data: byPhone, error: pErr } = await supabase
            .from('patients')
            .select('id')
            .eq('clinic_id', clinicId)
            .contains('phones', [phoneNorm])
            .is('deleted_at', null)
            .limit(1)
            .maybeSingle()
          if (pErr && pErr.code !== 'PGRST116') {
            throw new Error(`поиск по телефону: ${pErr.message}`)
          }
          if (byPhone) { patientId = byPhone.id; foundByPhone++ }
        }

        // ── 2. Если не нашли — ищем по ФИО + дате рождения (если есть ДР) ──
        //   Без ДР матч по одному только ФИО рискован (однофамильцы),
        //   но если ДР не пришла в CSV — ограничиваемся ФИО.
        if (!patientId && patientNameRaw) {
          const nameNorm = normalizeName(patientNameRaw)
          let q = supabase
            .from('patients')
            .select('id, full_name, birth_date')
            .eq('clinic_id', clinicId)
            .ilike('full_name', patientNameRaw) // ilike без wildcards = case-insensitive exact
            .is('deleted_at', null)
            .limit(5)
          if (birthIso) q = q.eq('birth_date', birthIso)
          const { data: byName, error: nErr } = await q
          if (nErr) throw new Error(`поиск по имени: ${nErr.message}`)
          const match = (byName ?? []).find(p => normalizeName(p.full_name) === nameNorm)
          if (match) { patientId = match.id; foundByName++ }
        }

        // ── 3. Не нашли — создаём нового пациента, если есть ФИО или телефон ──
        if (!patientId && (patientNameRaw || phoneNorm)) {
          const fullName = patientNameRaw || `Без имени (${phoneNorm || '—'})`
          const { data: newPat, error: insPErr } = await supabase
            .from('patients')
            .insert({
              clinic_id: clinicId,
              full_name: fullName,
              phones: phoneNorm ? [phoneNorm] : [],
              birth_date: birthIso,
              city: cityRaw || null,
              gender: 'other', // обязательное поле в схеме; при желании админ поправит
            })
            .select('id')
            .single()
          if (insPErr) throw new Error(`создание пациента: ${insPErr.message}`)
          patientId = newPat.id
          patientsCreated++
        }

        // ── 4. Собираем payload сделки ────────────────────────────────
        const tags = (r['tags'] ?? '').split(/[;,]/).map(x => x.trim()).filter(Boolean)
        const amountRaw = r['amount']
        const amount = amountRaw
          ? Number(amountRaw.replace(/[^\d.,-]/g, '').replace(',', '.'))
          : null
        // Воронка — берём выбранную пользователем в UI импорта
        // (таблица маппинга «CSV-этап → этап воронки» привязана именно
        // к этой воронке). Отдельную колонку «воронка» из CSV больше
        // не учитываем — пользователь сам явно выбирает, куда лить.
        const pipelineRaw = (r['pipeline'] ?? '').trim()
        if (pipelineRaw) {
          const needle = normalizeName(pipelineRaw)
          const known = pipelines.some(p => normalizeName(p.name) === needle)
          if (!known) unknownPipelines.add(pipelineRaw)
        }
        const effectivePipelineId = targetPipelineId

        // Этап: берём явный маппинг из UI. Если в маппинге null —
        // значит «в первый этап воронки» (stageFallback).
        const stageRaw = (r['stage'] ?? '').trim()
        let matchedStageName: string | null = null
        let stageId: string | null = null
        if (stageRaw) {
          const mapped = stageMap[stageRaw] ?? null
          if (mapped) {
            const hit = allStages.find(s => s.id === mapped)
            stageId = mapped
            matchedStageName = hit?.name ?? null
            stageMatched++
          } else {
            unknownStages.add(stageRaw)
            stageFallback++
          }
        }
        // Fallback — первый этап выбранной воронки.
        if (!stageId) {
          const localStages = allStages.filter(s => s.pipeline_id === effectivePipelineId)
          stageId = localStages[0]?.id ?? defaultStageId
        }
        // Legacy колонка deals.stage (TEXT NOT NULL) — нужна до миграции
        // на чистые pipeline_stages. Берём имя сопоставленного этапа,
        // иначе исходное значение из CSV, иначе имя fallback-этапа,
        // иначе 'new'.
        const fallbackStageName =
          allStages.find(s => s.id === stageId)?.name ??
          stageRaw ??
          'new'
        const legacyStage = matchedStageName || stageRaw || fallbackStageName || 'new'

        // Маппинг ответственного.
        // amoCRM экспортирует часто только имя («Жанат», «Сулу»), а в
        // нашей БД — full_name «Алимаева Жанат». Поэтому матчим по
        // токенам: каждое слово CSV ищем как любую часть полного имени
        // (имя/фамилия/отчество). Совпадение — если ВСЕ слова из CSV
        // нашлись среди слов full_name. Если в CSV одно слово и
        // совпадает строго один пользователь — берём его; иначе
        // считаем неизвестным (чтобы не назначить «Жанат» на чужого).
        let responsibleId: string | null = null
        const responsibleRaw = (r['responsible'] ?? '').trim()
        if (responsibleRaw) {
          if (clinicUsers.length > 0) {
            const csvTokens = normalizeName(responsibleRaw).split(' ').filter(Boolean)
            const candidates = clinicUsers.filter(u => {
              if (!u.full_name) return false
              const dbTokens = new Set(normalizeName(u.full_name).split(' ').filter(Boolean))
              return csvTokens.every(t => dbTokens.has(t))
            })
            if (candidates.length === 1) {
              responsibleId = candidates[0].id
              responsibleMatched++
            } else {
              unknownResponsibles.add(responsibleRaw)
            }
          } else {
            unknownResponsibles.add(responsibleRaw)
          }
        }

        // Имя сделки: если в CSV пусто — генерируем «Сделка #<external_id>»;
        // если и external_id нет — падаем на ФИО пациента.
        const effectiveName =
          dealName ||
          (externalId ? `Сделка #${externalId}` : '') ||
          patientNameRaw ||
          null
        // pipeline_id берём из самого этапа — иначе можем получить
        // несогласованную пару (pipeline_id одной воронки + stage_id
        // другой), и канбан отфильтрует такую сделку. После всех
        // fallback'ов stageId всегда валиден.
        const finalPipelineId =
          allStages.find(s => s.id === stageId)?.pipeline_id ?? effectivePipelineId
        const dealPayload: Record<string, unknown> = {
          clinic_id: clinicId,
          pipeline_id: finalPipelineId,
          stage_id: stageId,
          name: effectiveName,
          patient_id: patientId,
          responsible_user_id: responsibleId,
          contact_phone: phoneNorm || (r['phone'] ?? null) || null,
          contact_city: cityRaw || null,
          notes: r['notes'] || null,
          tags: tags.length ? tags : [],
          amount: amount != null && !Number.isNaN(amount) ? amount : null,
          funnel: 'leads',
          stage: legacyStage,
          status: 'open',
        }
        // created_at ставим ТОЛЬКО при вставке новой сделки — чтобы
        // при повторном импорте (update по external_id) не затереть
        // реальный момент создания в нашей системе.
        if (createdAtIso) dealPayload.created_at = createdAtIso

        // ── 5. Upsert по external_id, если он указан в CSV ────────────
        if (externalId) {
          const { data: existing, error: selErr } = await supabase
            .from('deals')
            .select('id, deleted_at')
            .eq('clinic_id', clinicId)
            .eq('external_id', externalId)
            .limit(1)
            .maybeSingle()
          if (selErr && selErr.code !== 'PGRST116') {
            throw new Error(`поиск сделки по external_id: ${selErr.message}`)
          }
          if (existing && existing.deleted_at) {
            // Сделка с таким external_id когда-то была, но менеджер её
            // удалил (soft-delete). По требованию — НЕ восстанавливаем,
            // и новую с тем же external_id вставить не можем (уникальный
            // partial-индекс). Просто пропускаем.
            dealsSkippedDeleted++
            continue
          }
          if (existing) {
            // Обновляем существующую сделку. stage_id/pipeline_id тоже
            // тянем из CSV — у amoCRM-импорта это источник истины
            // (этапы могут быть в другой воронке клиники; сценарий
            // «добавили недостающие этапы и перезапустили импорт»).
            const { error: upErr } = await supabase
              .from('deals')
              .update({
                name: dealPayload.name,
                patient_id: patientId,
                contact_phone: dealPayload.contact_phone,
                contact_city: dealPayload.contact_city,
                notes: dealPayload.notes,
                tags: dealPayload.tags,
                amount: dealPayload.amount,
                pipeline_id: finalPipelineId,
                stage_id: stageId,
                stage: legacyStage,
                responsible_user_id: responsibleId,
              })
              .eq('id', existing.id)
            if (upErr) throw new Error(`обновление сделки: ${upErr.message}`)
            dealsUpdated++
            continue
          }
          // Сделки с таким external_id ещё нет — создаём с ним.
          dealPayload.external_id = externalId
        }

        // ── 6. Вставка новой сделки ───────────────────────────────────
        const { error: insDErr } = await supabase.from('deals').insert(dealPayload)
        if (insDErr) throw new Error(`создание сделки: ${insDErr.message}`)
        dealsCreated++
      } catch (e: unknown) {
        skipped++
        const msg = e instanceof Error ? e.message : String(e)
        const who = (r['name'] || r['patient'] || r['phone'] || '—').trim()
        errors.push(`${who}: ${msg}`)
      }
    }

    // Sanity-check: где фактически лежат импортированные сделки.
    // Группируем по pipeline_id и резолвим имя воронки. Если результат
    // не совпадает с ожиданием пользователя — сразу видно, в какую
    // воронку реально приземлилось.
    const dbDistribution: { pipeline: string; count: number }[] = []
    if (importedExternalIds.length > 0) {
      // Supabase ограничивает .in() ~1000 элементов — у нас обычно меньше.
      const { data: verifyData } = await supabase
        .from('deals')
        .select('pipeline_id')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .in('external_id', importedExternalIds.slice(0, 1000))
      const counts = new Map<string, number>()
      for (const row of verifyData ?? []) {
        const pid = (row as { pipeline_id: string | null }).pipeline_id ?? '—'
        counts.set(pid, (counts.get(pid) ?? 0) + 1)
      }
      for (const [pid, count] of counts) {
        const name = allPipelines.find(p => p.id === pid)?.name ?? `(${pid.slice(0, 8)}…)`
        dbDistribution.push({ pipeline: name, count })
      }
      dbDistribution.sort((a, b) => b.count - a.count)
    }

    setReport({
      total: rows.length,
      foundByPhone,
      foundByName,
      patientsCreated,
      dealsCreated,
      dealsUpdated,
      dealsSkippedDeleted,
      stageMatched,
      stageFallback,
      responsibleMatched,
      skipped,
      unrecognizedHeaders,
      unknownStages: Array.from(unknownStages),
      unknownResponsibles: Array.from(unknownResponsibles),
      unknownPipelines: Array.from(unknownPipelines),
      errors: errors.slice(0, 15),
      dbDistribution,
    })
    setBusy(false)
    setProgress(null)
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
              <span className="font-mono text-xs text-gray-500"> id_amoCRM, ответственный, название, теги, этап, воронка, пациент, телефон, дата_рождения, город, date</span>.
            </p>
            <p className="text-xs text-gray-500 mb-2">
              Пациенты ищутся сначала по телефону, затем по ФИО. Если не найдены — создаются автоматически.
              Если в CSV указан <span className="font-mono">id_amoCRM</span>, повторный импорт обновит существующую сделку, а не создаст дубликат.
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
          {detectedHeaders.length > 0 && !report && (() => {
            const canonical = ['name', 'patient', 'phone', 'amount', 'external_id', 'city', 'notes', 'tags', 'stage', 'pipeline', 'responsible', 'birth_date', 'created_at']
            const mappedSet = new Set(detectedHeaders.map(h => h.mapped))
            const missingCritical = ['name', 'patient', 'phone'].filter(k => !mappedSet.has(k))
            return (
              <div className="text-xs border border-gray-100 rounded-md p-2 bg-gray-50">
                <div className="text-gray-700 font-medium mb-1">Распознанные колонки:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                  {detectedHeaders.map((h, i) => {
                    const isCanonical = canonical.includes(h.mapped)
                    return (
                      <div key={i} className="flex items-center gap-1 text-gray-600">
                        <span className="truncate max-w-[140px]" title={h.raw}>«{h.raw}»</span>
                        <span className="text-gray-400">→</span>
                        <span className={isCanonical ? 'text-green-700 font-mono' : 'text-gray-400 italic'}>
                          {isCanonical ? h.mapped : 'игнорируется'}
                        </span>
                      </div>
                    )
                  })}
                </div>
                {missingCritical.length > 0 && (
                  <div className="mt-2 text-amber-700">
                    Не найдены колонки: <b>{missingCritical.join(', ')}</b>.
                    Строки без этих полей будут пропущены.
                  </div>
                )}
              </div>
            )
          })()}
          {rows.length > 0 && !report && allPipelines.length > 0 && (
            <div className="border border-gray-100 rounded-md p-3 space-y-2">
              <div className="text-xs text-gray-700 font-medium">
                Воронка для импорта
              </div>
              <select
                value={targetPipelineId}
                onChange={e => setTargetPipelineId(e.target.value)}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              >
                {allPipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {uniqueCsvStages.length > 0 && (
                <>
                  <div className="text-xs text-gray-700 font-medium pt-2">
                    Маппинг этапов CSV → этапы воронки
                  </div>
                  <div className="text-xs text-gray-500">
                    Названия в CRM часто сокращены («Назн 1 конс»), а в CSV —
                    полные («НАЗНАЧЕНО ПЕРВИЧНАЯ КОНСУЛЬТАЦИЯ»). Сопоставьте
                    вручную — маппинг запомнится только на этот импорт.
                  </div>
                  <div className="max-h-56 overflow-y-auto border border-gray-100 rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          <th className="px-2 py-1 text-left">Из CSV</th>
                          <th className="px-2 py-1 text-left">→ Этап воронки</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uniqueCsvStages.map(raw => {
                          const pipelineStages = allStagesState.filter(
                            s => s.pipeline_id === targetPipelineId
                          )
                          const value = stageMap[raw] ?? ''
                          return (
                            <tr key={raw} className="border-t border-gray-100">
                              <td className="px-2 py-1 text-gray-700 truncate max-w-[220px]" title={raw}>
                                «{raw}»
                              </td>
                              <td className="px-2 py-1">
                                <select
                                  value={value}
                                  onChange={e => setStageMap(prev => ({
                                    ...prev,
                                    [raw]: e.target.value || null,
                                  }))}
                                  className="w-full border border-gray-200 rounded px-1 py-0.5"
                                >
                                  <option value="">— первый этап —</option>
                                  {pipelineStages.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
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
              <div>Всего строк обработано: <b>{report.total}</b></div>
              <div className="h-1" />
              <div className="text-gray-500 font-medium">Пациенты</div>
              <div>— найдено по телефону: <b className="text-gray-800">{report.foundByPhone}</b></div>
              <div>— найдено по имени: <b className="text-gray-800">{report.foundByName}</b></div>
              <div>— создано новых: <b className="text-blue-700">{report.patientsCreated}</b></div>
              <div className="h-1" />
              <div className="text-gray-500 font-medium">Сделки</div>
              <div>— создано: <b className="text-green-700">{report.dealsCreated}</b></div>
              <div>— обновлено (по external_id): <b className="text-green-700">{report.dealsUpdated}</b></div>
              <div>— пропущено удалённых (soft-deleted): <b className="text-gray-700">{report.dealsSkippedDeleted}</b></div>
              <div>— пропущено с ошибкой: <b className="text-amber-700">{report.skipped}</b></div>
              {(report.stageMatched > 0 || report.stageFallback > 0 || report.responsibleMatched > 0) && (
                <>
                  <div className="text-gray-500 mt-2">Дополнительно</div>
                  {report.stageMatched > 0 && (
                    <div>— этап сопоставлен: <b className="text-green-700">{report.stageMatched}</b></div>
                  )}
                  {report.stageFallback > 0 && (
                    <div>
                      — отправлено в первый этап (этап из CSV не найден):{' '}
                      <b className="text-amber-700">{report.stageFallback}</b>
                    </div>
                  )}
                  {report.responsibleMatched > 0 && (
                    <div>— ответственный сопоставлен: <b className="text-green-700">{report.responsibleMatched}</b></div>
                  )}
                </>
              )}
              {report.dbDistribution.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-500">В БД сейчас (по факту):</div>
                  <div className="text-xs text-gray-800">
                    {report.dbDistribution.map((d, i) => (
                      <div key={i}>— <b>{d.pipeline}</b>: {d.count}</div>
                    ))}
                  </div>
                </div>
              )}
              {report.unknownStages.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-500">Неизвестные этапы ({report.unknownStages.length}):</div>
                  <div className="text-xs text-amber-700 break-words">
                    {report.unknownStages.map(s => `«${s}»`).join(', ')}
                  </div>
                </div>
              )}
              {report.unknownResponsibles.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-500">Неизвестные ответственные ({report.unknownResponsibles.length}):</div>
                  <div className="text-xs text-amber-700 break-words">
                    {report.unknownResponsibles.map(s => `«${s}»`).join(', ')}
                  </div>
                </div>
              )}
              {report.unknownPipelines.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-500">Неизвестные воронки ({report.unknownPipelines.length}):</div>
                  <div className="text-xs text-amber-700 break-words">
                    {report.unknownPipelines.map(s => `«${s}»`).join(', ')}
                  </div>
                </div>
              )}
              {report.unrecognizedHeaders.length > 0 && (
                <div className="mt-2">
                  <div className="text-gray-500">Нераспознанные колонки ({report.unrecognizedHeaders.length}):</div>
                  <div className="text-xs text-gray-500 font-mono break-words">
                    {report.unrecognizedHeaders.map(h => `«${h}»`).join(', ')}
                  </div>
                </div>
              )}
              {report.errors.length > 0 && (
                <div>
                  <div className="text-gray-500 mt-2">Детализация ошибок (первые 15):</div>
                  <ul className="list-disc pl-4 text-red-700 space-y-0.5">
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
              {busy
                ? (progress ? `Импортируем ${progress.done} / ${progress.total}…` : 'Импортируем…')
                : `Импортировать ${rows.length}`}
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
