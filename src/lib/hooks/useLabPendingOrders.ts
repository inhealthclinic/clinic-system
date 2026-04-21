'use client'

// ─────────────────────────────────────────────────────────────
// useLabPendingOrders
//
// Считает новые lab_orders со статусом 'ordered' для клиники и
// держит счётчик актуальным через Supabase Realtime + polling.
//
// Использование:
//   const { count } = useLabPendingOrders()
//   const { count } = useLabPendingOrders({
//     onIncoming: (order) => { /* toast, sound */ },
//   })
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

export interface IncomingLabOrder {
  id: string
  clinic_id: string
  patient_id: string | null
  patient_name_snapshot: string | null
  order_number: string | null
  status: string
  created_at: string
}

interface Options {
  /** Вызывается при каждом INSERT нового заказа. */
  onIncoming?: (order: IncomingLabOrder) => void
  /** Интервал polling-fallback (мс). По умолчанию 8000. Ставим 0 для отключения. */
  pollIntervalMs?: number
}

export function useLabPendingOrders(opts: Options = {}) {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? null
  const instanceId = useId()

  const [count, setCount] = useState(0)

  const onIncomingRef = useRef<Options['onIncoming'] | undefined>(undefined)
  useEffect(() => {
    onIncomingRef.current = opts.onIncoming
  }, [opts.onIncoming])

  const refetch = useCallback(async () => {
    if (!clinicId) return
    const { count: n } = await supabase
      .from('lab_orders')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('status', 'ordered')
    setCount(n ?? 0)
  }, [supabase, clinicId])

  // Realtime подписка
  useEffect(() => {
    if (!clinicId) return
    refetch()

    const ch = supabase.channel(`lab-orders-pending:${clinicId}:${instanceId}`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ch as any).on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'lab_orders',
        filter: `clinic_id=eq.${clinicId}`,
      },
      (payload: { new: IncomingLabOrder }) => {
        refetch()
        onIncomingRef.current?.(payload.new)
      }
    ).on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'lab_orders',
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
  }, [clinicId, supabase, refetch, instanceId])

  // Polling fallback
  const seenIdsRef = useRef<Set<string>>(new Set())
  const lastSeenAtRef = useRef<string>(new Date().toISOString())

  useEffect(() => {
    if (!clinicId) return
    const interval = opts.pollIntervalMs ?? 8000
    if (interval <= 0) return

    let stopped = false

    const tick = async () => {
      if (stopped) return
      refetch()

      if (!onIncomingRef.current) return
      const since = lastSeenAtRef.current
      const { data } = await supabase
        .from('lab_orders')
        .select('id, clinic_id, patient_id, patient_name_snapshot, order_number, status, created_at')
        .eq('clinic_id', clinicId)
        .gt('created_at', since)
        .order('created_at', { ascending: true })
        .limit(20)

      if (stopped) return

      if (data && data.length > 0) {
        for (const row of data) {
          if (!seenIdsRef.current.has(row.id)) {
            seenIdsRef.current.add(row.id)
            onIncomingRef.current?.(row as IncomingLabOrder)
          }
        }
        lastSeenAtRef.current = data[data.length - 1].created_at
      } else {
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
