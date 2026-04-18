import { createClient } from '@/lib/supabase/client'

/* ─── Types ──────────────────────────────────────────────────────────── */
export type AuditAction = 'create' | 'update' | 'delete'
export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface AuditLog {
  id: number
  clinic_id: string | null
  user_id: string | null
  user_name: string | null
  action: AuditAction
  entity_type: string
  entity_id: string | null
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  changed_fields: string[] | null
  severity: AuditSeverity
  ip_address: string | null
  created_at: string
}

export interface AuditFilters {
  entityType?: string
  entityId?: string
  userId?: string
  from?: string    // ISO date
  to?: string      // ISO date
  severity?: AuditSeverity
  limit?: number
}

/* ─── Queries ────────────────────────────────────────────────────────── */
export async function fetchAuditLogs(filters: AuditFilters = {}): Promise<AuditLog[]> {
  const supabase = createClient()
  let q = supabase
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100)

  if (filters.entityType) q = q.eq('entity_type', filters.entityType)
  if (filters.entityId)   q = q.eq('entity_id', filters.entityId)
  if (filters.userId)     q = q.eq('user_id', filters.userId)
  if (filters.severity)   q = q.eq('severity', filters.severity)
  if (filters.from)       q = q.gte('created_at', filters.from)
  if (filters.to)         q = q.lte('created_at', filters.to)

  const { data, error } = await q
  if (error) { console.error('[audit] fetchAuditLogs', error); return [] }
  return (data ?? []) as AuditLog[]
}

export async function fetchEntityHistory(
  entityType: string,
  entityId: string,
  limit = 50,
): Promise<AuditLog[]> {
  return fetchAuditLogs({ entityType, entityId, limit })
}

/* ─── Russian labels for UI ──────────────────────────────────────────── */
export const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
}

export const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
  critical: 'Критичная',
}

export const SEVERITY_CLASS: Record<AuditSeverity, string> = {
  low:      'bg-gray-100 text-gray-600',
  medium:   'bg-amber-100 text-amber-700',
  high:     'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

export const ENTITY_LABEL: Record<string, string> = {
  patients:         'Пациент',
  appointments:     'Запись',
  visit_services:   'Услуга визита',
  payments:         'Оплата',
  lab_orders:       'Лаб. заявка',
  lab_order_items:  'Позиция заявки',
  services:         'Услуга',
  reference_ranges: 'Референсы',
}

export const FIELD_LABEL: Record<string, string> = {
  full_name:          'ФИО',
  first_name:         'Имя',
  last_name:          'Фамилия',
  phones:             'Телефоны',
  email:              'Email',
  birth_date:         'Дата рождения',
  gender:             'Пол',
  status:             'Статус',
  pregnancy_status:   'Беременность',
  pregnancy_weeks:    'Срок беременности',
  notes:              'Заметки',
  tags:               'Теги',
  city:               'Город',
  address:            'Адрес',
  iin:                'ИИН',
  is_vip:             'VIP',
  patient_number:     '№ карты',
  date:               'Дата',
  time_start:         'Время начала',
  time_end:           'Время окончания',
  doctor_id:          'Врач',
  amount:             'Сумма',
  price:              'Цена',
  quantity:           'Количество',
  discount:           'Скидка',
  name:               'Название',
  category:           'Категория',
  is_active:          'Активна',
  is_lab:             'Лаб. услуга',
  default_unit:       'Ед. изм.',
  reference_min:      'Референс мин',
  reference_max:      'Референс макс',
  reference_text:     'Референс (текст)',
  result_value:       'Результат',
  flag:               'Флаг',
  verified_at:        'Подтверждено',
}

export function fieldLabel(key: string): string {
  return FIELD_LABEL[key] ?? key
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
