'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Patient } from '@/types'

/* ─── MedElement: Print patient card (карточка пациента) ─── */
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
  new: 'Новый',
  active: 'Активный',
  in_treatment: 'На лечении',
  completed: 'Завершён',
  lost: 'Потерян',
  vip: 'VIP',
}

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  active: 'bg-blue-100 text-blue-700',
  in_treatment: 'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
  lost: 'bg-red-100 text-red-600',
  vip: 'bg-yellow-100 text-yellow-700',
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [total, setTotal] = useState(0)

  const load = useCallback(async (q: string) => {
    setLoading(true)
    const supabase = createClient()
    let query = supabase
      .from('patients')
      .select('*', { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (q.trim()) {
      query = query.ilike('full_name', `%${q}%`)
    }

    const { data, count } = await query
    setPatients(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => load(search), 300)
    return () => clearTimeout(t)
  }, [search, load])

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Пациенты</h2>
          <p className="text-sm text-gray-400">{total} записей</p>
        </div>
        <Link
          href="/patients/new"
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Новый пациент
        </Link>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по имени или телефону..."
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : patients.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            {search ? 'Ничего не найдено' : 'Пациентов пока нет'}
          </div>
        ) : (
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
              {patients.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <Link href={`/patients/${p.id}`} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs flex-shrink-0">
                        {p.full_name[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 hover:text-blue-600">
                          {p.full_name}
                        </p>
                        {p.birth_date && (
                          <p className="text-xs text-gray-400">
                            {new Date(p.birth_date).toLocaleDateString('ru-RU')}
                          </p>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">{p.phones[0] ?? '—'}</td>
                  <td className="px-5 py-4">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-sm text-gray-600">
                    {p.balance_amount > 0 && (
                      <span className="text-green-600">+{p.balance_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.debt_amount > 0 && (
                      <span className="text-red-500">-{p.debt_amount.toLocaleString('ru-RU')} ₸</span>
                    )}
                    {p.balance_amount === 0 && p.debt_amount === 0 && '—'}
                  </td>
                  <td className="px-5 py-4 text-xs text-gray-400">{p.patient_number ?? '—'}</td>
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
