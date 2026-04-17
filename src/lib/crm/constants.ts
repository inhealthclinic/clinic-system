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

// ── WhatsApp templates per stage ──────────────────────────────────────────
// Quick-reply scripts the manager can send directly from DealDrawer.
// Substitution tokens:
//   {name}    — patient.full_name (used; '' if unknown)
//   {fname}   — first name only (split on whitespace)
//   {clinic}  — clinic name (substituted by caller, optional)
//
// Each entry is a list so the manager can pick the most appropriate variant.

export interface WhatsAppTemplate {
  label: string   // short label shown in the dropdown
  text:  string   // body with {tokens}
}

export const STAGE_WHATSAPP_TEMPLATES: Record<string, WhatsAppTemplate[]> = {
  new: [
    { label: 'Первичное приветствие', text: 'Здравствуйте, {fname}! Это {clinic}. Получили вашу заявку — когда удобно созвониться, чтобы обсудить детали?' },
    { label: 'Короткий welcome',      text: 'Здравствуйте, {fname}! Спасибо за интерес к нашей клинике. Чем можем помочь?' },
  ],
  in_progress: [
    { label: 'Запросить удобное время', text: '{fname}, подскажите удобное время для звонка — наберём в течение 5 минут.' },
    { label: 'Уточнить запрос',         text: '{fname}, чтобы не отнимать у вас время — уточните, пожалуйста, какая процедура/услуга интересует?' },
  ],
  contact: [
    { label: 'Касание после звонка', text: '{fname}, как и обещали, отправляем информацию по нашей клинике. Если будут вопросы — пишите!' },
    { label: 'Прайс по запросу',      text: '{fname}, держите наш актуальный прайс. Готовы записать в любое удобное время.' },
  ],
  booked: [
    { label: 'Подтверждение записи', text: 'Здравствуйте, {fname}! Подтверждаем вашу запись. Будем ждать!' },
    { label: 'Что взять с собой',    text: '{fname}, на приём, пожалуйста, возьмите документ и результаты анализов, если есть.' },
  ],
  primary_scheduled: [
    { label: 'Напоминание за день',  text: 'Здравствуйте, {fname}! Напоминаем о консультации завтра. Если планы изменились — сообщите, перенесём.' },
    { label: 'Напоминание за час',   text: '{fname}, ждём вас через час на приёме. Адрес: …' },
  ],
  no_show: [
    { label: 'Узнать причину',        text: 'Здравствуйте, {fname}! Не дождались вас сегодня. Всё ли в порядке? Можем перенести запись на удобное время.' },
    { label: 'Перенести деликатно',   text: '{fname}, понимаем — бывают разные обстоятельства. Когда будет удобно прийти?' },
  ],
  primary_done: [
    { label: 'Спасибо после визита',  text: '{fname}, спасибо за визит! Если появятся вопросы по рекомендациям врача — пишите, всегда на связи.' },
    { label: 'Запрос обратной связи', text: '{fname}, нам важно ваше мнение. Поделитесь, как прошёл приём?' },
  ],
  secondary_scheduled: [
    { label: 'Напоминание о вторичной', text: '{fname}, напоминаем о вашей повторной консультации. Подтвердите, пожалуйста, что придёте.' },
  ],
  deciding: [
    { label: 'Мягкое касание',         text: '{fname}, не отвлекаем — просто узнать, остались ли вопросы по нашему предложению?' },
    { label: 'Спецпредложение',        text: '{fname}, у нас сейчас есть приятная скидка на курс. Если актуально — расскажу подробнее.' },
  ],
  treatment: [
    { label: 'Контроль самочувствия',  text: '{fname}, как самочувствие? Все ли рекомендации удалось выполнить? Если что-то беспокоит — сообщите врачу.' },
  ],
  control_tests: [
    { label: 'Напоминание об анализах', text: '{fname}, не забудьте про контрольные анализы. Когда планируете сдать?' },
  ],
  success: [
    { label: 'Финальное спасибо',      text: '{fname}, спасибо, что выбрали нашу клинику! Будем рады видеть вас снова.' },
  ],
  failed: [
    { label: 'Прощальное',             text: '{fname}, спасибо, что рассмотрели нас. Если планы изменятся — будем рады помочь.' },
  ],
}

/** Substitute {tokens} in a template body. */
export function applyWhatsAppTemplate(
  text: string,
  vars: { name?: string; clinic?: string },
): string {
  const fullName = (vars.name ?? '').trim()
  const fName    = fullName.split(/\s+/)[0] ?? ''
  return text
    .replace(/\{name\}/g,   fullName || '')
    .replace(/\{fname\}/g,  fName    || '')
    .replace(/\{clinic\}/g, vars.clinic ?? 'клиника')
}
