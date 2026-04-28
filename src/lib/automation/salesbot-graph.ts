/**
 * Сборка визуального графа (nodes + edges) из amoCRM-экспорта Salesbot.
 *
 * Работает на тех же данных, что и parseAmoSalesbot, но строит представление
 * для builder-UI: каждый шаг → узел с координатами, связи — отдельные edges
 * (по кнопкам, по else, по unconditional goto). На рантайм НЕ влияет —
 * источник правды для бота остаётся salesbot_flows.steps.
 */

export type GraphNodeType =
  | 'start'
  | 'message'
  | 'question_buttons'
  | 'goto'
  | 'condition'
  | 'crm_action'
  | 'delay'
  | 'final'

export interface GraphNode {
  external_step_id: number
  block_uuid: string | null
  type: GraphNodeType
  title: string | null
  config_json: Record<string, unknown>
  position_x: number
  position_y: number
  width: number
  height: number
}

export interface GraphEdge {
  source_step: number
  target_step: number
  source_handle: string
  label: string | null
}

export interface BuiltGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  warnings: string[]
}

interface AmoStepRaw {
  block_uuid?: string
  question?: Array<{ handler: string; params: unknown }>
  answer?: Array<{ handler: string; params: unknown }>
}

interface AmoPosition {
  id?: number
  step?: number
  type?: string
  x?: number
  y?: number
  width?: number
  height?: number
}

const HANDLE_ELSE = '__else__'
const HANDLE_UNCONDITIONAL = '__unconditional__'

/**
 * Принимает raw amoCRM-экспорт (с обёрткой `{type_functionality, model}`).
 * Распаковывает model.text + model.positions и строит граф.
 *
 * Если raw — уже «голый» объект шагов (без обёртки), positions пустые,
 * координаты будут расставлены auto-layout (сетка).
 */
