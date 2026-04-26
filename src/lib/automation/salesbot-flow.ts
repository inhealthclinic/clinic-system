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

export function parseAmoSalesbot(raw: unknown): ParsedFlow {
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
  if (numericKeys.length === 0) throw new Error('В JSON нет шагов')
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

function matchAnswer(step: FlowStep, raw: string): number | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  if (!t) return null
  // Прямое совпадение или совпадение по синониму (case-insensitive, trim).
  for (const a of step.answers) {
    if (a.value.trim().toLowerCase() === t) return a.next
    for (const s of a.synonyms) {
      if (s.trim().toLowerCase() === t) return a.next
    }
    // Нечёткое: если ответ начинается со значения/синонима + пробел/.
    if (t.startsWith(a.value.trim().toLowerCase())) return a.next
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
  if (existing) return false

  const deal = await fetchDeal(sb, dealId)
  if (!deal) return false

  const flow = await fetchDefaultFlow(sb, deal.clinic_id)
  if (!flow) return false

  const start = flow.start_step
  const r = await deliverChain(sb, deal, flow.steps, start)

  await sb.from('salesbot_runs').insert({
    flow_id: flow.id,
    deal_id: dealId,
    current_step: r.stepNo,
    status: r.finished ? 'finished' : 'active',
    finished_at: r.finished ? new Date().toISOString() : null,
  })
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
  const run = await fetchActiveRun(sb, dealId)
  if (!run) {
    await startFlowForDeal(sb, dealId)
    return
  }

  const cur = run.steps[String(run.current_step)]
  if (!cur) {
    // Шаг исчез из flow (почистили после редактирования) — закрываем run.
    await sb
      .from('salesbot_runs')
      .update({ status: 'stopped', finished_at: new Date().toISOString() })
      .eq('id', run.id)
    return
  }

  let nextStep: number | null = matchAnswer(cur, text)
  if (nextStep == null && cur.else_next != null) nextStep = cur.else_next

  if (nextStep == null) {
    // Не поняли ответ и нет fallback — оставляем run на месте, ждём дальше.
    await sb
      .from('salesbot_runs')
      .update({ last_event_at: new Date().toISOString() })
      .eq('id', run.id)
    return
  }

  const deal = await fetchDeal(sb, dealId)
  if (!deal) return
  const r = await deliverChain(sb, deal, run.steps, nextStep)

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
