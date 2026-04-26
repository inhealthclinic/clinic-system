'use client'

/**
 * Визуальный редактор Salesbot — стиль amoCRM.
 *
 * Канва:
 *   ┌─ Триггеры ─┐    ┌─ Запуск бота ─┐    ┌─ Следующий шаг ─┐
 *   │ событие    │ ─► │ зелёный пилл │ ─►  │ типы действий   │
 *   └────────────┘    └──────────────┘     └─────────────────┘
 *
 * Когда пользователь добавляет первый шаг через «Отправить сообщение» —
 * под канвой раскрывается редактор шагов: текст + варианты ответов
 * (с переходами на следующие шаги). Сохранение собирает нормализованный
 * steps-объект (как у amoCRM-импорта) и POST-ит на /api/salesbot-flows.
 *
 * MVP-ограничения:
 *   • работает только action «Отправить сообщение» (остальные — заглушки
 *     в стиле amoCRM, помечены «скоро»);
 *   • синонимы пока заводятся через запятую в одном поле;
 *   • else-ветка пока не настраивается из UI — добавим, как только
 *     потребуется (для on_first_inbound с вопросом «откуда вы» —
 *     синонимы и числовой fallback закрывают 95% кейсов).
 */

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

interface BuilderAnswer {
  value: string
  synonyms: string  // через запятую — превратим в массив на сохранении
  next_step_id: string | null  // ссылка на step.id, превратим в number на сохранении
}

interface BuilderStep {
  id: string                 // временный UUID-like ключ
  text: string
  answers: BuilderAnswer[]
  else_next_id: string | null
}

const ACTIONS: Array<{ key: string; label: string; emoji: string; available: boolean }> = [
  { key: 'send_message',  label: 'Отправить сообщение',  emoji: '💬', available: true  },
  { key: 'reaction',      label: 'Реакция',                emoji: '❤️', available: false },
  { key: 'internal_msg',  label: 'Внутреннее сообщение',   emoji: '💭', available: false },
  { key: 'init_chat',     label: 'Инициировать общение',   emoji: '🚀', available: false },
  { key: 'breaker',       label: 'Прерыватель',            emoji: '⏸️', available: false },
  { key: 'action',        label: 'Выполнить действие',     emoji: '✏️', available: false },
  { key: 'condition',     label: 'Условие',                emoji: '🔀', available: false },
  { key: 'validator',     label: 'Валидатор',              emoji: '✅', available: false },
  { key: 'run_bot',       label: 'Запустить бота',         emoji: '▶️', available: false },
  { key: 'code',          label: 'Свой обработчик (код)',  emoji: '⟨/⟩', available: false },
  { key: 'widgets',       label: 'Виджеты',                emoji: '📊', available: false },
  { key: 'distribute',    label: 'Распределение',          emoji: '🎯', available: false },
]

let _idCounter = 0
function newId(): string {
  _idCounter += 1
  return `s_${Date.now().toString(36)}_${_idCounter}`
}

function makeStep(): BuilderStep {
  return { id: newId(), text: '', answers: [], else_next_id: null }
}

type TriggerEvent = 'on_first_inbound' | 'manual'

const TRIGGER_LABEL: Record<TriggerEvent, { title: string; sub: string; emoji: string }> = {
  on_first_inbound: { title: 'Первое входящее в WhatsApp', sub: 'Лид написал впервые — бот стартует', emoji: '💬' },
  manual:           { title: 'Запуск вручную',              sub: 'Из карточки сделки кнопкой',          emoji: '👆' },
}

