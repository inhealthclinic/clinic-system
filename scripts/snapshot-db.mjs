#!/usr/bin/env node
/**
 * snapshot-db.mjs — ручной снапшот данных перед переездом с amoCRM.
 *
 * Зачем: Supabase Free tier делает auto-backup раз в сутки и хранит
 * 7 дней, восстановление — только через dashboard. Этот скрипт даёт
 * локальный JSON-дамп ключевых таблиц «прямо сейчас», чтобы можно
 * было откатить выборочно (например, восстановить deals из snapshot
 * после неудачного импорта amoCRM).
 *
 * Использование:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   node scripts/snapshot-db.mjs > snapshots/$(date +%Y%m%d-%H%M).json
 *
 * Не дампит: storage, auth.users (используйте dashboard backup).
 * Дампит: clinics, deals, deal_messages, deal_events, patients,
 *         appointments, visits, charges, payments, lab_orders,
 *         pipelines, pipeline_stages, user_profiles, roles.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY обязательны')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

const TABLES = [
  'clinics', 'roles', 'user_profiles',
  'patients', 'doctors', 'specializations',
  'pipelines', 'pipeline_stages', 'deal_field_configs',
  'deals', 'deal_messages', 'deal_events',
  'appointments', 'visits',
  'services', 'service_packages', 'patient_packages',
  'charges', 'payments', 'patient_balance',
  'lab_orders', 'lab_results',
  'tasks', 'crm_interactions',
  'message_templates', 'notification_templates', 'notifications_log',
]

const out = { taken_at: new Date().toISOString(), tables: {} }

for (const t of TABLES) {
  process.stderr.write(`→ ${t} ... `)
  let all = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await sb.from(t).select('*').range(from, from + pageSize - 1)
    if (error) {
      process.stderr.write(`ERR ${error.message}\n`)
      out.tables[t] = { error: error.message }
      break
    }
    all = all.concat(data ?? [])
    if (!data || data.length < pageSize) break
    from += pageSize
  }
  if (!out.tables[t]) {
    out.tables[t] = { rows: all.length, data: all }
    process.stderr.write(`${all.length} rows\n`)
  }
}

process.stdout.write(JSON.stringify(out, null, 2))
process.stderr.write('\n✓ snapshot complete\n')
