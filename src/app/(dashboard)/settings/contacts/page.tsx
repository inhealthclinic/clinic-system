'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type ContactType = 'patient' | 'lead'

interface UnifiedContact {
  id: string
  type: ContactType
  name: string
  phone: string
  city: string | null
  tags: string[]
  created_at: string
  source_id?: string | null // deal id or patient id
}

interface CsvRow {
  name: string
  phone: string
  tags: string[]
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.startsWith('8') ? '7' + digits.slice(1) : digits
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(cur); cur = ''
    } else { cur += ch }
  }
  result.push(cur)
  return result
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split('\n')
  if (lines.length < 2) return []
  const header = parseCsvLine(lines[0])
  const idx = {
    firstName:   header.findIndex(h => h === 'Имя'),
    lastName:    header.findIndex(h => h === 'Фамилия'),
    fullName:    header.findIndex(h => h === 'Полное имя контакта'),
    workPhone:   header.findIndex(h => h === 'Рабочий телефон'),
    mobilePhone: header.findIndex(h => h === 'Мобильный телефон'),
    tags:        header.findIndex(h => h === 'Теги'),
  }
  const result: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = parseCsvLine(line)
    const rawPhone =
      (idx.mobilePhone >= 0 ? cols[idx.mobilePhone] : '') ||
      (idx.workPhone >= 0 ? cols[idx.workPhone] : '') || ''
    const phone = normalizePhone(rawPhone.replace(/^'+/, ''))
    if (!phone || phone.length < 10) continue
    let name = ''
    const fn = idx.firstName >= 0 ? cols[idx.firstName]?.trim() : ''
    const ln = idx.lastName >= 0 ? cols[idx.lastName]?.trim() : ''
    if (fn || ln) {
      name = [fn, ln].filter(Boolean).join(' ')
    } else {
      const full = idx.fullName >= 0 ? cols[idx.fullName]?.trim() : ''
      if (full && !/^['+\d\s\-()]+$/.test(full)) name = full
    }
    const rawTags = idx.tags >= 0 ? cols[idx.tags]?.trim() : ''
    const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : []
    result.push({ name, phone, tags })
  }
  return result
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export default function ContactsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id

  const [contacts, setContacts] = useState<UnifiedContact[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | ContactType>('all')
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)

  // import
  const [showImport, setShowImport]         = useState(false)
  const [csvRows, setCsvRows]               = useState<CsvRow[]>([])
  const [importing, setImporting]           = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importDone, setImportDone]         = useState(false)
  const [importCreated, setImportCreated]   = useState(0)
  const [importSkipped, setImportSkipped]   = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)

    const from = page * PAGE_SIZE
    const to   = from + PAGE_SIZE - 1

    if (typeFilter === 'patient') {
      // ── только пациенты ─────────────────────────────────────────────────
      let q = supabase
        .from('patients')
        .select('id, full_name, phones, city, created_at', { count: 'exact' })
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (search) q = q.or(`full_name.ilike.%${search}%`)
      const { data, count } = await q
      setTotal(count ?? 0)
      setContacts((data ?? []).map((p: { id: string; full_name: string | null; phones: string[] | null; city: string | null; created_at: string }) => ({
        id: `p_${p.id}`, type: 'patient' as ContactType,
        name: p.full_name ?? '', phone: (p.phones?.[0] ?? '').replace(/\D/g, ''),
        city: p.city ?? null, tags: [], created_at: p.created_at, source_id: p.id,
      })))
      setLoading(false)
      return
    }

    if (typeFilter === 'lead') {
      // ── только лиды ─────────────────────────────────────────────────────
      let q = supabase
        .from('deals')
        .select('id, name, contact_phone, contact_city, tags, created_at', { count: 'exact' })
        .eq('clinic_id', clinicId)
        .is('deleted_at', null)
        .not('contact_phone', 'is', null)
        .order('created_at', { ascending: false })
        .range(from, to)
      if (search) q = q.or(`name.ilike.%${search}%,contact_phone.ilike.%${search}%`)
      const { data, count } = await q
      setTotal(count ?? 0)
      setContacts((data ?? []).map((d: { id: string; name: string | null; contact_phone: string | null; contact_city: string | null; tags: string[] | null; created_at: string }) => ({
        id: `d_${d.id}`, type: 'lead' as ContactType,
        name: d.name ?? '', phone: (d.contact_phone ?? '').replace(/\D/g, ''),
        city: d.contact_city ?? null, tags: d.tags ?? [], created_at: d.created_at, source_id: d.id,
      })))
      setLoading(false)
      return
    }

    // ── все: patients + deals, дедупликация по телефону ──────────────────
    // Пациенты приоритетнее — тянем всех (обычно немного)
    const { data: patients } = await supabase
      .from('patients')
      .select('id, full_name, phones, city, created_at')
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .limit(5000)

    // Сделки — с поиском и offset
    let dq = supabase
      .from('deals')
      .select('id, name, contact_phone, contact_city, tags, created_at', { count: 'exact' })
      .eq('clinic_id', clinicId)
      .is('deleted_at', null)
      .not('contact_phone', 'is', null)
      .order('created_at', { ascending: false })
    if (search) dq = dq.or(`name.ilike.%${search}%,contact_phone.ilike.%${search}%`)

    // Получаем всю страницу сделок + общий count
    const { data: dealsPage, count: dealsCount } = await dq.range(from, to)

    // build unified list, deduplicate by normalized phone
    const seen = new Set<string>()
    const all: UnifiedContact[] = []

    // patients first (higher priority)
    for (const p of patients ?? []) {
      const phone = (p.phones?.[0] ?? '').replace(/\D/g, '')
      if (!phone) continue
      if (seen.has(phone)) continue
      seen.add(phone)
      all.push({
        id: `p_${p.id}`,
        type: 'patient',
        name: p.full_name ?? '',
        phone,
        city: p.city ?? null,
        tags: [],
        created_at: p.created_at,
        source_id: p.id,
      })
    }

    // leads (deals)
    for (const d of dealsPage ?? []) {
      const phone = (d.contact_phone ?? '').replace(/\D/g, '')
      if (!phone) continue
      if (seen.has(phone)) continue
      seen.add(phone)
      all.push({
        id: `d_${d.id}`,
        type: 'lead',
        name: d.name ?? '',
        phone,
        city: d.contact_city ?? null,
        tags: d.tags ?? [],
        created_at: d.created_at,
        source_id: d.id,
      })
    }

    // Для режима "Все" показываем текущую страницу сделок + пациентов
    // (пациенты уже в памяти). Общий total = пациенты + сделки.
    const patientContacts = all.filter(c => c.type === 'patient')
    const dealContacts    = all.filter(c => c.type === 'lead')
    setTotal((patients?.length ?? 0) + (dealsCount ?? 0))
    // Показываем на странице: сначала пациенты (их мало), потом сделки
    const combined = [...patientContacts, ...dealContacts]
    setContacts(combined)
    setLoading(false)
  }, [clinicId, supabase, search, typeFilter, page])

  useEffect(() => { load() }, [load])

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setCsvRows(parseCsv(text))
    }
    reader.readAsText(file, 'utf-8')
  }

  async function runImport() {
    if (!clinicId || !csvRows.length) return
    setImporting(true)
    setImportProgress(0)
    setImportCreated(0)
    setImportSkipped(0)

    // first pipeline + first stage
    const { data: pipelineRows } = await supabase
      .from('pipelines').select('id').eq('clinic_id', clinicId).eq('is_active', true).order('sort_order').limit(1)
    const pipelineId = pipelineRows?.[0]?.id ?? null
    let firstStageId: string | null = null
    if (pipelineId) {
      const { data: stageRows } = await supabase
        .from('pipeline_stages').select('id').eq('pipeline_id', pipelineId).order('sort_order').limit(1)
      firstStageId = stageRows?.[0]?.id ?? null
    }

    // collect all existing phones (deals + patients) — limit 50k чтобы не упереться в дефолт PostgREST
    const [{ data: existingDeals }, { data: existingPatients }] = await Promise.all([
      supabase.from('deals').select('contact_phone').eq('clinic_id', clinicId).is('deleted_at', null).not('contact_phone', 'is', null).limit(50000),
      supabase.from('patients').select('phones').eq('clinic_id', clinicId).is('deleted_at', null).limit(50000),
    ])
    const existingPhones = new Set<string>()
    for (const d of existingDeals ?? []) existingPhones.add((d.contact_phone ?? '').replace(/\D/g, ''))
    for (const p of existingPatients ?? []) {
      for (const ph of (p.phones ?? []) as string[]) existingPhones.add(ph.replace(/\D/g, ''))
    }

    const BATCH = 50
    let created = 0, skipped = 0

    for (let i = 0; i < csvRows.length; i += BATCH) {
      const batch = csvRows.slice(i, i + BATCH)
      const toInsert = batch
        .filter(r => !existingPhones.has(r.phone))
        .map(r => ({
          clinic_id: clinicId,
          pipeline_id: pipelineId,
          stage_id: firstStageId,
          name: r.name || `+${r.phone}`,
          contact_phone: r.phone,
          tags: r.tags,
          status: 'open' as const,
          funnel: 'leads',
        }))
      skipped += batch.length - toInsert.length
      if (toInsert.length > 0) {
        await supabase.from('deals').insert(toInsert)
        created += toInsert.length
      }
      setImportProgress(Math.round(((i + BATCH) / csvRows.length) * 100))
      setImportCreated(created)
      setImportSkipped(skipped)
    }

    setImporting(false)
    setImportDone(true)
    load()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Контакты</h1>
          <p className="text-sm text-gray-500 mt-0.5">Единая база: пациенты + лиды CRM, без дубликатов по телефону</p>
        </div>
        <button
          onClick={() => { setShowImport(true); setImportDone(false); setCsvRows([]) }}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          Импорт CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(['all', 'patient', 'lead'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTypeFilter(t); setPage(0) }}
              className={`px-3 py-2 ${typeFilter === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {t === 'all' ? 'Все' : t === 'patient' ? '👤 Пациенты' : '🎯 Лиды'}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-500 whitespace-nowrap">{total.toLocaleString('ru-RU')}</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide w-20">Тип</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Имя</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Телефон</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Город</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Теги</th>
              <th className="text-left py-2 px-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Добавлен</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Загрузка...</td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Нет контактов</td></tr>
            ) : contacts.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="py-2 px-3">
                  {c.type === 'patient' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">👤 Пациент</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 text-xs font-medium">🎯 Лид</span>
                  )}
                </td>
                <td className="py-2 px-3 font-medium text-gray-900">{c.name || '—'}</td>
                <td className="py-2 px-3 text-gray-600 font-mono text-xs">{c.phone}</td>
                <td className="py-2 px-3 text-gray-500">{c.city || '—'}</td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map(t => (
                      <span key={t} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="py-2 px-3 text-gray-400 text-xs">
                  {new Date(c.created_at).toLocaleDateString('ru-RU')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
            ← Назад
          </button>
          <span className="text-sm text-gray-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} из {total.toLocaleString('ru-RU')}
          </span>
          <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">
            Вперёд →
          </button>
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowImport(false) }}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-gray-900">Импорт контактов из amoCRM</h2>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {!importDone ? (
              <>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors mb-4"
                >
                  <svg className="mx-auto mb-2 text-gray-400" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <p className="text-sm text-gray-600">Нажмите чтобы выбрать CSV-файл</p>
                  <p className="text-xs text-gray-400 mt-1">Экспорт контактов из amoCRM</p>
                  <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={onFileChange} />
                </div>

                {csvRows.length > 0 && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                    Найдено <b>{csvRows.length.toLocaleString('ru-RU')}</b> контактов с телефоном.<br/>
                    <span className="text-green-600 text-xs">Дубликаты по номеру (включая пациентов) будут пропущены.</span>
                  </div>
                )}

                {importing && (
                  <div className="mb-4">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Добавлено: {importCreated}, пропущено: {importSkipped}</span>
                      <span>{importProgress}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-2 bg-blue-500 rounded-full transition-all" style={{ width: `${importProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                    Отмена
                  </button>
                  <button onClick={runImport} disabled={!csvRows.length || importing}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                    {importing ? 'Импортируется...' : `Импортировать ${csvRows.length ? csvRows.length.toLocaleString('ru-RU') : ''}`}
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-base font-medium text-gray-900 mb-2">Импорт завершён</p>
                <p className="text-sm text-gray-600">Добавлено лидов: <b className="text-green-700">{importCreated.toLocaleString('ru-RU')}</b></p>
                <p className="text-sm text-gray-600">Пропущено (дубли): <b>{importSkipped.toLocaleString('ru-RU')}</b></p>
                <button onClick={() => setShowImport(false)} className="mt-5 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                  Закрыть
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
