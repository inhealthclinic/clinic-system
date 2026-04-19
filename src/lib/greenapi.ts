/**
 * Green-API — тонкий клиент для WhatsApp.
 * Docs: https://green-api.com/docs/api/
 *
 * ENV:
 *   GREENAPI_INSTANCE_ID    — idInstance
 *   GREENAPI_API_TOKEN      — apiTokenInstance
 *   GREENAPI_WEBHOOK_TOKEN  — случайный секрет, прописывается в Green-API как
 *                             webhookUrl=https://.../api/webhooks/greenapi?t=<token>
 */

const ID = process.env.GREENAPI_INSTANCE_ID
const TOKEN = process.env.GREENAPI_API_TOKEN

function assertConfigured() {
  if (!ID || !TOKEN) {
    throw new Error('Green-API not configured: missing GREENAPI_INSTANCE_ID or GREENAPI_API_TOKEN')
  }
}

function base() {
  assertConfigured()
  return `https://api.green-api.com/waInstance${ID}`
}

/** "+7 705 123-45-67" → "77051234567" */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** "77051234567" → "77051234567@c.us" (для приватных чатов) */
export function toChatId(phone: string): string {
  return normalizePhone(phone) + '@c.us'
}

export async function sendWhatsAppText(phoneE164: string, text: string): Promise<{ idMessage: string }> {
  const res = await fetch(`${base()}/sendMessage/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: toChatId(phoneE164), message: text }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GreenAPI sendMessage ${res.status}: ${body}`)
  }
  return res.json()
}

export type InstanceState =
  | 'authorized'       // готов к работе
  | 'notAuthorized'    // QR не отсканирован
  | 'blocked'
  | 'sleepMode'
  | 'starting'
  | 'yellowCard'

export async function getStateInstance(): Promise<{ stateInstance: InstanceState }> {
  const res = await fetch(`${base()}/getStateInstance/${TOKEN}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GreenAPI getStateInstance ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Base64 PNG QR-кода для привязки номера */
export async function getQr(): Promise<{ type: 'qrCode' | 'alreadyLogged' | 'error'; message: string }> {
  const res = await fetch(`${base()}/qr/${TOKEN}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GreenAPI qr ${res.status}: ${await res.text()}`)
  return res.json()
}

/**
 * Прописать webhook URL и включить нужные события.
 * Вызывается один раз с админки, или из server-side при ротации.
 */
export async function setWebhookSettings(webhookUrl: string) {
  const res = await fetch(`${base()}/setSettings/${TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      webhookUrl,
      webhookUrlToken: '',                     // можно задать, тогда прилетит в заголовке
      incomingWebhook: 'yes',                  // incomingMessageReceived
      outgoingWebhook: 'yes',                  // outgoingMessageReceived (мой исход из телефона)
      outgoingMessageWebhook: 'yes',           // outgoingAPIMessageReceived (API отправки)
      outgoingAPIMessageWebhook: 'yes',
      stateWebhook: 'yes',                     // stateInstanceChanged
      deviceWebhook: 'no',
      statusInstanceWebhook: 'yes',
      // как часто GreenAPI будет поллить обновления для входящих:
      delaySendMessagesMilliseconds: 1000,
    }),
  })
  if (!res.ok) throw new Error(`GreenAPI setSettings ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Парсинг webhook-событий ───────────────────────────────────────────────
// https://green-api.com/docs/api/receiving/notifications-format/

export interface IncomingMessageWebhook {
  typeWebhook: 'incomingMessageReceived'
  idMessage: string
  timestamp: number
  senderData: {
    chatId: string
    sender: string
    /** Имя, которое собеседник сам указал в своём WhatsApp-профиле */
    senderName?: string
    /** Имя из адресной книги привязанного устройства (если номер сохранён) */
    senderContactName?: string
  }
  messageData: {
    typeMessage: string
    textMessageData?: { textMessage: string }
    extendedTextMessageData?: { text: string }
  }
}

/**
 * Вытащить «хорошее» имя из senderData: приоритет — имя из адресной книги
 * (его сам задал оператор), затем profile-имя из WhatsApp. Фильтруем явный
 * мусор: пустые строки, '—', голые цифры (номер телефона без имени).
 */
export function extractSenderName(
  sd: IncomingMessageWebhook['senderData']
): string | null {
  const raw = (sd.senderContactName ?? sd.senderName ?? '').trim()
  if (!raw) return null
  // "77051234567" / "+7 705 123 45 67" — это телефон, а не имя
  if (/^[+\d\s()-]+$/.test(raw)) return null
  return raw
}

export interface OutgoingStatusWebhook {
  typeWebhook: 'outgoingMessageStatus'
  chatId: string
  idMessage: string
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'noAccount' | 'notInGroup'
  timestamp: number
}

export interface StateWebhook {
  typeWebhook: 'stateInstanceChanged'
  stateInstance: InstanceState
}

export type GreenApiWebhook =
  | IncomingMessageWebhook
  | OutgoingStatusWebhook
  | StateWebhook
  | { typeWebhook: string; [k: string]: unknown }

/** Вытащить текст из incomingMessageReceived в человекочитаемый string или null для не-текстовых сообщений */
export function extractIncomingText(wh: IncomingMessageWebhook): string | null {
  const md = wh.messageData
  if (md.typeMessage === 'textMessage') return md.textMessageData?.textMessage ?? null
  if (md.typeMessage === 'extendedTextMessage') return md.extendedTextMessageData?.text ?? null
  if (md.typeMessage === 'imageMessage') return '[🖼 изображение]'
  if (md.typeMessage === 'audioMessage') return '[🎙 аудио]'
  if (md.typeMessage === 'videoMessage') return '[🎬 видео]'
  if (md.typeMessage === 'documentMessage') return '[📎 документ]'
  return `[${md.typeMessage}]`
}
