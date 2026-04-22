'use client'

// ─────────────────────────────────────────────────────────────
// TaskNotifier
//
// Монтируется в dashboard-layout. Слушает INSERT в таблицах
// tasks и deal_tasks. Если новая задача назначена текущему
// пользователю — показывает тост, играет «дзынь» и дёргает
// Notification API.
//
// Частотой «дзыня» (1040 Гц, двойной бип) отличается от
// LabNotifier (600 Гц) и UnreadNotifier, чтобы можно было
// различать сигналы на слух.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

interface Toast {
  id: number
  title: string
  body: string
}

interface IncomingTask {
  id: string
  title: string
  assigned_to: string | null
  status: string | null
  source: 'tasks' | 'deal_tasks'
}

export function TaskNotifier() {
  const { profile } = useAuthStore()
  const userId = profile?.id ?? null
  const clinicId = profile?.clinic_id ?? null

  // Держим актуальный userId в ref, чтобы не пересоздавать подписку,
  // когда профиль догружается после первого рендера.
  const userIdRef = useRef<string | null>(null)
  userIdRef.current = userId

  const [toasts, setToasts] = useState<Toast[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const toastIdRef = useRef(0)
  const seenRef = useRef<Set<string>>(new Set())

  // Запрашиваем разрешение на нативные нотифы один раз.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  // AudioContext разрешён только после юзер-жеста — анлочим при любом клике.
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
    document.addEventListener('click', unlock)
    document.addEventListener('keydown', unlock)
    document.addEventListener('touchstart', unlock)
    return () => {
      document.removeEventListener('click', unlock)
      document.removeEventListener('keydown', unlock)
      document.removeEventListener('touchstart', unlock)
    }
  }, [])

  // Двойной бип: 1040 → 1400 Гц.
  const playBeep = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const Ctx: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctx) return
        audioCtxRef.current = new Ctx()
      }
      const ctx = audioCtxRef.current
      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur)
        osc.connect(gain).connect(ctx.destination)
        osc.start(ctx.currentTime + start)
        osc.stop(ctx.currentTime + start + dur + 0.02)
      }
      tone(1040, 0, 0.14)
      tone(1400, 0.16, 0.18)
    } catch { /* ignore */ }
  }, [])

  const pushToast = useCallback((title: string, body: string) => {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, title, body }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 6000)
  }, [])

  const handle = useCallback((t: IncomingTask) => {
    // Notify only if the row is assigned to the current user and the task
    // is not already done/cancelled on arrival.
    if (!userIdRef.current) return
    if (t.assigned_to !== userIdRef.current) return
    if (t.status === 'done' || t.status === 'cancelled') return
    if (seenRef.current.has(t.id)) return
    seenRef.current.add(t.id)

    const title = 'Новая задача'
    const body = t.title || 'Вам назначена задача'
    pushToast(title, body)
    playBeep()

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, tag: `task-${t.id}` })
        n.onclick = () => { window.focus(); n.close() }
        setTimeout(() => n.close(), 8000)
      } catch { /* ignore */ }
    }
  }, [playBeep, pushToast])

  // Подписка на INSERT в обеих таблицах. Фильтруем на клиенте по clinic_id
  // (он уже зашит в filter) + по assigned_to в handle().
  useEffect(() => {
    if (!clinicId) return
    const supabase = createClient()
    const ch = supabase.channel(`task-notifier:${clinicId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tasks', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const r = payload.new as Record<string, unknown>
          handle({
            id: String(r.id),
            title: String(r.title ?? ''),
            assigned_to: (r.assigned_to ?? null) as string | null,
            status: (r.status ?? null) as string | null,
            source: 'tasks',
          })
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'deal_tasks', filter: `clinic_id=eq.${clinicId}` },
        (payload) => {
          const r = payload.new as Record<string, unknown>
          handle({
            id: String(r.id),
            title: String(r.title ?? ''),
            // У deal_tasks поле называется assignee_id
            assigned_to: (r.assignee_id ?? null) as string | null,
            status: (r.status ?? null) as string | null,
            source: 'deal_tasks',
          })
        })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clinicId, handle])

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id}
          role="status" aria-live="polite"
          className="pointer-events-auto bg-white border border-blue-200 shadow-lg rounded-lg px-4 py-3 w-80 text-sm">
          <div className="flex items-center gap-2 mb-0.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-blue-600 shrink-0">
              <rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <path d="M9 15l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div className="font-semibold text-gray-900">{t.title}</div>
          </div>
          <div className="text-gray-600 text-xs ml-5">{t.body}</div>
        </div>
      ))}
    </div>
  )
}
