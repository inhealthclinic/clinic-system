// ============================================================
// lib/utils/schedule.ts — утилиты расписания
// ============================================================

export const HOUR_START = 8   // 08:00
export const HOUR_END   = 20  // 20:00
export const SLOT_MIN   = 30  // минут на строку

// Генерация временных слотов 08:00 – 20:00 с шагом 30 мин
export function generateTimeSlots(): string[] {
  const slots: string[] = []
  for (let h = HOUR_START; h < HOUR_END; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`)
    slots.push(`${String(h).padStart(2,'0')}:30`)
  }
  return slots
}

// "09:30" → минут от начала дня
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// минуты → "09:30"
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`
}

// Позиция в сетке (px или %) для времени
export function timeToGridPosition(time: string, rowHeight: number): number {
  const mins = timeToMinutes(time) - HOUR_START * 60
  return (mins / SLOT_MIN) * rowHeight
}

// Высота блока по длительности
export function durationToHeight(durationMin: number, rowHeight: number): number {
  return (durationMin / SLOT_MIN) * rowHeight
}

// Проверка перекрытия двух временных интервалов
export function hasOverlap(
  start1: string, end1: string,
  start2: string, end2: string
): boolean {
  return timeToMinutes(start1) < timeToMinutes(end2) &&
         timeToMinutes(end1)   > timeToMinutes(start2)
}

// Форматирование даты для отображения
export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

export function formatShortDate(date: string): string {
  return new Date(date).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short'
  })
}

// Добавить N дней к дате
export function addDays(date: string, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

// Сегодня в формате YYYY-MM-DD
export function today(): string {
  return new Date().toISOString().split('T')[0]
}

// Цвет статуса записи
export const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-700 border-gray-300',
  confirmed:   'bg-blue-100 text-blue-700 border-blue-300',
  arrived:     'bg-amber-100 text-amber-700 border-amber-300',
  in_progress: 'bg-green-100 text-green-700 border-green-300',
  completed:   'bg-green-50 text-green-600 border-green-200',
  cancelled:   'bg-red-50 text-red-400 border-red-200 opacity-60',
  no_show:     'bg-red-100 text-red-600 border-red-300',
  rescheduled: 'bg-purple-50 text-purple-600 border-purple-200',
}

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pending:     'Ожидает',
  confirmed:   'Подтверждена',
  arrived:     'Пришёл',
  in_progress: 'На приёме',
  completed:   'Завершена',
  cancelled:   'Отменена',
  no_show:     'Не явился',
  rescheduled: 'Перенесена',
}
