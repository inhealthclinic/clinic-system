'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'

type TaskStatus = 'new' | 'in_progress' | 'done' | 'overdue' | 'cancelled'
type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

interface Task {
  id: string
  title: string
  type: string
  priority: TaskPriority
  status: TaskStatus
  due_at: string
  patient?: { full_name: string }
  assigned_user?: { first_name: string; last_name: string }
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low:    'bg-gray-100 text-gray-500',
  normal: 'bg-blue-100 text-blue-600',
  high:   'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
}
const STATUS_COLORS: Record<TaskStatus, string> = {
  new:         'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done:        'bg-green-100 text-green-700',
  overdue:     'bg-red-100 text-red-600',
  cancelled:   'bg-gray-50 text-gray-400',
}
const STATUS_LABELS: Record<TaskStatus, string> = {
  new: 'Новая', in_progress: 'В работе',
  done: 'Выполнена', overdue: 'Просрочена', cancelled: 'Отменена',
}
const TYPE_ICONS: Record<string, string> = {
  call: '📞', follow_up: '🔄', confirm: '✅', reminder: '🔔',
  lab_ready: '🔬', lab_critical: '⚠️', resample: '🧪',
  control: '📅', referral: '↗️', other: '📝',
}

export default function TasksPage() {
  const supabase = createClient()
  const router = useRouter()
  const { user } = usePermissions()
  const [tasks, setTasks] = useState<Task[]>([])
  const [filter, setFilter] = useState<TaskStatus | 'all'>('all')
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    let q = supabase.from('tasks')
      .select('*, patient:patients(full_name), assigned_user:user_profiles!assigned_to(first_name, last_name)')
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: false })

    if (filter !== 'all') q = q.eq('status', filter)

    const { data } = await q
    setTasks(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  const updateStatus = async (id: string, status: TaskStatus) => {
    await supabase.from('tasks').update({
      status,
      ...(status === 'done' ? { done_at: new Date().toISOString() } : {}),
    }).eq('id', id)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  const counts = {
    all:         tasks.length,
    new:         tasks.filter(t => t.status === 'new').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    overdue:     tasks.filter(t => t.status === 'overdue').length,
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Задачи</h1>
          {counts.overdue > 0 && (
            <p className="text-sm text-red-500 mt-0.5">⚠️ {counts.overdue} просрочено</p>
          )}
        </div>
        <button onClick={() => setShowNew(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-700">
          + Задача
        </button>
      </div>

      {/* Фильтры */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          ['all', `Все (${counts.all})`],
          ['new', `Новые (${counts.new})`],
          ['in_progress', `В работе (${counts.in_progress})`],
          ['overdue', `Просрочено (${counts.overdue})`],
          ['done', 'Выполнены'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
              filter === k
                ? k === 'overdue' ? 'bg-red-600 text-white border-red-600'
                : 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-200 text-gray-600 hover:border-gray-300'
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* Список задач */}
      <div className="space-y-2">
        {loading ? (
          <p className="text-center text-gray-400 py-8">Загрузка...</p>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm">Нет задач</p>
          </div>
        ) : tasks.map(task => (
          <div key={task.id}
            className={`bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-start gap-3 ${
              task.status === 'overdue' ? 'border-red-200 bg-red-50/30' : ''
            }`}>
            {/* Тип иконка */}
            <span className="text-xl shrink-0 mt-0.5">
              {TYPE_ICONS[task.type || 'other'] || '📝'}
            </span>

            {/* Основной контент */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${
                task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'
              }`}>
                {task.title}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {task.patient && (
                  <button onClick={() => router.push(`/patients/${(task as any).patient_id}`)}
                    className="text-xs text-blue-600 hover:underline">
                    👤 {task.patient.full_name}
                  </button>
                )}
                {task.due_at && (
                  <span className={`text-xs ${
                    new Date(task.due_at) < new Date() && task.status !== 'done'
                      ? 'text-red-500 font-medium' : 'text-gray-400'
                  }`}>
                    📅 {new Date(task.due_at).toLocaleDateString('ru', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                )}
                {task.assigned_user && (
                  <span className="text-xs text-gray-400">
                    → {task.assigned_user.first_name} {task.assigned_user.last_name}
                  </span>
                )}
              </div>
            </div>

            {/* Приоритет и статус */}
            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority]}`}>
                {task.priority === 'urgent' ? '🔥 Срочно'
                  : task.priority === 'high' ? 'Высокий'
                  : task.priority === 'low' ? 'Низкий' : ''}
              </span>

              {/* Действия */}
              {task.status !== 'done' && task.status !== 'cancelled' && (
                <div className="flex gap-1">
                  {task.status === 'new' && (
                    <button onClick={() => updateStatus(task.id, 'in_progress')}
                      className="text-xs text-blue-500 border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-50">
                      Взять
                    </button>
                  )}
                  <button onClick={() => updateStatus(task.id, 'done')}
                    className="text-xs text-green-600 border border-green-200 px-2 py-1 rounded-lg hover:bg-green-50">
                    ✓ Готово
                  </button>
                </div>
              )}
              {task.status === 'done' && (
                <span className="text-xs text-green-600">✓ Выполнена</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Новая задача */}
      {showNew && (
        <NewTaskModal
          onClose={() => setShowNew(false)}
          onSave={(t) => { setTasks(prev => [t, ...prev]); setShowNew(false) }}
        />
      )}
    </div>
  )
}

function NewTaskModal({ onClose, onSave }: { onClose: () => void; onSave: (t: any) => void }) {
  const supabase = createClient()
  const { user } = usePermissions()
  const [form, setForm] = useState({
    title: '', type: 'call', priority: 'normal',
    due_at: '', assigned_to: user?.id || '',
  })
  const [users, setUsers] = useState<any[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('user_profiles').select('id, first_name, last_name')
      .eq('is_active', true).then(({ data }) => setUsers(data || []))
  }, [])

  const save = async () => {
    setSaving(true)
    const { data } = await supabase.from('tasks').insert({
      ...form,
      clinic_id: user?.clinic_id,
      created_by: user?.id,
      due_at: form.due_at || null,
    }).select('*, patient:patients(full_name)').single()
    if (data) onSave(data)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Новая задача</h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Задача *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Описание задачи..." className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Тип</label>
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                {Object.entries({ call:'Звонок', follow_up:'Follow-up', confirm:'Подтверждение', reminder:'Напоминание', control:'Контроль', other:'Другое' }).map(([k,v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Приоритет</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                <option value="urgent">🔥 Срочный</option>
                <option value="high">Высокий</option>
                <option value="normal">Обычный</option>
                <option value="low">Низкий</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Срок</label>
            <input type="datetime-local" value={form.due_at} onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Ответственный</label>
            <select value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white">
              {users.map(u => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm">Отмена</button>
          <button onClick={save} disabled={!form.title || saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
            {saving ? '...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  )
}
