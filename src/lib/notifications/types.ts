// ============================================================
// src/lib/notifications/types.ts
// Shared types & dictionaries for the in-app notifications system.
// Mirrors migration 017_whatsapp_notifications.sql.
// ============================================================

export const EVENT_TYPES = [
  'whatsapp_new_lead',
  'whatsapp_new_message',
  'whatsapp_no_reply',
  'task_assigned',
  'task_overdue',
  'deal_stage_changed',
  'deal_assigned',
  'deal_won',
  'appointment_created',
  'appointment_cancelled',
  'appointment_no_show',
  'payment_received',
  'lab_critical',
] as const

export type EventType = typeof EVENT_TYPES[number]

/** Russian labels for the settings UI. */
export const EVENT_LABEL: Record<EventType, string> = {
  whatsapp_new_lead:    'Новый лид из WhatsApp',
  whatsapp_new_message: 'Новое входящее WhatsApp-сообщение',
  whatsapp_no_reply:    'Нет ответа на WhatsApp дольше N минут',
  task_assigned:        'Назначена задача',
  task_overdue:         'Задача просрочена',
  deal_stage_changed:   'Изменён этап сделки',
  deal_assigned:        'Назначена сделка',
  deal_won:             'Сделка закрыта как успешная',
  appointment_created:  'Создана запись',
  appointment_cancelled:'Запись отменена',
  appointment_no_show:  'Пациент не явился',
  payment_received:     'Получена оплата',
  lab_critical:         'Критический результат анализов',
}

export const EVENT_GROUP: Record<EventType, 'whatsapp' | 'crm' | 'schedule' | 'finance' | 'lab' | 'tasks'> = {
  whatsapp_new_lead:    'whatsapp',
  whatsapp_new_message: 'whatsapp',
  whatsapp_no_reply:    'whatsapp',
  task_assigned:        'tasks',
  task_overdue:         'tasks',
  deal_stage_changed:   'crm',
  deal_assigned:        'crm',
  deal_won:             'crm',
  appointment_created:  'schedule',
  appointment_cancelled:'schedule',
  appointment_no_show:  'schedule',
  payment_received:     'finance',
  lab_critical:         'lab',
}

export const GROUP_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  crm:      'CRM',
  schedule: 'Расписание',
  finance:  'Финансы',
  lab:      'Лаборатория',
  tasks:    'Задачи',
}

// ── Routing strategies ───────────────────────────────────────

export const ROUTING_OPTIONS = [
  { value: 'responsible',       label: 'Только ответственному' },
  { value: 'responsible_admin', label: 'Ответственному + админам' },
  { value: 'all_role',          label: 'Всем сотрудникам с ролью' },
  { value: 'specific_users',    label: 'Конкретным сотрудникам' },
  { value: 'none',              label: 'Никому (отключено)' },
] as const

export type RoutingValue = typeof ROUTING_OPTIONS[number]['value']

// ── Channels (только in_app сейчас живой) ───────────────────

export const CHANNEL_OPTIONS = [
  { value: 'in_app',   label: 'В системе',     ready: true  },
  { value: 'email',    label: 'Email',          ready: false },
  { value: 'whatsapp', label: 'WhatsApp',       ready: false },
  { value: 'push',     label: 'Push',           ready: false },
] as const

export type ChannelValue = typeof CHANNEL_OPTIONS[number]['value']

// ── Entity types ────────────────────────────────────────────

export type EntityType =
  | 'deal' | 'patient' | 'task' | 'appointment'
  | 'message' | 'payment' | 'lab_order' | 'none'

// ── DB row shapes ───────────────────────────────────────────

export interface StaffNotificationRow {
  id:           string
  clinic_id:    string
  user_id:      string
  event_type:   EventType
  entity_type:  EntityType | null
  entity_id:    string | null
  title:        string
  body:         string | null
  link:         string | null
  triggered_by: string | null
  status:       'unread' | 'read' | 'dismissed'
  read_at:      string | null
  dismissed_at: string | null
  created_at:   string
}

export interface NotificationPreferenceRow {
  id:                string
  clinic_id:         string
  scope:             'clinic' | 'user'
  user_id:           string | null
  event_type:        EventType
  enabled:           boolean
  routing:           RoutingValue
  target_role_slugs: string[]
  target_user_ids:   string[]
  channels:          ChannelValue[]
  created_at:        string
  updated_at:        string
}
