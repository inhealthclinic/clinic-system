'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { usePermissions } from '@/lib/hooks/usePermissions'
import { PermissionGuard } from '@/components/shared/PermissionGuard'

interface User {
  id: string
  first_name: string
  last_name: string
  middle_name?: string
  phone?: string
  is_active: boolean
  role_id: string
  role: { id: string; name: string; color: string; slug: string }
  last_login?: string
  created_at: string
}

interface Role { id: string; name: string; color: string; slug: string }

export default function UsersPage() {
  const { can } = usePermissions()
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [search, setSearch] = useState('')
  const supabase = createClient()

  useEffect(() => {
    supabase.from('user_profiles')
      .select('*, role:roles(id,name,color,slug)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setUsers(data || []))

    supabase.from('roles').select('id,name,color,slug').order('name')
      .then(({ data }) => setRoles(data || []))
  }, [])

  const filtered = users.filter(u =>
    `${u.first_name} ${u.last_name} ${u.phone || ''}`.toLowerCase().includes(search.toLowerCase())
  )

  const toggleActive = async (user: User) => {
    if (!can('settings:users')) return
    await supabase.from('user_profiles')
      .update({ is_active: !user.is_active })
      .eq('id', user.id)
    setUsers(prev => prev.map(u =>
      u.id === user.id ? { ...u, is_active: !u.is_active } : u
    ))
  }

  const changeRole = async (userId: string, roleId: string) => {
    if (!can('settings:users')) return
    const role = roles.find(r => r.id === roleId)!
    await supabase.from('user_profiles').update({ role_id: roleId }).eq('id', userId)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role_id: roleId, role } : u))
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Пользователи</h1>
          <p className="text-gray-500 text-sm mt-1">Сотрудники клиники</p>
        </div>
        <PermissionGuard permission="settings:users">
          <button
            onClick={() => { setEditUser(null); setShowModal(true) }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            + Добавить сотрудника
          </button>
        </PermissionGuard>
      </div>

      {/* Поиск */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Таблица */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Сотрудник</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Телефон</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Роль</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Последний вход</th>
              <th className="text-left px-4 py-3 text-gray-500 font-medium">Статус</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-xs">
                      {user.first_name[0]}{user.last_name[0]}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {user.last_name} {user.first_name} {user.middle_name || ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{user.phone || '—'}</td>
                <td className="px-4 py-3">
                  <PermissionGuard
                    permission="settings:users"
                    fallback={
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: user.role.color }}
                      >
                        {user.role.name}
                      </span>
                    }
                  >
                    <select
                      value={user.role_id}
                      onChange={e => changeRole(user.id, e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
                      style={{ color: user.role.color }}
                      disabled={user.role.slug === 'owner'}
                    >
                      {roles.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>
                  </PermissionGuard>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {user.last_login
                    ? new Date(user.last_login).toLocaleDateString('ru', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
                    : 'Не входил'}
                </td>
                <td className="px-4 py-3">
                  <PermissionGuard permission="settings:users">
                    <button
                      onClick={() => toggleActive(user)}
                      disabled={user.role.slug === 'owner'}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        user.is_active ? 'bg-green-500' : 'bg-gray-200'
                      } disabled:opacity-50`}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
                        user.is_active ? 'translate-x-5' : 'translate-x-1'
                      }`} />
                    </button>
                  </PermissionGuard>
                </td>
                <td className="px-4 py-3">
                  <PermissionGuard permission="settings:users">
                    <button
                      onClick={() => { setEditUser(user); setShowModal(true) }}
                      className="text-gray-400 hover:text-gray-600 text-xs"
                    >
                      Изменить
                    </button>
                  </PermissionGuard>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Сотрудники не найдены
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Модальное окно создания/редактирования */}
      {showModal && (
        <UserModal
          user={editUser}
          roles={roles}
          onClose={() => setShowModal(false)}
          onSave={(saved) => {
            if (editUser) {
              setUsers(prev => prev.map(u => u.id === saved.id ? saved : u))
            } else {
              setUsers(prev => [saved, ...prev])
            }
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}

// ---------- Модальное окно ----------
function UserModal({
  user, roles, onClose, onSave
}: {
  user: User | null
  roles: Role[]
  onClose: () => void
  onSave: (user: User) => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    first_name:  user?.first_name  || '',
    last_name:   user?.last_name   || '',
    middle_name: user?.middle_name || '',
    phone:       user?.phone       || '',
    role_id:     user?.role_id     || roles[0]?.id || '',
    email:       '',
    password:    '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setLoading(true); setError('')
    try {
      if (user) {
        // Редактирование
        const { error: e } = await supabase.from('user_profiles')
          .update({ first_name: form.first_name, last_name: form.last_name,
            middle_name: form.middle_name, phone: form.phone, role_id: form.role_id })
          .eq('id', user.id)
        if (e) throw e
        const role = roles.find(r => r.id === form.role_id)!
        onSave({ ...user, ...form, role })
      } else {
        // Создание — через API route (нужен service role)
        const res = await fetch('/api/settings/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        onSave(data.user)
      }
    } catch (e: any) {
      setError(e.message || 'Ошибка')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-5">
          {user ? 'Редактировать сотрудника' : 'Новый сотрудник'}
        </h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Фамилия *</label>
              <input value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Имя *</label>
              <input value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Отчество</label>
            <input value={form.middle_name} onChange={e => setForm(f => ({ ...f, middle_name: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Телефон</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="+7 ..." />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Роль *</label>
            <select value={form.role_id} onChange={e => setForm(f => ({ ...f, role_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
              {roles.filter(r => r.slug !== 'owner').map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          {!user && (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Email *</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Пароль *</label>
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          )}
        </div>

        {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm hover:bg-gray-50">
            Отмена
          </button>
          <button onClick={save} disabled={loading}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            {loading ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  )
}
