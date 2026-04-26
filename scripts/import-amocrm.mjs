#!/usr/bin/env node
/**
 * import-amocrm.mjs — одноразовый импорт сделок/контактов/сообщений из amoCRM.
 *
 * Стратегия:
 *   1. Тянем amoCRM /leads/pipelines → строим map (amo_status_id → stage name).
 *   2. Тянем pipeline_stages нашей воронки → map (lowercased name → stage_id).
 *   3. Постранично /leads?with=contacts → для каждой:
 *        • резолвим контакт по телефону → patient (find или create stub)
 *        • upsert в deals по external_id = 'amo:<lead.id>' (см. мигр. 080)
 *   4. Опционально (--with-notes): /leads/{id}/notes → deal_messages
 *        с external_id = 'amo:note:<note.id>' (дедуп по уник. индексу
 *        deal_messages.channel+external_id, см. мигр. 039).
 *
 * Идемпотентность:
 *   • deals: по external_id (UPSERT через уник. индекс из мигр. 080).
 *   • patients: find по нормализ. телефону → если нет, создаём «амо-стаб».
 *   • deal_messages: по (channel, external_id) — повторный запуск не дублирует.
 *
 * Маппинг ролей/менеджеров — НЕ делаем (responsible_user_id = NULL); если надо,
 * после импорта пройтись SQL-ом по responsible_user_id из таблицы маппинга.
 *
 * Использование:
 *   AMOCRM_SUBDOMAIN=mycompany \
 *   AMOCRM_TOKEN=eyJ... \
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   CLINIC_ID=<uuid> \
 *   PIPELINE_CODE=leads \
 *   node scripts/import-amocrm.mjs [--with-notes] [--dry-run] [--limit=500]
 *
 * Перед запуском: snapshot-db.mjs > snapshots/before-amo-import.json
 */
import { createClient } from '@supabase/supabase-js'

// ── ENV ──────────────────────────────────────────────────────────────────────
const AMOCRM_SUBDOMAIN = process.env.AMOCRM_SUBDOMAIN
const AMOCRM_TOKEN     = process.env.AMOCRM_TOKEN
const SUPABASE_URL     = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY
const CLINIC_ID        = process.env.CLINIC_ID
const PIPELINE_CODE    = process.env.PIPELINE_CODE || 'leads'

const args = new Set(process.argv.slice(2))
const WITH_NOTES = args.has('--with-notes')
const DRY_RUN    = args.has('--dry-run')
const LIMIT_ARG  = [...args].find(a => a.startsWith('--limit='))
const LIMIT      = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity

if (!AMOCRM_SUBDOMAIN || !AMOCRM_TOKEN) die('AMOCRM_SUBDOMAIN и AMOCRM_TOKEN обязательны')
if (!SUPABASE_URL || !SERVICE_KEY)      die('SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY обязательны')
if (!CLINIC_ID)                          die('CLINIC_ID обязателен')

