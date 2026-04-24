'use client'

/**
 * Error Boundary для /crm.
 * Ловит рантайм-ошибки (RLS, сеть, таймауты Supabase) и показывает
 * понятное сообщение вместо белого экрана. Кнопка «Обновить» вызывает
 * reset() — Next.js попытается перерендерить сегмент заново.
 */

import { useEffect } from 'react'
import Link from 'next/link'

// Inline SVG: кружок с «!». lucide-react в проекте не используется,
// держимся единого стиля — SVG прямо в JSX.
function AlertCircleIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

export default function CRMError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // В dev'e полезно видеть стек в консоли.
    // В проде digest можно сопоставить с логами Vercel.
    // eslint-disable-next-line no-console
    console.error('[CRM error boundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <AlertCircleIcon className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900">
              Что-то пошло не так
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Попробуйте обновить страницу. Если ошибка повторяется — сообщите администратору.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
          >
            Обновить
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
          >
            На главную
          </Link>
        </div>

        {error?.digest && (
          <p className="mt-4 text-[11px] text-gray-400 font-mono break-all">
            ID ошибки: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
