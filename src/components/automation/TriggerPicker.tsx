'use client'

/**
 * <TriggerPicker /> — модалка выбора типа триггера, клон amoCRM.
 *
 * Открывается по «+ Добавить триггер» в столбце воронки. После выбора
 * типа коллбэк `onPick(type)` создаёт черновую запись в
 * `pipeline_stage_triggers` (через PipelineCanvas), а затем UI
 * показывает форму конфигурации.
 *
 * 13 типов — паритет с amoCRM (см. скриншот пользователя).
 * Для каждого типа указан:
 *   - icon (эмодзи — без зависимостей от иконпака)
 *   - label
 *   - tier: 'core' (полностью реализован) | 'soon' (UI есть, исполнение позже)
 */

interface Props {
  open: boolean
  onClose: () => void
  onPick: (type: TriggerType) => void
}

export type TriggerType =
  | 'salesbot' | 'create_task' | 'create_deal'
  | 'send_email' | 'webhook' | 'change_stage'
  | 'edit_tags' | 'complete_tasks' | 'generate_form'
  | 'change_responsible' | 'change_field' | 'businessbot'
  | 'delete_files'

interface TypeMeta {
  type: TriggerType
  icon: string
  label: string
  tier: 'core' | 'soon'
  hint: string
}

const TYPES: TypeMeta[] = [
  { type: 'salesbot',         icon: '🤖', label: 'Salesbot',           tier: 'core', hint: 'Отправить шаблон WhatsApp' },
  { type: 'create_task',      icon: '✓',  label: 'Создать задачу',     tier: 'core', hint: 'Поставить задачу менеджеру' },
  { type: 'create_deal',      icon: '$',  label: 'Создать сделку',     tier: 'soon', hint: 'В другой воронке' },
  { type: 'send_email',       icon: '✉',  label: 'Отправить письмо',   tier: 'soon', hint: 'Email пациенту' },
  { type: 'webhook',          icon: '⚡', label: 'Отправить webhook',  tier: 'core', hint: 'POST на внешний URL' },
  { type: 'change_stage',     icon: '⇆',  label: 'Смена статуса',      tier: 'core', hint: 'Перевести в другой этап' },
  { type: 'edit_tags',        icon: '#',  label: 'Редактировать теги', tier: 'core', hint: 'Добавить или убрать теги' },
  { type: 'complete_tasks',   icon: '☑',  label: 'Завершить задачи',   tier: 'core', hint: 'Закрыть все открытые задачи сделки' },
  { type: 'generate_form',    icon: '📋', label: 'Генерация анкеты',   tier: 'soon', hint: 'Ссылка на форму пациента' },
  { type: 'change_responsible', icon: '👤', label: 'Сменить ответственного', tier: 'core', hint: 'Перевести на другого менеджера' },
  { type: 'change_field',     icon: '✎',  label: 'Изменить поле',      tier: 'core', hint: 'Обновить колонку сделки' },
  { type: 'businessbot',      icon: '🤖', label: 'Businessbot',        tier: 'soon', hint: 'Расширенная логика бота' },
  { type: 'delete_files',     icon: '🗑',  label: 'Удалить файлы',     tier: 'soon', hint: 'Очистить вложения сделки' },
]

export default function TriggerPicker({ open, onClose, onPick }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Выберите тип триггера</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-2">
          <input
            type="text"
            placeholder="Поиск и фильтр"
            disabled
            className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm placeholder:text-gray-400"
            title="Поиск пока не реализован"
          />
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto px-5 pb-4">
          <div className="grid grid-cols-3 gap-3">
            {TYPES.map(t => {
              const isCore = t.tier === 'core'
              return (
                <button
                  key={t.type}
                  onClick={() => isCore && onPick(t.type)}
                  disabled={!isCore}
                  className={[
                    'rounded-lg p-4 flex flex-col items-center justify-center gap-1.5 text-center transition',
                    isCore
                      ? 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm cursor-pointer'
                      : 'bg-blue-300/60 text-white cursor-not-allowed opacity-70',
                  ].join(' ')}
                  title={isCore ? t.hint : `${t.hint} — скоро`}
                >
                  <span className="text-2xl leading-none">{t.icon}</span>
                  <span className="text-xs font-medium">+ {t.label}</span>
                  {!isCore && <span className="text-[10px] opacity-90">скоро</span>}
                </button>
              )
            })}
          </div>

          {/* Footer hint */}
          <div className="mt-5 text-[11px] text-gray-400 leading-relaxed">
            Триггеры с пометкой «скоро» появятся в UI, но пока не исполняются —
            подключение в следующих обновлениях. «Salesbot», «Создать задачу»,
            «Webhook», «Смена статуса», «Изменить поле», «Сменить
            ответственного», «Редактировать теги», «Завершить задачи» —
            работают.
          </div>
        </div>
      </div>
    </div>
  )
}
