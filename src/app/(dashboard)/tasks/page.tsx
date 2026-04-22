'use client'

/**
 * Модуль «Задачи» — amoCRM-like.
 *
 * Вид «День»  — 4 колонки: Просрочено / Сегодня / Завтра / Позже.
 * Вид «Неделя» — 7 колонок Пн–Вс текущей недели.
 * Вид «Месяц»  — плоский список, сгруппированный по дням.
 *
 * Карточка задачи: приоритет, тип-иконка, заголовок, превью описания,
 * ссылка на сделку (/crm?deal=<id>), ссылка на пациента, ответственный,
 * автор («от ФИО»), дедлайн («Сегодня 14:00», «Просрочена на 2 дня»).
 *
 * Дровер: быстрые действия (выполнить / в работу / отменить / удалить) +
 * поле «Результат задачи» (уходит в description при завершении) — как в amoCRM.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

/* ─── types ─────────────────────────────────────────────────────────────── */

interface TaskRow {
  id: string
  clinic_id: string
  title: string
  description: string | null
  type: string | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'new' | 'in_progress' | 'done' | 'overdue' | 'cancelled'
  assigned_to: string | null
  created_by: string | null
  patient_id: string | null
  deal_id: string | null
  visit_id: string | null
  due_at: string | null
  done_at: string | null
  created_at: string
  patient?: { id: string; full_name: string; phones?: string[] | null } | null
  assignee?: { id: string; first_name: string; last_name: string } | null
  author?:   { id: string; first_name: string; last_name: string } | null
  deal?:     { id: string; name: string | null } | null
}

interface UserRow { id: string; first_name: string; last_name: string }

/* ─── constants ─────────────────────────────────────────────────────────── */

const PRIORITY_STYLE: Record<string, { cls: string; dot: string; label: string }> = {
  low:    { cls: 'bg-gray-100 text-gray-500',     dot: 'bg-gray-300',   label: 'Низкий' },
  normal: { cls: 'bg-blue-100 text-blue-600',     dot: 'bg-blue-400',   label: 'Обычный' },
  high:   { cls: 'bg-orange-100 text-orange-600', dot: 'bg-orange-400', label: 'Высокий' },
  urgent: { cls: 'bg-red-100 text-red-600',       dot: 'bg-red-500',    label: 'Срочный' },
}

const TYPE_META: Record<string, { icon: string; label: string }> = {
  call:         { icon: '📞', label: 'Звонок' },
  follow_up:    { icon: '🔄', label: 'Follow-up' },
  confirm:      { icon: '✓',  label: 'Подтверждение' },
  reminder:     { icon: '🔔', label: 'Напоминание' },
  lab_ready:    { icon: '🧪', label: 'Готов анализ' },
  lab_critical: { icon: '⚠️', label: 'Критический анализ' },
  resample:     { icon: '🩸', label: 'Пересдача' },
  control:      { icon: '🩺', label: 'Контроль' },
  referral:     { icon: '➡️', label: 'Направление' },
  other:        { icon: '📋', label: 'Другое' },
}

const TYPE_OPTIONS = Object.entries(TYPE_META).map(([value, m]) => ({ value, label: `${m.icon} ${m.label}` }))

