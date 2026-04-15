'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/types'

const ROLES = [
  { slug: 'owner',   label: 'Владелец' },
  { slug: 'admin',   label: 'Администратор' },
  { slug: 'doctor',  label: 'Врач' },
  { slug: 'nurse',   label: 'Медсестра' },
  { slug: 'cashier', label: 'Кассир' },
  { slug: 'manager', label: 'Менеджер' },
]

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  role_slug: 'doctor',
}

interface FormState {
  first_name: string
  last_name: string
  email: string
  password: string
  role_slug: string
}

export default function UsersPage() {
  const [users, setUsers]     = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen]       = useState(false)
  const [form, setForm]       = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const load = useCallback(async () => {
    const { data } = await createClient()
      .from('user_profiles')
      .select('*, role:roles(id, slug, name, color)')
      .eq('is_active', true)
      .order('last_name')
    setUsers(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openModal = () => {
    setForm(EMPTY_FORM)
    setError('')
    setOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setOpen(false)
    setError('')
  }

  const set = (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    // Получаем текущий JWT для передачи в API
    const { data: { session } } = await createClient().auth.getSession()

    const res = await fetch('/api/settings/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
      },
      body: JSON.stringify(form),
    })

    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Ошибка при сохранении')
      setSaving(false)
      return
    }

    setSaving(false)
    setOpen(false)
    load()
  }

  // ─── UI ───────────────────────────────────────────────────────────────────

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1.5'

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Сотрудники</h2>
          <p className="text-sm text-gray-400">{users.length} сотрудников</p>
        </div>
        <button
          onClick={openModal}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Добавить сотрудника
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Сотрудников нет</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm flex-shrink-0">
                  {u.first_name[0]}{u.last_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {u.last_name} {u.first_name} {u.middle_name ?? ''}
                  </p>
                  {u.phone && <p className="text-xs text-gray-400">{u.phone}</p>}
                </div>
                {u.role && (
                  <span
                    className="text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0"
                    style={{
                      background: (u.role.color ?? '#6B7280') + '22',
                      color: u.role.color ?? '#6B7280',
                    }}
                  >
                    {u.role.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={closeModal}
          />

          {/* Dialog */}
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 z-10">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-900">Новый сотрудник</h3>
              <button
                onClick={closeModal}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Фамилия <span className="text-red-400">*</span></label>
                  <input
                    className={inputCls}
                    placeholder="Иванов"
                    value={form.last_name}
                    onChange={set('last_name')}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className={labelCls}>Имя <span className="text-red-400">*</span></label>
                  <input
                    className={inputCls}
                    placeholder="Алибек"
                    value={form.first_name}
                    onChange={set('first_name')}
                    required
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className={labelCls}>Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  className={inputCls}
                  placeholder="alibek@clinic.kz"
                  value={form.email}
                  onChange={set('email')}
                  required
                />
              </div>

              {/* Role */}
              <div>
                <label className={labelCls}>Роль <span className="text-red-400">*</span></label>
                <select
                  className={inputCls}
                  value={form.role_slug}
                  onChange={set('role_slug')}
                  required
                >
                  {ROLES.map((r) => (
                    <option key={r.slug} value={r.slug}>{r.label}</option>
                  ))}
                </select>
              </div>

              {/* Password */}
              <div>
                <label className={labelCls}>Пароль <span className="text-red-400">*</span></label>
                <input
                  type="password"
                  className={inputCls}
                  placeholder="Минимум 6 символов"
                  value={form.password}
                  onChange={set('password')}
                  required
                  minLength={6}
                />
              </div>

              {/* Error */}
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">
                  {error}
                </p>
              )}

              {/* Actions */}
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
                  {saving ? 'Сохранение...' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
