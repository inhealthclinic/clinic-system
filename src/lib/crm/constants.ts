// ============================================================
// src/lib/crm/constants.ts
// ────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for CRM dictionaries.
//
// Why this exists:
//   - The DB enforces strict CHECK constraints on enum-like
//     columns (deals.source, deals.priority, deals.lost_reason,
//     deals.status, tasks.type, tasks.priority, tasks.status,
//     crm_interactions.type, crm_interactions.direction).
//   - The UI has to display Russian labels but MUST insert the
//     normalised lower-case `value` into the DB.
//   - Hard-coding Russian strings into .insert() calls (which
//     used to happen for `source`) caused
//       new row for relation "deals" violates check constraint
//       "deals_source_check"
//
// Rule of thumb:
//   - Pick options from these arrays in <select> elements
//     (use `.value` for the option value, `.label` for display).
//   - When the UI needs a free-form text source (clinic-defined),
//     add it to a SECONDARY column (deals.custom_fields.source_label)
//     and keep deals.source = 'other'.
// ============================================================

// ── Deals ─────────────────────────────────────────────────────

/** Allowed values for `deals.source` (must match migration 004 CHECK). */
export const SOURCE_OPTIONS = [
  { value: 'target',    label: 'Таргет' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp',  label: 'WhatsApp' },
  { value: 'referral',  label: 'Рекомендация' },
  { value: 'organic',   label: 'Сайт' },
  { value: 'repeat',    label: 'Повторный' },
  { value: 'other',     label: 'Другое' },
] as const

export type SourceValue = typeof SOURCE_OPTIONS[number]['value']

/** Map a Russian label or arbitrary input to a DB-safe source value. */
export function normalizeSource(input: string | null | undefined): SourceValue | null {
  if (!input) return null
  const trimmed = input.trim()
  if (!trimmed) return null

  // exact value match
  const byValue = SOURCE_OPTIONS.find(o => o.value === trimmed.toLowerCase())
  if (byValue) return byValue.value

  // exact label match (case-insensitive)
  const byLabel = SOURCE_OPTIONS.find(o => o.label.toLowerCase() === trimmed.toLowerCase())
  if (byLabel) return byLabel.value

  // common aliases
  const lower = trimmed.toLowerCase()
  if (lower === '2gis' || lower === '2 gис' || lower === '2гис') return 'other'
  if (lower.includes('таргет') || lower.includes('target')) return 'target'
  if (lower.includes('insta') || lower.includes('инст')) return 'instagram'
  if (lower.includes('whats') || lower.includes('ватс') || lower.includes('вотс')) return 'whatsapp'
  if (lower.includes('рекоменд') || lower.includes('referral') || lower.includes('сарафан')) return 'referral'
  if (lower.includes('сайт') || lower.includes('site') || lower.includes('организ') || lower === 'organic') return 'organic'
  if (lower.includes('повтор') || lower === 'repeat') return 'repeat'
  return 'other'
}

export function sourceLabel(value: string | null | undefined): string {
  if (!value) return '—'
  const found = SOURCE_OPTIONS.find(o => o.value === value)
  return found?.label ?? value
}

// ── Priority (deals) ──────────────────────────────────────────

export const PRIORITY_OPTIONS = [
  { value: 'hot',  label: 'Горячий',  emoji: '🔥', bg: 'bg-red-100',    text: 'text-red-600' },
  { value: 'warm', label: 'Тёплый',   emoji: '🌤', bg: 'bg-orange-100', text: 'text-orange-600' },
  { value: 'cold', label: 'Холодный', emoji: '❄️', bg: 'bg-blue-100',   text: 'text-blue-600' },
] as const

export type PriorityValue = typeof PRIORITY_OPTIONS[number]['value']

export function normalizePriority(input: string | null | undefined): PriorityValue {
  if (!input) return 'warm'
  const lower = input.trim().toLowerCase()
  const found = PRIORITY_OPTIONS.find(o => o.value === lower || o.label.toLowerCase() === lower)
  if (found) return found.value
  if (lower.includes('гор') || lower.includes('hot')) return 'hot'
  if (lower.includes('хол') || lower.includes('cold')) return 'cold'
  return 'warm'
}

// ── Status (deals) ────────────────────────────────────────────

export const DEAL_STATUS_OPTIONS = [
  { value: 'open', label: 'Открыта' },
  { value: 'won',  label: 'Выиграна' },
  { value: 'lost', label: 'Отказ' },
] as const
export type DealStatusValue = typeof DEAL_STATUS_OPTIONS[number]['value']

// ── Lost reasons ──────────────────────────────────────────────

export const LOST_REASON_OPTIONS = [
  { value: 'expensive', label: 'Дорого' },
  { value: 'no_time',   label: 'Нет времени' },
  { value: 'no_answer', label: 'Не отвечает' },
  { value: 'not_ready', label: 'Не готов' },
  { value: 'other',     label: 'Другое' },
] as const
export type LostReasonValue = typeof LOST_REASON_OPTIONS[number]['value']

// ── Interactions ──────────────────────────────────────────────

export const INTERACTION_TYPE_OPTIONS = [
  { value: 'call',     label: 'Звонок',   icon: '📞' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'note',     label: 'Заметка',  icon: '📝' },
  { value: 'email',    label: 'Email',    icon: '✉️' },
  { value: 'sms',      label: 'SMS',      icon: '📱' },
  { value: 'visit',    label: 'Визит',    icon: '🏥' },
] as const
export type InteractionTypeValue = typeof INTERACTION_TYPE_OPTIONS[number]['value']

export const INTERACTION_DIRECTION_OPTIONS = [
  { value: 'inbound',  label: 'Входящий' },
  { value: 'outbound', label: 'Исходящий' },
] as const
export type InteractionDirectionValue = typeof INTERACTION_DIRECTION_OPTIONS[number]['value']

// ── Tasks ─────────────────────────────────────────────────────

export const TASK_TYPE_OPTIONS = [
  { value: 'call',         label: 'Звонок' },
  { value: 'follow_up',    label: 'Касание / WhatsApp' },
  { value: 'confirm',      label: 'Подтверждение' },
  { value: 'reminder',     label: 'Напоминание' },
  { value: 'lab_ready',    label: 'Анализы готовы' },
  { value: 'lab_critical', label: 'Критический результат' },
  { value: 'resample',     label: 'Повторный забор' },
  { value: 'control',      label: 'Контроль' },
  { value: 'referral',     label: 'Направление' },
  { value: 'other',        label: 'Другое' },
] as const
export type TaskTypeValue = typeof TASK_TYPE_OPTIONS[number]['value']

export const TASK_PRIORITY_OPTIONS = [
  { value: 'low',    label: 'Низкий' },
  { value: 'normal', label: 'Обычный' },
  { value: 'high',   label: 'Высокий' },
  { value: 'urgent', label: 'Срочный' },
] as const
export type TaskPriorityValue = typeof TASK_PRIORITY_OPTIONS[number]['value']

export const TASK_STATUS_OPTIONS = [
  { value: 'new',         label: 'Новая' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done',        label: 'Готово' },
  { value: 'overdue',     label: 'Просрочена' },
  { value: 'cancelled',   label: 'Отменена' },
] as const
export type TaskStatusValue = typeof TASK_STATUS_OPTIONS[number]['value']
