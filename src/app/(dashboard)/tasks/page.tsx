'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'
import type { Task } from '@/types'

// ─── constants ───────────────────────────────────────────────────────────────

const PRIORITY_STYLE: Record<string, { cls: string; label: string }> = {
  low:    { cls: 'bg-gray-100 text-gray-500',   label: 'Низкий' },
  normal: { cls: 'bg-blue-100 text-blue-600',   label: 'Обычный' },
  high:   { cls: 'bg-orange-100 text-orange-600', label: 'Высокий' },
  urgent: { cls: 'bg-red-100 text-red-600',     label: 'Срочный' },
}

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  new:         { cls: 'bg-gray-100 text-gray-600',   label: 'Новая' },
  in_progress: { cls: 'bg-blue-100 text-blue-700',   label: 'В работе' },
  done:        { cls: 'bg-green-100 text-green-700', label: 'Готово' },
  overdue:     { cls: 'bg-red-100 text-red-600',     label: 'Просрочена' },
  cancelled:   { cls: 'bg-gray-50 text-gray-400',    label: 'Отменена' },
}

const TASK_TYPES = [
  { value: 'call',       label: '📞 Звонок' },
  { value: 'follow_up',  label: '🔄 Follow-up' },
  { value: 'confirm',    label: '✓ Подтверждение' },
  { value: 'reminder',   label: '🔔 Напоминание' },
  { value: 'other',      label: '📋 Другое' },
]

interface UserRow { id: string; first_name: string; last_name: string }

// ─── CreateTaskModal ──────────────────────────────────────────────────────────

