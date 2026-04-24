'use client'

/**
 * /doctor/patients — пациенты, у которых был хотя бы один визит у этого врача.
 * Показывает: ФИО, возраст/пол, последний визит, диагноз, ближайший контроль.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type MyPatient = {
  patient_id: string
  full_name: string
  date_of_birth: string | null
  sex: string | null
  phone: string | null
  last_visit_at: string
  visits_count: number
  last_icd10_code: string | null
  last_diagnosis: string | null
  next_control_date: string | null
}

function ageOf(dob: string | null): string {
  if (!dob) return ''
  const b = new Date(dob), n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  const m = n.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--
  return `${a} л.`
}

export default function MyPatientsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [rows, setRows] = useState<MyPatient[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyControl, setOnlyControl] = useState(false)

  const load = useCallback(async () => {
    if (!profile?.clinic_id || !profile.id) return
    setLoading(true)

    const { data: doc } = await supabase
      .from('doctors').select('id')
      .eq('user_id', profile.id).eq('clinic_id', profile.clinic_id).maybeSingle()
    const dId = (doc as { id: string } | null)?.id ?? null
    setDoctorId(dId)
    if (!dId) { setLoading(false); return }

    // Все медзаписи этого врача — группируем по пациенту
    const { data: recs } = await supabase
      .from('medical_records')
      .select(`
        patient_id, created_at, icd10_code, diagnosis_text, control_date,
        patient:patients(id, full_name, date_of_birth, sex, phone)
      `)
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', dId)
      .order('created_at', { ascending: false })
      .limit(2000)

    const byPatient = new Map<string, MyPatient>()
    const today = new Date().toISOString().slice(0, 10)
    for (const r of recs ?? []) {
      const p = (r as any).patient
      if (!p) continue
      const existing = byPatient.get(r.patient_id)
      if (!existing) {
        byPatient.set(r.patient_id, {
          patient_id: r.patient_id,
          full_name: p.full_name,
          date_of_birth: p.date_of_birth,
          sex: p.sex,
          phone: p.phone,
          last_visit_at: r.created_at,
          visits_count: 1,
          last_icd10_code: r.icd10_code,
          last_diagnosis: r.diagnosis_text,
          next_control_date: (r.control_date && r.control_date >= today) ? r.control_date : null,
        })
      } else {
        existing.visits_count++
        // control_date ближайший из будущих
        if (r.control_date && r.control_date >= today) {
          if (!existing.next_control_date || r.control_date < existing.next_control_date) {
            existing.next_control_date = r.control_date
          }
        }
      }
    }
    setRows(Array.from(byPatient.values()).sort((a, b) => b.last_visit_at.localeCompare(a.last_visit_at)))
    setLoading(false)
  }, [supabase, profile?.id, profile?.clinic_id])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (onlyControl && !r.next_control_date) return false
      if (!q) return true
      return r.full_name.toLowerCase().includes(q)
          || (r.phone ?? '').toLowerCase().includes(q)
          || (r.last_icd10_code ?? '').toLowerCase().includes(q)
          || (r.last_diagnosis ?? '').toLowerCase().includes(q)
    })
  }, [rows, search, onlyControl])

  if (!profile) return null

  if (!loading && !doctorId) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
        <p className="text-sm text-gray-400">
          Ваш профиль не привязан к врачу.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Мои пациенты</h1>
          <p className="text-xs text-gray-500">{rows.length} пациентов · у которых был хотя бы один ваш приём</p>
        </div>
        <Link href="/doctor" className="text-sm text-blue-600 hover:text-blue-800">← Мой день</Link>
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-2 flex-wrap">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Поиск: ФИО, телефон, ICD-10, диагноз"
          className="flex-1 min-w-[240px] border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyControl} onChange={e => setOnlyControl(e.target.checked)} />
          Есть контроль
        </label>
        <button onClick={load}
          className="px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-sm">↻</button>
      </div>

      {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

      {!loading && filtered.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center text-sm text-gray-400">
          {rows.length === 0 ? 'Пациентов пока нет — у вас не было приёмов.' : 'По фильтрам ничего не найдено.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Пациент</th>
                <th className="px-2 py-2 text-left font-semibold">Телефон</th>
                <th className="px-2 py-2 text-left font-semibold">Визитов</th>
                <th className="px-2 py-2 text-left font-semibold">Последний</th>
                <th className="px-2 py-2 text-left font-semibold">Диагноз</th>
                <th className="px-2 py-2 text-left font-semibold">Контроль</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(r => {
                const overdueSoon = r.next_control_date &&
                  new Date(r.next_control_date).getTime() - Date.now() < 3 * 864e5
                return (
                  <tr key={r.patient_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900">{r.full_name}</span>
                        <span className="text-xs text-gray-400">{ageOf(r.date_of_birth)}</span>
                        {r.sex === 'F' && <span className="text-xs text-pink-500">♀</span>}
                        {r.sex === 'M' && <span className="text-xs text-blue-500">♂</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-500 font-mono">{r.phone ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-gray-600">{r.visits_count}</td>
                    <td className="px-2 py-2 text-xs text-gray-500">
                      {new Date(r.last_visit_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    </td>
                    <td className="px-2 py-2 text-xs text-gray-700 max-w-[260px] truncate">
                      {r.last_icd10_code && (
                        <span className="font-mono bg-blue-50 text-blue-700 px-1 rounded mr-1">{r.last_icd10_code}</span>
                      )}
                      {r.last_diagnosis ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.next_control_date ? (
                        <span className={overdueSoon ? 'text-orange-600 font-medium' : 'text-gray-600'}>
                          {new Date(r.next_control_date + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link href={`/patients/${r.patient_id}`}
                        className="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap">
                        Открыть →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