/* ─── date helpers ──────────────────────────────────────────────────────── */

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0,0,0,0); return c }
function addDays(d: Date, n: number) { const c = new Date(d); c.setDate(c.getDate()+n); return c }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
/** Понедельник текущей недели */
function startOfWeek(d: Date) {
  const c = startOfDay(d)
  const day = (c.getDay() + 6) % 7 // 0 = Monday
  return addDays(c, -day)
}
function fmtDayHeader(d: Date) {
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** «Сегодня 14:00», «Завтра 09:00», «Вчера 15:30», «Просрочена на 2 дня», «22 апр 10:00» */
function fmtRelativeDue(iso: string | null, done: boolean): { label: string; tone: 'red' | 'green' | 'blue' | 'gray' } {
  if (!iso) return { label: '— без срока —', tone: 'gray' }
  const d = new Date(iso)
  const now = new Date()
  const today = startOfDay(now)
  const target = startOfDay(d)
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  const timeStr = fmtTime(iso)
  if (done) return { label: `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${timeStr}`, tone: 'gray' }
  if (d.getTime() < now.getTime()) {
    // прошедшее время
    if (diffDays === 0) return { label: `Сегодня ${timeStr} (просрочена)`, tone: 'red' }
    const days = Math.abs(diffDays)
    const w = days === 1 ? 'день' : (days >= 2 && days <= 4 ? 'дня' : 'дней')
    return { label: `Просрочена на ${days} ${w}`, tone: 'red' }
  }
  if (diffDays === 0) return { label: `Сегодня ${timeStr}`, tone: 'green' }
  if (diffDays === 1) return { label: `Завтра ${timeStr}`, tone: 'blue' }
  if (diffDays > 1 && diffDays < 7) return { label: `${d.toLocaleDateString('ru-RU', { weekday: 'short' })} ${timeStr}`, tone: 'gray' }
  return { label: `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${timeStr}`, tone: 'gray' }
}

function bucketOf(task: TaskRow, refNow: Date): 'overdue' | 'today' | 'tomorrow' | 'later' {
  if (!task.due_at) return 'later'
  const d = new Date(task.due_at)
  const today = startOfDay(refNow)
  const tomorrow = addDays(today, 1)
  const dayAfter = addDays(today, 2)
  if (d.getTime() < today.getTime()) return 'overdue'
  // «сегодня просрочена» всё равно в колонке «Сегодня», чтобы было на виду
  if (d.getTime() < now().getTime() && sameDay(d, refNow)) return 'today'
  if (d.getTime() < tomorrow.getTime()) return 'today'
  if (d.getTime() < dayAfter.getTime()) return 'tomorrow'
  return 'later'
}
function now() { return new Date() }

/* ─── CSV export ───────────────────────────────────────────────────────────
   Выгружаем отфильтрованный список в CSV с UTF-8 BOM, чтобы Excel правильно
   подхватывал кириллицу. Разделитель — точка с запятой (русская локаль Excel). */
function exportTasksCsv(tasks: TaskRow[]): void {
  if (typeof window === 'undefined') return
  const esc = (s: string | null | undefined) => {
    const v = (s ?? '').toString().replace(/"/g, '""')
    return `"${v}"`
  }
  const header = ['Заголовок','Описание','Тип','Приоритет','Статус','Срок','Исполнитель','Автор','Пациент','Телефон','Сделка','Создано','Выполнено']
  const rows = tasks.map(t => [
    t.title,
    t.description,
    TYPE_META[t.type as keyof typeof TYPE_META]?.label ?? t.type,
    PRIORITY_STYLE[t.priority as keyof typeof PRIORITY_STYLE]?.label ?? t.priority,
    t.status,
    t.due_at ? new Date(t.due_at).toLocaleString('ru-RU') : '',
    t.assignee ? `${t.assignee.last_name} ${t.assignee.first_name}` : '',
    t.author ? `${t.author.last_name} ${t.author.first_name}` : '',
    t.patient?.full_name ?? '',
    t.patient?.phones?.[0] ?? '',
    t.deal?.name ?? (t.deal?.id ?? ''),
    t.created_at ? new Date(t.created_at).toLocaleString('ru-RU') : '',
    t.done_at ? new Date(t.done_at).toLocaleString('ru-RU') : '',
  ].map(esc).join(';'))
  const csv = '\uFEFF' + [header.map(esc).join(';'), ...rows].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tasks-${new Date().toISOString().slice(0,10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/* ─── CreateTaskModal ───────────────────────────────────────────────────── */

function CreateTaskModal({ clinicId, onClose, onCreated, dealId, patientId }: {
  clinicId: string
  onClose: () => void
  onCreated: () => void
  dealId?: string | null
  patientId?: string | null
}) {
  const supabase = createClient()
  const { profile } = useAuthStore()
  const [users, setUsers] = useState<UserRow[]>([])
  const [patients, setPatients] = useState<{ id: string; full_name: string }[]>([])
  const [patientSearch, setPatientSearch] = useState('')
  const [form, setForm] = useState({
    title: '',
    type: 'call',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    assigned_to: profile?.id ?? '',
    patient_id: patientId ?? '',
    deal_id: dealId ?? '',
    due_at: new Date().toISOString().slice(0, 10),
    due_time: '18:00',
    description: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('user_profiles')
      .select('id, first_name, last_name')
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => setUsers((data ?? []) as UserRow[]))
  }, [supabase])

  useEffect(() => {
    if (patientSearch.length < 2) { setPatients([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('patients')
        .select('id, full_name')
        .is('deleted_at', null)
        .ilike('full_name', `%${patientSearch}%`)
        .limit(6)
      setPatients((data ?? []) as { id: string; full_name: string }[])
    }, 250)
    return () => clearTimeout(t)
  }, [patientSearch, supabase])

  const selectedPatient = patients.find(p => p.id === form.patient_id)

  const quickSlots = [
    { label: 'Через 15 мин', offsetMin: 15 },
    { label: 'Через 1 час',  offsetMin: 60 },
    { label: 'Сегодня 18:00', date: startOfDay(now()), time: '18:00' },
    { label: 'Завтра 10:00',  date: addDays(startOfDay(now()), 1), time: '10:00' },
    { label: 'Завтра 18:00',  date: addDays(startOfDay(now()), 1), time: '18:00' },
    { label: 'Через неделю',  date: addDays(startOfDay(now()), 7), time: '10:00' },
  ]

  const applyQuickSlot = (slot: typeof quickSlots[number]) => {
    if (slot.offsetMin) {
      const d = new Date(Date.now() + slot.offsetMin * 60_000)
      setForm(f => ({
        ...f,
        due_at: d.toISOString().slice(0, 10),
        due_time: d.toTimeString().slice(0, 5),
      }))
    } else if (slot.date && slot.time) {
      setForm(f => ({
        ...f,
        due_at: slot.date!.toISOString().slice(0, 10),
        due_time: slot.time!,
      }))
    }
  }

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
      created_by: profile?.id ?? null,
      patient_id: form.patient_id || null,
      deal_id: form.deal_id || null,
      due_at: dueAt,
      description: form.description.trim() || null,
    })
    if (err) { setError(err.message); setSaving(false); return }
    onCreated(); onClose()
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10 max-h-[92vh] overflow-y-auto">
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
                {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Приоритет</label>
              <select className={inputCls} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as typeof f.priority }))}>
                <option value="low">Низкий</option>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
                <option value="urgent">🔴 Срочный</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Ответственный</label>
            <select className={inputCls} value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">— не назначен —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>
              ))}
            </select>
          </div>

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
                <input className={inputCls}
                  placeholder="Поиск пациента (необязательно)..."
                  value={patientSearch}
                  onChange={e => setPatientSearch(e.target.value)} />
                {patients.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-10 max-h-40 overflow-y-auto">
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

          <div>
            <label className={labelCls}>Срок</label>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" className={inputCls} value={form.due_at}
                onChange={e => setForm(f => ({ ...f, due_at: e.target.value }))} />
              <input type="time" className={inputCls} value={form.due_time}
                onChange={e => setForm(f => ({ ...f, due_time: e.target.value }))} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {quickSlots.map(s => (
                <button key={s.label} type="button" onClick={() => applyQuickSlot(s)}
                  className="text-[11px] px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
                  {s.label}
                </button>
              ))}
            </div>
          </div>

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

/* ─── TaskDetailDrawer ──────────────────────────────────────────────────── */

function TaskDetailDrawer({ task, users, onClose, onUpdate }: {
  task: TaskRow
  users: UserRow[]
  onClose: () => void
  onUpdate: () => void
}) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [assignTo, setAssignTo] = useState(task.assigned_to ?? '')
  const [priority, setPriority] = useState(task.priority)
  const [due, setDue] = useState(task.due_at ? task.due_at.slice(0, 16) : '')
  const [result, setResult] = useState('')

  const persist = async (patch: Partial<TaskRow>) => {
    setSaving(true)
    await supabase.from('tasks').update(patch).eq('id', task.id)
    setSaving(false)
    onUpdate()
  }

  const complete = async () => {
    setSaving(true)
    const patch: Record<string, unknown> = {
      status: 'done',
      done_at: new Date().toISOString(),
      assigned_to: assignTo || null,
      priority,
    }
    if (result.trim()) {
      // Добавляем «результат задачи» в конец описания с меткой времени —
      // это amoCRM-style: при завершении фиксируешь итог, и он остаётся в карточке.
      const stamp = new Date().toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      patch.description = [(task.description ?? '').trim(), `\n[Результат · ${stamp}] ${result.trim()}`]
        .filter(Boolean).join('\n').trim()
    }
    if (due) {
      patch.due_at = new Date(due).toISOString()
    }
    await supabase.from('tasks').update(patch).eq('id', task.id)
    setSaving(false)
    onUpdate()
    onClose()
  }

  const updateStatus = async (status: string) => {
    await persist({
      status: status as TaskRow['status'],
      done_at: status === 'done' ? new Date().toISOString() : null,
      assigned_to: assignTo || null,
      priority,
      due_at: due ? new Date(due).toISOString() : null,
    } as Partial<TaskRow>)
    onClose()
  }

  const deleteTask = async () => {
    setDeleting(true)
    await supabase.from('tasks').delete().eq('id', task.id)
    setDeleting(false)
    onUpdate(); onClose()
  }

  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== 'done'
  const typeMeta = (task.type && TYPE_META[task.type]) || TYPE_META.other
  const pStyle = PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.normal

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[380px] bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0 pr-3">
            <p className="text-sm font-semibold text-gray-900 leading-snug">
              <span className="mr-1.5">{typeMeta.icon}</span>{task.title}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{typeMeta.label}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          {/* Статус + приоритет */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${pStyle.cls}`}>{pStyle.label}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              task.status === 'done' ? 'bg-green-100 text-green-700' :
              task.status === 'cancelled' ? 'bg-gray-100 text-gray-400' :
              isOverdue ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-700'
            }`}>
              {task.status === 'done' ? 'Выполнена' :
               task.status === 'cancelled' ? 'Отменена' :
               isOverdue ? 'Просрочена' : 'Активная'}
            </span>
          </div>

          {/* Срок — редактируемый */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Срок</p>
            <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          {/* Приоритет */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Приоритет</p>
            <select value={priority} onChange={e => setPriority(e.target.value as TaskRow['priority'])}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
              <option value="low">Низкий</option>
              <option value="normal">Обычный</option>
              <option value="high">Высокий</option>
              <option value="urgent">🔴 Срочный</option>
            </select>
          </div>

          {/* Ответственный */}
          <div>
            <p className="text-xs text-gray-400 mb-1.5">Ответственный</p>
            <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— не назначен —</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>
              ))}
            </select>
          </div>

          {/* Ссылки: пациент / сделка */}
          {(task.patient || task.deal) && (
            <div className="space-y-1.5">
              {task.patient && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Пациент</p>
                  <Link href={`/patients/${task.patient.id}`}
                    className="text-sm text-blue-600 hover:text-blue-700 hover:underline">
                    {task.patient.full_name}
                  </Link>
                  {task.patient.phones?.[0] && (
                    <span className="text-xs text-gray-400 ml-2">{task.patient.phones[0]}</span>
                  )}
                </div>
              )}
              {task.deal && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Сделка</p>
                  <Link href={`/crm?deal=${task.deal.id}`}
                    className="text-sm text-blue-600 hover:text-blue-700 hover:underline">
                    {task.deal.name || `Сделка #${task.deal.id.slice(0, 8)}`}
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Автор */}
          {task.author && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Автор</p>
              <p className="text-sm text-gray-700">{task.author.last_name} {task.author.first_name}</p>
              <p className="text-xs text-gray-400">
                {new Date(task.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}

          {/* Описание */}
          {task.description && (
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Описание</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* Результат (amoCRM-style) */}
          {task.status !== 'done' && task.status !== 'cancelled' && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">Результат задачи</p>
              <textarea value={result} onChange={e => setResult(e.target.value)} rows={3}
                placeholder="Что сделано, о чём договорились, следующие шаги..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              <p className="text-[11px] text-gray-400 mt-1">Добавится в описание с меткой времени при завершении.</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0 space-y-2">
          {task.status !== 'done' && (
            <button onClick={complete} disabled={saving}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              ✓ Выполнить
            </button>
          )}
          {task.status === 'new' && (
            <button onClick={() => updateStatus('in_progress')} disabled={saving}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium">
              → В работу
            </button>
          )}
          {task.status === 'done' && (
            <button onClick={() => updateStatus('new')} disabled={saving}
              className="w-full border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium">
              ↺ Вернуть в работу
            </button>
          )}
          {task.status !== 'cancelled' && task.status !== 'done' && (
            <button onClick={() => updateStatus('cancelled')} disabled={saving}
              className="w-full border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium">
              Отменить
            </button>
          )}
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              className="w-full border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg py-2 text-sm font-medium transition-colors">
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

/* ─── TaskCard ─────────────────────────────────────────────────────────── */

function TaskCard({ task, onClick, density = 'detailed' }: {
  task: TaskRow
  onClick: () => void
  onQuickComplete: (t: TaskRow, e: React.MouseEvent) => void
  density?: 'compact' | 'detailed'
}) {
  const due = fmtRelativeDue(task.due_at, task.status === 'done')
  // amoCRM colors the date in the card: красный — просрочено, зелёный — сегодня, серый — остальные.
  const dueCls = due.tone === 'red' ? 'text-red-500' : due.tone === 'green' ? 'text-green-600' : due.tone === 'blue' ? 'text-gray-500' : 'text-gray-500'

  // Вверху карточки — телефон пациента, как в amoCRM (первичный идентификатор).
  // Если нет — ФИО. Если нет и этого — заголовок задачи.
  const topLine = task.patient?.phones?.[0]
    || task.patient?.full_name
    || task.title
  const authorName = task.author
    ? `${task.author.last_name} ${task.author.first_name[0] ?? ''}.`.trim()
    : null

  if (density === 'compact') {
    // Компактный режим: только название + срок. Без деталей — удобно при
    // большом количестве задач в колонке.
    return (
      <div onClick={onClick}
        className="bg-white border border-gray-200 rounded-md px-2.5 py-1.5 cursor-pointer hover:shadow-sm hover:border-gray-300 transition-all">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-gray-900 font-medium truncate flex-1">{task.title}</span>
          <span className={`text-[11px] shrink-0 ${dueCls}`}>{due.label}</span>
        </div>
      </div>
    )
  }

  return (
    <div onClick={onClick}
      className="bg-white border border-gray-200 rounded-lg p-3 cursor-pointer hover:shadow-md hover:border-gray-300 transition-all">
      {/* Телефон / имя */}
      <div className="text-sm text-gray-900 font-medium truncate">{topLine}</div>

      {/* Ссылка на сделку */}
      {task.deal && (
        <Link href={`/crm?deal=${task.deal.id}`} onClick={e => e.stopPropagation()}
          className="block text-sm text-blue-500 hover:text-blue-700 hover:underline mt-1 truncate">
          {task.deal.name || `Сделка #${task.deal.id.slice(0, 8)}`}
        </Link>
      )}

      {/* Дата + автор */}
      <div className={`text-xs mt-1.5 ${dueCls}`}>
        <span>{due.label}</span>
        {authorName && <span className="text-gray-500">, от {authorName}</span>}
      </div>

      {/* Заголовок задачи + описание (как «Связаться: …» в amoCRM) */}
      <div className="mt-2 text-xs text-gray-700 leading-relaxed line-clamp-4">
        <span className="font-semibold">{task.title}{task.description ? ':' : ''}</span>
        {task.description && <span className="text-gray-600"> {task.description}</span>}
      </div>
    </div>
  )
}

/* ─── Main Page ────────────────────────────────────────────────────────── */

type View = 'day' | 'week' | 'month'

export default function TasksPage() {
  const supabase = useMemo(() => createClient(), [])
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)

  // Фильтры
  const [view, setView] = useState<View>('day')
  const [status, setStatus] = useState<'active' | 'done' | 'all'>('active')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all') // 'all' | 'me' | userId
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<TaskRow | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [refTick, setRefTick] = useState(0) // для обновления «сейчас» каждую минуту
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [cardDensity, setCardDensity] = useState<'compact' | 'detailed'>('detailed')
  const [showTypeManager, setShowTypeManager] = useState(false)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')

  // Восстанавливаем выбор view из localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    const v = window.localStorage.getItem('tasks.view')
    if (v === 'day' || v === 'week' || v === 'month') setView(v)
    const a = window.localStorage.getItem('tasks.assignee')
    if (a) setAssigneeFilter(a)
    const ar = window.localStorage.getItem('tasks.autoRefresh')
    if (ar === '0') setAutoRefresh(false)
    const cd = window.localStorage.getItem('tasks.cardDensity')
    if (cd === 'compact' || cd === 'detailed') setCardDensity(cd)
    const lay = window.localStorage.getItem('tasks.layout')
    if (lay === 'grid' || lay === 'list') setLayout(lay)
  }, [])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tasks.layout', layout)
  }, [layout])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tasks.autoRefresh', autoRefresh ? '1' : '0')
  }, [autoRefresh])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tasks.cardDensity', cardDensity)
  }, [cardDensity])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tasks.view', view)
  }, [view])
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('tasks.assignee', assigneeFilter)
  }, [assigneeFilter])

  // Раз в минуту дергаем «сейчас», чтобы «просрочено на N» и бакеты оставались актуальными
  useEffect(() => {
    const i = setInterval(() => setRefTick(t => t + 1), 60_000)
    return () => clearInterval(i)
  }, [])

  useEffect(() => {
    if (!clinicId) return
    supabase.from('user_profiles')
      .select('id, first_name, last_name')
      .eq('clinic_id', clinicId)
      .eq('is_active', true)
      .order('first_name')
      .then(({ data }) => setUsers((data ?? []) as UserRow[]))
  }, [supabase, clinicId])

  const load = useCallback(async () => {
    if (!clinicId) return
    setLoading(true)
    // Грузим широко — фильтрация клиентская (до ~500 задач это мгновенно).
    let q = supabase
      .from('tasks')
      .select(`
        *,
        patient:patients(id, full_name, phones),
        assignee:user_profiles!tasks_assigned_to_fkey(id, first_name, last_name),
        author:user_profiles!tasks_created_by_fkey(id, first_name, last_name),
        deal:deals(id, name)
      `)
      .eq('clinic_id', clinicId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(500)
    if (status === 'active') q = q.in('status', ['new','in_progress','overdue'])
    else if (status === 'done') q = q.eq('status', 'done')
    const { data, error } = await q
    if (error) { console.error(error); setTasks([]); setLoading(false); return }
    setTasks((data ?? []) as unknown as TaskRow[])
    setLoading(false)
  }, [clinicId, status, supabase])

  useEffect(() => { load() }, [load])

  // Автообновление: раз в 60 секунд заново тянем задачи.
  // Realtime ловит изменения мгновенно, но автообновление страхует на случай
  // потери соединения или пропущенных событий.
  useEffect(() => {
    if (!autoRefresh) return
    const i = setInterval(() => { load() }, 60_000)
    return () => clearInterval(i)
  }, [autoRefresh, load])

  // Realtime: новые задачи/изменения сразу подъезжают
  useEffect(() => {
    if (!clinicId) return
    const ch = supabase.channel(`tasks:${clinicId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `clinic_id=eq.${clinicId}` },
        () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clinicId, supabase, load])

  const quickComplete = useCallback(async (task: TaskRow, e: React.MouseEvent) => {
    e.stopPropagation()
    const toDone = task.status !== 'done'
    await supabase.from('tasks').update({
      status: toDone ? 'done' : 'new',
      done_at: toDone ? new Date().toISOString() : null,
    }).eq('id', task.id)
    setTasks(prev => prev.map(t => t.id === task.id
      ? { ...t, status: toDone ? 'done' : 'new', done_at: toDone ? new Date().toISOString() : null }
      : t))
  }, [supabase])

  /* ─── filters ─── */
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter(t => {
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (assigneeFilter === 'me' && t.assigned_to !== profile?.id) return false
      if (assigneeFilter !== 'all' && assigneeFilter !== 'me' && t.assigned_to !== assigneeFilter) return false
      if (!q) return true
      const hay = [
        t.title, t.description ?? '',
        t.patient?.full_name ?? '', t.patient?.phones?.join(' ') ?? '',
        t.deal?.name ?? '',
        t.assignee ? `${t.assignee.last_name} ${t.assignee.first_name}` : '',
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [tasks, search, typeFilter, assigneeFilter, profile?.id])

  /* ─── grouping per view ─── */
  const refNow = useMemo(() => new Date(), [refTick])

  const dayBuckets = useMemo(() => {
    const b: Record<'overdue'|'today'|'tomorrow'|'later', TaskRow[]> = { overdue: [], today: [], tomorrow: [], later: [] }
    for (const t of filteredTasks) b[bucketOf(t, refNow)].push(t)
    return b
  }, [filteredTasks, refNow])

  const weekCols = useMemo(() => {
    const start = startOfWeek(refNow)
    const cols: { date: Date; items: TaskRow[] }[] = []
    for (let i = 0; i < 7; i++) cols.push({ date: addDays(start, i), items: [] })
    const noDate: TaskRow[] = []
    const endOfWeek = addDays(start, 7)
    for (const t of filteredTasks) {
      if (!t.due_at) { noDate.push(t); continue }
      const d = new Date(t.due_at)
      if (d < start) { cols[0].items.push(t); continue } // просроченные до недели — в понедельник
      if (d >= endOfWeek) continue // за пределами недели
      const idx = Math.floor((startOfDay(d).getTime() - start.getTime()) / 86_400_000)
      if (idx >= 0 && idx < 7) cols[idx].items.push(t)
    }
    return { cols, noDate }
  }, [filteredTasks, refNow])

  const monthGroups = useMemo(() => {
    // группируем по дате (YYYY-MM-DD) в пределах текущего месяца + просроченные
    const map = new Map<string, TaskRow[]>()
    const overdue: TaskRow[] = []
    const noDate: TaskRow[] = []
    const monthStart = new Date(refNow.getFullYear(), refNow.getMonth(), 1)
    const monthEnd = new Date(refNow.getFullYear(), refNow.getMonth() + 1, 1)
    for (const t of filteredTasks) {
      if (!t.due_at) { noDate.push(t); continue }
      const d = new Date(t.due_at)
      if (d < startOfDay(refNow) && t.status !== 'done') { overdue.push(t); continue }
      if (d < monthStart || d >= monthEnd) continue
      const key = startOfDay(d).toISOString().slice(0, 10)
      const arr = map.get(key) ?? []
      arr.push(t); map.set(key, arr)
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
    return { groups: sorted.map(([date, items]) => ({ date: new Date(date), items })), overdue, noDate }
  }, [filteredTasks, refNow])

  /* ─── counters ─── */
  const urgentCount  = filteredTasks.filter(t => t.priority === 'urgent' && t.status !== 'done').length
  const overdueCount = dayBuckets.overdue.length

  /* ─── render ─── */
  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Controls row — как в amoCRM: день/неделя/месяц, фильтры, счётчик, ···, кнопка.
          nowrap + мин. padding'и, чтобы всё помещалось в одну строку на десктопе. */}
      <div className="flex items-center gap-2 mb-4 flex-nowrap overflow-x-auto">
        {/* View toggle: плоские текстовые кнопки «ДЕНЬ / НЕДЕЛЯ / МЕСЯЦ»
            (амоCRM-стиль — uppercase, letter-spaced, активный чёрный-жирный) */}
        <div className="flex items-center gap-3 shrink-0">
          {([
            ['day',   'День'],
            ['week',  'Неделя'],
            ['month', 'Месяц'],
          ] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`text-[11px] uppercase tracking-[0.1em] transition-colors whitespace-nowrap ${
                view === v ? 'text-gray-900 font-semibold' : 'text-gray-400 font-medium hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Разделитель */}
        <div className="h-5 w-px bg-gray-200 shrink-0" />

        {/* Layout toggle: сетка (колонки) / список (плоский) */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setLayout('grid')}
            title="Сетка"
            className={`p-1 rounded-md transition-colors ${
              layout === 'grid' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3"  y="3"  width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
              <rect x="14" y="3"  width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
              <rect x="3"  y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
              <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
            </svg>
          </button>
          <button onClick={() => setLayout('list')}
            title="Список"
            className={`p-1 rounded-md transition-colors ${
              layout === 'list' ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Разделитель */}
        <div className="h-5 w-px bg-gray-200 shrink-0" />

        {/* Status toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 shrink-0">
          {([
            ['active', 'Активные'],
            ['done',   'Выполненные'],
            ['all',    'Все'],
          ] as const).map(([s, label]) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                status === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[140px] max-w-[240px]">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
            <path d="M21 21l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input type="text" placeholder="Поиск..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {/* Assignee filter */}
        <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 bg-white shrink-0 max-w-[150px]">
          <option value="all">Все ответственные</option>
          <option value="me">👤 Мои задачи</option>
          <option value="">— не назначен —</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.last_name} {u.first_name}</option>
          ))}
        </select>

        {/* right cluster: count · ··· · add */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {filteredTasks.length} {(() => {
              const n = filteredTasks.length, mod10 = n % 10, mod100 = n % 100
              if (mod100 >= 11 && mod100 <= 14) return 'задач'
              if (mod10 === 1) return 'задача'
              if (mod10 >= 2 && mod10 <= 4) return 'задачи'
              return 'задач'
            })()}
          </span>
          {overdueCount > 0 && status !== 'done' && (
            <span className="text-[11px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
              {overdueCount} просрочено
            </span>
          )}
          {urgentCount > 0 && (
            <span className="text-[11px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap">
              {urgentCount} срочных
            </span>
          )}
          <div className="relative">
            <button onClick={() => setMoreOpen(v => !v)}
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
              title="Ещё">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>
              </svg>
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[260px] z-20 text-sm">
                  {/* Управление типами задач — открывает модалку со списком */}
                  <button onClick={() => { setShowTypeManager(true); setMoreOpen(false) }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2">
                    <span className="w-4 text-center">⏰</span>
                    <span>Управление типами задач</span>
                  </button>
                  {/* Экспорт — CSV текущих отфильтрованных задач */}
                  <button onClick={() => { exportTasksCsv(filteredTasks); setMoreOpen(false) }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2">
                    <span className="w-4 text-center">⬆️</span>
                    <span>Экспорт</span>
                  </button>
                  {/* Синхронизировать — форс-перезагрузка */}
                  <button onClick={() => { load(); setMoreOpen(false) }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center gap-2">
                    <span className="w-4 text-center">🗓</span>
                    <span>Синхронизировать</span>
                  </button>
                  {/* Внешний вид карточки — переключатель подробный / компактный */}
                  <div className="border-t border-gray-100 my-1" />
                  <div className="px-3 py-1.5 text-[11px] text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <span className="w-4 text-center">✨</span>
                    <span>Внешний вид карточки</span>
                  </div>
                  <button onClick={() => { setCardDensity('detailed'); setMoreOpen(false) }}
                    className={`w-full text-left pl-9 pr-3 py-1.5 hover:bg-gray-50 flex items-center justify-between ${cardDensity === 'detailed' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                    <span>Подробный</span>
                    {cardDensity === 'detailed' && <span>✓</span>}
                  </button>
                  <button onClick={() => { setCardDensity('compact'); setMoreOpen(false) }}
                    className={`w-full text-left pl-9 pr-3 py-1.5 hover:bg-gray-50 flex items-center justify-between ${cardDensity === 'compact' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}>
                    <span>Компактный</span>
                    {cardDensity === 'compact' && <span>✓</span>}
                  </button>
                  {/* Автообновление — тумблер */}
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={() => setAutoRefresh(v => !v)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 flex items-center justify-between">
                    <span>Автообновление</span>
                    {autoRefresh && <span className="text-blue-600">✓</span>}
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0">
            <svg width="11" height="11" fill="none" viewBox="0 0 24 24">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
            Добавить задачу
          </button>
        </div>
      </div>

      {/* Body — колонки рендерим всегда, даже если пусто (как в amoCRM:
          видишь три столбца с «0 задач», а не общий пустой плейсхолдер). */}
      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">Загрузка...</div>
      ) : layout === 'list' ? (
        // Плоский список — склеиваем bucket'ы по порядку (просрочено → сегодня
        // → завтра → позже → без срока) и рендерим одной колонкой с разделителями.
        <TaskFlatList
          buckets={[
            { title: 'Просроченные задачи', tone: 'red',   items: dayBuckets.overdue },
            { title: 'Задачи на сегодня',    tone: 'green', items: dayBuckets.today },
            { title: 'Задачи на завтра',     tone: 'blue',  items: dayBuckets.tomorrow },
            { title: 'Позже',                tone: 'gray',  items: dayBuckets.later },
          ]}
          onClick={t => setSelected(t)}
          onQuickComplete={quickComplete}
          density={cardDensity}
        />
      ) : view === 'day' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ColumnBlock title="Просроченные задачи" count={dayBuckets.overdue.length} tone="red"
            items={dayBuckets.overdue} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
          <ColumnBlock title="Задачи на сегодня" count={dayBuckets.today.length} tone="green"
            items={dayBuckets.today} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
          <ColumnBlock title="Задачи на завтра" count={dayBuckets.tomorrow.length} tone="blue"
            items={dayBuckets.tomorrow} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
        </div>
      ) : view === 'week' ? (
        <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-3">
          {weekCols.cols.map((col, i) => {
            const isToday = sameDay(col.date, refNow)
            return (
              <ColumnBlock key={i} title={fmtDayHeader(col.date)} count={col.items.length}
                tone={isToday ? 'green' : 'gray'} highlight={isToday}
                items={col.items} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
            )
          })}
          {weekCols.noDate.length > 0 && (
            <ColumnBlock title="Без срока" count={weekCols.noDate.length} tone="gray"
              items={weekCols.noDate} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {monthGroups.overdue.length > 0 && (
            <GroupBlock title="Просроченные" count={monthGroups.overdue.length} tone="red"
              items={monthGroups.overdue} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
          )}
          {monthGroups.groups.map(g => (
            <GroupBlock key={g.date.toISOString()}
              title={g.date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
              count={g.items.length}
              tone={sameDay(g.date, refNow) ? 'green' : 'gray'}
              items={g.items} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
          ))}
          {monthGroups.noDate.length > 0 && (
            <GroupBlock title="Без срока" count={monthGroups.noDate.length} tone="gray"
              items={monthGroups.noDate} onClick={t => setSelected(t)} onQuickComplete={quickComplete} density={cardDensity} />
          )}
        </div>
      )}

      {showCreate && clinicId && (
        <CreateTaskModal clinicId={clinicId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { load(); setShowCreate(false) }} />
      )}

      {selected && (
        <TaskDetailDrawer task={selected} users={users}
          onClose={() => setSelected(null)} onUpdate={load} />
      )}

      {showTypeManager && (
        <TaskTypeManagerModal
          tasks={tasks}
          activeType={typeFilter}
          onPick={v => { setTypeFilter(v); setShowTypeManager(false) }}
          onClose={() => setShowTypeManager(false)} />
      )}
    </div>
  )
}

/* ─── Flat list layout ──────────────────────────────────────────────────────
   Альтернативный вид: одна колонка во всю ширину, с разделами-плашками
   между бакетами. Удобно, когда задач мало или хочется обычный список. */
function TaskFlatList({ buckets, onClick, onQuickComplete, density }: {
  buckets: { title: string; tone: 'red' | 'green' | 'blue' | 'gray'; items: TaskRow[] }[]
  onClick: (t: TaskRow) => void
  onQuickComplete: (t: TaskRow, e: React.MouseEvent) => void
  density: 'compact' | 'detailed'
}) {
  const toneBar = { red: 'bg-red-400', green: 'bg-emerald-400', blue: 'bg-sky-400', gray: 'bg-gray-300' }
  const toneText = { red: 'text-red-600', green: 'text-emerald-700', blue: 'text-sky-700', gray: 'text-gray-600' }
  return (
    <div className="space-y-4">
      {buckets.map(b => (
        <div key={b.title}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-1 h-4 rounded ${toneBar[b.tone]}`} />
            <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${toneText[b.tone]}`}>
              {b.title}
            </span>
            <span className="text-xs text-gray-400">{b.items.length}</span>
          </div>
          {b.items.length === 0 ? (
            <div className="text-xs text-gray-300 py-2 pl-3">—</div>
          ) : (
            <div className="space-y-2">
              {b.items.map(t => (
                <TaskCard key={t.id} task={t}
                  onClick={() => onClick(t)}
                  onQuickComplete={onQuickComplete}
                  density={density} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/* ─── Task Type Manager ─────────────────────────────────────────────────────
   amoCRM-like «Управление типами задач» — показывает все доступные типы
   с иконками и количеством задач по каждому. Клик по типу фильтрует доску.
   Справочник типов у нас зашит в TYPE_META (миграция под пользовательские
   типы пока не создана — когда появится таблица task_types, эту модалку
   можно будет расширить CRUD-операциями). */
function TaskTypeManagerModal({ tasks, activeType, onPick, onClose }: {
  tasks: TaskRow[]
  activeType: string
  onPick: (value: string) => void
  onClose: () => void
}) {
  const counts = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const t of tasks) {
      const k = (t.type ?? 'other') as string
      acc[k] = (acc[k] ?? 0) + 1
    }
    return acc
  }, [tasks])
  const total = tasks.length

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Управление типами задач</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto py-2">
          <button onClick={() => onPick('all')}
            className={`w-full text-left px-5 py-2.5 hover:bg-gray-50 flex items-center justify-between ${activeType === 'all' ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
            <span className="flex items-center gap-3">
              <span className="w-6 text-center">∀</span>
              <span className="text-sm font-medium">Все типы</span>
            </span>
            <span className="text-xs text-gray-400">{total}</span>
          </button>
          <div className="border-t border-gray-100 my-1" />
          {Object.entries(TYPE_META).map(([value, m]) => (
            <button key={value} onClick={() => onPick(value)}
              className={`w-full text-left px-5 py-2.5 hover:bg-gray-50 flex items-center justify-between ${activeType === value ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}>
              <span className="flex items-center gap-3">
                <span className="w-6 text-center text-base">{m.icon}</span>
                <span className="text-sm">{m.label}</span>
              </span>
              <span className="text-xs text-gray-400">{counts[value] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400">
          Типы задач определены системой. Чтобы добавить пользовательские
          типы, создайте таблицу <code className="text-gray-500">task_types</code> и расширьте справочник.
        </div>
      </div>
    </div>
  )
}

/* ─── Small layout building blocks ──────────────────────────────────────── */

function ColumnBlock({ title, count, tone, highlight = false, items, onClick, onQuickComplete, density = 'detailed' }: {
  title: string; count: number
  tone: 'red' | 'green' | 'blue' | 'gray'
  highlight?: boolean
  items: TaskRow[]
  onClick: (t: TaskRow) => void
  onQuickComplete: (t: TaskRow, e: React.MouseEvent) => void
  density?: 'compact' | 'detailed'
}) {
  const underlineCls = {
    red:   'bg-red-300',
    green: 'bg-emerald-300',
    blue:  'bg-sky-300',
    gray:  'bg-gray-200',
  }[tone]
  const plural = (n: number) => {
    const mod10 = n % 10, mod100 = n % 100
    if (mod100 >= 11 && mod100 <= 14) return 'задач'
    if (mod10 === 1) return 'задача'
    if (mod10 >= 2 && mod10 <= 4) return 'задачи'
    return 'задач'
  }
  return (
    <div className={`flex flex-col min-h-[120px] ${highlight ? 'bg-green-50/20 rounded-xl' : ''}`}>
      {/* amoCRM-style header: uppercase title, count under, colored underline */}
      <div className="text-center pb-0">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.08em]">{title}</div>
        <div className="text-[13px] text-gray-600 mt-1">{count} {plural(count)}</div>
        <div className={`h-[2px] mt-3 ${underlineCls}`} />
      </div>
      <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-240px)] pt-3">
        {items.length === 0 ? (
          <div className="text-xs text-gray-300 text-center py-6">—</div>
        ) : (
          items.map(t => (
            <TaskCard key={t.id} task={t} onClick={() => onClick(t)} onQuickComplete={onQuickComplete} density={density} />
          ))
        )}
      </div>
    </div>
  )
}

function GroupBlock({ title, count, tone, items, onClick, onQuickComplete, density = 'detailed' }: {
  title: string; count: number
  tone: 'red' | 'green' | 'gray'
  items: TaskRow[]
  onClick: (t: TaskRow) => void
  onQuickComplete: (t: TaskRow, e: React.MouseEvent) => void
  density?: 'compact' | 'detailed'
}) {
  const barCls = tone === 'red' ? 'bg-red-500' : tone === 'green' ? 'bg-green-500' : 'bg-gray-300'
  const titleCls = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : 'text-gray-700'
  return (
    <div className="rounded-xl border border-gray-100 bg-white">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
        <span className={`w-1.5 h-4 rounded ${barCls}`} />
        <span className={`text-sm font-semibold ${titleCls} capitalize`}>{title}</span>
        <span className="text-xs text-gray-400 ml-auto">{count}</span>
      </div>
      <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {items.map(t => (
          <TaskCard key={t.id} task={t} onClick={() => onClick(t)} onQuickComplete={onQuickComplete} density={density} />
        ))}
      </div>
    </div>
  )
}
