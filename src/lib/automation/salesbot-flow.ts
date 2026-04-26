/**
 * Диалоговый Salesbot — рантайм и парсер amoCRM-экспорта.
 *
 * Что умеет:
 *   • parseAmoSalesbot(json)            — нормализует amoCRM JSON в наш формат шагов.
 *   • startFlowForDeal(sb, dealId)      — стартует default-flow клиники для сделки,
 *                                         доставляет первый шаг в WhatsApp.
 *   • routeInboundForDeal(sb, dealId, t)— по входящему тексту ищет совпадение
 *                                         в текущем шаге и переходит дальше
 *                                         (или запускает flow, если ещё нет run).
 *
 * Что НЕ поддерживает в MVP:
 *   • action.set_custom_fields, conditions — пропускаются.
 *   • inline-кнопки WhatsApp Cloud API — Green-API API_v1 не передаёт buttons,
 *     поэтому варианты дописываются нумерованным списком в текст. Синонимы
 *     амо-экспорта уже включают «1», «2», «1)» и т.п. — это и нужно.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWhatsAppText, normalizePhone } from '@/lib/greenapi'

// ─── Нормализованный формат ──────────────────────────────────────────────────

export interface FlowAnswer {
  value: string
  synonyms: string[]
  next: number
}

export interface FlowStep {
  text: string
  buttons: string[]
  answers: FlowAnswer[]
  else_next?: number | null
  unconditional_next?: number | null
}

export type FlowSteps = Record<string, FlowStep>

// ─── Парсер amoCRM Salesbot JSON ─────────────────────────────────────────────

// amoCRM-экспорт — словарь "0":{...}, "7":{...}, плюс служебный ключ "conversation".
// В каждом шаге question[] и answer[] — массивы handler'ов; нас интересуют
// send_external_message (текст + кнопки), buttons (варианты ответа), goto.
type AmoStep = {
  question?: Array<{ handler: string; params: unknown }>
  answer?: Array<{ handler: string; params: unknown }>
}

interface AmoSendMessageParams {
  message?: { text?: string; buttons?: Array<{ text?: string; type?: string }> }
}
interface AmoButtonsParam {
  value?: string
  type?: string                        // 'else'
  synonyms?: string[]
  params?: Array<{ handler: string; params: { type?: string; step?: number } }>
}

export interface ParsedFlow {
  start: number
  steps: FlowSteps
  warnings: string[]
}

/**
 * amoCRM экспортирует Salesbot обёрткой:
 *   { "type_functionality": 0, "model": { "name": "...", "text": "<stringified-json>", ... } }
 * Внутри model.text лежит настоящий объект с шагами {"0":{...},"7":{...},…}.
 * Если на вход передали обёртку — разворачиваем её до пользователя; обычный
 * «голый» объект шагов тоже принимается как раньше.
 */
function unwrapAmoExport(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as Record<string, unknown>
  // Уже «голый» формат — есть числовые ключи.
  for (const k of Object.keys(r)) if (/^\d+$/.test(k)) return raw
  // Обёртка amoCRM: { type_functionality, model:{ text:"<json>" } }
  const model = r.model as Record<string, unknown> | undefined
  if (model && typeof model.text === 'string') {
    try { return JSON.parse(model.text) } catch { /* fall through */ }
  }
  // Иногда text уже распарсен — model.text как объект.
  if (model && model.text && typeof model.text === 'object') {
    return model.text
  }
  return raw
}

