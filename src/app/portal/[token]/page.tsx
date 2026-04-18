'use client'

/**
 * Портал пациента — публичная страница.
 * URL: /portal/<token>
 * Доступ: любой (anon). Проверка: токен + дата рождения.
 * Защита: RPC fn_patient_portal_lookup возвращает NULL при несовпадении,
 * одинаково для "неверный токен" и "неверный DOB" — не утекает факт наличия.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface PortalResult {
  id: string
  service_name: string
  result_value: number | null
  result_text: string | null
  unit: string | null
  reference_min: number | null
  reference_max: number | null
  reference_text: string | null
  flag: 'normal' | 'low' | 'high' | 'critical' | null
  result_date: string
}

interface PortalPatient {
  full_name: string
  patient_number: string | null
  birth_date: string | null
}

interface PortalPayload {
  patient: PortalPatient
  results: PortalResult[]
}

const FLAG_STYLE: Record<string, { cls: string; label: string }> = {
  normal:   { cls: 'bg-green-50 text-green-700',  label: 'Норма' },
  low:      { cls: 'bg-blue-50 text-blue-700',    label: 'Ниже' },
  high:     { cls: 'bg-orange-50 text-orange-700',label: 'Выше' },
  critical: { cls: 'bg-red-100 text-red-700',     label: 'Критично' },
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function fmtValue(r: PortalResult): string {
  if (r.result_value !== null && r.result_value !== undefined) {
    const n = Number(r.result_value)
    return Number.isInteger(n) ? String(n) : n.toFixed(2)
  }
  return r.result_text ?? '—'
}

function fmtRange(r: PortalResult): string {
  if (r.reference_min !== null && r.reference_max !== null) {
    return `${r.reference_min} – ${r.reference_max}`
  }
  if (r.reference_text) return r.reference_text
  return '—'
}

export default function PatientPortalPage() {
  const params = useParams<{ token: string }>()
  const token = params?.token ?? ''
  const supabase = useMemo(() => createClient(), [])

  const [dob, setDob] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PortalPayload | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dob) { setError('Укажите дату рождения'); return }
    setError(null); setLoading(true); setData(null)

    const { data: payload, error: rpcErr } = await supabase
      .rpc('fn_patient_portal_lookup', { p_token: token, p_dob: dob })

    setLoading(false)

    if (rpcErr) { setError('Не удалось загрузить результаты. Повторите позже.'); return }
    if (!payload) {
      setError('Неверная ссылка или дата рождения не совпадает.')
      return
    }
    setData(payload as PortalPayload)
  }

  // Автосброс формы при изменении токена.
  useEffect(() => { setData(null); setError(null); setDob('') }, [token])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <h1 className="text-xl font-semibold text-gray-900">in health — портал пациента</h1>
          <p className="text-sm text-gray-500">Результаты лабораторных исследований</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {!data && (
          <form onSubmit={onSubmit} className="bg-white border border-gray-200 rounded-lg p-6 max-w-md mx-auto">
            <h2 className="text-lg font-medium text-gray-900 mb-1">Подтвердите личность</h2>
            <p className="text-sm text-gray-500 mb-4">
              Введите дату рождения пациента, для которого выдана ссылка.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Дата рождения</label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            {error && (
              <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-md py-2 text-sm font-medium transition"
            >
              {loading ? 'Проверяем…' : 'Показать результаты'}
            </button>
            <p className="mt-4 text-xs text-gray-400">
              Ссылка персональная. Не передавайте её третьим лицам.
            </p>
          </form>
        )}

        {data && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-500">Пациент</div>
                  <div className="text-lg font-medium text-gray-900">{data.patient.full_name}</div>
                  <div className="text-sm text-gray-500">
                    {data.patient.patient_number ? `Карта ${data.patient.patient_number} · ` : ''}
                    Дата рождения: {data.patient.birth_date ?? '—'}
                  </div>
                </div>
                <button
                  onClick={() => { setData(null); setDob('') }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Выйти
                </button>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-medium text-gray-900">Результаты анализов</h2>
                <span className="text-sm text-gray-500">{data.results.length} записей</span>
              </div>
              {data.results.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-gray-500">
                  Результатов пока нет.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.results.map((r) => {
                    const flag = r.flag ? FLAG_STYLE[r.flag] : null
                    return (
                      <div key={r.id} className="px-6 py-4 flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900">{r.service_name}</div>
                          <div className="text-sm text-gray-500 mt-0.5">
                            {fmtDate(r.result_date)} · норма: {fmtRange(r)}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base font-semibold text-gray-900">
                            {fmtValue(r)}{r.unit ? ` ${r.unit}` : ''}
                          </div>
                          {flag && (
                            <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded ${flag.cls}`}>
                              {flag.label}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                <button
                  onClick={() => window.print()}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Скачать / распечатать (PDF)
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-400 text-center">
              Данные носят справочный характер. Интерпретацию проводит лечащий врач.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
