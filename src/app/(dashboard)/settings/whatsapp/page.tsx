'use client'

/**
 * /settings/whatsapp — подключение WhatsApp через Green-API.
 *
 * Что страница делает:
 *   1. Показывает, какие env-переменные заданы (instanceId, apiToken,
 *      webhookToken). Без instanceId+apiToken остальное недоступно.
 *   2. Запрашивает текущее состояние инстанса (getStateInstance) и
 *      выводит QR-код, пока инстанс не авторизован.
 *   3. Кнопкой «Прописать webhook» вызывает setSettings в Green-API
 *      с текущим адресом /api/webhooks/greenapi?t=<token>.
 *
 * Сами креды задаются переменными окружения деплоя — это безопаснее,
 * чем хранить токен в БД и таскать через RLS. Здесь — только проверка
 * связи и привязка устройства.
 */

import { useEffect, useState, useCallback } from 'react'

interface StatusPayload {
  configured: { instanceId: boolean; apiToken: boolean; webhookToken: boolean }
  state: string | null
  stateError?: string | null
  qr: { type: string; message: string } | null
  webhookUrl: string | null
  error?: string
}

const STATE_LABEL: Record<string, { label: string; color: string }> = {
  authorized:    { label: 'Авторизован — можно отправлять сообщения', color: 'emerald' },
  notAuthorized: { label: 'Не авторизован — отсканируйте QR с телефона',  color: 'amber' },
  starting:      { label: 'Запускается…',                                  color: 'gray' },
  blocked:       { label: 'Заблокирован',                                  color: 'red' },
  sleepMode:     { label: 'Спящий режим',                                  color: 'gray' },
  yellowCard:    { label: 'Yellow card — WhatsApp ограничивает отправки',  color: 'amber' },
}

export default function WhatsAppSettingsPage() {
  const [status, setStatus]   = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [registerMsg, setRegisterMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/settings/whatsapp', { cache: 'no-store' })
      const j = await r.json()
      setStatus(j)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Если не авторизован — обновляем QR/state каждые 5 секунд
  useEffect(() => {
    if (!status || status.state === 'authorized' || status.state == null) return
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [status, load])

  async function registerWebhook() {
    setRegistering(true)
    setRegisterMsg(null)
    try {
      const r = await fetch('/api/settings/whatsapp', { method: 'POST' })
      const j = await r.json()
      if (!r.ok) {
        setRegisterMsg({ ok: false, text: j.error ?? `Ошибка ${r.status}` })
      } else {
        setRegisterMsg({ ok: true, text: 'Webhook зарегистрирован в Green-API' })
      }
    } catch (e) {
      setRegisterMsg({ ok: false, text: e instanceof Error ? e.message : 'Сбой запроса' })
    } finally {
      setRegistering(false)
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">WhatsApp · Green-API</h2>
        <p className="text-sm text-gray-400">
          Привязка номера, проверка состояния и регистрация webhook для входящих сообщений.
        </p>
      </div>

      {loading && <Card><p className="text-sm text-gray-400">Загрузка…</p></Card>}

      {!loading && status && (
        <div className="space-y-4">
          {/* env переменные */}
          <Card title="Переменные окружения">
            <ul className="text-sm space-y-1.5">
              <EnvRow ok={status.configured.instanceId} name="GREENAPI_INSTANCE_ID" />
              <EnvRow ok={status.configured.apiToken}   name="GREENAPI_API_TOKEN" />
              <EnvRow ok={status.configured.webhookToken} name="GREENAPI_WEBHOOK_TOKEN" hint="секрет для проверки входящих webhook-ов" />
            </ul>
            {(!status.configured.instanceId || !status.configured.apiToken) && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Задайте переменные в настройках деплоя (Vercel → Settings → Environment Variables) и
                перезапустите приложение. После этого вернитесь сюда — состояние подтянется автоматически.
              </p>
            )}
          </Card>

          {/* состояние */}
          {status.configured.instanceId && status.configured.apiToken && (
            <Card title="Состояние инстанса">
              {status.stateError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {status.stateError}
                </p>
              )}
              {status.state && (
                <StateBadge state={status.state} />
              )}

              {/* QR */}
              {status.state && status.state !== 'authorized' && status.qr && (
                <div className="mt-4">
                  {status.qr.type === 'qrCode' && (
                    <div className="flex flex-col items-center gap-2">
                      <img
                        src={`data:image/png;base64,${status.qr.message}`}
                        alt="QR"
                        className="w-56 h-56 border border-gray-200 rounded-lg bg-white p-2"
                      />
                      <p className="text-xs text-gray-500 text-center max-w-xs">
                        Откройте WhatsApp на телефоне → <b>Связанные устройства</b> → <b>Привязать устройство</b> и
                        отсканируйте QR. Код обновляется автоматически.
                      </p>
                    </div>
                  )}
                  {status.qr.type === 'alreadyLogged' && (
                    <p className="text-sm text-emerald-700">Устройство уже привязано.</p>
                  )}
                  {status.qr.type === 'error' && (
                    <p className="text-xs text-red-600">QR недоступен: {status.qr.message}</p>
                  )}
                </div>
              )}

              <button
                onClick={load}
                className="mt-4 text-xs text-blue-600 hover:underline">
                Обновить состояние
              </button>
            </Card>
          )}

          {/* webhook */}
          {status.configured.instanceId && status.configured.apiToken && (
            <Card title="Webhook для входящих сообщений">
              <p className="text-xs text-gray-500 mb-2">
                Этот URL Green-API будет дёргать на каждое входящее сообщение и смену статуса.
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono break-all text-gray-700">
                {status.webhookUrl ?? <span className="text-amber-700">Задайте GREENAPI_WEBHOOK_TOKEN, чтобы сгенерировать URL</span>}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={registerWebhook}
                  disabled={registering || !status.webhookUrl}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  {registering ? 'Регистрирую…' : 'Прописать webhook в Green-API'}
                </button>
                {status.webhookUrl && (
                  <button
                    onClick={() => navigator.clipboard.writeText(status.webhookUrl!)}
                    className="text-xs text-gray-600 hover:text-gray-900">
                    Скопировать URL
                  </button>
                )}
              </div>
              {registerMsg && (
                <p className={`mt-3 text-xs px-3 py-2 rounded-lg border ${registerMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-100 text-red-600'}`}>
                  {registerMsg.text}
                </p>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      {title && <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>}
      {children}
    </div>
  )
}

function EnvRow({ ok, name, hint }: { ok: boolean; name: string; hint?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? 'bg-emerald-500' : 'bg-gray-300'}`} />
      <code className="font-mono text-[12px] text-gray-700">{name}</code>
      <span className={`text-[11px] ${ok ? 'text-emerald-700' : 'text-gray-400'}`}>{ok ? 'задана' : 'не задана'}</span>
      {hint && <span className="text-[11px] text-gray-400 ml-auto">— {hint}</span>}
    </li>
  )
}

function StateBadge({ state }: { state: string }) {
  const meta = STATE_LABEL[state] ?? { label: state, color: 'gray' }
  const color = meta.color
  const cls = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber:   'bg-amber-50 border-amber-200 text-amber-800',
    red:     'bg-red-50 border-red-200 text-red-800',
    gray:    'bg-gray-50 border-gray-200 text-gray-700',
  }[color]
  return (
    <div className={`inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border ${cls}`}>
      <span className="font-medium uppercase text-[11px] tracking-wider">{state}</span>
      <span>· {meta.label}</span>
    </div>
  )
}
