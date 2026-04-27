'use client'

/**
 * Визуальный редактор Salesbot — стиль amoCRM.
 *
 * Канва:
 *   ┌─ Триггеры ─┐    ┌─ Запуск бота ─┐    ┌─ Следующий шаг ─┐
 *   │ событие    │ ─► │ зелёный пилл  │ ─► │ типы действий   │
 *   └────────────┘    └───────────────┘    └─────────────────┘
 *
 * Связи между шагами рисуются SVG-кривыми (амо-стиль):
 *   • На каждой карточке слева — input-порт (точка), справа — output-порты
 *     (по одному на каждый ответ-кнопку и один для else-ветки).
 *   • Тянем мышью с output-порта на любую другую карточку — связь создаётся.
 *     Бросаем в пустоту — действие отменяется.
 *   • Клик по существующей кривой → связь удаляется.
 *   • На один target можно сходиться нескольким ответам (несколько
 *     связей — нет проблем).
 *   • Параллельно работает старый dropdown-пикер «→ Шаг N» — оставлен
 *     как клавиатурный fallback.
 *
 * MVP-ограничения:
 *   • работает только action «Отправить сообщение» (остальные — заглушки
 *     в стиле amoCRM, помечены «скоро»);
 *   • синонимы пока заводятся через запятую в одном поле;
 *   • расположение карточек авто (BFS-колонки от стартового шага); ручного
 *     перетаскивания позиций пока нет — для 30-шагового импорта хватает.
 */

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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

// ─── порты для коннектора ────────────────────────────────────────────────────

type OutputKind = 'answer' | 'else'

function outputPortKey(stepId: string, kind: OutputKind, idx?: number): string {
  return kind === 'answer' ? `${stepId}|a|${idx}` : `${stepId}|e`
}

interface XY { x: number; y: number }

/**
 * Безье-кривая между двумя точками (горизонтальный flow слева→направо).
 * dx масштабируем от расстояния, чтобы для близких точек кривая не «вспухала»,
 * для далёких — оставалась плавной (как в amoCRM/Reaktor/n8n).
 */
function bezierPath(a: XY, b: XY): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.4)
  return `M ${a.x},${a.y} C ${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`
}

function shallowEqualPosMap(a: Record<string, XY>, b: Record<string, XY>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    const av = a[k]
    const bv = b[k]
    if (!bv) return false
    if (av.x !== bv.x || av.y !== bv.y) return false
  }
  return true
}

/**
 * Преобразует сохранённый normalized-flow обратно в BuilderStep[] —
 * нужно для редактирования: исходно шаги хранятся с числовыми next,
 * а UI оперирует ссылками на BuilderStep.id (string).
 */
interface SavedStep {
  text?: string
  buttons?: string[]
  answers?: Array<{ value: string; synonyms?: string[]; next: number }>
  else_next?: number | null
  unconditional_next?: number | null
}
function flowToBuilder(steps: Record<string, SavedStep>, start: number) {
  const numericKeys = Object.keys(steps).filter(k => /^\d+$/.test(k)).map(Number).sort((a, b) => a - b)
  const idByNum = new Map<number, string>()
  // Сохраняем порядок: стартовый шаг идёт первым, потом всё остальное.
  const ordered: number[] = [start, ...numericKeys.filter(k => k !== start)]
  ordered.forEach((n, i) => idByNum.set(n, `s_load_${i}_${n}`))
  const result: BuilderStep[] = ordered.map(n => {
    const s = steps[String(n)] ?? {}
    return {
      id: idByNum.get(n)!,
      text: s.text ?? '',
      answers: (s.answers ?? []).map(a => ({
        value: a.value ?? '',
        synonyms: Array.isArray(a.synonyms) ? a.synonyms.join(', ') : '',
        next_step_id: idByNum.get(a.next) ?? null,
      })),
      else_next_id: s.else_next != null ? (idByNum.get(s.else_next) ?? null) : null,
    }
  })
  return result
}

