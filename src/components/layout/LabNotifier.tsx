'use client'

// ─────────────────────────────────────────────────────────────
// LabNotifier
//
// Монтируется один раз в dashboard-layout. Слушает новые
// lab_orders (status='ordered') через Realtime + polling и:
//   • показывает тост-уведомление (без внешних зависимостей),
//   • играет короткий «дзынь» через WebAudio,
//   • дёргает системный Notification API, если разрешено.
//
// Отображается только для пользователей с правом lab:view
// (лаборант, owner, admin и т.п.).
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLabPendingOrders, type IncomingLabOrder } from '@/lib/hooks/useLabPendingOrders'
import { usePermissions } from '@/lib/hooks/usePermissions'

interface Toast {
  id: number
  title: string
  body: string
}

export function LabNotifier() {
  const { isOwner, isAdmin, profile } = usePermissions()
  const isLaborant = profile?.role?.slug === 'laborant'
  // Ref: проверяем роль внутри handleIncoming, чтобы не терять подписку
  // при позднем появлении профиля
  const canSeeLabRef = useRef(false)
  canSeeLabRef.current = isOwner || isAdmin || isLaborant

  const [toasts, setToasts] = useState<Toast[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const toastIdRef = useRef(0)

  // Запросить разрешение на браузерные уведомления
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  // Разблокировать AudioContext на первом user gesture
  useEffect(() => {
    if (typeof window === 'undefined') return
    const unlock = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx: typeof AudioContext | undefined =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (Ctx) audioCtxRef.current = new Ctx()
        }
        audioCtxRef.current?.resume().catch(() => {})
      } catch { /* ignore */ }
    }
    document.addEventListener('click', unlock, { once: false })
    document.addEventListener('keydown', unlock, { once: false })
    document.addEventListener('touchstart', unlock, { once: false })
    return () => {
      document.removeEventListener('click', unlock)
      document.removeEventListener('keydown', unlock)
      document.removeEventListener('touchstart', unlock)
    }
  }, [])

  // Beep 600Hz (чуть ниже CRM-бипа 800Hz — чтобы отличать)
  const playBeep = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      if (!audioCtxRef.current) {
        const Ctx: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        audioCtxRef.current = new Ctx()
      }
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 600
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.21)
    } catch { /* ignore */ }
  }, [])

  const pushToast = useCallback((title: string, body: string) => {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, title, body }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 6000)
  }, [])

  const handleIncoming = useCallback(
    (order: IncomingLabOrder) => {
      // Пропускаем если у текущего пользователя нет доступа к лаборатории
      if (!canSeeLabRef.current) return
      const patientName = order.patient_name_snapshot ?? 'Пациент'
      const orderNum = order.order_number ? ` №${order.order_number}` : ''
      const title = `Новый анализ${orderNum}`
      const body = `${patientName} — направлен в лабораторию`

      pushToast(title, body)
      playBeep()

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body, tag: `lab-order-${order.id}` })
          n.onclick = () => { window.focus(); n.close() }
        } catch { /* ignore */ }
      }
    },
    [playBeep, pushToast]
  )

  // Всегда подписываемся — проверка роли внутри handleIncoming через ref
  // pollIntervalMs=4000 — быстрее для кросс-устройственных уведомлений
  useLabPendingOrders({ onIncoming: handleIncoming, pollIntervalMs: 4000 })

  // CustomEvent от transferToLab — срабатывает мгновенно в том же браузере,
  // пока AudioContext ещё активен после клика пользователя
  useEffect(() => {
    if (typeof window === 'undefined') return
    const seenIds = new Set<string>()
    const handler = (e: Event) => {
      const order = (e as CustomEvent).detail
      if (!order?.id || seenIds.has(order.id)) return
      seenIds.add(order.id)
      handleIncoming(order)
    }
    window.addEventListener('lab:order-created', handler)
    return () => window.removeEventListener('lab:order-created', handler)
  }, [handleIncoming])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto bg-white border border-purple-200 shadow-lg rounded-lg px-4 py-3 w-80 text-sm"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 mb-0.5">
            {/* Иконка колбы */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-purple-600 shrink-0">
              <path d="M9 3h6M9 3v8L4 19a2 2 0 001.8 2.9h12.4A2 2 0 0020 19l-5-8V3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6.5 16h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <div className="font-semibold text-gray-900">{t.title}</div>
          </div>
          <div className="text-gray-600 text-xs ml-5">{t.body}</div>
        </div>
      ))}
    </div>
  )
}