export default function NewSalesbotPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent | null>(null)
  const [isDefault, setIsDefault] = useState(true)
  const [triggerModalOpen, setTriggerModalOpen] = useState(false)
  const [steps, setSteps] = useState<BuilderStep[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const stepIndexById = useMemo(() => {
    const m = new Map<string, number>()
    steps.forEach((s, i) => m.set(s.id, i))
    return m
  }, [steps])

  function addFirstStep() {
    setSteps([makeStep()])
  }

  function updateStep(id: string, patch: Partial<BuilderStep>) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function addAnswer(stepId: string) {
    setSteps(prev => prev.map(s => s.id === stepId
      ? { ...s, answers: [...s.answers, { value: '', synonyms: '', next_step_id: null }] }
      : s))
  }

  function updateAnswer(stepId: string, idx: number, patch: Partial<BuilderAnswer>) {
    setSteps(prev => prev.map(s => s.id === stepId
      ? { ...s, answers: s.answers.map((a, i) => i === idx ? { ...a, ...patch } : a) }
      : s))
  }

  function removeAnswer(stepId: string, idx: number) {
    setSteps(prev => prev.map(s => s.id === stepId
      ? { ...s, answers: s.answers.filter((_, i) => i !== idx) }
      : s))
  }

  function removeStep(stepId: string) {
    if (!confirm('Удалить шаг? Ответы, ведущие на него, потеряют связь.')) return
    setSteps(prev => prev
      .filter(s => s.id !== stepId)
      .map(s => ({
        ...s,
        else_next_id: s.else_next_id === stepId ? null : s.else_next_id,
        answers: s.answers.map(a => ({
          ...a,
          next_step_id: a.next_step_id === stepId ? null : a.next_step_id,
        })),
      })))
  }

  function addStepAfter(stepId: string, answerIdx?: number) {
    const fresh = makeStep()
    setSteps(prev => {
      const next = [...prev, fresh]
      return next.map(s => {
        if (s.id !== stepId) return s
        if (answerIdx == null) return { ...s, else_next_id: fresh.id }
        return {
          ...s,
          answers: s.answers.map((a, i) => i === answerIdx ? { ...a, next_step_id: fresh.id } : a),
        }
      })
    })
  }

  async function save() {
    setErr('')
    if (!name.trim()) { setErr('Укажите название бота'); return }
    if (steps.length === 0) { setErr('Добавьте хотя бы один шаг — кнопка «Отправить сообщение»'); return }
    for (const s of steps) {
      if (!s.text.trim()) { setErr('У всех шагов должен быть заполнен текст'); return }
    }

    // Сборка нормализованного JSON. Ключи шагов — числовые индексы.
    const normalized: Record<string, {
      text: string
      buttons: string[]
      answers: Array<{ value: string; synonyms: string[]; next: number }>
      else_next: number | null
      unconditional_next: null
    }> = {}
    steps.forEach((s, i) => {
      normalized[String(i)] = {
        text: s.text.trim(),
        buttons: s.answers.map(a => a.value.trim()).filter(Boolean),
        answers: s.answers
          .filter(a => a.value.trim() && a.next_step_id != null)
          .map(a => ({
            value: a.value.trim(),
            synonyms: a.synonyms.split(',').map(x => x.trim()).filter(Boolean),
            next: stepIndexById.get(a.next_step_id!) ?? -1,
          }))
          .filter(a => a.next >= 0),
        else_next: s.else_next_id != null ? (stepIndexById.get(s.else_next_id) ?? null) : null,
        unconditional_next: null,
      }
    })

    setSaving(true)
    try {
      const res = await fetch('/api/salesbot-flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          steps: normalized,
          start_step: 0,
          trigger_event: triggerEvent ?? 'manual',
          is_default: triggerEvent === 'on_first_inbound' ? isDefault : false,
          is_active: true,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'save failed')
      router.push('/settings/salesbots')
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Хедер */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/settings/salesbots" className="text-sm text-gray-500 hover:text-gray-900">
            ← К списку
          </Link>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="SALES-БОТ"
            className="text-xl font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 outline-none px-1 py-0.5 min-w-[200px]"
          />
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-xs text-red-600">{err}</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Сохраняем…' : 'Сохранить и вернуться'}
          </button>
        </div>
      </div>

      {/* Канва amoCRM-стиля */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 overflow-x-auto">
        <div className="flex items-start gap-6 min-w-[1100px]">
          {/* Левая колонка — Триггеры (как в amoCRM) */}
          <div className="w-72 flex-shrink-0 bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
            <div className="text-base font-semibold text-gray-900">Триггеры</div>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              Автоматизируйте запуск ботов, установив правила, или запускайте вручную через карточку сделки
            </p>

            {triggerEvent && (
              <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md">
                <span className="text-base leading-none">{TRIGGER_LABEL[triggerEvent].emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-blue-900 truncate">{TRIGGER_LABEL[triggerEvent].title}</div>
                  {triggerEvent === 'on_first_inbound' && isDefault && (
                    <div className="text-[11px] text-blue-700">по умолчанию</div>
                  )}
                </div>
                <button type="button" onClick={() => setTriggerModalOpen(true)}
                  className="text-xs text-blue-600 hover:underline">изм.</button>
                <button type="button" onClick={() => setTriggerEvent(null)}
                  className="text-xs text-red-500 hover:underline">×</button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setTriggerModalOpen(true)}
              className="mt-4 w-full px-3 py-2 text-sm text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 text-left"
            >
              + Триггер
            </button>
          </div>

          {/* Стрелка */}
          <div className="flex-shrink-0 mt-9 text-gray-300 text-2xl select-none">→</div>

          {/* Запуск бота — зелёный пилл */}
          <div className="flex-shrink-0 mt-6">
            <div className="px-4 py-2 bg-emerald-50 border-2 border-emerald-400 rounded-lg flex items-center gap-2 text-sm font-medium text-emerald-700 shadow-sm whitespace-nowrap">
              <span className="w-0 h-0 border-l-[7px] border-l-emerald-500 border-y-[5px] border-y-transparent" />
              Запуск бота
            </div>
          </div>

          {/* Стрелка */}
          <div className="flex-shrink-0 mt-9 text-gray-300 text-2xl select-none">→</div>

          {/* Следующий шаг — выбор действия */}
          {steps.length === 0 && (
            <div className="w-72 flex-shrink-0 bg-white border border-gray-200 rounded-lg shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-900">
                Следующий шаг
              </div>
              <ul className="p-2 space-y-1">
                {ACTIONS.map(a => (
                  <li key={a.key}>
                    <button
                      type="button"
                      disabled={!a.available}
                      onClick={() => a.available && addFirstStep()}
                      className={[
                        'w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left',
                        a.available
                          ? 'hover:bg-blue-50 text-gray-800 cursor-pointer'
                          : 'text-gray-400 cursor-not-allowed',
                      ].join(' ')}
                    >
                      <span className="text-base leading-none w-5 text-center">{a.emoji}</span>
                      <span className="flex-1">{a.label}</span>
                      {!a.available && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 text-gray-500 uppercase tracking-wide">скоро</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Если первый шаг уже создан — показываем сводку */}
          {steps.length > 0 && (
            <div className="w-72 flex-shrink-0 bg-white border border-emerald-300 rounded-lg shadow-sm">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-emerald-700 flex items-center gap-2">
                💬 Отправить сообщение
              </div>
              <div className="p-3 text-xs text-gray-600">
                Шаг 1 из {steps.length}. Редактирование внизу страницы.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Редактор шагов */}
      {steps.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Шаги диалога</h2>
          {steps.map((step, idx) => (
            <div key={step.id} className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs rounded bg-emerald-50 text-emerald-700 font-medium">
                  Шаг {idx + 1}{idx === 0 ? ' · стартовый' : ''}
                </span>
                <span className="text-xs text-gray-500">id: {idx}</span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeStep(step.id)}
                  className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                >
                  Удалить шаг
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Текст сообщения</label>
                <textarea
                  value={step.text}
                  onChange={e => updateStep(step.id, { text: e.target.value })}
                  rows={3}
                  placeholder="Здравствуйте! Откуда вы?"
                  className="w-full border border-gray-200 rounded px-3 py-2 text-sm hover:border-gray-300 focus:border-blue-400 outline-none resize-y"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Будет отправлено клиенту в WhatsApp. Если ниже добавлены варианты —
                  они допишутся нумерованным списком (Green-API не поддерживает inline-кнопки).
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Варианты ответа клиента</label>
                  <button
                    type="button"
                    onClick={() => addAnswer(step.id)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    + Вариант
                  </button>
                </div>
                {step.answers.length === 0 && (
                  <p className="text-xs text-gray-400 italic">Без вариантов — шаг считается финальным.</p>
                )}
                <ul className="space-y-2">
                  {step.answers.map((a, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-md p-2">
                      <input
                        type="text"
                        value={a.value}
                        onChange={e => updateAnswer(step.id, i, { value: e.target.value })}
                        placeholder="Кнопка / ключевое слово"
                        className="border border-gray-200 rounded px-2 py-1 text-sm bg-white w-44 hover:border-gray-300 focus:border-blue-400 outline-none"
                      />
                      <input
                        type="text"
                        value={a.synonyms}
                        onChange={e => updateAnswer(step.id, i, { synonyms: e.target.value })}
                        placeholder="Синонимы через запятую"
                        className="border border-gray-200 rounded px-2 py-1 text-sm bg-white flex-1 min-w-[160px] hover:border-gray-300 focus:border-blue-400 outline-none"
                      />
                      <select
                        value={a.next_step_id ?? ''}
                        onChange={e => updateAnswer(step.id, i, { next_step_id: e.target.value || null })}
                        className="border border-gray-200 rounded px-2 py-1 text-sm bg-white hover:border-gray-300 focus:border-blue-400 outline-none"
                      >
                        <option value="">→ выбрать шаг</option>
                        {steps.map((s, j) => s.id === step.id ? null : (
                          <option key={s.id} value={s.id}>Шаг {j + 1}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => addStepAfter(step.id, i)}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        + Новый шаг
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAnswer(step.id, i)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Удалить
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-2 border-t border-gray-100">
                <label className="text-xs font-medium text-gray-600 mr-2">
                  Если ничего не подошло (else):
                </label>
                <select
                  value={step.else_next_id ?? ''}
                  onChange={e => updateStep(step.id, { else_next_id: e.target.value || null })}
                  className="border border-gray-200 rounded px-2 py-1 text-sm bg-white hover:border-gray-300 focus:border-blue-400 outline-none"
                >
                  <option value="">— остаться на этом шаге</option>
                  {steps.map((s, j) => s.id === step.id ? null : (
                    <option key={s.id} value={s.id}>Шаг {j + 1}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => addStepAfter(step.id)}
                  className="ml-2 text-xs text-blue-600 hover:underline"
                >
                  + Новый else-шаг
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {triggerModalOpen && (
        <TriggerModal
          initialEvent={triggerEvent ?? 'on_first_inbound'}
          initialDefault={isDefault}
          onClose={() => setTriggerModalOpen(false)}
          onSave={(ev, def) => { setTriggerEvent(ev); setIsDefault(def); setTriggerModalOpen(false) }}
        />
      )}
    </div>
  )
}

function TriggerModal(props: {
  initialEvent: TriggerEvent
  initialDefault: boolean
  onClose: () => void
  onSave: (ev: TriggerEvent, isDefault: boolean) => void
}) {
  const [ev, setEv] = useState<TriggerEvent>(props.initialEvent)
  const [def, setDef] = useState(props.initialDefault)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={props.onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Выбор триггера</h3>
          <button type="button" onClick={props.onClose}
            className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500">Когда бот должен запускаться?</p>

        <div className="space-y-2">
          {(['on_first_inbound', 'manual'] as const).map(opt => {
            const meta = TRIGGER_LABEL[opt]
            const active = ev === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setEv(opt)}
                className={[
                  'w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors',
                  active
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50',
                ].join(' ')}
              >
                <span className="text-xl leading-none mt-0.5">{meta.emoji}</span>
                <span className="flex-1">
                  <div className={`text-sm font-medium ${active ? 'text-blue-900' : 'text-gray-900'}`}>
                    {meta.title}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">{meta.sub}</div>
                </span>
                {active && <span className="text-blue-500 text-base">✓</span>}
              </button>
            )
          })}
        </div>

        {ev === 'on_first_inbound' && (
          <label className="flex items-center gap-2 text-sm text-gray-700 pt-2 border-t border-gray-100">
            <input type="checkbox" checked={def} onChange={e => setDef(e.target.checked)} />
            Сделать ботом по умолчанию для входящих
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose}
            className="px-4 py-2 text-sm rounded text-gray-600 hover:bg-gray-100">Отмена</button>
          <button type="button" onClick={() => props.onSave(ev, def)}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700">
            Сохранить триггер
          </button>
        </div>
      </div>
    </div>
  )
}
