'use client'

/**
 * Popup-окно расписания (открывается из карточки сделки CRM).
 * Просто реэкспортирует основной page `/schedule`, но без dashboard-лейаута
 * (см. `./layout.tsx`).
 */

import SchedulePage from '../(dashboard)/schedule/page'

export default function ScheduleWindowPage() {
  return <SchedulePage />
}
