'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Role } from '@/types'

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    createClient()
      .from('roles')
      .select('*')
      .order('is_system', { ascending: false })
      .then(({ data }) => {
        setRoles(data ?? [])
        setLoading(false)
      })
  }, [])

  const SLUG_RU: Record<string, string> = {
    owner: 'Владелец',
    admin: 'Администратор',
    doctor: 'Врач',
    nurse: 'Медсестра',
    laborant: 'Лаборант',
    cashier: 'Кассир',
    manager: 'Менеджер',
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Роли и права</h2>
        <span className="text-sm text-gray-400">{roles.length} ролей</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Загрузка...</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ background: r.color }}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">
                      {SLUG_RU[r.slug] ?? r.name}
                    </p>
                    {r.is_system && (
                      <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        Системная
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {r.max_discount_percent === null
                      ? 'Без ограничений скидки'
                      : `Скидка до ${r.max_discount_percent}%`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