export function buildGraphFromAmoExport(raw: unknown): BuiltGraph {
  const warnings: string[] = []

  const { steps, positions } = unwrapForGraph(raw)

  const numericKeys = Object.keys(steps)
    .filter(k => /^\d+$/.test(k))
    .map(k => Number(k))
    .sort((a, b) => a - b)

  if (numericKeys.length === 0) {
    return { nodes: [], edges: [], warnings: ['нет числовых шагов'] }
  }

  // Карта step → позиция (по amoCRM positions[].step)
  const posByStep = new Map<number, AmoPosition>()
  for (const p of positions) {
    if (typeof p?.step === 'number') posByStep.set(p.step, p)
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Авто-расстановка для шагов без позиции — сетка слева направо
  const COL_W = 360
  const ROW_H = 220
  const PER_COL = 6
  let autoIdx = 0
  const autoPos = () => {
    const col = Math.floor(autoIdx / PER_COL)
    const row = autoIdx % PER_COL
    autoIdx++
    return { x: col * COL_W, y: row * ROW_H }
  }

  for (const k of numericKeys) {
    const step = steps[String(k)] as AmoStepRaw | undefined
    if (!step || typeof step !== 'object') continue

    const detected = classifyStep(step)
    const text = extractText(step) ?? ''
    const buttons = extractButtonLabels(step)

    const config_json: Record<string, unknown> = {
      text,
      buttons,
    }

    // answers (для question_buttons)
    const answers = extractAnswers(step)
    if (answers.length > 0) config_json.answers = answers

    // unconditional goto из question[]
    const unconditional = extractUnconditionalGoto(step)
    if (unconditional != null) config_json.unconditional_next = unconditional

    // else_next
    const elseNext = extractElseNext(step)
    if (elseNext != null) config_json.else_next = elseNext

    // позиция
    const pos = posByStep.get(k)
    const px = pos?.x ?? autoPos().x
    const py = pos?.y ?? 0
    const finalPos =
      pos?.x != null && pos?.y != null
        ? { x: pos.x, y: pos.y }
        : { x: px, y: py || autoPos().y }

    nodes.push({
      external_step_id: k,
      block_uuid: step.block_uuid ?? null,
      type: detected,
      title: titleFor(detected, text),
      config_json,
      position_x: Math.round(finalPos.x),
      position_y: Math.round(finalPos.y),
      width: pos?.width && pos.width > 0 ? Math.round(pos.width) : 320,
      height: pos?.height && pos.height > 0 ? Math.round(pos.height) : 0,
    })

    // edges: одна на каждую кнопку answer
    for (const a of answers) {
      if (a.next == null) continue
      edges.push({
        source_step: k,
        target_step: a.next,
        source_handle: a.value,
        label: a.value,
      })
    }
    // edge: else
    if (elseNext != null) {
      edges.push({
        source_step: k,
        target_step: elseNext,
        source_handle: HANDLE_ELSE,
        label: 'else',
      })
    }
    // edge: безусловный goto после message
    if (unconditional != null) {
      edges.push({
        source_step: k,
        target_step: unconditional,
        source_handle: HANDLE_UNCONDITIONAL,
        label: null,
      })
    }
  }

  // Synthetic start node — наименьший step не всегда «start», но в amoCRM
  // positions[].type === 'start' указывает на стартовую точку. Если есть —
  // добавим synthetic ребро от start до первого шага.
  const startPos = positions.find(p => p?.type === 'start')
  if (startPos && typeof startPos.step !== 'number') {
    // start — это блок без step; на canvas нарисуем, edges из него опустим,
    // потому что target обязан быть в nodes.
  }

  return { nodes, edges, warnings }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function unwrapForGraph(raw: unknown): {
  steps: Record<string, unknown>
  positions: AmoPosition[]
} {
  if (!raw || typeof raw !== 'object') return { steps: {}, positions: [] }
  const r = raw as Record<string, unknown>

  // Уже голый объект шагов?
  for (const k of Object.keys(r)) {
    if (/^\d+$/.test(k)) {
      return { steps: r, positions: [] }
    }
  }

  // Обёртка amoCRM
  const model = r.model as Record<string, unknown> | undefined
  if (!model) return { steps: {}, positions: [] }

  let steps: Record<string, unknown> = {}
  if (typeof model.text === 'string') {
    try { steps = JSON.parse(model.text) as Record<string, unknown> } catch { steps = {} }
  } else if (model.text && typeof model.text === 'object') {
    steps = model.text as Record<string, unknown>
  }

  let positions: AmoPosition[] = []
  if (typeof model.positions === 'string') {
    try { positions = JSON.parse(model.positions) as AmoPosition[] } catch { positions = [] }
  } else if (Array.isArray(model.positions)) {
    positions = model.positions as AmoPosition[]
  }

  return { steps, positions }
}

function classifyStep(step: AmoStepRaw): GraphNodeType {
  const hasAnswers = (step.answer?.length ?? 0) > 0
  const handlers = (step.question ?? []).map(q => q.handler)
  if (handlers.includes('conditions')) return 'condition'
  if (handlers.includes('action')) return 'crm_action'
  if (hasAnswers) return 'question_buttons'
  if (handlers.includes('goto') && !handlers.includes('send_external_message')) return 'goto'
  if (handlers.includes('send_external_message')) return 'message'
  return 'message'
}

function titleFor(type: GraphNodeType, text: string): string {
  const head = (text || '').trim().split(/\r?\n/)[0]?.slice(0, 60) ?? ''
  if (head) return head
  switch (type) {
    case 'question_buttons': return 'Вопрос с кнопками'
    case 'condition': return 'Условие'
    case 'crm_action': return 'CRM действие'
    case 'goto': return 'Переход'
    case 'message': return 'Сообщение'
    case 'start': return 'Старт'
    case 'final': return 'Конец'
    default: return type
  }
}

function extractText(step: AmoStepRaw): string | null {
  for (const q of step.question ?? []) {
    if (q.handler === 'send_external_message') {
      const p = (q.params || {}) as { message?: { text?: string } }
      if (p.message?.text) return String(p.message.text)
    }
  }
  return null
}

function extractButtonLabels(step: AmoStepRaw): string[] {
  // amoCRM: либо message.buttons[], либо value из answer.params[]
  const out: string[] = []
  for (const q of step.question ?? []) {
    if (q.handler === 'send_external_message') {
      const p = (q.params || {}) as {
        message?: { buttons?: Array<{ text?: string }> }
      }
      for (const b of p.message?.buttons ?? []) {
        if (b?.text) out.push(String(b.text))
      }
    }
  }
  if (out.length > 0) return out
  // fallback — кнопки берём из answer (как в текущем JSON)
  for (const a of step.answer ?? []) {
    const list = (a.params || []) as Array<{ value?: string; type?: string }>
    for (const opt of list) {
      if (opt.type !== 'else' && opt.value) out.push(String(opt.value))
    }
  }
  return out
}

interface ExtractedAnswer {
  value: string
  synonyms: string[]
  next: number | null
}

function extractAnswers(step: AmoStepRaw): ExtractedAnswer[] {
  const out: ExtractedAnswer[] = []
  for (const a of step.answer ?? []) {
    // amoCRM экспортирует answer.handler = 'goto' (наш текущий случай)
    // или 'buttons' (старая ветка). В обоих params — массив кнопок.
    const list = (a.params || []) as Array<{
      value?: string
      type?: string
      synonyms?: string[]
      params?: Array<{ handler?: string; params?: { step?: number } }>
    }>
    for (const opt of list) {
      if (opt.type === 'else') continue
      const goto = opt.params?.find(x => x.handler === 'goto')?.params
      if (!opt.value) continue
      out.push({
        value: String(opt.value),
        synonyms: Array.isArray(opt.synonyms) ? opt.synonyms.map(String) : [],
        next: goto?.step != null ? Number(goto.step) : null,
      })
    }
  }
  return out
}

function extractElseNext(step: AmoStepRaw): number | null {
  for (const a of step.answer ?? []) {
    const list = (a.params || []) as Array<{
      type?: string
      params?: Array<{ handler?: string; params?: { step?: number } }>
    }>
    for (const opt of list) {
      if (opt.type === 'else') {
        const goto = opt.params?.find(x => x.handler === 'goto')?.params
        if (goto?.step != null) return Number(goto.step)
      }
    }
  }
  return null
}

function extractUnconditionalGoto(step: AmoStepRaw): number | null {
  for (const q of step.question ?? []) {
    if (q.handler === 'goto') {
      const p = (q.params || {}) as { step?: number }
      if (p.step != null) return Number(p.step)
    }
  }
  return null
}
