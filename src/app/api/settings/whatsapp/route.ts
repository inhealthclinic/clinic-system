import { NextRequest, NextResponse } from 'next/server'
import { getStateInstance, getQr, setWebhookSettings } from '@/lib/greenapi'

/**
 * GET /api/settings/whatsapp — статус интеграции WhatsApp (Green-API).
 * Возвращает:
 *   • configured.{instanceId,apiToken,webhookToken} — заданы ли env-переменные
 *   • state — состояние инстанса (authorized / notAuthorized / …)
 *   • qr (только если не авторизован) — base64 PNG для сканирования телефоном
 *   • webhookUrl — URL, который нужно прописать в Green-API
 *
 * POST /api/settings/whatsapp — регистрирует webhook в Green-API
 * (вызывает setSettings с текущим webhookUrl).
 */

function configFlags() {
  return {
    instanceId:   !!process.env.GREENAPI_INSTANCE_ID,
    apiToken:     !!process.env.GREENAPI_API_TOKEN,
    webhookToken: !!process.env.GREENAPI_WEBHOOK_TOKEN,
  }
}

function buildWebhookUrl(req: NextRequest): string | null {
  const token = process.env.GREENAPI_WEBHOOK_TOKEN
  if (!token) return null
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  const origin = fromEnv ?? req.nextUrl.origin
  return `${origin.replace(/\/$/, '')}/api/webhooks/greenapi?t=${encodeURIComponent(token)}`
}

export async function GET(req: NextRequest) {
  const configured = configFlags()
  if (!configured.instanceId || !configured.apiToken) {
    return NextResponse.json({
      configured,
      state: null,
      qr: null,
      webhookUrl: buildWebhookUrl(req),
      error: 'Не заданы переменные окружения GREENAPI_INSTANCE_ID и/или GREENAPI_API_TOKEN',
    })
  }

  let state: string | null = null
  let stateError: string | null = null
  try {
    const s = await getStateInstance()
    state = s.stateInstance
  } catch (e) {
    stateError = e instanceof Error ? e.message : 'Не удалось запросить состояние'
  }

  let qr: { type: string; message: string } | null = null
  if (state && state !== 'authorized') {
    try {
      qr = await getQr()
    } catch (e) {
      qr = { type: 'error', message: e instanceof Error ? e.message : 'Не удалось получить QR' }
    }
  }

  return NextResponse.json({
    configured,
    state,
    stateError,
    qr,
    webhookUrl: buildWebhookUrl(req),
  })
}

export async function POST(req: NextRequest) {
  const url = buildWebhookUrl(req)
  if (!url) {
    return NextResponse.json(
      { error: 'GREENAPI_WEBHOOK_TOKEN не задан в окружении' },
      { status: 400 },
    )
  }
  try {
    const result = await setWebhookSettings(url)
    return NextResponse.json({ ok: true, webhookUrl: url, result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Ошибка вызова Green-API' },
      { status: 500 },
    )
  }
}
