'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

type Stats = {
  totalPatients: number
  newPatientsMonth: number
  appointmentsToday: number
  appointmentsMonth: number
  appointmentsCompleted: number
  appointmentsCancelled: number
  revenueToday: number
  revenueMonth: number
  revenueWeek: number
  totalLeads: number
  leadsConverted: number
  leadsLost: number
  labTestsReady: number
  labTestsPending: number
  topSources: { source: string; count: number }[]
  topServices: { service: string; count: number }[]
  recentAppointments: { patient_name: string; doctor_name: string; start_time: string; status: string }[]
}

function fmt(n: number) { return Number(n || 0).toLocaleString('ru-RU') }

function pct(a: number, b: number) {
  if (!b) return 0
  return Math.round((a / b) * 100)
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max ? Math.round((value / max) * 100) : 0
  return (
    <div style={{ height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 3, transition: 'width 0.4s' }} />
    </div>
  )
}

export default function AnalyticsPage() {
  const router = useRouter()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadStats()
  }, [])

  async function loadStats() {
    setLoading(true)
    try {
    const today = new Date().toISOString().split('T')[0]
    const monthStart = today.slice(0, 7) + '-01'
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7)
    const weekStart = weekAgo.toISOString().split('T')[0]

    const [
      { count: totalPatients },
      { count: newPatientsMonth },
      { data: apptToday },
      { data: apptMonth },
      { data: payments },
      { data: leads },
      { data: labTests },
      { data: sources },
      { data: recentAppts },
    ] = await Promise.all([
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      supabase.from('patients').select('*', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabase.from('appointments').select('status').eq('date', today),
      supabase.from('appointments').select('status,service').gte('date', monthStart),
      supabase.from('payments').select('amount,status,date').gte('date', monthStart),
      supabase.from('leads').select('status,source'),
      supabase.from('lab_tests').select('status'),
      supabase.from('leads').select('source'),
      supabase.from('appointments').select('patient_name,doctor_name,start_time,status').eq('date', today).order('start_time', { ascending: true }).limit(8),
    ])

    // Revenue
    const paidPayments = (payments || []).filter(p => p.status === 'paid')
    const revenueMonth = paidPayments.reduce((s, p) => s + Number(p.amount), 0)
    const revenueToday = paidPayments.filter(p => p.date === today).reduce((s, p) => s + Number(p.amount), 0)
    const revenueWeek = paidPayments.filter(p => p.date >= weekStart).reduce((s, p) => s + Number(p.amount), 0)

    // Appointments
    const appointmentsToday = (apptToday || []).length
    const appointmentsMonth = (apptMonth || []).length
    const appointmentsCompleted = (apptMonth || []).filter(a => a.status === 'completed').length
    const appointmentsCancelled = (apptMonth || []).filter(a => a.status === 'cancelled').length

    // Leads
    const totalLeads = (leads || []).length
    const leadsConverted = (leads || []).filter(l => l.status === 'converted').length
    const leadsLost = (leads || []).filter(l => l.status === 'lost').length

    // Lab
    const labTestsReady = (labTests || []).filter(t => t.status === 'ready').length
    const labTestsPending = (labTests || []).filter(t => t.status !== 'ready').length

    // Top sources
    const sourceCounts: Record<string, number> = {}
    ;(sources || []).forEach(l => { sourceCounts[l.source] = (sourceCounts[l.source] || 0) + 1 })
    const topSources = Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([source, count]) => ({ source, count }))

    // Top services
    const serviceCounts: Record<string, number> = {}
    ;(apptMonth || []).forEach(a => { if (a.service) serviceCounts[a.service] = (serviceCounts[a.service] || 0) + 1 })
    const topServices = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([service, count]) => ({ service, count }))

    setStats({
      totalPatients: totalPatients || 0,
      newPatientsMonth: newPatientsMonth || 0,
      appointmentsToday,
      appointmentsMonth,
      appointmentsCompleted,
      appointmentsCancelled,
      revenueToday,
      revenueMonth,
      revenueWeek,
      totalLeads,
      leadsConverted,
      leadsLost,
      labTestsReady,
      labTestsPending,
      topSources,
      topServices,
      recentAppointments: recentAppts || [],
    })
    } catch (e) {
      console.error('Analytics load error:', e)
    } finally {
      setLoading(false)
    }
  }

  const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
    scheduled: { bg: '#EEF4FF', text: '#0B63C2' },
    arrived:   { bg: '#ECFDF5', text: '#059669' },
    completed: { bg: '#F3F4F6', text: '#6B7280' },
    cancelled: { bg: '#FEF2F2', text: '#DC2626' },
    no_show:   { bg: '#FFFBEB', text: '#D97706' },
  }
  const STATUS_RU: Record<string, string> = {
    scheduled: 'Запись', arrived: 'Пришёл', completed: 'Завершён', cancelled: 'Отменён', no_show: 'Не пришёл',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F5F5F5', fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E8EDF5', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 13, padding: 0 }}>← Назад</button>
          <span style={{ color: '#D1D5DB' }}>|</span>
          <div style={{ width: 28, height: 28, background: '#0B63C2', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#141414' }}>Аналитика</span>
        </div>
        <button onClick={loadStats} style={{ background: 'none', border: '1px solid #E8EDF5', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer', color: '#6B7280' }}>
          Обновить
        </button>
      </div>

      <div style={{ padding: '24px', maxWidth: 960, margin: '0 auto' }}>
        {loading || !stats ? (
          <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
        ) : (
          <>
            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
              {[
                { label: 'Пациентов всего',     value: fmt(stats.totalPatients),      sub: `+${stats.newPatientsMonth} за месяц`,         color: '#0B63C2' },
                { label: 'Приёмов сегодня',     value: fmt(stats.appointmentsToday),  sub: `${stats.appointmentsMonth} за месяц`,          color: '#7C3AED' },
                { label: 'Выручка сегодня',     value: `${fmt(stats.revenueToday)} ₸`, sub: `${fmt(stats.revenueMonth)} ₸ за месяц`,      color: '#059669' },
                { label: 'Лиды',                value: fmt(stats.totalLeads),          sub: `${stats.leadsConverted} конвертировано`,       color: '#D97706' },
              ].map(c => (
                <div key={c.label} style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '18px 20px' }}>
                  <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 6px', fontWeight: 500 }}>{c.label}</p>
                  <p style={{ fontSize: 22, fontWeight: 700, color: c.color, margin: '0 0 2px' }}>{c.value}</p>
                  <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>{c.sub}</p>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Приёмы за месяц */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Приёмы за месяц</p>
                {[
                  { label: 'Всего', value: stats.appointmentsMonth, color: '#0B63C2' },
                  { label: 'Завершено', value: stats.appointmentsCompleted, color: '#059669' },
                  { label: 'Отменено', value: stats.appointmentsCancelled, color: '#DC2626' },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: r.color }}>{r.value}</span>
                    </div>
                    <Bar value={r.value} max={stats.appointmentsMonth || 1} color={r.color} />
                  </div>
                ))}
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F3F4F6' }}>
                  <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>
                    Конверсия: <strong style={{ color: '#059669' }}>{pct(stats.appointmentsCompleted, stats.appointmentsMonth)}%</strong> завершено
                  </p>
                </div>
              </div>

              {/* Финансы */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Финансы</p>
                {[
                  { label: 'Сегодня', value: `${fmt(stats.revenueToday)} ₸`, color: '#059669' },
                  { label: 'За 7 дней', value: `${fmt(stats.revenueWeek)} ₸`, color: '#0B63C2' },
                  { label: 'За месяц', value: `${fmt(stats.revenueMonth)} ₸`, color: '#7C3AED' },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
                    <span style={{ fontSize: 13, color: '#374151' }}>{r.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: r.color }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              {/* Источники лидов */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Источники лидов</p>
                {stats.topSources.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#9CA3AF' }}>Нет данных</p>
                ) : stats.topSources.map(s => (
                  <div key={s.source} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>{s.source}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#141414' }}>{s.count}</span>
                    </div>
                    <Bar value={s.count} max={stats.topSources[0]?.count || 1} color="#0B63C2" />
                  </div>
                ))}
              </div>

              {/* Топ услуги */}
              <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Популярные услуги</p>
                {stats.topServices.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#9CA3AF' }}>Нет данных</p>
                ) : stats.topServices.map(s => (
                  <div key={s.service} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>{s.service}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#141414' }}>{s.count}</span>
                    </div>
                    <Bar value={s.count} max={stats.topServices[0]?.count || 1} color="#7C3AED" />
                  </div>
                ))}
              </div>
            </div>

            {/* CRM + Lab */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Воронка CRM</p>
                {[
                  { label: 'Всего лидов', value: stats.totalLeads, color: '#6B7280' },
                  { label: 'Конвертировано', value: stats.leadsConverted, color: '#059669' },
                  { label: 'Потеряно', value: stats.leadsLost, color: '#DC2626' },
                ].map(r => (
                  <div key={r.label} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, color: '#374151' }}>{r.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: r.color }}>{r.value}</span>
                    </div>
                    <Bar value={r.value} max={stats.totalLeads || 1} color={r.color} />
                  </div>
                ))}
                <p style={{ fontSize: 12, color: '#6B7280', margin: '12px 0 0' }}>
                  Конверсия: <strong style={{ color: '#059669' }}>{pct(stats.leadsConverted, stats.totalLeads)}%</strong>
                </p>
              </div>

              <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Лаборатория</p>
                {[
                  { label: 'Готово', value: stats.labTestsReady, color: '#059669' },
                  { label: 'В работе / ожидают', value: stats.labTestsPending, color: '#D97706' },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #F3F4F6' }}>
                    <span style={{ fontSize: 13, color: '#374151' }}>{r.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: r.color }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Today's schedule */}
            <div style={{ background: '#fff', border: '1px solid #E8EDF5', borderRadius: 12, padding: '20px 24px' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#141414', margin: '0 0 16px' }}>Расписание сегодня</p>
              {stats.recentAppointments.length === 0 ? (
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>На сегодня приёмов нет</p>
              ) : (
                <div>
                  {stats.recentAppointments.map((a, i) => {
                    const sc = STATUS_COLORS[a.status] || STATUS_COLORS.scheduled
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 0', borderBottom: i < stats.recentAppointments.length - 1 ? '1px solid #F3F4F6' : 'none' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#141414', minWidth: 48 }}>{a.start_time?.slice(0, 5)}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 500, color: '#141414', margin: 0 }}>{a.patient_name}</p>
                          <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{a.doctor_name}</p>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 500, background: sc.bg, color: sc.text, borderRadius: 10, padding: '2px 9px' }}>
                          {STATUS_RU[a.status] || a.status}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
