// ============================================================
// src/lib/whatsapp/providers.ts
// ────────────────────────────────────────────────────────────
// Provider-agnostic abstraction for sending WhatsApp messages.
//
// Wire-up per environment via env:
//   WHATSAPP_PROVIDER = 'whapi' | '360dialog' | 'twilio' | 'noop'
//   WHATSAPP_API_URL  = base URL of provider
//   WHATSAPP_API_KEY  = bearer token / API key
//
// `noop` is the default (no actual send) — message rows are still
// stored in DB so the chat UI works in dev.
//
// To add a new provider:
//   1. Implement WhatsAppProvider with sendText()/sendMedia().
//   2. Map your provider's webhook payload to the shape expected
//      by /api/whatsapp/webhook (or write an adapter route
//      that calls processInboundMessage with normalized fields).
// ============================================================

export interface SendTextResult {
  ok:           boolean
  providerId?:  string     // their message id, store in wa_message_id
  errorText?:   string
}

export interface WhatsAppProvider {
  name: string
  sendText(args: {
    fromPhone: string         // +77... clinic number
    toPhone:   string         // +77... recipient
    text:      string
  }): Promise<SendTextResult>
}

// ── No-op (default) ────────────────────────────────────────

class NoopProvider implements WhatsAppProvider {
  name = 'noop'
  async sendText() {
    return { ok: true, providerId: `noop-${Date.now()}` }
  }
}

// ── Whapi adapter (https://whapi.cloud) ────────────────────
// Real call shape: POST {base}/messages/text
//   Authorization: Bearer <token>
//   { to: '77081234567', body: 'hello' }
// Replies with { sent: true, message: { id: 'wamid...' } }

class WhapiProvider implements WhatsAppProvider {
  name = 'whapi'
  private apiKey: string
  private baseUrl: string
  constructor(opts: { apiKey: string; baseUrl?: string }) {
    this.apiKey  = opts.apiKey
    this.baseUrl = (opts.baseUrl ?? 'https://gate.whapi.cloud').replace(/\/+$/, '')
  }
  async sendText({ toPhone, text }: { fromPhone: string; toPhone: string; text: string }): Promise<SendTextResult> {
    try {
      const res = await fetch(`${this.baseUrl}/messages/text`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          to: toPhone.replace(/\D/g, ''),
          body: text,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, errorText: json?.message ?? `HTTP ${res.status}` }
      }
      const providerId = json?.message?.id ?? json?.id
      return { ok: true, providerId }
    } catch (err) {
      return { ok: false, errorText: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ── Factory ────────────────────────────────────────────────

let cached: WhatsAppProvider | null = null

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached
  const name = (process.env.WHATSAPP_PROVIDER ?? 'noop').toLowerCase()
  switch (name) {
    case 'whapi': {
      const key = process.env.WHATSAPP_API_KEY
      if (!key) {
        console.warn('[wa/providers] WHATSAPP_API_KEY not set — falling back to noop')
        cached = new NoopProvider()
        break
      }
      cached = new WhapiProvider({
        apiKey:  key,
        baseUrl: process.env.WHATSAPP_API_URL,
      })
      break
    }
    // case '360dialog': cached = new ThreeSixtyProvider({...}); break
    // case 'twilio':    cached = new TwilioProvider({...});    break
    case 'noop':
    default:
      cached = new NoopProvider()
  }
  return cached
}
