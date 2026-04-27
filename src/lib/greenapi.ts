/**
 * Green-API — тонкий клиент для WhatsApp.
 * Docs: https://green-api.com/docs/api/
 *
 * Креды берутся из БД (clinics.whatsapp_instance_id / whatsapp_api_token)
 * и кешируются в памяти процесса на 30 секунд. Если в БД пусто — fallback
 * на env-переменные GREENAPI_INSTANCE_ID / GREENAPI_API_TOKEN.
 *
 * GREENAPI_WEBHOOK_TOKEN тоже мигрирует в БД (clinics.whatsapp_webhook_token),
 * этой функцией не пользуется — только webhook-роут.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export interface GreenApiCreds {
  instanceId: string
  apiToken: string
  /**
   * База API. Для классических инстансов — https://api.green-api.com.
   * Для free-tier (7103/7105/7107…) — шардовый https://{prefix}.api.greenapi.com.
   * Берётся из карточки инстанса в console.green-api.com → строка «API URL».
   */
  apiUrl: string
}

const DEFAULT_API_URL = 'https://api.green-api.com'

/**
 * Если apiUrl не задан, угадываем по префиксу instanceId:
 *   7103xxxxxx → https://7103.api.greenapi.com
 *   7105xxxxxx → https://7105.api.greenapi.com
 *   7107xxxxxx → https://7107.api.greenapi.com
 *   и т.д. для всех 7xxx.
 * Для всех остальных id — старый https://api.green-api.com.
 */
function inferApiUrl(instanceId: string): string {
  const prefix = instanceId.slice(0, 4)
  if (/^7\d{3}$/.test(prefix)) return `https://${prefix}.api.greenapi.com`
  return DEFAULT_API_URL
}

let _credsCache: { creds: GreenApiCreds | null; at: number } | null = null
const CRED_TTL_MS = 30_000

/**
 * Сбросить кеш кредов — после изменения настроек в UI вызывайте это,
 * чтобы следующий запрос подхватил новые значения сразу.
 */
export function invalidateGreenApiCredsCache() {
  _credsCache = null
}

async function loadCreds(): Promise<GreenApiCreds | null> {
  if (_credsCache && Date.now() - _credsCache.at < CRED_TTL_MS) {
    return _credsCache.creds
  }
  let creds: GreenApiCreds | null = null
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) throw new Error('no supabase env')
    const admin = createSupabaseClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data } = await admin
      .from('clinics')
      .select('whatsapp_instance_id, whatsapp_api_token, whatsapp_api_url')
      .not('whatsapp_instance_id', 'is', null)
      .not('whatsapp_api_token', 'is', null)
      .limit(1)
      .maybeSingle()
    if (data?.whatsapp_instance_id && data?.whatsapp_api_token) {
      creds = {
        instanceId: data.whatsapp_instance_id,
        apiToken: data.whatsapp_api_token,
        apiUrl: (data.whatsapp_api_url as string | null)?.trim() || inferApiUrl(data.whatsapp_instance_id),
      }
    }
  } catch {
    // если БД недоступна — провалимся на env
  }
  if (!creds) {
    const id = process.env.GREENAPI_INSTANCE_ID
    const token = process.env.GREENAPI_API_TOKEN
    const url = process.env.GREENAPI_API_URL
    if (id && token) creds = { instanceId: id, apiToken: token, apiUrl: url?.trim() || inferApiUrl(id) }
  }
  _credsCache = { creds, at: Date.now() }
  return creds
}

async function requireCreds(): Promise<GreenApiCreds> {
  const c = await loadCreds()
  if (!c) {
    throw new Error(
      'Green-API not configured: задайте instanceId/apiToken в /settings/whatsapp ' +
      'или переменные окружения GREENAPI_INSTANCE_ID / GREENAPI_API_TOKEN',
    )
  }
  return c
}

