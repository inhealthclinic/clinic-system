'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/types'

export default function UsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    createClient()
      .from('user_profiles')
      .select('*, role:roles(id, slug, name, color)')
      .eq('is_active', true)
      .order('last_name')
      .then(({ data }) => {
        setUsers(data ?? [])
        setLoading(false)
      })
  }, [])

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Пользователи</h2>
        <span className="text-sm text-gray-400">{users.length} сотрудников</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">Пользователей нет</div>
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
                    className="text-xs font-medium px-2.5 py-1 rounded-full"
                    style={{
                      background: (u.role.color ?? '#6B7280') + '20',
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
    </div>
  )
}
