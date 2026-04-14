'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Task } from '@/types'

const PRIORITY_COLOR: Record<string, string> = {
  low: 'bg-gray-100 text-gray-500',
  normal: 'bg-blue-100 text-blue-600',
  high: 'bg-orange-100 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
}

const PRIORITY_RU: Record<string, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
}

const STATUS_COLOR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-600',
  cancelled: 'bg-gray-50 text-gray-400',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'active' | 'done'>('active')

  useEffect(() => {
    setLoading(true)
    const supabase = createClient()
    const query = supabase
      .from('tasks')
      .select('*, patient:patients(id, full_name), assignee:user_profiles(id, first_name, last_name)')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(50)

    const filtered = filter === 'active'
      ? query.in('status', ['new', 'in_progress', 'overdue'])
      : query.eq('status', 'done')

    filtered.then(({ data }) => {
      setTasks(data ?? [])
      setLoading(false)
    })
  }, [filter])

  const toggleDone = async (task: Task) => {
    const supabase = createClient()
    const newStatus = task.status === 'done' ? 'new' : 'done'
    await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id)
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: newStatus } : t))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        {(['active', 'done'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              filter === f
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            {f === 'active' ? 'Активные' : 'Выполненные'}
          </button>
        ))}
        <span className="ml-2 text-sm text-gray-400">{tasks.length}</span>
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">Загрузка...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-400">
          {filter === 'active' ? 'Активных задач нет' : 'Выполненных задач нет'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
          {tasks.map((task) => (
            <div key={task.id} className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors">
              <button
                onClick={() => toggleDone(task)}
                className={[
                  'mt-0.5 w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors',
                  task.status === 'done'
                    ? 'bg-green-500 border-green-500'
                    : 'border-gray-300 hover:border-blue-400',
                ].join(' ')}
              >
                {task.status === 'done' && (
                  <svg width="10" height="10" fill="none" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                  {task.title}
                </p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {task.patient && (
                    <span className="text-xs text-gray-400">{task.patient.full_name}</span>
                  )}
                  {task.due_at && (
                    <span className={`text-xs ${new Date(task.due_at) < new Date() && task.status !== 'done' ? 'text-red-500' : 'text-gray-400'}`}>
                      {new Date(task.due_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLOR[task.priority]}`}>
                  {PRIORITY_RU[task.priority]}
                </span>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[task.status]}`}>
                  {{ new: 'Новая', in_progress: 'В работе', done: 'Готово', overdue: 'Просрочена', cancelled: 'Отменена' }[task.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
