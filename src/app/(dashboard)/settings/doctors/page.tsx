'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthStore } from '@/lib/stores/authStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Specialization {
  id: string
  name: string
}

interface DoctorRow {
  id: string
  user_id: string
  first_name: string
  last_name: string
  middle_name: string | null
  color: string
  consultation_duration: number
  is_active: boolean
  specialization: Specialization | null
}

interface UserProfileOption {
  id: string
  first_name: string
  last_name: string
  role: { name: string } | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { hex: '#3B82F6', label: 'Синий' },
  { hex: '#10B981', label: 'Зелёный' },
  { hex: '#F59E0B', label: 'Жёлтый' },
  { hex: '#EF4444', label: 'Красный' },
  { hex: '#8B5CF6', label: 'Фиолетовый' },
  { hex: '#6B7280', label: 'Серый' },
]

const EMPTY_FORM = {
  user_id: '',
  first_name: '',
  last_name: '',
  specialization_id: '',
  color: '#3B82F6',
  consultation_duration: 30,
}

// ─── CSS helpers ─────────────────────────────────────────────────────────────

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

// ─── Component ────────────────────────────────────────────────────────────────

export default function DoctorsPage() {
  const { profile } = useAuthStore()
  const clinicId = profile?.clinic_id ?? ''

  const [doctors, setDoctors] = useState<DoctorRow[]>([])
  const [specializations, setSpecializations] = useState<Specialization[]>([])
  const [availableUsers, setAvailableUsers] = useState<UserProfileOption[]>([])
  const [loading, setLoading] = useState(true)

  // Add modal
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Inline edit state: key = doctor id
  const [editState, setEditState] = useState<
    Record<string, { color: string; duration: number; saving: boolean }>
  >({})

  // ── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!clinicId) return
    const supabase = createClient()

    const [doctorsRes, specsRes] = await Promise.all([
      supabase
        .from('doctors')
        .select('id, user_id, first_name, last_name, middle_name, color, consultation_duration, is_active, specialization:specializations(id, name)')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('last_name'),
      supabase
        .from('specializations')
        .select('id, name')
        .eq('clinic_id', clinicId)
        .order('name'),
    ])

    const doctorList: DoctorRow[] = (doctorsRes.data ?? []).map((d) => ({
      ...d,
      specialization: Array.isArray(d.specialization)
        ? (d.specialization[0] ?? null)
        : (d.specialization ?? null),
    }))

    setDoctors(doctorList)
    setSpecializations(specsRes.data ?? [])
    setLoading(false)
  }, [clinicId])

  const loadAvailableUsers = useCallback(async () => {
    if (!clinicId) return
    const supabase = createClient()

    const [usersRes, doctorUsersRes] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('id, first_name, last_name, role:roles(name)')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .order('last_name'),
      supabase
        .from('doctors')
        .select('user_id')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null),
    ])

    const usedUserIds = new Set((doctorUsersRes.data ?? []).map((d) => d.user_id))
    const free = (usersRes.data ?? [])
      .filter((u) => !usedUserIds.has(u.id))
      .map((u) => ({
        ...u,
        role: Array.isArray(u.role) ? (u.role[0] ?? null) : (u.role ?? null),
      }))

    setAvailableUsers(free)
  }, [clinicId])

  useEffect(() => {
    load()
  }, [load])

  // ── Modal ─────────────────────────────────────────────────────────────────

  const openModal = () => {
    setForm({ ...EMPTY_FORM })
    setError('')
    loadAvailableUsers()
    setOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setOpen(false)
    setError('')
  }

  const handleUserSelect = (userId: string) => {
    const user = availableUsers.find((u) => u.id === userId)
    setForm((prev) => ({
      ...prev,
      user_id: userId,
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!clinicId) return
    setError('')
    setSaving(true)

    const supabase = createClient()
    const { error: insertError } = await supabase.from('doctors').insert({
      clinic_id: clinicId,
      user_id: form.user_id,
      first_name: form.first_name,
      last_name: form.last_name,
      specialization_id: form.specialization_id || null,
      color: form.color,
      consultation_duration: form.consultation_duration,
      is_active: true,
    })

    if (insertError) {
      setError(insertError.message)
      setSaving(false)
      return
    }

    setSaving(false)
    setOpen(false)
    load()
  }

  // ── Inline edit ──────────────────────────────────────────────────────────

  const startEdit = (doctor: DoctorRow) => {
    setEditState((prev) => ({
      ...prev,
      [doctor.id]: {
        color: doctor.color,
        duration: doctor.consultation_duration,
        saving: false,
      },
    }))
  }

  const cancelEdit = (doctorId: string) => {
    setEditState((prev) => {
      const next = { ...prev }
      delete next[doctorId]
      return next
    })
  }

  const saveEdit = async (doctorId: string) => {
    const state = editState[doctorId]
    if (!state) return

    setEditState((prev) => ({ ...prev, [doctorId]: { ...state, saving: true } }))

    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('doctors')
      .update({
        color: state.color,
        consultation_duration: state.duration,
      })
      .eq('id', doctorId)

    if (updateError) {
      setEditState((prev) => ({ ...prev, [doctorId]: { ...state, saving: false } }))
      return
    }

    setEditState((prev) => {
      const next = { ...prev }
      delete next[doctorId]
      return next
    })
    load()
  }

  const deactivate = async (doctorId: string) => {
    const supabase = createClient()
    await supabase
      .from('doctors')
      .update({ is_active: false })
      .eq('id', doctorId)
    load()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Врачи</h2>
          <p className="text-sm text-gray-400">{doctors.length} активных врачей</p>
        </div>
        <button
          onClick={openModal}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Добавить врача
        </button>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : doctors.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Врачей нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {doctors.map((doctor) => {
              const editing = editState[doctor.id]
              return (
                <div key={doctor.id} className="px-5 py-4">
                  {editing ? (
                    /* ── Inline edit row ── */
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-offset-1 ring-gray-300"
                          style={{ background: editing.color }}
                        />
                        <p className="text-sm font-medium text-gray-900">
                          {doctor.last_name} {doctor.first_name}{doctor.middle_name ? ` ${doctor.middle_name}` : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        {/* Color picker */}
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Цвет</p>
                          <div className="flex gap-1.5">
                            {PRESET_COLORS.map((c) => (
                              <button
                                key={c.hex}
                                type="button"
                                title={c.label}
                                onClick={() =>
                                  setEditState((prev) => ({
                                    ...prev,
                                    [doctor.id]: { ...editing, color: c.hex },
                                  }))
                                }
                                className={[
                                  'w-6 h-6 rounded-full transition-transform hover:scale-110',
                                  editing.color === c.hex ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : '',
                                ].join(' ')}
                                style={{ background: c.hex }}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Duration */}
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">Длительность (мин)</p>
                          <input
                            type="number"
                            min={5}
                            max={240}
                            step={5}
                            className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                            value={editing.duration}
                            onChange={(e) =>
                              setEditState((prev) => ({
                                ...prev,
                                [doctor.id]: { ...editing, duration: Number(e.target.value) },
                              }))
                            }
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => saveEdit(doctor.id)}
                          disabled={editing.saving}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {editing.saving ? 'Сохранение...' : 'Сохранить'}
                        </button>
                        <button
                          onClick={() => cancelEdit(doctor.id)}
                          disabled={editing.saving}
                          className="border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Отмена
                        </button>
                        <button
                          onClick={() => deactivate(doctor.id)}
                          disabled={editing.saving}
                          className="ml-auto text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                        >
                          Деактивировать
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal row ── */
                    <div className="flex items-center gap-4">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ background: doctor.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {doctor.last_name} {doctor.first_name}{doctor.middle_name ? ` ${doctor.middle_name}` : ''}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {doctor.specialization && (
                            <span className="text-xs text-gray-400">{doctor.specialization.name}</span>
                          )}
                          <span className="text-xs text-gray-300">{doctor.consultation_duration} мин</span>
                        </div>
                      </div>
                      <button
                        onClick={() => startEdit(doctor)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors flex-shrink-0"
                      >
                        Изменить
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeModal} />

          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">Новый врач</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* User select */}
              <div>
                <label className={labelCls}>
                  Сотрудник <span className="text-red-400">*</span>
                </label>
                <select
                  className={inputCls}
                  value={form.user_id}
                  onChange={(e) => handleUserSelect(e.target.value)}
                  required
                >
                  <option value="">— выберите сотрудника —</option>
                  {availableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.last_name} {u.first_name}
                      {u.role ? ` (${u.role.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Name (auto-filled, editable) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Фамилия <span className="text-red-400">*</span></label>
                  <input
                    className={inputCls}
                    placeholder="Иванов"
                    value={form.last_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, last_name: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className={labelCls}>Имя <span className="text-red-400">*</span></label>
                  <input
                    className={inputCls}
                    placeholder="Алибек"
                    value={form.first_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, first_name: e.target.value }))}
                    required
                  />
                </div>
              </div>

              {/* Specialization */}
              <div>
                <label className={labelCls}>Специализация</label>
                <select
                  className={inputCls}
                  value={form.specialization_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, specialization_id: e.target.value }))}
                >
                  <option value="">— не указана —</option>
                  {specializations.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Color picker */}
              <div>
                <label className={labelCls}>Цвет в расписании</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      onClick={() => setForm((prev) => ({ ...prev, color: c.hex }))}
                      className={[
                        'w-8 h-8 rounded-full transition-transform hover:scale-110 border-2',
                        form.color === c.hex
                          ? 'border-gray-500 scale-110'
                          : 'border-transparent',
                      ].join(' ')}
                      style={{ background: c.hex }}
                    />
                  ))}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className={labelCls}>Длительность приёма (минут)</label>
                <input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  className={inputCls}
                  value={form.consultation_duration}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, consultation_duration: Number(e.target.value) }))
                  }
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="flex-1 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
                >
                  {saving ? 'Сохранение...' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
