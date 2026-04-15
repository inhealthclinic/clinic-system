'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Patient, Appointment } from '@/types'

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  pending:    { cls: 'bg-gray-100 text-gray-600',       label: 'Ожидает' },
  confirmed:  { cls: 'bg-green-100 text-green-700',     label: 'Подтверждено' },
  arrived:    { cls: 'bg-yellow-100 text-yellow-700',   label: 'Пришёл' },
  completed:  { cls: 'bg-blue-100 text-blue-700',       label: 'Завершено' },
  no_show:    { cls: 'bg-red-100 text-red-600',         label: 'Не явился' },
  cancelled:  { cls: 'bg-gray-50 text-gray-400',        label: 'Отменено' },
  rescheduled:{ cls: 'bg-purple-100 text-purple-600',   label: 'Перенесено' },
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый', active: 'Активный', in_treatment: 'На лечении',
  completed: 'Завершён', lost: 'Потерян', vip: 'VIP',
}
const STATUS_CLR: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600', active: 'bg-blue-100 text-blue-700',
  in_treatment: 'bg-green-100 text-green-700', completed: 'bg-purple-100 text-purple-700',
  lost: 'bg-red-100 text-red-600', vip: 'bg-yellow-100 text-yellow-700',
}

export default function PatientCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [patient, setPatient] = useState<Patient | null>(null)
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Patient>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([
      supabase.from('patients').select('*').eq('id', id).single(),
      supabase
        .from('appointments')
        .select('*, doctor:doctors(id, first_name, last_name, color)')
        .eq('patient_id', id)
        .order('date', { ascending: false })
        .order('time_start', { ascending: false })
        .limit(20),
    ])
    if (!p.data) { router.push('/patients'); return }
    setPatient(p.data)
    setEditForm(p.data)
    setAppointments((a.data ?? []) as Appointment[])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  const saveEdit = async () => {
    if (!patient) return
    setSaving(true)
    const { data } = await supabase
      .from('patients')
      .update({
        full_name: editForm.full_name,
        phones: editForm.phones,
        gender: editForm.gender,
        birth_date: editForm.birth_date || null,
        city: editForm.city || null,
        email: editForm.email || null,
        iin: editForm.iin || null,
        notes: editForm.notes || null,
      })
      .eq('id', patient.id)
      .select()
      .single()
    if (data) { setPatient(data); setEditForm(data) }
    setSaving(false)
    setEditing(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-sm text-gray-400">Загрузка...</div>
  )
  if (!patient) return null

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
  const age = patient.birth_date
    ? new Date().getFullYear() - new Date(patient.birth_date).getFullYear()
    : null

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
        ← Пациенты
      </Link>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">ФИО</label>
                <input
                  className={inputCls}
                  value={editForm.full_name ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Телефон</label>
                <input
                  className={inputCls}
                  value={editForm.phones?.[0] ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, phones: e.target.value ? [e.target.value] : [] }))}
                  placeholder="+7 700 000 0000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Пол</label>
                <select
                  className={inputCls}
                  value={editForm.gender ?? 'other'}
                  onChange={e => setEditForm(f => ({ ...f, gender: e.target.value as 'male' | 'female' | 'other' }))}
                >
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="other">Не указан</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата рождения</label>
                <input
                  type="date"
                  className={inputCls}
                  value={editForm.birth_date ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, birth_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">ИИН</label>
                <input
                  className={inputCls}
                  value={editForm.iin ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, iin: e.target.value }))}
                  placeholder="000000000000"
                  maxLength={12}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={editForm.email ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Город</label>
                <input
                  className={inputCls}
                  value={editForm.city ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="Актау"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">Заметки</label>
                <textarea
                  className={inputCls + ' resize-none'}
                  rows={2}
                  value={editForm.notes ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setEditing(false); setEditForm(patient) }}
                className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2 text-sm font-medium"
              >
                Отмена
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium"
              >
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xl flex-shrink-0">
              {patient.full_name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-gray-900">{patient.full_name}</h2>
                {patient.is_vip && (
                  <span className="text-xs font-medium bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">VIP ⭐</span>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_CLR[patient.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_LABEL[patient.status] ?? patient.status}
                </span>
                {patient.patient_number && (
                  <span className="text-xs text-gray-400 font-mono">{patient.patient_number}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                {patient.phones[0] && <span>📞 {patient.phones[0]}</span>}
                {patient.birth_date && (
                  <span>🎂 {new Date(patient.birth_date).toLocaleDateString('ru-RU')}{age ? ` (${age} лет)` : ''}</span>
                )}
                {patient.gender && patient.gender !== 'other' && (
                  <span>{patient.gender === 'male' ? '♂ Мужской' : '♀ Женский'}</span>
                )}
                {patient.city && <span>📍 {patient.city}</span>}
                {patient.email && <span>✉️ {patient.email}</span>}
                {patient.iin && <span className="font-mono">ИИН: {patient.iin}</span>}
              </div>
              {patient.notes && (
                <p className="mt-2 text-sm text-gray-500 italic">{patient.notes}</p>
              )}
              {patient.tags?.length > 0 && (
                <div className="mt-2 flex gap-1 flex-wrap">
                  {patient.tags.map(t => (
                    <span key={t} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-gray-400 hover:text-blue-600 border border-gray-200 hover:border-blue-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                ✏️ Редактировать
              </button>
              {patient.balance_amount > 0 && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">Депозит</p>
                  <p className="text-base font-semibold text-green-600">+{patient.balance_amount.toLocaleString('ru-RU')} ₸</p>
                </div>
              )}
              {patient.debt_amount > 0 && (
                <div className="text-right">
                  <p className="text-xs text-gray-400">Долг</p>
                  <p className="text-base font-semibold text-red-500">-{patient.debt_amount.toLocaleString('ru-RU')} ₸</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Appointments */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">История записей</h3>
          <span className="text-xs text-gray-400">{appointments.length} записей</span>
        </div>
        {appointments.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Записей нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {appointments.map(a => {
              const st = STATUS_STYLE[a.status] ?? { cls: 'bg-gray-100 text-gray-600', label: a.status }
              const doctor = a.doctor as { last_name: string; first_name: string; color?: string } | undefined
              return (
                <div key={a.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {new Date(a.date + 'T12:00:00').toLocaleDateString('ru-RU', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                      <span className="text-gray-400 ml-2 font-normal">{a.time_start.slice(0, 5)}</span>
                    </p>
                    {doctor && (
                      <p className="text-xs text-gray-400 mt-0.5">{doctor.last_name} {doctor.first_name}</p>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
