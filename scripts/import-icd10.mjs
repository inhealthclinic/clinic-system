#!/usr/bin/env node
// Импорт МКБ-10 (ICD-10) на русском в таблицу icd10_codes.
// Источник: KindYAK/mkb-10-parsed на GitHub (~12к кодов).
//
// Запуск:
//   node --env-file=.env.local scripts/import-icd10.mjs
//
// Требует: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// Источник: https://cdn.jsdelivr.net/gh/KindYAK/mkb-10-parsed@master/mkb-parsed.csv
// Файл предварительно скачан в /tmp/mkb.csv через curl.
const CSV_PATH = process.env.ICD_CSV_PATH || '/tmp/mkb.csv'

// Простой CSV-парсер: понимает "a,b" поля с запятыми и удвоенные кавычки.
function parseCsvLine(line) {
  const out = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = false
      } else cur += c
    } else {
      if (c === ',') { out.push(cur); cur = '' }
      else if (c === '"') inQ = true
      else cur += c
    }
  }
  out.push(cur)
  return out
}

async function main() {
  console.log(`1/4  Читаю ${CSV_PATH}…`)
  const text = await readFile(CSV_PATH, 'utf-8')
  console.log(`     ${(text.length / 1024).toFixed(1)} KB`)

  console.log('2/4  Парсю…')
  const lines = text.split('\n').filter(l => l.trim())
  lines.shift() // header: ,code,name,parent,level
  const rows = []
  for (const line of lines) {
    const [, code, name, parent, levelStr] = parseCsvLine(line)
    if (!code || !name) continue
    rows.push({ code: code.trim(), name: name.trim(), parent: parent.trim(), level: Number(levelStr) })
  }
  console.log(`     ${rows.length} строк`)

  // Индекс для поиска родителя
  const byCode = new Map(rows.map(r => [r.code, r]))

  // Находим блок (level=1) по родительской цепочке
  function findBlock(row) {
    let cur = row
    let steps = 0
    while (cur && cur.level > 1 && steps < 10) {
      cur = byCode.get(cur.parent)
      steps++
    }
    return cur && cur.level === 1 ? cur.code : null
  }

  const toInsert = rows
    .filter(r => r.level >= 2) // только 3-значные и 4-значные коды (без range-глав и блоков)
    .map(r => ({ code: r.code, name: r.name, block: findBlock(r) }))

  console.log(`3/4  К вставке: ${toInsert.length} (пропущены главы/блоки как диапазоны)`)

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('4/4  Заливаю в icd10_codes пачками по 1000…')
  const BATCH = 1000
  let done = 0
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH)
    const { error } = await sb.from('icd10_codes').upsert(chunk, { onConflict: 'code' })
    if (error) {
      console.error(`     ❌ batch ${i}-${i + chunk.length}:`, error.message)
      process.exit(1)
    }
    done += chunk.length
    process.stdout.write(`\r     ${done}/${toInsert.length}`)
  }
  console.log('\n✅ Готово.')

  // Проверка
  const { count } = await sb.from('icd10_codes').select('*', { count: 'exact', head: true })
  console.log(`В таблице icd10_codes теперь: ${count} строк`)
}

main().catch(e => { console.error(e); process.exit(1) })
