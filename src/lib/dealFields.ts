/**
 * Конфигурация полей карточки сделки (CRM).
 * Связано с миграцией 057_deal_field_configs.sql.
 *
 * Встроенные поля (is_builtin = true) живут как JSX-блоки в DealModal —
 * конфиг лишь говорит, в каком порядке их рендерить, видны ли они и
 * обязательны ли. Кастомные поля (is_builtin = false) рендерятся универсально
 * по field_type и пишутся в deals.custom_fields[field_key].
 */

export type DealFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'phone'
  | 'textarea'

export interface DealFieldOption {
  value: string
  label: string
}

export interface DealFieldConfig {
  id?: string
  clinic_id?: string
  field_key: string
  label: string | null
  sort_order: number
  is_visible: boolean
  is_required: boolean
  is_builtin: boolean
  field_type: DealFieldType
  options: DealFieldOption[]
  required_in_stages: string[]      // pipeline_stages.id[]
  block_stage_progress: boolean
}

// ─── built-in keys & labels ──────────────────────────────────────────────────

export const BUILTIN_FIELD_KEYS = [
  'pipeline',
  'responsible',
  'source',
  'doctor',
  'comment',
  'tags',
  'patient',
  'contact_phone',
  'contact_city',
] as const

export type BuiltinFieldKey = typeof BUILTIN_FIELD_KEYS[number]

export const BUILTIN_FIELD_LABELS: Record<BuiltinFieldKey, string> = {
  pipeline:      'Воронка',
  responsible:   'Ответственный',
  source:        'Источник',
  doctor:        'Врач',
  comment:       'Комментарий',
  tags:          'Теги',
  patient:       'Пациент',
  contact_phone: 'Телефон контакта',
  contact_city:  'Город',
}

/** Дефолт: все встроенные поля видны, ни одно не обязательное, в каноническом порядке. */
export const DEFAULT_FIELD_CONFIGS: DealFieldConfig[] = BUILTIN_FIELD_KEYS.map((k, i) => ({
  field_key: k,
  label: null,
  sort_order: (i + 1) * 10,
  is_visible: true,
  is_required: false,
  is_builtin: true,
  field_type: 'text',
  options: [],
  required_in_stages: [],
  block_stage_progress: false,
}))

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Сливает дефолт со списком из БД: если для встроенного field_key
 * нет строки — берём дефолт. Кастомные конфиги добавляются как есть.
 * Возвращает отсортированный по sort_order массив.
 */
export function mergeWithDefaults(rows: DealFieldConfig[] | null | undefined): DealFieldConfig[] {
  const byKey = new Map<string, DealFieldConfig>()
  for (const c of DEFAULT_FIELD_CONFIGS) byKey.set(c.field_key, { ...c })
  for (const r of (rows ?? [])) {
    byKey.set(r.field_key, {
      ...r,
      // нормализуем массивы/опции на случай null из БД
      options: Array.isArray(r.options) ? r.options : [],
      required_in_stages: Array.isArray(r.required_in_stages) ? r.required_in_stages : [],
    })
  }
  return Array.from(byKey.values()).sort((a, b) => a.sort_order - b.sort_order)
}

export function findConfig(configs: DealFieldConfig[], key: string): DealFieldConfig | undefined {
  return configs.find(c => c.field_key === key)
}

export function isFieldVisible(configs: DealFieldConfig[], key: string): boolean {
  const c = findConfig(configs, key)
  // По умолчанию — видно (если конфига нет, поле встроенное и должно отображаться).
  return c ? c.is_visible : true
}

export function isFieldRequired(
  configs: DealFieldConfig[],
  key: string,
  stageId?: string | null,
): boolean {
  const c = findConfig(configs, key)
  if (!c) return false
  if (c.is_required) return true
  if (stageId && c.required_in_stages.includes(stageId)) return true
  return false
}

/** Достаёт значение для проверки заполнения по field_key из формы и custom_fields. */
export function getFieldValue(
  cfg: DealFieldConfig,
  form: Record<string, unknown>,
  customFields: Record<string, unknown>,
): unknown {
  if (!cfg.is_builtin) return customFields[cfg.field_key]
  switch (cfg.field_key) {
    case 'pipeline':       return form.pipeline_id
    case 'responsible':    return form.responsible_user_id
    case 'source':         return form.source_id
    case 'doctor':         return form.preferred_doctor_id
    case 'comment':        return form.notes
    case 'tags':           return form.tags
    case 'patient':        return form.patient_id
    case 'contact_phone':  return form.contact_phone
    case 'contact_city':   return form.contact_city
    default:               return undefined
  }
}

/** Истина, если значение поля считается «пустым». */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  return false
}

/**
 * Проверяет обязательные поля.
 *  - В режиме сохранения (targetStageId = текущий stage_id) проверяем глобальные is_required
 *    + required_in_stages, попадающие на текущий этап.
 *  - В режиме перехода в этап (targetStageId = новый stage_id) проверяем те же правила
 *    относительно нового этапа, но `blocking` ставим только для полей с block_stage_progress.
 */
export function validateRequiredFields(
  configs: DealFieldConfig[],
  form: Record<string, unknown>,
  customFields: Record<string, unknown>,
  targetStageId: string | null | undefined,
): { missing: DealFieldConfig[]; blocking: DealFieldConfig[] } {
  const missing: DealFieldConfig[] = []
  const blocking: DealFieldConfig[] = []
  for (const cfg of configs) {
    if (!cfg.is_visible) continue
    const required = cfg.is_required
      || (!!targetStageId && cfg.required_in_stages.includes(targetStageId))
    if (!required) continue
    const v = getFieldValue(cfg, form, customFields)
    if (isEmptyValue(v)) {
      missing.push(cfg)
      if (cfg.block_stage_progress) blocking.push(cfg)
    }
  }
  return { missing, blocking }
}

export function fieldDisplayLabel(cfg: DealFieldConfig): string {
  if (cfg.label && cfg.label.trim()) return cfg.label
  if (cfg.is_builtin && (BUILTIN_FIELD_KEYS as readonly string[]).includes(cfg.field_key)) {
    return BUILTIN_FIELD_LABELS[cfg.field_key as BuiltinFieldKey]
  }
  // strip 'custom:' prefix for display
  return cfg.field_key.replace(/^custom:/, '')
}

/** Префикс для пользовательских полей, чтобы не пересечься со встроенными. */
export const CUSTOM_PREFIX = 'custom:'

export function makeCustomKey(slug: string): string {
  const clean = slug.trim().toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return CUSTOM_PREFIX + (clean || 'field')
}

export function isCustomKey(key: string): boolean {
  return key.startsWith(CUSTOM_PREFIX)
}
