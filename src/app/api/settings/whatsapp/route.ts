import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getStateInstance, getQr, setWebhookSettings, invalidateGreenApiCredsCache } from '@/lib/greenapi'

/**
 * GET  /api/settings/whatsapp — статус интеграции WhatsApp (Green-API).
 * POST /api/settings/whatsapp — { instanceId?, apiToken?, webhookToken?, registerWebhook? }
 *   Сохраняет переданные креды в clinics (только не-undefined поля),
 *   опционально регистрирует webhook URL в Green-API.
 *
 * Креды хранятся per-clinic в таблице clinics. Env-переменные остаются
 * fallback-ом, но UI пишет в БД, чтобы не требовать редеплоя.
 *
 * Ответ GET:
 *   • configured.{instanceId,apiToken,webhookToken} — заданы ли значения
 *   • source.{instanceId,apiToken,webhookToken} — 'db' | 'env' | null
 *   • saved.{instanceId,webhookToken} — что лежит в БД (apiToken не отдаём)
 *   • state — состояние инстанса (authorized / notAuthorized / …)
 *   • qr (только если не авторизован) — base64 PNG для сканирования
 *   • webhookUrl — URL для прописывания в Green-API
 */

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function authorizedClinicId(req: NextRequest): Promise<{ clinicId: string } | { error: string; status: number }> {
  const admin = adminClient()
  if (!admin) return { error: 'Сервер не настроен', status: 503 }
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return { error: 'Нужна авторизация', status: 401 }
  }
  const jwt = authHeader.slice('bearer '.length).trim()
  const { data: userInfo, error: userErr } = await admin.auth.getUser(jwt)
  if (userErr || !userInfo?.user) return { error: 'Сессия недействительна', status: 401 }
  const { data: profile } = await admin
    .from('user_profiles')
    .select('clinic_id, role:roles(slug)')
    .eq('id', userInfo.user.id)
    .maybeSingle()
  if (!profile?.clinic_id) return { error: 'Профиль не найден', status: 403 }
  const slug = (profile.role as { slug?: string } | null)?.slug
  if (slug !== 'owner' && slug !== 'admin') {
    return { error: 'Только владелец/администратор может менять настройки WhatsApp', status: 403 }
  }
  return { clinicId: profile.clinic_id }
}

async function loadClinicCreds(clinicId: string) {
  const admin = adminClient()
  if (!admin) return null
  const { data } = await admin
    .from('clinics')
    .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_webhook_token, whatsapp_api_url')
    .eq('id', clinicId)
    .maybeSingle()
  return data
}

function buildWebhookUrl(req: NextRequest, token: string | null): string | null {
  if (!token) return null
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  const origin = fromEnv ?? req.nextUrl.origin
  return `${origin.replace(/\/$/, '')}/api/webhooks/greenapi?t=${encodeURIComponent(token)}`
}

export async function GET(req: NextRequest) {
  const auth = await authorizedClinicId(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const row = await loadClinicCreds(auth.clinicId)

  // Резолвим эффективные значения (DB → env → null) и помечаем источник.
  const effectiveInstanceId = row?.whatsapp_instance_id || process.env.GREENAPI_INSTANCE_ID || null
  const effectiveApiToken   = row?.whatsapp_api_token   || process.env.GREENAPI_API_TOKEN   || null
  const effectiveWebhookTok = row?.whatsapp_webhook_token || process.env.GREENAPI_WEBHOOK_TOKEN || null

  const source = {
    instanceId:   row?.whatsapp_instance_id   ? 'db' : (process.env.GREENAPI_INSTANCE_ID    ? 'env' : null),
    apiToken:     row?.whatsapp_api_token     ? 'db' : (process.env.GREENAPI_API_TOKEN      ? 'env' : null),
    webhookToken: row?.whatsapp_webhook_token ? 'db' : (process.env.GREENAPI_WEBHOOK_TOKEN  ? 'env' : null),
  }

  const configured = {
    instanceId:   !!effectiveInstanceId,
    apiToken:     !!effectiveApiToken,
    webhookToken: !!effectiveWebhookTok,
  }

  const saved = {
    instanceId:   row?.whatsapp_instance_id   ?? null,
    webhookToken: row?.whatsapp_webhook_token ?? null,
    apiUrl:       row?.whatsapp_api_url       ?? null,
    // apiToken осознанно НЕ возвращаем — секрет
    apiTokenMask: row?.whatsapp_api_token ? '••••' + row.whatsapp_api_token.slice(-4) : null,
  }

  if (!configured.instanceId || !configured.apiToken) {
    return NextResponse.json({
      configured, source, saved,
      state: null, qr: null,
      webhookUrl: buildWebhookUrl(req, effectiveWebhookTok),
      error: 'Задайте instanceId и apiToken в форме ниже или через переменные окружения',
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
    configured, source, saved,
    state, stateError, qr,
    webhookUrl: buildWebhookUrl(req, effectiveWebhookTok),
  })
}

export async function POST(req: NextRequest) {
  const auth = await authorizedClinicId(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: {
    instanceId?: string | null
    apiToken?: string | null
    webhookToken?: string | null
    apiUrl?: string | null
    registerWebhook?: boolean
  } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const admin = adminClient()
  if (!admin) return NextResponse.json({ error: 'Сервер не настроен' }, { status: 503 })

  // Готовим patch — только присланные поля. null/'' трактуем как «очистить».
  const patch: Record<string, string | null> = {}
  if (body.instanceId !== undefined) {
    const v = body.instanceId?.toString().trim() ?? ''
    patch.whatsapp_instance_id = v ? v : null
  }
  if (body.apiToken !== undefined) {
    const v = body.apiToken?.toString().trim() ?? ''
    patch.whatsapp_api_token = v ? v : null
  }
  if (body.apiUrl !== undefined) {
    const v = body.apiUrl?.toString().trim() ?? ''
    patch.whatsapp_api_url = v ? v.replace(/\/$/, '') : null
  }
  if (body.webhookToken !== undefined) {
    let v = body.webhookToken?.toString().trim() ?? ''
    // Авто-генерация: если попросили явный 'auto' или пустой при registerWebhook
    if (v === 'auto') {
      v = cryptoRandomToken()
    }
    patch.whatsapp_webhook_token = v ? v : null
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await admin
      .from('clinics')
      .update(patch)
      .eq('id', auth.clinicId)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    invalidateGreenApiCredsCache()
  }

  // Регистрация webhook (опциональная).
  if (body.registerWebhook) {
    const row = await loadClinicCreds(auth.clinicId)
    const tok = row?.whatsapp_webhook_token || process.env.GREENAPI_WEBHOOK_TOKEN || null
    const url = buildWebhookUrl(req, tok)
    if (!url) {
      return NextResponse.json(
        { error: 'webhookToken не задан — введите его выше или нажмите «Сгенерировать»' },
        { status: 400 },
      )
    }
    try {
      const result = await setWebhookSettings(url)
      return NextResponse.json({ ok: true, saved: true, webhookUrl: url, result })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Ошибка вызова Green-API' },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true, saved: true })
}

function cryptoRandomToken(): string {
  // 32 hex-символа = 128 бит. Этого хватит, чтобы webhook не угадали.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
