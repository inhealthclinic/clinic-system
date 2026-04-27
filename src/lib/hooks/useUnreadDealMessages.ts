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

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  /** Интервал polling-fallback (мс). По умолчанию 8000. Ставим 0 для отключения. */
  pollIntervalMs?: number
  /**
   * 'mine' — только сделки, где я responsible_user_id (по умолчанию).
   * 'all'  — все непрочитанные по клинике (для admin/owner: им важно
   * видеть общий поток, а не только свои сделки).
   */
  scope?: 'mine' | 'all'
}

export function useUnreadDealMessages(opts: Options = {}) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? null
  // Уникальный суффикс для имени Realtime-канала: хук может быть
  // смонтирован несколько раз на одной странице (Sidebar ради бейджика +
  // UnreadNotifier ради тостов). Если два канала имеют одинаковое имя,
  // supabase-js отдаёт закешированный subscribed-канал — на него .on()
  // бросает "cannot add postgres_changes callbacks after subscribe()"
  // и весь клиентский JS крашится. useId даёт стабильный уникальный id
  // для каждого инстанса хука.
  const instanceId = useId()

  const [count, setCount] = useState(0)

  // onIncoming держим в ref, чтобы не пересоздавать канал при
  // каждой перерисовке родителя (иначе подписка дёргается).
  const onIncomingRef = useRef<Options['onIncoming'] | undefined>(undefined)
  useEffect(() => {
    onIncomingRef.current = opts.onIncoming
  }, [opts.onIncoming])

  const scope = opts.scope ?? 'mine'
  const refetch = useCallback(async () => {
    if (scope === 'all') {
      // Для admin/owner: считаем все непрочитанные входящие по клинике.
      // RLS ограничит доступ если у пользователя нет прав.
      if (!clinicId) return
      const { count: cnt, error } = await supabase
        .from('deal_messages')
        .select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId)
        .eq('direction', 'in')
        .is('read_at', null)
      if (error) return
      setCount(cnt ?? 0)
      return
    }
    const { data, error } = await supabase.rpc('fn_unread_deal_messages_for_me')
    if (error) {
      // Тихо падаем — бейджик просто не обновится. Шуметь в консоли
      // не хочется: RPC может временно отсутствовать до применения миграции.
      return
    }
    // data — число (INT). На всякий случай нормализуем.
    const n = typeof data === 'number' ? data : Number(data ?? 0)
    setCount(Number.isFinite(n) ? n : 0)
  }, [supabase, scope, clinicId])

  useEffect(() => {
    if (!clinicId) return
    // Первичная загрузка
    refetch()

    // Подписка на изменения deal_messages внутри клиники.
    // Типы postgres_changes в @supabase/supabase-js строгие, но сигнатура
    // .on() — overload, и перегрузка для 'postgres_changes' принимает
    // PostgresChangesFilter. Делаем через any, чтобы не тянуть private-типы.
    const ch = supabase.channel(`unread-deal-messages:${clinicId}:${instanceId}`)
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

    // При возврате из фона (сворачивали приложение) — переподключаем Realtime
    // и сразу делаем рефетч, чтобы непрочитанные обновились без ожидания polling.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refetch()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((channel as any).state !== 'joined') {
          channel.subscribe()
        }
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [clinicId, supabase, refetch, instanceId])

  // ─────────────────────────────────────────────────────────────
  // Polling fallback.
  //
  // Реалтайм через wss://*.supabase.co/realtime/... часто режется
  // VPN-расширениями, корпоративными прокси и локальными провайдерами.
  // Без него тост/звук не срабатывают, а бейджик не обновляется.
  // Поэтому каждые `pollIntervalMs` мс (по умолчанию 8 сек):
  //   • refetch() — обновляем счётчик непрочитанных
  //   • выбираем новые incoming-сообщения через обычный HTTP REST
  //     и вызываем onIncoming для тех id, что ещё не показывали.
  // Дедуплицируем по Set<id>, чтобы realtime + polling не задваивали тост.
  // ─────────────────────────────────────────────────────────────
  const seenIdsRef = useRef<Set<string>>(new Set())
  const lastSeenAtRef = useRef<string>(new Date().toISOString())

  useEffect(() => {
    if (!clinicId) return
    const interval = opts.pollIntervalMs ?? 8000
    if (interval <= 0) return

    let stopped = false

    const tick = async () => {
      if (stopped) return
      // 1) Обновим бейджик
      refetch()

      // 2) Если есть подписчик — поищем новые incoming
      if (!onIncomingRef.current) return
      const since = lastSeenAtRef.current
      const { data } = await supabase
        .from('deal_messages')
        .select('id, deal_id, clinic_id, direction, channel, body, external_sender, created_at')
        .eq('clinic_id', clinicId)
        .eq('direction', 'in')
        .gt('created_at', since)
        .order('created_at', { ascending: true })
        .limit(20)

      if (stopped) return

      if (data && data.length > 0) {
        for (const row of data) {
          if (!seenIdsRef.current.has(row.id)) {
            seenIdsRef.current.add(row.id)
            onIncomingRef.current?.(row as IncomingDealMessage)
          }
        }
        lastSeenAtRef.current = data[data.length - 1].created_at
      } else {
        // Новых нет — просто двигаем окно вперёд, чтобы не накапливалось.
        lastSeenAtRef.current = new Date().toISOString()
      }
    }

    const id = setInterval(tick, interval)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [clinicId, supabase, refetch, opts.pollIntervalMs])

  return { count, refetch }
}
