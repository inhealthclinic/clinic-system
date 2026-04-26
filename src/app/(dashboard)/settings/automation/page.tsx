'use client'

/**
 * /settings/automation — отдельный экран редактора автоматизаций.
 * Внутри той же AutomationKanban, что вшита на /settings/pipelines, чтобы у
 * пользователя был один источник правды и одинаковая раскладка.
 */

import AutomationKanban from '@/components/automation/AutomationKanban'

export default function AutomationSettingsPage() {
  return <AutomationKanban />
}