function CreateTaskModal({ clinicId, onClose, onCreated }: {
  clinicId: string
  onClose: () => void
  onCreated: () => void
}) {
  const supabase = createClient()
  const [users, setUsers] = useState<UserRow[]>([])
  const [patients, setPatients] = useState<{ id: string; full_name: string }[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [form, setForm] = useState({
    title: '',
    type: 'call',
    priority: 'normal',
    assigned_to: '',
    patient_id: '',
    due_at: '',
    due_time: '',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .then(({ data }) => setUsers(data ?? []))
  }, [])

  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name')
        .is('deleted_at', null)
        .ilike('full_name', `%${patientSearch}%`)
        .limit(6)
      setPatients(data ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [patientSearch])

  const selectedPatient = patients.find(p => p.id === form.patient_id)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    const dueAt = form.due_at
      ? `${form.due_at}T${form.due_time || '09:00'}:00`
      : null

    const { error: err } = await supabase.from('tasks').insert({
      clinic_id: clinicId,
      title: form.title.trim(),
      type: form.type,
      priority: form.priority,
      status: 'new',
      assigned_to: form.assigned_to || null,
      patient_id: form.patient_id || null,
      due_at: dueAt,
      description: form.description.trim() || null,
    })

    if (err) { setError(err.message); setSaving(false); return }
    onCreated()
    onClose()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900">Новая задача</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Задача <span className="text-red-400">*</span></label>
            <input
              className={inputCls} placeholder="Позвонить пациенту..."
              value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Тип</label>
              <select className={inputCls} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {TASK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Приоритет</label>
              <select className={inputCls} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="low">Низкий</option>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
                <option value="urgent">🔴 Срочный</option>
              </select>
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className={labelCls}>Ответственный</label>
            <select className={inputCls} value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">— не назначен —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>
              ))}
            </select>
          </div>

          {/* Patient */}
          <div className="relative">
            <label className={labelCls}>Пациент</label>
            {form.patient_id ? (
              <div className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-sm text-gray-900">{selectedPatient?.full_name ?? patientSearch}</span>
                <button type="button" onClick={() => setForm(f => ({ ...f, patient_id: '' }))}
                  className="text-gray-400 hover:text-gray-600 text-xs ml-2">✕</button>
              </div>
            ) : (
              <>
                <input
                  className={inputCls}
                  placeholder="Поиск пациента (необязательно)..."
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)}
                />
                {patients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-36 overflow-y-auto">
                    {patients.map(p => (
                      <button key={p.id} type="button"
                        onClick={() => { setForm(f => ({ ...f, patient_id: p.id })); setPatientSearch(p.full_name) }}
                        className="w-full text-left px-4 py-2 hover:bg-gray-50 text-sm text-gray-900">
                        {p.full_name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Due date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Срок (дата)</label>
              <input type="date" className={inputCls} value={form.due_at}
                onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Время</label>
              <input type="time" className={inputCls} value={form.due_time}
                onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className={labelCls}>Описание</label>
            <textarea className={inputCls + ' resize-none'} rows={2}
              placeholder="Дополнительные детали..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={saving}
              className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              {saving ? 'Создание...' : 'Создать задачу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── TaskDetailDrawer ─────────────────────────────────────────────────────────

function TaskDetailDrawer({ task, users, onClose, onUpdate }: {
  task: Task
  users: UserRow[]
  onClose: () => void
  onUpdate: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assignTo, setAssignTo] = useState(task.assigned_to ?? '')

  const updateStatus = async (status: string) => {
    setSaving(true)
    await supabase.from('tasks').update({
      status,
      done_at: status === 'done' ? new Date().toISOString() : null,
      assigned_to: assignTo || null,
    }).eq('id', task.id)
    setSaving(false)
    onUpdate()
    onClose()
  }

  const deleteTask = async () => {
    setDeleting(true)
    await supabase.from('tasks').delete().eq('id', task.id)
    setDeleting(false)
    onUpdate()
    onClose()
  }

  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== 'done'
  const typeLabel = TASK_TYPES.find(t => t.value === task.type)?.label ?? task.type ?? '📋'
  const pStyle = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.normal
  const stStyle = STATUS_STYLE[task.status] ?? STATUS_STYLE.new

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-semibold text-gray-900 leading-snug">{task.title}</p>
            <p className="text-xs text-gray-400 mt-0.5">{typeLabel}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pStyle.cls}`}>{pStyle.label}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${stStyle.cls}`}>{stStyle.label}</span>
          </div>

          {task.due_at && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Срок</p>
              <p className={`text-sm font-medium ${isOverdue ? 'text-red-500' : 'text-gray-700'}`}>
                {isOverdue && '⚠️ '}
                {new Date(task.due_at).toLocaleString('ru-RU', {
                  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          )}

          {task.patient && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Пациент</p>
              <p className="text-sm text-gray-700">{task.patient.full_name}</p>
            </div>
          )}

          {task.description && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Описание</p>
              <p className="text-sm text-gray-700 leading-relaxed">{task.description}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-gray-400 mb-1.5">Ответственный</p>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={assignTo}
              onChange={e => setAssignTo(e.target.value)}
            >
              <option value="">— не назначен —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
          {task.status !== 'done' && (
            <button
              onClick={() => updateStatus('done')}
              disabled={saving}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              ✓ Выполнить
            </button>
          )}
          {task.status === 'new' && (
            <button
              onClick={() => updateStatus('in_progress')}
              disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium"
            >
              → В работу
            </button>
          )}
          {task.status !== 'cancelled' && task.status !== 'done' && (
            <button
              onClick={() => updateStatus('cancelled')}
              disabled={saving}
              className="w-full border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium"
            >
              Отменить
            </button>
          )}
          {/* Delete */}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg py-2 text-sm font-medium transition-colors"
            >
              🗑 Удалить задачу
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium">
                Нет
              </button>
              <button onClick={deleteTask} disabled={deleting}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium">
                {deleting ? '...' : 'Удалить'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [tasks, setTasks] = useState<Task[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'active' | 'done'>('active')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [myTasks, setMyTasks] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<Task | null>(null)

  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .then(({ data }) => setUsers(data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('tasks')
      .select('*, patient:patients(id, full_name), assignee:user_profiles(id, first_name, last_name)')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(200)

    if (filter === 'active') {
      q = q.in('status', ['new', 'in_progress', 'overdue'])
    } else {
      q = q.eq('status', 'done')
    }

    if (myTasks && profile?.id) {
      q = q.eq('assigned_to', profile.id)
    }

    const { data } = await q
    setTasks(data ?? [])
    setLoading(false)
  }, [filter, myTasks, profile?.id])

  useEffect(() => { load() }, [load])

  const toggleDone = async (task: Task, e: React.MouseEvent) => {
    e.stopPropagation()
    const newStatus = task.status === 'done' ? 'new' : 'done'
    await supabase.from('tasks').update({ status: newStatus }).eq('id', task.id)
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
  }

  const visibleTasks = typeFilter === 'all'
    ? tasks
    : tasks.filter(t => t.type === typeFilter)

  const urgentCount  = tasks.filter(t => t.priority === 'urgent').length
  const overdueCount = tasks.filter(t =>
    t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done').length

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['active', 'done'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={[
                  'px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors',
                  filter === f ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                ].join(' ')}>
                {f === 'active' ? 'Активные' : 'Выполненные'}
              </button>
            ))}
          </div>
          <span className="text-sm text-gray-400">{visibleTasks.length}</span>
          {filter === 'active' && overdueCount > 0 && (
            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
              ⚠️ {overdueCount} просрочено
            </span>
          )}
          {filter === 'active' && urgentCount > 0 && (
            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-medium">
              🔴 {urgentCount} срочных
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          Новая задача
        </button>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {/* My tasks toggle */}
        <button
          onClick={() => setMyTasks(v => !v)}
          className={[
            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            myTasks
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50',
          ].join(' ')}>
          👤 Мои задачи
        </button>
        {/* Type filter chips */}
        {[
          { value: 'all',      label: 'Все' },
          { value: 'call',     label: '📞 Звонок' },
          { value: 'follow_up', label: '🔄 Follow-up' },
          { value: 'confirm',  label: '✓ Подтверждение' },
          { value: 'reminder', label: '🔔 Напоминание' },
        ].map(t => (
          <button key={t.value}
            onClick={() => setTypeFilter(t.value)}
            className={[
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              typeFilter === t.value
                ? 'bg-gray-800 border-gray-800 text-white'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50',
            ].join(' ')}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">Загрузка...</div>
      ) : visibleTasks.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm text-gray-400 mb-3">
            {filter === 'active' ? 'Активных задач нет 🎉' : 'Выполненных задач нет'}
          </p>
          {filter === 'active' && (
            <button onClick={() => setShowCreate(true)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              + Создать задачу
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
          {visibleTasks.map(task => {
            const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== 'done'
            const pStyle = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.normal
            const assignee = task.assignee as { first_name: string; last_name: string } | null | undefined
            return (
              <div
                key={task.id}
                onClick={() => setSelected(task)}
                className="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                {/* Checkbox */}
                <button
                  onClick={(e) => toggleDone(task, e)}
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

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-snug ${task.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {task.patient && (
                      <Link
                        href={`/patients/${(task.patient as { id: string; full_name: string }).id}`}
                        onClick={e => e.stopPropagation()}
                        className="text-xs text-blue-500 hover:text-blue-700 hover:underline">
                        {(task.patient as { id: string; full_name: string }).full_name}
                      </Link>
                    )}
                    {assignee && (
                      <span className="text-xs text-gray-400">→ {assignee.last_name} {assignee.first_name}</span>
                    )}
                    {task.due_at && (
                      <span className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                        {isOverdue && '⚠️ '}
                        {new Date(task.due_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                        {' '}
                        {new Date(task.due_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Priority */}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${pStyle.cls}`}>
                  {pStyle.label}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {showCreate && clinicId && (
        <CreateTaskModal
          clinicId={clinicId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); setShowCreate(false) }}
        />
      )}

      {selected && (
        <TaskDetailDrawer
          task={selected}
          users={users}
          onClose={() => setSelected(null)}
          onUpdate={load}
        />
      )}
    </div>
  )
}
