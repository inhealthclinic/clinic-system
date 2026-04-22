/**
 * Провайдеры отправки уведомлений: Twilio (SMS) и Meta WhatsApp Business.
 *
 * Читают креды из env на момент вызова — если env-переменная не задана,
 * функция возвращает { ok:false, error:'provider not configured' }, и
 * вызывающий код помечает запись в notifications_log как 'failed'.
 * Это позволяет развернуть пайплайн до подключения провайдеров —
 * сообщения будут копиться в логе со статусом failed и понятной ошибкой.
 */

export interface SendResult {
  ok: boolean
  providerId?: string
  error?: string
}

/* ─── Twilio SMS ─────────────────────────────────────────── */

export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_PHONE
  if (!sid || !token || !from) {
    return { ok: false, error: 'twilio not configured' }
  }

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const form = new URLSearchParams({ To: to, From: from, Body: body })

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
    const json = (await res.json()) as { sid?: string; message?: string; code?: number }
    if (!res.ok) return { ok: false, error: json.message || `HTTP ${res.status}` }
    return { ok: true, providerId: json.sid }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

/* ─── Meta WhatsApp Business ─────────────────────────────── */

export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const phoneId = process.env.WHATSAPP_PHONE_ID
  const token = process.env.WHATSAPP_TOKEN
  if (!phoneId || !token) {
    return { ok: false, error: 'whatsapp not configured' }
  }

  // Meta требует номер без «+», только цифры
  const cleanTo = to.replace(/\D/g, '')

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: cleanTo,
        type: 'text',
        text: { body },
      }),
    })
    const json = (await res.json()) as {
      messages?: Array<{ id: string }>
      error?: { message: string }
    }
    if (!res.ok) return { ok: false, error: json.error?.message || `HTTP ${res.status}` }
    return { ok: true, providerId: json.messages?.[0]?.id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'network error' }
  }
}

/* ─── Диспатчер по каналу ────────────────────────────────── */

export async function send(
  channel: 'sms' | 'whatsapp',
  to: string,
  body: string,
): Promise<SendResult> {
  if (channel === 'sms') return sendSms(to, body)
  if (channel === 'whatsapp') return sendWhatsApp(to, body)
  return { ok: false, error: `unknown channel: ${channel}` }
}