async function base(): Promise<{ url: string; token: string }> {
  const c = await requireCreds()
  const apiUrl = c.apiUrl.replace(/\/$/, '')
  return {
    url: `${apiUrl}/waInstance${c.instanceId}`,
    token: c.apiToken,
  }
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
  const { url, token } = await base()
  const res = await fetch(`${url}/sendMessage/${token}`, {
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

/**
 * Отправить файл по публичному URL. Для голосовых сообщений (audio/ogg;codecs=opus)
 * Green-API определит это как PTT и отрендерит как голосовое в нативном WhatsApp.
 *
 * Docs: https://green-api.com/docs/api/sending/SendFileByUrl/
 */
export async function sendWhatsAppFileByUrl(
  phoneE164: string,
  fileUrl: string,
  fileName: string,
  caption?: string,
): Promise<{ idMessage: string }> {
  const { url, token } = await base()
  const res = await fetch(`${url}/sendFileByUrl/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: toChatId(phoneE164),
      urlFile: fileUrl,
      fileName,
      caption: caption ?? '',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GreenAPI sendFileByUrl ${res.status}: ${body}`)
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
  const { url, token } = await base()
  const res = await fetch(`${url}/getStateInstance/${token}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GreenAPI getStateInstance ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Base64 PNG QR-кода для привязки номера */
export async function getQr(): Promise<{ type: 'qrCode' | 'alreadyLogged' | 'error'; message: string }> {
  const { url, token } = await base()
  const res = await fetch(`${url}/qr/${token}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GreenAPI qr ${res.status}: ${await res.text()}`)
  return res.json()
}

/**
 * Прописать webhook URL и включить нужные события.
 * Вызывается один раз с админки, или из server-side при ротации.
 */
export async function setWebhookSettings(webhookUrl: string) {
  const { url, token } = await base()
  const res = await fetch(`${url}/setSettings/${token}`, {
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

/** Есть ли где-то заданные креды (БД или env) — для UI-индикатора. */
export async function isGreenApiConfigured(): Promise<boolean> {
  const c = await loadCreds()
  return !!c
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
    /** Для audio/voice/image/video/document/sticker — Green-API отдаёт CDN-ссылку. */
    fileMessageData?: {
      downloadUrl: string
      caption?: string
      fileName?: string
      mimeType?: string
      isAnimated?: boolean
      jpegThumbnail?: string
    }
    locationMessageData?: {
      nameLocation?: string
      address?: string
      latitude: number
      longitude: number
      jpegThumbnail?: string
    }
    contactMessageData?: {
      displayName: string
      vcard: string
    }
    contactsArrayMessageData?: {
      contacts: Array<{ displayName: string; vcard: string }>
    }
    pollMessageData?: {
      name: string
      options: Array<{ optionName: string }>
      multipleAnswers?: boolean
    }
    reactionMessageData?: {
      text: string
      messageId?: string
    }
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

/** Вытащить текст из incomingMessageReceived в человекочитаемый string или null для не-текстовых сообщений.
 *
 *  Для медиа (image/video/document) сохраняем подпись пациента, если она есть —
 *  иначе теряются ссылки и комментарии, которые он написал к фото/видео
 *  (характерный кейс — пересылка поста Instagram: приходит imageMessage
 *  c превью и caption-ом, содержащим URL и описание).
 */
export function extractIncomingText(wh: IncomingMessageWebhook): string | null {
  const md = wh.messageData
  const caption = md.fileMessageData?.caption?.trim()
  const captionLine = caption ? `\n${caption}` : ''

  if (md.typeMessage === 'textMessage') return md.textMessageData?.textMessage ?? null
  if (md.typeMessage === 'extendedTextMessage') return md.extendedTextMessageData?.text ?? null
  // quotedMessage — пациент сделал свайп-ответ на сообщение. Сам ответ лежит
  // в extendedTextMessageData.text, оригинал цитаты — в отдельном поле, его
  // мы не показываем (UI и так покажет соседнее сообщение из истории).
  if (md.typeMessage === 'quotedMessage') {
    const t = md.extendedTextMessageData?.text?.trim() || md.textMessageData?.textMessage?.trim()
    return t || '↩️ ответ'
  }
  if (md.typeMessage === 'imageMessage')    return `🖼 изображение${captionLine}`
  if (md.typeMessage === 'audioMessage')    return `🎙 аудио${captionLine}`
  if (md.typeMessage === 'videoMessage')    return `🎬 видео${captionLine}`
  if (md.typeMessage === 'documentMessage') {
    const name = md.fileMessageData?.fileName?.trim()
    return `📎 документ${name ? ' · ' + name : ''}${captionLine}`
  }
  if (md.typeMessage === 'stickerMessage') return '🎭 стикер'
  if (md.typeMessage === 'locationMessage') {
    const l = md.locationMessageData
    if (!l) return '📍 геолокация'
    const label = [l.nameLocation, l.address].filter(Boolean).join(', ')
    const coords = `${l.latitude},${l.longitude}`
    const map = `https://maps.google.com/?q=${coords}`
    return `📍 геолокация${label ? ' · ' + label : ''}\n${map}`
  }
  if (md.typeMessage === 'contactMessage') {
    const name = md.contactMessageData?.displayName?.trim()
    return `👤 контакт${name ? ' · ' + name : ''}`
  }
  if (md.typeMessage === 'contactsArrayMessage') {
    const names = md.contactsArrayMessageData?.contacts?.map(c => c.displayName).filter(Boolean)
    return `👤 контакты${names?.length ? ' · ' + names.join(', ') : ''}`
  }
  if (md.typeMessage === 'pollMessage') {
    const p = md.pollMessageData
    if (!p) return '📊 опрос'
    const opts = p.options?.map(o => '• ' + o.optionName).join('\n')
    return `📊 опрос: ${p.name}${opts ? '\n' + opts : ''}`
  }
  if (md.typeMessage === 'reactionMessage') {
    const emoji = md.reactionMessageData?.text?.trim()
    return emoji ? `↪️ реакция: ${emoji}` : '↪️ реакция снята'
  }
  return `[${md.typeMessage}]`
}