const sb   = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const AMO  = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru/api/v4`

// ── Helpers ──────────────────────────────────────────────────────────────────
function die(msg) { console.error('ERR:', msg); process.exit(1) }
function log(...a) { console.log('[amo]', ...a) }

async function amoFetch(path, params = {}) {
  const url = new URL(AMO + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AMOCRM_TOKEN}` } })
  if (res.status === 204) return null
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`amoCRM ${res.status} ${path}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}

function normalizePhone(raw) {
  if (!raw) return null
  const d = String(raw).replace(/\D+/g, '')
  if (!d) return null
  // KZ/RU: 11 цифр, начинаются с 7. Допускаем 8 → 7.
  if (d.length === 11 && d[0] === '8') return '7' + d.slice(1)
  return d
}

// ── 1. Pipeline mapping ──────────────────────────────────────────────────────
async function loadPipelineMaps() {
  // amoCRM pipelines + statuses
  const amoPipelines = await amoFetch('/leads/pipelines')
  const statusById = new Map() // amo_status_id → { name, pipeline_id, type }
  for (const p of amoPipelines?._embedded?.pipelines ?? []) {
    for (const s of p?._embedded?.statuses ?? []) {
      statusById.set(s.id, { name: s.name, type: s.type, pipeline_name: p.name })
    }
  }

  // Наш pipeline_stages
  const { data: pipeline } = await sb
    .from('pipelines')
    .select('id, code, name')
    .eq('clinic_id', CLINIC_ID)
    .eq('code', PIPELINE_CODE)
    .single()
  if (!pipeline) die(`pipeline code='${PIPELINE_CODE}' не найдена в clinic ${CLINIC_ID}`)

  const { data: stages } = await sb
    .from('pipeline_stages')
    .select('id, code, name, stage_role, sort_order')
    .eq('pipeline_id', pipeline.id)
    .order('sort_order')
  if (!stages?.length) die(`Нет стадий в pipeline ${pipeline.id}`)

  const stageByLowerName = new Map(stages.map(s => [s.name.toLowerCase().trim(), s]))
  const firstNormal = stages.find(s => s.stage_role === 'normal') ?? stages[0]
  const wonStage    = stages.find(s => s.stage_role === 'won')
  const lostStage   = stages.find(s => s.stage_role === 'lost')

  // Резолвер: amoCRM status → stage_id нашей воронки
  function resolveStage(amoStatusId) {
    const amo = statusById.get(amoStatusId)
    if (!amo) return firstNormal
    // amoCRM системные: 142 = успешно, 143 = закрыто и не реализовано
    if (amoStatusId === 142 && wonStage)  return wonStage
    if (amoStatusId === 143 && lostStage) return lostStage
    const matched = stageByLowerName.get(amo.name.toLowerCase().trim())
    if (matched) return matched
    log(`⚠ статус amoCRM "${amo.name}" не найден в воронке — fallback ${firstNormal.name}`)
    return firstNormal
  }

  return { pipeline, resolveStage }
}

// ── 2. Patient resolver (find by phone or create stub) ───────────────────────
const patientCache = new Map() // normalized_phone → patient_id

async function resolvePatient(phone, fallbackName) {
  if (!phone) return null
  const norm = normalizePhone(phone)
  if (!norm) return null
  if (patientCache.has(norm)) return patientCache.get(norm)

  const { data: existing } = await sb
    .from('patients')
    .select('id, phones')
    .eq('clinic_id', CLINIC_ID)
    .contains('phones', [norm])
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle()

  if (existing) {
    patientCache.set(norm, existing.id)
    return existing.id
  }

  if (DRY_RUN) {
    patientCache.set(norm, '<dry-run-new>')
    return '<dry-run-new>'
  }

  // Создаём минимального стаба — менеджер дозаполнит при первом контакте
  const [first, ...rest] = (fallbackName || 'Импорт amoCRM').trim().split(/\s+/)
  const { data: created, error } = await sb
    .from('patients')
    .insert({
      clinic_id: CLINIC_ID,
      first_name: first || 'Импорт',
      last_name:  rest.join(' ') || 'amoCRM',
      phones:     [norm],
      notes:      'Импортирован из amoCRM (стаб). Дозаполнить ФИО/ИИН.',
    })
    .select('id')
    .single()
  if (error) throw new Error(`patient create: ${error.message}`)
  patientCache.set(norm, created.id)
  return created.id
}

// ── 3. Leads import ──────────────────────────────────────────────────────────
async function importLeads({ pipeline, resolveStage }) {
  let page = 1, imported = 0, updated = 0, skipped = 0, total = 0
  while (imported + updated + skipped < LIMIT) {
    const data = await amoFetch('/leads', { page, limit: 250, with: 'contacts' })
    const leads = data?._embedded?.leads ?? []
    if (!leads.length) break

    for (const lead of leads) {
      if (imported + updated + skipped >= LIMIT) break
      total++
      const externalId = `amo:${lead.id}`

      // primary contact phone
      const contactRef = lead?._embedded?.contacts?.find(c => c.is_main) || lead?._embedded?.contacts?.[0]
      let phone = null, contactName = null
      if (contactRef?.id) {
        const contact = await amoFetch(`/contacts/${contactRef.id}`)
        contactName = contact?.name
        for (const f of contact?.custom_fields_values ?? []) {
          if (f.field_code === 'PHONE') {
            phone = f.values?.[0]?.value
            break
          }
        }
      }

      const patientId = await resolvePatient(phone, contactName)
      const stage     = resolveStage(lead.status_id)
      const status    = stage.stage_role === 'won'  ? 'won'
                      : stage.stage_role === 'lost' ? 'lost' : 'open'

      const payload = {
        clinic_id:     CLINIC_ID,
        external_id:   externalId,
        pipeline_id:   pipeline.id,
        stage_id:      stage.id,
        stage:         stage.code,
        funnel:        PIPELINE_CODE === 'leads' ? 'leads' : 'medical',
        patient_id:    patientId,
        contact_phone: normalizePhone(phone),
        name:          lead.name || `Сделка #${lead.id}`,
        amount:        lead.price || null,
        status,
        created_at:    lead.created_at ? new Date(lead.created_at * 1000).toISOString() : undefined,
      }

      if (DRY_RUN) {
        log(`DRY ${externalId} → "${stage.name}" (${stage.code}) phone=${phone || '—'}`)
        imported++
        continue
      }

      // upsert по external_id (уник. индекс из мигр. 080)
      const { data: existing } = await sb
        .from('deals')
        .select('id')
        .eq('clinic_id', CLINIC_ID)
        .eq('external_id', externalId)
        .maybeSingle()

      if (existing) {
        const { error } = await sb.from('deals')
          .update({
            pipeline_id: payload.pipeline_id,
            stage_id:    payload.stage_id,
            stage:       payload.stage,
            name:        payload.name,
            amount:      payload.amount,
            // status НЕ обновляем — мог уже руками изменить менеджер
          })
          .eq('id', existing.id)
        if (error) { log(`✕ update ${externalId}: ${error.message}`); skipped++; continue }
        updated++
        if (WITH_NOTES) await importNotes(lead.id, existing.id)
      } else {
        const { data: created, error } = await sb
          .from('deals')
          .insert(payload)
          .select('id')
          .single()
        if (error) { log(`✕ insert ${externalId}: ${error.message}`); skipped++; continue }
        imported++
        if (WITH_NOTES) await importNotes(lead.id, created.id)
      }

      if (total % 50 === 0) log(`progress: ${imported} new / ${updated} updated / ${skipped} skipped`)
    }

    if (leads.length < 250) break
    page++
  }
  return { imported, updated, skipped, total }
}

