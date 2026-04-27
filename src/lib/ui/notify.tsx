'use client'

/**
 * notify.tsx — лёгкий toast + confirm-modal вместо нативных alert()/confirm().
 *
 * Зачем:
 *   В CRM 30+ alert/confirm — за день менеджер видит блокирующее окно браузера
 *   десятки раз. Заменяем на не блокирующий toast и кастомный confirm-modal.
 *
 * Использование:
 *   import { notify, confirmAction } from '@/lib/ui/notify'
 *   notify.error('Не удалось сохранить')
 *   notify.success('Готово')
 *   if (!(await confirmAction({ message: 'Удалить сделку?', danger: true }))) return
 *
 * В корне дашборда смонтировать <Notifier />.
 */

import { useEffect, useRef, useState } from 'react'

// ── event bus ──────────────────────────────────────────────────────────────

type ToastKind = 'success' | 'error' | 'info' | 'warning'
interface ToastDetail { id: number; kind: ToastKind; message: string }

interface ConfirmOptions {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}
interface ConfirmRequest extends ConfirmOptions { id: number }

let toastCounter = 0
let confirmCounter = 0

function emitToast(kind: ToastKind, message: string) {
  if (typeof window === 'undefined') return
  const detail: ToastDetail = { id: ++toastCounter, kind, message }
  window.dispatchEvent(new CustomEvent('app:toast', { detail }))
}

export const notify = {
  success: (m: string) => emitToast('success', m),
  error:   (m: string) => emitToast('error', m),
  info:    (m: string) => emitToast('info', m),
  warning: (m: string) => emitToast('warning', m),
}

const confirmResolvers = new Map<number, (ok: boolean) => void>()

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return new Promise(resolve => {
    const id = ++confirmCounter
    confirmResolvers.set(id, resolve)
    const detail: ConfirmRequest = { id, ...opts }
    window.dispatchEvent(new CustomEvent('app:confirm', { detail }))
  })
}

// ── component ──────────────────────────────────────────────────────────────

export function Notifier() {
  const [toasts, setToasts] = useState<ToastDetail[]>([])
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as ToastDetail
      if (!d) return
      setToasts(prev => [...prev, d])
      const t = setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== d.id))
        timersRef.current.delete(d.id)
      }, 4500)
      timersRef.current.set(d.id, t)
    }
    const onConfirm = (e: Event) => {
      const d = (e as CustomEvent).detail as ConfirmRequest
      if (!d) return
      setConfirmReq(d)
    }
    window.addEventListener('app:toast', onToast)
    window.addEventListener('app:confirm', onConfirm)
    const timers = timersRef.current
    return () => {
      window.removeEventListener('app:toast', onToast)
      window.removeEventListener('app:confirm', onConfirm)
      timers.forEach(t => clearTimeout(t))
      timers.clear()
    }
  }, [])

  function dismissToast(id: number) {
    setToasts(prev => prev.filter(x => x.id !== id))
    const t = timersRef.current.get(id)
    if (t) { clearTimeout(t); timersRef.current.delete(id) }
  }

  function resolveConfirm(ok: boolean) {
    if (!confirmReq) return
    const r = confirmResolvers.get(confirmReq.id)
    confirmResolvers.delete(confirmReq.id)
    setConfirmReq(null)
    r?.(ok)
  }

  return (
    <>
      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-[10000] flex flex-col gap-2 pointer-events-none">
          {toasts.map(t => {
            const cls = t.kind === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : t.kind === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : t.kind === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
            return (
              <div key={t.id}
                role="status" aria-live="polite"
                className={`pointer-events-auto border shadow-lg rounded-lg px-4 py-2.5 max-w-sm text-sm ${cls} flex items-start gap-2`}>
                <span className="flex-1 whitespace-pre-line">{t.message}</span>
                <button
                  onClick={() => dismissToast(t.id)}
                  className="text-current opacity-50 hover:opacity-100 leading-none text-lg shrink-0"
                  aria-label="Закрыть">×</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Confirm modal */}
      {confirmReq && (
        <div
          className="fixed inset-0 z-[10001] bg-black/40 flex items-center justify-center p-4"
          onClick={() => resolveConfirm(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-5"
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Escape') resolveConfirm(false)
              if (e.key === 'Enter') resolveConfirm(true)
            }}
            tabIndex={-1}
            ref={el => { el?.focus() }}
          >
            {confirmReq.title && (
              <h2 className="text-base font-semibold text-gray-900 mb-2">{confirmReq.title}</h2>
            )}
            <p className="text-sm text-gray-700 whitespace-pre-line">{confirmReq.message}</p>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => resolveConfirm(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >{confirmReq.cancelText ?? 'Отмена'}</button>
              <button
                onClick={() => resolveConfirm(true)}
                className={`px-3 py-1.5 text-sm rounded-md text-white ${
                  confirmReq.danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >{confirmReq.confirmText ?? 'OK'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
