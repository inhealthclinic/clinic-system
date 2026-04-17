'use client'

// ============================================================
// WhatsAppChatPanel
// ────────────────────────────────────────────────────────────
// In-deal conversation viewer. Shows the unified WhatsApp thread
// (incoming + outgoing) for the patient linked to the deal.
//
// • Loads up to 50 most recent messages (deal_id OR patient_id),
//   then renders chronologically (oldest at top, newest at bottom).
// • The composer at the bottom calls sendOutboundMessage() — the
//   provider integration is stubbed; the message lands in the
//   conversation immediately with status='sent'.
// • Marks unread inbound messages as 'read' when the panel is open
//   for the current user.
// ============================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { sendOutboundMessage } from '@/lib/whatsapp/inbound'
import { formatPhoneDisplay, normalizePhoneKZ } from '@/lib/utils/phone'

interface MessageRow {
  id:           string
  direction:    'inbound' | 'outbound'
  message:      string
  status:       string
  from_phone:   string
  to_phone:     string
  contact_name: string | null
  sent_at:      string | null
  read_at:      string | null
  created_at:   string
}

export function WhatsAppChatPanel({
  clinicId, dealId, patientId, patientPhone, patientName, currentUserId,
}: {
  clinicId:      string
  dealId:        string
  patientId:     string
  patientPhone:  string | null
  patientName:   string
  currentUserId: string | null
}) {
  const supabase = createClient()
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [text,     setText]     = useState('')
  const [sending,  setSending]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('id, direction, message, status, from_phone, to_phone, contact_name, sent_at, read_at, created_at')
      .or(`deal_id.eq.${dealId},patient_id.eq.${patientId}`)
      .order('created_at', { ascending: true })
      .limit(50)
    setMessages((data ?? []) as MessageRow[])
    setLoading(false)
  }, [dealId, patientId])

  useEffect(() => { load() }, [load])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages.length, loading])

  // Mark inbound messages as read once panel is visible
  useEffect(() => {
    const unread = messages.filter(m => m.direction === 'inbound' && m.status === 'received')
    if (unread.length === 0) return
    const ids = unread.map(m => m.id)
    supabase.from('whatsapp_messages')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .in('id', ids)
      .then(() => { /* no refetch — UI already shows them */ })
  }, [messages])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    setError(null)
    const normPhone = normalizePhoneKZ(patientPhone)
    if (!normPhone) {
      setError('У пациента не задан валидный номер +77XXXXXXXXX')
      return
    }
    setSending(true)
    const result = await sendOutboundMessage(supabase, {
      clinicId,
      patientId,
      dealId,
      toPhone:   normPhone,
      fromPhone: '',  // clinic's own number — TODO: read from clinic settings
      text:      text.trim(),
      sentBy:    currentUserId ?? null,
    })
    setSending(false)
    if (result.status === 'sent') {
      setText('')
      load()
    } else {
      setError(result.error ?? 'Не удалось отправить')
    }
  }

  return (
    <div className="px-5 py-4 border-b border-gray-50">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          Чат WhatsApp {messages.length > 0 && (
            <span className="text-gray-300 ml-1">{messages.length}</span>
          )}
        </p>
        {patientPhone && (
          <span className="text-xs text-gray-400">{formatPhoneDisplay(patientPhone)}</span>
        )}
      </div>

      {/* Conversation */}
      <div
        ref={scrollRef}
        className="bg-gradient-to-b from-emerald-50/40 to-white border border-gray-100 rounded-xl px-3 py-2 max-h-72 overflow-y-auto space-y-1.5 mb-3"
      >
        {loading ? (
          <p className="text-center text-xs text-gray-300 py-6">Загрузка...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-gray-300 py-6 italic">Нет сообщений</p>
        ) : messages.map(m => {
          const mine = m.direction === 'outbound'
          const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          return (
            <div key={m.id} className={['flex', mine ? 'justify-end' : 'justify-start'].join(' ')}>
              <div
                className={[
                  'max-w-[80%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm',
                  mine
                    ? 'bg-emerald-500 text-white rounded-br-none'
                    : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none',
                ].join(' ')}
              >
                {!mine && m.contact_name && (
                  <p className="text-[10px] font-medium text-gray-400 mb-0.5">{m.contact_name}</p>
                )}
                <p className="leading-snug whitespace-pre-wrap">{m.message}</p>
                <div className={['text-[10px] mt-0.5 flex items-center justify-end gap-1', mine ? 'text-emerald-50/80' : 'text-gray-300'].join(' ')}>
                  <span>{time}</span>
                  {mine && (
                    <span title={m.status}>
                      {m.status === 'failed' ? '✕' : m.status === 'read' ? '✓✓' : m.status === 'delivered' ? '✓✓' : '✓'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Composer */}
      {patientPhone ? (
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={`Сообщение для ${patientName}...`}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg px-4 text-sm font-medium"
          >
            {sending ? '...' : 'Отправить'}
          </button>
        </form>
      ) : (
        <p className="text-xs text-gray-400 italic">Чтобы писать в WhatsApp — добавьте телефон пациенту в формате +77XXXXXXXXX.</p>
      )}

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1.5 mt-2">{error}</p>
      )}
    </div>
  )
}
