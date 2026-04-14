'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { PermissionGuard } from '@/components/shared/PermissionGuard'
import { CashSessionBar } from '@/components/finance/CashSessionBar'
import { today } from '@/lib/utils/schedule'

interface DashStats {
  appointments_total: number
  appointments_confirmed: number
  appointments_arrived: number
  appointments_completed: number
  appointments_no_show: number
  visits_open: number
  revenue_today: number
  new_leads: number
  tasks_overdue: number
  tasks_today: number
  lab_ready: number
}

interface DoctorStat {
  doctor_id: string
  name: string
  appointments: number
  completed: number
  revenue: number
}

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const { user } = useAuthStore()
  const { can } = usePermissions()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [doctors, setDoctors] = useState<DoctorStat[]>([])
  const [recentAppointments, setRecentAppointments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const todayStr = today()

  useEffect(() => { load() }, [])

  const load = async () => {
    setLoading(true)
    const [apts, visits, payments, leads, tasks, labOrders] = await Promise.all([
      supabase.from('appointments').select('id, status').eq('date', todayStr),
      supabase.from('visits').select('id, status').gte('created_at', `${todayStr}T00:00:00`),
      supabase.from('payments').select('amount').eq('type', 'payment').eq('status', 'completed').gte('paid_at', `${todayStr}T00:00:00`),
      supabase.from('deals').select('id', { count: 'exact', head: true }).eq('funnel', 'leads').eq('status', 'open'),
      supabase.from('tasks').select('id, status').in('status', ['new', 'in_progress', 'overdue']),
      supabase.from('lab_orders').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
    ])

    const aptData = apts.data || []
    const taskData = tasks.data || []

    setStats({
      appointments_total:     aptData.filter(a => !['cancelled','rescheduled'].includes(a.status)).length,
      appointments_confirmed: aptData.filter(a => a.status === 'confirmed').length,
      appointments_arrived:   aptData.filter(a => a.status === 'arrived').length,
      appointments_completed: aptData.filter(a => a.status === 'completed').length,
      appointments_no_show:   aptData.filter(a => a.status === 'no_show').length,
      visits_open:            (visits.data || []).filter(v => v.status === 'in_progress').length,
      revenue_today:          (payments.data || []).reduce((s, p) => s + p.amount, 0),
      new_leads:              leads.count || 0,
      tasks_overdue:          taskData.filter(t => t.status === 'overdue').length,
      tasks_today:            taskData.filter(t => t.status !== 'overdue').length,
      lab_ready:              labOrders.count || 0,
    })

    // Записи на сегодня
    const { data: todayApts } = await supabase
      .from('appointments')
      .select('*, patient:patients(full_name), doctor:doctors(first_name, last_name), service:services(name)')
      .eq('date', todayStr)
      .not('status', 'in', '("cancelled","rescheduled")')
      .order('time_start')
      .limit(8)
    setRecentAppointments(todayApts || [])

    setLoading(false)
  }

  const aptStatusColors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    confirmed: 'bg-blue-100 text-blue-700',
    arrived: 'bg-amber-100 text-amber-700',
    in_progress: 'bg-green-100 text-green-700',
    completed: 'bg-green-50 text-green-600',
    no_show: 'bg-red-100 text-red-600',
  }
  const aptStatusLabels: Record<string, string> = {
    pending: 'Ожидает', confirmed: 'Подтверждена',
    arrived: 'Пришёл', in_progress: 'На приёме',
    completed: 'Завершена', no_show: 'Не явился',
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Приветствие */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Добрый день, {user?.first_name}! 👋
          </h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <PermissionGuard permission="finance:cash_session">
          <CashSessionBar />
        </PermissionGuard>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 animate-pulse">
              <div className="h-3 bg-gray-100 rounded mb-2 w-2/3" />
              <div className="h-6 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : stats && (
        <>
          {/* KPI блоки */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <PermissionGuard permission="schedule:view">
              <StatCard icon="📅" label="Записей сегодня" value={stats.appointments_total}
                sub={`${stats.appointments_completed} завершено`}
                onClick={() => router.push('/schedule')} />
            </PermissionGuard>
            <PermissionGuard permission="visit:view">
              <StatCard icon="🏥" label="На приёме сейчас" value={stats.visits_open}
                color="text-green-600"
                onClick={() => router.push('/visits')} />
            </PermissionGuard>
            <PermissionGuard permission="finance:view">
              <StatCard icon="💰" label="Выручка сегодня" value={`${stats.revenue_today.toLocaleString()} ₸`}
                color="text-green-600"
                onClick={() => router.push('/finance')} />
            </PermissionGuard>
            <PermissionGuard permission="tasks:view">
              <StatCard icon="✅" label="Задачи"
                value={stats.tasks_today + stats.tasks_overdue}
                sub={stats.tasks_overdue > 0 ? `${stats.tasks_overdue} просрочено` : undefined}
                subColor={stats.tasks_overdue > 0 ? 'text-red-500' : undefined}
                onClick={() => router.push('/tasks')} />
            </PermissionGuard>

            {can('schedule:view') && (
              <>
                <StatCard icon="⏳" label="Ожидают" value={stats.appointments_arrived}
                  color="text-amber-600" />
                <StatCard icon="✓" label="Подтверждено" value={stats.appointments_confirmed}
                  color="text-blue-600" />
              </>
            )}
            {stats.appointments_no_show > 0 && can('schedule:view') && (
              <StatCard icon="🚫" label="Не явились" value={stats.appointments_no_show}
                color="text-red-500" />
            )}
            <PermissionGuard permission="lab:view">
              {stats.lab_ready > 0 && (
                <StatCard icon="🔬" label="Анализы готовы" value={stats.lab_ready}
                  color="text-purple-600"
                  onClick={() => router.push('/lab?status=ready')} />
              )}
            </PermissionGuard>
            <PermissionGuard permission="crm:view">
              <StatCard icon="📊" label="Новые лиды" value={stats.new_leads}
                onClick={() => router.push('/crm')} />
            </PermissionGuard>
          </div>

          {/* Записи сегодня */}
          <PermissionGuard permission="schedule:view">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800">Расписание сегодня</h2>
                <button onClick={() => router.push('/schedule')}
                  className="text-sm text-blue-600 hover:text-blue-800">
                  Открыть →
                </button>
              </div>
              {recentAppointments.length === 0 ? (
                <p className="text-center text-gray-400 py-6 text-sm">Записей нет</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {recentAppointments.map(apt => (
                    <div key={apt.id}
                      onClick={() => router.push(`/visits/${apt.id}`)}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50 cursor-pointer transition-colors">
                      <span className="text-sm font-mono text-gray-500 w-12 shrink-0">
                        {apt.time_start?.slice(0, 5)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {apt.patient?.full_name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {apt.doctor?.first_name} {apt.doctor?.last_name}
                          {apt.service?.name && ` · ${apt.service.name}`}
                        </p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${aptStatusColors[apt.status] || 'bg-gray-100'}`}>
                        {aptStatusLabels[apt.status] || apt.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PermissionGuard>
        </>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, sub, color, subColor, onClick }: {
  icon: string; label: string; value: string | number
  sub?: string; color?: string; subColor?: string; onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-gray-200 p-4 ${onClick ? 'cursor-pointer hover:shadow-sm hover:border-blue-200 transition-all' : ''}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
      </div>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${subColor || 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}
