'use client'

/**
 * /messages — единый inbox входящих/исходящих сообщений по всем сделкам клиники.
 *
 * Левая колонка  — список сделок, по которым была переписка (любой канал),
 *                  отсортированных по времени последнего сообщения.
 *                  Для каждой сделки: превью последнего сообщения, бейдж
 *                  непрочитанных входящих, имя контакта/номер телефона.
 * Правая колонка — чат выбранной сделки + поле отправки (whatsapp/internal).
 *
 * Realtime: подписка на INSERT/UPDATE deal_messages в рамках клиники —
 *           обновляем и список диалогов, и открытую переписку.
 * Поллинг:  каждые 10 секунд добираем новые сообщения открытой сделки,
 *           на случай блокировки wss.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type Channel = 'internal' | 'whatsapp' | 'sms' | 'telegram' | 'call_note' | 'email'
type Direction = 'in' | 'out'
type MsgStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | null

interface MessageRow {
  id: string
  deal_id: string
  clinic_id: string
  direction: Direction
  channel: Channel
  author_id: string | null
  body: string
  external_sender: string | null
  read_at: string | null
  created_at: string
  status?: MsgStatus
  error_text?: string | null
}

interface DealLite {
  id: string
  title: string | null
  contact_phone: string | null
  contact_name: string | null
  patient: { id: string; full_name: string; phones: string[] | null } | null
}

interface Dialog {
  deal: DealLite
  lastMessage: MessageRow
  unread: number
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

function channelLabel(c: Channel) {
  switch (c) {
    case 'whatsapp':  return 'WA'
    case 'sms':       return 'SMS'
    case 'telegram':  return 'TG'
    case 'email':     return '✉'
    case 'call_note': return '📞'
    default:          return '💬'
  }
}

export default function MessagesPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [dialogs, setDialogs]     = useState<Dialog[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [activeId, setActiveId]   = useState<string | null>(null)
  const [messages, setMessages]   = useState<MessageRow[]>([])
  const [loadingMsg, setLoadingMsg] = useState(false)
  const [draft, setDraft]         = useState('')
  const [sending, setSending]     = useState(false)
  const [sendError, setSendError] = useState('')

  const bottomRef = useRef<HTMLDivElement>(null)

  // ────────────────────────────────────────────────────────────
  // Загрузка списка диалогов: последние 300 сообщений по клинике,
  // дальше группируем по deal_id на клиенте. Для клиники с очень
  // большим объёмом переписки позже вынесем в RPC.
  // ────────────────────────────────────────────────────────────
  const loadDialogs = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    const { data: msgs } = await supabase
      .from('deal_messages')
      .select('id, deal_id, clinic_id, direction, channel, body, author_id, external_sender, read_at, created_at, status, error_text')
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false })
      .limit(500)

    const rows = (msgs ?? []) as MessageRow[]
    const byDeal = new Map<string, { last: MessageRow; unread: number }>()
    for (const m of rows) {
      const entry = byDeal.get(m.deal_id)
      if (!entry) {
        byDeal.set(m.deal_id, {
          last: m,
          unread: m.direction === 'in' && !m.read_at ? 1 : 0,
        })
      } else {
        if (m.direction === 'in' && !m.read_at) entry.unread += 1
      }
    }

    const dealIds = Array.from(byDeal.keys())
    if (dealIds.length === 0) {
      setDialogs([])
      setLoading(false)
      return
    }

    const { data: deals } = await supabase
      .from('deals')
      .select('id, title, contact_phone, contact_name, patient:patients(id, full_name, phones)')
      .in('id', dealIds)

    const dealMap = new Map<string, DealLite>()
    for (const d of (deals ?? []) as unknown as Array<DealLite & { patient: DealLite['patient'] | DealLite['patient'][] }>) {
      const patient = Array.isArray(d.patient) ? (d.patient[0] ?? null) : (d.patient ?? null)
      dealMap.set(d.id, { ...d, patient })
    }

    const list: Dialog[] = []
    for (const [dealId, v] of byDeal) {
      const deal = dealMap.get(dealId)
      if (!deal) continue
      list.push({ deal, lastMessage: v.last, unread: v.unread })
    }
    list.sort((a, b) => (a.lastMessage.created_at < b.lastMessage.created_at ? 1 : -1))
    setDialogs(list)
    setLoading(false)
  }, [clinicId, supabase])

  useEffect(() => { loadDialogs() }, [loadDialogs])

  // ────────────────────────────────────────────────────────────
  // Загрузка сообщений выбранного диалога + помечаем входящие
  // прочитанными.
  // ────────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (dealId: string) => {
    setLoadingMsg(true)
    const { data } = await supabase
      .from('deal_messages')
      .select('id, deal_id, clinic_id, direction, channel, body, author_id, external_sender, read_at, created_at, status, error_text')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: true })
      .limit(500)
    setMessages((data ?? []) as MessageRow[])
    setLoadingMsg(false)
    await supabase.rpc('mark_deal_messages_read', { p_deal_id: dealId })
    // в списке диалогов локально обнуляем unread
    setDialogs(prev => prev.map(d => d.deal.id === dealId ? { ...d, unread: 0 } : d))
  }, [supabase])

  useEffect(() => {
    if (!activeId) { setMessages([]); return }
    loadMessages(activeId)
  }, [activeId, loadMessages])

  // автоскролл вниз при новых сообщениях
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, activeId])

  // ────────────────────────────────────────────────────────────
  // Realtime на уровне клиники — обновляем и инбокс, и активный чат.
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clinicId) return
    const ch = supabase.channel(`inbox:${clinicId}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ch as any)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'deal_messages',
        filter: `clinic_id=eq.${clinicId}`,
      }, () => { loadDialogs() })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'deal_messages',
        filter: `clinic_id=eq.${clinicId}`,
      }, (payload: { new: MessageRow }) => {
        if (payload.new.deal_id === activeId) {
          setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m))
        }
        loadDialogs()
      })
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clinicId, supabase, activeId, loadDialogs])

  // ────────────────────────────────────────────────────────────
  // Polling fallback для активного чата (wss часто режут на VPN).
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeId) return
    let stopped = false
    const id = setInterval(async () => {
      if (stopped) return
      const since = messages.length > 0 ? messages[messages.length - 1].created_at : null
      let q = supabase
        .from('deal_messages')
        .select('id, deal_id, clinic_id, direction, channel, body, author_id, external_sender, read_at, created_at, status, error_text')
        .eq('deal_id', activeId)
        .order('created_at', { ascending: true })
        .limit(50)
      if (since) q = q.gt('created_at', since)
      const { data } = await q
      if (stopped || !data || data.length === 0) return
      setMessages(prev => {
        const known = new Set(prev.map(m => m.id))
        const add = (data as MessageRow[]).filter(m => !known.has(m.id))
        if (add.length === 0) return prev
        if (add.some(m => m.direction === 'in')) {
          supabase.rpc('mark_deal_messages_read', { p_deal_id: activeId }).then(() => {})
        }
        return [...prev, ...add]
      })
    }, 10000)
    return () => { stopped = true; clearInterval(id) }
  }, [activeId, messages, supabase])

  // ────────────────────────────────────────────────────────────
  // Отправка сообщения через существующий эндпойнт
  //   POST /api/deals/:id/messages { body, channel }
  // ────────────────────────────────────────────────────────────
  const activeDialog = dialogs.find(d => d.deal.id === activeId) ?? null

  const handleSend = async (channel: 'whatsapp' | 'internal') => {
    if (!activeId) return
    const body = draft.trim()
    if (!body) return
    setSendError('')
    setSending(true)
    try {
      const res = await fetch(`/api/deals/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, channel }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSendError(json?.error ?? 'Не удалось отправить')
        return
      }
      setDraft('')
      // оптимистично добавляем в чат; realtime всё равно догонит UPDATE статусов
      if (json.message) {
        setMessages(prev => prev.some(m => m.id === json.message.id) ? prev : [...prev, json.message as MessageRow])
      }
      loadDialogs()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Ошибка сети')
    } finally {
      setSending(false)
    }
  }

  // ────────────────────────────────────────────────────────────
  // Фильтр по ФИО/телефону
  // ────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return dialogs
    return dialogs.filter(d => {
      const name = d.deal.patient?.full_name ?? d.deal.contact_name ?? d.deal.title ?? ''
      const phone = d.deal.contact_phone ?? d.deal.patient?.phones?.[0] ?? ''
      return name.toLowerCase().includes(q) || phone.toLowerCase().includes(q)
    })
  }, [dialogs, search])

  const dialogName = (d: DealLite) =>
    d.patient?.full_name || d.contact_name || d.title || d.contact_phone || 'Без имени'
  const dialogPhone = (d: DealLite) =>
    d.contact_phone || d.patient?.phones?.[0] || ''

  return (
    <div className="flex h-[calc(100vh-4rem)] -mx-6 -my-6 bg-gray-50">
      {/* LEFT: dialog list */}
      <aside className="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Сообщения</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {dialogs.length} {dialogs.length === 1 ? 'диалог' : 'диалогов'}
          </p>
        </div>
        <div className="px-3 py-2 border-b border-gray-100">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по имени или телефону..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              {search ? 'Ничего не найдено' : 'Диалогов пока нет'}
            </div>
          ) : (
            filtered.map(d => {
              const active = d.deal.id === activeId
              return (
                <button
                  key={d.deal.id}
                  onClick={() => setActiveId(d.deal.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={`text-sm truncate ${active ? 'font-semibold text-blue-900' : 'font-medium text-gray-900'}`}>
                      {dialogName(d.deal)}
                    </span>
                    <span className="text-[11px] text-gray-400 flex-shrink-0 mt-0.5">
                      {formatTime(d.lastMessage.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 flex-shrink-0">
                      {channelLabel(d.lastMessage.channel)} {d.lastMessage.direction === 'in' ? '←' : '→'}
                    </span>
                    <span className="text-xs text-gray-500 truncate flex-1">
                      {d.lastMessage.body || '—'}
                    </span>
                    {d.unread > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none flex-shrink-0">
                        {d.unread > 99 ? '99+' : d.unread}
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </aside>

      {/* RIGHT: active chat */}
      <main className="flex-1 flex flex-col bg-white">
        {!activeDialog ? (
          <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
            Выберите диалог слева
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {dialogName(activeDialog.deal)}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {dialogPhone(activeDialog.deal) || '—'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {activeDialog.deal.patient?.id && (
                  <Link
                    href={`/patients/${activeDialog.deal.patient.id}`}
                    className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5"
                  >
                    Пациент
                  </Link>
                )}
                <Link
                  href={`/crm?deal=${activeDialog.deal.id}`}
                  className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5"
                >
                  Открыть сделку
                </Link>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 bg-gray-50">
              {loadingMsg ? (
                <div className="text-center text-sm text-gray-400 py-8">Загрузка...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-8">Сообщений пока нет</div>
              ) : (
                messages.map(m => {
                  const mine = m.direction === 'out'
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white border border-gray-100 text-gray-900 rounded-bl-sm'}`}>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <div className={`flex items-center gap-2 mt-1 text-[10px] ${mine ? 'text-blue-100' : 'text-gray-400'}`}>
                          <span>{channelLabel(m.channel)}</span>
                          <span>{formatTime(m.created_at)}</span>
                          {mine && m.status && (
                            <span>
                              {m.status === 'pending' ? '…'
                                : m.status === 'failed' ? '⚠'
                                : m.status === 'sent' ? '✓'
                                : m.status === 'delivered' ? '✓✓'
                                : m.status === 'read' ? '✓✓' : ''}
                            </span>
                          )}
                        </div>
                        {m.status === 'failed' && m.error_text && (
                          <p className="text-[10px] text-red-200 mt-0.5">{m.error_text}</p>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-gray-100 px-5 py-3 bg-white">
              {sendError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 mb-2">
                  {sendError}
                </p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend('whatsapp')
                    }
                  }}
                  placeholder="Введите сообщение... (Enter — отправить, Shift+Enter — новая строка)"
                  rows={2}
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                />
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => handleSend('whatsapp')}
                    disabled={sending || !draft.trim()}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg"
                    title="Отправить в WhatsApp через Green-API"
                  >
                    {sending ? '...' : 'WhatsApp'}
                  </button>
                  <button
                    onClick={() => handleSend('internal')}
                    disabled={sending || !draft.trim()}
                    className="bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 text-xs font-medium px-4 py-2 rounded-lg"
                    title="Внутренняя заметка — клиенту не уходит"
                  >
                    Заметка
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
