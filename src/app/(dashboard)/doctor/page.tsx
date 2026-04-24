'use client'

/**
 * /doctor — «Мой день» для врача.
 * Показывает:
 *  - следующего пациента крупной карточкой
 *  - ленту визитов сегодня
 *  - незакрытые визиты (черновики)
 *  - готовые результаты анализов моих пациентов (verified)
 *  - контроли на сегодня
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type TodayAppt = {
  id: string
  time_start: string
  time_end: string
  status: string
  chief_complaint: string | null
  patient_id: string
  patient: { full_name: string; date_of_birth: string | null } | null
  visit_id: string | null
}

type OpenVisit = {
  id: string
  patient_id: string
  started_at: string | null
  patient_name: string | null
}

type LabReady = {
  id: string
  service_name_snapshot: string
  result_value: number | null
  result_text: string | null
  unit_snapshot: string | null
  flag: string | null
  result_date: string
  patient_id: string
  patient_name: string
}

type ControlItem = {
  id: string
  control_date: string
  icd10_code: string | null
  diagnosis_text: string | null
  patient_id: string
  patient_name: string
}

const STATUS_CLR: Record<string, string> = {
  scheduled:   'bg-gray-100 text-gray-600',
  confirmed:   'bg-blue-100 text-blue-700',
  arrived:     'bg-amber-100 text-amber-800',
  in_progress: 'bg-green-100 text-green-700',
  completed:   'bg-gray-100 text-gray-500',
  cancelled:   'bg-red-100 text-red-700',
  no_show:     'bg-red-100 text-red-700',
}
const STATUS_RU: Record<string, string> = {
  scheduled:   'Запланирован',
  confirmed:   'Подтверждён',
  arrived:     'Пришёл',
  in_progress: 'В кабинете',
  completed:   'Завершён',
  cancelled:   'Отменён',
  no_show:     'Не пришёл',
}

function ageOf(dob: string | null): string {
  if (!dob) return ''
  const b = new Date(dob), n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  const m = n.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--
  return `${a} л.`
}

type DoctorOpt = { id: string; first_name: string; last_name: string }

export default function DoctorDayPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [isOwnDoctor, setIsOwnDoctor] = useState(false)
  const [allDoctors, setAllDoctors] = useState<DoctorOpt[]>([])
  const [loading, setLoading] = useState(true)

  const [today, setToday] = useState<TodayAppt[]>([])
  const [openVisits, setOpenVisits] = useState<OpenVisit[]>([])
  const [labReady, setLabReady] = useState<LabReady[]>([])
  const [controls, setControls] = useState<ControlItem[]>([])

  // Детектим «свою» карточку врача и подгружаем список всех врачей клиники (для админа/владельца)
  useEffect(() => {
    if (!profile?.clinic_id || !profile.id) return
    ;(async () => {
      const [ownRes, allRes] = await Promise.all([
        supabase.from('doctors').select('id')
          .eq('user_id', profile.id).eq('clinic_id', profile.clinic_id).maybeSingle(),
        supabase.from('doctors').select('id, first_name, last_name')
          .eq('clinic_id', profile.clinic_id)
          .eq('is_active', true)
          .order('last_name'),
      ])
      const own = (ownRes.data as { id: string } | null)?.id ?? null
      setIsOwnDoctor(!!own)
      setAllDoctors((allRes.data ?? []) as DoctorOpt[])
      // Если есть свой — выбираем его, иначе первого из списка (для админа)
      setDoctorId(own ?? (allRes.data?.[0]?.id ?? null))
    })()
  }, [supabase, profile?.id, profile?.clinic_id])

  const load = useCallback(async () => {
    if (!profile?.clinic_id || !doctorId) return
    setLoading(true)
    const dId = doctorId

    const todayStr = new Date().toISOString().slice(0, 10)

    // 1. Визиты сегодня
    const { data: appts } = await supabase
      .from('appointments')
      .select(`
        id, time_start, time_end, status, chief_complaint, patient_id,
        patient:patients(full_name, date_of_birth),
        visits(id)
      `)
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', dId)
      .eq('date', todayStr)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .order('time_start', { ascending: true })

    const apptsMapped: TodayAppt[] = (appts ?? []).map(a => ({
      id: a.id, time_start: a.time_start, time_end: a.time_end,
      status: a.status, chief_complaint: a.chief_complaint,
      patient_id: a.patient_id,
      patient: (a as any).patient ?? null,
      visit_id: (a as any).visits?.[0]?.id ?? null,
    }))
    setToday(apptsMapped)

    // 2. Незакрытые визиты (все дни)
    const { data: ov } = await supabase
      .from('visits')
      .select('id, patient_id, started_at, patients(full_name)')
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', dId)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(20)

    setOpenVisits((ov ?? []).map(v => ({
      id: v.id, patient_id: v.patient_id, started_at: v.started_at,
      patient_name: (v as any).patients?.full_name ?? null,
    })))

    // 3. Верифицированные результаты за последние 7 дней у моих пациентов
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
    const { data: lr } = await supabase
      .from('patient_lab_results')
      .select(`
        id, service_name_snapshot, result_value, result_text, unit_snapshot,
        flag, result_date, patient_id,
        patient:patients(full_name),
        lab_order:lab_orders(doctor_id, status)
      `)
      .eq('clinic_id', profile.clinic_id)
      .gte('result_date', weekAgo)
      .order('result_date', { ascending: false })
      .limit(50)

    setLabReady(
      (lr ?? [])
        .filter(r => (r as any).lab_order?.doctor_id === dId)
        .map(r => ({
          id: r.id, service_name_snapshot: r.service_name_snapshot,
          result_value: r.result_value, result_text: r.result_text,
          unit_snapshot: r.unit_snapshot, flag: r.flag,
          result_date: r.result_date, patient_id: r.patient_id,
          patient_name: (r as any).patient?.full_name ?? '',
        }))
    )

    // 4. Контроли на сегодня (control_date = today)
    const { data: ct } = await supabase
      .from('medical_records')
      .select(`
        id, control_date, icd10_code, diagnosis_text, patient_id,
        patients(full_name)
      `)
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', dId)
      .eq('control_date', todayStr)
      .limit(50)

    setControls((ct ?? []).map(r => ({
      id: r.id, control_date: r.control_date,
      icd10_code: r.icd10_code, diagnosis_text: r.diagnosis_text,
      patient_id: r.patient_id,
      patient_name: (r as any).patients?.full_name ?? '',
    })))

    setLoading(false)
  }, [supabase, profile?.clinic_id, doctorId])

  useEffect(() => { if (doctorId) void load() }, [load, doctorId])

  // Следующий пациент = ближайший appointment со статусом scheduled/confirmed/arrived
  const nextAppt = useMemo(() => {
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    return today
      .filter(a => ['scheduled','confirmed','arrived','in_progress'].includes(a.status))
      .sort((a, b) => a.time_start.localeCompare(b.time_start))
      .find(a => a.status === 'in_progress' || a.time_start.slice(0,5) >= hhmm)
      ?? null
  }, [today])

  const countByStatus = (s: string) => today.filter(a => a.status === s).length

  if (!profile) return null

  if (!doctorId && allDoctors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
        <p className="text-sm text-gray-400">В клинике ещё нет врачей.</p>
      </div>
    )
  }

  const selectedDoctor = allDoctors.find(d => d.id === doctorId)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isOwnDoctor ? 'Мой день' : 'День врача'}
          </h1>
          <p className="text-xs text-gray-500">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            {isOwnDoctor && <> · Привет, {profile.first_name}</>}
            {!isOwnDoctor && selectedDoctor && <> · {selectedDoctor.last_name} {selectedDoctor.first_name}</>}
          </p>
        </div>
        {!isOwnDoctor && allDoctors.length > 1 && (
          <select value={doctorId ?? ''} onChange={e => setDoctorId(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            {allDoctors.map(d => (
              <option key={d.id} value={d.id}>{d.last_name} {d.first_name}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2">
          <Link href="/schedule" className="text-sm text-blue-600 hover:text-blue-800">Расписание →</Link>
          <button onClick={load} className="text-xs px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg">
            ↻ Обновить
          </button>
        </div>
      </div>

      {/* Counters */}
      <div className="grid grid-cols-4 gap-3">
        <Counter label="Всего сегодня" value={today.length} color="gray" />
        <Counter label="Пришли" value={countByStatus('arrived')} color="amber" />
        <Counter label="В работе" value={countByStatus('in_progress')} color="green" />
        <Counter label="Незакрытые" value={openVisits.length} color={openVisits.length > 0 ? 'red' : 'gray'} />
      </div>

      {/* Next patient */}
      {nextAppt && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Следующий пациент</span>
            <span className="text-xs font-mono bg-white/80 text-blue-800 px-2 py-0.5 rounded">
              {nextAppt.time_start.slice(0,5)}–{nextAppt.time_end.slice(0,5)}
            </span>
            {nextAppt.status === 'in_progress' && (
              <span className="text-xs font-medium bg-green-600 text-white px-2 py-0.5 rounded-full animate-pulse">
                В кабинете
              </span>
            )}
            {nextAppt.status === 'arrived' && (
              <span className="text-xs font-medium bg-amber-500 text-white px-2 py-0.5 rounded-full">
                Пришёл, ждёт
              </span>
            )}
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">
                {nextAppt.patient?.full_name ?? '—'}
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                {ageOf(nextAppt.patient?.date_of_birth ?? null)}
                {nextAppt.chief_complaint && <> · {nextAppt.chief_complaint}</>}
              </p>
            </div>
            <div className="flex gap-2">
              <Link href={`/patients/${nextAppt.patient_id}`}
                className="px-4 py-2.5 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg text-sm font-medium">
                Карта пациента
              </Link>
              {nextAppt.visit_id ? (
                <Link href={`/visits/${nextAppt.visit_id}`}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm">
                  Открыть визит →
                </Link>
              ) : (
                <Link href={`/schedule`}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shadow-sm">
                  Начать приём →
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

      {/* Today timeline */}
      {!loading && today.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Приёмы сегодня ({today.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {today.map(a => (
              <Link key={a.id}
                href={a.visit_id ? `/visits/${a.visit_id}` : `/patients/${a.patient_id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-sm">
                <span className="font-mono text-xs text-gray-500 w-16">{a.time_start.slice(0,5)}</span>
                <span className="flex-1 truncate text-gray-800">
                  {a.patient?.full_name ?? '—'}
                  <span className="text-gray-400 ml-2 text-xs">{ageOf(a.patient?.date_of_birth ?? null)}</span>
                </span>
                {a.chief_complaint && (
                  <span className="text-xs text-gray-400 truncate max-w-[200px]">{a.chief_complaint}</span>
                )}
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLR[a.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {STATUS_RU[a.status] ?? a.status}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Open visits alert */}
      {!loading && openVisits.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-red-100 flex items-center gap-2">
            <span className="text-red-600">⚠</span>
            <h3 className="text-sm font-semibold text-red-900">Незакрытые визиты ({openVisits.length})</h3>
            <span className="text-xs text-red-600">— требуют подписи медзаписи</span>
          </div>
          <div className="divide-y divide-red-100">
            {openVisits.map(v => (
              <Link key={v.id} href={`/visits/${v.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-100/50 text-sm">
                <span className="flex-1 truncate text-gray-800">{v.patient_name ?? '—'}</span>
                <span className="text-xs text-gray-500">
                  {v.started_at ? new Date(v.started_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
                <span className="text-xs text-red-700 font-medium">Открыть →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Lab ready */}
      {!loading && labReady.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span>🧪</span>
            <h3 className="text-sm font-semibold text-gray-900">Готовые результаты моих пациентов ({labReady.length})</h3>
            <span className="text-xs text-gray-400">— за последние 7 дней</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-[360px] overflow-auto">
            {labReady.map(r => {
              const val = r.result_value !== null
                ? `${r.result_value}${r.unit_snapshot ? ` ${r.unit_snapshot}` : ''}`
                : (r.result_text ?? '—')
              const clr = r.flag === 'high' || r.flag === 'critical' ? 'text-orange-600'
                        : r.flag === 'low' ? 'text-blue-600' : 'text-gray-800'
              return (
                <Link key={r.id} href={`/patients/${r.patient_id}`}
                  className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-sm">
                  <span className="flex-1 truncate text-gray-700">{r.patient_name}</span>
                  <span className="flex-1 truncate text-gray-500 text-xs">{r.service_name_snapshot}</span>
                  <span className={`font-semibold text-sm ${clr}`}>{val}</span>
                  {r.flag && r.flag !== 'normal' && (
                    <span className="text-xs">
                      {r.flag === 'critical' ? '‼' : r.flag === 'high' ? '↑' : r.flag === 'low' ? '↓' : ''}
                    </span>
                  )}
                  <span className="text-xs text-gray-400 w-16 text-right">
                    {new Date(r.result_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Controls today */}
      {!loading && controls.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span>📅</span>
            <h3 className="text-sm font-semibold text-gray-900">Контроли на сегодня ({controls.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {controls.map(c => (
              <Link key={c.id} href={`/patients/${c.patient_id}`}
                className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-sm">
                <span className="flex-1 truncate text-gray-800">{c.patient_name}</span>
                {c.icd10_code && (
                  <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1.5 rounded">{c.icd10_code}</span>
                )}
                <span className="flex-1 truncate text-gray-500 text-xs">{c.diagnosis_text ?? '—'}</span>
                <span className="text-xs text-blue-600">Открыть →</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading && today.length === 0 && openVisits.length === 0 && labReady.length === 0 && controls.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center text-sm text-gray-400">
          Сегодня тихо — приёмов нет, незакрытых визитов нет.
        </div>
      )}
    </div>
  )
}

function Counter({ label, value, color }: { label: string; value: number; color: 'gray'|'amber'|'green'|'red' }) {
  const map = {
    gray:  'bg-white border-gray-100 text-gray-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    green: 'bg-green-50 border-green-200 text-green-900',
    red:   'bg-red-50 border-red-200 text-red-900',
  }
  return (
    <div className={`rounded-xl border p-3 ${map[color]}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold mt-0.5">{value}</p>
    </div>
  )
}
