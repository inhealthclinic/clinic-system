#!/usr/bin/env node
/**
 * amocrm-list-users.mjs — выгружает всех пользователей amoCRM в CSV.
 *
 * Для подготовки маппинга `amocrm-user-map.json` перед запуском
 * import-amocrm.mjs --users-map=...
 *
 * Использование:
 *   AMOCRM_SUBDOMAIN=mycompany \
 *   AMOCRM_TOKEN=eyJ... \
 *   node scripts/amocrm-list-users.mjs > scripts/amocrm-users.csv
 *
 * Результат — три колонки:
 *   amo_id;name;email
 *
 * Дальше: открой CSV, рядом — наши user_profiles
 *   (SQL: SELECT id, first_name, last_name, email FROM user_profiles
 *         WHERE clinic_id = '<твой>' AND is_active = true;)
 *   и сложи в JSON-карту:
 *   {
 *     "12345": "uuid-Анвара",
 *     "12346": "uuid-Айгерим"
 *   }
 */

const AMOCRM_SUBDOMAIN = process.env.AMOCRM_SUBDOMAIN
const AMOCRM_TOKEN     = process.env.AMOCRM_TOKEN

if (!AMOCRM_SUBDOMAIN || !AMOCRM_TOKEN) {
  console.error('ERR: AMOCRM_SUBDOMAIN и AMOCRM_TOKEN обязательны')
  process.exit(1)
}

const AMO = `https://${AMOCRM_SUBDOMAIN}.amocrm.ru/api/v4`

async function amoFetch(path, params = {}) {
  const url = new URL(AMO + path)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AMOCRM_TOKEN}` } })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`amoCRM ${res.status} ${path}: ${txt.slice(0, 200)}`)
  }
  return res.json()
}

;(async () => {
  // CSV header в stderr (чтобы можно было пайпать stdout в файл и не мешать)
  console.error('Загружаем пользователей amoCRM...')
  console.log('amo_id;name;email')

  let page = 1
  let total = 0
  while (true) {
    const data = await amoFetch('/users', { page, limit: 250 })
    const users = data?._embedded?.users ?? []
    if (!users.length) break

    for (const u of users) {
      const name  = (u.name || '').replace(/;/g, ',')
      const email = (u.email || '').replace(/;/g, ',')
      console.log(`${u.id};${name};${email}`)
      total++
    }

    if (users.length < 250) break
    page++
  }

  console.error(`\nГотово: ${total} пользователей.`)
  console.error('Подсказка для маппинга нашими user_profiles:')
  console.error("  SELECT id, first_name, last_name, email FROM user_profiles")
  console.error("   WHERE clinic_id = '<твой clinic_id>' AND is_active = true;")
})().catch(err => { console.error(err); process.exit(1) })
