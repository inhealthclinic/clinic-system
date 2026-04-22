/**
 * Подстановка переменных в шаблоны уведомлений.
 *
 * Пользовательские шаблоны пишут переменные на русском ({{ФИО}}, {{дата}}),
 * чтобы админам было понятно при редактировании. Здесь же мы их
 * заменяем на реальные значения.
 */

export type TemplateVars = Record<string, string | null | undefined>

export function render(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    if (v == null || v === '') return ''
    return String(v)
  })
}

/** Формат времени HH:MM из TIME-строки БД ("14:30:00" → "14:30") */
export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return ''
  return timeStr.slice(0, 5)
}

/** Формат даты в «22 апреля 2026» */
export function formatDateRu(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