export function parseAmoSalesbot(rawIn: unknown): ParsedFlow {
  const raw = unwrapAmoExport(rawIn)
  if (!raw || typeof raw !== 'object') throw new Error('JSON должен быть объектом')
  const src = raw as Record<string, unknown>
  const steps: FlowSteps = {}
  const warnings: string[] = []

  let start = 0
  // Стартовый шаг — наименьший числовой ключ.
  const numericKeys = Object.keys(src)
    .filter(k => /^\d+$/.test(k))
    .map(k => Number(k))
    .sort((a, b) => a - b)
  if (numericKeys.length === 0) {
    throw new Error('В JSON нет шагов (ожидаются числовые ключи "0","7",… или amoCRM-обёртка с model.text)')
  }
  start = numericKeys[0]

  for (const k of numericKeys) {
    const step = src[String(k)] as AmoStep | undefined
    if (!step || typeof step !== 'object') continue

    let text = ''
    const buttons: string[] = []
    let unconditional_next: number | null = null

    for (const q of step.question ?? []) {
      if (q.handler === 'send_external_message') {
        const p = (q.params || {}) as AmoSendMessageParams
        if (p.message?.text) text = String(p.message.text)
        if (Array.isArray(p.message?.buttons)) {
          for (const b of p.message!.buttons!) {
            if (b?.text) buttons.push(String(b.text))
          }
        }
      } else if (q.handler === 'goto') {
        const gp = (q.params || {}) as { type?: string; step?: number }
        if (gp.step != null) unconditional_next = Number(gp.step)
      } else if (q.handler === 'conditions' || q.handler === 'action') {
        warnings.push(`Шаг ${k}: handler "${q.handler}" пропущен (MVP не поддерживает)`)
      }
    }

    const answers: FlowAnswer[] = []
    let else_next: number | null = null
    for (const a of step.answer ?? []) {
      if (a.handler !== 'buttons') continue
      const list = (a.params || []) as AmoButtonsParam[]
      for (const opt of list) {
        const goto = opt.params?.find(x => x.handler === 'goto')?.params
        if (!goto || goto.step == null) continue
        if (opt.type === 'else') {
          else_next = Number(goto.step)
        } else if (opt.value) {
          answers.push({
            value: String(opt.value),
            synonyms: Array.isArray(opt.synonyms) ? opt.synonyms.map(String) : [],
            next: Number(goto.step),
          })
        }
      }
    }

    steps[String(k)] = {
      text,
      buttons,
      answers,
      else_next,
      unconditional_next,
    }
  }

  return { start, steps, warnings }
}

// ─── Рантайм ─────────────────────────────────────────────────────────────────

interface DealRow {
  id: string
  clinic_id: string
  contact_phone: string | null
  patient: { phones: string[] | null } | { phones: string[] | null }[] | null
}

function pickPhone(d: DealRow): string | null {
  if (d.contact_phone) return normalizePhone(d.contact_phone)
  const p = Array.isArray(d.patient) ? d.patient[0] : d.patient
  const phone = p?.phones?.[0]
  return phone ? normalizePhone(phone) : null
}

function buildOutboundText(step: FlowStep): string {
  // Green-API на бесплатном тарифе не шлёт inline-кнопки — добавим
  // нумерованный список. Совпадения «1»/«2» уже учтены в синонимах.
  if (!step.buttons || step.buttons.length === 0) return step.text
  const lines = step.buttons.map((b, i) => `${i + 1}. ${b}`)
  return `${step.text}\n\n${lines.join('\n')}`
}