export default function NewSalesbotPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const flowId = sp.get('id')
  const isEdit = !!flowId
  const [name, setName] = useState('')
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent | null>(null)
  const [isDefault, setIsDefault] = useState(true)
  const [triggerModalOpen, setTriggerModalOpen] = useState(false)
  const [steps, setSteps] = useState<BuilderStep[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(isEdit)

  useEffect(() => {
    if (!flowId) return
    let cancelled = false
    ;(async () => {
      const sb = createClient()
      const { data, error } = await sb
        .from('salesbot_flows')
        .select('id, name, steps, start_step, trigger_event, is_default')
        .eq('id', flowId)
        .maybeSingle<{
          id: string; name: string; steps: Record<string, SavedStep>;
          start_step: number; trigger_event: string; is_default: boolean
        }>()
      if (cancelled) return
      if (error || !data) {
        setErr('Не удалось загрузить flow: ' + (error?.message ?? 'не найден'))
        setLoading(false)
        return
      }
      setName(data.name)
      setTriggerEvent(data.trigger_event === 'manual' ? 'manual' : 'on_first_inbound')
      setIsDefault(data.is_default)
      setSteps(flowToBuilder(data.steps ?? {}, data.start_step ?? 0))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [flowId])

  const stepIndexById = useMemo(() => {
    const m = new Map<string, number>()
    steps.forEach((s, i) => m.set(s.id, i))
    return m
  }, [steps])

  // BFS-разбивка шагов по колонкам глубины — для канвы amoCRM-стиля.
  const columns = useMemo<string[][]>(() => {
    if (steps.length === 0) return []
    const depth = new Map<string, number>()
    const queue: string[] = [steps[0].id]
    depth.set(steps[0].id, 0)
    while (queue.length) {
      const id = queue.shift()!
      const s = steps.find(x => x.id === id)
      if (!s) continue
      const d = depth.get(id) ?? 0
      const next: (string | null)[] = [
        ...s.answers.map(a => a.next_step_id),
        s.else_next_id,
      ]
      for (const n of next) {
        if (n && !depth.has(n)) {
          depth.set(n, d + 1)
          queue.push(n)
        }
      }
    }
    // Шаги, не достижимые из стартового — кладём в свою колонку «orphans» в конец.
    let maxD = 0
    for (const v of depth.values()) if (v > maxD) maxD = v
    const cols: string[][] = Array.from({ length: maxD + 1 }, () => [])
    const orphans: string[] = []
    for (const s of steps) {
      const d = depth.get(s.id)
      if (d == null) orphans.push(s.id)
      else cols[d].push(s.id)
    }
    if (orphans.length) cols.push(orphans)
    return cols
  }, [steps])

  // ─── Refs / порты / измерения ────────────────────────────────────────────
  const canvasRef = useRef<HTMLDivElement | null>(null)
  // Карты ref-ов, чтобы getBoundingClientRect-нуть позиции портов.
  const inputPortRefs = useRef<Map<string, HTMLElement | null>>(new Map())
  const outputPortRefs = useRef<Map<string, HTMLElement | null>>(new Map())

  const registerInputPort = useCallback((stepId: string, el: HTMLElement | null) => {
    if (el) inputPortRefs.current.set(stepId, el)
    else inputPortRefs.current.delete(stepId)
  }, [])
  const registerOutputPort = useCallback((key: string, el: HTMLElement | null) => {
    if (el) outputPortRefs.current.set(key, el)
    else outputPortRefs.current.delete(key)
  }, [])

  const [positions, setPositions] = useState<{ inputs: Record<string, XY>; outputs: Record<string, XY> }>({
    inputs: {}, outputs: {},
  })

  const measure = useCallback(() => {
    const root = canvasRef.current
    if (!root) return
    const rb = root.getBoundingClientRect()
    const inputs: Record<string, XY> = {}
    const outputs: Record<string, XY> = {}
    inputPortRefs.current.forEach((el, key) => {
      if (!el || !el.isConnected) return
      const r = el.getBoundingClientRect()
      inputs[key] = {
        x: r.left + r.width / 2 - rb.left + root.scrollLeft,
        y: r.top + r.height / 2 - rb.top + root.scrollTop,
      }
    })
    outputPortRefs.current.forEach((el, key) => {
      if (!el || !el.isConnected) return
      const r = el.getBoundingClientRect()
      outputs[key] = {
        x: r.left + r.width / 2 - rb.left + root.scrollLeft,
        y: r.top + r.height / 2 - rb.top + root.scrollTop,
      }
    })
    setPositions(prev => {
      if (shallowEqualPosMap(prev.inputs, inputs) && shallowEqualPosMap(prev.outputs, outputs)) {
        return prev
      }
      return { inputs, outputs }
    })
  }, [])

  // Перемер делаем после каждого render — карточки могли подрасти от ввода
  // текста, переноса по ширине, добавления новых строк-кнопок и т.д.
  useLayoutEffect(() => { measure() })
  useEffect(() => {
    const root = canvasRef.current
    const handler = () => measure()
    window.addEventListener('resize', handler)
    root?.addEventListener('scroll', handler, { passive: true })
    // Содержимое карточек растягивается асинхронно (textarea autosize и т.п.) —
    // ResizeObserver на корне канвы ловит общий рост.
    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && root) {
      ro = new ResizeObserver(() => measure())
      ro.observe(root)
    }
    return () => {
      window.removeEventListener('resize', handler)
      root?.removeEventListener('scroll', handler)
      ro?.disconnect()
    }
  }, [measure])

  // ─── Drag-to-connect ─────────────────────────────────────────────────────
  const [drag, setDrag] = useState<null | {
    sourceKey: string
    sourceStepId: string
    sourceKind: OutputKind
    sourceIdx?: number
    x: number
    y: number
  }>(null)
  const [hoverTargetStepId, setHoverTargetStepId] = useState<string | null>(null)

  function startDragFromPort(
    e: React.MouseEvent,
    sourceStepId: string,
    sourceKind: OutputKind,
    sourceIdx?: number,
  ) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const root = canvasRef.current
    if (!root) return
    const rb = root.getBoundingClientRect()
    setDrag({
      sourceKey: outputPortKey(sourceStepId, sourceKind, sourceIdx),
      sourceStepId, sourceKind, sourceIdx,
      x: e.clientX - rb.left + root.scrollLeft,
      y: e.clientY - rb.top + root.scrollTop,
    })
    setHoverTargetStepId(null)
  }

  useEffect(() => {
    if (!drag) return
    const root = canvasRef.current
    if (!root) return
    function move(e: MouseEvent) {
      const root = canvasRef.current
      if (!root) return
      const rb = root.getBoundingClientRect()
      const x = e.clientX - rb.left + root.scrollLeft
      const y = e.clientY - rb.top + root.scrollTop
      setDrag(d => (d ? { ...d, x, y } : null))
      // Подсветка карточки-цели под курсором.
      const t = document.elementFromPoint(e.clientX, e.clientY)
      const card = (t as HTMLElement | null)?.closest('[data-step-card]') as HTMLElement | null
      const id = card?.dataset.stepId ?? null
      setHoverTargetStepId(prev => (prev === id ? prev : id))
    }
    function up(e: MouseEvent) {
      const t = document.elementFromPoint(e.clientX, e.clientY)
      const card = (t as HTMLElement | null)?.closest('[data-step-card]') as HTMLElement | null
      const targetId = card?.dataset.stepId
      setDrag(curDrag => {
        if (curDrag && targetId && targetId !== curDrag.sourceStepId) {
          applyConnect(curDrag.sourceStepId, curDrag.sourceKind, curDrag.sourceIdx, targetId)
        }
        return null
      })
      setHoverTargetStepId(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag != null])

  function applyConnect(
    sourceStepId: string,
    kind: OutputKind,
    idx: number | undefined,
    targetStepId: string | null,
  ) {
    if (kind === 'answer' && idx != null) {
      setSteps(prev => prev.map(s => s.id === sourceStepId
        ? { ...s, answers: s.answers.map((a, i) => i === idx ? { ...a, next_step_id: targetStepId } : a) }
        : s))
    } else {
      setSteps(prev => prev.map(s => s.id === sourceStepId
        ? { ...s, else_next_id: targetStepId }
        : s))
    }
  }

  // Все актуальные связи для отрисовки SVG.
  const connections = useMemo(() => {
    const out: Array<{
      key: string
      sourceKey: string
      targetStepId: string
      sourceStepId: string
      kind: OutputKind
      sourceIdx?: number
    }> = []
    for (const s of steps) {
      s.answers.forEach((a, i) => {
        if (a.next_step_id) {
          out.push({
            key: `${s.id}|a|${i}|${a.next_step_id}`,
            sourceKey: outputPortKey(s.id, 'answer', i),
            targetStepId: a.next_step_id,
            sourceStepId: s.id, kind: 'answer', sourceIdx: i,
          })
        }
      })
      if (s.else_next_id) {
        out.push({
          key: `${s.id}|e|${s.else_next_id}`,
          sourceKey: outputPortKey(s.id, 'else'),
          targetStepId: s.else_next_id,
          sourceStepId: s.id, kind: 'else',
        })
      }
    }
    return out
  }, [steps])

  // ─── Простые мутаторы шагов ──────────────────────────────────────────────
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
      const res = await fetch(
        isEdit ? `/api/salesbot-flows/${flowId}` : '/api/salesbot-flows',
        {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            steps: normalized,
            start_step: 0,
            trigger_event: triggerEvent ?? 'manual',
            is_default: triggerEvent === 'on_first_inbound' ? isDefault : false,
            is_active: true,
          }),
        },
      )
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'save failed')
      router.push('/settings/salesbots')
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center text-sm text-gray-500">Загружаем sales-бот…</div>
    )
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
            placeholder={isEdit ? 'Название бота' : 'SALES-БОТ'}
            className="text-xl font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-blue-400 outline-none px-1 py-0.5 min-w-[200px]"
          />
          {isEdit && (
            <span className="text-xs text-gray-400 uppercase tracking-wide">редактирование</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {err && <span className="text-xs text-red-600">{err}</span>}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Сохраняем…' : (isEdit ? 'Сохранить изменения' : 'Сохранить и вернуться')}
          </button>
        </div>
      </div>

      {/* Подсказка по работе с коннектами */}
      {steps.length > 0 && (
        <div className="text-xs text-gray-500 leading-relaxed">
          Тяните мышью с правого порта (●) карточки на любую другую карточку, чтобы создать связь.
          Клик по линии — отвязать. Один шаг можно сделать целью сразу для нескольких ответов.
        </div>
      )}

      {/* Канва amoCRM-стиля */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 overflow-x-auto">
        <div ref={canvasRef} className="relative flex items-start gap-6 min-w-[1100px]">
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

          {/* Следующий шаг — выбор первого действия (стартовый пикер) */}
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

          {/* Колонки шагов */}
          {columns.map((col, ci) => (
            <FlowColumn
              key={ci}
              stepIds={col}
              allSteps={steps}
              stepIndexById={stepIndexById}
              hoverTargetStepId={hoverTargetStepId}
              dragSourceStepId={drag?.sourceStepId ?? null}
              registerInputPort={registerInputPort}
              registerOutputPort={registerOutputPort}
              startDragFromPort={startDragFromPort}
              updateStep={updateStep}
              updateAnswer={updateAnswer}
              addAnswer={addAnswer}
              removeAnswer={removeAnswer}
              removeStep={removeStep}
              addStepAfter={addStepAfter}
            />
          ))}

          {/* SVG-оверлей для связей. pointer-events: none на корне, auto на путях. */}
          <svg
            className="absolute inset-0 pointer-events-none"
            style={{ overflow: 'visible' }}
            width="100%"
            height="100%"
          >
            <defs>
              <marker
                id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#3b82f6" />
              </marker>
              <marker
                id="arrow-gray" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#9ca3af" />
              </marker>
            </defs>
            {connections.map(c => {
              const src = positions.outputs[c.sourceKey]
              const tgt = positions.inputs[c.targetStepId]
              if (!src || !tgt) return null
              const d = bezierPath(src, tgt)
              const stroke = c.kind === 'else' ? '#9ca3af' : '#3b82f6'
              const marker = c.kind === 'else' ? 'url(#arrow-gray)' : 'url(#arrow-blue)'
              return (
                <g key={c.key} className="connection-group">
                  {/* Толстый прозрачный hit-area для удобного клика. */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onClick={() => applyConnect(c.sourceStepId, c.kind, c.sourceIdx, null)}
                  >
                    <title>Клик — отвязать</title>
                  </path>
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={2}
                    markerEnd={marker}
                    style={{ pointerEvents: 'none' }}
                  />
                </g>
              )
            })}
            {/* Призрачная линия во время drag-to-connect. */}
            {drag && (() => {
              const src = positions.outputs[drag.sourceKey]
              if (!src) return null
              const tgt = { x: drag.x, y: drag.y }
              const d = bezierPath(src, tgt)
              return (
                <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2}
                  strokeDasharray="4 4" style={{ pointerEvents: 'none' }} />
              )
            })()}
          </svg>
        </div>
      </div>

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

// ─── Карточка шага в стиле amoCRM-нода ───────────────────────────────────────

interface StepCardProps {
  step: BuilderStep
  stepNo: number
  allSteps: BuilderStep[]
  stepIndexById: Map<string, number>
  hoverTargetStepId: string | null
  dragSourceStepId: string | null
  registerInputPort: (stepId: string, el: HTMLElement | null) => void
  registerOutputPort: (key: string, el: HTMLElement | null) => void
  startDragFromPort: (e: React.MouseEvent, sourceStepId: string, sourceKind: OutputKind, sourceIdx?: number) => void
  updateStep: (id: string, patch: Partial<BuilderStep>) => void
  updateAnswer: (sid: string, idx: number, patch: Partial<BuilderAnswer>) => void
  addAnswer: (sid: string) => void
  removeAnswer: (sid: string, idx: number) => void
  removeStep: (sid: string) => void
  addStepAfter: (sid: string, answerIdx?: number) => void
}

function StepCard(p: StepCardProps) {
  const { step, stepNo, allSteps, stepIndexById, hoverTargetStepId, dragSourceStepId } = p
  const isDragHover = hoverTargetStepId === step.id && dragSourceStepId !== step.id
  return (
    <div
      data-step-card
      data-step-id={step.id}
      className={[
        'w-80 flex-shrink-0 bg-white border rounded-lg shadow-sm relative transition-colors',
        isDragHover ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200',
      ].join(' ')}
    >
      {/* Заголовок */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 relative">
        {/* Input-порт — слева, торчит за границу */}
        <span
          ref={el => p.registerInputPort(step.id, el)}
          className="absolute -left-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-400"
          aria-hidden
        />
        <span className="w-6 h-6 rounded bg-white border border-gray-200 text-xs font-mono flex items-center justify-center text-gray-700">
          {stepNo}
        </span>
        <span className="text-sm font-medium text-gray-800 flex-1 truncate">💬 Отправить сообщение</span>
        <button type="button" onClick={() => p.removeStep(step.id)}
          className="text-gray-400 hover:text-red-500 text-base leading-none" title="Удалить шаг">×</button>
      </div>

      {/* Тело — синяя «капсула» с textarea (как amoCRM-композер) */}
      <div className="p-3 space-y-2">
        <div className="bg-blue-500 rounded-lg p-2.5">
          <textarea
            value={step.text}
            onChange={e => p.updateStep(step.id, { text: e.target.value })}
            rows={3}
            placeholder="Напишите текст сообщения…"
            className="w-full bg-transparent text-white placeholder-blue-200 text-sm outline-none resize-none"
          />
          {/* Бейджи-кнопки внутри композера */}
          <div className="flex flex-wrap gap-1.5 mt-1.5 pt-1.5 border-t border-blue-400/40">
            {step.answers.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-white/95 text-blue-700 text-xs rounded px-2 py-0.5">
                {a.value || `Кнопка ${i + 1}`}
                <button type="button" onClick={() => p.removeAnswer(step.id, i)}
                  className="text-blue-400 hover:text-red-500 leading-none">×</button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => p.addAnswer(step.id)}
              className="text-xs text-white/90 hover:text-white border border-white/30 hover:border-white/60 rounded px-2 py-0.5"
            >
              + Добавить кнопку
            </button>
          </div>
        </div>

        {/* Редактор кнопок (раскрытый — value/synonyms/next) */}
        {step.answers.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {step.answers.map((a, i) => {
              const portKey = outputPortKey(step.id, 'answer', i)
              return (
                <div key={i} className="border border-gray-100 rounded p-2 bg-gray-50/60 space-y-1 relative">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text" value={a.value}
                      onChange={e => p.updateAnswer(step.id, i, { value: e.target.value })}
                      placeholder={`Кнопка ${i + 1}`}
                      className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-xs hover:border-gray-300 focus:border-blue-400 outline-none"
                    />
                    <NextStepPicker
                      value={a.next_step_id}
                      onChange={(v) => p.updateAnswer(step.id, i, { next_step_id: v })}
                      allSteps={allSteps}
                      stepIndexById={stepIndexById}
                      excludeId={step.id}
                      onAddNew={() => p.addStepAfter(step.id, i)}
                    />
                  </div>
                  <input
                    type="text" value={a.synonyms}
                    onChange={e => p.updateAnswer(step.id, i, { synonyms: e.target.value })}
                    placeholder="Синонимы через запятую"
                    className="w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs hover:border-gray-300 focus:border-blue-400 outline-none"
                  />
                  {/* Output-порт — справа, торчит за границу */}
                  <span
                    ref={el => p.registerOutputPort(portKey, el)}
                    onMouseDown={e => p.startDragFromPort(e, step.id, 'answer', i)}
                    title="Перетащите на другую карточку, чтобы связать"
                    className={[
                      'absolute -right-2 top-3 w-3 h-3 rounded-full border-2 cursor-crosshair',
                      a.next_step_id
                        ? 'bg-blue-500 border-blue-600 hover:bg-blue-600'
                        : 'bg-white border-blue-400 hover:bg-blue-100',
                    ].join(' ')}
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* Else-выход */}
        <div className="flex items-center gap-1.5 pt-1.5 border-t border-gray-100 text-[11px] text-gray-500 relative">
          <span>Если не подошло:</span>
          <NextStepPicker
            value={step.else_next_id}
            onChange={(v) => p.updateStep(step.id, { else_next_id: v })}
            allSteps={allSteps}
            stepIndexById={stepIndexById}
            excludeId={step.id}
            onAddNew={() => p.addStepAfter(step.id)}
            placeholder="— остаться"
          />
          <span
            ref={el => p.registerOutputPort(outputPortKey(step.id, 'else'), el)}
            onMouseDown={e => p.startDragFromPort(e, step.id, 'else')}
            title="Перетащите на карточку — else-ветка"
            className={[
              'absolute -right-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 cursor-crosshair',
              step.else_next_id
                ? 'bg-gray-500 border-gray-600 hover:bg-gray-700'
                : 'bg-white border-gray-400 hover:bg-gray-100',
            ].join(' ')}
          />
        </div>
      </div>
    </div>
  )
}

function NextStepPicker(props: {
  value: string | null
  onChange: (v: string | null) => void
  allSteps: BuilderStep[]
  stepIndexById: Map<string, number>
  excludeId: string
  onAddNew: () => void
  placeholder?: string
}) {
  return (
    <div className="flex items-center gap-1">
      <select
        value={props.value ?? ''}
        onChange={e => props.onChange(e.target.value || null)}
        className="bg-white border border-gray-200 rounded px-1.5 py-1 text-xs hover:border-gray-300 focus:border-blue-400 outline-none"
      >
        <option value="">{props.placeholder ?? '→ Следующий шаг'}</option>
        {props.allSteps.map(s => s.id === props.excludeId ? null : (
          <option key={s.id} value={s.id}>→ Шаг {(props.stepIndexById.get(s.id) ?? 0) + 1}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={props.onAddNew}
        title="Создать новый шаг"
        className="text-xs text-blue-600 hover:bg-blue-50 rounded px-1.5 py-0.5 border border-blue-200"
      >
        +
      </button>
    </div>
  )
}

// Колонка карточек одной BFS-глубины.
function FlowColumn(props: {
  stepIds: string[]
  allSteps: BuilderStep[]
  stepIndexById: Map<string, number>
  hoverTargetStepId: string | null
  dragSourceStepId: string | null
  registerInputPort: (stepId: string, el: HTMLElement | null) => void
  registerOutputPort: (key: string, el: HTMLElement | null) => void
  startDragFromPort: (e: React.MouseEvent, sourceStepId: string, sourceKind: OutputKind, sourceIdx?: number) => void
  updateStep: (id: string, patch: Partial<BuilderStep>) => void
  updateAnswer: (sid: string, idx: number, patch: Partial<BuilderAnswer>) => void
  addAnswer: (sid: string) => void
  removeAnswer: (sid: string, idx: number) => void
  removeStep: (sid: string) => void
  addStepAfter: (sid: string, answerIdx?: number) => void
}) {
  return (
    <div className="flex flex-col gap-6 flex-shrink-0">
      {props.stepIds.map(sid => {
        const step = props.allSteps.find(s => s.id === sid)
        if (!step) return null
        const stepNo = (props.stepIndexById.get(sid) ?? 0) + 1
        return (
          <StepCard
            key={sid}
            step={step}
            stepNo={stepNo}
            allSteps={props.allSteps}
            stepIndexById={props.stepIndexById}
            hoverTargetStepId={props.hoverTargetStepId}
            dragSourceStepId={props.dragSourceStepId}
            registerInputPort={props.registerInputPort}
            registerOutputPort={props.registerOutputPort}
            startDragFromPort={props.startDragFromPort}
            updateStep={props.updateStep}
            updateAnswer={props.updateAnswer}
            addAnswer={props.addAnswer}
            removeAnswer={props.removeAnswer}
            removeStep={props.removeStep}
            addStepAfter={props.addStepAfter}
          />
        )
      })}
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
