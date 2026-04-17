// ============================================================
// src/lib/notifications/channels.ts
// ────────────────────────────────────────────────────────────
// Out-of-band delivery channels (email / push / WhatsApp echo).
//
// in_app is handled directly by inserting into staff_notifications.
// THIS module fans the same notification out to OTHER channels
// when they're enabled in notification_preferences.channels.
//
// Currently only the email channel has a working stub. Real senders
// (Resend, SendGrid, SES, expo-push, FCM, …) plug in by implementing
// `EmailSender` / `PushSender` and being returned from the factory.
//
// All sends are best-effort — failures get console.warn'd, never
// thrown — so a flaky email provider can't break the in-app flow.
// ============================================================

export interface EmailMessage {
  to:       string
  subject:  string
  bodyText: string
  bodyHtml?: string
}

export interface EmailSender {
  name: string
  send(msg: EmailMessage): Promise<{ ok: boolean; errorText?: string }>
}

// ── No-op (default) ────────────────────────────────────────

class NoopEmail implements EmailSender {
  name = 'noop'
  async send(msg: EmailMessage) {
    console.log('[email/noop] would send:', msg.to, '|', msg.subject)
    return { ok: true }
  }
}

// ── Resend (https://resend.com) ────────────────────────────
// POST https://api.resend.com/emails
//   Authorization: Bearer <key>
//   { from, to, subject, text, html? }

class ResendEmail implements EmailSender {
  name = 'resend'
  constructor(private apiKey: string, private fromAddr: string) {}
  async send(msg: EmailMessage) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    this.fromAddr,
          to:      [msg.to],
          subject: msg.subject,
          text:    msg.bodyText,
          html:    msg.bodyHtml,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        return { ok: false, errorText: j?.message ?? `HTTP ${res.status}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, errorText: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ── Factory ────────────────────────────────────────────────

let cachedEmail: EmailSender | null = null

export function getEmailSender(): EmailSender {
  if (cachedEmail) return cachedEmail
  const provider = (process.env.EMAIL_PROVIDER ?? 'noop').toLowerCase()
  switch (provider) {
    case 'resend': {
      const key = process.env.EMAIL_API_KEY
      const from = process.env.EMAIL_FROM
      if (!key || !from) {
        console.warn('[email] EMAIL_API_KEY/EMAIL_FROM not set — falling back to noop')
        cachedEmail = new NoopEmail()
        break
      }
      cachedEmail = new ResendEmail(key, from)
      break
    }
    case 'noop':
    default:
      cachedEmail = new NoopEmail()
  }
  return cachedEmail
}
