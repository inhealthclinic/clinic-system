/**
 * Green-API — тонкий клиент для WhatsApp.
 * Docs: https://green-api.com/docs/api/
 *
 * Креды per-clinic: берутся из БД (clinics.whatsapp_instance_id / whatsapp_api_token)
 * и кешируются в памяти процесса на 30 секунд per-clinic. Если в БД для конкретной
 * клиники пусто — НЕ фолбэчим на env (иначе уйдёт сообщение с чужого инстанса).
 *
 * Особый случай: clinicId === null → используем env (для системных операций
 * без контекста конкретной клиники, если такие появятся).
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

type CacheEntry = { creds: GreenApiCreds | null; at: number }
const _credsCache: Map<string, CacheEntry> = new Map()
const CRED_TTL_MS = 30_000
const ENV_KEY = '__env__'

/**
 * Сбросить кеш кредов — после изменения настроек в UI вызывайте это,
 * чтобы следующий запрос подхватил новые значения сразу.
 *
 * Если передан clinicId — инвалидируем только его. Без аргумента — весь кеш
 * (включая env-fallback).
 */
export function invalidateGreenApiCredsCache(clinicId?: string) {
  if (clinicId === undefined) {
    _credsCache.clear()
    return
  }
  _credsCache.delete(clinicId)
}

function loadEnvCreds(): GreenApiCreds | null {
  const id = process.env.GREENAPI_INSTANCE_ID
  const token = process.env.GREENAPI_API_TOKEN
  const url = process.env.GREENAPI_API_URL
  if (id && token) return { instanceId: id, apiToken: token, apiUrl: url?.trim() || inferApiUrl(id) }
  return null
}

/**
 * Загрузить креды для конкретной клиники.
 *
 * • clinicId !== null → грузим из clinics по id. Если в БД пусто — возвращаем
 *   null (НЕ фолбэчим на env, чтобы сообщения не уходили с чужого инстанса
 *   в multi-tenant).
 * • clinicId === null → берём env (для системных операций без контекста клиники).
 *
 * TTL 30 секунд per-clinic.
 */
async function loadCreds(clinicId: string | null): Promise<GreenApiCreds | null> {
  const key = clinicId ?? ENV_KEY
  const cached = _credsCache.get(key)
  if (cached && Date.now() - cached.at < CRED_TTL_MS) {
    return cached.creds
  }

  let creds: GreenApiCreds | null = null

  if (clinicId === null) {
    creds = loadEnvCreds()
  } else {
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
        .eq('id', clinicId)
        .maybeSingle()
      if (data?.whatsapp_instance_id && data?.whatsapp_api_token) {
        creds = {
          instanceId: data.whatsapp_instance_id,
          apiToken: data.whatsapp_api_token,
          apiUrl: (data.whatsapp_api_url as string | null)?.trim() || inferApiUrl(data.whatsapp_instance_id),
        }
      }
    } catch {
      // если БД недоступна — оставляем creds=null, не фолбэчим на env
      // (чтобы не уехало с чужого инстанса)
    }
  }

  _credsCache.set(key, { creds, at: Date.now() })
  return creds
}

async function requireCreds(clinicId: string | null): Promise<GreenApiCreds> {
  const c = await loadCreds(clinicId)
  if (!c) {
    const where = clinicId === null
      ? 'переменные окружения GREENAPI_INSTANCE_ID / GREENAPI_API_TOKEN'
      : `clinics.whatsapp_instance_id / whatsapp_api_token для клиники ${clinicId}`
    throw new Error(`Green-API not configured: задайте ${where} (или /settings/whatsapp)`)
  }
  return c
}

