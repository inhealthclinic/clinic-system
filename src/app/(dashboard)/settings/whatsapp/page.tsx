'use client'

/**
 * /settings/whatsapp — подключение WhatsApp через Green-API.
 *
 * Что страница делает:
 *   1. Показывает значения, которые сейчас активно используются и где
 *      они хранятся (БД / env). Поля instance ID / api token /
 *      webhook token можно ввести и сохранить прямо отсюда — без редеплоя.
 *   2. Запрашивает текущее состояние инстанса (getStateInstance) и
 *      выводит QR-код, пока инстанс не авторизован.
 *   3. Кнопкой «Прописать webhook» вызывает setSettings в Green-API
 *      с текущим адресом /api/webhooks/greenapi?t=<token>.
 *
 * Креды per-clinic хранятся в clinics.whatsapp_*. Env-переменные остаются
 * fallback-ом для обратной совместимости и для multi-clinic deployments.
 */

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

type Source = 'db' | 'env' | null

interface StatusPayload {
  configured: { instanceId: boolean; apiToken: boolean; webhookToken: boolean }
  source:     { instanceId: Source; apiToken: Source; webhookToken: Source }
  saved:      { instanceId: string | null; webhookToken: string | null; apiUrl: string | null; apiTokenMask: string | null }
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

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await createClient().auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export default function WhatsAppSettingsPage() {
  const [status, setStatus]   = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [registerMsg, setRegisterMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [instanceId, setInstanceId] = useState('')
  const [apiToken,   setApiToken]   = useState('')
  const [apiUrl,     setApiUrl]     = useState('')
  const [webhookTok, setWebhookTok] = useState('')
  const [saving,     setSaving]     = useState(false)
  const [saveMsg,    setSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/settings/whatsapp', {
        cache: 'no-store',
        headers: await authHeaders(),
      })
      const j: StatusPayload = await r.json()
      setStatus(j)
      // Префиллим форму тем, что сохранено в БД.
      // ApiToken не возвращаем целиком — оставляем пустое поле «изменить».
      setInstanceId(j.saved?.instanceId ?? '')
      setWebhookTok(j.saved?.webhookToken ?? '')
      setApiUrl(j.saved?.apiUrl ?? '')
      setApiToken('')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Если не авторизован — обновляем QR/state каждые 5 секунд
  useEffect(() => {
    if (!status || status.state === 'authorized' || status.state == null) return
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [status, load])

  async function saveCreds() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const body: Record<string, string | null> = {
        instanceId: instanceId.trim() || null,
        webhookToken: webhookTok.trim() || null,
        apiUrl: apiUrl.trim() || null,
      }
      // apiToken отправляем только если пользователь его ввёл — пустое поле
      // означает «не менять» (у нас на руках есть лишь маска).
      if (apiToken.trim()) body.apiToken = apiToken.trim()

      const r = await fetch('/api/settings/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        setSaveMsg({ ok: false, text: j.error ?? `Ошибка ${r.status}` })
      } else {
        setSaveMsg({ ok: true, text: 'Сохранено' })
        await load()
      }
    } catch (e) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'Сбой запроса' })
    } finally {
      setSaving(false)
    }
  }

  async function generateWebhookToken() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const r = await fetch('/api/settings/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ webhookToken: 'auto' }),
      })
      if (!r.ok) {
        const j = await r.json()
        setSaveMsg({ ok: false, text: j.error ?? `Ошибка ${r.status}` })
      } else {
        await load()
      }
    } finally { setSaving(false) }
  }

  async function registerWebhook() {
    setRegistering(true)
    setRegisterMsg(null)
    try {
      const r = await fetch('/api/settings/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ registerWebhook: true }),
      })
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
          {/* Форма кредов */}
          <Card title="Учётные данные Green-API">
            <p className="text-xs text-gray-500 mb-3">
              Возьмите <b>idInstance</b> и <b>apiTokenInstance</b> в личном кабинете Green-API
              (<a href="https://console.green-api.com/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">console.green-api.com</a>) на карточке инстанса.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field
                label="Instance ID"
                hint={sourceHint('instanceId', status)}
                value={instanceId}
                onChange={setInstanceId}
                placeholder="например 7107600644"
              />
              <Field
                label="API Token"
                hint={apiTokenHint(status)}
                value={apiToken}
                onChange={setApiToken}
                placeholder={status.saved.apiTokenMask ? `оставьте пустым, чтобы не менять (${status.saved.apiTokenMask})` : 'apiTokenInstance из Green-API'}
                type="password"
              />
            </div>

            <div className="mt-3">
              <Field
                label="API URL"
                hint="на карточке инстанса в console.green-api.com — обычно https://api.green-api.com или https://7107.api.greenapi.com для free-tier. Оставьте пустым — подставим автоматически по префиксу instanceId."
                value={apiUrl}
                onChange={setApiUrl}
                placeholder={instanceId ? autoApiUrlHint(instanceId) : 'https://api.green-api.com'}
              />
            </div>

            <div className="mt-3">
              <Field
                label="Webhook Token"
                hint={sourceHint('webhookToken', status) + ' · секрет для проверки входящих webhook-ов'}
                value={webhookTok}
                onChange={setWebhookTok}
                placeholder="случайная строка или сгенерируйте"
                rightSlot={
                  <button
                    type="button"
                    onClick={generateWebhookToken}
                    disabled={saving}
                    className="text-xs text-blue-600 hover:underline disabled:opacity-50">
                    Сгенерировать
                  </button>
                }
              />
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={saveCreds}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
              {saveMsg && (
                <span className={`text-xs ${saveMsg.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                  {saveMsg.text}
                </span>
              )}
            </div>
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
                {status.webhookUrl ?? <span className="text-amber-700">Задайте Webhook Token выше, чтобы сгенерировать URL</span>}
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

function autoApiUrlHint(instanceId: string): string {
  const prefix = instanceId.slice(0, 4)
  if (/^7\d{3}$/.test(prefix)) return `https://${prefix}.api.greenapi.com`
  return 'https://api.green-api.com'
}

function sourceHint(key: 'instanceId' | 'apiToken' | 'webhookToken', s: StatusPayload): string {
  const src = s.source[key]
  if (src === 'db') return 'сохранено в БД'
  if (src === 'env') return 'берётся из переменной окружения — переопределите тут, чтобы записать в БД'
  return 'не задано'
}
function apiTokenHint(s: StatusPayload): string {
  if (s.source.apiToken === 'db') return `сохранено в БД · ${s.saved.apiTokenMask ?? '••••'}`
  if (s.source.apiToken === 'env') return 'берётся из переменной окружения'
  return 'не задано'
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      {title && <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>}
      {children}
    </div>
  )
}

function Field({
  label, hint, value, onChange, placeholder, type, rightSlot,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  rightSlot?: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        {rightSlot}
      </div>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </label>
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
