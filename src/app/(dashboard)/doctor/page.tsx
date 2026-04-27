'use client'

/**
 * /doctor — «Мой день» для врача.
 *
 * 4-колоночный канбан:
 *   Ожидают → В работе → Завершены → На подпись
 *
 * Маппинг статусов:
 *   Ожидают    = appointment активна, визита ещё нет (или visit.status='open')
 *   В работе   = visit.status = 'in_progress'
 *   На подпись = visit.status completed/partial + medical_record.is_signed = false
 *   Завершены  = visit.status completed/partial + medical_record.is_signed = true
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── types ──────────────────────────────────────────────────

type Appt = {
  id: string
  time_start: string
  time_end: string
  status: string                  // appointment status
  chief_complaint: string | null
  patient_id: string
  patient: { full_name: string; date_of_birth: string | null; sex: string | null } | null
  visit: {
    id: string
    status: string               // visit status
    record_is_signed: boolean | null
    record_id: string | null
  } | null
}

type LabFlagMap = Record<string, { nonNormal: number; critical: number }>

type DoctorOpt = { id: string; first_name: string; last_name: string }

type Column = 'waiting' | 'in_progress' | 'to_sign' | 'done'

// ─── helpers ────────────────────────────────────────────────

function ageOf(dob: string | null): string {
  if (!dob) return ''
  const b = new Date(dob), n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  const m = n.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--
  return `${a} л.`
}

function classifyColumn(a: Appt): Column {
  // Сначала смотрим на визит
  if (a.visit) {
    if (a.visit.status === 'in_progress') return 'in_progress'
    if (a.visit.status === 'completed' || a.visit.status === 'partial') {
      return a.visit.record_is_signed ? 'done' : 'to_sign'
    }
    // visit.status === 'open' → ещё не начат
  }
  // Визита нет либо open — «ожидает»
  return 'waiting'
}

// ─── main ───────────────────────────────────────────────────

export default function DoctorDayPage() {
  const supabase = createClient()
  const router = useRouter()
  const { profile } = useAuthStore()
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [isOwnDoctor, setIsOwnDoctor] = useState(false)
  const [allDoctors, setAllDoctors] = useState<DoctorOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [appts, setAppts] = useState<Appt[]>([])
  const [labFlags, setLabFlags] = useState<LabFlagMap>({})
  const [starting, setStarting] = useState<string | null>(null)

  // ── Определяем doctor_id
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

  // ── Грузим данные
  const load = useCallback(async () => {
    if (!profile?.clinic_id || !doctorId) return
    setLoading(true)
    const todayStr = new Date().toISOString().slice(0, 10)

    // Приёмы сегодня + связанные визиты + медзаписи
    const { data: raw } = await supabase
      .from('appointments')
      .select(`
        id, time_start, time_end, status, chief_complaint, patient_id,
        patient:patients(full_name, date_of_birth, sex),
        visits(id, status, medical_records(id, is_signed))
      `)
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', doctorId)
      .eq('date', todayStr)
      .not('status', 'in', '(cancelled,no_show,rescheduled)')
      .order('time_start', { ascending: true })

    const list: Appt[] = (raw ?? []).map((a: any) => {
      const v = a.visits?.[0] ?? null
      const mr = v?.medical_records?.[0] ?? null
      return {
        id: a.id,
        time_start: a.time_start,
        time_end: a.time_end,
        status: a.status,
        chief_complaint: a.chief_complaint,
        patient_id: a.patient_id,
        patient: a.patient,
        visit: v ? {
          id: v.id,
          status: v.status,
          record_is_signed: mr?.is_signed ?? null,
          record_id: mr?.id ?? null,
        } : null,
      }
    })
    setAppts(list)

    // Критичные/отклонения по анализам пациентов за 7 дней
    const patientIds = list.map(a => a.patient_id).filter(Boolean)
    if (patientIds.length > 0) {
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString()
      const { data: labs } = await supabase
        .from('patient_lab_results')
        .select('patient_id, flag')
        .eq('clinic_id', profile.clinic_id)
        .in('patient_id', patientIds)
        .gte('result_date', weekAgo)
        .not('flag', 'is', null)
      const map: LabFlagMap = {}
      for (const r of (labs ?? []) as { patient_id: string; flag: string }[]) {
        if (!map[r.patient_id]) map[r.patient_id] = { nonNormal: 0, critical: 0 }
        if (r.flag !== 'normal') map[r.patient_id].nonNormal++
        if (r.flag === 'critical') map[r.patient_id].critical++
      }
      setLabFlags(map)
    } else {
      setLabFlags({})
    }

    setLoading(false)
  }, [supabase, profile?.clinic_id, doctorId])

  useEffect(() => { if (doctorId) void load() }, [load, doctorId])

  // ── Группировка по колонкам
  const columns = useMemo(() => {
    const c: Record<Column, Appt[]> = {
      waiting: [], in_progress: [], done: [], to_sign: [],
    }
    for (const a of appts) c[classifyColumn(a)].push(a)
    return c
  }, [appts])

  // ── Начать приём: создать/обновить visit и перейти
  async function startVisit(a: Appt) {
    if (!profile?.clinic_id || !doctorId) return
    setStarting(a.id)
    try {
      let visitId = a.visit?.id ?? null

      if (!visitId) {
        const { data, error } = await supabase.from('visits').insert({
          clinic_id: profile.clinic_id,
          appointment_id: a.id,
          patient_id: a.patient_id,
          doctor_id: doctorId,
          status: 'in_progress',
          started_at: new Date().toISOString(),
          created_by: profile.id,
        }).select('id').single()
        if (error) throw error
        visitId = data!.id
      } else if (a.visit?.status === 'open') {
        await supabase.from('visits').update({
          status: 'in_progress',
          started_at: new Date().toISOString(),
        }).eq('id', visitId)
      }

      // Обновить статус appointment на arrived/in_progress
      await supabase.from('appointments').update({ status: 'arrived' })
        .eq('id', a.id)
        .in('status', ['scheduled', 'confirmed'])

      router.push(`/visits/${visitId}`)
    } catch (e: unknown) {
      alert('Не удалось начать приём: ' + (e instanceof Error ? e.message : String(e)))
      setStarting(null)
    }
  }

  if (!profile) return null

  if (!doctorId && allDoctors.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
        <p className="text-sm text-gray-400">В клинике ещё нет врачей.</p>
      </div>
    )
  }

  const selectedDoctor = allDoctors.find(d => d.id === doctorId)

  const colMeta: Record<Column, { label: string; color: string; dot: string }> = {
    waiting:     { label: 'Ожидают',    color: 'border-gray-200',  dot: 'bg-gray-400' },
    in_progress: { label: 'В работе',   color: 'border-green-200', dot: 'bg-green-500 animate-pulse' },
    to_sign:     { label: 'На подпись', color: 'border-amber-200', dot: 'bg-amber-500' },
    done:        { label: 'Завершены',  color: 'border-blue-200',  dot: 'bg-blue-500' },
  }

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
            {' · '}{appts.length} приёмов
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
          <Link href="/doctor/tasks" className="text-sm text-blue-600 hover:text-blue-800">
            Входящие →
          </Link>
          <button onClick={load}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg">
            ↻ Обновить
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

      {!loading && appts.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-xl p-12 text-center text-sm text-gray-400">
          Сегодня приёмов нет.
        </div>
      )}

      {/* Канбан */}
      {!loading && appts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {(['waiting', 'in_progress', 'done', 'to_sign'] as Column[]).map(col => {
            const m = colMeta[col]
            const items = columns[col]
            return (
              <div key={col} className={`bg-gray-50/50 border ${m.color} rounded-xl flex flex-col min-h-[260px]`}>
                <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2 bg-white/70 rounded-t-xl">
                  <span className={`w-2 h-2 rounded-full ${m.dot}`} />
                  <h3 className="text-sm font-semibold text-gray-900">{m.label}</h3>
                  <span className="ml-auto text-xs text-gray-500">{items.length}</span>
                </div>
                <div className="p-2 space-y-2 flex-1">
                  {items.length === 0 ? (
                    <div className="text-xs text-gray-300 text-center py-6">—</div>
                  ) : (
                    items.map(a => (
                      <VisitCard
                        key={a.id}
                        a={a}
                        column={col}
                        labFlags={labFlags[a.patient_id] ?? null}
                        starting={starting === a.id}
                        onStart={() => startVisit(a)}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Карточка визита ────────────────────────────────────────

function VisitCard({ a, column, labFlags, starting, onStart }: {
  a: Appt
  column: Column
  labFlags: { nonNormal: number; critical: number } | null
  starting: boolean
  onStart: () => void
}) {
  const p = a.patient
  const hasLabs = labFlags && labFlags.nonNormal > 0
  const critical = labFlags && labFlags.critical > 0

  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm hover:shadow transition">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="font-mono">{a.time_start.slice(0, 5)}</span>
            {a.time_end && <span className="text-gray-300">–{a.time_end.slice(0, 5)}</span>}
            {p?.sex === 'F' && <span className="text-pink-500">♀</span>}
            {p?.sex === 'M' && <span className="text-blue-500">♂</span>}
            {p?.date_of_birth && <span>{ageOf(p.date_of_birth)}</span>}
          </div>
          <p className="text-sm font-medium text-gray-900 mt-0.5 truncate">
            {p?.full_name ?? '—'}
          </p>
          {a.chief_complaint && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{a.chief_complaint}</p>
          )}
        </div>
        {hasLabs && (
          <span
            title={`${labFlags!.nonNormal} отклонений${critical ? `, ${labFlags!.critical} критич.` : ''}`}
            className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
              critical ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
            }`}>
            {critical ? '‼' : '⚠'} {labFlags!.nonNormal}
          </span>
        )}
      </div>

      {/* Кнопки действия — зависят от колонки */}
      <div className="flex gap-1.5 mt-2.5">
        {column === 'waiting' && (
          <>
            <button onClick={onStart} disabled={starting}
              className="flex-1 px-2 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium disabled:opacity-50">
              {starting ? '…' : '▶ Начать приём'}
            </button>
            <Link href={`/patients/${a.patient_id}`}
              className="px-2 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded text-xs">
              Карта
            </Link>
          </>
        )}
        {column === 'in_progress' && a.visit && (
          <Link href={`/visits/${a.visit.id}`}
            className="flex-1 px-2 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium text-center">
            → Продолжить
          </Link>
        )}
        {column === 'to_sign' && a.visit && (
          <Link href={`/visits/${a.visit.id}`}
            className="flex-1 px-2 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-medium text-center">
            ✍ Подписать
          </Link>
        )}
        {column === 'done' && a.visit && (
          <Link href={`/visits/${a.visit.id}`}
            className="flex-1 px-2 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded text-xs text-center">
            Открыть
          </Link>
        )}
      </div>
    </div>
  )
}