// ── 4. Notes → deal_messages ─────────────────────────────────────────────────
async function importNotes(amoLeadId, dealId) {
  let page = 1
  while (true) {
    let data
    try { data = await amoFetch(`/leads/${amoLeadId}/notes`, { page, limit: 250 }) }
    catch { return }
    const notes = data?._embedded?.notes ?? []
    if (!notes.length) return

    for (const n of notes) {
      const externalId = `amo:note:${n.id}`
      // Извлекаем тело: разные note_type имеют разные поля
      const p = n.params || {}
      const body =
        p.text ||
        p.message ||
        p.service ||
        p.link ||
        p.duration ? `[звонок ${p.duration}s]` :
        n.note_type ? `[${n.note_type}]` : ''
      if (!body) continue

      // direction: по умолчанию out; для входящих сообщений (incoming_*) — in
      const direction = /incoming|inbound|in_/i.test(String(n.note_type)) ? 'in' : 'out'

      // Если запись уже есть — пропускаем (уник. индекс channel+external_id)
      if (DRY_RUN) continue
      await sb.from('deal_messages').insert({
        deal_id:     dealId,
        clinic_id:   CLINIC_ID,
        direction,
        channel:     'internal',
        body:        String(body).slice(0, 4000),
        external_id: externalId,
        created_at:  n.created_at ? new Date(n.created_at * 1000).toISOString() : undefined,
      }).then(({ error }) => {
        // Игнорируем дубли
        if (error && !/duplicate|unique/i.test(error.message)) {
          log(`✕ note ${externalId}: ${error.message}`)
        }
      })
    }

    if (notes.length < 250) return
    page++
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  log(`mode: ${DRY_RUN ? 'DRY-RUN' : 'LIVE'}, notes: ${WITH_NOTES ? 'yes' : 'no'}, limit: ${LIMIT}`)
  log(`source: ${AMO}, target clinic: ${CLINIC_ID}, pipeline: ${PIPELINE_CODE}`)

  const maps = await loadPipelineMaps()
  log(`pipeline ${maps.pipeline.id} (${maps.pipeline.name}) — стадии загружены`)

  const stats = await importLeads(maps)
  log('done:', stats)
  log(`patients touched: ${patientCache.size}`)
})().catch(err => { console.error(err); process.exit(1) })
