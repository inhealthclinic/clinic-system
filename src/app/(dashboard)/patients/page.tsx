'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Patient } from '@/types'
import { exportCsv, todayStamp } from '@/lib/export/csv'
import { useIsMobile } from '@/lib/hooks/useIsMobile'

/* ─── MedElement: Print patient card ─────────────────────── */
function printPatientCard(p: Patient) {
  const w = window.open('', '_blank', 'width=600,height=680')
  if (!w) return
  const dob = p.birth_date
    ? new Date(p.birth_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
  const created = new Date(p.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  const balance = p.balance_amount > 0
    ? `+${p.balance_amount.toLocaleString('ru-RU')} ₸ (депозит)`
    : p.debt_amount > 0
    ? `-${p.debt_amount.toLocaleString('ru-RU')} ₸ (долг)`
    : '0 ₸'
  const genderRu = p.gender === 'male' ? 'Мужской' : p.gender === 'female' ? 'Женский' : '—'
  const statusRu = (STATUS_LABEL as Record<string, string>)[p.status] ?? p.status

  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Карточка пациента</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:560px;margin:24px auto;font-size:13px;color:#111}
    .header{display:flex;align-items:center;gap:14px;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #111}
    .avatar{width:52px;height:52px;border-radius:50%;background:#dbeafe;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#1d4ed8;flex-shrink:0}
    h1{font-size:20px;margin:0 0 2px}
    .num{font-size:12px;color:#777}
    .section{margin-bottom:14px}
    .section h3{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#999;border-bottom:1px solid #eee;padding-bottom:4px;margin:0 0 8px}
    .row{display:flex;gap:12px;padding:3px 0}
    .lbl{color:#666;min-width:140px;flex-shrink:0}
    .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;background:#e0f2fe;color:#0369a1}
    .foot{margin-top:20px;font-size:10px;color:#ccc;border-top:1px dashed #ddd;padding-top:8px;text-align:center}
  </style></head><body>
  <div class="header">
    <div class="avatar">${p.full_name[0]}</div>
    <div><h1>${p.full_name}</h1><div class="num">Карта № ${p.patient_number ?? '—'} &nbsp;·&nbsp; <span class="badge">${statusRu}</span></div></div>
  </div>
  <div class="section">
    <h3>Личные данные</h3>
    <div class="row"><span class="lbl">Дата рождения</span><span>${dob}</span></div>
    <div class="row"><span class="lbl">Пол</span><span>${genderRu}</span></div>
    <div class="row"><span class="lbl">ИИН</span><span>${p.iin ?? '—'}</span></div>
  </div>
  <div class="section">
    <h3>Контакты</h3>
    <div class="row"><span class="lbl">Телефоны</span><span>${(p.phones ?? []).join(', ') || '—'}</span></div>
    <div class="row"><span class="lbl">Email</span><span>${p.email ?? '—'}</span></div>
    <div class="row"><span class="lbl">Город</span><span>${p.city ?? '—'}</span></div>
  </div>
  <div class="section">
    <h3>Финансы</h3>
    <div class="row"><span class="lbl">Баланс / долг</span><span>${balance}</span></div>
  </div>
  ${p.notes ? `<div class="section"><h3>Примечания</h3><p style="margin:0;color:#444">${p.notes}</p></div>` : ''}
  <div class="section">
    <h3>Дата регистрации</h3>
    <div class="row"><span class="lbl">Зарегистрирован</span><span>${created}</span></div>
  </div>
  <div class="foot">Сформировано: ${new Date().toLocaleString('ru-RU')} &nbsp;·&nbsp; IN HEALTH Медицинский центр</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`)
  w.document.close()
}

const STATUS_LABEL: Record<string, string> = {
  new:          'Новый',
  active:       'Активный',
  in_treatment: 'На лечении',
  completed:    'Завершён',
  lost:         'Потерян',
  vip:          'VIP',
}

const STATUS_COLOR: Record<string, string> = {
  new:          'bg-gray-100 text-gray-600',
  active:       'bg-blue-100 text-blue-700',
  in_treatment: 'bg-green-100 text-green-700',
  completed:    'bg-purple-100 text-purple-700',
  lost:         'bg-red-100 text-red-600',
  vip:          'bg-yellow-100 text-yellow-700',
}

type SortKey = 'created_at' | 'full_name' | 'balance_amount'

function calcAge(birthDate: string | null | undefined): string {
  if (!birthDate) return ''
  const diff = Date.now() - new Date(birthDate).getTime()
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000))
  return `${years} л.`
}

export default function PatientsPage() {
  const isMobile = useIsMobile(768)
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [total, setTotal]       = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortKey, setSortKey]   = useState<SortKey>('created_at')
  const [sortAsc, setSortAsc]   = useState(false)

  const load = useCallback(async (q: string, status: string, sort: SortKey, asc: boolean) => {
    setLoading(true)
    const supabase = createClient()
    let query = supabase
      .from('patients')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order(sort, { ascending: asc })
      .limit(50)

    if (q.trim()) {
      // Detect phone-like input
      const cleaned = q.replace(/[\s\-()]/g, '')
      const isPhone = /^[\d+]{4,}$/.test(cleaned)
      if (isPhone) {
        query = query.or(`full_name.ilike.%${q}%,phones.cs.{"${cleaned}"}`)
      } else {
        query = query.ilike('full_name', `%${q}%`)
      }
    }

    if (status !== 'all') {
      query = query.eq('status', status)
    }

    const { data, count } = await query
    setPatients(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search, statusFilter, sortKey, sortAsc), 300)
    return () => clearTimeout(t)
  }, [search, statusFilter, sortKey, sortAsc, load])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(key === 'full_name') }
  }

  const SortBtn = ({ k, label }: { k: SortKey; label: string }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`text-xs px-2 py-1 rounded-md border transition-colors ${
        sortKey === k
          ? 'bg-gray-800 text-white border-gray-800'
          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
      }`}>
      {label} {sortKey === k ? (sortAsc ? '↑' : '↓') : ''}
    </button>
  )

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Пациенты</h2>
          <p className="text-sm text-gray-400">{total} записей</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv(`patients-${todayStamp()}`, patients, [
              { key: 'ФИО',          value: p => p.full_name },
              { key: 'Карта №',      value: p => p.patient_number ?? '' },
              { key: 'Телефоны',     value: p => (p.phones ?? []).join(' / ') },
              { key: 'Email',        value: p => p.email ?? '' },
              { key: 'ИИН',          value: p => p.iin ?? '' },
              { key: 'Дата рождения', value: p => p.birth_date ?? '' },
              { key: 'Пол',          value: p => p.gender === 'male' ? 'М' : p.gender === 'female' ? 'Ж' : '' },
              { key: 'Город',        value: p => p.city ?? '' },
              { key: 'Статус',       value: p => STATUS_LABEL[p.status] ?? p.status },
              { key: 'Баланс, ₸',    value: p => p.balance_amount ?? 0 },
              { key: 'Долг, ₸',      value: p => p.debt_amount ?? 0 },
              { key: 'Создан',       value: p => p.created_at?.slice(0, 10) ?? '' },
            ])}
            disabled={patients.length === 0}
            className="border border-gray-200 hover:bg-gray-50 disabled:opacity-40 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
            title="Экспорт текущей выборки в CSV (откроется в Excel)">
            ⬇ CSV
          </button>
          <Link
            href="/patients/new"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            + Новый пациент
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по имени или телефону…"
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(['all', 'new', 'active', 'in_treatment', 'completed', 'vip', 'lost'] as const).map(s => (
          <button key={s}
            onClick={() => setStatusFilter(s)}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              statusFilter === s
                ? 'bg-gray-800 border-gray-800 text-white'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            ].join(' ')}>
            {s === 'all' ? 'Все' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-gray-400">Сортировка:</span>
        <SortBtn k="created_at" label="По дате" />
        <SortBtn k="full_name"  label="По имени" />
        <SortBtn k="balance_amount" label="По балансу" />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : patients.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {search || statusFilter !== 'all' ? 'Ничего не найдено' : 'Пациентов пока нет'}
          </div>
        ) : isMobile ? (
          /* ── МОБИЛЬНЫЕ карточки (< 768px) ── */
          <div className="divide-y divide-gray-50">
            {patients.map(p => (
              <Link
                key={p.id}
                href={`/patients/${p.id}`}
                className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors min-h-[72px]"
              >
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0 mt-0.5">
                  {p.full_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-medium text-gray-900 truncate">{p.full_name}</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.phones[0] && (
                    <p className="text-sm text-gray-500 mt-0.5">{p.phones[0]}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5">
                    {p.birth_date && (
                      <span className="text-xs text-gray-400">{calcAge(p.birth_date)}</span>
                    )}
                    {p.balance_amount > 0 && (
                      <span className="text-xs text-green-600 font-medium">+{p.balance_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.debt_amount > 0 && (
                      <span className="text-xs text-red-500 font-medium">−{p.debt_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          /* ── ДЕСКТОП таблица (>= 768px) — не трогать ── */
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Пациент</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Телефон</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Статус</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Баланс</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">Карта</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {patients.map(p => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <Link href={`/patients/${p.id}`} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs flex-shrink-0">
                        {p.full_name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 hover:text-blue-600">{p.full_name}</p>
                        <p className="text-xs text-gray-400">
                          {calcAge(p.birth_date)}
                          {p.birth_date && p.gender ? ' · ' : ''}
                          {p.gender === 'male' ? '♂' : p.gender === 'female' ? '♀' : ''}
                        </p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-4">
                    {p.phones[0] ? (
                      <a href={`tel:${p.phones[0]}`}
                        className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
                        onClick={e => e.stopPropagation()}>
                        {p.phones[0]}
                      </a>
                    ) : <span className="text-sm text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm">
                    {p.balance_amount > 0 && (
                      <span className="text-green-600 font-medium">+{p.balance_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.debt_amount > 0 && (
                      <span className="text-red-500 font-medium">−{p.debt_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.balance_amount === 0 && p.debt_amount === 0 && <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-400 font-mono">{p.patient_number ?? '—'}</td>
                  <td className="px-5 py-4">
                    <button
                      onClick={() => printPatientCard(p)}
                      title="Печать карточки пациента"
                      className="text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors">
                      📄 Карточка
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