async function base(clinicId: string | null): Promise<{ url: string; token: string }> {
  const c = await requireCreds(clinicId)
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

export async function sendWhatsAppText(
  phoneE164: string,
  text: string,
  clinicId: string | null,
): Promise<{ idMessage: string }> {
  const { url, token } = await base(clinicId)
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
  caption: string | undefined,
  clinicId: string | null,
): Promise<{ idMessage: string }> {
  const { url, token } = await base(clinicId)
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

export async function getStateInstance(clinicId: string | null): Promise<{ stateInstance: InstanceState }> {
  const { url, token } = await base(clinicId)
  const res = await fetch(`${url}/getStateInstance/${token}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GreenAPI getStateInstance ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Base64 PNG QR-кода для привязки номера */
export async function getQr(clinicId: string | null): Promise<{ type: 'qrCode' | 'alreadyLogged' | 'error'; message: string }> {
  const { url, token } = await base(clinicId)
  const res = await fetch(`${url}/qr/${token}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`GreenAPI qr ${res.status}: ${await res.text()}`)
  return res.json()
}

/**
 * Прописать webhook URL и включить нужные события.
 * Вызывается один раз с админки, или из server-side при ротации.
 */
export async function setWebhookSettings(webhookUrl: string, clinicId: string | null) {
  const { url, token } = await base(clinicId)
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

/** Есть ли заданные креды для клиники (или env, если clinicId=null) — для UI-индикатора. */
export async function isGreenApiConfigured(clinicId: string | null): Promise<boolean> {
  const c = await loadCreds(clinicId)
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
    extendedTextMessageData?: {
      text: string
      /** URL ссылки если WhatsApp сгенерил превью. Часто отсутствует в text. */
      description?: string
      title?: string
      previewType?: string
      jpegThumbnail?: string
      /** На пересылке поста: ссылка на оригинальный пост. */
      forwardingScore?: number
      isForwarded?: boolean
      stanzaId?: string
    }
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
/** Вытащить первый номер телефона из vCard-строки. */
function parseVcardPhone(vcard: string | undefined): string | null {
  if (!vcard) return null
  const m = vcard.match(/TEL[^:]*:([+\d\s()-]+)/i)
  return m ? m[1].trim() : null
}

export function extractIncomingText(wh: IncomingMessageWebhook): string | null {
  // Зачем не полагаемся только на typeMessage: Green-API в разных версиях
  // присылает то 'quotedMessage', то 'extendedTextMessage' с вложенным
  // quotedMessage; типы могут отличаться регистром или иметь префиксы
  // ('reactionMessage' vs 'editedMessage' vs 'forwardedMessage'). Поэтому
  // сначала смотрим на наличие специфических data-полей, затем уже
  // на typeMessage как подсказку.
  const md = wh.messageData as IncomingMessageWebhook['messageData'] & Record<string, unknown>
  const t = (md.typeMessage || '').toLowerCase()
  const caption = md.fileMessageData?.caption?.trim()
  const captionLine = caption ? `\n${caption}` : ''

  // 1. Простой/расширенный текст и свайп-ответы — все они кладут текст в
  // textMessageData или extendedTextMessageData. Если хоть одно из этих
  // полей заполнено непустой строкой — это и есть текст пациента.
  // Для extendedText ссылка часто живёт в description/title (превью линка),
  // а в text только подпись пациента — приклеиваем URL отдельной строкой,
  // чтобы менеджер не терял ссылку.
  const plainText = md.textMessageData?.textMessage?.trim()
  if (plainText) return plainText
  const ext = md.extendedTextMessageData
  if (ext) {
    const extText = ext.text?.trim() ?? ''
    const urlLike = (s: string | undefined): string | null => {
      const t = s?.trim()
      if (!t) return null
      return /^https?:\/\//i.test(t) ? t : null
    }
    const linkUrl = urlLike(ext.title) || urlLike(ext.description)
    if (linkUrl && !extText.includes(linkUrl)) {
      return extText ? `${extText}\n${linkUrl}` : linkUrl
    }
    if (extText) return extText
    if (linkUrl) return linkUrl
  }

  // 2. Реакция эмодзи — может прийти как reactionMessage или внутри
  // другого типа. Проверяем по data-полю.
  if (md.reactionMessageData) {
    const emoji = md.reactionMessageData.text?.trim()
    return emoji ? `↪️ реакция: ${emoji}` : '↪️ реакция снята'
  }

  // 3. Геолокация
  if (md.locationMessageData) {
    const l = md.locationMessageData
    const label = [l.nameLocation, l.address].filter(Boolean).join(', ')
    const map = `https://maps.google.com/?q=${l.latitude},${l.longitude}`
    return `📍 геолокация${label ? ' · ' + label : ''}\n${map}`
  }

  // 4. Контакт визиткой
  if (md.contactMessageData) {
    const name = md.contactMessageData.displayName?.trim()
    const phone = parseVcardPhone(md.contactMessageData.vcard)
    const parts = [name, phone].filter(Boolean).join(' · ')
    return `👤 контакт${parts ? ' · ' + parts : ''}`
  }
  if (md.contactsArrayMessageData) {
    const items = (md.contactsArrayMessageData.contacts ?? []).map(c => {
      const ph = parseVcardPhone(c.vcard)
      return [c.displayName, ph].filter(Boolean).join(' · ')
    }).filter(Boolean)
    return `👤 контакты${items.length ? '\n' + items.map(i => '• ' + i).join('\n') : ''}`
  }

  // 5. Опрос
  if (md.pollMessageData) {
    const p = md.pollMessageData
    const opts = p.options?.map(o => '• ' + o.optionName).join('\n')
    return `📊 опрос: ${p.name}${opts ? '\n' + opts : ''}`
  }

  // 6. Медиа: ориентируемся на typeMessage (он чёткий) + caption
  if (t.includes('image'))    return `🖼 изображение${captionLine}`
  if (t.includes('video'))    return `🎬 видео${captionLine}`
  if (t.includes('audio'))    return `🎙 аудио${captionLine}`
  if (t.includes('sticker'))  return '🎭 стикер'
  if (t.includes('document')) {
    const name = md.fileMessageData?.fileName?.trim()
    return `📎 документ${name ? ' · ' + name : ''}${captionLine}`
  }

  // 7. Совсем неизвестный тип — оставим placeholder, но без квадратных
  // скобок, чтобы оператор хотя бы видел осмысленную отметку.
  return `❓ сообщение (${md.typeMessage || 'unknown'})`
}
