// Helpers для работы с appointment.notes и типами приёмов.
// Вынесено из schedule/page.tsx, чтобы модалку «Новая запись» можно было
// переиспользовать из CRM (кнопка «Записать на приём» в карточке сделки).

import type { Appointment } from '@/types'

// ─── Appointment type presets ────────────────────────────────────────────────

export type ApptTypeItem = { key: string; label: string; color: string }

export const DEFAULT_APPT_TYPES: ApptTypeItem[] = [
  { key: 'consultation', label: 'Консультация', color: '#3b82f6' },
  { key: 'procedure',    label: 'Процедура',    color: '#8b5cf6' },
  { key: 'checkup',      label: 'Осмотр',       color: '#10b981' },
  { key: 'followup',     label: 'Повторный',    color: '#06b6d4' },
  { key: 'surgery',      label: 'Операция',     color: '#f59e0b' },
  { key: 'emergency',    label: 'Срочно',       color: '#ef4444' },
  { key: 'other',        label: 'Другое',       color: '#6b7280' },
]

// ─── notes-meta (fallback-кодировка type+color в notes) ──────────────────────

const NOTES_META_RE = /^\[t:([^|\]]*)(?:\|c:(#[0-9a-fA-F]{3,8}))?\]\s*/

export function parseNotesMeta(
  notes: string | null | undefined,
): { type: string | null; color: string | null; rest: string } {
  if (!notes) return { type: null, color: null, rest: '' }
  const m = notes.match(NOTES_META_RE)
  if (!m) return { type: null, color: null, rest: notes }
  return { type: m[1] || null, color: m[2] || null, rest: notes.replace(NOTES_META_RE, '') }
}

export function formatNotesMeta(
  typeKey: string | null | undefined,
  color: string | null | undefined,
  rest: string,
): string | null {
  const body = (rest ?? '').trim()
  if (!typeKey && !color) return body || null
  const t = typeKey ?? ''
  const c = color ? `|c:${color}` : ''
  const prefix = `[t:${t}${c}] `
  return body ? prefix + body : prefix.trim()
}

export function apptType(appt: Appointment): string | null {
  if (appt.appt_type) return appt.appt_type
  return parseNotesMeta(appt.notes).type
}

export function apptColor(appt: Appointment): string {
  if (appt.color) return appt.color
  const meta = parseNotesMeta(appt.notes)
  if (meta.color) return meta.color
  const doc = appt.doctor as { color?: string } | undefined
  return doc?.color ?? '#3b82f6'
}

export function apptDisplayNotes(appt: Appointment): string {
  return parseNotesMeta(appt.notes).rest
}
