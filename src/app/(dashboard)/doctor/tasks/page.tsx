'use client'

/**
 * /doctor/tasks — Inbox врача.
 * Собирает в одну страницу всё, что требует реакции врача:
 *   · Открытые/неподписанные визиты
 *   · Готовые анализы по моим пациентам (за последние 14 дней)
 *   · Просроченные контроли (control_date <= сегодня, без нового визита)
 *   · Личные задачи (tasks assigned_to = me)
 */

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type DoctorOpt = { id: string; first_name: string; last_name: string }

type OpenVisit = {
  id: string
  patient_name: string
  patient_id: string
  started_at: string
  status: string
}

type LabReady = {
  order_id: string
  order_number: string
  patient_id: string
  patient_name: string
  ready_at: string
  critical: boolean
}

type Control = {
  patient_id: string
  patient_name: string
  control_date: string
  diagnosis_text: string | null
  icd10_code: string | null
}

type TaskRow = {
  id: string
  title: string
  description: string | null
  due_at: string | null
  status: string
  priority: string | null
  patient_id: string | null
  patient_name: string | null
}

export default function DoctorInboxPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [isOwnDoctor, setIsOwnDoctor] = useState(false)
  const [allDoctors, setAllDoctors] = useState<DoctorOpt[]>([])

  const [openVisits, setOpenVisits] = useState<OpenVisit[]>([])
  const [labReady, setLabReady] = useState<LabReady[]>([])
  const [controls, setControls] = useState<Control[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.clinic_id || !profile.id) return
    ;(async () => {
      const [ownRes, allRes] = await Promise.all([
        supabase.from('doctors').select('id')
          .eq('user_id', profile.id).eq('clinic_id', profile.clinic_id).maybeSingle(),
        supabase.from('doctors').select('id, first_name, last_name')
          .eq('clinic_id', profile.clinic_id).eq('is_active', true).order('last_name'),
      ])
      const own = (ownRes.data as { id: string } | null)?.id ?? null
      setIsOwnDoctor(!!own)
      setAllDoctors((allRes.data ?? []) as DoctorOpt[])
      setDoctorId(own ?? (allRes.data?.[0]?.id ?? null))
    })()
  }, [supabase, profile?.id, profile?.clinic_id])

  const load = useCallback(async () => {
    if (!profile?.clinic_id || !doctorId) return
    setLoading(true)
    const dId = doctorId
    const today = new Date().toISOString().slice(0, 10)
    const d14ago = new Date(Date.now() - 14 * 864e5).toISOString()

    const [visitsRes, labRes, ctrlRes, tasksRes] = await Promise.all([
      // Открытые визиты врача
      supabase.from('visits')
        .select(`id, status, started_at, patient:patients(id, full_name)`)
        .eq('clinic_id', profile.clinic_id)
        .eq('doctor_id', dId)
        .in('status', ['open', 'in_progress'])
        .order('started_at', { ascending: true })
        .limit(50),

      // Готовые анализы моих пациентов
      supabase.from('lab_orders')
        .select(`id, order_number, status, updated_at,
                 patient:patients(id, full_name),
                 results:lab_results(flag)`)
        .eq('clinic_id', profile.clinic_id)
        .eq('doctor_id', dId)
        .in('status', ['ready', 'verified'])
        .gte('updated_at', d14ago)
        .order('updated_at', { ascending: false })
        .limit(50),

      // Просроченные контроли: медзаписи, где control_date прошёл
      supabase.from('medical_records')
        .select(`patient_id, control_date, diagnosis_text, icd10_code,
                 patient:patients(id, full_name)`)
        .eq('clinic_id', profile.clinic_id)
        .eq('doctor_id', dId)
        .not('control_date', 'is', null)
        .lte('control_date', today)
        .order('control_date', { ascending: false })
        .limit(200),

      // Задачи мне (по user_id профиля — не doctor_id)
      profile?.id ? supabase.from('tasks')
        .select(`id, title, description, due_at, status, priority,
                 patient:patients(id, full_name)`)
        .eq('clinic_id', profile.clinic_id)
        .eq('assigned_to', profile.id)
        .in('status', ['new', 'in_progress', 'overdue'])
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(50) : Promise.resolve({ data: [] }),
    ])

    setOpenVisits(((visitsRes.data ?? []) as any[]).map(v => ({
      id: v.id,
      patient_id: v.patient?.id ?? '',
      patient_name: v.patient?.full_name ?? '—',
      started_at: v.started_at,
      status: v.status,
    })))

    setLabReady(((labRes.data ?? []) as any[]).map(o => ({
      order_id: o.id,
      order_number: o.order_number,
      patient_id: o.patient?.id ?? '',
      patient_name: o.patient?.full_name ?? '—',
      ready_at: o.updated_at,
      critical: (o.results ?? []).some((r: { flag: string }) => r.flag === 'critical'),
    })))

    // Группируем контроли: один на пациента (самый свежий просроченный)
    const ctrlMap = new Map<string, Control>()
    for (const r of (ctrlRes.data ?? []) as any[]) {
      if (!r.patient) continue
      const ex = ctrlMap.get(r.patient_id)
      if (!ex || r.control_date > ex.control_date) {
        ctrlMap.set(r.patient_id, {
          patient_id: r.patient_id,
          patient_name: r.patient.full_name,
          control_date: r.control_date,
          diagnosis_text: r.diagnosis_text,
          icd10_code: r.icd10_code,
        })
      }
    }
    setControls(Array.from(ctrlMap.values()).sort((a, b) => a.control_date.localeCompare(b.control_date)))

    setTasks(((tasksRes.data ?? []) as any[]).map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      due_at: t.due_at,
      status: t.status,
      priority: t.priority,
      patient_id: t.patient?.id ?? null,
      patient_name: t.patient?.full_name ?? null,
    })))

    setLoading(false)
  }, [supabase, profile?.clinic_id, profile?.id, doctorId])

  useEffect(() => { if (doctorId) void load() }, [load, doctorId])

  if (!profile) return null

  const totalCount = openVisits.length + labReady.length + controls.length + tasks.length
  const selectedDoctor = allDoctors.find(d => d.id === doctorId)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isOwnDoctor ? 'Входящие' : 'Входящие врача'}
          </h1>
          <p className="text-xs text-gray-500">
            {totalCount} задач
            {!isOwnDoctor && selectedDoctor && <> · {selectedDoctor.last_name} {selectedDoctor.first_name}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isOwnDoctor && allDoctors.length > 1 && (
            <select value={doctorId ?? ''} onChange={e => setDoctorId(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {allDoctors.map(d => (
                <option key={d.id} value={d.id}>{d.last_name} {d.first_name}</option>
              ))}
            </select>
          )}
          <button onClick={load}
            className="px-3 py-2 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-sm">↻</button>
          <Link href="/doctor" className="text-sm text-blue-600 hover:text-blue-800">← Мой день</Link>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

      {!loading && totalCount === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center">
          <p className="text-sm text-gray-400">🎉 Входящие пусты — всё обработано.</p>
        </div>
      )}

      {!loading && openVisits.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <header className="px-4 py-3 bg-red-50 border-b border-red-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-red-900">
              🔴 Открытые визиты · {openVisits.length}
            </h2>
            <span className="text-xs text-red-600">требуют закрытия</span>
          </header>
          <div className="divide-y divide-gray-50">
            {openVisits.map(v => (
              <Link key={v.id} href={`/visits/${v.id}`}
                className="block px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 truncate">{v.patient_name}</p>
                  <p className="text-xs text-gray-400">
                    Начат: {new Date(v.started_at).toLocaleString('ru-RU', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
                <span className="text-xs text-blue-600 whitespace-nowrap">Открыть →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && labReady.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <header className="px-4 py-3 bg-green-50 border-b border-green-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-green-900">
              🧪 Готовые анализы · {labReady.length}
            </h2>
            <span className="text-xs text-green-700">за 14 дней</span>
          </header>
          <div className="divide-y divide-gray-50">
            {labReady.map(l => (
              <Link key={l.order_id} href={`/patients/${l.patient_id}/lab`}
                className="block px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-900 truncate">{l.patient_name}</span>
                    {l.critical && (
                      <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">КРИТИЧНО</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 font-mono">{l.order_number} · {new Date(l.ready_at).toLocaleDateString('ru-RU')}</p>
                </div>
                <span className="text-xs text-blue-600 whitespace-nowrap">Открыть →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && controls.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <header className="px-4 py-3 bg-orange-50 border-b border-orange-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-orange-900">
              ⏰ Просроченные контроли · {controls.length}
            </h2>
          </header>
          <div className="divide-y divide-gray-50">
            {controls.map(c => {
              const daysOverdue = Math.floor(
                (Date.now() - new Date(c.control_date + 'T12:00:00').getTime()) / 864e5
              )
              return (
                <Link key={c.patient_id} href={`/patients/${c.patient_id}`}
                  className="block px-4 py-3 hover:bg-gray-50 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-900 truncate">{c.patient_name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {c.icd10_code && <span className="font-mono text-blue-600 mr-1">{c.icd10_code}</span>}
                      {c.diagnosis_text ?? '—'}
                    </p>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <p className="text-xs font-medium text-orange-700">
                      {daysOverdue === 0 ? 'сегодня' : `${daysOverdue} дн. назад`}
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {new Date(c.control_date + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {!loading && tasks.length > 0 && (
        <section className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <header className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-blue-900">
              📋 Мои задачи · {tasks.length}
            </h2>
            <Link href="/tasks" className="text-xs text-blue-700 hover:underline">все задачи →</Link>
          </header>
          <div className="divide-y divide-gray-50">
            {tasks.map(t => {
              const overdue = t.due_at && new Date(t.due_at) < new Date()
              return (
                <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-gray-900">{t.title}</span>
                      {(t.priority === 'high' || t.priority === 'urgent') && (
                        <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 rounded">!</span>
                      )}
                      {t.patient_name && t.patient_id && (
                        <Link href={`/patients/${t.patient_id}`}
                          className="text-xs text-blue-600 hover:underline truncate">
                          · {t.patient_name}
                        </Link>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{t.description}</p>
                    )}
                  </div>
                  {t.due_at && (
                    <span className={`text-xs whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {new Date(t.due_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
