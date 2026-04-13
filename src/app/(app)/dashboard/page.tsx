'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'

type Appointment = {
  id: string
  patient_name: string
  doctor_name: string
  service: string
  date: string
  start_time: string
  end_time: string
  status: string
}

const APPT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Запись',
  arrived:   'Пришёл',
  completed: 'Завершён',
  cancelled: 'Отменён',
  no_show:   'Не пришёл',
}
const APPT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  scheduled: { bg: '#EEF4FF', text: '#0B63C2' },
  arrived:   { bg: '#ECFDF5', text: '#059669' },
  completed: { bg: '#F3F4F6', text: '#6B7280' },
  cancelled: { bg: '#FEF2F2', text: '#DC2626' },
  no_show:   { bg: '#FFFBEB', text: '#D97706' },
}

function formatRussianDate(date: Date): string {
  const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  const months = [
    'января','февраля','марта','апреля','мая','июня',
    'июля','августа','сентября','октября','ноября','декабря',
  ]
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}, ${days[date.getDay()]}`
}

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU')
}

export default function DashboardPage() {
  const router = useRouter()
  useToast() // ensure toast context is accessible if needed

  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState({ apptCount: 0, revenue: 0, patientCount: 0, newLeads: 0 })
  const [todayAppts, setTodayAppts] = useState<Appointment[]>([])
  const [actions, setActions] = useState({ labPending: 0, newLeads: 0, pendingPayments: 0 })

  const today = new Date().toISOString().split('T')[0]
  const todayLabel = formatRussianDate(new Date())

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/login')
    })
    loadAll()
  }, [])

  async function loadAll() {
    setLoading(true)
    const [
      apptTodayRes,
      revenueTodayRes,
      patientCountRes,
      newLeadsRes,
      apptListRes,
      labPendingRes,
      leadsNewRes,
      paymentsPendingRes,
    ] = await Promise.all([
      supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('date', today),
      supabase.from('payments').select('amount').eq('date', today).eq('status', 'paid'),
      supabase.from('patients').select('id', { count: 'exact', head: true }),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      supabase.from('appointments').select('id,patient_name,doctor_name,service,date,start_time,end_time,status')
        .eq('date', today).order('start_time', { ascending: true }).limit(8),
      supabase.from('lab_tests').select('id', { count: 'exact', head: true }).neq('status', 'ready'),
      supabase.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])

    const revenue = (revenueTodayRes.data || []).reduce((sum, row) => sum + Number(row.amount || 0), 0)

    setKpi({
      apptCount:    apptTodayRes.count    || 0,
      revenue,
      patientCount: patientCountRes.count  || 0,
      newLeads:     newLeadsRes.count      || 0,
    })
    setTodayAppts(apptListRes.data || [])
    setActions({
      labPending:      labPendingRes.count      || 0,
      newLeads:        leadsNewRes.count         || 0,
      pendingPayments: paymentsPendingRes.count  || 0,
    })
    setLoading(false)
  }

  const cardStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #E8EDF5',
    borderRadius: 12,
    padding: '20px',
  }

  const kpiCards = [
    {
      label: 'Приёмов сегодня',
      value: kpi.apptCount,
      display: String(kpi.apptCount),
      sub: 'на сегодня',
    },
    {
      label: 'Выручка сегодня',
      value: kpi.revenue,
      display: `${fmt(kpi.revenue)} ₸`,
      sub: 'оплачено сегодня',
    },
    {
      label: 'Пациентов всего',
      value: kpi.patientCount,
      display: String(kpi.patientCount),
      sub: 'в базе',
    },
    {
      label: 'Новых лидов',
      value: kpi.newLeads,
      display: String(kpi.newLeads),
      sub: 'требуют обработки',
    },
  ]

  const actionCards = [
    {
      label: 'Анализов в работе',
      count: actions.labPending,
      color: '#D97706',
      bg: '#FFFBEB',
      path: '/lis',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 3h6"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/>
          <path d="M3 9v6"/><path d="M21 9v6"/><path d="M3 15v4a2 2 0 0 0 2 2h4"/>
          <path d="M21 15v4a2 2 0 0 1-2 2h-4"/><path d="M9 21h6"/>
          <line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
    },
    {
      label: 'Новых лидов',
      count: actions.newLeads,
      color: '#0B63C2',
      bg: '#EEF4FF',
      path: '/crm',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0B63C2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ),
    },
    {
      label: 'Ожидают оплаты',
      count: actions.pendingPayments,
      color: '#D97706',
      bg: '#FFFBEB',
      path: '/finance',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      ),
    },
  ]

  if (loading) {
    return (
      <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
        <p style={{ color: '#6B7280', fontSize: 14 }}>Загрузка...</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Page title */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#141414', margin: 0 }}>Дашборд</h1>
        <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>{todayLabel}</p>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        {kpiCards.map(c => (
          <div key={c.label} style={cardStyle}>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: '#0B63C2', margin: '0 0 4px' }}>{c.display}</p>
            <p style={{ fontSize: 12, color: '#9CA3AF', margin: 0 }}>{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Two-column section */}
      <div style={{ display: 'grid', gridTemplateColumns: '60fr 40fr', gap: 20, alignItems: 'start' }}>

        {/* Left: Schedule today */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#141414', margin: '0 0 12px' }}>Расписание сегодня</h2>
          {todayAppts.length === 0 ? (
            <div style={{ ...cardStyle, padding: '32px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, color: '#6B7280', margin: 0 }}>Приёмов на сегодня нет</p>
            </div>
          ) : (
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              {todayAppts.map((a, i) => {
                const sc = APPT_STATUS_COLORS[a.status] || APPT_STATUS_COLORS.scheduled
                return (
                  <div
                    key={a.id}
                    style={{
                      padding: '12px 16px',
                      borderBottom: i < todayAppts.length - 1 ? '1px solid #F3F4F6' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                    }}
                  >
                    {/* Time */}
                    <div style={{ width: 48, flexShrink: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#141414' }}>
                        {a.start_time ? a.start_time.slice(0, 5) : '—'}
                      </span>
                    </div>
                    {/* Blue bar */}
                    <div style={{ width: 3, height: 36, background: '#0B63C2', borderRadius: 2, flexShrink: 0 }} />
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 500, color: '#141414', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.patient_name || '—'}
                      </p>
                      <p style={{ fontSize: 12, color: '#6B7280', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.doctor_name || '—'}{a.service ? ` · ${a.service}` : ''}
                      </p>
                    </div>
                    {/* Status badge */}
                    <span style={{
                      fontSize: 12,
                      fontWeight: 500,
                      background: sc.bg,
                      color: sc.text,
                      borderRadius: 12,
                      padding: '3px 9px',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      {APPT_STATUS_LABELS[a.status] || a.status}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <button
            onClick={() => router.push('/schedule')}
            style={{
              marginTop: 10,
              background: 'none',
              border: 'none',
              color: '#0B63C2',
              fontSize: 13,
              cursor: 'pointer',
              padding: 0,
              fontWeight: 500,
            }}
          >
            Открыть расписание →
          </button>
        </div>

        {/* Right: Action cards */}
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: '#141414', margin: '0 0 12px' }}>Ожидают действия</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {actionCards.map(ac => (
              <div
                key={ac.label}
                onClick={() => router.push(ac.path)}
                style={{
                  background: '#fff',
                  border: '1px solid #E8EDF5',
                  borderRadius: 12,
                  padding: '16px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = ac.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#E8EDF5')}
              >
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: ac.bg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {ac.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 22, fontWeight: 700, color: ac.color, margin: '0 0 2px' }}>{ac.count}</p>
                  <p style={{ fontSize: 13, color: '#6B7280', margin: 0 }}>{ac.label}</p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
