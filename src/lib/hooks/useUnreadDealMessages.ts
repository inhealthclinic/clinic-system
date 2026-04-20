'use client'

// ─────────────────────────────────────────────────────────────
// useUnreadDealMessages
//
// Считает непрочитанные входящие сообщения по сделкам, за
// которые отвечает текущий пользователь (responsible_user_id),
// и держит счётчик в актуальном состоянии через Supabase Realtime.
//
// Использование:
//   const { count } = useUnreadDealMessages()
//   const { count } = useUnreadDealMessages({
//     onIncoming: (msg) => { /* toast, sound, notification */ },
//   })
//
// Важно:
//   • Серверный RPC уже фильтрует по current_clinic_id() и
//     responsible_user_id = auth.uid() — повторять здесь не нужно.
//   • В Realtime-подписке фильтруем по clinic_id, чтобы не
//     получать чужие сообщения через шину. Ответственность за
//     доступ всё равно на RLS, но фильтр экономит трафик.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// Минимальная форма «входящего», которую мы передаём в onIncoming.
// Подписчик сам дочитает patient-имя по deal_id, если нужно.
export interface IncomingDealMessage {
  id: string
  deal_id: string
  clinic_id: string
  direction: 'in' | 'out'
  channel: string
  body: string
  external_sender: string | null
  created_at: string
}

interface Options {
  /** Вызывается при каждом INSERT direction='in'. */
  onIncoming?: (msg: IncomingDealMessage) => void
}

export function useUnreadDealMessages(opts: Options = {}) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? null

  const [count, setCount] = useState(0)

  // onIncoming держим в ref, чтобы не пересоздавать канал при
  // каждой перерисовке родителя (иначе подписка дёргается).
  const onIncomingRef = useRef<Options['onIncoming'] | undefined>(undefined)
  useEffect(() => {
    onIncomingRef.current = opts.onIncoming
  }, [opts.onIncoming])

  const refetch = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_unread_deal_messages_for_me')
    if (error) {
      // Тихо падаем — бейджик просто не обновится. Шуметь в консоли
      // не хочется: RPC может временно отсутствовать до применения миграции.
      return
    }
    // data — число (INT). На всякий случай нормализуем.
    const n = typeof data === 'number' ? data : Number(data ?? 0)
    setCount(Number.isFinite(n) ? n : 0)
  }, [supabase])

  useEffect(() => {
    if (!clinicId) return
    // Первичная загрузка
    refetch()

    // Подписка на изменения deal_messages внутри клиники.
    // Типы postgres_changes в @supabase/supabase-js строгие, но сигнатура
    // .on() — overload, и перегрузка для 'postgres_changes' принимает
    // PostgresChangesFilter. Делаем через any, чтобы не тянуть private-типы.
    const ch = supabase.channel(`unread-deal-messages:${clinicId}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ch as any).on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'deal_messages',
        filter: `clinic_id=eq.${clinicId}`,
      },
      (payload: { new: IncomingDealMessage }) => {
        const row = payload.new
        if (row?.direction === 'in') {
          refetch()
          onIncomingRef.current?.(row)
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ).on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'deal_messages',
        filter: `clinic_id=eq.${clinicId}`,
      },
      () => {
        refetch()
      }
    )
    const channel = ch.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [clinicId, supabase, refetch])

  return { count, refetch }
}
