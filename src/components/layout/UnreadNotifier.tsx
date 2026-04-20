'use client'

// ─────────────────────────────────────────────────────────────
// UnreadNotifier
//
// Монтируется один раз в dashboard-layout. Слушает входящие
// сообщения по сделкам, где текущий менеджер ответственный, и:
//   • показывает свой корнер-тост (без зависимостей — чтобы не
//     тянуть sonner/react-hot-toast ради одной плашки),
//   • играет короткий «дзынь» через WebAudio (без бинарников),
//   • дёргает системный Notification API, если разрешено.
//
// Разрешение на уведомления запрашивается один раз при маунте,
// если статус 'default'. Если 'denied' — тихо пропускаем, не
// приставая к пользователю.
// ─────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUnreadDealMessages, type IncomingDealMessage } from '@/lib/hooks/useUnreadDealMessages'

interface Toast {
  id: number
  title: string
  body: string
}

export function UnreadNotifier() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const toastIdRef = useRef(0)

  // Запросить разрешение на Notifications один раз при маунте
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      // Не блокируем — просто просим один раз, результат нам не важен.
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  // Короткий beep через WebAudio (синус 800Hz, ~150ms, gain 0.1).
  // Бинарник mp3 не добавляем, чтобы не раздувать репозиторий.
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
      // Некоторые браузеры оставляют контекст suspended до user gesture —
      // тогда звука просто не будет, это ок.
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 800
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.16)
    } catch {
      // Глухо — звук это nice-to-have
    }
  }, [])

  const pushToast = useCallback((title: string, body: string) => {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, title, body }])
    // Авто-скрытие через 5 сек
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 5000)
  }, [])

  const handleIncoming = useCallback(
    async (msg: IncomingDealMessage) => {
      // Подтянуть имя пациента по сделке, чтобы заголовок был человеческий.
      // Отдельный select — дёшево, одна строка. Если не получилось —
      // фолбэчимся на external_sender (номер телефона) или «Новое сообщение».
      let patientName: string | null = null
      try {
        const supabase = createClient()
        const { data } = await supabase
          .from('deals')
          .select('name, patient:patients(full_name)')
          .eq('id', msg.deal_id)
          .maybeSingle<{ name: string | null; patient: { full_name: string } | { full_name: string }[] | null }>()
        if (data) {
          const pat = Array.isArray(data.patient) ? data.patient[0] : data.patient
          patientName = pat?.full_name ?? data.name ?? null
        }
      } catch {
        // ignore
      }

      const who = patientName || msg.external_sender || 'клиент'
      const preview = msg.body.length > 120 ? msg.body.slice(0, 117) + '…' : msg.body
      const title = `Новое сообщение от ${who}`

      pushToast(title, preview)
      playBeep()

      // Браузерное уведомление
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body: preview, tag: `deal-msg-${msg.deal_id}` })
          // По клику фокусируем вкладку — глубокий переход на карточку
          // требует знание текущего роутера; оставим на потом.
          n.onclick = () => {
            window.focus()
            n.close()
          }
        } catch {
          // Некоторые браузеры бросают, если permission revoked между проверкой и вызовом.
        }
      }
    },
    [playBeep, pushToast]
  )

  // Сама подписка (счётчик тут не нужен — его читает Sidebar отдельно).
  useUnreadDealMessages({ onIncoming: handleIncoming })

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto bg-white border border-gray-200 shadow-lg rounded-lg px-4 py-3 w-80 text-sm"
          role="status"
          aria-live="polite"
        >
          <div className="font-semibold text-gray-900 mb-0.5">{t.title}</div>
          <div className="text-gray-600 whitespace-pre-wrap break-words line-clamp-3">{t.body}</div>
        </div>
      ))}
    </div>
  )
}