function norm(s: string): string {
  // Случайная пунктуация по краям ломает поиск: «4.», «4)», «1)», «(2)», «—Актау»…
  // Снимаем пробелы и обрамляющие знаки препинания, опускаем регистр.
  return s
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .replace(/^[\s.,;:!?()[\]{}«»"'\-—–•·]+|[\s.,;:!?()[\]{}«»"'\-—–•·]+$/g, '')
    .trim()
}

function matchAnswer(step: FlowStep, raw: string): number | null {
  if (!raw) return null
  const t = norm(raw)
  if (!t) return null

  // 1) Точное совпадение по value или синониму.
  for (const a of step.answers) {
    if (norm(a.value) === t) return a.next
    for (const s of a.synonyms) {
      if (norm(s) === t) return a.next
    }
  }

  // 2) Числовой fallback: если клиент прислал только цифру (или цифру с
  // мусором по краям — «4», «4.», «4)», «(4)», «#4»), а в кнопках/ответах
  // нет такого синонима — берём ответ по позиции в массиве кнопок.
  // Это закрывает кейс, когда у одного из вариантов забыли указать «N» в
  // синонимах, но клиенту мы отправили нумерованный список.
  const digitOnly = t.replace(/[^0-9]/g, '')
  if (digitOnly && /^\d+$/.test(digitOnly)) {
    const n = parseInt(digitOnly, 10)
    if (n >= 1) {
      // Пробуем сматчить по букве из buttons[]
      const btnLabel = step.buttons[n - 1]
      if (btnLabel) {
        const target = norm(btnLabel)
        for (const a of step.answers) {
          if (norm(a.value) === target) return a.next
          for (const s of a.synonyms) {
            if (norm(s) === target) return a.next
          }
        }
      }
      // Иначе — по позиции в answers[]
      if (step.answers[n - 1]) return step.answers[n - 1].next
    }
  }

  // 3) Префикс: «Актау, келдім» → Актау.
  for (const a of step.answers) {
    const v = norm(a.value)
    if (v.length >= 3 && t.startsWith(v + ' ')) return a.next
    for (const s of a.synonyms) {
      const sn = norm(s)
      if (sn.length >= 3 && t.startsWith(sn + ' ')) return a.next
    }
  }

  return null
}

async function fetchDeal(sb: SupabaseClient, dealId: string): Promise<DealRow | null> {
  const { data } = await sb
    .from('deals')
    .select('id, clinic_id, contact_phone, patient:patients(phones)')
    .eq('id', dealId)
    .single<DealRow>()
  return data ?? null
}

async function fetchDefaultFlow(sb: SupabaseClient, clinicId: string) {
  const { data } = await sb
    .from('salesbot_flows')
    .select('id, start_step, steps, name')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .eq('is_default', true)
    .eq('trigger_event', 'on_first_inbound')
    .maybeSingle<{ id: string; start_step: number; steps: FlowSteps; name: string }>()
  return data ?? null
}

async function fetchActiveRun(sb: SupabaseClient, dealId: string) {
  const { data } = await sb
    .from('salesbot_runs')
    .select('id, flow_id, current_step, flow:salesbot_flows(steps)')
    .eq('deal_id', dealId)
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string; flow_id: string; current_step: number;
      flow: { steps: FlowSteps } | { steps: FlowSteps }[] | null
    }>()
  if (!data) return null
  const flow = Array.isArray(data.flow) ? data.flow[0] : data.flow
  return { id: data.id, flow_id: data.flow_id, current_step: data.current_step, steps: (flow?.steps ?? {}) as FlowSteps }
}

/**
 * Доставить шаг (отправить WhatsApp + записать deal_messages). Возвращает
 * следующий step_no если у шага есть unconditional_next, иначе null —
 * остаёмся ждать ответ пользователя.
 */
async function deliverStep(
  sb: SupabaseClient,
  deal: DealRow,
  steps: FlowSteps,
  stepNo: number,
): Promise<{ nextStep: number | null; finished: boolean }> {
  const step = steps[String(stepNo)]
  if (!step) return { nextStep: null, finished: true }

  const phone = pickPhone(deal)
  const body = buildOutboundText(step)

  if (body && phone && phone.length >= 10) {
    try {
      const r = await sendWhatsAppText(phone, body)
      await sb.from('deal_messages').insert({
        deal_id: deal.id,
        clinic_id: deal.clinic_id,
        direction: 'out',
        channel: 'whatsapp',
        body,
        sender_type: 'bot',
        external_id: r.idMessage,
        status: 'sent',
      })
    } catch (e) {
      console.warn('[salesbot-flow] sendWhatsAppText failed:', (e as Error).message)
      // Не прерываем — flow всё равно продвинется, иначе run застрянет.
    }
  }

  const nextStep =
    step.unconditional_next != null
      ? step.unconditional_next
      : null
  // Если на шаге нет ни ответов, ни безусловного перехода — это терминал.
  const finished =
    nextStep == null &&
    (!step.answers || step.answers.length === 0) &&
    step.else_next == null
  return { nextStep, finished }
}

/** Рекурсивно прогоняет цепочку шагов с unconditional_next, пока не упрёмся
 *  в шаг с ответами/без перехода. Возвращает финальный step_no и финиш-флаг. */
async function deliverChain(
  sb: SupabaseClient,
  deal: DealRow,
  steps: FlowSteps,
  startStep: number,
  maxHops = 8,
): Promise<{ stepNo: number; finished: boolean }> {
  let cur = startStep
  for (let i = 0; i < maxHops; i++) {
    const r = await deliverStep(sb, deal, steps, cur)
    if (r.finished) return { stepNo: cur, finished: true }
    if (r.nextStep == null) return { stepNo: cur, finished: false }
    cur = r.nextStep
  }
  return { stepNo: cur, finished: false }
}

/**
 * Запустить дефолтный flow клиники для сделки, если ещё нет активного run.
 * Возвращает true, если что-то стартовало.
 */
export async function startFlowForDeal(
  sb: SupabaseClient,
  dealId: string,
): Promise<boolean> {
  const existing = await fetchActiveRun(sb, dealId)
  if (existing) {
    console.log('[salesbot] startFlowForDeal: deal', dealId, 'already has active run', existing.id, 'step=', existing.current_step)
    return false
  }

  const deal = await fetchDeal(sb, dealId)
  if (!deal) {
    console.warn('[salesbot] startFlowForDeal: deal', dealId, 'not found')
    return false
  }

  const flow = await fetchDefaultFlow(sb, deal.clinic_id)
  if (!flow) {
    console.log('[salesbot] startFlowForDeal: no default flow for clinic', deal.clinic_id, '— импортируйте бота на /settings/salesbots и сделайте default')
    return false
  }

  console.log('[salesbot] starting flow', flow.id, '("' + flow.name + '") for deal', dealId, 'from step', flow.start_step)
  const start = flow.start_step
  const r = await deliverChain(sb, deal, flow.steps, start)

  const { error } = await sb.from('salesbot_runs').insert({
    flow_id: flow.id,
    deal_id: dealId,
    current_step: r.stepNo,
    status: r.finished ? 'finished' : 'active',
    finished_at: r.finished ? new Date().toISOString() : null,
  })
  if (error) {
    console.error('[salesbot] failed to insert run:', error.message)
  } else {
    console.log('[salesbot] run created, parked at step', r.stepNo, r.finished ? '(finished)' : '(waiting for answer)')
  }
  return true
}

/**
 * Обработать входящий текст:
 *   • если есть активный run — попытаться сматчить ответ и продвинуться;
 *   • если нет — стартовать default-flow для сделки.
 */
export async function routeInboundForDeal(
  sb: SupabaseClient,
  dealId: string,
  text: string,
): Promise<void> {
  console.log('[salesbot] routeInbound: deal', dealId, 'text=', JSON.stringify(text))
  const run = await fetchActiveRun(sb, dealId)
  if (!run) {
    console.log('[salesbot] routeInbound: no active run → delegating to startFlowForDeal')
    await startFlowForDeal(sb, dealId)
    return
  }
  console.log('[salesbot] routeInbound: active run', run.id, 'flow', run.flow_id, 'current_step', run.current_step)

  const cur = run.steps[String(run.current_step)]
  if (!cur) {
    console.warn('[salesbot] routeInbound: step', run.current_step, 'missing from flow steps — stopping run')
    await sb
      .from('salesbot_runs')
      .update({ status: 'stopped', finished_at: new Date().toISOString() })
      .eq('id', run.id)
    return
  }
  console.log('[salesbot] routeInbound: step has', cur.answers.length, 'answers,', cur.buttons.length, 'buttons, else_next=', cur.else_next)

  let nextStep: number | null = matchAnswer(cur, text)
  if (nextStep != null) {
    console.log('[salesbot] routeInbound: matched → next step', nextStep)
  } else if (cur.else_next != null) {
    nextStep = cur.else_next
    console.log('[salesbot] routeInbound: no match, using else_next →', nextStep)
  } else {
    console.log('[salesbot] routeInbound: no match and no else_next — staying at step', run.current_step)
  }

  if (nextStep == null) {
    await sb
      .from('salesbot_runs')
      .update({ last_event_at: new Date().toISOString() })
      .eq('id', run.id)
    return
  }

  const deal = await fetchDeal(sb, dealId)
  if (!deal) {
    console.warn('[salesbot] routeInbound: deal', dealId, 'not found when delivering next step')
    return
  }
  const r = await deliverChain(sb, deal, run.steps, nextStep)
  console.log('[salesbot] routeInbound: delivered chain, parked at step', r.stepNo, r.finished ? '(finished)' : '(waiting)')

  await sb
    .from('salesbot_runs')
    .update({
      current_step: r.stepNo,
      status: r.finished ? 'finished' : 'active',
      finished_at: r.finished ? new Date().toISOString() : null,
      last_event_at: new Date().toISOString(),
    })
    .eq('id', run.id)
}
