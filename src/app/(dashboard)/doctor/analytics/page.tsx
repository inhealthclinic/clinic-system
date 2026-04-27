'use client'

/**
 * /doctor/analytics — моя эффективность.
 * KPI за выбранный месяц + топ диагнозов + зарплата (если есть doctor_payroll).
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

type Stats = {
  visits_total: number
  visits_completed: number
  unique_patients: number
  returning_patients: number
  revenue: number
}

type TopDiag = { code: string | null; diagnosis: string | null; count: number }

type Payroll = {
  period_from: string
  period_to: string
  visits_count: number
  revenue_total: number
  total_earned: number
  fixed_part: number
  percent_part: number
  status: string | null
  paid_at: string | null
}

function fmtTenge(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

function monthRange(offset: number): { from: string; to: string; label: string } {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth() + offset
  const start = new Date(y, m, 1)
  const end = new Date(y, m + 1, 1)
  const label = start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    label,
  }
}

type DoctorOpt = { id: string; first_name: string; last_name: string }

export default function DoctorAnalyticsPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [doctorId, setDoctorId] = useState<string | null>(null)
  const [isOwnDoctor, setIsOwnDoctor] = useState(false)
  const [allDoctors, setAllDoctors] = useState<DoctorOpt[]>([])
  const [monthOffset, setMonthOffset] = useState(0)  // 0 = текущий, -1 = прошлый
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
  const [stats, setStats] = useState<Stats>({
    visits_total: 0, visits_completed: 0,
    unique_patients: 0, returning_patients: 0, revenue: 0,
  })
  const [topDiag, setTopDiag] = useState<TopDiag[]>([])
  const [payroll, setPayroll] = useState<Payroll | null>(null)

  const range = useMemo(() => monthRange(monthOffset), [monthOffset])

  const load = useCallback(async () => {
    if (!profile?.clinic_id || !doctorId) return
    setLoading(true)
    const dId = doctorId

    // Визиты за месяц
    const { data: vs } = await supabase
      .from('visits')
      .select('id, patient_id, status, created_at')
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', dId)
      .gte('created_at', range.from)
      .lt('created_at', range.to)
      .limit(5000)

    const visits = vs ?? []
    const visits_total = visits.length
    const visits_completed = visits.filter(v => v.status === 'completed' || v.status === 'partial').length
    const uniqueSet = new Set(visits.map(v => v.patient_id))
    const unique_patients = uniqueSet.size

    // Возвраты: пациенты с ≥2 визитами у меня (за всё время, среди тех, кто был в этом месяце)
    let returning_patients = 0
    if (unique_patients > 0) {
      const { data: prevRecs } = await supabase
        .from('medical_records')
        .select('patient_id')
        .eq('clinic_id', profile.clinic_id)
        .eq('doctor_id', dId)
        .lt('created_at', range.from)
        .in('patient_id', Array.from(uniqueSet))
        .limit(5000)
      returning_patients = new Set((prevRecs ?? []).map(r => r.patient_id)).size
    }

    // Выручка: оплаченные charges у визитов этого врача в этот месяц
    const visitIds = visits.map(v => v.id)
    let revenue = 0
    if (visitIds.length > 0) {
      const { data: chs } = await supabase
        .from('charges')
        .select('amount, status, visit_id')
        .in('visit_id', visitIds)
        .limit(10000)
      revenue = (chs ?? [])
        .filter(c => c.status === 'paid')
        .reduce((s, c) => s + Number(c.amount ?? 0), 0)
    }

    setStats({ visits_total, visits_completed, unique_patients, returning_patients, revenue })

    // Топ диагнозов
    const { data: recs } = await supabase
      .from('medical_records')
      .select('icd10_code, diagnosis_text')
      .eq('clinic_id', profile.clinic_id)
      .eq('doctor_id', dId)
      .gte('created_at', range.from)
      .lt('created_at', range.to)
      .not('icd10_code', 'is', null)
      .limit(2000)

    const counter = new Map<string, TopDiag>()
    for (const r of recs ?? []) {
      const key = r.icd10_code ?? r.diagnosis_text ?? ''
      if (!key) continue
      const cur = counter.get(key)
      if (cur) cur.count++
      else counter.set(key, { code: r.icd10_code, diagnosis: r.diagnosis_text, count: 1 })
    }
    setTopDiag(Array.from(counter.values()).sort((a, b) => b.count - a.count).slice(0, 10))

    // Зарплата: ищем period_from в выбранном месяце
    const { data: py } = await supabase
      .from('doctor_payroll')
      .select('period_from, period_to, visits_count, revenue_total, total_earned, fixed_part, percent_part, status, paid_at')
      .eq('doctor_id', dId)
      .gte('period_from', range.from)
      .lt('period_from', range.to)
      .order('period_from', { ascending: false })
      .limit(1)
      .maybeSingle()
    setPayroll((py as Payroll | null) ?? null)

    setLoading(false)
  }, [supabase, profile?.clinic_id, doctorId, range.from, range.to])

  useEffect(() => { if (doctorId) void load() }, [load, doctorId])

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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {isOwnDoctor ? 'Моя эффективность' : 'Эффективность врача'}
          </h1>
          <p className="text-xs text-gray-500 capitalize">
            {range.label}
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
          <button onClick={() => setMonthOffset(o => o - 1)}
            className="px-2 py-1 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">←</button>
          <button onClick={() => setMonthOffset(0)} disabled={monthOffset === 0}
            className="px-3 py-1 border border-gray-200 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50">Сейчас</button>
          <button onClick={() => setMonthOffset(o => o + 1)} disabled={monthOffset >= 0}
            className="px-2 py-1 border border-gray-200 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50">→</button>
          <Link href="/doctor" className="text-sm text-blue-600 hover:text-blue-800 ml-2">← Мой день</Link>
        </div>
      </div>

      {loading && <div className="text-sm text-gray-400">Загрузка…</div>}

      {!loading && (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-5 gap-3">
            <KPI label="Приёмов всего" value={stats.visits_total} />
            <KPI label="Закрыто" value={stats.visits_completed}
              sub={stats.visits_total > 0 ? `${Math.round(stats.visits_completed / stats.visits_total * 100)}%` : ''} />
            <KPI label="Уник. пациенты" value={stats.unique_patients} />
            <KPI label="Возврат" value={stats.returning_patients}
              sub={stats.unique_patients > 0 ? `${Math.round(stats.returning_patients / stats.unique_patients * 100)}%` : ''}
              color="emerald" />
            <KPI label="Выручка" valueStr={fmtTenge(stats.revenue)} color="blue" />
          </div>

          {/* Payroll */}
          {payroll ? (
            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">💰 Моя зарплата · {range.label}</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  payroll.status === 'paid' ? 'bg-green-100 text-green-700' :
                  payroll.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {payroll.status === 'paid' ? 'Выплачено' : payroll.status === 'approved' ? 'Утверждено' : 'Черновик'}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Визитов</p>
                  <p className="text-xl font-semibold text-gray-900">{payroll.visits_count ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Выручка</p>
                  <p className="text-xl font-semibold text-gray-700">{fmtTenge(Number(payroll.revenue_total ?? 0))}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Оклад / %</p>
                  <p className="text-sm text-gray-700">
                    {fmtTenge(Number(payroll.fixed_part ?? 0))}
                    <span className="text-gray-400"> + </span>
                    {fmtTenge(Number(payroll.percent_part ?? 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">К выплате</p>
                  <p className="text-xl font-semibold text-green-600">{fmtTenge(Number(payroll.total_earned ?? 0))}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl p-5 text-sm text-gray-400">
              Начисление зарплаты за {range.label} ещё не сформировано.
            </div>
          )}

          {/* Top diagnoses */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">🏆 Топ-10 диагнозов</h3>
            </div>
            {topDiag.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400">Нет диагнозов за этот период</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {topDiag.map((d, i) => {
                  const max = topDiag[0].count
                  const pct = Math.round(d.count / max * 100)
                  return (
                    <div key={i} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="text-xs text-gray-400 w-6">{i + 1}.</span>
                      {d.code && (
                        <span className="font-mono text-xs bg-blue-50 text-blue-700 px-1.5 rounded">{d.code}</span>
                      )}
                      <span className="flex-1 truncate text-gray-800">{d.diagnosis ?? '—'}</span>
                      <div className="w-32 bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-blue-500 h-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{d.count}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function KPI({ label, value, valueStr, sub, color = 'gray' }: {
  label: string; value?: number; valueStr?: string; sub?: string;
  color?: 'gray' | 'emerald' | 'blue'
}) {
  const clr = color === 'emerald' ? 'text-emerald-700' : color === 'blue' ? 'text-blue-700' : 'text-gray-900'
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold mt-0.5 ${clr}`}>
        {valueStr ?? value ?? 0}
      </p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
